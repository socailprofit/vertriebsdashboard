begin;

-- Die besten Anrufzeiten sollen auch über die Drei-Monats-Ansicht sichtbar sein.
-- Fachlich ist das der aussagekräftigere Zuschnitt: Über einen einzelnen Tag
-- beruht jede Stundenquote auf einer Handvoll Fällen, über drei Monate auf
-- genug, um eine Empfehlung darauf zu stützen.
--
-- Neuer Zeitraumwert 'trend': aktueller Monat plus zwei Vormonate, deckungsgleich
-- mit dashboard_monthly_trends und mit dem Aufbewahrungsfenster.
--
-- ACHTUNG: create or replace übernimmt security definer NICHT automatisch. Die
-- Funktion liest close_activity_facts, das für Angemeldete gesperrt ist und
-- gesperrt bleiben soll — ohne die Angabe unten liefe sie mit den Rechten des
-- Aufrufers und schlüge fehl.
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
  reach_rate numeric,
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
        when 'week' then (date_trunc('week', p_reference_date::timestamp) + interval '6 days')::date
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
