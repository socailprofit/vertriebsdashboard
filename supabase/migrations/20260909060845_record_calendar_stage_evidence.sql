begin;
-- Explicit relation evidence replaces an unconditional stage label. This does
-- not activate consultation/Closer/CC2 matching: the calendar still comes only
-- from the established Setter source. Unknown or contradictory stage claims
-- remain planning_needs_review; no performance or Setting success is created.
-- Purpose categories themselves live in the existing private event journal,
-- without storing titles or changing the raw calendar table.
create or replace function public.get_close_process_rows_internal(p_as_of date)
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
 next.starts_at next_meeting_at,next.meeting_id next_meeting_id,next.meeting_stage next_meeting_stage,
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
  select cal.starts_at,cal.meeting_id,
  case when rel.payload ? 'meeting_stage' then
   case when rel.payload->>'meeting_stage'='setter' and rel.payload->>'stage_basis'='documented_setter_booking'
    and rel.payload->>'stage_source_event_id'=cal.booking_activity_id then 'setter' else 'unassigned' end
   -- Legacy relations are accepted only through the proven Setter calendar.
   else 'setter' end meeting_stage
  from public.close_process_meetings rel
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
 'next_stage',case when p.next_meeting_at is not null and p.closed_at is null then p.next_meeting_stage end,
 'current_lead_status',p.current_lead_status)
 from rows p;
$$;
revoke all on function public.get_close_process_rows_internal(date) from public,anon,authenticated;

-- Current actions are a separate projection. They do not rewrite historical
-- conversation outcomes, first bookings, cohort denominators or first Won.
create function public.get_close_current_actions_internal() returns table(data jsonb)
language sql stable security definer set search_path='' set jit=off as $$
 with cutoff as (select public.get_sales_data_as_of_internal() at),
 coverage as (select exists(select 1 from public.close_reconciliation_state t join public.close_reconciliation_state f
  on f.resource='funnel' and t.snapshot_started_at=f.snapshot_started_at where t.resource='antony_tasks') complete),
 rows as materialized(select data d from public.get_close_process_rows_internal(((select at from cutoff) at time zone 'Europe/Berlin')::date)),
 tasks as materialized(select e.* from public.close_funnel_events e where (select complete from coverage)
  and e.source_kind='task' and e.is_current and e.withdrawn_at is null and e.new_status='open'
  and e.payload->>'purpose_code'='follow_up' and e.payload->>'assigned_to'='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
  and e.payload->'is_complete'='false'::jsonb and e.source_updated_at<=(select at from cutoff)),
 meetings as materialized(select e.* from public.close_funnel_events e where e.source_kind='meeting' and e.is_current
  and e.withdrawn_at is null and e.new_status='upcoming' and e.occurred_at>(select at from cutoff)),
 chosen as (
 select d,t.source_event_id task_id,t.payload task_payload,t.source_updated_at task_updated_at,
 m.n matched_meetings,m.meeting_id matched_meeting_id,
 case when m.n=1 then case when d->>'stage'='cc2' and d->>'cc2_at' is not null then 'cc2'
  when d->>'stage'='closer' and d->>'qualified_at' is not null then 'closer'
  when d->>'stage'='setter' and m.meeting_id=d->>'next_meeting_id' and d->>'next_stage'='setter' then 'setter' end end task_meeting_stage
 from rows r
 left join lateral (
  select t.* from tasks t where t.lead_id=d->>'lead_id'
   and (t.payload->>'date_created')::timestamptz>=(d->>'opened_at')::timestamptz
   and (t.payload->>'date_created')::timestamptz>=coalesce((d->>'status_since')::timestamptz,(d->>'opened_at')::timestamptz)
   and d->>'state' not in ('won','disqualified','unclear','sold_pending_won')
   and coalesce(d->>'current_lead_status','') not in ('stat_P1L8WuHSs14kYHbMuTRYQtuD98mjJIXMn9dnQNmEWCT','stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory')
   and not exists(select 1 from rows newer where newer.d->>'lead_id'=r.d->>'lead_id' and (newer.d->>'opened_at')::timestamptz>(r.d->>'opened_at')::timestamptz)
   and not exists(select 1 from public.close_process_events e where e.process_id=d->>'process_id' and e.removed_at is null
     and e.event_type in ('customer_won','setter_disqualified') and coalesce((e.payload->>'applies_to_state')::boolean,true))
   and not exists(select 1 from public.close_funnel_events e where e.lead_id=d->>'lead_id' and e.source_kind='opportunity'
     and e.is_current and e.withdrawn_at is null and e.payload->>'acquisition'='true' and e.occurred_at<=(select at from cutoff))
  order by (t.payload->>'due_date')::date nulls last,(t.payload->>'due_at')::timestamptz nulls last,t.source_event_id limit 1
 ) t on true
 left join lateral (
  select count(*) n,min(m.source_event_id) meeting_id from meetings m
  where t.payload->>'due_precision'='timestamp' and m.lead_id=d->>'lead_id'
   and m.occurred_at=(t.payload->>'due_at')::timestamptz and m.payload->>'owner_id'=t.payload->>'assigned_to'
   and (m.payload->>'date_created')::timestamptz>=(d->>'opened_at')::timestamptz
   and (m.payload->>'purpose_code' in ('consultation','strategy_consultation')
     or (m.source_event_id=d->>'next_meeting_id' and d->>'next_stage'='setter'))
 ) m on true
 )
 select d||jsonb_build_object('task_coverage_complete',(select complete from coverage),'task_id',task_id,
 'next_task_date',task_payload->>'due_date','next_task_at',task_payload->>'due_at','task_due_precision',task_payload->>'due_precision',
 'task_due_now',case when task_id is null then false when task_payload->>'due_precision'='timestamp'
  then (task_payload->>'due_at')::timestamptz<=(select at from cutoff)
  when task_payload->>'due_precision'='date' then (task_payload->>'due_date')::date<=((select at from cutoff) at time zone 'Europe/Berlin')::date else false end,
 'task_planned',case when task_id is null then false when task_payload->>'due_precision'='timestamp'
  then (task_payload->>'due_at')::timestamptz>(select at from cutoff)
  when task_payload->>'due_precision'='date' then (task_payload->>'due_date')::date>((select at from cutoff) at time zone 'Europe/Berlin')::date else false end,
 'task_meeting_stage',task_meeting_stage,'task_meeting_ambiguous',matched_meetings>1,
 'next_meeting_at',case when task_meeting_stage is not null then task_payload->>'due_at' else d->>'next_meeting_at' end,
 'next_meeting_id',case when task_meeting_stage is not null then matched_meeting_id else d->>'next_meeting_id' end,
 'next_stage',coalesce(task_meeting_stage,d->>'next_stage'),
 'current_state',case when task_id is not null then 'follow_up' else d->>'state' end)
 from chosen;
$$;
revoke all on function public.get_close_current_actions_internal() from public,anon,authenticated;
grant execute on function public.get_close_current_actions_internal() to service_role;

create or replace function public.get_antony_pipeline_snapshot_internal(p_reference_date date default (now() at time zone 'Europe/Berlin')::date)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare v_as_of date := (public.get_sales_data_as_of_internal() at time zone 'Europe/Berlin')::date;
 v_result jsonb;
begin
 with rows as materialized(select data d from public.get_close_current_actions_internal()),
 live as (
 select d,case
 when d->>'current_lead_status'='stat_P1L8WuHSs14kYHbMuTRYQtuD98mjJIXMn9dnQNmEWCT' then 'closed'
 when d->>'current_state' in ('won','disqualified','lost') then 'closed'
 when d->>'state'='unclear' then 'unrated'
 when d->>'state'='sold_pending_won' or d->>'current_lead_status'='stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory' then 'sold_pending_won'
 when d->>'task_meeting_stage' is not null then (d->>'task_meeting_stage')||'_planned'
 when d->>'task_id' is not null then 'task_followup'
 when d->>'next_meeting_at' is not null and (d->>'stage'<>'setter' or d->>'next_stage' is distinct from 'setter') then 'planning_needs_review'
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
 'coverage',jsonb_build_object('tasks_complete',coalesce((select bool_and((d->>'task_coverage_complete')::boolean) from rows),false),'unlinked_processes',(select count(*) from open where not (d->>'documented_booking')::boolean)),
 'counts',jsonb_build_object('total_open',count(*),
 'setter_planned',count(*) filter(where status='setter_planned'),'setter_pending',count(*) filter(where status='setter_pending'),
 'setter_followup',count(*) filter(where status='setter_followup'),'setter_cancelled',count(*) filter(where status='setter_cancelled'),
 'rescheduled_setter',count(*) filter(where status='rescheduled_setter'),'setter_no_show',count(*) filter(where status='setter_no_show'),
 'closer_scheduled',count(*) filter(where status='closer_scheduled'),'closer_followup',count(*) filter(where status='closer_followup'),
 'closer_cancelled',count(*) filter(where status='closer_cancelled'),'rescheduled_closer',count(*) filter(where status='rescheduled_closer'),
 'closer_no_show',count(*) filter(where status='closer_no_show'),'pending_decision_cc2',count(*) filter(where status='pending_decision_cc2'),
 'closer_planned',count(*) filter(where status='closer_planned'),'cc2_planned',count(*) filter(where status='cc2_planned'),
 'task_due_now',count(*) filter(where (d->>'task_due_now')::boolean),'task_planned',count(*) filter(where (d->>'task_planned')::boolean),
 'task_undated',count(*) filter(where d->>'task_id' is not null and d->>'task_due_precision'='none'),
 'without_current_task',count(*) filter(where d->>'task_id' is null),'task_followup',count(*) filter(where status='task_followup'),'planning_needs_review',count(*) filter(where status='planning_needs_review'),'sold_pending_won',count(*) filter(where status='sold_pending_won'),'unrated',count(*) filter(where status='unrated'),
 'from_previous_months',count(*) filter(where (d->>'opened_at')::timestamptz<date_trunc('month',v_as_of::timestamp) at time zone 'Europe/Berlin'),
 'older_than_14_days',count(*) filter(where (d->>'status_since')::timestamptz<(v_as_of-14)::timestamp at time zone 'Europe/Berlin')),
 'current_actions',coalesce((select jsonb_agg(jsonb_build_object('lead_id',d->>'lead_id','process_id',d->>'process_id','stage',coalesce(d->>'task_meeting_stage',d->>'stage'),'due_date',d->>'next_task_date','due_at',d->>'next_task_at','due_precision',d->>'task_due_precision','meeting_confirmed',d->>'task_meeting_stage' is not null,'due_now',(d->>'task_due_now')::boolean,'first_meeting_at',d->>'first_meeting_at','opened_at',d->>'opened_at') order by d->>'next_task_date') from open where d->>'task_id' is not null),'[]'::jsonb),
 'oldest_open_date',min((d->>'opened_at')::timestamptz at time zone 'Europe/Berlin')::date) into v_result from open;
 return v_result;
end;$$;
revoke all on function public.get_antony_pipeline_snapshot_internal(date) from public,anon,authenticated;
grant execute on function public.get_antony_pipeline_snapshot_internal(date) to service_role;

commit;
