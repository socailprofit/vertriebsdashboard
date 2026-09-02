begin;

-- Leistungsfarben sollen auf jeder Zahl der Vertriebsansicht wirken, Ziele gab
-- es aber nur für sechs davon. Die beiden fehlenden Zähler kommen dazu, ebenso
-- Zielwerte für die beiden Quoten. Die Quotenziele sind bewusst nullable: kein
-- gesetztes Ziel ist etwas anderes als ein Ziel von null Prozent.
alter table public.sales_targets
  add column if not exists calls_gross integer not null default 0
    check (calls_gross >= 0),
  add column if not exists gatekeeper_contacts integer not null default 0
    check (gatekeeper_contacts >= 0),
  add column if not exists transfer_rate_target numeric(5, 2)
    check (transfer_rate_target >= 0 and transfer_rate_target <= 100),
  add column if not exists appointment_rate_target numeric(5, 2)
    check (appointment_rate_target >= 0 and appointment_rate_target <= 100);

-- "Beste Anrufzeiten" beantwortet zwei verschiedene Fragen: wann überhaupt
-- abgenommen wird, und wann das Vorzimmer durchstellt. Die Funktion lieferte
-- bisher nur die erste. Beide zurückgeben statt eine auszuwählen.
--
-- Call-Fakten tragen ausschließlich die Anrufzähler, Opening- und Follow-up-
-- Fakten ausschließlich die Gatekeeper-Zähler. Eine gemeinsame Summierung über
-- beide Quellen doppelt daher nichts; der bisherige Filter auf source_type
-- hätte die Gatekeeper-Zahlen dagegen ausgeschlossen.
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
  ), hours as (
    select generate_series(0, 23)::smallint as metric_hour
  ), aggregated as (
    select
      b.start_date,
      b.end_date,
      p.slug,
      p.display_name,
      p.color,
      p.sort_order,
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
    a.start_date,
    a.end_date,
    a.slug,
    a.display_name,
    a.color,
    a.metric_hour,
    a.calls_gross,
    a.calls_net,
    case when a.calls_gross = 0 then 0
      else round((a.calls_net::numeric / a.calls_gross) * 100, 2)
    end as reach_rate,
    a.gatekeeper_contacts,
    a.connected_calls,
    case when a.gatekeeper_contacts = 0 then 0
      else round((a.connected_calls::numeric / a.gatekeeper_contacts) * 100, 2)
    end as transfer_rate
  from aggregated a
  order by a.sort_order, a.metric_hour;
$$;

grant execute on function public.get_call_hour_performance(text, date) to authenticated;

commit;
