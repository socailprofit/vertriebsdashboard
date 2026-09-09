begin;
-- Native lead tasks describe current work planning. They share source-revision
-- identity/history but never create Setter/Closer performance on their own.
alter table public.close_funnel_events drop constraint close_funnel_events_source_kind_check;
alter table public.close_funnel_events add constraint close_funnel_events_source_kind_check
 check(source_kind in ('custom_activity','meeting','lead_status_change','opportunity','task'));
-- Coverage is acknowledged only after a complete task fetch and an atomic
-- funnel commit. Readers require this marker to equal the current funnel cut.
create function public.confirm_close_task_snapshot(p_snapshot timestamptz,p_expected_task_count integer)
returns jsonb language plpgsql security definer set search_path='' set jit=off as $$
declare v_funnel timestamptz;v_count integer;
begin
 if p_snapshot is null or p_expected_task_count is null or p_expected_task_count not between 0 and 20000
 then raise exception 'Invalid task snapshot confirmation';end if;
 select snapshot_started_at into v_funnel from public.close_reconciliation_state where resource='funnel' for update;
 if not found or v_funnel<>p_snapshot then raise exception 'Task snapshot no longer matches funnel';end if;
 select count(*)::integer into v_count from public.close_funnel_events
 where source_kind='task' and is_current and withdrawn_at is null;
 if v_count<>p_expected_task_count or exists(
  select 1 from public.close_funnel_events where source_kind='task' and is_current and withdrawn_at is null
   and (last_seen_at<>p_snapshot or event_type<>'task_state' or new_status is distinct from 'open'
    or payload->>'task_type' is distinct from 'lead'
    or payload->>'assigned_to' is distinct from 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
    or payload->'is_complete' is distinct from 'false'::jsonb)
 ) then raise exception 'Incomplete or out-of-scope task snapshot';end if;
 insert into public.close_reconciliation_state(resource,snapshot_started_at) values('antony_tasks',p_snapshot)
 on conflict(resource) do update set snapshot_started_at=excluded.snapshot_started_at;
 return jsonb_build_object('snapshot_started_at',p_snapshot,'task_count',v_count);
end;$$;
revoke all on function public.confirm_close_task_snapshot(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.confirm_close_task_snapshot(timestamptz,integer) to service_role;
commit;
