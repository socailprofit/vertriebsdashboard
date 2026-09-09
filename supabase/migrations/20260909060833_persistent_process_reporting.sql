begin;

-- Supplier credit is independent from the actor who performed a call.
-- Explicit source rules can be set without changing historical CRM activity.
create table public.close_supplier_rules(source text primary key,supplier_key text not null);
insert into public.close_supplier_rules(source,supplier_key) values
 ('LinkedIn','linkedin'),('Inbound LinkedIn Ads','linkedin'),('LinkedIn Cold Calls','linkedin'),('LinkedIn Follow Up','linkedin');
alter table public.close_supplier_rules enable row level security;
revoke all on public.close_supplier_rules from public,anon,authenticated;
grant all on public.close_supplier_rules to service_role;
create function public.get_close_supplier_internal(p_source text,p_owner text) returns text
language sql stable security definer set search_path='' set jit=off as $$
 select coalesce((select r.supplier_key from public.close_supplier_rules r where r.source=p_source),
 (select p.slug from public.sales_people p where p.close_user_id=p_owner),
 case when p_owner='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' when p_owner is null then 'unassigned' else 'other' end);
$$;
revoke all on function public.get_close_supplier_internal(text,text) from public,anon,authenticated;

create function public.apply_close_supplier_rules_internal(p_rows jsonb) returns jsonb
language sql stable security definer set search_path='' set jit=off as $$
 select coalesce(jsonb_agg(r||jsonb_build_object('owner',coalesce(s.supplier_key,r->>'owner'))),'[]'::jsonb)
 from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r
 left join public.close_supplier_rules s on s.source=r->>'source';
$$;
revoke all on function public.apply_close_supplier_rules_internal(jsonb) from public,anon,authenticated;

create or replace function public.get_setter_meeting_outcomes_internal(p_start_date date,p_end_date date)
returns table(meeting_id text,lead_id text,starts_at timestamptz,source text,owner text,outcome text)
language sql stable security definer set search_path='' set jit=off as $$
 with evidence as materialized(select * from public.get_setter_meeting_evidence_internal(p_end_date))
 select m.meeting_id,m.lead_id,m.starts_at,coalesce(l.lead_source,'Nicht zugeordnet'),
 public.get_close_supplier_internal(l.lead_source,m.booking_owner_id),
 case when m.starts_at>public.get_sales_data_as_of_internal() then 'future'
 when exists(select 1 from evidence e where e.meeting_id=m.meeting_id and e.kind='attended') then 'attended'
 when s.kinds>1 then 'unknown'
 when s.kind is not null then s.kind
 when m.status in ('canceled','declined-by-lead','declined-by-org') then 'cancelled'
 else 'unknown' end
 from public.get_setter_meetings_internal(p_start_date,p_end_date,false) m
 left join public.close_lead_reporting l on l.lead_id=m.lead_id
 left join public.sales_people sp on sp.close_user_id=m.booking_owner_id
 left join lateral (select count(distinct e.kind) kinds,max(e.kind) kind from evidence e where e.meeting_id=m.meeting_id
  and e.occurred_at=(select max(x.occurred_at) from evidence x where x.meeting_id=m.meeting_id and x.kind<>'attended')
  and e.kind<>'attended') s on true;
$$;
revoke all on function public.get_setter_meeting_outcomes_internal(date,date) from public,anon,authenticated;
grant execute on function public.get_setter_meeting_outcomes_internal(date,date) to service_role;


-- Full observed acquisition history survives the three-month activity cleanup.
-- Date precision is retained: a date-only Won has no asserted wall-clock time.
create or replace function public.get_customer_acquisitions_internal(p_as_of date)
returns setof public.close_opportunity_facts language sql stable security definer set search_path='' set jit=off as $$
 with durable as (
 select r.* from public.close_funnel_events e cross join lateral jsonb_populate_record(null::public.close_opportunity_facts,
 jsonb_build_object('opportunity_id',e.source_event_id,'lead_id',e.lead_id,'opener_close_user_id',e.payload->>'opener_id',
 'setter_close_user_id',e.setter_id,'closer_close_user_id',e.closer_id,'status_id',e.new_status,
 'won_at',e.payload->>'won_at','won_date',e.payload->>'won_date','value_cents',e.payload->'value_cents',
 'value_period',e.payload->>'value_period','mapping_version','2026-09-08.persistent-process',
 'payload',jsonb_build_object('date_won',e.payload->>'date_won','custom.cf_wlmXj1eeFF6P9Zoz49WNuFULPX0jsKRyArR8O4PX6ZQ',e.payload->>'deal_type'))) r
 where e.source_kind='opportunity' and e.is_current and e.withdrawn_at is null and e.payload->>'acquisition'='true'
 ), known as (
 select * from durable union all
 select o.* from public.close_opportunity_facts o where not exists(select 1 from public.close_reconciliation_state where resource='funnel')
 ), valid as (
 select * from known o where o.status_id='stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL'
 and coalesce(o.payload->>'custom.cf_wlmXj1eeFF6P9Zoz49WNuFULPX0jsKRyArR8O4PX6ZQ','Neukunde')='Neukunde'
 and o.won_date<=least(p_as_of,(public.get_sales_data_as_of_internal() at time zone 'Europe/Berlin')::date)
 and (o.payload->>'date_won' !~ 'T' or o.payload->>'date_won' is null or o.won_at<=public.get_sales_data_as_of_internal()))
 select distinct on (lead_id) * from valid order by lead_id,won_date,won_at,opportunity_id;
$$;

-- Reconstruct business progress up to the selected day, not only from events
-- still inside the raw-activity retention window. Calendar plans stay separate.
create function public.get_close_process_rows_internal(p_as_of date)
returns table(data jsonb) language sql stable security definer set search_path='' set jit=off as $$
 with cutoff as (select least(public.get_sales_data_as_of_internal(),((p_as_of+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond') at),
 calendars as materialized(select * from public.get_setter_meetings_internal('0001-01-01','9999-12-31',false)),
 events as materialized (
 select e.*,dense_rank() over(partition by e.process_id order by e.occurred_at desc) event_rank from public.close_process_events e where e.removed_at is null
 and e.occurred_at<=(select at from cutoff) and (coalesce((e.payload->>'applies_to_state')::boolean,true) or coalesce((e.payload->>'state_conflict')::boolean,false))
 and e.event_type not in ('booking','status_changed')
 ), milestones as (
 select process_id,
 min(occurred_at) filter(where event_type in ('setter_completed','setter_qualified','setter_follow_up','setter_disqualified') and (coalesce((payload->>'applies_to_state')::boolean,true) or coalesce((payload->>'state_conflict')::boolean,false))) setter_at,
 min(occurred_at) filter(where event_type='setter_qualified' and coalesce((payload->>'applies_to_state')::boolean,true) and not coalesce((payload->>'state_conflict')::boolean,false)) qualified_at,
 min(occurred_at) filter(where event_type in ('closer_completed','closer_sold','cc2_sold','cc2_agreed','closer_follow_up','closer_lost') and (coalesce((payload->>'applies_to_state')::boolean,true) or coalesce((payload->>'state_conflict')::boolean,false))) closer_at,
 min(occurred_at) filter(where event_type='cc2_agreed' and coalesce((payload->>'applies_to_state')::boolean,true) and not coalesce((payload->>'state_conflict')::boolean,false)) cc2_at,
 min(occurred_at) filter(where event_type='customer_won' and coalesce((payload->>'applies_to_state')::boolean,true) and not coalesce((payload->>'state_conflict')::boolean,false)) won_at,
 min(occurred_at) filter(where event_type in ('closer_sold','cc2_sold') and coalesce((payload->>'applies_to_state')::boolean,true) and not coalesce((payload->>'state_conflict')::boolean,false)) sold_at,
 min(occurred_at) filter(where event_type in ('closer_lost','closer_sold','cc2_sold') and coalesce((payload->>'applies_to_state')::boolean,true) and not coalesce((payload->>'state_conflict')::boolean,false)) decided_at,
 min(occurred_at) filter(where event_type in ('setter_disqualified','closer_lost','customer_won') and coalesce((payload->>'applies_to_state')::boolean,true) and not coalesce((payload->>'state_conflict')::boolean,false)) closed_at,
 (array_agg(payload->>'occurred_at_precision' order by occurred_at) filter(where event_type='customer_won'))[1] won_precision,
 max(occurred_at) status_since,
 count(distinct event_type) filter(where event_rank=1) latest_outcome_count,
 bool_or(coalesce((payload->>'state_conflict')::boolean,false)) filter(where event_rank=1) latest_conflict,
 (array_agg(event_type order by occurred_at desc,(event_type='customer_won') desc,source_event_id desc))[1] latest,
 (array_agg(event_type order by occurred_at desc,source_event_id desc) filter(where event_type in ('setter_completed','setter_qualified','setter_follow_up','setter_disqualified')))[1] setter_result,
 (array_agg(event_type order by occurred_at desc,source_event_id desc) filter(where event_type in ('closer_completed','closer_sold','cc2_sold','cc2_agreed','closer_follow_up','closer_lost','closer_cancelled','closer_rescheduled','closer_no_show')))[1] closer_result
 from events group by process_id
 ), rows as (
 select p.*,l.lead_source,l.status_id current_lead_status,m.*,
 ps.at progression_setter_at,pq.at progression_qualified_at,pc.at progression_closer_at,pcc.at progression_cc2_at,
 (p.payload->>'first_meeting_at')::timestamptz booked_at,
 (p.payload->>'opened_at')::timestamptz opened_at,
 next.starts_at next_meeting_at,next.meeting_id next_meeting_id,
 case when m.won_at is not null then 'customer'
  when m.latest in ('setter_completed','setter_follow_up','setter_cancelled','setter_rescheduled','setter_no_show','setter_disqualified') then 'setter'
  when m.latest in ('cc2_agreed','cc2_sold') then 'cc2'
  when m.latest='setter_qualified' then 'closer'
  when m.latest like 'closer_%' then case when m.cc2_at is not null then 'cc2' else 'closer' end
  else 'setter' end stage,
 case when m.won_at is not null then 'won'
  when m.latest_outcome_count>1 or m.latest_conflict then 'unclear'
  when m.latest='setter_disqualified' then 'disqualified' when m.latest='closer_lost' then 'lost'
  when m.latest in ('closer_sold','cc2_sold') then 'sold_pending_won'
  when m.latest in ('setter_follow_up','closer_follow_up') then 'follow_up'
  when m.latest in ('setter_cancelled','closer_cancelled') then 'cancelled'
  when m.latest in ('setter_rescheduled','closer_rescheduled') then 'rescheduled'
  when m.latest in ('setter_no_show','closer_no_show') then 'no_show'
  when m.latest in ('setter_qualified','cc2_agreed') then 'scheduled'
  when m.latest is null then case when next.starts_at is not null then 'scheduled' else 'awaiting_result' end
  else 'awaiting_result' end state
 from public.close_sales_processes p
 left join public.close_funnel_leads l on l.lead_id=p.lead_id
 left join milestones m on m.process_id=p.process_id
 left join lateral (select min(e.occurred_at) at from events e where e.process_id=p.process_id
  and e.event_type in ('setter_completed','setter_qualified','setter_follow_up','setter_disqualified')
  and e.occurred_at>=(p.payload->>'first_meeting_at')::timestamptz) ps on true
 left join lateral (select min(e.occurred_at) at from events e where e.process_id=p.process_id and not coalesce((e.payload->>'state_conflict')::boolean,false) and e.event_type='setter_qualified'
  and e.occurred_at>=ps.at) pq on true
 left join lateral (select min(e.occurred_at) at from events e where e.process_id=p.process_id and not coalesce((e.payload->>'state_conflict')::boolean,false)
  and e.event_type in ('closer_completed','closer_sold','cc2_sold','cc2_agreed','closer_follow_up','closer_lost') and e.occurred_at>=pq.at) pc on true
 left join lateral (select min(e.occurred_at) at from events e where e.process_id=p.process_id and not coalesce((e.payload->>'state_conflict')::boolean,false) and e.event_type='cc2_agreed'
  and e.occurred_at>=pc.at) pcc on true
 left join lateral (
  select cal.starts_at,cal.meeting_id from public.close_process_meetings rel
  join calendars cal on cal.meeting_id=rel.meeting_id
  where rel.process_id=p.process_id and rel.removed_at is null and cal.date_created<=(select at from cutoff)
   and cal.starts_at>(select at from cutoff) and coalesce(cal.status,'') not in ('canceled','cancelled','declined','declined-by-lead')
  order by cal.starts_at,cal.meeting_id limit 1
 ) next on true
 where p.retired_at is null and (p.payload->>'opened_at')::timestamptz<=(select at from cutoff)
 )
 select p.payload||jsonb_build_object('source',coalesce(p.lead_source,'Nicht zugeordnet'),
 'owner',public.get_close_supplier_internal(p.lead_source,p.payload->>'booking_owner_id'),
 'booked_date',(p.booked_at at time zone 'Europe/Berlin')::date,
 'setter_at',p.setter_at,'qualified_at',p.qualified_at,'closer_at',p.closer_at,'cc2_at',p.cc2_at,'won_at',p.won_at,
 'progression_setter_at',p.progression_setter_at,'progression_qualified_at',p.progression_qualified_at,
 'progression_closer_at',p.progression_closer_at,'progression_cc2_at',p.progression_cc2_at,
 'won_at_precision',p.won_precision,'sold_at',p.sold_at,'decided_at',p.decided_at,'closed_at',p.closed_at,'setter_result',case when p.latest_conflict then 'unclear' else p.setter_result end,'closer_result',case when p.latest_conflict then 'unclear' else p.closer_result end,
 'state',p.state,'stage',p.stage,'status_since',coalesce(p.status_since,p.opened_at),
 'next_meeting_at',case when p.closed_at is null then p.next_meeting_at end,
 'next_meeting_id',case when p.closed_at is null then p.next_meeting_id end,
 'next_stage',case when p.next_meeting_at is not null and p.closed_at is null then 'setter' end,
 'current_lead_status',p.current_lead_status)
 from rows p;
$$;
revoke all on function public.get_close_process_rows_internal(date) from public,anon,authenticated;

create function public.get_close_process_cohorts_internal(p_as_of date) returns jsonb
language sql stable security definer set search_path='' set jit=off as $$
 with rows as materialized (
 select data d,(data->>'first_meeting_at')::timestamptz start,
 (data->>'progression_setter_at')::timestamptz s,(data->>'progression_qualified_at')::timestamptz q,
 (data->>'progression_closer_at')::timestamptz c,(data->>'progression_cc2_at')::timestamptz cc2,
 (data->>'sold_at')::timestamptz sold,(data->>'decided_at')::timestamptz decided,
 (data->>'won_at')::timestamptz won
 from public.get_close_process_rows_internal(p_as_of)
 where (data->>'documented_booking')::boolean and data->>'first_meeting_at' is not null
 and (data->>'booked_date')::date<=p_as_of
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

-- Open work is a durable stock at the current source snapshot. Changing the
-- period selector does not erase an open process or its next-month appointment.
-- Service workers have no end-user UID. Keep the aggregate calculation behind
-- database EXECUTE grants rather than weakening the user-facing auth boundary.
create or replace function public.get_antony_pipeline_snapshot_internal(p_reference_date date default (now() at time zone 'Europe/Berlin')::date)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare v_as_of date := (public.get_sales_data_as_of_internal() at time zone 'Europe/Berlin')::date;
 v_result jsonb;
begin
 with rows as materialized(select data d from public.get_close_process_rows_internal(v_as_of)),
 live as (
 select d,case
 when d->>'current_lead_status'='stat_P1L8WuHSs14kYHbMuTRYQtuD98mjJIXMn9dnQNmEWCT' then 'closed'
 when d->>'state' in ('won','disqualified','lost') then 'closed'
 when d->>'state'='unclear' then 'unrated'
 when d->>'state'='sold_pending_won' or d->>'current_lead_status'='stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory' then 'sold_pending_won'
 when d->>'next_meeting_at' is not null and d->>'stage'<>'setter' then 'planning_needs_review'
 when d->>'next_meeting_at' is not null and d->>'stage'='setter' then 'setter_planned'
 when d->>'stage'='setter' then case d->>'state' when 'follow_up' then 'setter_followup' when 'rescheduled' then 'rescheduled_setter' when 'no_show' then 'setter_no_show' when 'cancelled' then 'setter_cancelled' else 'setter_pending' end
 when d->>'stage'='cc2' then case d->>'state' when 'no_show' then 'closer_no_show' when 'cancelled' then 'closer_cancelled' when 'rescheduled' then 'rescheduled_closer' else 'pending_decision_cc2' end
 when d->>'stage'='closer' then case d->>'state' when 'scheduled' then 'closer_scheduled' when 'follow_up' then 'closer_followup' when 'no_show' then 'closer_no_show' when 'cancelled' then 'closer_cancelled' when 'rescheduled' then 'rescheduled_closer' else 'unrated' end
 else 'unrated' end status from rows
 ), open as (select * from live where status<>'closed'),
 groups as (select date_trunc('month',(d->>'next_meeting_at')::timestamptz at time zone 'Europe/Berlin')::date as month,
 case when status='planning_needs_review' then 'unassigned' else d->>'next_stage' end stage,count(*) count from open where d->>'next_meeting_at' is not null group by 1,2)
 select jsonb_build_object('persistent',true,'as_of',v_as_of,'data_as_of',public.get_sales_data_as_of_internal(),
 'window_start',(select min((d->>'opened_at')::timestamptz at time zone 'Europe/Berlin')::date from rows),
 'timezone','Europe/Berlin','next_by_month',coalesce((select jsonb_agg(to_jsonb(g) order by month,stage) from groups g),'[]'::jsonb),
 'coverage',jsonb_build_object('unlinked_processes',(select count(*) from open where not (d->>'documented_booking')::boolean)),
 'counts',jsonb_build_object('total_open',count(*),
 'setter_planned',count(*) filter(where status='setter_planned'),'setter_pending',count(*) filter(where status='setter_pending'),
 'setter_followup',count(*) filter(where status='setter_followup'),'setter_cancelled',count(*) filter(where status='setter_cancelled'),
 'rescheduled_setter',count(*) filter(where status='rescheduled_setter'),'setter_no_show',count(*) filter(where status='setter_no_show'),
 'closer_scheduled',count(*) filter(where status='closer_scheduled'),'closer_followup',count(*) filter(where status='closer_followup'),
 'closer_cancelled',count(*) filter(where status='closer_cancelled'),'rescheduled_closer',count(*) filter(where status='rescheduled_closer'),
 'closer_no_show',count(*) filter(where status='closer_no_show'),'pending_decision_cc2',count(*) filter(where status='pending_decision_cc2'),
 'closer_planned',0,'cc2_planned',0,'planning_needs_review',count(*) filter(where status='planning_needs_review'),'sold_pending_won',count(*) filter(where status='sold_pending_won'),'unrated',count(*) filter(where status='unrated'),
 'from_previous_months',count(*) filter(where (d->>'opened_at')::timestamptz<date_trunc('month',v_as_of::timestamp) at time zone 'Europe/Berlin'),
 'older_than_14_days',count(*) filter(where (d->>'status_since')::timestamptz<(v_as_of-14)::timestamp at time zone 'Europe/Berlin')),
 'oldest_open_date',min((d->>'opened_at')::timestamptz at time zone 'Europe/Berlin')::date) into v_result from open;
 return v_result;
end;$$;
revoke all on function public.get_antony_pipeline_snapshot_internal(date) from public,anon,authenticated;
grant execute on function public.get_antony_pipeline_snapshot_internal(date) to service_role;

create or replace function public.get_antony_pipeline_snapshot(p_reference_date date default (now() at time zone 'Europe/Berlin')::date)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
begin
 if auth.uid() is null or not public.has_antony_access() then raise exception 'Nicht berechtigt' using errcode='42501';end if;
 return public.get_antony_pipeline_snapshot_internal(p_reference_date);
end;$$;
revoke all on function public.get_antony_pipeline_snapshot(date) from public,anon,authenticated;
grant execute on function public.get_antony_pipeline_snapshot(date) to service_role;

-- Keep the existing activity report API while replacing lead-based progress
-- with process-based cohorts. All rates share this authoritative population.
-- Activity volume and process attribution are independent. Later activity on a
-- closed process stays visible; its history must never leak into a new process.
create or replace function public.get_close_process_activity_origins_internal(p_period text,p_reference_date date)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare v_start date;v_end date;v_result jsonb;
begin
 if p_period is null or p_reference_date is null or p_period not in ('day','week','month','three_months') then
  raise exception 'Invalid period' using errcode='22023';end if;
 v_start:=case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date
  when 'month' then date_trunc('month',p_reference_date::timestamp)::date else (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
 v_end:=case when p_period='week' then least(v_start+4,p_reference_date) else p_reference_date end;
 with processes as materialized(select data d from public.get_close_process_rows_internal(p_reference_date)),
 links as materialized(
  select source_kind,source_event_id,case when count(distinct process_id)=1 then min(process_id) end process_id
  from public.close_process_events where removed_at is null group by source_kind,source_event_id
 ), acquisitions as materialized(select * from public.get_customer_acquisitions_internal(v_end)),
 facts as materialized(
  select f.*,r.payload,
   case when f.appointments>0 then rel.process_id else links.process_id end linked_process_id
  from public.get_antony_activity_facts_internal(p_reference_date) f
  left join public.get_antony_outcome_payloads_internal(p_reference_date) r on r.close_activity_id=f.source_activity_id
  left join links on links.source_kind='custom_activity' and links.source_event_id=f.source_activity_id
  left join public.close_process_meetings rel on rel.meeting_id=f.source_activity_id and rel.removed_at is null
  where f.source_type='custom_activity' and f.metric_date between v_start and v_end
   and (f.appointments>0 or f.occurred_at<=public.get_sales_data_as_of_internal())
   and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')
 ), attributed as materialized(
  select f.*,p.d->>'process_id' process_id,(p.d->>'booked_date')::date booked_date,
   coalesce(p.d->>'source',l.lead_source,legacy.lead_source,'Nicht zugeordnet') source,
   case when p.d is not null then p.d->>'owner' else public.get_close_supplier_internal(coalesce(l.lead_source,legacy.lead_source),null) end owner,
   f.payload->>'custom_activity_type_id' activity_type,
   f.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' setter_result,
   f.payload->>'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' closer_result,
   f.payload->>'custom.cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c' followup_result,
   f.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' setter_status,
   f.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' closer_status,
   exists(select 1 from public.close_process_events old where old.process_id=p.d->>'process_id'
    and old.event_type='cc2_agreed' and old.removed_at is null and old.occurred_at<f.occurred_at
    and coalesce((old.payload->>'applies_to_state')::boolean,true) and not coalesce((old.payload->>'state_conflict')::boolean,false)) after_cc2
  from facts f left join processes p on p.d->>'process_id'=f.linked_process_id
  left join public.close_funnel_leads l on l.lead_id=f.lead_id
  left join public.close_lead_reporting legacy on legacy.lead_id=f.lead_id
 ), events as materialized(
  select * from attributed where appointments>0 or setter_calls>0 or closer_calls>0 or setter_status is not null or closer_status is not null
   or activity_type='actitype_38qU8FYNxY0WkWAy66Uc65'
 ), grouped as (
  select source,owner,booked_date,
   count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65') followup_contacts,
   count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Follow Up') further_followups,
   count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Termin vereinbart') followup_appointments,
   count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: unqualifiziert') followup_disqualified,
   count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: kein Interesse') followup_no_interest,
   count(*) filter(where setter_calls=1) setter_calls,
   count(*) filter(where setter_calls=1 and setter_result='✅ Closer terminiert') setter_qualified,
   count(*) filter(where setter_calls=1 and setter_result='🔎 Setter Follow Up') setter_followups,
   count(*) filter(where setter_calls=1 and setter_result='❌ Disqualifiziert') setter_disqualified,
   count(*) filter(where setter_calls=1 and coalesce(setter_result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) setter_unrated,
   count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='Nicht erschienen') setter_no_shows,
   count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='⛔ Abgesagt') setter_cancellations,
   count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='🔄 Termin verschoben') setter_rescheduled,
   count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='Nicht erschienen') closer_no_shows,
   count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='⛔ Abgesagt') closer_cancellations,
   count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='🔄 Termin verschoben') closer_rescheduled,
   count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') closer_calls,
   count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='1. ✅ Verkauft - in CC1') cc1_sales,
   count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='3. ✅ Verkauft - in CC2 🔥') cc2_sales,
   count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='2. 🔥 CC2 vereinbart') cc2_agreed,
   count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='4. ❌ Nicht verkauft') closer_lost,
   count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and coalesce(closer_result,'') not in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥','2. 🔥 CC2 vereinbart','4. ❌ Nicht verkauft')) closer_unrated,
   coalesce(sum(appointments),0) appointments,
   count(*) filter(where setter_calls=1 and booked_date between v_start and v_end) setter_from_period_bookings,
   count(*) filter(where setter_calls=1 and booked_date<v_start) setter_from_prior_bookings,
   count(*) filter(where setter_calls=1 and (booked_date is null or booked_date>v_end)) setter_without_booking,
   count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and (after_cc2 or closer_result='3. ✅ Verkauft - in CC2 🔥')) cc2_calls,
   count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and not after_cc2 and coalesce(closer_result,'')<>'3. ✅ Verkauft - in CC2 🔥' and (process_id is not null or closer_result='1. ✅ Verkauft - in CC1')) cc1_calls,
   count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and not after_cc2 and coalesce(closer_result,'') not in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥') and process_id is null) cc_unassigned_calls,
   count(*) filter(where closer_result='4. ❌ Nicht verkauft' and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and after_cc2) cc2_lost,
   count(*) filter(where closer_result='4. ❌ Nicht verkauft' and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and not after_cc2 and process_id is not null) cc1_lost,
   count(*) filter(where closer_result='4. ❌ Nicht verkauft' and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and process_id is null) closer_lost_unassigned,
   count(*) filter(where closer_sales=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
    and exists(select 1 from acquisitions o where o.lead_id=events.lead_id and o.won_date<events.metric_date)) sales_after_prior_won
  from events group by source,owner,booked_date
 ), customer_origin as materialized(
  select o.*,p.d->>'process_id' process_id,(p.d->>'booked_date')::date booked_date,
   coalesce(p.d->>'source',l.lead_source,legacy.lead_source,'Nicht zugeordnet') source,
   case when p.d is not null then p.d->>'owner' else public.get_close_supplier_internal(coalesce(l.lead_source,legacy.lead_source),null) end owner
  from acquisitions o left join links on links.source_kind='opportunity' and links.source_event_id=o.opportunity_id
  left join processes p on p.d->>'process_id'=links.process_id
  left join public.close_funnel_leads l on l.lead_id=o.lead_id left join public.close_lead_reporting legacy on legacy.lead_id=o.lead_id
  where o.won_date between v_start and v_end and o.closer_close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
 ), customers as (select source,owner,booked_date,count(*) new_customers from customer_origin group by 1,2,3),
 combined as (
  select coalesce(to_jsonb(g),'{}'::jsonb)||jsonb_build_object('source',coalesce(g.source,c.source),'owner',coalesce(g.owner,c.owner),
   'booked_date',coalesce(g.booked_date,c.booked_date),'new_customers',coalesce(c.new_customers,0)) row
  from grouped g full join customers c on c.source=g.source and c.owner=g.owner and c.booked_date is not distinct from g.booked_date
 ), quality_order as (
  select e.*,coalesce(e.process_id,'unlinked-lead:'||e.lead_id,'unlinked-activity:'||e.source_activity_id) quality_unit,
   dense_rank() over(partition by coalesce(e.process_id,'unlinked-lead:'||e.lead_id,'unlinked-activity:'||e.source_activity_id) order by occurred_at desc) latest
  from events e where setter_calls=1
 ), quality_latest as (
  select quality_unit,source,owner,case when process_id is null then 'unassigned' else 'sales_process' end attribution,
   case when count(distinct coalesce(setter_result,''))=1 then max(setter_result) end result
  from quality_order where latest=1 group by 1,2,3,4
 ), quality_groups as (
  select source,owner,attribution,count(*) assessed_leads,
   count(*) filter(where result='✅ Closer terminiert') qualified,
   count(*) filter(where result='🔎 Setter Follow Up') followup,
   count(*) filter(where result='❌ Disqualifiziert') disqualified,
   count(*) filter(where coalesce(result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) unrated
  from quality_latest group by 1,2,3
 ), bridge as (
  select coalesce((select jsonb_object_agg(key,total) from (
   select kv.key,sum(kv.value::numeric) total from grouped g cross join lateral jsonb_each_text(to_jsonb(g)-'source'-'owner'-'booked_date') kv group by kv.key
  ) z),'{}'::jsonb)||jsonb_build_object(
   'setter_calls',(select count(*) from events where setter_calls=1),
   'setter_leads',(select count(distinct lead_id) from events where setter_calls=1),
   'setter_processes',(select count(distinct process_id) from events where setter_calls=1),
   'setter_from_period_bookings',(select count(*) from events where setter_calls=1 and booked_date between v_start and v_end),
   'setter_from_prior_bookings',(select count(*) from events where setter_calls=1 and booked_date<v_start),
   'setter_without_booking',(select count(*) from events where setter_calls=1 and (booked_date is null or booked_date>v_end)),
   'new_customers',(select count(*) from customer_origin),
   'customers_from_period_bookings',(select count(*) from customer_origin where booked_date between v_start and v_end),
   'customers_from_prior_bookings',(select count(*) from customer_origin where booked_date<v_start),
   'customers_without_booking',(select count(*) from customer_origin where booked_date is null or booked_date>v_end),
   'cc2_calls',coalesce((select sum(cc2_calls) from grouped),0),
   'cc1_calls',coalesce((select sum(cc1_calls) from grouped),0),
   'cc_unassigned_calls',coalesce((select sum(cc_unassigned_calls) from grouped),0),
   'cc2_lost',coalesce((select sum(cc2_lost) from grouped),0),
   'cc1_lost',coalesce((select sum(cc1_lost) from grouped),0),
   'closer_lost_unassigned',coalesce((select sum(closer_lost_unassigned) from grouped),0),
   'sales_after_prior_won',coalesce((select sum(sales_after_prior_won) from grouped),0)) data
 )
 select jsonb_build_object('period_bridge',(select data from bridge),
  'activity_by_origin',coalesce((select jsonb_agg(row order by row->>'booked_date',row->>'source',row->>'owner') from combined),'[]'::jsonb),
  'quality_by_source',coalesce((select jsonb_agg(to_jsonb(q) order by source,owner,attribution) from quality_groups q),'[]'::jsonb),
  'origin_basis','Documented sales process and its first scheduled Setter meeting; unlinked activity remains unknown. CC2 history never crosses process boundaries.',
  'quality_basis','Latest Setter result per sales process in the activity period; unlinked leads are shown separately.') into v_result;
 return v_result;
end;$$;
revoke all on function public.get_close_process_activity_origins_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_close_process_activity_origins_internal(text,date) to service_role;

alter function public.get_antony_process_metrics_internal(text,date) rename to get_antony_process_metrics_legacy_internal;
revoke all on function public.get_antony_process_metrics_legacy_internal(text,date) from public,anon,authenticated;
create function public.get_antony_process_metrics_internal(p_period text,p_reference_date date default (now() at time zone 'Europe/Berlin')::date)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare result jsonb; cohorts jsonb; v_start date; v_end date; flow jsonb; timeline jsonb;
begin
 result:=public.get_antony_process_metrics_legacy_internal(p_period,p_reference_date);
 if not exists(select 1 from public.close_reconciliation_state where resource='funnel') then return result;end if;
 v_start:=(result->'period'->>'start')::date;v_end:=(result->'period'->>'end')::date;
 cohorts:=public.get_close_process_cohorts_internal(p_reference_date);
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
 into flow,timeline;
 return result||public.get_close_process_activity_origins_internal(p_period,p_reference_date)||jsonb_build_object('reporting_version','2026-09-08.persistent-process','flow',flow,'timeline',timeline,
 'coverage',(result->'coverage')||jsonb_build_object('history_complete',true),
 'setter_attendance',(result->'setter_attendance')||jsonb_build_object('by_source',public.apply_close_supplier_rules_internal(result->'setter_attendance'->'by_source')),
 'cohort_history',cohorts,'booking_cohort_history',cohorts,
 'funnel_by_source',coalesce((select jsonb_agg(c) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),'[]'::jsonb),
 'booking_cohort',coalesce((select jsonb_agg(c) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),'[]'::jsonb));
end;$$;
revoke all on function public.get_antony_process_metrics_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_antony_process_metrics_internal(text,date) to service_role;

-- Supplier credit follows the calendar source; actual worker calls remain unchanged.
create or replace function public.get_antony_report(p_period text,p_reference_date date)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare c jsonb;p jsonb;mc jsonb;mp jsonb;
begin
 if auth.uid() is null or not public.has_antony_access() then raise exception 'Nicht berechtigt' using errcode='42501';end if;
 if p_period is null or p_reference_date is null or p_period not in ('day','week','month') then raise exception 'Invalid period' using errcode='22023';end if;
 select to_jsonb(x) into c from public.get_antony_closing_metrics_internal(p_period,p_reference_date) x;
 p:=public.get_antony_process_metrics_internal(p_period,p_reference_date);
 if p_period='month' then mc:=c;mp:=p;else
  select to_jsonb(x) into mc from public.get_antony_closing_metrics_internal('month',p_reference_date) x;
  mp:=public.get_antony_process_metrics_internal('month',p_reference_date);
 end if;
 return jsonb_build_object('closing',c,'process',p,'data_as_of',public.get_sales_data_as_of_internal(),
 'performance',(select coalesce(jsonb_agg(to_jsonb(x) order by x.bucket_index),'[]'::jsonb) from public.get_antony_performance_series_internal(p_period,p_reference_date) x),
 'pipeline',public.get_antony_pipeline_snapshot(p_reference_date),
 'quarter',case when p_period='month' then public.get_antony_process_metrics_internal('three_months',p_reference_date) else null end,
 'planner',jsonb_build_object('closing',mc,'process',mp,'appointment_by_owner',(select coalesce(jsonb_object_agg(x.slug,x.n),'{}'::jsonb) from (select public.get_close_supplier_internal(l.lead_source,m.booking_owner_id) slug,count(*) n
 from public.get_setter_meetings_internal(date_trunc('month',p_reference_date::timestamp)::date,p_reference_date,true) m
 left join public.close_funnel_leads l on l.lead_id=m.lead_id group by 1) x)));
end;$$;

commit;
