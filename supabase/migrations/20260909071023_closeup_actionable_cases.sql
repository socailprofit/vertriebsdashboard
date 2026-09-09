begin;
-- Only actual calendar entries known at the committed data cutoff are planning.
-- Join by lead identity, including replacement meetings outside a process link.
create or replace function public.get_closeup_future_meetings_internal()
returns table(lead_id text,meeting_id text,starts_at timestamptz)
language sql stable security definer set search_path='' set jit=off as $$
 with cutoff as (select public.get_sales_data_as_of_internal() at),
 journal as materialized(select e.* from public.close_funnel_events e where e.source_kind='meeting' and e.is_current
  and e.withdrawn_at is null and e.source_updated_at<=(select at from cutoff)),
 candidates as (
 select m.lead_id,m.meeting_id,m.starts_at from public.close_meetings m
 where m.removed_at is null and not m.excluded_purpose
  and m.date_created<=(select at from cutoff) and m.date_updated<=(select at from cutoff)
  and m.starts_at>(select at from cutoff) and m.status='upcoming'
  and not exists(select 1 from journal j where j.source_event_id=m.meeting_id and j.new_status<>'upcoming')
 union
 select e.lead_id,e.source_event_id,e.occurred_at from journal e
 where e.new_status='upcoming' and e.occurred_at>(select at from cutoff)
  and (e.payload->>'date_created')::timestamptz<=(select at from cutoff)
  and e.payload->>'purpose_code' in ('unclassified','consultation','strategy_consultation')
 ) select distinct * from candidates;
$$;
revoke all on function public.get_closeup_future_meetings_internal() from public,anon,authenticated;
grant execute on function public.get_closeup_future_meetings_internal() to service_role;

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
 ), stage_setter as (
 select p.process_id,min(e.occurred_at) at from public.close_sales_processes p join events e on e.process_id=p.process_id
 where e.event_type in ('setter_completed','setter_qualified','setter_follow_up','setter_disqualified')
  and e.occurred_at>=(p.payload->>'first_meeting_at')::timestamptz group by p.process_id
 ), stage_qualified as (
 select s.process_id,min(e.occurred_at) at from stage_setter s join events e on e.process_id=s.process_id
 where e.event_type='setter_qualified' and not coalesce((e.payload->>'state_conflict')::boolean,false)
  and e.occurred_at>=s.at group by s.process_id
 ), stage_closer as (
 select q.process_id,min(e.occurred_at) at from stage_qualified q join events e on e.process_id=q.process_id
 where e.event_type in ('closer_completed','closer_sold','cc2_sold','cc2_agreed','closer_follow_up','closer_lost')
  and not coalesce((e.payload->>'state_conflict')::boolean,false) and e.occurred_at>=q.at group by q.process_id
 ), stage_cc2 as (
 select c.process_id,min(e.occurred_at) at from stage_closer c join events e on e.process_id=c.process_id
 where e.event_type='cc2_agreed' and not coalesce((e.payload->>'state_conflict')::boolean,false)
  and e.occurred_at>=c.at group by c.process_id
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
 left join stage_setter ps on ps.process_id=p.process_id
 left join stage_qualified pq on pq.process_id=p.process_id
 left join stage_closer pc on pc.process_id=p.process_id
 left join stage_cc2 pcc on pcc.process_id=p.process_id
 left join lateral (
  select cal.starts_at,cal.meeting_id,
  case when rel.payload ? 'meeting_stage' then
   case when rel.payload->>'meeting_stage'='setter' and rel.payload->>'stage_basis'='documented_setter_booking'
    and rel.payload->>'stage_source_event_id'=cal.booking_activity_id then 'setter' else 'unassigned' end
   -- Legacy relations are accepted only through the proven Setter calendar.
   else 'setter' end meeting_stage
  from public.close_process_meetings rel
  join calendars cal on cal.meeting_id=rel.meeting_id
  where rel.process_id=p.process_id and rel.removed_at is null and cal.date_created<=(select at from cutoff) and cal.date_updated<=(select at from cutoff)
   and cal.starts_at>(select at from cutoff) and cal.status='upcoming'
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



create or replace function public.get_close_current_actions_internal() returns table(data jsonb)
language sql stable security definer set search_path='' set jit=off as $$
 with cutoff as (select public.get_sales_data_as_of_internal() at),
 coverage as (select exists(select 1 from public.close_reconciliation_state t join public.close_reconciliation_state f
  on f.resource='funnel' and t.snapshot_started_at=f.snapshot_started_at where t.resource='antony_tasks') complete),
 rows as materialized(select data d from public.get_close_process_rows_internal(((select at from cutoff) at time zone 'Europe/Berlin')::date)),
 tasks as materialized(select distinct on(e.source_event_id) e.* from public.close_funnel_events e where (select complete from coverage)
  and e.source_kind='task' and e.new_status='open'
  and e.payload->>'purpose_code'='follow_up' and e.payload->>'assigned_to'='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
  and e.payload->'is_complete'='false'::jsonb and e.source_updated_at<=(select at from cutoff)
  order by e.source_event_id,e.source_updated_at desc,e.last_seen_at desc),
 meetings as materialized(select e.* from public.close_funnel_events e where e.source_kind='meeting' and e.is_current
  and e.withdrawn_at is null and e.new_status='upcoming' and e.occurred_at>(select at from cutoff) and e.source_updated_at<=(select at from cutoff)),
 chosen as (
 select d,t.source_event_id task_id,t.payload task_payload,t.source_updated_at task_updated_at,
 (t.is_current and t.withdrawn_at is null) task_active,m.n matched_meetings,m.meeting_id matched_meeting_id,m.starts_at matched_starts_at,
 case when m.n=1 then case when d->>'stage'='cc2' and d->>'cc2_at' is not null then 'cc2'
  when d->>'stage'='closer' and d->>'qualified_at' is not null then 'closer'
  when d->>'stage'='setter' and m.meeting_id=d->>'next_meeting_id' and d->>'next_stage'='setter' then 'setter' end end task_meeting_stage
 from rows r
 left join lateral (
  select t.* from tasks t where t.lead_id=d->>'lead_id'
   and ((t.is_current and t.withdrawn_at is null) or exists(select 1 from meetings cal
    where cal.lead_id=t.lead_id and (cal.occurred_at=(t.payload->>'due_at')::timestamptz or exists(select 1 from public.close_funnel_events h
      where h.source_kind='meeting' and h.source_event_id=cal.source_event_id and h.lead_id=cal.lead_id
       and h.occurred_at=(t.payload->>'due_at')::timestamptz and h.payload->>'owner_id'=t.payload->>'assigned_to'))
     and cal.payload->>'owner_id'=t.payload->>'assigned_to'
     and cal.payload->>'purpose_code' in ('consultation','strategy_consultation')))
   and (t.payload->>'date_created')::timestamptz>=(d->>'opened_at')::timestamptz
   and ((t.payload->>'date_created')::timestamptz>=(d->>'status_since')::timestamptz
     or ((t.payload->>'due_date')::date>=((d->>'status_since')::timestamptz at time zone 'Europe/Berlin')::date
      and (d->>'state'<>'lost' or d->>'current_lead_status' in
       ('stat_ohblHuUMB0T7CwMfQSZhu0xWc2GDGaOEtCYOHeMMA6c','stat_SPNvi34PmlJBYNre2CJh12Yc78H6si1jYvNyhxarxwS',
        'stat_BWTMuauBHXSRHbOXjof5VxjjRUoZ3EtYjpxqxoYn0dH','stat_8ugtaHvwvKH3hIELdeQUqwUExa4Hn4ipsYQUuRvEfAm','stat_d9hxREiCT5xmQHv7HbfzeyBmeVHoZYUzkMXuwzPiIve'))))
   and d->>'state' not in ('won','disqualified','unclear','sold_pending_won')
   and coalesce(d->>'current_lead_status','') not in ('stat_P1L8WuHSs14kYHbMuTRYQtuD98mjJIXMn9dnQNmEWCT','stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory')
   and not exists(select 1 from rows newer where newer.d->>'lead_id'=r.d->>'lead_id' and (newer.d->>'opened_at')::timestamptz>(r.d->>'opened_at')::timestamptz)
   and not exists(select 1 from public.close_process_events e where e.process_id=d->>'process_id' and e.removed_at is null
     and e.occurred_at<=(select at from cutoff) and e.event_type in ('customer_won','setter_disqualified') and coalesce((e.payload->>'applies_to_state')::boolean,true))
   and not exists(select 1 from public.close_funnel_events e where e.lead_id=d->>'lead_id' and e.source_kind='opportunity'
     and e.is_current and e.withdrawn_at is null and e.payload->>'acquisition'='true' and e.occurred_at<=(select at from cutoff))
  order by (t.payload->>'due_date')::date nulls last,(t.payload->>'due_at')::timestamptz nulls last,t.source_event_id limit 1
 ) t on true
 left join lateral (
  select count(*) n,min(m.source_event_id) meeting_id,min(m.occurred_at) starts_at from meetings m
  where t.payload->>'due_precision'='timestamp' and m.lead_id=d->>'lead_id'
   and (m.occurred_at=(t.payload->>'due_at')::timestamptz or exists(select 1 from public.close_funnel_events h
    where h.source_kind='meeting' and h.source_event_id=m.source_event_id and h.lead_id=m.lead_id
     and h.occurred_at=(t.payload->>'due_at')::timestamptz and h.payload->>'owner_id'=t.payload->>'assigned_to'))
   and m.payload->>'owner_id'=t.payload->>'assigned_to'
   and (m.payload->>'date_created')::timestamptz>=(d->>'opened_at')::timestamptz
   and (m.payload->>'purpose_code' in ('consultation','strategy_consultation')
     or (m.source_event_id=d->>'next_meeting_id' and d->>'next_stage'='setter'))
 ) m on true
 ), projected as (
 select d||jsonb_build_object('task_coverage_complete',(select complete from coverage),'task_id',case when task_active then task_id end,
 'next_task_date',case when task_meeting_stage is not null then (matched_starts_at at time zone 'Europe/Berlin')::date::text else task_payload->>'due_date' end,'next_task_at',case when task_meeting_stage is not null then matched_starts_at::text else task_payload->>'due_at' end,'task_due_precision',task_payload->>'due_precision',
 'task_due_now',case when task_id is null or not task_active then false when task_payload->>'due_precision'='timestamp'
  then coalesce(case when task_meeting_stage is not null then matched_starts_at end,(task_payload->>'due_at')::timestamptz)<=(select at from cutoff)
  when task_payload->>'due_precision'='date' then (task_payload->>'due_date')::date<=((select at from cutoff) at time zone 'Europe/Berlin')::date else false end,
 'task_planned',case when task_id is null or not task_active then false when task_payload->>'due_precision'='timestamp'
  then coalesce(case when task_meeting_stage is not null then matched_starts_at end,(task_payload->>'due_at')::timestamptz)>(select at from cutoff)
  when task_payload->>'due_precision'='date' then (task_payload->>'due_date')::date>((select at from cutoff) at time zone 'Europe/Berlin')::date else false end,
 'task_meeting_stage',task_meeting_stage,'task_meeting_ambiguous',matched_meetings>1,
 'next_meeting_at',case when task_meeting_stage is not null then matched_starts_at::text else d->>'next_meeting_at' end,
 'next_meeting_id',case when task_meeting_stage is not null then matched_meeting_id else d->>'next_meeting_id' end,
 'next_stage',coalesce(task_meeting_stage,d->>'next_stage'),
 'current_state',case when (task_id is not null and task_active) or task_meeting_stage is not null then 'follow_up' else d->>'state' end)
 as d from chosen
 )
 select p.d||case when p.d->>'next_meeting_at' is null and cal.meeting_id is not null
 then jsonb_build_object('next_meeting_at',cal.starts_at,'next_meeting_id',cal.meeting_id,'next_stage','unassigned')
 else '{}'::jsonb end
 from projected p left join lateral (
  select * from public.get_closeup_future_meetings_internal() m where m.lead_id=p.d->>'lead_id'
   and m.starts_at>coalesce((p.d->>'status_since')::timestamptz,'-infinity'::timestamptz)
  order by m.starts_at,m.meeting_id limit 1
 ) cal on true;
$$;
revoke all on function public.get_close_current_actions_internal() from public,anon,authenticated;
grant execute on function public.get_close_current_actions_internal() to service_role;


create or replace function public.get_antony_pipeline_snapshot_internal(p_reference_date date default (now() at time zone 'Europe/Berlin')::date)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare v_as_of date := (public.get_sales_data_as_of_internal() at time zone 'Europe/Berlin')::date;
 v_result jsonb;
begin
 with rows as materialized(select distinct on (data->>'lead_id') data d from public.get_close_current_actions_internal() order by data->>'lead_id',(data->>'opened_at')::timestamptz desc,data->>'process_id' desc),
 live as (
 select d,case
 when d->>'current_lead_status'='stat_P1L8WuHSs14kYHbMuTRYQtuD98mjJIXMn9dnQNmEWCT' then 'closed'
 when d->>'current_state' in ('won','disqualified','lost') then 'closed'
 when d->>'state'='unclear' then 'unrated'
 when d->>'state'='sold_pending_won' or d->>'current_lead_status'='stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory' then 'sold_pending_won'
 when d->>'task_meeting_stage' is not null then (d->>'task_meeting_stage')||'_planned'
  when d->>'next_meeting_at' is not null and (d->>'stage'<>'setter' or d->>'next_stage' is distinct from 'setter') then 'planning_needs_review'
 when d->>'next_meeting_at' is not null and d->>'stage'='setter' then 'setter_planned'
 when d->>'task_id' is not null then 'task_followup'
 when d->>'stage'='setter' then case d->>'state' when 'follow_up' then 'setter_followup' when 'rescheduled' then 'rescheduled_setter' when 'no_show' then 'setter_no_show' when 'cancelled' then 'setter_cancelled' else 'setter_pending' end
 when d->>'stage'='cc2' then case d->>'state' when 'no_show' then 'closer_no_show' when 'cancelled' then 'closer_cancelled' when 'rescheduled' then 'rescheduled_closer' else 'pending_decision_cc2' end
 when d->>'stage'='closer' then case d->>'state' when 'scheduled' then 'closer_scheduled' when 'follow_up' then 'closer_followup' when 'no_show' then 'closer_no_show' when 'cancelled' then 'closer_cancelled' when 'rescheduled' then 'rescheduled_closer' else 'unrated' end
 else 'unrated' end status from rows
 ), open as (select * from live where status<>'closed'),
 critical as (select * from open where d->>'next_meeting_at' is null),
 groups as (select date_trunc('month',(d->>'next_meeting_at')::timestamptz at time zone 'Europe/Berlin')::date as month,
 case when status='planning_needs_review' then 'unassigned' else d->>'next_stage' end stage,count(*) count from open where d->>'next_meeting_at' is not null group by 1,2)
 select jsonb_build_object('persistent',true,'as_of',v_as_of,'data_as_of',public.get_sales_data_as_of_internal(),
 'window_start',(select min((d->>'opened_at')::timestamptz at time zone 'Europe/Berlin')::date from rows),
 'timezone','Europe/Berlin','next_by_month',coalesce((select jsonb_agg(to_jsonb(g) order by month,stage) from groups g),'[]'::jsonb),
 'coverage',jsonb_build_object('tasks_complete',coalesce((select bool_and((d->>'task_coverage_complete')::boolean) from rows),false),'unlinked_processes',(select count(*) from open where not (d->>'documented_booking')::boolean)),
 'scheduled_meetings',coalesce((select jsonb_agg(jsonb_build_object('lead_id',d->>'lead_id','meeting_id',d->>'next_meeting_id',
 'starts_at',d->>'next_meeting_at','stage',d->>'next_stage') order by (d->>'next_meeting_at')::timestamptz,d->>'lead_id')
 from open where d->>'next_meeting_at' is not null),'[]'::jsonb),
 'critical_counts',jsonb_build_object('total', (select count(*) from critical),
 'no_show',(select count(*) from critical where d->>'state'='no_show'),
 'cancelled',(select count(*) from critical where d->>'state'='cancelled'),
 'without_meeting',(select count(*) from critical where d->>'state' not in ('no_show','cancelled'))),
 'critical_cases',coalesce((select jsonb_agg(jsonb_build_object('lead_id',d->>'lead_id','process_id',d->>'process_id',
  'stage',d->>'stage','reason',case d->>'state' when 'no_show' then 'no_show' when 'cancelled' then 'cancelled' else 'without_meeting' end,
  'status_since',d->>'status_since','task_id',d->>'task_id') order by d->>'status_since',d->>'lead_id') from critical),'[]'::jsonb),
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
