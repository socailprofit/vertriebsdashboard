# Supabase Cron for Close Sync

## Current Truth

- The productive scheduler runs every five minutes. Its existing internal name `close_sync_every_15_minutes` is retained to keep operational references intact.
- It invokes `close-sync` every five minutes at minutes 2, 7, 12, …, 57, imports yesterday and today in `Europe/Berlin`, and marks the run as `supabase-cron`.
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

- 2026-09-16: Corrected All Calls mapping for Michael/Felix. Calls use the actual `activity_at` window; today and yesterday are re-read every five minutes, so an in-progress call or concurrent edit is picked up by the next complete read. Existing source pagination retry, import deadlines and atomic funnel publication remain in place.
