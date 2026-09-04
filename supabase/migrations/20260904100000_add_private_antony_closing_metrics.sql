begin;

-- CC2 ist eine offene Fortsetzung und darf nicht wie ein verlorener Closer
-- Call behandelt werden. Die Spalte bleibt auf Faktenebene, damit bestehende
-- Team-Kennzahlen und ihre Tagesaggregation unverändert bleiben.
alter table public.close_activity_facts
  add column if not exists closer_second_calls smallint not null default 0
  check (closer_second_calls between 0 and 1);

create index if not exists close_activity_facts_closer_date_idx
  on public.close_activity_facts (close_user_id, metric_date)
  where closer_calls = 1;

-- Dieser RPC ist die einzige Browser-Schnittstelle für Antonys Closer-Stufe.
-- Er prüft sowohl die abgeschlossene persönliche Passworteinrichtung als auch
-- die signierte Auth-E-Mail. Ein bloßes Ausblenden im Frontend wäre kein
-- Zugriffsschutz, weil der RPC sonst direkt aufgerufen werden könnte.
create or replace function public.get_antony_closing_metrics(
  p_period text,
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
)
returns table (
  period_start date,
  period_end date,
  appointments bigint,
  setter_calls bigint,
  setter_successes bigint,
  setter_success_rate numeric,
  closer_calls bigint,
  closer_second_calls bigint,
  decided_closer_calls bigint,
  closer_sales bigint,
  closer_success_rate numeric,
  new_customers bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or lower(coalesce(auth.jwt() ->> 'email', '')) <> 'rigone@socialprofit.de'
     or not public.has_dashboard_access() then
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
          'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4'
        )
      ), 0)::bigint as appointment_total,
      coalesce(sum(f.setter_calls) filter (
        where f.close_user_id in (
          'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
          'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4'
        )
      ), 0)::bigint as setter_call_total,
      coalesce(sum(f.setter_successes) filter (
        where f.close_user_id in (
          'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',
          'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4'
        )
      ), 0)::bigint as setter_success_total,
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
    group by b.start_date, b.end_date
  )
  select
    a.start_date,
    a.end_date,
    a.appointment_total,
    a.setter_call_total,
    a.setter_success_total,
    case
      when a.setter_call_total = 0 then 0
      else round((a.setter_success_total::numeric / a.setter_call_total) * 100, 2)
    end,
    a.closer_call_total,
    a.closer_second_call_total,
    greatest(a.closer_call_total - a.closer_second_call_total, 0::bigint),
    a.closer_sale_total,
    case
      when greatest(a.closer_call_total - a.closer_second_call_total, 0::bigint) = 0 then 0
      else round(
        (a.closer_sale_total::numeric /
          greatest(a.closer_call_total - a.closer_second_call_total, 0::bigint)) * 100,
        2
      )
    end,
    c.customer_total
  from activity_totals a
  join customer_totals c
    on c.start_date = a.start_date and c.end_date = a.end_date;
end;
$$;

revoke all on function public.get_antony_closing_metrics(text, date) from public, anon;
grant execute on function public.get_antony_closing_metrics(text, date) to authenticated;

commit;
