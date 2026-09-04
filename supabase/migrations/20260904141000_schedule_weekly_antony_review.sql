-- Montags wird die letzte vollständig abgeschlossene Vertriebswoche (Mo-Fr)
-- analysiert. pg_cron läuft in UTC: 07:10 UTC entspricht in Berlin 08:10 im
-- Winter und 09:10 im Sommer. Der 15-Minuten-Close-Sync von 06:52 UTC ist dann
-- abgeschlossen. Die Edge Function und die Unique-Regel verhindern Duplikate.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'CLOSE_SYNC_SECRET'
  ) then
    raise exception 'Vault secret CLOSE_SYNC_SECRET is required for the weekly review scheduler.';
  end if;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'antony_weekly_review';

select cron.schedule(
  'antony_weekly_review',
  '10 7 * * 1',
  $cron$
    select net.http_post(
      url := 'https://pdobcvffnzqxtmkkpfnn.supabase.co/functions/v1/weekly-review',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-sync-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'CLOSE_SYNC_SECRET'
        )
      ),
      body := jsonb_build_object('trigger', 'supabase-cron')
    );
  $cron$
);
