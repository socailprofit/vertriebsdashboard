# Supabase Cron for Close Sync

## Current Truth

- The productive scheduler runs every five minutes on Monday–Friday, 07:30–17:00 Europe/Berlin (including the 17:00 dispatch). Its existing internal name `close_sync_every_15_minutes` is retained to keep operational references intact.
- It invokes `close-sync` at minutes 0, 5, …, 55 inside that window and marks the run as `supabase-cron`. A Berlin-time guard runs before HTTP dispatch; UTC cron hours cover both CET and CEST. No scheduled Close/Edge calls happen overnight or on weekends.
- The next run re-reads from the earlier of yesterday and the last successful run date. The Monday morning run therefore includes Friday, Saturday and Sunday; existing source-window, retention and complete-read guards remain intact.
- GitHub Actions remains for dry runs, controlled write imports and a manual fallback only. It no longer schedules production imports.
- The job needs the encrypted Supabase Vault secret `CLOSE_SYNC_SECRET`. Its value must exactly match the existing `CLOSE_SYNC_SECRET` in Supabase Edge Function Secrets and GitHub Actions Secrets.

## Verification

- The migration enables `pg_cron` and `pg_net` idempotently. Confirm that the Supabase Cron integration remains installed after deployment.
- After deployment, observe the first successful job in Supabase Cron history and compare one written day with Close before treating the scheduler as productive.

## Sources

- `supabase/migrations/20260903150000_schedule_close_sync_with_supabase_cron.sql`
- `supabase/functions/close-sync/index.ts`
- Supabase Dashboard: Integrations → Cron, Integrations → Vault

## Timeline

- 2026-09-03: GitHub's automated schedule emitted no runs despite an active workflow; replaced as the production scheduler by this database-owned design.

- 2026-09-16: Corrected All Calls mapping for Michael/Felix. Close rejects `activity_at` filters on its type endpoint. The existing creation-time fetch buffer therefore stays intact; the importer assigns day/hour exclusively by `activity_at`. Today and yesterday are re-read every five minutes, so an in-progress call or concurrent edit is picked up by the next complete read. Existing source pagination retry, import deadlines and atomic funnel publication remain in place.

## Write optimization (2026-09-17)

- Full source reads and atomic publication stay authoritative. Existing custom facts/raw rows and opportunities are deleted only if absent from the complete read in the declared scope, then upserted.
- `skip_unchanged_close_row` avoids physical updates for identical Call/custom facts, raw activities, opportunities, meetings, history revisions and process relations. Only bookkeeping `ingested_at`, `mapped_at` or `last_seen_at` is excluded from equality for its specific table. Real content, caller, date, outcome, version, removed/withdrawn/retired state changes still write. Existing validation triggers run first.
- For these rows the bookkeeping timestamp now records the last material write/observation. The shared `close_reconciliation_state` marks the latest complete read. Task rows deliberately keep their per-run `last_seen_at` for strict task coverage confirmation.
- Calendar relationship validation checks presence in the fully validated staged meeting snapshot rather than forcing an update of every unchanged meeting timestamp. Meeting time changes still create the existing revision record.
- Lead metadata, daily KPI calculation and upload staging/cleanup stay as before. This is a focused reduction of write amplification, not a change to counting rules or dashboard files.
- Regression: `SYNC_IO_TEST=1 node tests/verify-funnel-history.mjs <pglite-module-path>` exercises identical-read physical row identity, changes, deletions, reactivation, atomic rollback, task coverage, permissions, summer/winter schedule boundaries and weekend catch-up.

### Live verification, 17 September 2026

- Manual daytime dispatch `5cfa1b86-c095-4a3d-8977-a7fefad992be` succeeded at 08:26:54 Berlin; automatic dispatch `b02f79c8-9c74-41b8-8cbd-7b6f225fb90d` succeeded at 08:31:25.
- Across these two complete imports, PostgreSQL counters for raw activities, activity facts, funnel events, meetings, processes and their two relation tables increased by 11 inserts, 47 updates and zero deletes. Unchanged meetings and process relations had zero updates. This measures physical row writes in those seven tables, not total Disk I/O or upload staging.
- After completion, gross/net calls, decision-maker contacts and appointments matched their source facts for both active callers on 16–17 September: four person-days, zero mismatches. No dashboard or KPI formula files changed.
- 340 application tests and the SQL history/I/O integration checks passed. Security advisor findings were unchanged.
