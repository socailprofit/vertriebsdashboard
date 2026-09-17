begin;
-- Full Close reads, validation, transaction boundaries and KPI formulas stay intact.
-- Ignore transport-only timestamp changes on retained rows. Shared reconciliation
-- markers still advance on every successful complete read. Tasks retain their
-- per-row heartbeat because confirm_close_task_snapshot explicitly checks it.
create or replace function public.skip_unchanged_close_row()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='close_funnel_events' and to_jsonb(new)->>'source_kind'='task' then return new;end if;
 if (to_jsonb(new)-tg_argv) is not distinct from (to_jsonb(old)-tg_argv) then return null;end if;
 return new;
end;$$;
revoke all on function public.skip_unchanged_close_row() from public,anon,authenticated;
drop trigger if exists skip_unchanged_close_row on public.close_raw_activities;
create trigger skip_unchanged_close_row before update on public.close_raw_activities for each row execute function public.skip_unchanged_close_row('ingested_at');
drop trigger if exists skip_unchanged_close_row on public.close_activity_facts;
create trigger skip_unchanged_close_row before update on public.close_activity_facts for each row execute function public.skip_unchanged_close_row('mapped_at');
drop trigger if exists skip_unchanged_close_row on public.close_opportunity_facts;
create trigger skip_unchanged_close_row before update on public.close_opportunity_facts for each row execute function public.skip_unchanged_close_row('ingested_at');
drop trigger if exists skip_unchanged_close_row on public.close_funnel_events;
create trigger skip_unchanged_close_row before update on public.close_funnel_events for each row execute function public.skip_unchanged_close_row('last_seen_at');
drop trigger if exists skip_unchanged_close_row on public.close_meetings;
create trigger skip_unchanged_close_row before update on public.close_meetings for each row execute function public.skip_unchanged_close_row('last_seen_at');
drop trigger if exists skip_unchanged_close_row on public.close_sales_processes;
create trigger skip_unchanged_close_row before update on public.close_sales_processes for each row execute function public.skip_unchanged_close_row('last_seen_at');
drop trigger if exists skip_unchanged_close_row on public.close_process_meetings;
create trigger skip_unchanged_close_row before update on public.close_process_meetings for each row execute function public.skip_unchanged_close_row('last_seen_at');
drop trigger if exists skip_unchanged_close_row on public.close_process_events;
create trigger skip_unchanged_close_row before update on public.close_process_events for each row execute function public.skip_unchanged_close_row('last_seen_at');

-- Preserve scope/deletion guards; only rows absent from the full read are removed.
do $patch$
declare definition text; expected text:=$old$m.removed_at is null and m.last_seen_at=p_snapshot_started_at$old$; replacement text:=$new$m.removed_at is null and exists(select 1 from pg_temp._close_cal_meetings observed where observed.meeting_id=m.meeting_id)$new$;
begin
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='reconcile_close_funnel_snapshot';
 if position(expected in definition)=0 then
  if position(replacement in definition)>0 then return;end if;
  raise exception 'Unexpected reconcile_close_funnel_snapshot definition; refusing unsafe patch';
 end if;
 execute replace(definition,expected,replacement);
end;$patch$;

-- Preserve scope/deletion guards; only rows absent from the full read are removed.
do $patch$
declare definition text; expected text:=$old$delete from public.close_activity_facts where source_type='custom_activity' and metric_date between p_start_date and p_end_date;
  get diagnostics v_deleted_custom=row_count;$old$; replacement text:=$new$select count(*) into v_deleted_custom from public.close_activity_facts where source_type='custom_activity' and metric_date between p_start_date and p_end_date;
  delete from public.close_activity_facts old where source_type='custom_activity' and metric_date between p_start_date and p_end_date and not exists(select 1 from jsonb_array_elements(p_facts) incoming where incoming->>'source_activity_id'=old.source_activity_id);$new$;
begin
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='reconcile_close_custom_and_won';
 if position(expected in definition)=0 then
  if position(replacement in definition)>0 then return;end if;
  raise exception 'Unexpected reconcile_close_custom_and_won definition; refusing unsafe patch';
 end if;
 execute replace(definition,expected,replacement);
end;$patch$;

-- Preserve scope/deletion guards; only rows absent from the full read are removed.
do $patch$
declare definition text; expected text:=$old$delete from public.close_raw_activities where activity_type='custom_activity'
    and (occurred_at at time zone 'Europe/Berlin')::date between p_start_date and p_end_date;$old$; replacement text:=$new$delete from public.close_raw_activities old where activity_type='custom_activity'
    and (occurred_at at time zone 'Europe/Berlin')::date between p_start_date and p_end_date and not exists(select 1 from jsonb_array_elements(p_raw) incoming where incoming->>'close_activity_id'=old.close_activity_id);$new$;
begin
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='reconcile_close_custom_and_won';
 if position(expected in definition)=0 then
  if position(replacement in definition)>0 then return;end if;
  raise exception 'Unexpected reconcile_close_custom_and_won definition; refusing unsafe patch';
 end if;
 execute replace(definition,expected,replacement);
end;$patch$;

-- Preserve scope/deletion guards; only rows absent from the full read are removed.
do $patch$
declare definition text; expected text:=$old$delete from public.close_opportunity_facts where won_date between p_start_date and p_end_date;
  get diagnostics v_deleted_won=row_count;$old$; replacement text:=$new$select count(*) into v_deleted_won from public.close_opportunity_facts where won_date between p_start_date and p_end_date;
  delete from public.close_opportunity_facts old where won_date between p_start_date and p_end_date and not exists(select 1 from jsonb_array_elements(p_opportunities) incoming where incoming->>'opportunity_id'=old.opportunity_id);$new$;
begin
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='reconcile_close_custom_and_won';
 if position(expected in definition)=0 then
  if position(replacement in definition)>0 then return;end if;
  raise exception 'Unexpected reconcile_close_custom_and_won definition; refusing unsafe patch';
 end if;
 execute replace(definition,expected,replacement);
end;$patch$;

-- Berlin local time, independent of the database UTC timezone and DST.
create or replace function public.close_sync_business_hours(p_at timestamptz)
returns boolean language sql immutable set search_path='' as $$
 select extract(isodow from p_at at time zone 'Europe/Berlin') between 1 and 5
 and (p_at at time zone 'Europe/Berlin')::time between time '07:30' and time '17:00';
$$;
revoke all on function public.close_sync_business_hours(timestamptz) from public,anon,authenticated;
-- Allow the morning run to catch the full pause (including Saturday activity).
-- This only re-reads retained dates; no historical backfill is introduced.
create or replace function public.close_sync_resume_date(p_at timestamptz,p_last_success timestamptz)
returns date language sql immutable set search_path='' as $$
 select greatest((date_trunc('month',p_at at time zone 'Europe/Berlin')-interval '2 months')::date,
 least((p_at at time zone 'Europe/Berlin')::date-1,
 coalesce((p_last_success at time zone 'Europe/Berlin')::date,(p_at at time zone 'Europe/Berlin')::date-3)));
$$;
revoke all on function public.close_sync_resume_date(timestamptz,timestamptz) from public,anon,authenticated;
do $schedule$
declare job_id bigint;
begin
 select jobid into strict job_id from cron.job where jobname='close_sync_every_15_minutes';
 -- UTC superset covers both CET/CEST. Guard runs before HTTP, so no overnight
 -- or weekend Edge/Close request, including on clock-change weekends.
 perform cron.alter_job(job_id,schedule:='*/5 5-16 * * 1-5',command:=$job$
 do $dispatch$
 begin
  if public.close_sync_business_hours(now()) then
   perform net.http_post(
    url:='https://pdobcvffnzqxtmkkpfnn.supabase.co/functions/v1/close-sync',
    headers:=jsonb_build_object('content-type','application/json','x-sync-secret',
     (select decrypted_secret from vault.decrypted_secrets where name='CLOSE_SYNC_SECRET')),
    body:=jsonb_build_object('mode','write','trigger','supabase-cron',
     'startDate',public.close_sync_resume_date(now(),(select max(started_at) from public.sync_runs where status='success'))::text,
     'endDate',(now() at time zone 'Europe/Berlin')::date::text),
    timeout_milliseconds:=145000);
  end if;
 end;$dispatch$;
 $job$);
end;$schedule$;
commit;
