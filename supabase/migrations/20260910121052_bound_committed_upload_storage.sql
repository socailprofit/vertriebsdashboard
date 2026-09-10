begin;
-- Maintenance only: the existing RPC deletes transport chunks exclusively for
-- atomically committed uploads, skips locked chunks and retains the cached
-- commit result for safe retries. No KPI/history/active-upload table is pruned.
-- Run independently of the Edge Function's deadline, so successful imports do
-- not accumulate payloads when their best-effort cleanup runs out of time.
-- 128 chunks per five minutes exceeds the normal ~70 per 15-minute import.
-- This does NOT change the Close import schedule or add Edge Function calls.
select cron.schedule(
 'cleanup_committed_close_uploads',
 '4-59/5 * * * *',
 $job$set local statement_timeout='5s'; set local lock_timeout='1s'; select public.cleanup_close_funnel_upload_chunks(128);$job$
);
commit;
