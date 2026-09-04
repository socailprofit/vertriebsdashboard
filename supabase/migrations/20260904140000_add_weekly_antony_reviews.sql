begin;

-- Das Business-Profil wird manuell gepflegt, versioniert und niemals aus Close
-- befüllt. Genau eine Version kann aktiv sein. Nur die Edge Function darf es
-- lesen; Browserkonten erhalten keinen Tabellenzugriff.
create table public.weekly_review_contexts (
  version text primary key,
  active boolean not null default false,
  context jsonb not null check (jsonb_typeof(context) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index weekly_review_contexts_one_active
  on public.weekly_review_contexts (active)
  where active;

create trigger weekly_review_contexts_set_updated_at
before update on public.weekly_review_contexts
for each row execute function public.set_updated_at();

alter table public.weekly_review_contexts enable row level security;
revoke all on public.weekly_review_contexts from public, anon, authenticated;
grant select, insert, update, delete on public.weekly_review_contexts to service_role;

-- Der Wochenreview ist bewusst von daily_summaries getrennt: Eine Kalenderwoche
-- besitzt genau einen Datensatz, und ein reservierter Datensatz verhindert
-- doppelte Modellaufrufe. Nur die Edge Function darf schreiben.
create table public.weekly_reviews (
  week_start date primary key,
  week_end date not null,
  iso_year integer not null,
  iso_week integer not null check (iso_week between 1 and 53),
  context_version text not null references public.weekly_review_contexts(version),
  status text not null check (status in ('generating', 'completed')),
  content text,
  facts jsonb,
  model text,
  created_at timestamptz not null default now(),
  generated_at timestamptz,
  constraint weekly_reviews_monday_start check (extract(isodow from week_start) = 1),
  constraint weekly_reviews_friday_end check (week_end = week_start + 4),
  constraint weekly_reviews_iso_year_matches check (extract(isoyear from week_start)::integer = iso_year),
  constraint weekly_reviews_iso_week_matches check (extract(week from week_start)::integer = iso_week),
  constraint weekly_reviews_completed_content check (
    status <> 'completed'
    or (content is not null and facts is not null and model is not null and generated_at is not null)
  ),
  constraint weekly_reviews_calendar_week_unique unique (iso_year, iso_week)
);

comment on table public.weekly_reviews is
  'One AI-generated review per completed Monday-Friday sales week; model input is aggregated KPIs only.';

alter table public.weekly_reviews enable row level security;
revoke all on public.weekly_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.weekly_reviews to service_role;

-- Der Browser erhält nur den fertigen Text und seinen Zeitraum. Das gespeicherte
-- Modell-Input-JSON bleibt im Backend und kann nicht über die Data API gelesen
-- werden. Die zentrale Passwort-/Zugangssperre gilt auch hier.
create or replace function public.get_latest_weekly_review()
returns table (
  week_start date,
  week_end date,
  content text,
  generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.has_dashboard_access()
     or not exists (
       select 1
       from auth.users u
       where u.id = auth.uid()
         and lower(coalesce(u.email, '')) = 'rigone@socialprofit.de'
     ) then
    raise exception 'Nicht berechtigt' using errcode = '42501';
  end if;

  return query
  select r.week_start, r.week_end, r.content, r.generated_at
  from public.weekly_reviews r
  where r.status = 'completed'
  order by r.week_start desc
  limit 1;
end;
$$;

revoke all on function public.get_latest_weekly_review() from public, anon;
grant execute on function public.get_latest_weekly_review() to authenticated;

-- Ausschließlich serverseitig aufrufbare Aggregation. Sie bildet dieselben
-- Funnel-Definitionen wie das Dashboard und dieselbe Antony-Logik wie
-- get_antony_closing_metrics ab. Es werden keine Rohpayloads, IDs, Namen oder
-- Close-Freitexte zurückgegeben.
create or replace function public.get_weekly_review_kpis(p_week_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  ), antony_activity as (
    select
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
  ), totals as (
    select
      t.*,
      a.closer_calls,
      a.closer_second_calls,
      greatest(a.closer_calls - a.closer_second_calls, 0::bigint) as decided_closer_calls,
      a.closer_sales,
      c.new_customers
    from team t
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
      'net_rate', case when calls_gross = 0 then 0 else round(calls_net::numeric / calls_gross * 100, 2) end,
      'gatekeeper_contacts', gatekeeper_contacts,
      'connected_calls', connected_calls,
      'transfer_rate', case when gatekeeper_contacts = 0 then 0 else round(connected_calls::numeric / gatekeeper_contacts * 100, 2) end,
      'decision_maker_contacts', decision_maker_contacts,
      'appointments', appointments,
      'appointment_rate', case when decision_maker_contacts = 0 then 0 else round(appointments::numeric / decision_maker_contacts * 100, 2) end
    ),
    'closing', jsonb_build_object(
      'setter_calls', setter_calls,
      'setter_successes', setter_successes,
      'setter_show_rate', case when setter_calls = 0 then 0 else round(setter_successes::numeric / setter_calls * 100, 2) end,
      'closer_calls', closer_calls,
      'closer_show_rate', case when setter_successes = 0 then 0 else round(closer_calls::numeric / setter_successes * 100, 2) end,
      'cc2_agreed', closer_second_calls,
      'cc2_rate', case when closer_calls = 0 then 0 else round(closer_second_calls::numeric / closer_calls * 100, 2) end,
      'decided_closer_calls', decided_closer_calls,
      'closer_sales', closer_sales,
      'closer_close_rate', case when decided_closer_calls = 0 then 0 else round(closer_sales::numeric / decided_closer_calls * 100, 2) end,
      'new_customers', new_customers,
      'appointment_to_closer_rate', case when appointments = 0 then 0 else round(closer_calls::numeric / appointments * 100, 2) end
    ),
    'data_basis', jsonb_build_object(
      'too_small', appointments < 5 or closer_calls < 5
    )
  ) into v_result
  from totals;

  return v_result;
end;
$$;

revoke all on function public.get_weekly_review_kpis(date) from public, anon, authenticated;
grant execute on function public.get_weekly_review_kpis(date) to service_role;

commit;
