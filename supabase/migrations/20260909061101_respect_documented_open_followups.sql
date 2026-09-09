begin;
-- Open CRM tasks can be scheduled before the conversation result is entered.
-- Explicit current continuation status plus still-open due work is current
-- planning evidence; conversation outcomes and chronology stay unchanged.
create or replace function public.get_close_current_actions_internal() returns table(data jsonb)
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
   and ((t.payload->>'date_created')::timestamptz>=(d->>'status_since')::timestamptz
     or ((t.payload->>'due_date')::date>=((d->>'status_since')::timestamptz at time zone 'Europe/Berlin')::date
      and (d->>'state'<>'lost' or d->>'current_lead_status' in
       ('stat_ohblHuUMB0T7CwMfQSZhu0xWc2GDGaOEtCYOHeMMA6c','stat_SPNvi34PmlJBYNre2CJh12Yc78H6si1jYvNyhxarxwS',
        'stat_BWTMuauBHXSRHbOXjof5VxjjRUoZ3EtYjpxqxoYn0dH','stat_8ugtaHvwvKH3hIELdeQUqwUExa4Hn4ipsYQUuRvEfAm','stat_d9hxREiCT5xmQHv7HbfzeyBmeVHoZYUzkMXuwzPiIve'))))
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


commit;
