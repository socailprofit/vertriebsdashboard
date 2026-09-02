begin;

-- The sync function connects as service_role, but the foundation migration
-- created these tables without granting it anything. The first import failed
-- with 42501 on the very first insert: permission denied for table sync_runs.
--
-- Grant exactly what the write path performs and nothing more: the inserts, the
-- conflict updates behind the upserts, the select behind .select("id") on a new
-- sync run, and the closing status update. No delete is granted; rows are only
-- removed by cleanup_dashboard_history, which is security definer.
--
-- The revokes from anon and authenticated in the foundation migration stand:
-- dashboard users still reach nothing here, they read the views instead.

grant select, insert, update on public.sync_runs to service_role;
grant select, insert, update on public.close_raw_activities to service_role;
grant select, insert, update on public.close_activity_facts to service_role;
grant select, insert, update on public.close_opportunity_facts to service_role;

commit;
