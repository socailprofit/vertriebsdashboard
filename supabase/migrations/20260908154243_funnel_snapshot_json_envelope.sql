begin;

-- One JSONB argument keeps PostgREST's outer request projection narrow. The
-- existing transaction performs all row, relationship, window and stale guards.
create function public.reconcile_close_funnel_payload(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' set jit=off as $$
declare
 v_keys constant text[]:=array['p_start_date','p_end_date','p_snapshot_started_at',
  'p_raw','p_facts','p_opportunities','p_leads','p_bookings','p_meetings','p_calendar_leads',
  'p_events','p_processes','p_meeting_relations','p_event_relations','p_funnel_leads','p_status_created_since'];
begin
 raise log 'close_funnel_payload phase=entered';
 if jsonb_typeof(p_snapshot) is distinct from 'object' then raise exception 'Invalid funnel envelope';end if;
 if not p_snapshot ?& v_keys or exists(select 1 from jsonb_object_keys(p_snapshot) k where not k=any(v_keys))
 then raise exception 'Invalid funnel envelope fields';end if;
 return public.reconcile_close_funnel_snapshot(
  (p_snapshot->>'p_start_date')::date,(p_snapshot->>'p_end_date')::date,
  (p_snapshot->>'p_snapshot_started_at')::timestamptz,
  p_snapshot->'p_raw',p_snapshot->'p_facts',p_snapshot->'p_opportunities',p_snapshot->'p_leads',
  p_snapshot->'p_bookings',p_snapshot->'p_meetings',p_snapshot->'p_calendar_leads',
  p_snapshot->'p_events',p_snapshot->'p_processes',p_snapshot->'p_meeting_relations',
  p_snapshot->'p_event_relations',p_snapshot->'p_funnel_leads',
  (p_snapshot->>'p_status_created_since')::timestamptz);
end;$$;
revoke all on function public.reconcile_close_funnel_payload(jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_close_funnel_payload(jsonb) to service_role;

commit;
