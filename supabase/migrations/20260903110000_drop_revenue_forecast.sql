begin;

-- Die Umsatzprognose wurde am 2026-09-03 verworfen. Eine lineare Hochrechnung
-- unterstellt gleichmäßige Verteilung, die es im Vertrieb nicht gibt: Ein
-- einzelner Abschluss verschiebt sie um ein Vielfaches. Sie sähe nach einer
-- Aussage aus, ohne eine zu sein.
--
-- Damit entfallen auch die Arbeitstage aus der Rückgabe; sie dienten
-- ausschließlich dazu, die Belastbarkeit der Prognose einzuschätzen. Umsatz,
-- Abschlüsse und Abschlussquote bleiben unverändert für alle sichtbar.

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
      b.start_date, b.end_date,
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
    a.newsletters
  from aggregated a
  order by a.sort_order;
$$;

revoke all on function public.get_dashboard_metrics(text, date) from public, anon;
grant execute on function public.get_dashboard_metrics(text, date) to authenticated;

commit;
