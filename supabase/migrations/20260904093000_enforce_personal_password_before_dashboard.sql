begin;

-- Stufe 2 von 2: Erst anwenden, nachdem die Passwortseite auf GitHub Pages
-- geladen und mit einem bestehenden Konto geprüft wurde. Alle vorhandenen
-- Konten verlieren bis zur persönlichen Passwort-Einrichtung den Datenzugang.
update public.profiles
set must_change_password = true
where must_change_password = false;

-- Rollen zählen erst nach dem persönlichen Passwort. Das schützt zugleich
-- Führungsfunktionen und alle Policies, die sich auf die Rolle stützen.
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.profiles
  where user_id = auth.uid()
    and must_change_password = false;
$$;

revoke all on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated;

-- Neue, von einem Admin eingeladene Konten bleiben ebenfalls gesperrt, bis
-- sie ihr persönliches Passwort gesetzt haben.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, role, must_change_password)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'User'
    ),
    'sales',
    true
  );
  return new;
end;
$$;

-- Das eigene Profil bleibt für die Passwortseite lesbar. Alle erweiterten
-- Profileinsichten bleiben bis nach der persönlichen Einrichtung gesperrt.
drop policy if exists profiles_self_or_manager_read on public.profiles;
drop policy if exists profiles_self_or_leads_read on public.profiles;
create policy profiles_self_or_leads_read
on public.profiles for select
to authenticated
using (
  user_id = auth.uid()
  or (
    public.has_dashboard_access()
    and public.current_app_role() in ('manager', 'operator')
  )
);

drop policy if exists profiles_manager_update on public.profiles;
drop policy if exists profiles_leads_update on public.profiles;
create policy profiles_leads_update
on public.profiles for update
to authenticated
using (
  public.has_dashboard_access()
  and public.current_app_role() in ('manager', 'operator')
)
with check (
  public.has_dashboard_access()
  and public.current_app_role() in ('manager', 'operator')
);

drop policy if exists sales_people_authenticated_read on public.sales_people;
create policy sales_people_authenticated_read
on public.sales_people for select
to authenticated
using (public.has_dashboard_access());

drop policy if exists sales_targets_authenticated_read on public.sales_targets;
create policy sales_targets_authenticated_read
on public.sales_targets for select
to authenticated
using (public.has_dashboard_access());

drop policy if exists sales_targets_manager_insert on public.sales_targets;
drop policy if exists sales_targets_leads_insert on public.sales_targets;
create policy sales_targets_leads_insert
on public.sales_targets for insert
to authenticated
with check (
  public.has_dashboard_access()
  and public.current_app_role() in ('manager', 'operator')
  and created_by = auth.uid()
);

drop policy if exists sales_targets_manager_update on public.sales_targets;
drop policy if exists sales_targets_leads_update on public.sales_targets;
create policy sales_targets_leads_update
on public.sales_targets for update
to authenticated
using (
  public.has_dashboard_access()
  and public.current_app_role() in ('manager', 'operator')
)
with check (
  public.has_dashboard_access()
  and public.current_app_role() in ('manager', 'operator')
);

drop policy if exists sales_targets_manager_delete on public.sales_targets;
drop policy if exists sales_targets_leads_delete on public.sales_targets;
create policy sales_targets_leads_delete
on public.sales_targets for delete
to authenticated
using (
  public.has_dashboard_access()
  and public.current_app_role() in ('manager', 'operator')
);

drop policy if exists daily_sales_metrics_authenticated_read on public.daily_sales_metrics;
create policy daily_sales_metrics_authenticated_read
on public.daily_sales_metrics for select
to authenticated
using (public.has_dashboard_access());

drop policy if exists daily_summaries_authenticated_read on public.daily_summaries;
create policy daily_summaries_authenticated_read
on public.daily_summaries for select
to authenticated
using (public.has_dashboard_access());

-- Monatsabschlüsse bleiben ausschließlich im Backend. Der Browser erhält
-- weder Tabellenrechte noch eine RLS-Policy auf diese Archivdaten.
drop policy if exists monthly_kpi_snapshots_authenticated_read on public.monthly_kpi_snapshots;
revoke all on public.monthly_kpi_snapshots from anon, authenticated;

-- Diese Funktion liest Roh-Fakten mit definer-Rechten. Daher erhält sie eine
-- explizite Zugangssperre innerhalb des SQL, nicht nur über das Frontend.
create or replace function public.get_call_hour_performance(
  p_period text,
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
)
returns table (
  period_start date, period_end date, slug text, display_name text, color text,
  metric_hour smallint, calls_gross bigint, calls_net bigint, net_rate numeric,
  gatekeeper_contacts bigint, connected_calls bigint, transfer_rate numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      case p_period
        when 'day' then p_reference_date
        when 'week' then date_trunc('week', p_reference_date::timestamp)::date
        when 'month' then date_trunc('month', p_reference_date::timestamp)::date
        when 'trend' then (date_trunc('month', p_reference_date::timestamp) - interval '2 months')::date
      end as start_date,
      case p_period
        when 'day' then p_reference_date
        when 'week' then least(
          (date_trunc('week', p_reference_date::timestamp) + interval '4 days')::date,
          p_reference_date
        )
        when 'month' then least(
          (date_trunc('month', p_reference_date::timestamp) + interval '1 month - 1 day')::date,
          p_reference_date
        )
        when 'trend' then (date_trunc('month', p_reference_date::timestamp) + interval '1 month - 1 day')::date
      end as end_date
    where p_period in ('day', 'week', 'month', 'trend')
  ), hours as (
    select generate_series(0, 23)::smallint as metric_hour
  ), aggregated as (
    select
      b.start_date, b.end_date,
      p.slug, p.display_name, p.color, p.sort_order, h.metric_hour,
      coalesce(sum(f.calls_gross), 0)::bigint as calls_gross,
      coalesce(sum(f.calls_net), 0)::bigint as calls_net,
      coalesce(sum(f.gatekeeper_contacts), 0)::bigint as gatekeeper_contacts,
      coalesce(sum(f.connected_calls), 0)::bigint as connected_calls
    from bounds b
    cross join public.sales_people p
    cross join hours h
    left join public.close_activity_facts f
      on f.close_user_id = p.close_user_id
      and f.metric_date between b.start_date and b.end_date
      and f.metric_hour = h.metric_hour
    where p.active = true
      and public.has_dashboard_access()
    group by b.start_date, b.end_date, p.id, p.slug, p.display_name, p.color, p.sort_order, h.metric_hour
  )
  select
    a.start_date, a.end_date, a.slug, a.display_name, a.color, a.metric_hour,
    a.calls_gross, a.calls_net,
    case when a.calls_gross = 0 then 0 else round((a.calls_net::numeric / a.calls_gross) * 100, 2) end,
    a.gatekeeper_contacts, a.connected_calls,
    case when a.gatekeeper_contacts = 0 then 0 else round((a.connected_calls::numeric / a.gatekeeper_contacts) * 100, 2) end
  from aggregated a
  order by a.sort_order, a.metric_hour;
$$;

revoke all on function public.get_call_hour_performance(text, date) from public, anon;
grant execute on function public.get_call_hour_performance(text, date) to authenticated;

commit;
