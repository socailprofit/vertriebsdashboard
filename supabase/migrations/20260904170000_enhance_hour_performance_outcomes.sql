begin;

-- Die beiden Outcome-IDs sind organisationsspezifische Close-Call-Outcomes.
-- Sie werden nur in der Stundenanalyse ausgewertet; die bestehenden
-- Brutto-/Netto-KPIs und deren historische Definition bleiben unverändert.
drop function if exists public.get_call_hour_performance(text, date);

create function public.get_call_hour_performance(
  p_period text,
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
)
returns table (
  period_start date, period_end date, slug text, display_name text, color text,
  metric_hour smallint, calls_gross bigint, calls_net bigint, net_rate numeric,
  gatekeeper_contacts bigint, connected_calls bigint, transfer_rate numeric,
  decision_maker_contacts bigint, appointments bigint, appointment_rate numeric,
  mailbox_calls bigint, outside_business_hours_calls bigint,
  productive_calls bigint, productive_rate numeric
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
      coalesce(sum(f.connected_calls), 0)::bigint as connected_calls,
      coalesce(sum(f.decision_maker_contacts), 0)::bigint as decision_maker_contacts,
      coalesce(sum(f.appointments), 0)::bigint as appointments,
      coalesce(sum(
        case
          when f.calls_gross = 1
            and r.payload->>'outcome_id' = 'outcome_030sp0X2TRtdT8YPJfqwWS'
          then 1 else 0
        end
      ), 0)::bigint as mailbox_calls,
      coalesce(sum(
        case
          when f.calls_gross = 1
            and r.payload->>'outcome_id' = 'outcome_030spLYZrlWBQ9kEiPfudv'
          then 1 else 0
        end
      ), 0)::bigint as outside_business_hours_calls
    from bounds b
    cross join public.sales_people p
    cross join hours h
    left join public.close_activity_facts f
      on f.close_user_id = p.close_user_id
      and f.metric_date between b.start_date and b.end_date
      and f.metric_hour = h.metric_hour
    left join public.close_raw_activities r
      on r.close_activity_id = f.source_activity_id
      and r.activity_type = 'call'
    where p.active = true
      and public.has_dashboard_access()
    group by
      b.start_date, b.end_date, p.id, p.slug, p.display_name,
      p.color, p.sort_order, h.metric_hour
  ), classified as (
    select
      a.*,
      greatest(
        a.calls_net - a.mailbox_calls - a.outside_business_hours_calls,
        0::bigint
      ) as productive_calls
    from aggregated a
  )
  select
    c.start_date,
    c.end_date,
    c.slug,
    c.display_name,
    c.color,
    c.metric_hour,
    c.calls_gross,
    c.calls_net,
    case when c.calls_gross = 0 then 0 else round((c.calls_net::numeric / c.calls_gross) * 100, 2) end,
    c.gatekeeper_contacts,
    c.connected_calls,
    case when c.gatekeeper_contacts = 0 then 0 else round((c.connected_calls::numeric / c.gatekeeper_contacts) * 100, 2) end,
    c.decision_maker_contacts,
    c.appointments,
    case when c.decision_maker_contacts = 0 then 0 else round((c.appointments::numeric / c.decision_maker_contacts) * 100, 2) end,
    c.mailbox_calls,
    c.outside_business_hours_calls,
    c.productive_calls,
    case when c.calls_gross = 0 then 0 else round((c.productive_calls::numeric / c.calls_gross) * 100, 2) end
  from classified c
  order by c.sort_order, c.metric_hour;
$$;

revoke all on function public.get_call_hour_performance(text, date) from public, anon;
grant execute on function public.get_call_hour_performance(text, date) to authenticated;

commit;
