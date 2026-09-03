-- Productive scheduler for the Close import.
--
-- Prerequisites outside Git (do these before this migration is deployed):
--   1. In Supabase Vault, create the encrypted secret CLOSE_SYNC_SECRET with
--      the exact current value of the Edge Function's CLOSE_SYNC_SECRET.
--
-- The secret is deliberately not present in this migration or any repository
-- file. The cron job retrieves it at execution time from Vault and sends it
-- only as the Edge Function's x-sync-secret header.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'CLOSE_SYNC_SECRET'
  ) then
    raise exception
      'Create the Vault secret CLOSE_SYNC_SECRET before deploying the Close scheduler migration.';
  end if;
end;
$$;

-- Make this migration repeat-safe for a restored project or a controlled
-- re-deploy: exactly one database-owned scheduler may exist.
select cron.unschedule(jobid)
from cron.job
where jobname = 'close_sync_every_15_minutes';

select cron.schedule(
  'close_sync_every_15_minutes',
  '7,22,37,52 * * * *',
  $cron$
    select net.http_post(
      url := 'https://pdobcvffnzqxtmkkpfnn.supabase.co/functions/v1/close-sync',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-sync-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'CLOSE_SYNC_SECRET'
        )
      ),
      body := jsonb_build_object(
        'mode', 'write',
        'trigger', 'supabase-cron',
        'startDate', ((now() at time zone 'Europe/Berlin')::date - 1)::text,
        'endDate', (now() at time zone 'Europe/Berlin')::date::text
      )
    );
  $cron$
);
