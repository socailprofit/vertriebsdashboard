begin;

-- The service-only batch finalizer needs more than the inherited 8-second
-- interactive API limit. PostgREST hoists this setting for this RPC only.
-- https://supabase.com/docs/guides/database/postgres/timeouts#function-level
alter function public.finalize_close_funnel_upload(uuid) set statement_timeout = '20s';

-- Keep the existing job, schedule, source window and secret reference. Its
-- caller must wait through the bounded Edge run instead of stopping at 120s.
do $$
declare v_job record;
begin
 select jobid,command into strict v_job from cron.job where jobname='close_sync_every_15_minutes';
 if position('timeout_milliseconds := 120000' in v_job.command)>0 then
  perform cron.alter_job(v_job.jobid,command:=replace(v_job.command,'timeout_milliseconds := 120000','timeout_milliseconds := 145000'));
 elsif position('timeout_milliseconds := 145000' in v_job.command)=0 then
  raise exception 'Unexpected Close sync caller timeout';
 end if;
end;$$;
notify pgrst,'reload schema';
notify pgrst,'reload config';

commit;
