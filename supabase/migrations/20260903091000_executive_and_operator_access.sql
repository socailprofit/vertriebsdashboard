begin;

-- Drei Rollen mit klar getrennten Aufgaben:
--
--   sales     Michael und Felix. Eigene Zahlen und der Wettbewerb.
--   manager   Antony als Geschäftsführung. Zusätzlich Ziele und die
--             Führungskennzahlen: Umsatz, Abschlüsse, Prognose, Quotenlücken.
--   operator  Technischer Betrieb. Zusätzlich der Zustand des Syncs.
--
-- Der Sync-Status gehört nicht zur Geschäftsführung. Ob ein Importlauf
-- durchlief, ist eine Betriebsfrage, keine Vertriebskennzahl.
drop policy if exists sync_runs_manager_read on public.sync_runs;

create policy sync_runs_operator_read
on public.sync_runs for select
to authenticated
using (public.current_app_role() = 'operator');

-- Umsatz und Abschlüsse waren bisher für jede angemeldete Person lesbar; sie
-- wurden lediglich nicht angezeigt. Das ist keine Zugriffsbeschränkung, sondern
-- eine Anzeigeentscheidung. Ab hier entzieht die Datenbank diese beiden Spalten
-- allen Angemeldeten und gibt sie nur noch über eine rollengeprüfte Funktion
-- heraus. Die Zeilen selbst bleiben lesbar, die Policy ändert sich nicht.
revoke select on public.daily_sales_metrics from authenticated;

grant select (
  metric_date, sales_person_id, calls_gross, calls_net, talk_seconds,
  gatekeeper_contacts, connected_calls, direct_decision_maker_calls,
  decision_maker_contacts, appointments, setter_calls, setter_successes,
  closer_calls, closer_sales, no_shows, cancellations,
  rescheduled_appointments, newsletters, calculated_at
) on public.daily_sales_metrics to authenticated;

-- Die Ansicht läuft mit den Rechten des Aufrufers und darf die entzogenen
-- Spalten deshalb nicht mehr auswählen.
drop view if exists public.dashboard_daily_metrics;

create view public.dashboard_daily_metrics
with (security_invoker = true)
as
select
  m.metric_date,
  p.slug,
  p.display_name,
  p.color,
  m.calls_gross,
  m.calls_net,
  m.talk_seconds,
  m.gatekeeper_contacts,
  m.connected_calls,
  case when m.gatekeeper_contacts = 0 then 0
    else round((m.connected_calls::numeric / m.gatekeeper_contacts) * 100, 2)
  end as connection_rate,
  m.direct_decision_maker_calls,
  m.decision_maker_contacts,
  m.appointments,
  case when m.decision_maker_contacts = 0 then 0
    else round((m.appointments::numeric / m.decision_maker_contacts) * 100, 2)
  end as appointment_rate,
  m.setter_calls,
  m.setter_successes,
  m.closer_calls,
  m.closer_sales,
  m.no_shows,
  m.cancellations,
  m.rescheduled_appointments,
  m.newsletters,
  m.calculated_at
from public.daily_sales_metrics m
join public.sales_people p on p.id = m.sales_person_id
where p.active = true;

grant select on public.dashboard_daily_metrics to authenticated;

-- Dieselbe Bereinigung für die Kennzahlenfunktion des Dashboards: ohne
-- deals_won, period_win_rate und revenue_cents. Das Frontend liest sie ohnehin
-- nicht mehr, und ein direkter Aufruf soll sie nicht zurückgeben.
drop function if exists public.get_dashboard_metrics(text, date);

create function public.get_dashboard_metrics(
  p_period text,
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
)
returns table (
  period_start date,
  period_end date,
  slug text,
  display_name text,
  color text,
  calls_gross bigint,
  calls_net bigint,
  talk_seconds bigint,
  gatekeeper_contacts bigint,
  connected_calls bigint,
  connection_rate numeric,
  direct_decision_maker_calls bigint,
  decision_maker_contacts bigint,
  decision_maker_rate numeric,
  appointments bigint,
  appointment_rate numeric,
  setter_calls bigint,
  setter_successes bigint,
  setter_success_rate numeric,
  closer_calls bigint,
  closer_sales bigint,
  closer_success_rate numeric,
  no_shows bigint,
  cancellations bigint,
  rescheduled_appointments bigint,
  newsletters bigint
)
language sql
stable
set search_path = ''
as $$
  with bounds as (
    select
      case p_period
        when 'day' then p_reference_date
        when 'week' then date_trunc('week', p_reference_date::timestamp)::date
        when 'month' then date_trunc('month', p_reference_date::timestamp)::date
      end as start_date,
      case p_period
        when 'day' then p_reference_date
        when 'week' then (date_trunc('week', p_reference_date::timestamp) + interval '6 days')::date
        when 'month' then (date_trunc('month', p_reference_date::timestamp) + interval '1 month - 1 day')::date
      end as end_date
    where p_period in ('day', 'week', 'month')
  ), aggregated as (
    select
      b.start_date,
      b.end_date,
      p.slug,
      p.display_name,
      p.color,
      p.sort_order,
      coalesce(sum(m.calls_gross), 0)::bigint as calls_gross,
      coalesce(sum(m.calls_net), 0)::bigint as calls_net,
      coalesce(sum(m.talk_seconds), 0)::bigint as talk_seconds,
      coalesce(sum(m.gatekeeper_contacts), 0)::bigint as gatekeeper_contacts,
      coalesce(sum(m.connected_calls), 0)::bigint as connected_calls,
      coalesce(sum(m.direct_decision_maker_calls), 0)::bigint as direct_decision_maker_calls,
      coalesce(sum(m.decision_maker_contacts), 0)::bigint as decision_maker_contacts,
      coalesce(sum(m.appointments), 0)::bigint as appointments,
      coalesce(sum(m.setter_calls), 0)::bigint as setter_calls,
      coalesce(sum(m.setter_successes), 0)::bigint as setter_successes,
      coalesce(sum(m.closer_calls), 0)::bigint as closer_calls,
      coalesce(sum(m.closer_sales), 0)::bigint as closer_sales,
      coalesce(sum(m.no_shows), 0)::bigint as no_shows,
      coalesce(sum(m.cancellations), 0)::bigint as cancellations,
      coalesce(sum(m.rescheduled_appointments), 0)::bigint as rescheduled_appointments,
      case when count(m.newsletters) = 0 then null else sum(m.newsletters)::bigint end as newsletters
    from bounds b
    cross join public.sales_people p
    left join public.daily_sales_metrics m
      on m.sales_person_id = p.id
      and m.metric_date between b.start_date and b.end_date
    where p.active = true
    group by b.start_date, b.end_date, p.id, p.slug, p.display_name, p.color, p.sort_order
  )
  select
    a.start_date, a.end_date, a.slug, a.display_name, a.color,
    a.calls_gross, a.calls_net, a.talk_seconds,
    a.gatekeeper_contacts, a.connected_calls,
    case when a.gatekeeper_contacts = 0 then 0
      else round((a.connected_calls::numeric / a.gatekeeper_contacts) * 100, 2)
    end,
    a.direct_decision_maker_calls, a.decision_maker_contacts,
    case when a.calls_net = 0 then 0
      else round((a.decision_maker_contacts::numeric / a.calls_net) * 100, 2)
    end,
    a.appointments,
    case when a.decision_maker_contacts = 0 then 0
      else round((a.appointments::numeric / a.decision_maker_contacts) * 100, 2)
    end,
    a.setter_calls, a.setter_successes,
    case when a.setter_calls = 0 then 0
      else round((a.setter_successes::numeric / a.setter_calls) * 100, 2)
    end,
    a.closer_calls, a.closer_sales,
    case when a.closer_calls = 0 then 0
      else round((a.closer_sales::numeric / a.closer_calls) * 100, 2)
    end,
    a.no_shows, a.cancellations, a.rescheduled_appointments, a.newsletters
  from aggregated a
  order by a.sort_order;
$$;

revoke all on function public.get_dashboard_metrics(text, date) from public, anon;
grant execute on function public.get_dashboard_metrics(text, date) to authenticated;

-- Führungskennzahlen. Läuft mit erhöhten Rechten und prüft die Rolle deshalb
-- selbst, statt sich auf das Frontend zu verlassen.
--
-- Die Prognose ist eine lineare Hochrechnung auf Arbeitstage: bisheriger Umsatz
-- geteilt durch die verstrichenen Arbeitstage, multipliziert mit den gesamten.
-- Bewusst simpel und nachrechenbar. Sie unterstellt gleichmäßige Verteilung und
-- ist am Monatsanfang entsprechend grob.
create or replace function public.get_executive_metrics(
  p_period text default 'month',
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
)
returns table (
  period_start date,
  period_end date,
  slug text,
  display_name text,
  color text,
  deals_won bigint,
  revenue_cents numeric,
  appointments bigint,
  win_rate numeric,
  connection_rate numeric,
  decision_maker_rate numeric,
  appointment_rate numeric,
  total_workdays integer,
  elapsed_workdays integer,
  revenue_forecast_cents numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('manager', 'operator') then
    raise exception 'Führungskennzahlen erfordern die Rolle manager oder operator'
      using errcode = '42501';
  end if;

  return query
  with bounds as (
    select
      case p_period
        when 'day' then p_reference_date
        when 'week' then date_trunc('week', p_reference_date::timestamp)::date
        when 'month' then date_trunc('month', p_reference_date::timestamp)::date
      end as start_date,
      case p_period
        when 'day' then p_reference_date
        when 'week' then (date_trunc('week', p_reference_date::timestamp) + interval '6 days')::date
        when 'month' then (date_trunc('month', p_reference_date::timestamp) + interval '1 month - 1 day')::date
      end as end_date
    where p_period in ('day', 'week', 'month')
  ), workdays as (
    select
      b.start_date,
      b.end_date,
      (select count(*) from generate_series(b.start_date, b.end_date, interval '1 day') d
        where extract(isodow from d) < 6)::integer as total_days,
      (select count(*) from generate_series(
          b.start_date,
          least(b.end_date, (now() at time zone 'Europe/Berlin')::date),
          interval '1 day') d
        where extract(isodow from d) < 6)::integer as elapsed_days
    from bounds b
  ), aggregated as (
    select
      w.start_date, w.end_date, w.total_days, w.elapsed_days,
      p.slug, p.display_name, p.color, p.sort_order,
      coalesce(sum(m.deals_won), 0)::bigint as deals_won,
      coalesce(sum(m.revenue_cents), 0)::numeric as revenue_cents,
      coalesce(sum(m.appointments), 0)::bigint as appointments,
      coalesce(sum(m.gatekeeper_contacts), 0)::bigint as gatekeeper_contacts,
      coalesce(sum(m.connected_calls), 0)::bigint as connected_calls,
      coalesce(sum(m.calls_net), 0)::bigint as calls_net,
      coalesce(sum(m.decision_maker_contacts), 0)::bigint as decision_maker_contacts
    from workdays w
    cross join public.sales_people p
    left join public.daily_sales_metrics m
      on m.sales_person_id = p.id
      and m.metric_date between w.start_date and w.end_date
    where p.active = true
    group by w.start_date, w.end_date, w.total_days, w.elapsed_days,
             p.id, p.slug, p.display_name, p.color, p.sort_order
  )
  select
    a.start_date, a.end_date, a.slug, a.display_name, a.color,
    a.deals_won, a.revenue_cents, a.appointments,
    case when a.appointments = 0 then 0
      else round((a.deals_won::numeric / a.appointments) * 100, 2) end,
    case when a.gatekeeper_contacts = 0 then 0
      else round((a.connected_calls::numeric / a.gatekeeper_contacts) * 100, 2) end,
    case when a.calls_net = 0 then 0
      else round((a.decision_maker_contacts::numeric / a.calls_net) * 100, 2) end,
    case when a.decision_maker_contacts = 0 then 0
      else round((a.appointments::numeric / a.decision_maker_contacts) * 100, 2) end,
    a.total_days, a.elapsed_days,
    case when a.elapsed_days = 0 then 0
      else round(a.revenue_cents / a.elapsed_days * a.total_days) end
  from aggregated a
  order by a.sort_order;
end;
$$;

revoke all on function public.get_executive_metrics(text, date) from public, anon;
grant execute on function public.get_executive_metrics(text, date) to authenticated;

commit;
