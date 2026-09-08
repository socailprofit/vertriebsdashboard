begin;
-- Prepared locally; production migration and historical reconciliation require approval.
alter table public.close_opportunity_facts alter column opener_close_user_id drop not null;
alter table public.daily_sales_metrics add column closer_second_calls integer not null default 0 check (closer_second_calls >= 0);
alter table public.close_activity_facts add column closer_decided_calls smallint not null default 0 check (closer_decided_calls between 0 and 1);

create or replace function public.enforce_closer_decision() returns trigger
language plpgsql set search_path = '' as $$
declare result text;
begin
  select r.payload ->> 'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' into result
  from public.close_raw_activities r where r.close_activity_id = new.source_activity_id;
  new.closer_decided_calls := case when new.closer_calls = 1 and result in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥','4. ❌ Nicht verkauft') then 1 else 0 end;
  return new;
end;
$$;
revoke all on function public.enforce_closer_decision() from public, anon, authenticated;
create trigger enforce_closer_decision before insert or update on public.close_activity_facts
for each row execute function public.enforce_closer_decision();
update public.close_activity_facts set closer_decided_calls = closer_decided_calls where closer_calls = 1;

CREATE OR REPLACE FUNCTION public.get_antony_closing_metrics_internal(p_period text, p_reference_date date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date)
 RETURNS TABLE(period_start date, period_end date, appointments bigint, setter_calls bigint, setter_successes bigint, setter_success_rate numeric, closer_calls bigint, closer_second_calls bigint, decided_closer_calls bigint, closer_sales bigint, closer_success_rate numeric, new_customers bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.has_dashboard_access() then
    raise exception 'Nicht berechtigt' using errcode = '42501';
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
        when 'week' then least(
          (date_trunc('week', p_reference_date::timestamp) + interval '4 days')::date,
          p_reference_date
        )
        when 'month' then least(
          (date_trunc('month', p_reference_date::timestamp) + interval '1 month - 1 day')::date,
          p_reference_date
        )
      end as end_date
    where p_period in ('day', 'week', 'month')
  ), activity_totals as (
    select
      b.start_date,
      b.end_date,
      coalesce(sum(f.appointments) filter (
        where f.close_user_id in (
          'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
          'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4',
          'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
        )
      ), 0)::bigint as appointment_total,
      coalesce(sum(f.setter_calls) filter (
        where f.close_user_id in (
          'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
          'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4',
          'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
        )
      ), 0)::bigint as setter_call_total,
      coalesce(sum(f.setter_successes) filter (
        where f.close_user_id in (
          'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
          'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4',
          'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
        )
      ), 0)::bigint as setter_success_total,
      coalesce(sum(f.closer_decided_calls) filter (
        where f.close_user_id = 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
      ), 0)::bigint as decided_closer_call_total,
      coalesce(sum(f.closer_calls) filter (
        where f.close_user_id = 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
      ), 0)::bigint as closer_call_total,
      coalesce(sum(f.closer_second_calls) filter (
        where f.close_user_id = 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
      ), 0)::bigint as closer_second_call_total,
      coalesce(sum(f.closer_sales) filter (
        where f.close_user_id = 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
      ), 0)::bigint as closer_sale_total
    from bounds b
    left join public.close_activity_facts f
      on f.metric_date between b.start_date and b.end_date
    group by b.start_date, b.end_date
  ), customer_totals as (
    select
      b.start_date,
      b.end_date,
      count(o.opportunity_id)::bigint as customer_total
    from bounds b
    left join public.close_opportunity_facts o
      on o.won_date between b.start_date and b.end_date
      and o.closer_close_user_id = 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
      and o.status_id = 'stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL'
    group by b.start_date, b.end_date
  )
  select
    a.start_date,
    a.end_date,
    a.appointment_total,
    a.setter_call_total,
    a.setter_success_total,
    case
      when a.setter_call_total = 0 then null
      else round((a.setter_success_total::numeric / a.setter_call_total) * 100, 2)
    end,
    a.closer_call_total,
    a.closer_second_call_total,
    a.decided_closer_call_total,
    a.closer_sale_total,
    case
      when a.decided_closer_call_total = 0 then null
      else round(
        (a.closer_sale_total::numeric /
          a.decided_closer_call_total) * 100,
        2
      )
    end,
    c.customer_total
  from activity_totals a
  join customer_totals c
    on c.start_date = a.start_date and c.end_date = a.end_date;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_antony_performance_series_internal(p_period text, p_reference_date date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date)
 RETURNS TABLE(bucket_index integer, bucket_date date, metric_hour smallint, bucket_label text, appointments_cumulative bigint, closer_appointments_cumulative bigint, closer_calls_cumulative bigint, new_customers_cumulative bigint, customer_time_precision text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not public.has_dashboard_access() then
    raise exception 'Nicht berechtigt' using errcode = '42501';
  end if;
  if p_period not in ('day', 'week', 'month') then
    raise exception 'Ungueltiger Zeitraum' using errcode = '22023';
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
        when 'week' then least(
          (date_trunc('week', p_reference_date::timestamp) + interval '4 days')::date,
          p_reference_date
        )
        when 'month' then least(
          (date_trunc('month', p_reference_date::timestamp) + interval '1 month - 1 day')::date,
          p_reference_date
        )
      end as end_date
  ), buckets as (
    select
      row_number() over (order by g.value)::integer as position,
      p_reference_date as value_date,
      g.value::smallint as value_hour,
      lpad(g.value::text, 2, '0') || ':00' as value_label
    from generate_series(
      least(8, coalesce((select min(f.metric_hour) from public.close_activity_facts f
        where f.metric_date=p_reference_date and (f.appointments>0 or f.setter_successes>0 or f.closer_calls>0)),8)),
      greatest(17, coalesce((select max(f.metric_hour) from public.close_activity_facts f
        where f.metric_date=p_reference_date and (f.appointments>0 or f.setter_successes>0 or f.closer_calls>0)),17))
    ) as g(value)
    where p_period = 'day'

    union all

    select
      row_number() over (order by g.value)::integer as position,
      g.value::date as value_date,
      null::smallint as value_hour,
      to_char(g.value, 'DD.MM.') as value_label
    from bounds b
    cross join generate_series(b.start_date, b.end_date, interval '1 day') as g(value)
    where p_period in ('week', 'month')
  ), activity_by_bucket as (
    select
      b.position,
      coalesce(sum(f.appointments) filter (
        where f.close_user_id in (
          'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
          'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4',
          'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
        )
      ), 0)::bigint as appointments,
      coalesce(sum(f.setter_successes) filter (
        where f.close_user_id in (
          'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
          'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4',
          'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
        )
      ), 0)::bigint as closer_appointments,
      coalesce(sum(f.closer_calls) filter (
        where f.close_user_id = 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
      ), 0)::bigint as closer_calls
    from buckets b
    left join public.close_activity_facts f
      on f.metric_date = b.value_date
      and (p_period <> 'day' or f.metric_hour = b.value_hour)
    group by b.position
  ), customers_by_bucket as (
    select
      b.position,
      count(o.opportunity_id)::bigint as new_customers
    from buckets b
    left join public.close_opportunity_facts o
      on p_period <> 'day'
      and o.won_date = b.value_date
      and o.closer_close_user_id = 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
      and o.status_id = 'stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL'
    group by b.position
  ), cumulative as (
    select
      b.position,
      b.value_date,
      b.value_hour,
      b.value_label,
      sum(a.appointments) over (order by b.position)::bigint as appointments,
      sum(a.closer_appointments) over (order by b.position)::bigint as closer_appointments,
      sum(a.closer_calls) over (order by b.position)::bigint as closer_calls,
      case
        when p_period = 'day' then null::bigint
        else sum(c.new_customers) over (order by b.position)::bigint
      end as new_customers
    from buckets b
    join activity_by_bucket a on a.position = b.position
    join customers_by_bucket c on c.position = b.position
  )
  select
    c.position,
    c.value_date,
    c.value_hour,
    c.value_label,
    c.appointments,
    c.closer_appointments,
    c.closer_calls,
    c.new_customers,
    'date_only'::text
  from cumulative c
  order by c.position;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_antony_pipeline_snapshot(p_reference_date date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with parameters as (
    select
      p_reference_date as reference_date,
      (date_trunc('month', p_reference_date::timestamp) - interval '2 months')::date as window_start,
      date_trunc('month', p_reference_date::timestamp)::date as current_month_start
  ), per_lead as (
    select
      f.lead_id,
      max(f.occurred_at) filter (
        where f.appointments = 1
          and f.close_user_id in (
            'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
            'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4',
          'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
          )
      ) as last_appointment_at,
      max(f.occurred_at) filter (
        where f.setter_calls = 1
          and f.close_user_id in (
            'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
            'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4',
          'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
          )
      ) as last_setter_call_at,
      max(f.occurred_at) filter (
        where f.setter_successes = 1
          and f.close_user_id in (
            'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
            'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4',
          'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
          )
      ) as last_setter_success_at,
      max(f.occurred_at) filter (
        where f.closer_calls = 1
          and f.close_user_id = 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
      ) as last_closer_call_at,
      max(f.occurred_at) filter (
        where f.closer_second_calls = 1
          and f.close_user_id = 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
      ) as last_cc2_at,
      max(f.occurred_at) filter (
        where f.closer_sales = 1
          and f.close_user_id = 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
      ) as last_closer_sale_at,
      max(f.occurred_at) filter (
        where f.rescheduled_appointments = 1
          and coalesce(
            r.payload ->> 'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q',
            ''
          ) = '🔄 Termin verschoben'
      ) as last_closer_reschedule_at,
      max(f.occurred_at) filter (
        where (f.no_shows = 1 or f.cancellations = 1)
          and coalesce(
            r.payload ->> 'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q',
            ''
          ) in ('Nicht erschienen', '⛔ Abgesagt')
      ) as last_closer_closed_status_at,
      max(f.occurred_at) filter (
        where (f.no_shows = 1 or f.cancellations = 1 or f.rescheduled_appointments = 1)
          and coalesce(
            r.payload ->> 'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz',
            ''
          ) <> ''
      ) as last_setter_status_at
    from public.close_activity_facts f
    join parameters p
      on f.metric_date between p.window_start and p.reference_date
    left join public.close_raw_activities r
      on r.close_activity_id = f.source_activity_id
    where f.lead_id is not null
    group by f.lead_id
  ), open_state as (
    select
      p.lead_id,
      case
        when p.last_closer_reschedule_at is not null
          and p.last_closer_reschedule_at > coalesce(p.last_closer_call_at, '-infinity'::timestamptz)
          and p.last_closer_reschedule_at > coalesce(p.last_closer_sale_at, '-infinity'::timestamptz)
          and p.last_closer_reschedule_at > coalesce(p.last_closer_closed_status_at, '-infinity'::timestamptz)
          then 'rescheduled_closer'
        when p.last_cc2_at is not null
          and p.last_cc2_at = p.last_closer_call_at
          and p.last_cc2_at > coalesce(p.last_closer_reschedule_at, '-infinity'::timestamptz)
          and p.last_cc2_at > coalesce(p.last_closer_sale_at, '-infinity'::timestamptz)
          and p.last_cc2_at > coalesce(p.last_closer_closed_status_at, '-infinity'::timestamptz)
          then 'pending_decision_cc2'
        when p.last_setter_success_at is not null
          and p.last_setter_success_at > coalesce(p.last_closer_call_at, '-infinity'::timestamptz)
          and p.last_setter_success_at > coalesce(p.last_closer_reschedule_at, '-infinity'::timestamptz)
          and p.last_setter_success_at > coalesce(p.last_closer_closed_status_at, '-infinity'::timestamptz)
          then 'closer_scheduled'
        when p.last_appointment_at is not null
          and p.last_appointment_at > coalesce(p.last_setter_call_at, '-infinity'::timestamptz)
          and p.last_appointment_at > coalesce(p.last_setter_status_at, '-infinity'::timestamptz)
          then 'setter_pending'
        else null
      end as status,
      case
        when p.last_closer_reschedule_at is not null
          and p.last_closer_reschedule_at > coalesce(p.last_closer_call_at, '-infinity'::timestamptz)
          and p.last_closer_reschedule_at > coalesce(p.last_closer_sale_at, '-infinity'::timestamptz)
          and p.last_closer_reschedule_at > coalesce(p.last_closer_closed_status_at, '-infinity'::timestamptz)
          then p.last_closer_reschedule_at
        when p.last_cc2_at is not null
          and p.last_cc2_at = p.last_closer_call_at
          and p.last_cc2_at > coalesce(p.last_closer_reschedule_at, '-infinity'::timestamptz)
          and p.last_cc2_at > coalesce(p.last_closer_sale_at, '-infinity'::timestamptz)
          and p.last_cc2_at > coalesce(p.last_closer_closed_status_at, '-infinity'::timestamptz)
          then p.last_cc2_at
        when p.last_setter_success_at is not null
          and p.last_setter_success_at > coalesce(p.last_closer_call_at, '-infinity'::timestamptz)
          and p.last_setter_success_at > coalesce(p.last_closer_reschedule_at, '-infinity'::timestamptz)
          and p.last_setter_success_at > coalesce(p.last_closer_closed_status_at, '-infinity'::timestamptz)
          then p.last_setter_success_at
        when p.last_appointment_at is not null
          and p.last_appointment_at > coalesce(p.last_setter_call_at, '-infinity'::timestamptz)
          and p.last_appointment_at > coalesce(p.last_setter_status_at, '-infinity'::timestamptz)
          then p.last_appointment_at
        else null
      end as status_since
    from per_lead p
    where not exists (
      select 1
      from public.close_opportunity_facts o
      where o.lead_id = p.lead_id
        and o.won_date <= p_reference_date
    )
  ), open_only as (
    select o.status, o.status_since
    from open_state o
    where o.status is not null
  )
  select jsonb_build_object(
    'as_of', p.reference_date,
    'timezone', 'Europe/Berlin',
    'window_start', p.window_start,
    'retention_months', 3,
    'counts', jsonb_build_object(
      'total_open', count(o.status)::bigint,
      'setter_pending', count(*) filter (where o.status = 'setter_pending')::bigint,
      'closer_scheduled', count(*) filter (where o.status = 'closer_scheduled')::bigint,
      'rescheduled_closer', count(*) filter (where o.status = 'rescheduled_closer')::bigint,
      'pending_decision_cc2', count(*) filter (where o.status = 'pending_decision_cc2')::bigint,
      'from_previous_months', count(*) filter (
        where (o.status_since at time zone 'Europe/Berlin')::date < p.current_month_start
      )::bigint,
      'older_than_14_days', count(*) filter (
        where (o.status_since at time zone 'Europe/Berlin')::date < p.reference_date - 14
      )::bigint
    ),
    'oldest_open_date', (min(o.status_since) at time zone 'Europe/Berlin')::date
  )
  from parameters p
  left join open_only o on true
  group by p.reference_date, p.window_start, p.current_month_start;
$function$
;

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
      sum(f.appointments)::integer as appointments,
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_weekly_review_kpis(p_week_start date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_week_end date := p_week_start + 4;
  v_current_week_start date := date_trunc(
    'week', (now() at time zone 'Europe/Berlin')::timestamp
  )::date;
  v_result jsonb;
begin
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'Week start must be a Monday';
  end if;
  if p_week_start >= v_current_week_start then
    raise exception 'Only completed sales weeks may be reviewed';
  end if;

  with team as (
    select
      coalesce(sum(m.calls_gross), 0)::bigint as calls_gross,
      coalesce(sum(m.calls_net), 0)::bigint as calls_net,
      coalesce(sum(m.gatekeeper_contacts), 0)::bigint as gatekeeper_contacts,
      coalesce(sum(m.connected_calls), 0)::bigint as connected_calls,
      coalesce(sum(m.decision_maker_contacts), 0)::bigint as decision_maker_contacts,
      coalesce(sum(m.appointments), 0)::bigint as appointments,
      coalesce(sum(m.setter_calls), 0)::bigint as setter_calls,
      coalesce(sum(m.setter_successes), 0)::bigint as setter_successes
    from public.daily_sales_metrics m
    where m.metric_date between p_week_start and v_week_end
  ), setting as (
    select coalesce(sum(f.appointments),0)::bigint as closing_appointments,
      coalesce(sum(f.setter_calls),0)::bigint as setting_calls,
      coalesce(sum(f.setter_successes),0)::bigint as setting_successes
    from public.close_activity_facts f
    where f.metric_date between p_week_start and v_week_end
      and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy', 'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4', 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')
  ), antony_activity as (
    select
      coalesce(sum(f.closer_decided_calls), 0)::bigint as decided_closer_calls,
      coalesce(sum(f.closer_calls), 0)::bigint as closer_calls,
      coalesce(sum(f.closer_second_calls), 0)::bigint as closer_second_calls,
      coalesce(sum(f.closer_sales), 0)::bigint as closer_sales
    from public.close_activity_facts f
    where f.metric_date between p_week_start and v_week_end
      and f.close_user_id = 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
  ), antony_customers as (
    select count(o.opportunity_id)::bigint as new_customers
    from public.close_opportunity_facts o
    where o.won_date between p_week_start and v_week_end
      and o.closer_close_user_id = 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
      and o.status_id = 'stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL'
  ), totals as (
    select
      t.*, s.*,
      a.closer_calls,
      a.closer_second_calls,
      a.decided_closer_calls,
      a.closer_sales,
      c.new_customers
    from team t
    cross join setting s
    cross join antony_activity a
    cross join antony_customers c
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'start', p_week_start,
      'end', v_week_end,
      'timezone', 'Europe/Berlin'
    ),
    'funnel', jsonb_build_object(
      'calls_gross', calls_gross,
      'calls_net', calls_net,
      'net_rate', case when calls_gross = 0 then null else round(calls_net::numeric / calls_gross * 100, 2) end,
      'gatekeeper_contacts', gatekeeper_contacts,
      'connected_calls', connected_calls,
      'transfer_rate', case when gatekeeper_contacts = 0 then null else round(connected_calls::numeric / gatekeeper_contacts * 100, 2) end,
      'decision_maker_contacts', decision_maker_contacts,
      'appointments', appointments,
      'appointment_rate', case when decision_maker_contacts = 0 then null else round(appointments::numeric / decision_maker_contacts * 100, 2) end
    ),
    'closing', jsonb_build_object(
      'appointments', closing_appointments,
      'setter_calls', setting_calls,
      'setter_successes', setting_successes,
      'setter_conversion_rate', case when setting_calls = 0 then null else round(setting_successes::numeric / setting_calls * 100, 2) end,
      'closer_calls', closer_calls,
      'closer_period_ratio', case when setting_successes = 0 then null else round(closer_calls::numeric / setting_successes * 100, 2) end,
      'cc2_agreed', closer_second_calls,
      'cc2_rate', case when closer_calls = 0 then null else round(closer_second_calls::numeric / closer_calls * 100, 2) end,
      'decided_closer_calls', decided_closer_calls,
      'closer_sales', closer_sales,
      'closer_close_rate', case when decided_closer_calls = 0 then null else round(closer_sales::numeric / decided_closer_calls * 100, 2) end,
      'new_customers', new_customers,
      'appointment_to_closer_period_ratio', case when closing_appointments = 0 then null else round(closer_calls::numeric / closing_appointments * 100, 2) end
    ),
    'data_basis', jsonb_build_object(
      'too_small', appointments < 5 or closer_calls < 5
    )
  ) into v_result
  from totals;

  return v_result;
end;
$function$
;

-- Current lead attribution for retained Setter/Won records, never CRM notes.
create table public.close_lead_reporting (
  lead_id text primary key,
  opener_close_user_id text,
  lead_source text,
  refreshed_at timestamptz not null default now()
);
alter table public.close_lead_reporting enable row level security;
revoke all on public.close_lead_reporting from public, anon, authenticated;
grant select, insert, update, delete on public.close_lead_reporting to service_role;

-- Single writer ordering prevents an older fetch from overwriting a newer one.
create table public.close_reconciliation_state (
  resource text primary key,
  snapshot_started_at timestamptz not null
);
alter table public.close_reconciliation_state enable row level security;
revoke all on public.close_reconciliation_state from public, anon, authenticated;
grant select, insert, update on public.close_reconciliation_state to service_role;

create or replace function public.reconcile_close_custom_and_won(
  p_start_date date, p_end_date date, p_snapshot_started_at timestamptz,
  p_raw jsonb, p_facts jsonb, p_opportunities jsonb, p_leads jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_floor date := (date_trunc('month', now() at time zone 'Europe/Berlin') - interval '2 months')::date;
  v_previous timestamptz;
  v_deleted_custom integer;
  v_deleted_won integer;
begin
  if p_start_date is null or p_end_date is null or p_start_date <> v_floor
    or p_end_date < p_start_date or p_end_date <> (now() at time zone 'Europe/Berlin')::date
    or p_snapshot_started_at is null or p_snapshot_started_at > now() + interval '1 minute'
    or p_snapshot_started_at < now() - interval '30 minutes' then
    raise exception 'Invalid reconciliation window';
  end if;
  if jsonb_typeof(p_raw) is distinct from 'array' or jsonb_typeof(p_facts) is distinct from 'array'
    or jsonb_typeof(p_opportunities) is distinct from 'array' or jsonb_typeof(p_leads) is distinct from 'array'
    or jsonb_array_length(p_raw)>20000 or jsonb_array_length(p_facts)>20000
    or jsonb_array_length(p_opportunities)>20000 or jsonb_array_length(p_leads)>20000 then raise exception 'Invalid reconciliation payload'; end if;
  if exists (
    select 1 from jsonb_populate_recordset(null::public.close_raw_activities,p_raw) r
    where r.activity_type is distinct from 'custom_activity' or r.occurred_at is null
      or (r.occurred_at at time zone 'Europe/Berlin')::date not between p_start_date and p_end_date
  ) or exists (
    select 1 from jsonb_populate_recordset(null::public.close_activity_facts,p_facts) f
    where f.source_type is distinct from 'custom_activity' or f.metric_date is null
      or f.metric_date not between p_start_date and p_end_date
      or f.metric_date is distinct from (f.occurred_at at time zone 'Europe/Berlin')::date
      or not exists (select 1 from jsonb_array_elements(p_raw) r where r->>'close_activity_id'=f.source_activity_id)
  ) or exists (
    select 1 from jsonb_populate_recordset(null::public.close_opportunity_facts,p_opportunities) o
    where o.won_date is null or o.won_date not between p_start_date and p_end_date
      or o.won_date is distinct from (o.won_at at time zone 'Europe/Berlin')::date
      or o.status_id not in ('stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL','stat_JogyhmNFRLb0ucUfEXPYRJTpVeRXJFix9GB0aVoBfz0')
  ) then raise exception 'Reconciliation rows outside declared scope'; end if;

  if exists (
    select 1 from (
      select f->>'lead_id' as id from jsonb_array_elements(p_facts) f where (f->>'setter_calls')::int=1 or (f->>'appointments')::int=1
      union select o->>'lead_id' from jsonb_array_elements(p_opportunities) o
    ) required where not exists (select 1 from jsonb_array_elements(p_leads) l where l->>'lead_id'=required.id)
  ) or exists (
    select 1 from jsonb_array_elements(p_leads) l where l->>'lead_id' is null
      or not exists(select 1 from jsonb_array_elements(p_facts) f where f->>'lead_id'=l->>'lead_id' and ((f->>'setter_calls')::int=1 or (f->>'appointments')::int=1))
        and not exists(select 1 from jsonb_array_elements(p_opportunities) o where o->>'lead_id'=l->>'lead_id')
  ) then raise exception 'Incomplete lead attribution snapshot'; end if;
  perform pg_advisory_xact_lock(71092026);
  select snapshot_started_at into v_previous from public.close_reconciliation_state where resource='custom_and_won';
  if v_previous is not null and p_snapshot_started_at <= v_previous then
    raise exception 'Stale reconciliation snapshot';
  end if;

  delete from public.close_activity_facts where source_type='custom_activity' and metric_date between p_start_date and p_end_date;
  get diagnostics v_deleted_custom=row_count;
  delete from public.close_raw_activities where activity_type='custom_activity'
    and (occurred_at at time zone 'Europe/Berlin')::date between p_start_date and p_end_date;
  delete from public.close_opportunity_facts where won_date between p_start_date and p_end_date;
  get diagnostics v_deleted_won=row_count;

  insert into public.close_raw_activities(close_activity_id,activity_type,close_user_id,lead_id,occurred_at,payload)
  select close_activity_id,activity_type,close_user_id,lead_id,occurred_at,payload
  from jsonb_populate_recordset(null::public.close_raw_activities,p_raw)
  on conflict(close_activity_id) do update set activity_type=excluded.activity_type,
    close_user_id=excluded.close_user_id,lead_id=excluded.lead_id,occurred_at=excluded.occurred_at,payload=excluded.payload,ingested_at=now();
  insert into public.close_activity_facts
  select f.* from jsonb_populate_recordset(null::public.close_activity_facts,p_facts) f
  on conflict(source_activity_id) do update set
    source_type=excluded.source_type,close_user_id=excluded.close_user_id,lead_id=excluded.lead_id,
    occurred_at=excluded.occurred_at,metric_date=excluded.metric_date,metric_hour=excluded.metric_hour,
    calls_gross=excluded.calls_gross,calls_net=excluded.calls_net,talk_seconds=excluded.talk_seconds,
    gatekeeper_contacts=excluded.gatekeeper_contacts,connected_calls=excluded.connected_calls,
    direct_decision_maker_calls=excluded.direct_decision_maker_calls,decision_maker_contacts=excluded.decision_maker_contacts,
    appointments=excluded.appointments,setter_calls=excluded.setter_calls,setter_successes=excluded.setter_successes,
    closer_calls=excluded.closer_calls,closer_second_calls=excluded.closer_second_calls,closer_decided_calls=excluded.closer_decided_calls,
    closer_sales=excluded.closer_sales,no_shows=excluded.no_shows,cancellations=excluded.cancellations,
    rescheduled_appointments=excluded.rescheduled_appointments,product_focus=excluded.product_focus,
    mapping_version=excluded.mapping_version,mapped_at=excluded.mapped_at;
  insert into public.close_opportunity_facts(opportunity_id,lead_id,opener_close_user_id,setter_close_user_id,closer_close_user_id,won_at,won_date,status_id,value_cents,value_period,mapping_version,payload)
  select opportunity_id,lead_id,opener_close_user_id,setter_close_user_id,closer_close_user_id,won_at,won_date,status_id,value_cents,value_period,mapping_version,payload
  from jsonb_populate_recordset(null::public.close_opportunity_facts,p_opportunities)
  on conflict(opportunity_id) do update set lead_id=excluded.lead_id,opener_close_user_id=excluded.opener_close_user_id,
    setter_close_user_id=excluded.setter_close_user_id,closer_close_user_id=excluded.closer_close_user_id,
    won_at=excluded.won_at,won_date=excluded.won_date,status_id=excluded.status_id,value_cents=excluded.value_cents,
    value_period=excluded.value_period,mapping_version=excluded.mapping_version,payload=excluded.payload,ingested_at=now();

  delete from public.close_lead_reporting;
  insert into public.close_lead_reporting(lead_id,opener_close_user_id,lead_source)
    select lead_id,opener_close_user_id,lead_source from jsonb_populate_recordset(null::public.close_lead_reporting,p_leads);
  perform public.recalculate_daily_sales_metrics(p_start_date,p_end_date);
  -- Refresh only custom-activity archive fields, preserving calls/newsletters.
  update public.monthly_kpi_snapshots s set
    gatekeeper_contacts=t.gatekeeper_contacts, connected_calls=t.connected_calls,
    direct_decision_maker_calls=t.direct_decision_maker_calls,decision_maker_contacts=t.decision_maker_contacts,
    appointments=t.appointments
  from (select date_trunc('month',m.metric_date)::date month_start,
    sum(m.gatekeeper_contacts) gatekeeper_contacts,sum(m.connected_calls) connected_calls,
    sum(m.direct_decision_maker_calls) direct_decision_maker_calls,
    sum(m.decision_maker_contacts) decision_maker_contacts,sum(m.appointments) appointments
    from public.daily_sales_metrics m
    where m.metric_date >= p_start_date and m.metric_date <= p_end_date
    group by 1) t
  where s.month_start=t.month_start and s.month_start >= p_start_date
    and (s.month_start+interval '1 month - 1 day')::date <= p_end_date;
  insert into public.close_reconciliation_state values('custom_and_won',p_snapshot_started_at)
    on conflict(resource) do update set snapshot_started_at=excluded.snapshot_started_at;
  return jsonb_build_object('custom_before',v_deleted_custom,'custom_after',jsonb_array_length(p_facts),
    'won_before',v_deleted_won,'won_after',jsonb_array_length(p_opportunities));
end;
$$;
revoke all on function public.reconcile_close_custom_and_won(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.reconcile_close_custom_and_won(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb) to service_role;
commit;
