begin;

-- auth.jwt() wird als initplan einmal je Abfrage ausgewertet. Das behaelt die
-- bestehende Berechtigung bei und verhindert eine erneute Auswertung je Zeile.
drop policy if exists antony_performance_goals_leads_insert on public.antony_performance_goals;
create policy antony_performance_goals_leads_insert
on public.antony_performance_goals for insert
to authenticated
with check (
  owner_user_id = (select auth.uid())
  and (select public.has_dashboard_access())
  and (
    lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'rigone@socialprofit.de'
    or (select public.current_app_role()) in ('manager', 'operator')
  )
);

drop policy if exists antony_performance_goals_leads_update on public.antony_performance_goals;
create policy antony_performance_goals_leads_update
on public.antony_performance_goals for update
to authenticated
using (
  owner_user_id = (select auth.uid())
  and (select public.has_dashboard_access())
  and (
    lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'rigone@socialprofit.de'
    or (select public.current_app_role()) in ('manager', 'operator')
  )
)
with check (
  owner_user_id = (select auth.uid())
  and (select public.has_dashboard_access())
  and (
    lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'rigone@socialprofit.de'
    or (select public.current_app_role()) in ('manager', 'operator')
  )
);

drop policy if exists antony_performance_goals_leads_delete on public.antony_performance_goals;
create policy antony_performance_goals_leads_delete
on public.antony_performance_goals for delete
to authenticated
using (
  owner_user_id = (select auth.uid())
  and (select public.has_dashboard_access())
  and (
    lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'rigone@socialprofit.de'
    or (select public.current_app_role()) in ('manager', 'operator')
  )
);

commit;
