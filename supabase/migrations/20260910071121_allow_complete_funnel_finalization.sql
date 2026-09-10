begin;
-- Successful finalizers already approach the former 20s limit. Allow one bounded
-- 40s transaction instead of repeatedly rolling back a nearly complete import.
-- The Edge upload deadline (60s) and cron request deadline (145s) remain bounded.
alter function public.finalize_close_funnel_upload(uuid) set statement_timeout='40s';
notify pgrst,'reload schema';
notify pgrst,'reload config';
commit;
