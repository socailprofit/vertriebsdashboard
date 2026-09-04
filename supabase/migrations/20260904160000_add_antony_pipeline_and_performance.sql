begin;

-- Die Pipeline ist keine Kopie frei benannter Close-Statuswerte. Sie wird aus
-- den bereits gemappten, zeitlich letzten Funnel-Ereignissen je Lead gebildet.
-- Der interne Helper gibt ausschliesslich Summen zurueck; IDs, Namen,
-- Rohpayloads und Close-Freitexte verlassen die Datenbank nicht.
create or replace function public.get_antony_pipeline_snapshot(
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
            'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4'
          )
      ) as last_appointment_at,
      max(f.occurred_at) filter (
        where f.setter_calls = 1
          and f.close_user_id in (
            'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
            'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4'
          )
      ) as last_setter_call_at,
      max(f.occurred_at) filter (
        where f.setter_successes = 1
          and f.close_user_id in (
            'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
            'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4'
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
          then 'rescheduled_closer'
        when p.last_cc2_at is not null
          and p.last_cc2_at = p.last_closer_call_at
          and p.last_cc2_at > coalesce(p.last_closer_reschedule_at, '-infinity'::timestamptz)
          and p.last_cc2_at > coalesce(p.last_closer_sale_at, '-infinity'::timestamptz)
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
          then p.last_closer_reschedule_at
        when p.last_cc2_at is not null
          and p.last_cc2_at = p.last_closer_call_at
          and p.last_cc2_at > coalesce(p.last_closer_reschedule_at, '-infinity'::timestamptz)
          and p.last_cc2_at > coalesce(p.last_closer_sale_at, '-infinity'::timestamptz)
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
        where o.status_since::date < p.current_month_start
      )::bigint,
      'older_than_14_days', count(*) filter (
        where o.status_since::date < p.reference_date - 14
      )::bigint
    ),
    'oldest_open_date', min(o.status_since)::date
  )
  from parameters p
  left join open_only o on true
  group by p.reference_date, p.window_start, p.current_month_start;
$$;

comment on function public.get_antony_pipeline_snapshot(date) is
  'Aggregate open-funnel snapshot for Antony; contains no lead identifiers, names, notes, or raw Close payloads.';

revoke all on function public.get_antony_pipeline_snapshot(date) from public, anon, authenticated;
grant execute on function public.get_antony_pipeline_snapshot(date) to service_role;

-- Authentifizierte Dashboard-Nutzer erhalten dieselbe rein aggregierte
-- Momentaufnahme. Der geschuetzte Helper bleibt fuer den Wochenreview nutzbar.
create or replace function public.get_antony_open_pipeline(
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_dashboard_access() then
    raise exception 'Nicht berechtigt' using errcode = '42501';
  end if;

  return public.get_antony_pipeline_snapshot(p_reference_date);
end;
$$;

revoke all on function public.get_antony_open_pipeline(date) from public, anon;
grant execute on function public.get_antony_open_pipeline(date) to authenticated;

-- Der grosse Antony-Verlauf wird serverseitig aus denselben gemappten Fakten
-- wie die oberen KPIs gebildet. Tag = 08:00 bis 17:00 nach Europe/Berlin,
-- Woche = Montag bis Freitag/Stichtag, Monat = Monatserster bis Stichtag.
-- Won-Daten sind nur tagesgenau; deshalb bleibt die Neukundenreihe am Tag NULL.
create or replace function public.get_antony_performance_series(
  p_period text,
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
)
returns table (
  bucket_index integer,
  bucket_date date,
  metric_hour smallint,
  bucket_label text,
  appointments_cumulative bigint,
  closer_appointments_cumulative bigint,
  closer_calls_cumulative bigint,
  new_customers_cumulative bigint,
  customer_time_precision text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    from generate_series(8, 17) as g(value)
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
          'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4'
        )
      ), 0)::bigint as appointments,
      coalesce(sum(f.setter_successes) filter (
        where f.close_user_id in (
          'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
          'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4'
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
$$;

revoke all on function public.get_antony_performance_series(text, date) from public, anon;
grant execute on function public.get_antony_performance_series(text, date) to authenticated;

commit;
