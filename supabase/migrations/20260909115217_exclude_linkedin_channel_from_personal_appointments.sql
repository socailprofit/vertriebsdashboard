begin;
-- LinkedIn channel bookings are not personal prospecting appointments.
-- LinkedIn Cold Calls remains personal, as defined by get_close_opener_internal.
CREATE OR REPLACE FUNCTION public.get_call_hour_performance(p_period text, p_reference_date date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date)
 RETURNS TABLE(period_start date, period_end date, slug text, display_name text, color text, metric_hour smallint, calls_gross bigint, calls_net bigint, net_rate numeric, gatekeeper_contacts bigint, connected_calls bigint, transfer_rate numeric, decision_maker_contacts bigint, appointments bigint, appointment_rate numeric, mailbox_calls bigint, outside_business_hours_calls bigint, productive_calls bigint, productive_rate numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      coalesce(sum(case when public.get_close_opener_internal(f.lead_id)='linkedin' then 0 else f.appointments end), 0)::bigint as appointments,
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
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_daily_sales_metrics(p_start_date date, p_end_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  affected_rows integer;
begin
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Invalid dashboard metric date range';
  end if;

  if p_end_date - p_start_date > 100 then
    raise exception 'Dashboard metric date range exceeds 100 days';
  end if;

  with days as (
    select generate_series(p_start_date, p_end_date, interval '1 day')::date as metric_date
  ), activity_totals as (
    select
      f.metric_date,
      p.id as sales_person_id,
      sum(f.calls_gross)::integer as calls_gross,
      sum(f.calls_net)::integer as calls_net,
      sum(f.talk_seconds)::integer as talk_seconds,
      sum(f.gatekeeper_contacts)::integer as gatekeeper_contacts,
      sum(f.connected_calls)::integer as connected_calls,
      sum(f.direct_decision_maker_calls)::integer as direct_decision_maker_calls,
      sum(f.decision_maker_contacts)::integer as decision_maker_contacts,
      sum(case when public.get_close_opener_internal(f.lead_id)='linkedin' then 0 else f.appointments end)::integer as appointments,
      sum(f.setter_calls)::integer as setter_calls,
      sum(f.setter_successes)::integer as setter_successes,
      sum(f.closer_calls)::integer as closer_calls,
      sum(f.closer_second_calls)::integer as closer_second_calls,
      sum(f.closer_sales)::integer as closer_sales,
      sum(f.no_shows)::integer as no_shows,
      sum(f.cancellations)::integer as cancellations,
      sum(f.rescheduled_appointments)::integer as rescheduled_appointments
    from public.close_activity_facts f
    join public.sales_people p on p.close_user_id = f.close_user_id
    where f.metric_date between p_start_date and p_end_date
    group by f.metric_date, p.id
  ), opportunity_totals as (
    select
      f.won_date as metric_date,
      p.id as sales_person_id,
      count(*)::integer as deals_won,
      sum(case when f.value_period = 'one_time' then f.value_cents else 0 end)::bigint as revenue_cents
    from public.close_opportunity_facts f
    join public.sales_people p on p.close_user_id = f.opener_close_user_id
    where f.won_date between p_start_date and p_end_date
    group by f.won_date, p.id
  ), newsletter_totals as (
    select
      (s.sent_at at time zone 'Europe/Berlin')::date as metric_date,
      p.id as sales_person_id,
      count(*)::integer as newsletters
    from public.close_newsletter_sends s
    join public.sales_people p on p.close_user_id = s.close_user_id
    where (s.sent_at at time zone 'Europe/Berlin')::date between p_start_date and p_end_date
    group by (s.sent_at at time zone 'Europe/Berlin')::date, p.id
  )
  insert into public.daily_sales_metrics (
    metric_date, sales_person_id, calls_gross, calls_net, talk_seconds,
    gatekeeper_contacts, connected_calls, direct_decision_maker_calls,
    decision_maker_contacts, appointments, setter_calls, setter_successes,
    closer_calls, closer_second_calls, closer_sales, no_shows, cancellations,
    rescheduled_appointments, deals_won, revenue_cents, newsletters, calculated_at
  )
  select
    d.metric_date,
    p.id,
    coalesce(a.calls_gross, 0),
    coalesce(a.calls_net, 0),
    coalesce(a.talk_seconds, 0),
    coalesce(a.gatekeeper_contacts, 0),
    coalesce(a.connected_calls, 0),
    coalesce(a.direct_decision_maker_calls, 0),
    coalesce(a.decision_maker_contacts, 0),
    coalesce(a.appointments, 0),
    coalesce(a.setter_calls, 0),
    coalesce(a.setter_successes, 0),
    coalesce(a.closer_calls, 0),
    coalesce(a.closer_second_calls, 0),
    coalesce(a.closer_sales, 0),
    coalesce(a.no_shows, 0),
    coalesce(a.cancellations, 0),
    coalesce(a.rescheduled_appointments, 0),
    coalesce(o.deals_won, 0),
    coalesce(o.revenue_cents, 0),
    coalesce(n.newsletters, 0),
    now()
  from days d
  cross join public.sales_people p
  left join activity_totals a
    on a.metric_date = d.metric_date and a.sales_person_id = p.id
  left join opportunity_totals o
    on o.metric_date = d.metric_date and o.sales_person_id = p.id
  left join newsletter_totals n
    on n.metric_date = d.metric_date and n.sales_person_id = p.id
  where p.active = true
  on conflict (metric_date, sales_person_id) do update
  set calls_gross = excluded.calls_gross,
      calls_net = excluded.calls_net,
      talk_seconds = excluded.talk_seconds,
      gatekeeper_contacts = excluded.gatekeeper_contacts,
      connected_calls = excluded.connected_calls,
      direct_decision_maker_calls = excluded.direct_decision_maker_calls,
      decision_maker_contacts = excluded.decision_maker_contacts,
      appointments = excluded.appointments,
      setter_calls = excluded.setter_calls,
      setter_successes = excluded.setter_successes,
      closer_calls = excluded.closer_calls,
      closer_second_calls = excluded.closer_second_calls,
      closer_sales = excluded.closer_sales,
      no_shows = excluded.no_shows,
      cancellations = excluded.cancellations,
      rescheduled_appointments = excluded.rescheduled_appointments,
      deals_won = excluded.deals_won,
      revenue_cents = excluded.revenue_cents,
      newsletters = excluded.newsletters,
      calculated_at = excluded.calculated_at;

  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$function$;

-- Recompute only appointment totals in already stored, retained reporting days.
-- No Close import; raw activity facts and all other metrics remain unchanged.
update public.daily_sales_metrics m set appointments=coalesce((
 select sum(case when public.get_close_opener_internal(f.lead_id)='linkedin' then 0 else f.appointments end)
 from public.close_activity_facts f join public.sales_people p on p.close_user_id=f.close_user_id
 where p.id=m.sales_person_id and f.metric_date=m.metric_date
),0)
where m.metric_date between (date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date and (now() at time zone 'Europe/Berlin')::date;
commit;
