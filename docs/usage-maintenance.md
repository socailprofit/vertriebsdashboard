# Usage maintenance, 10 September 2026

The dashboard subscribes only to target edits and successful sync updates
(`UPDATE`, server filter `status=eq.success`). Individual daily metric rewrites
and import checkpoints do not generate dashboard subscriptions. The existing
90-second foreground polling/recovery path remains available when Realtime is
unavailable. Neither metric reads nor authorization nor KPI calculations changed.

The database job `cleanup_committed_close_uploads` calls the existing bounded
cleanup RPC every five minutes, offset from the Close import. It removes at most
128 transport chunks per transaction, only from atomically committed uploads.
It has a five-second statement deadline and one-second lock deadline. The RPC
skips locked chunks. Commit manifests/results and uploading chunks are retained,
so upload retries and publication keep their existing behavior. The actual
Close sync remains every 15 minutes. No additional Edge Function is invoked.

KPI values remain in `daily_sales_metrics` and `monthly_kpi_snapshots`; existing
activity facts, booking history, status history and process evidence are retained.
No retention period was shortened. Transport chunks are not reporting inputs
after successful publication. Deleting them makes database space reusable;
Postgres and the delayed usage display need not show a smaller allocated file
immediately. No blocking VACUUM FULL or table rewrite was performed.

Validation: 315 application tests passed. `tests/usage-maintenance.sql` runs in
a rolled-back transaction, checking the batch bound, preservation of a synthetic
active upload, unchanged hashes for nine reporting tables and blocked browser
access to the cleanup RPC. Initial production backlog was drained in bounded
batches with the same reporting checks; zero chunks remained afterward.

Rollback: revert the scoped frontend commit and use
`select cron.unschedule('cleanup_committed_close_uploads');` if needed. No KPI
restoration is required. Already removed committed transport copies are no
longer required by the idempotent finalizer.

The security advisor still reports existing protected internal tables without
browser policies and authenticated reporting RPCs; this change adds no grants,
tables, definer functions or authentication changes. Advisor explanations:
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

This maintenance does not change the separate source-consistency guard that
can reject an import when CRM records change during collection.
