begin;

-- Die Rolle `operator` sieht in der Oberfläche den Zieleditor, durfte aber
-- nach den bisherigen Policies nicht schreiben. Das Formular hätte sich
-- bedienen lassen und beim Speichern abgelehnt — ein Fehler, der wie ein
-- Programmfehler aussieht, aber eine fehlende Berechtigung ist.
--
-- Operator ist die technisch führende Rolle und darf überall dort schreiben,
-- wo der Manager es darf. Umgekehrt bleibt der Sync-Status dem Operator
-- vorbehalten: Er ist Betriebszustand, keine Vertriebskennzahl.

drop policy if exists sales_targets_manager_insert on public.sales_targets;
create policy sales_targets_leads_insert
on public.sales_targets for insert
to authenticated
with check (public.current_app_role() in ('manager', 'operator') and created_by = auth.uid());

drop policy if exists sales_targets_manager_update on public.sales_targets;
create policy sales_targets_leads_update
on public.sales_targets for update
to authenticated
using (public.current_app_role() in ('manager', 'operator'))
with check (public.current_app_role() in ('manager', 'operator'));

drop policy if exists sales_targets_manager_delete on public.sales_targets;
create policy sales_targets_leads_delete
on public.sales_targets for delete
to authenticated
using (public.current_app_role() in ('manager', 'operator'));

drop policy if exists profiles_self_or_manager_read on public.profiles;
create policy profiles_self_or_leads_read
on public.profiles for select
to authenticated
using (user_id = auth.uid() or public.current_app_role() in ('manager', 'operator'));

drop policy if exists profiles_manager_update on public.profiles;
create policy profiles_leads_update
on public.profiles for update
to authenticated
using (public.current_app_role() in ('manager', 'operator'))
with check (public.current_app_role() in ('manager', 'operator'));

commit;
