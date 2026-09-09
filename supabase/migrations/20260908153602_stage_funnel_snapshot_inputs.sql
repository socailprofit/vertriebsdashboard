begin;
-- Parse each authoritative snapshot once into private typed transaction-local
-- relations, with indexes/statistics for joins and anti-joins. SECURITY DEFINER
-- remains service-role-only; every permanent relation stays schema-qualified.
-- Never reuse a caller-created temp relation: drop/recreate, ON COMMIT DROP.
-- Keep all existing scope, identity, attribution, advisory-lock and stale guards.
create or replace function public.reconcile_close_custom_and_won(
  p_start_date date, p_end_date date, p_snapshot_started_at timestamptz,
  p_raw jsonb, p_facts jsonb, p_opportunities jsonb, p_leads jsonb
) returns jsonb
language plpgsql security definer set search_path = '' set jit=off as $$
declare
  v_floor date := (date_trunc('month', now() at time zone 'Europe/Berlin') - interval '2 months')::date;
  v_previous timestamptz;
  v_deleted_custom integer;
  v_deleted_won integer;
begin
  if p_start_date is null or p_end_date is null or p_start_date <> v_floor
    or p_end_date < p_start_date or p_end_date <> (now() at time zone 'Europe/Berlin')::date
    or p_snapshot_started_at is null or p_snapshot_started_at > now() + interval '1 minute'
    or p_snapshot_started_at < now() - interval '30 minutes' then
    raise exception 'Invalid reconciliation window';
  end if;
  if jsonb_typeof(p_raw) is distinct from 'array' or jsonb_typeof(p_facts) is distinct from 'array'
    or jsonb_typeof(p_opportunities) is distinct from 'array' or jsonb_typeof(p_leads) is distinct from 'array'
    or jsonb_array_length(p_raw)>20000 or jsonb_array_length(p_facts)>20000
    or jsonb_array_length(p_opportunities)>20000 or jsonb_array_length(p_leads)>20000 then raise exception 'Invalid reconciliation payload'; end if;
 drop table if exists pg_temp._close_cw_raw;
 create temporary table _close_cw_raw on commit drop as select * from jsonb_populate_recordset(null::public.close_raw_activities,p_raw);
 create index on pg_temp._close_cw_raw (close_activity_id);
 analyze pg_temp._close_cw_raw;
 drop table if exists pg_temp._close_cw_facts;
 create temporary table _close_cw_facts on commit drop as select * from jsonb_populate_recordset(null::public.close_activity_facts,p_facts);
 create index on pg_temp._close_cw_facts (source_activity_id);
 create index on pg_temp._close_cw_facts (lead_id);
 analyze pg_temp._close_cw_facts;
 drop table if exists pg_temp._close_cw_won;
 create temporary table _close_cw_won on commit drop as select * from jsonb_populate_recordset(null::public.close_opportunity_facts,p_opportunities);
 create index on pg_temp._close_cw_won (lead_id);
 analyze pg_temp._close_cw_won;
 drop table if exists pg_temp._close_cw_leads;
 create temporary table _close_cw_leads on commit drop as select * from jsonb_populate_recordset(null::public.close_lead_reporting,p_leads);
 create index on pg_temp._close_cw_leads (lead_id);
 analyze pg_temp._close_cw_leads;
  if exists (
    select 1 from pg_temp._close_cw_raw r
    where r.activity_type is distinct from 'custom_activity' or r.occurred_at is null
      or (r.occurred_at at time zone 'Europe/Berlin')::date not between p_start_date and p_end_date
  ) or exists (
    select 1 from pg_temp._close_cw_facts f
    where f.source_type is distinct from 'custom_activity' or f.metric_date is null
      or f.metric_date not between p_start_date and p_end_date
      or f.metric_date is distinct from (f.occurred_at at time zone 'Europe/Berlin')::date
      or not exists (select 1 from pg_temp._close_cw_raw r where r.close_activity_id=f.source_activity_id)
  ) or exists (
    select 1 from pg_temp._close_cw_won o
    where o.won_date is null or o.won_date not between p_start_date and p_end_date
      or o.won_date is distinct from (o.won_at at time zone 'Europe/Berlin')::date
      or o.status_id not in ('stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL','stat_JogyhmNFRLb0ucUfEXPYRJTpVeRXJFix9GB0aVoBfz0')
  ) then raise exception 'Reconciliation rows outside declared scope'; end if;

  if exists (
    select 1 from (
      select f.lead_id as id from pg_temp._close_cw_facts f where (f.setter_calls)::int=1 or (f.appointments)::int=1
      union select o.lead_id from pg_temp._close_cw_won o
    ) required where not exists (select 1 from pg_temp._close_cw_leads l where l.lead_id=required.id)
  ) or exists (
    select 1 from pg_temp._close_cw_leads l where l.lead_id is null
      or not exists(select 1 from pg_temp._close_cw_facts f where f.lead_id=l.lead_id and ((f.setter_calls)::int=1 or (f.appointments)::int=1))
        and not exists(select 1 from pg_temp._close_cw_won o where o.lead_id=l.lead_id)
  ) then raise exception 'Incomplete lead attribution snapshot'; end if;
  perform pg_advisory_xact_lock(71092026);
  select snapshot_started_at into v_previous from public.close_reconciliation_state where resource='custom_and_won';
  if v_previous is not null and p_snapshot_started_at <= v_previous then
    raise exception 'Stale reconciliation snapshot';
  end if;

  delete from public.close_activity_facts where source_type='custom_activity' and metric_date between p_start_date and p_end_date;
  get diagnostics v_deleted_custom=row_count;
  delete from public.close_raw_activities where activity_type='custom_activity'
    and (occurred_at at time zone 'Europe/Berlin')::date between p_start_date and p_end_date;
  delete from public.close_opportunity_facts where won_date between p_start_date and p_end_date;
  get diagnostics v_deleted_won=row_count;

  insert into public.close_raw_activities(close_activity_id,activity_type,close_user_id,lead_id,occurred_at,payload)
  select close_activity_id,activity_type,close_user_id,lead_id,occurred_at,payload
  from pg_temp._close_cw_raw
  on conflict(close_activity_id) do update set activity_type=excluded.activity_type,
    close_user_id=excluded.close_user_id,lead_id=excluded.lead_id,occurred_at=excluded.occurred_at,payload=excluded.payload,ingested_at=now();
  insert into public.close_activity_facts
  select f.* from pg_temp._close_cw_facts f
  on conflict(source_activity_id) do update set
    source_type=excluded.source_type,close_user_id=excluded.close_user_id,lead_id=excluded.lead_id,
    occurred_at=excluded.occurred_at,metric_date=excluded.metric_date,metric_hour=excluded.metric_hour,
    calls_gross=excluded.calls_gross,calls_net=excluded.calls_net,talk_seconds=excluded.talk_seconds,
    gatekeeper_contacts=excluded.gatekeeper_contacts,connected_calls=excluded.connected_calls,
    direct_decision_maker_calls=excluded.direct_decision_maker_calls,decision_maker_contacts=excluded.decision_maker_contacts,
    appointments=excluded.appointments,setter_calls=excluded.setter_calls,setter_successes=excluded.setter_successes,
    closer_calls=excluded.closer_calls,closer_second_calls=excluded.closer_second_calls,closer_decided_calls=excluded.closer_decided_calls,
    closer_sales=excluded.closer_sales,no_shows=excluded.no_shows,cancellations=excluded.cancellations,
    rescheduled_appointments=excluded.rescheduled_appointments,product_focus=excluded.product_focus,
    mapping_version=excluded.mapping_version,mapped_at=excluded.mapped_at;
  insert into public.close_opportunity_facts(opportunity_id,lead_id,opener_close_user_id,setter_close_user_id,closer_close_user_id,won_at,won_date,status_id,value_cents,value_period,mapping_version,payload)
  select opportunity_id,lead_id,opener_close_user_id,setter_close_user_id,closer_close_user_id,won_at,won_date,status_id,value_cents,value_period,mapping_version,payload
  from pg_temp._close_cw_won
  on conflict(opportunity_id) do update set lead_id=excluded.lead_id,opener_close_user_id=excluded.opener_close_user_id,
    setter_close_user_id=excluded.setter_close_user_id,closer_close_user_id=excluded.closer_close_user_id,
    won_at=excluded.won_at,won_date=excluded.won_date,status_id=excluded.status_id,value_cents=excluded.value_cents,
    value_period=excluded.value_period,mapping_version=excluded.mapping_version,payload=excluded.payload,ingested_at=now();

  delete from public.close_lead_reporting where lead_id is not null;
  insert into public.close_lead_reporting(lead_id,opener_close_user_id,lead_source)
    select lead_id,opener_close_user_id,lead_source from pg_temp._close_cw_leads;
  perform public.recalculate_daily_sales_metrics(p_start_date,p_end_date);
  -- Refresh only custom-activity archive fields, preserving calls/newsletters.
  update public.monthly_kpi_snapshots s set
    gatekeeper_contacts=t.gatekeeper_contacts, connected_calls=t.connected_calls,
    direct_decision_maker_calls=t.direct_decision_maker_calls,decision_maker_contacts=t.decision_maker_contacts,
    appointments=t.appointments
  from (select date_trunc('month',m.metric_date)::date month_start,
    sum(m.gatekeeper_contacts) gatekeeper_contacts,sum(m.connected_calls) connected_calls,
    sum(m.direct_decision_maker_calls) direct_decision_maker_calls,
    sum(m.decision_maker_contacts) decision_maker_contacts,sum(m.appointments) appointments
    from public.daily_sales_metrics m
    where m.metric_date >= p_start_date and m.metric_date <= p_end_date
    group by 1) t
  where s.month_start=t.month_start and s.month_start >= p_start_date
    and (s.month_start+interval '1 month - 1 day')::date <= p_end_date;
  insert into public.close_reconciliation_state values('custom_and_won',p_snapshot_started_at)
    on conflict(resource) do update set snapshot_started_at=excluded.snapshot_started_at;
  return jsonb_build_object('custom_before',v_deleted_custom,'custom_after',jsonb_array_length(p_facts),
    'won_before',v_deleted_won,'won_after',jsonb_array_length(p_opportunities));
end;
$$;

create or replace function public.reconcile_close_calendar_snapshot(
 p_start_date date,p_end_date date,p_snapshot_started_at timestamptz,
 p_raw jsonb,p_facts jsonb,p_opportunities jsonb,p_leads jsonb,p_bookings jsonb,
 p_meetings jsonb,p_calendar_leads jsonb
) returns jsonb language plpgsql security definer set search_path='' set jit=off as $$
declare v_result jsonb;
begin
 if jsonb_typeof(p_meetings) is distinct from 'array' or jsonb_array_length(p_meetings)>20000
  or jsonb_typeof(p_calendar_leads) is distinct from 'array' or jsonb_array_length(p_calendar_leads)>20000
 then raise exception 'Invalid calendar snapshot';end if;
 drop table if exists pg_temp._close_cal_meetings;
 create temporary table _close_cal_meetings on commit drop as select * from jsonb_populate_recordset(null::public.close_meetings,p_meetings);
 create index on pg_temp._close_cal_meetings (meeting_id);
 create index on pg_temp._close_cal_meetings (booking_activity_id);
 create index on pg_temp._close_cal_meetings (lead_id);
 analyze pg_temp._close_cal_meetings;
 drop table if exists pg_temp._close_cal_bookings;
 create temporary table _close_cal_bookings on commit drop as select * from jsonb_populate_recordset(null::public.close_booking_history,p_bookings);
 create index on pg_temp._close_cal_bookings (source_activity_id);
 analyze pg_temp._close_cal_bookings;
 drop table if exists pg_temp._close_cal_leads;
 create temporary table _close_cal_leads on commit drop as select * from jsonb_populate_recordset(null::public.close_lead_reporting,p_calendar_leads);
 create index on pg_temp._close_cal_leads (lead_id);
 analyze pg_temp._close_cal_leads;
 if exists(select 1 from pg_temp._close_cal_meetings m
  where m.meeting_id is null or m.starts_at is null or m.ends_at is null or m.date_created is null or m.date_updated is null
   or m.ends_at<m.starts_at or m.date_created>p_snapshot_started_at or m.excluded_purpose is null
   or jsonb_typeof(m.participant_ids) is distinct from 'array'
   or (m.booking_activity_id is null)<>(m.booking_owner_id is null)
   or (m.booking_activity_id is not null and (m.excluded_purpose or m.owner_id is null or not exists(
    select 1 from pg_temp._close_cal_bookings b where b.source_activity_id=m.booking_activity_id
     and b.lead_id=m.lead_id and b.close_user_id=m.booking_owner_id
     and (b.occurred_at)::timestamptz<=m.starts_at)))
 ) or exists(select 1 from pg_temp._close_cal_meetings m group by m.meeting_id having count(*)>1)
 or exists(select 1 from pg_temp._close_cal_meetings m where m.booking_activity_id is not null group by m.booking_activity_id having count(*)>1)
 then raise exception 'Invalid calendar rows';end if;
 if exists(select 1 from pg_temp._close_cal_leads l where l.lead_id is null or not exists(
  select 1 from pg_temp._close_cal_meetings m where m.lead_id=l.lead_id and m.booking_activity_id is not null
   and ((m.starts_at)::timestamptz at time zone 'Europe/Berlin')::date>=p_start_date))
 or exists(select 1 from pg_temp._close_cal_meetings m where m.booking_activity_id is not null
  and ((m.starts_at)::timestamptz at time zone 'Europe/Berlin')::date>=p_start_date
  and not exists(select 1 from pg_temp._close_cal_leads l where l.lead_id=m.lead_id))
 then raise exception 'Incomplete calendar attribution';end if;
 -- Existing validation and advisory lock cover custom facts, Won, bookings,
 -- their metadata, the calendar and the observation cutoff in ONE transaction.
 v_result:=public.reconcile_close_sales_snapshot(p_start_date,p_end_date,p_snapshot_started_at,
  p_raw,p_facts,p_opportunities,p_leads,p_bookings);
 if exists(select 1 from jsonb_array_elements(p_facts) f where (f->>'occurred_at')::timestamptz>p_snapshot_started_at)
 then raise exception 'Future performance in snapshot';end if;
 -- Unlink first so a rescheduled/recreated record can acquire its source link
 -- without violating the one-to-one identity constraint. No status deduplication.
 update public.close_meetings m set booking_activity_id=null,booking_owner_id=null
  where m.booking_activity_id is not null and not exists(select 1 from pg_temp._close_cal_meetings n
   where n.meeting_id=m.meeting_id and n.booking_activity_id=m.booking_activity_id and n.booking_owner_id=m.booking_owner_id);
 update public.close_meetings m set removed_at=p_snapshot_started_at
  where removed_at is null and not exists(select 1 from pg_temp._close_cal_meetings x where x.meeting_id=m.meeting_id);
 insert into public.close_meetings(meeting_id,lead_id,contact_id,owner_id,starts_at,ends_at,date_created,date_updated,
  status,participant_ids,calendar_event_uids,excluded_purpose,booking_activity_id,booking_owner_id,last_seen_at,removed_at)
 select meeting_id,lead_id,contact_id,owner_id,starts_at,ends_at,date_created,date_updated,
  status,participant_ids,calendar_event_uids,excluded_purpose,booking_activity_id,booking_owner_id,p_snapshot_started_at,null
 from pg_temp._close_cal_meetings
 on conflict(meeting_id) do update set lead_id=excluded.lead_id,contact_id=excluded.contact_id,owner_id=excluded.owner_id,
  starts_at=excluded.starts_at,ends_at=excluded.ends_at,date_created=excluded.date_created,date_updated=excluded.date_updated,
  status=excluded.status,participant_ids=excluded.participant_ids,calendar_event_uids=excluded.calendar_event_uids,
  excluded_purpose=excluded.excluded_purpose,booking_activity_id=excluded.booking_activity_id,booking_owner_id=excluded.booking_owner_id,
  last_seen_at=excluded.last_seen_at,removed_at=null;
 insert into public.close_lead_reporting(lead_id,opener_close_user_id,lead_source)
 select lead_id,opener_close_user_id,lead_source from pg_temp._close_cal_leads
 on conflict(lead_id) do update set opener_close_user_id=excluded.opener_close_user_id,lead_source=excluded.lead_source;
 insert into public.close_reconciliation_state values('calendar',p_snapshot_started_at)
 on conflict(resource) do update set snapshot_started_at=excluded.snapshot_started_at;
 return v_result||jsonb_build_object('meetings',jsonb_array_length(p_meetings),'data_as_of',p_snapshot_started_at);
end;$$;

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
 insert into public.close_funnel_leads(lead_id,lead_source,opener_close_user_id,setter_id,closer_id,status_id,source_updated_at,last_seen_at)
 select lead_id,lead_source,opener_close_user_id,setter_id,closer_id,status_id,source_updated_at,p_snapshot_started_at
 from pg_temp._close_funnel_leads
 on conflict(lead_id) do update set lead_source=excluded.lead_source,opener_close_user_id=excluded.opener_close_user_id,
 setter_id=excluded.setter_id,closer_id=excluded.closer_id,status_id=excluded.status_id,source_updated_at=excluded.source_updated_at,last_seen_at=excluded.last_seen_at;
 insert into public.close_lead_reporting(lead_id,lead_source,opener_close_user_id)
 select lead_id,lead_source,opener_close_user_id from public.close_funnel_leads
 on conflict(lead_id) do update set lead_source=excluded.lead_source,opener_close_user_id=excluded.opener_close_user_id;
 insert into public.close_reconciliation_state values('funnel',p_snapshot_started_at)
 on conflict(resource) do update set snapshot_started_at=excluded.snapshot_started_at;
 raise log 'close_funnel_snapshot phase=complete elapsed_ms=%',round(extract(epoch from clock_timestamp()-v_started_at)*1000);
 return v_result||jsonb_build_object('funnel_events',jsonb_array_length(p_events),'processes',jsonb_array_length(p_processes));
end;$$;

revoke all on function public.reconcile_close_custom_and_won(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_close_custom_and_won(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.reconcile_close_calendar_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_close_calendar_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.reconcile_close_funnel_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_close_funnel_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz) to service_role;
commit;
