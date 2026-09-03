begin;

-- Am 2026-09-03 im Team abgestimmt: volle Transparenz im Vertrieb. Umsatz,
-- Abschlüsse und Prognose sind für alle Angemeldeten sichtbar, es gibt keinen
-- getrennten Führungsbereich mehr. Die Spaltenbeschränkung von heute Vormittag
-- wird deshalb zurückgenommen.
--
-- Die Rolle `operator` bleibt bestehen, aber nur für den Sync-Status. Der ist
-- Betriebszustand und keine Vertriebskennzahl.

grant select on public.daily_sales_metrics to authenticated;

drop function if exists public.get_executive_metrics(text, date);

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
  m.deals_won,
  case when m.appointments = 0 then 0
    else round((m.deals_won::numeric / m.appointments) * 100, 2)
  end as win_rate,
  m.revenue_cents,
  m.newsletters,
  m.calculated_at
from public.daily_sales_metrics m
join public.sales_people p on p.id = m.sales_person_id
where p.active = true;

grant select on public.dashboard_daily_metrics to authenticated;

-- Eine Funktion für alles, was das Dashboard zeigt: Aktivität, Quoten, Umsatz
-- und die Prognose. Die Prognose ist eine lineare Hochrechnung auf Arbeitstage
-- und bewusst nachrechenbar. Wie belastbar sie ist, entscheidet die Anzeige
-- anhand der verstrichenen Arbeitstage, die deshalb mit zurückgegeben werden.
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
  deals_won bigint,
  win_rate numeric,
  revenue_cents numeric,
  total_workdays integer,
  elapsed_workdays integer,
  revenue_forecast_cents numeric,
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
      coalesce(sum(m.deals_won), 0)::bigint as deals_won,
      coalesce(sum(m.revenue_cents), 0)::numeric as revenue_cents,
      case when count(m.newsletters) = 0 then null else sum(m.newsletters)::bigint end as newsletters
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
    a.calls_gross, a.calls_net, a.talk_seconds,
    a.gatekeeper_contacts, a.connected_calls,
    case when a.gatekeeper_contacts = 0 then 0
      else round((a.connected_calls::numeric / a.gatekeeper_contacts) * 100, 2) end,
    a.direct_decision_maker_calls, a.decision_maker_contacts,
    case when a.calls_net = 0 then 0
      else round((a.decision_maker_contacts::numeric / a.calls_net) * 100, 2) end,
    a.appointments,
    case when a.decision_maker_contacts = 0 then 0
      else round((a.appointments::numeric / a.decision_maker_contacts) * 100, 2) end,
    a.setter_calls, a.setter_successes,
    case when a.setter_calls = 0 then 0
      else round((a.setter_successes::numeric / a.setter_calls) * 100, 2) end,
    a.closer_calls, a.closer_sales,
    case when a.closer_calls = 0 then 0
      else round((a.closer_sales::numeric / a.closer_calls) * 100, 2) end,
    a.no_shows, a.cancellations, a.rescheduled_appointments,
    a.deals_won,
    case when a.appointments = 0 then 0
      else round((a.deals_won::numeric / a.appointments) * 100, 2) end,
    a.revenue_cents,
    a.total_days, a.elapsed_days,
    case when a.elapsed_days = 0 then 0
      else round(a.revenue_cents / a.elapsed_days * a.total_days) end,
    a.newsletters
  from aggregated a
  order by a.sort_order;
$$;

revoke all on function public.get_dashboard_metrics(text, date) from public, anon;
grant execute on function public.get_dashboard_metrics(text, date) to authenticated;

commit;
