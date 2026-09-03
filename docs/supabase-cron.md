# Supabase Cron for Close Sync

## Current Truth

- The productive scheduler is a Supabase Cron job named `close_sync_every_15_minutes`.
- It invokes `close-sync` at minute 7, 22, 37 and 52, imports yesterday and today in `Europe/Berlin`, and marks the run as `supabase-cron`.
- GitHub Actions remains for dry runs, controlled write imports and a manual fallback only. It no longer schedules production imports.
- The job needs the encrypted Supabase Vault secret `CLOSE_SYNC_SECRET`. Its value must exactly match the existing `CLOSE_SYNC_SECRET` in Supabase Edge Function Secrets and GitHub Actions Secrets.

## Missing Context

- The migration enables `pg_cron` and `pg_net` idempotently. Confirm that the Supabase Cron integration remains installed after deployment.
- After deployment, observe the first successful job in Supabase Cron history and compare one written day with Close before treating the scheduler as productive.

## Sources

- `supabase/migrations/20260903150000_schedule_close_sync_with_supabase_cron.sql`
- `supabase/functions/close-sync/index.ts`
- Supabase Dashboard: Integrations → Cron, Integrations → Vault

## Timeline

- 2026-09-03: GitHub's automated schedule emitted no runs despite an active workflow; replaced as the production scheduler by this database-owned design.
