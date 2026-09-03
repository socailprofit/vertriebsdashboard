begin;

-- Zeitraumvertrag für die gesamte Anwendung:
-- Tag = exakt der Stichtag, Woche = Kalender-Arbeitswoche Montag bis Freitag,
-- Monat = voller Kalendermonat ab dem Ersten. Die separate Trendansicht zeigt
-- zusätzlich den vorherigen und vorvorherigen Monat.
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
  net_rate numeric,
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
        when 'week' then (date_trunc('week', p_reference_date::timestamp) + interval '4 days')::date
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
    a.calls_gross, a.calls_net,
    case when a.calls_gross = 0 then 0
      else round((a.calls_net::numeric / a.calls_gross) * 100, 2) end,
    a.talk_seconds, a.gatekeeper_contacts, a.connected_calls,
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
    a.revenue_cents, a.newsletters
  from aggregated a
  order by a.sort_order;
$$;

revoke all on function public.get_dashboard_metrics(text, date) from public, anon;
grant execute on function public.get_dashboard_metrics(text, date) to authenticated;

drop view if exists public.dashboard_monthly_trends;

create view public.dashboard_monthly_trends
with (security_invoker = true)
as
with months as (
  select
    (date_trunc('month', now() at time zone 'Europe/Berlin') - (month_offset * interval '1 month'))::date as month_start
  from generate_series(0, 2) as offsets(month_offset)
), aggregated as (
  select
    months.month_start,
    p.slug,
    p.display_name,
    p.color,
    p.sort_order,
    coalesce(sum(m.calls_gross), 0)::bigint as calls_gross,
    coalesce(sum(m.calls_net), 0)::bigint as calls_net,
    coalesce(sum(m.gatekeeper_contacts), 0)::bigint as gatekeeper_contacts,
    coalesce(sum(m.connected_calls), 0)::bigint as connected_calls,
    coalesce(sum(m.decision_maker_contacts), 0)::bigint as decision_maker_contacts,
    coalesce(sum(m.appointments), 0)::bigint as appointments
  from months
  cross join public.sales_people p
  left join public.daily_sales_metrics m
    on m.sales_person_id = p.id
    and m.metric_date >= months.month_start
    and m.metric_date < (months.month_start + interval '1 month')::date
  where p.active = true
  group by months.month_start, p.id, p.slug, p.display_name, p.color, p.sort_order
)
select
  month_start,
  slug,
  display_name,
  color,
  calls_gross,
  calls_net,
  case when calls_gross = 0 then 0
    else round((calls_net::numeric / calls_gross) * 100, 2)
  end as net_rate,
  gatekeeper_contacts,
  connected_calls,
  case when gatekeeper_contacts = 0 then 0
    else round((connected_calls::numeric / gatekeeper_contacts) * 100, 2)
  end as connection_rate,
  decision_maker_contacts,
  appointments,
  case when decision_maker_contacts = 0 then 0
    else round((appointments::numeric / decision_maker_contacts) * 100, 2)
  end as appointment_rate
from aggregated
order by month_start desc, sort_order;

grant select on public.dashboard_monthly_trends to authenticated;

-- Stündliche Quoten stammen ausschließlich aus Fakten derselben lokalen Stunde.
-- Nettoquote = angenommene Netto-Anrufe / finale ausgehende Anrufe.
-- Durchstellquote = Durchstellungen / dokumentierte Vorzimmer-Kontakte.
-- Es wird nie ein Mittel aus Einzelprozenten gebildet.
drop function if exists public.get_call_hour_performance(text, date);

create function public.get_call_hour_performance(
  p_period text,
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
)
returns table (
  period_start date,
  period_end date,
  slug text,
  display_name text,
  color text,
  metric_hour smallint,
  calls_gross bigint,
  calls_net bigint,
  net_rate numeric,
  gatekeeper_contacts bigint,
  connected_calls bigint,
  transfer_rate numeric
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
        when 'week' then (date_trunc('week', p_reference_date::timestamp) + interval '4 days')::date
        when 'month' then (date_trunc('month', p_reference_date::timestamp) + interval '1 month - 1 day')::date
        when 'trend' then (date_trunc('month', p_reference_date::timestamp) + interval '1 month - 1 day')::date
      end as end_date
    where p_period in ('day', 'week', 'month', 'trend')
  ), hours as (
    select generate_series(0, 23)::smallint as metric_hour
  ), aggregated as (
    select
      b.start_date, b.end_date,
      p.slug, p.display_name, p.color, p.sort_order,
      h.metric_hour,
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
    group by b.start_date, b.end_date, p.id, p.slug, p.display_name, p.color, p.sort_order, h.metric_hour
  )
  select
    a.start_date, a.end_date, a.slug, a.display_name, a.color, a.metric_hour,
    a.calls_gross, a.calls_net,
    case when a.calls_gross = 0 then 0
      else round((a.calls_net::numeric / a.calls_gross) * 100, 2) end,
    a.gatekeeper_contacts, a.connected_calls,
    case when a.gatekeeper_contacts = 0 then 0
      else round((a.connected_calls::numeric / a.gatekeeper_contacts) * 100, 2) end
  from aggregated a
  order by a.sort_order, a.metric_hour;
$$;

revoke all on function public.get_call_hour_performance(text, date) from public, anon;
grant execute on function public.get_call_hour_performance(text, date) to authenticated;

commit;
