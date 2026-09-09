begin;
-- No data backfill. Names arrive only through the already scheduled regular Close sync.
alter table public.close_funnel_leads add column display_name text;
comment on column public.close_funnel_leads.display_name is 'Close display_name from regular metadata refresh; nullable, never manually inferred.';
create or replace function public.reconcile_close_funnel_snapshot(
 p_start_date date,p_end_date date,p_snapshot_started_at timestamptz,
 p_raw jsonb,p_facts jsonb,p_opportunities jsonb,p_leads jsonb,p_bookings jsonb,
 p_meetings jsonb,p_calendar_leads jsonb,p_events jsonb,p_processes jsonb,
 p_meeting_relations jsonb,p_event_relations jsonb,p_funnel_leads jsonb,
 p_status_created_since timestamptz
) returns jsonb language plpgsql security definer set search_path='' set jit=off as $$
declare v_result jsonb; v_rows jsonb; v_started_at timestamptz:=clock_timestamp();
begin
 -- This transaction is part of the same authoritative full sync, never an
 -- independent lead backfill. Existing lock/staleness checks run first.
 v_result:=public.reconcile_close_calendar_snapshot(p_start_date,p_end_date,p_snapshot_started_at,
  p_raw,p_facts,p_opportunities,p_leads,p_bookings,p_meetings,p_calendar_leads);
 raise log 'close_funnel_snapshot phase=calendar_complete elapsed_ms=%',round(extract(epoch from clock_timestamp()-v_started_at)*1000);
 foreach v_rows in array array[p_events,p_processes,p_meeting_relations,p_event_relations,p_funnel_leads] loop
  if jsonb_typeof(v_rows) is distinct from 'array' or jsonb_array_length(v_rows)>100000
   then raise exception 'Invalid funnel snapshot';end if;
 end loop;
 if p_status_created_since is null or p_status_created_since>p_snapshot_started_at then raise exception 'Invalid status history boundary';end if;
 drop table if exists pg_temp._close_funnel_events;
 create temporary table _close_funnel_events on commit drop as select * from jsonb_populate_recordset(null::public.close_funnel_events,p_events);
 create index on pg_temp._close_funnel_events (source_kind,source_event_id);
 analyze pg_temp._close_funnel_events;
 drop table if exists pg_temp._close_funnel_leads;
 create temporary table _close_funnel_leads on commit drop as select * from jsonb_populate_recordset(null::public.close_funnel_leads,p_funnel_leads);
 create index on pg_temp._close_funnel_leads (lead_id);
 analyze pg_temp._close_funnel_leads;
 drop table if exists pg_temp._close_funnel_processes;
 create temporary table _close_funnel_processes on commit drop as select p->>'process_id' process_id,p->>'lead_id' lead_id,p payload from jsonb_array_elements(p_processes) p;
 create index on pg_temp._close_funnel_processes (process_id);
 analyze pg_temp._close_funnel_processes;
 drop table if exists pg_temp._close_funnel_meeting_relations;
 create temporary table _close_funnel_meeting_relations on commit drop as select p->>'meeting_id' meeting_id,p->>'process_id' process_id,p payload from jsonb_array_elements(p_meeting_relations) p;
 create index on pg_temp._close_funnel_meeting_relations (meeting_id);
 create index on pg_temp._close_funnel_meeting_relations (process_id);
 analyze pg_temp._close_funnel_meeting_relations;
 drop table if exists pg_temp._close_funnel_event_relations;
 create temporary table _close_funnel_event_relations on commit drop as select p->>'source_kind' source_kind,p->>'source_event_id' source_event_id,p->>'event_type' event_type,p->>'process_id' process_id,(p->>'occurred_at')::timestamptz occurred_at,p payload from jsonb_array_elements(p_event_relations) p;
 create index on pg_temp._close_funnel_event_relations (source_kind,source_event_id,event_type);
 create index on pg_temp._close_funnel_event_relations (process_id);
 analyze pg_temp._close_funnel_event_relations;
 raise log 'close_funnel_snapshot phase=inputs_staged elapsed_ms=%',round(extract(epoch from clock_timestamp()-v_started_at)*1000);
 if exists(select 1 from pg_temp._close_funnel_events e where nullif(e.lead_id,'') is null
  or nullif(e.source_event_id,'') is null or length(e.source_revision)<>64
  or jsonb_typeof(e.payload) is distinct from 'object')
 or exists(select 1 from pg_temp._close_funnel_events e group by e.source_kind,e.source_event_id having count(*)>1)
 then raise exception 'Invalid funnel source revisions';end if;
 if exists(select 1 from pg_temp._close_funnel_processes p where nullif(p.process_id,'') is null or nullif(p.lead_id,'') is null)
 or exists(select 1 from pg_temp._close_funnel_processes p group by p.process_id having count(*)>1)
 then raise exception 'Invalid process identities';end if;
 if exists(select 1 from pg_temp._close_funnel_meeting_relations r
  where not exists(select 1 from pg_temp._close_funnel_processes p where p.process_id=r.process_id)
  or not exists(select 1 from public.close_meetings m where m.meeting_id=r.meeting_id and m.removed_at is null and m.last_seen_at=p_snapshot_started_at))
 or exists(select 1 from pg_temp._close_funnel_event_relations r
  where not exists(select 1 from pg_temp._close_funnel_processes p where p.process_id=r.process_id))
 then raise exception 'Incomplete process relationships';end if;

 -- A complete source snapshot may withdraw a deleted object. Status activities
 -- have an explicit creation window; older history must never be withdrawn by
 -- falling out of that window. No unobserved historical status is invented.
 insert into public.close_funnel_observations(source_kind,source_event_id,source_revision,observed_at,action)
 select e.source_kind,e.source_event_id,e.source_revision,p_snapshot_started_at,'withdrawn'
 from public.close_funnel_events e where e.is_current and e.withdrawn_at is null
  and (e.source_kind<>'lead_status_change' or (e.payload->>'date_created')::timestamptz>=p_status_created_since)
  and not exists(select 1 from pg_temp._close_funnel_events n where n.source_kind=e.source_kind and n.source_event_id=e.source_event_id)
 on conflict do nothing;
 update public.close_funnel_events e set is_current=false,withdrawn_at=p_snapshot_started_at
 where e.is_current and (e.source_kind<>'lead_status_change' or (e.payload->>'date_created')::timestamptz>=p_status_created_since)
  and not exists(select 1 from pg_temp._close_funnel_events n where n.source_kind=e.source_kind and n.source_event_id=e.source_event_id);
 insert into public.close_funnel_observations(source_kind,source_event_id,source_revision,observed_at,action)
 select n.source_kind,n.source_event_id,n.source_revision,p_snapshot_started_at,'current'
 from pg_temp._close_funnel_events n where not exists(select 1 from public.close_funnel_events e
  where e.source_kind=n.source_kind and e.source_event_id=n.source_event_id and e.source_revision=n.source_revision and e.is_current)
 on conflict do nothing;
 update public.close_funnel_events e set is_current=false where e.is_current and exists(
  select 1 from pg_temp._close_funnel_events n where n.source_kind=e.source_kind and n.source_event_id=e.source_event_id and n.source_revision<>e.source_revision);
 insert into public.close_funnel_events(lead_id,event_type,occurred_at,meeting_id,previous_status,new_status,setter_id,closer_id,
  source_event_id,source_kind,source_updated_at,source_revision,payload,is_current,first_seen_at,last_seen_at,withdrawn_at)
 select lead_id,event_type,occurred_at,meeting_id,previous_status,new_status,setter_id,closer_id,
  source_event_id,source_kind,source_updated_at,source_revision,payload,true,p_snapshot_started_at,p_snapshot_started_at,null
 from pg_temp._close_funnel_events
 on conflict(source_kind,source_event_id,source_revision) do update set is_current=true,last_seen_at=excluded.last_seen_at,withdrawn_at=null;
 raise log 'close_funnel_snapshot phase=journal_written elapsed_ms=%',round(extract(epoch from clock_timestamp()-v_started_at)*1000);

 update public.close_sales_processes s set retired_at=p_snapshot_started_at where s.retired_at is null
  and not exists(select 1 from pg_temp._close_funnel_processes p where p.process_id=s.process_id);
 insert into public.close_sales_processes(process_id,lead_id,payload,last_seen_at,retired_at)
 select p.process_id,p.lead_id,p.payload,p_snapshot_started_at,null from pg_temp._close_funnel_processes p
 on conflict(process_id) do update set lead_id=excluded.lead_id,payload=excluded.payload,last_seen_at=excluded.last_seen_at,retired_at=null;
 update public.close_process_meetings r set removed_at=p_snapshot_started_at where r.removed_at is null
  and not exists(select 1 from pg_temp._close_funnel_meeting_relations n where n.meeting_id=r.meeting_id);
 insert into public.close_process_meetings(meeting_id,process_id,payload,last_seen_at,removed_at)
 select r.meeting_id,r.process_id,r.payload,p_snapshot_started_at,null from pg_temp._close_funnel_meeting_relations r
 on conflict(meeting_id) do update set process_id=excluded.process_id,payload=excluded.payload,last_seen_at=excluded.last_seen_at,removed_at=null;
 update public.close_process_events r set removed_at=p_snapshot_started_at where r.removed_at is null
  and not exists(select 1 from pg_temp._close_funnel_event_relations n where n.source_kind=r.source_kind
   and n.source_event_id=r.source_event_id and n.event_type=r.event_type);
 insert into public.close_process_events(source_kind,source_event_id,event_type,process_id,occurred_at,payload,last_seen_at,removed_at)
 select r.source_kind,r.source_event_id,r.event_type,r.process_id,(r.occurred_at)::timestamptz,r.payload,p_snapshot_started_at,null
 from pg_temp._close_funnel_event_relations r
 on conflict(source_kind,source_event_id,event_type) do update set process_id=excluded.process_id,occurred_at=excluded.occurred_at,
 payload=excluded.payload,last_seen_at=excluded.last_seen_at,removed_at=null;
 insert into public.close_funnel_leads(lead_id,display_name,lead_source,opener_close_user_id,setter_id,closer_id,status_id,source_updated_at,last_seen_at)
 select lead_id,display_name,lead_source,opener_close_user_id,setter_id,closer_id,status_id,source_updated_at,p_snapshot_started_at
 from pg_temp._close_funnel_leads
 on conflict(lead_id) do update set display_name=excluded.display_name,lead_source=excluded.lead_source,opener_close_user_id=excluded.opener_close_user_id,
 setter_id=excluded.setter_id,closer_id=excluded.closer_id,status_id=excluded.status_id,source_updated_at=excluded.source_updated_at,last_seen_at=excluded.last_seen_at;
 insert into public.close_lead_reporting(lead_id,lead_source,opener_close_user_id)
 select lead_id,lead_source,opener_close_user_id from public.close_funnel_leads
 on conflict(lead_id) do update set lead_source=excluded.lead_source,opener_close_user_id=excluded.opener_close_user_id;
 insert into public.close_reconciliation_state values('funnel',p_snapshot_started_at)
 on conflict(resource) do update set snapshot_started_at=excluded.snapshot_started_at;
 raise log 'close_funnel_snapshot phase=complete elapsed_ms=%',round(extract(epoch from clock_timestamp()-v_started_at)*1000);
 return v_result||jsonb_build_object('funnel_events',jsonb_array_length(p_events),'processes',jsonb_array_length(p_processes));
end;$$;
create or replace function public.get_reporting_calendar_internal(p_period text,p_reference_date date) returns jsonb
language sql stable security definer set search_path='' set jit=off as $$
with bounds as (
 select case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date else date_trunc('month',p_reference_date::timestamp)::date end start_date,
 case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date+6 else (date_trunc('month',p_reference_date::timestamp)+interval '1 month - 1 day')::date end end_date,
 least(public.get_sales_data_as_of_internal(),((p_reference_date+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond') cutoff
), setter as materialized(select m.* from bounds b cross join lateral public.get_setter_meetings_internal(b.start_date,b.end_date,false) m),
 outcomes as materialized(select o.* from bounds b cross join lateral public.get_setter_meeting_outcomes_internal(b.start_date,p_reference_date) o),
 planned as materialized(select x from jsonb_array_elements(public.get_antony_pipeline_snapshot_internal(p_reference_date)->'scheduled_meetings') x),
 details as (
 select m.meeting_id,m.lead_id,m.starts_at,l.display_name,coalesce(l.lead_source,'Nicht zugeordnet') source,
 case m.owner_id when 'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy' then 'Kalender: Michael' when 'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4' then 'Kalender: Felix' when 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'Kalender: Antony' else null end scheduled_with,
 public.get_close_opener_internal(m.lead_id) owner,
 case when s.meeting_id is not null then 'setter' else coalesce(pl.x->>'stage',proof.stage,'unassigned') end stage,
 case when m.starts_at>b.cutoff then case when m.status in ('canceled','cancelled','declined-by-lead','declined-by-org') then 'cancelled_plan' else 'planned' end
 when s.meeting_id is not null then coalesce(o.outcome,'unknown') when proof.stage is not null then proof.outcome else 'unknown' end outcome,
 coalesce((p.payload->>'first_meeting_at')::timestamptz,case when pl.x is not null then (select min((q.payload->>'first_meeting_at')::timestamptz) from public.close_sales_processes q where q.lead_id=m.lead_id and q.retired_at is null and (q.payload->>'opened_at')::timestamptz<=b.cutoff having count(*)=1) end) first_meeting_at,
 m.starts_at<=b.cutoff and s.meeting_id is not null and coalesce(o.outcome,'unknown') not in ('rescheduled','future') showrate_due,
 exists(select 1 from public.close_meeting_time_history h where h.meeting_id=m.meeting_id) rescheduled,
 b.cutoff data_as_of
 from public.close_meetings m cross join bounds b
 left join public.close_funnel_leads l on l.lead_id=m.lead_id
 left join setter s on s.meeting_id=m.meeting_id
 left join outcomes o on o.meeting_id=m.meeting_id
 left join planned pl on pl.x->>'meeting_id'=m.meeting_id
 left join lateral (
 select min(e.process_id) process_id,case when bool_or(e.event_type='cc2_sold' or exists(select 1 from public.close_process_events prior where prior.process_id=e.process_id and prior.removed_at is null and prior.event_type='cc2_agreed' and prior.occurred_at<m.starts_at and coalesce((prior.payload->>'applies_to_state')::boolean,true) and not coalesce((prior.payload->>'state_conflict')::boolean,false))) then 'cc2' else 'closer' end stage,
 case min(e.event_type) when 'closer_no_show' then 'no_show' when 'closer_cancelled' then 'cancelled' when 'closer_rescheduled' then 'rescheduled' else 'attended' end outcome
 from public.close_process_events e join public.close_sales_processes ep on ep.process_id=e.process_id and ep.lead_id=m.lead_id
 where e.removed_at is null and e.event_type in ('closer_completed','closer_sold','cc2_sold','cc2_agreed','closer_follow_up','closer_lost','closer_no_show','closer_cancelled','closer_rescheduled')
 and coalesce((e.payload->>'applies_to_state')::boolean,true) and not coalesce((e.payload->>'state_conflict')::boolean,false)
 and not exists(select 1 from public.close_process_meetings linked where linked.meeting_id=m.meeting_id and linked.removed_at is null and linked.process_id<>e.process_id)
 and e.occurred_at between m.starts_at and m.ends_at+interval '30 minutes' and e.occurred_at<=b.cutoff
 and not exists(select 1 from public.close_meetings other where other.lead_id=m.lead_id and other.meeting_id<>m.meeting_id and other.removed_at is null and e.occurred_at between other.starts_at and other.ends_at+interval '30 minutes')
 having count(distinct e.source_event_id)=1 and count(distinct e.process_id)=1
 ) proof on true
 left join lateral (select min(r.process_id) process_id from public.close_process_meetings r where r.meeting_id=m.meeting_id and r.removed_at is null having count(distinct r.process_id)=1) rel on true
 left join public.close_sales_processes p on p.process_id=coalesce(rel.process_id,proof.process_id) and p.retired_at is null
 where m.removed_at is null and (not m.excluded_purpose or pl.x->>'stage' in ('closer','cc2') or proof.stage is not null) and m.date_created<=b.cutoff
 and (m.starts_at at time zone 'Europe/Berlin')::date between b.start_date and b.end_date
 and not exists(select 1 from public.close_process_meetings r where r.meeting_id=m.meeting_id and r.removed_at is null and nullif(r.payload->>'superseded_by_meeting_id','') is not null)
)
select coalesce(jsonb_agg(to_jsonb(d) order by starts_at,meeting_id),'[]'::jsonb) from details d;
$$;
revoke all on function public.get_reporting_calendar_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_reporting_calendar_internal(text,date) to service_role;

create or replace function public.get_close_process_cohorts_internal(p_as_of date) returns jsonb
language sql stable security definer set search_path='' set jit=off as $$
 with rows as materialized (
 select data d,(data->>'first_meeting_at')::timestamptz start,
 (data->>'progression_setter_at')::timestamptz s,(data->>'progression_qualified_at')::timestamptz q,
 (data->>'progression_closer_at')::timestamptz c,(data->>'progression_cc2_at')::timestamptz cc2,
 (data->>'sold_at')::timestamptz sold,(data->>'decided_at')::timestamptz decided,
 (data->>'won_at')::timestamptz won
 from public.get_close_process_rows_internal(p_as_of)
 where (data->>'documented_booking')::boolean and data->>'first_meeting_at' is not null
 and (data->>'first_meeting_at')::timestamptz<=least(public.get_sales_data_as_of_internal(),((p_as_of+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond')
 ), stages as (
 select r.*,s>=start setter_ok,q>=s and s>=start qualified_ok,c>=q and q>=s and s>=start closer_ok,
 post.held_at cc2_held_at,post.decided_at cc2_decision_at,post.last_decision cc2_last_decision
 from rows r left join lateral (
 select min(e.occurred_at) filter(where e.event_type in ('closer_completed','closer_sold','cc2_sold','closer_follow_up','closer_lost')) held_at,
 min(e.occurred_at) filter(where e.event_type in ('closer_sold','cc2_sold','closer_lost')) decided_at,
 (array_agg(e.event_type order by e.occurred_at desc,e.source_event_id desc) filter(where e.event_type in ('closer_sold','cc2_sold','closer_lost')))[1] last_decision
 from public.close_process_events e where e.process_id=r.d->>'process_id' and e.removed_at is null
 and coalesce((e.payload->>'applies_to_state')::boolean,true) and not coalesce((e.payload->>'state_conflict')::boolean,false)
 and e.occurred_at>r.cc2 and e.occurred_at<=least(public.get_sales_data_as_of_internal(),((p_as_of+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond')
 ) post on true
 ), groups as (
 select d->>'source' source,d->>'owner' owner,d->>'booked_date' booked_date,
 count(*) booked_leads,count(*) filter(where setter_ok) setter_arrived,
 count(*) filter(where (d->>'closer_at')::timestamptz>=start) observed_closer,
 count(*) filter(where qualified_ok) closer_qualified,count(*) filter(where closer_ok) closer_arrived,
 count(*) filter(where closer_ok and decided>=c) decided_leads,count(*) filter(where closer_ok and sold>=c) sold_leads,
 count(*) filter(where closer_ok and (case when d->>'won_at_precision'='date' then (won at time zone 'Europe/Berlin')::date>=(c at time zone 'Europe/Berlin')::date else won>=c end)) new_customers,count(*) filter(where won is not null and (case when d->>'won_at_precision'='date' then (won at time zone 'Europe/Berlin')::date>=(start at time zone 'Europe/Berlin')::date else won>=start end)) observed_customers,
 count(*) filter(where d->>'closer_at' is not null and not coalesce(closer_ok,false)) unlinked_closer,
 count(*) filter(where (case when d->>'won_at_precision'='date' then (won at time zone 'Europe/Berlin')::date>=(start at time zone 'Europe/Berlin')::date else won>=start end) and not coalesce(closer_ok,false)) unlinked_customer,
 count(*) filter(where closer_ok and cc2>=c) cc2_agreed,
 count(*) filter(where closer_ok and cc2>=c and cc2_held_at is not null) cc2_held,
 count(*) filter(where closer_ok and cc2>=c and cc2_decision_at is not null) cc2_decided,
 count(*) filter(where closer_ok and cc2>=c and cc2_last_decision in ('closer_sold','cc2_sold')) cc2_sold,
 count(*) filter(where closer_ok and cc2>=c and cc2_last_decision='closer_lost') cc2_lost,
 count(*) filter(where closer_ok and cc2>=c and cc2_held_at is null and d->>'closer_result'='cc2_agreed') cc2_waiting,
 count(*) filter(where closer_ok and cc2>=c and cc2_held_at is not null and cc2_decision_at is null and d->>'state' not in ('cancelled','rescheduled','no_show','won','lost','disqualified')) cc2_open,
 count(*) filter(where closer_ok and cc2>=c and d->>'state'='cancelled') cc2_cancelled,
 count(*) filter(where closer_ok and cc2>=c and d->>'state'='no_show') cc2_no_show,
 count(*) filter(where closer_ok and cc2>=c and d->>'state'='rescheduled') cc2_rescheduled,
 count(*) filter(where d->>'closer_result'='cc2_sold' and cc2 is null) cc2_missing_agreement,
 count(*) filter(where closer_ok and sold>=c and cc2 is null and d->>'closer_result'='closer_sold') cc1_sold,
 count(*) filter(where closer_ok and decided>=c and cc2 is null and d->>'closer_result'='closer_lost') cc1_lost,
 count(*) filter(where not coalesce(setter_ok,false)) not_in_setter,
 count(*) filter(where not coalesce(setter_ok,false) and d->>'next_meeting_at' is not null) future,
 count(*) filter(where not coalesce(setter_ok,false) and d->>'next_meeting_at' is null and d->>'state'='no_show') no_show,
 count(*) filter(where not coalesce(setter_ok,false) and d->>'next_meeting_at' is null and d->>'state'='cancelled') cancelled,
 count(*) filter(where not coalesce(setter_ok,false) and d->>'next_meeting_at' is null and d->>'state'='rescheduled') rescheduled,
 count(*) filter(where not coalesce(setter_ok,false) and d->>'next_meeting_at' is null and d->>'state' not in ('no_show','cancelled','rescheduled')) pending,
 count(*) filter(where setter_ok and d->>'setter_result'='setter_qualified') qualified,
 count(*) filter(where setter_ok and d->>'setter_result'='setter_follow_up') followup,
 count(*) filter(where setter_ok and d->>'setter_result'='setter_disqualified') disqualified,
 count(*) filter(where setter_ok and coalesce(d->>'setter_result','') not in ('setter_qualified','setter_follow_up','setter_disqualified')) unrated
 from stages group by 1,2,3
 ) select coalesce(jsonb_agg(to_jsonb(g) order by booked_date,source,owner),'[]'::jsonb) from groups g;
$$;
revoke all on function public.get_close_process_cohorts_internal(date) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_antony_process_metrics_internal(p_period text, p_reference_date date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare result jsonb; cohorts jsonb; v_start date; v_end date; flow jsonb; timeline jsonb; lead_rows jsonb; origins jsonb;
begin
 if not exists(select 1 from public.close_reconciliation_state where resource='funnel') then return public.get_antony_process_metrics_legacy_internal(p_period,p_reference_date);end if;
 result:=public.get_antony_process_base_internal(p_period,p_reference_date);
 v_start:=(result->'period'->>'start')::date;v_end:=(result->'period'->>'end')::date;
 cohorts:=public.get_close_process_cohorts_internal((public.get_sales_data_as_of_internal() at time zone 'Europe/Berlin')::date);
 with p as materialized(select data d from public.get_close_process_rows_internal(p_reference_date)),
 setter as (select e.*,p.d from public.close_process_events e join p on p.d->>'process_id'=e.process_id
  where e.removed_at is null and e.event_type in ('setter_completed','setter_qualified','setter_follow_up','setter_disqualified')
  and (e.occurred_at at time zone 'Europe/Berlin')::date between v_start and v_end and e.occurred_at<=public.get_sales_data_as_of_internal()),
 qualifications as (select ((d->>'qualified_at')::timestamptz at time zone 'Europe/Berlin')::date date,
 extract(hour from (d->>'qualified_at')::timestamptz at time zone 'Europe/Berlin')::integer hour_bucket,count(*) total
 from p where d->>'qualified_at' is not null group by 1,2)
 select jsonb_build_object('new_processes',(select coalesce(sum((c->>'booked_leads')::integer),0) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),
 'carried_in',(select count(distinct process_id) from setter where (d->>'booked_date')::date<v_start),
 'first_qualified',(select count(*) from p where ((d->>'qualified_at')::timestamptz at time zone 'Europe/Berlin')::date between v_start and v_end),
 'repeat_setter_calls',(select count(*) from setter where occurred_at>(d->>'setter_at')::timestamptz),
 'unlinked_setter_calls',(select count(*) from setter where d->>'booked_date' is null),
 'cohort_basis','first_scheduled_meeting'),
 (select coalesce(jsonb_agg(j||jsonb_build_object('first_qualified',coalesce(q.total,0)) order by j->>'date',j->>'hour_bucket'),'[]'::jsonb)
 from jsonb_array_elements(coalesce(result->'timeline','[]')) j left join qualifications q
 on q.date=(j->>'date')::date and q.hour_bucket=(j->>'hour_bucket')::integer)
,
 (select coalesce(jsonb_agg(jsonb_build_object(
 'lead_id',d->>'lead_id','display_name',(select l.display_name from public.close_funnel_leads l where l.lead_id=d->>'lead_id'),'process_id',d->>'process_id','source',d->>'source',
 'owner',public.get_close_opener_internal(d->>'lead_id'),'first_meeting_at',d->>'first_meeting_at',
 'setter_result',d->>'setter_result','state',d->>'state','stage',d->>'stage',
 'setter_performed_by',(select case max(e.setter_id) when 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'Antony' when 'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy' then 'Michael' when 'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4' then 'Felix' else null end from public.close_funnel_events e where e.lead_id=d->>'lead_id' and e.is_current and e.withdrawn_at is null and e.event_type='setter_activity' and e.occurred_at=(d->>'setter_at')::timestamptz having count(distinct e.setter_id)=1),
 'setter_at',d->>'setter_at','closer_at',d->>'closer_at','cc2_at',d->>'cc2_at','won_at',d->>'won_at'
 ) order by d->>'first_meeting_at',d->>'process_id'),'[]'::jsonb) from (select data d from public.get_close_process_rows_internal((public.get_sales_data_as_of_internal() at time zone 'Europe/Berlin')::date)) current_processes
 where (d->>'documented_booking')::boolean
 and (d->>'booked_date')::date between v_start and v_end
 and (d->>'first_meeting_at')::timestamptz<=least(public.get_sales_data_as_of_internal(),((v_end+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond'))
 into flow,timeline,lead_rows;
 origins:=public.get_close_process_activity_origins_internal(p_period,p_reference_date);
 return result||origins||jsonb_build_object('month_planning',jsonb_build_object('first_meetings',(
 select count(*) from public.get_close_process_rows_internal((public.get_sales_data_as_of_internal() at time zone 'Europe/Berlin')::date) rp
 where (rp.data->>'documented_booking')::boolean
 and (rp.data->>'first_meeting_at')::timestamptz>public.get_sales_data_as_of_internal()
 and date_trunc('month',(rp.data->>'first_meeting_at')::timestamptz at time zone 'Europe/Berlin')=date_trunc('month',p_reference_date::timestamp)
 and exists(select 1 from public.close_meetings m where m.lead_id=rp.data->>'lead_id' and m.starts_at=(rp.data->>'first_meeting_at')::timestamptz and m.status='upcoming' and m.removed_at is null and not m.excluded_purpose)
 )))||jsonb_build_object('period_pipelines',public.get_period_pipelines_internal(p_period,p_reference_date,origins->'activity_by_origin'))||jsonb_build_object('cohort_data_as_of',public.get_sales_data_as_of_internal(),'calendar_rows',public.get_reporting_calendar_internal(p_period,p_reference_date),'lead_quality_rows',lead_rows,'owner_labels',public.get_close_opener_labels_internal(),'attribution_basis','close_lead_opener','reporting_version','2026-09-08.persistent-process','flow',flow,'timeline',timeline,
 'coverage',(result->'coverage')||jsonb_build_object('history_complete',true),
 'setter_attendance',(result->'setter_attendance')||jsonb_build_object('by_source',result->'setter_attendance'->'by_source'),
 'cohort_history',cohorts,'booking_cohort_history',cohorts,
 'funnel_by_source',coalesce((select jsonb_agg(c) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),'[]'::jsonb),
 'booking_cohort',coalesce((select jsonb_agg(c) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),'[]'::jsonb));
end;$function$;



revoke all on function public.get_antony_process_metrics_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_antony_process_metrics_internal(text,date) to service_role;



CREATE OR REPLACE FUNCTION public.get_antony_report(p_period text, p_reference_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
 SET statement_timeout TO '20s'
AS $function$
declare c jsonb;p jsonb;mc jsonb;mp jsonb;calendar jsonb;
begin
 if auth.uid() is null or not public.has_antony_access() then raise exception 'Nicht berechtigt' using errcode='42501';end if;
 if p_period is null or p_reference_date is null or p_period not in ('day','week','month') then raise exception 'Invalid period' using errcode='22023';end if;
 select to_jsonb(x) into c from public.get_antony_closing_metrics_internal(p_period,p_reference_date) x;
 p:=public.get_antony_process_metrics_internal(p_period,p_reference_date);
 if p_period='month' then mc:=c;mp:=p;else
  select to_jsonb(x) into mc from public.get_antony_closing_metrics_internal('month',p_reference_date) x;
  mp:=public.get_antony_process_metrics_internal('month',p_reference_date);
 end if;
 calendar:=public.get_antony_pipeline_snapshot(p_reference_date);
 calendar:=calendar||jsonb_build_object('scheduled_meetings',(select coalesce(jsonb_agg(x||jsonb_build_object('display_name',l.display_name) order by x->>'starts_at'),'[]'::jsonb) from jsonb_array_elements(calendar->'scheduled_meetings') x left join public.close_funnel_leads l on l.lead_id=x->>'lead_id'));
 return jsonb_build_object('closing',c,'process',p,'data_as_of',public.get_sales_data_as_of_internal(),
 'performance',(select coalesce(jsonb_agg(to_jsonb(x) order by x.bucket_index),'[]'::jsonb) from public.get_antony_performance_series_internal(p_period,p_reference_date) x),
 'pipeline',calendar,
 'quarter',null,
 'planner',jsonb_build_object('closing',mc,'process',mp,'appointment_by_owner',(select coalesce(jsonb_object_agg(x.slug,x.n),'{}'::jsonb) from (select public.get_close_opener_internal(m.lead_id) slug,count(*) n
 from public.get_setter_meetings_internal(date_trunc('month',p_reference_date::timestamp)::date,p_reference_date,true) m
 left join public.close_funnel_leads l on l.lead_id=m.lead_id group by 1) x)));
end;$function$;


commit;
