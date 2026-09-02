begin;

create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('manager', 'sales');
create type public.sync_status as enum ('running', 'success', 'failed');

create table public.sales_people (
  id uuid primary key default extensions.gen_random_uuid(),
  close_user_id text not null unique,
  slug text not null unique,
  display_name text not null,
  color text not null,
  active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.app_role not null default 'sales',
  sales_person_id uuid references public.sales_people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sales_targets (
  id uuid primary key default extensions.gen_random_uuid(),
  sales_person_id uuid not null references public.sales_people(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  calls_net integer not null default 0 check (calls_net >= 0),
  connected_calls integer not null default 0 check (connected_calls >= 0),
  decision_maker_contacts integer not null default 0 check (decision_maker_contacts >= 0),
  appointments integer not null default 0 check (appointments >= 0),
  deals_won integer not null default 0 check (deals_won >= 0),
  revenue_cents bigint not null default 0 check (revenue_cents >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_targets_valid_period check (period_end >= period_start),
  constraint sales_targets_person_period_unique unique (sales_person_id, period_start, period_end)
);

create table public.close_raw_activities (
  close_activity_id text primary key,
  activity_type text not null,
  close_user_id text,
  lead_id text,
  occurred_at timestamptz not null,
  payload jsonb not null,
  ingested_at timestamptz not null default now()
);

create index close_raw_activities_user_occurred_idx
  on public.close_raw_activities (close_user_id, occurred_at desc);

create table public.close_activity_facts (
  source_activity_id text primary key references public.close_raw_activities(close_activity_id) on delete cascade,
  source_type text not null check (source_type in ('call', 'custom_activity')),
  close_user_id text,
  lead_id text,
  occurred_at timestamptz not null,
  metric_date date not null,
  metric_hour smallint not null check (metric_hour between 0 and 23),
  calls_gross smallint not null default 0 check (calls_gross between 0 and 1),
  calls_net smallint not null default 0 check (calls_net between 0 and 1),
  talk_seconds integer not null default 0 check (talk_seconds >= 0),
  gatekeeper_contacts smallint not null default 0 check (gatekeeper_contacts between 0 and 1),
  connected_calls smallint not null default 0 check (connected_calls between 0 and 1),
  direct_decision_maker_calls smallint not null default 0 check (direct_decision_maker_calls between 0 and 1),
  decision_maker_contacts smallint not null default 0 check (decision_maker_contacts between 0 and 1),
  appointments smallint not null default 0 check (appointments between 0 and 1),
  setter_calls smallint not null default 0 check (setter_calls between 0 and 1),
  setter_successes smallint not null default 0 check (setter_successes between 0 and 1),
  closer_calls smallint not null default 0 check (closer_calls between 0 and 1),
  closer_sales smallint not null default 0 check (closer_sales between 0 and 1),
  no_shows smallint not null default 0 check (no_shows between 0 and 1),
  cancellations smallint not null default 0 check (cancellations between 0 and 1),
  rescheduled_appointments smallint not null default 0 check (rescheduled_appointments between 0 and 1),
  product_focus text,
  mapping_version text not null,
  mapped_at timestamptz not null default now()
);

create index close_activity_facts_user_date_idx
  on public.close_activity_facts (close_user_id, metric_date desc, metric_hour);

create table public.close_opportunity_facts (
  opportunity_id text primary key,
  lead_id text not null,
  opener_close_user_id text not null,
  setter_close_user_id text,
  closer_close_user_id text,
  won_at timestamptz not null,
  won_date date not null,
  status_id text not null,
  value_cents bigint not null default 0 check (value_cents >= 0),
  value_period text not null check (value_period in ('one_time', 'monthly', 'annual')),
  mapping_version text not null,
  payload jsonb not null,
  ingested_at timestamptz not null default now()
);

create index close_opportunity_facts_opener_date_idx
  on public.close_opportunity_facts (opener_close_user_id, won_date desc);

create table public.daily_sales_metrics (
  metric_date date not null,
  sales_person_id uuid not null references public.sales_people(id) on delete cascade,
  calls_gross integer not null default 0 check (calls_gross >= 0),
  calls_net integer not null default 0 check (calls_net >= 0),
  talk_seconds integer not null default 0 check (talk_seconds >= 0),
  gatekeeper_contacts integer not null default 0 check (gatekeeper_contacts >= 0),
  connected_calls integer not null default 0 check (connected_calls >= 0),
  direct_decision_maker_calls integer not null default 0 check (direct_decision_maker_calls >= 0),
  decision_maker_contacts integer not null default 0 check (decision_maker_contacts >= 0),
  appointments integer not null default 0 check (appointments >= 0),
  setter_calls integer not null default 0 check (setter_calls >= 0),
  setter_successes integer not null default 0 check (setter_successes >= 0),
  closer_calls integer not null default 0 check (closer_calls >= 0),
  closer_sales integer not null default 0 check (closer_sales >= 0),
  no_shows integer not null default 0 check (no_shows >= 0),
  cancellations integer not null default 0 check (cancellations >= 0),
  rescheduled_appointments integer not null default 0 check (rescheduled_appointments >= 0),
  deals_won integer not null default 0 check (deals_won >= 0),
  revenue_cents bigint not null default 0 check (revenue_cents >= 0),
  newsletters integer check (newsletters >= 0),
  calculated_at timestamptz not null default now(),
  primary key (metric_date, sales_person_id)
);

create index daily_sales_metrics_person_date_idx
  on public.daily_sales_metrics (sales_person_id, metric_date desc);

create table public.sync_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status public.sync_status not null default 'running',
  source_window_start timestamptz,
  source_window_end timestamptz,
  fetched_records integer not null default 0 check (fetched_records >= 0),
  upserted_records integer not null default 0 check (upserted_records >= 0),
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index sync_runs_started_idx on public.sync_runs (started_at desc);

create table public.daily_summaries (
  summary_date date primary key,
  content text not null,
  facts jsonb not null default '{}'::jsonb,
  model text,
  generated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sales_people_set_updated_at
before update on public.sales_people
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger sales_targets_set_updated_at
before update on public.sales_targets
for each row execute function public.set_updated_at();

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where user_id = auth.uid();
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, role)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'User'
    ),
    'sales'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.sales_people (close_user_id, slug, display_name, color, sort_order)
values
  ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy', 'michael', 'Michael Giesbrecht', '#4f8cff', 10),
  ('user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4', 'felix', 'Felix Wenk', '#f59e0b', 20)
on conflict (close_user_id) do update
set slug = excluded.slug,
    display_name = excluded.display_name,
    color = excluded.color,
    sort_order = excluded.sort_order,
    active = true;

alter table public.sales_people enable row level security;
alter table public.profiles enable row level security;
alter table public.sales_targets enable row level security;
alter table public.close_raw_activities enable row level security;
alter table public.close_activity_facts enable row level security;
alter table public.close_opportunity_facts enable row level security;
alter table public.daily_sales_metrics enable row level security;
alter table public.sync_runs enable row level security;
alter table public.daily_summaries enable row level security;

create policy sales_people_authenticated_read
on public.sales_people for select
to authenticated
using (true);

create policy profiles_self_or_manager_read
on public.profiles for select
to authenticated
using (user_id = auth.uid() or public.current_app_role() = 'manager');

create policy profiles_manager_update
on public.profiles for update
to authenticated
using (public.current_app_role() = 'manager')
with check (public.current_app_role() = 'manager');

create policy sales_targets_authenticated_read
on public.sales_targets for select
to authenticated
using (true);

create policy sales_targets_manager_insert
on public.sales_targets for insert
to authenticated
with check (public.current_app_role() = 'manager' and created_by = auth.uid());

create policy sales_targets_manager_update
on public.sales_targets for update
to authenticated
using (public.current_app_role() = 'manager')
with check (public.current_app_role() = 'manager');

create policy sales_targets_manager_delete
on public.sales_targets for delete
to authenticated
using (public.current_app_role() = 'manager');

create policy daily_sales_metrics_authenticated_read
on public.daily_sales_metrics for select
to authenticated
using (true);

create policy sync_runs_manager_read
on public.sync_runs for select
to authenticated
using (public.current_app_role() = 'manager');

create policy daily_summaries_authenticated_read
on public.daily_summaries for select
to authenticated
using (true);

create or replace view public.dashboard_daily_metrics
with (security_invoker = true)
as
select
  m.metric_date,
  p.slug,
  p.display_name,
  p.color,
  m.calls_gross,
  m.calls_net,
  m.talk_seconds,
  m.gatekeeper_contacts,
  m.connected_calls,
  case
    when m.gatekeeper_contacts = 0 then 0
    else round((m.connected_calls::numeric / m.gatekeeper_contacts) * 100, 2)
  end as connection_rate,
  m.direct_decision_maker_calls,
  m.decision_maker_contacts,
  case
    when m.calls_net = 0 then 0
    else round((m.decision_maker_contacts::numeric / m.calls_net) * 100, 2)
  end as decision_maker_rate,
  m.appointments,
  case
    when m.decision_maker_contacts = 0 then 0
    else round((m.appointments::numeric / m.decision_maker_contacts) * 100, 2)
  end as appointment_rate,
  m.setter_calls,
  m.setter_successes,
  case
    when m.setter_calls = 0 then 0
    else round((m.setter_successes::numeric / m.setter_calls) * 100, 2)
  end as setter_success_rate,
  m.closer_calls,
  m.closer_sales,
  case
    when m.closer_calls = 0 then 0
    else round((m.closer_sales::numeric / m.closer_calls) * 100, 2)
  end as closer_success_rate,
  m.no_shows,
  m.cancellations,
  m.rescheduled_appointments,
  m.deals_won,
  case
    when m.appointments = 0 then 0
    else round((m.deals_won::numeric / m.appointments) * 100, 2)
  end as period_win_rate,
  m.revenue_cents,
  m.newsletters,
  m.calculated_at
from public.daily_sales_metrics m
join public.sales_people p on p.id = m.sales_person_id
where p.active = true;

create or replace function public.get_dashboard_metrics(
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
  period_win_rate numeric,
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
      b.start_date,
      b.end_date,
      p.slug,
      p.display_name,
      p.color,
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
    order by p.sort_order
  )
  select
    a.start_date,
    a.end_date,
    a.slug,
    a.display_name,
    a.color,
    a.calls_gross,
    a.calls_net,
    a.talk_seconds,
    a.gatekeeper_contacts,
    a.connected_calls,
    case when a.gatekeeper_contacts = 0 then 0
      else round((a.connected_calls::numeric / a.gatekeeper_contacts) * 100, 2)
    end,
    a.direct_decision_maker_calls,
    a.decision_maker_contacts,
    case when a.calls_net = 0 then 0
      else round((a.decision_maker_contacts::numeric / a.calls_net) * 100, 2)
    end,
    a.appointments,
    case when a.decision_maker_contacts = 0 then 0
      else round((a.appointments::numeric / a.decision_maker_contacts) * 100, 2)
    end,
    a.setter_calls,
    a.setter_successes,
    case when a.setter_calls = 0 then 0
      else round((a.setter_successes::numeric / a.setter_calls) * 100, 2)
    end,
    a.closer_calls,
    a.closer_sales,
    case when a.closer_calls = 0 then 0
      else round((a.closer_sales::numeric / a.closer_calls) * 100, 2)
    end,
    a.no_shows,
    a.cancellations,
    a.rescheduled_appointments,
    a.deals_won,
    case when a.appointments = 0 then 0
      else round((a.deals_won::numeric / a.appointments) * 100, 2)
    end,
    a.revenue_cents,
    a.newsletters
  from aggregated a;
$$;

create or replace function public.get_call_hour_performance(
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
  reach_rate numeric
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
      coalesce(sum(f.calls_net), 0)::bigint as calls_net
    from bounds b
    cross join public.sales_people p
    cross join hours h
    left join public.close_activity_facts f
      on f.close_user_id = p.close_user_id
      and f.source_type = 'call'
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
    end as reach_rate
  from aggregated a
  order by a.sort_order, a.metric_hour;
$$;

create or replace view public.dashboard_monthly_trends
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
    coalesce(sum(m.calls_net), 0)::bigint as calls_net,
    coalesce(sum(m.decision_maker_contacts), 0)::bigint as decision_maker_contacts,
    coalesce(sum(m.appointments), 0)::bigint as appointments,
    coalesce(sum(m.deals_won), 0)::bigint as deals_won,
    coalesce(sum(m.revenue_cents), 0)::numeric as revenue_cents
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
  calls_net,
  decision_maker_contacts,
  appointments,
  case when decision_maker_contacts = 0 then 0
    else round((appointments::numeric / decision_maker_contacts) * 100, 2)
  end as appointment_rate,
  deals_won,
  case when appointments = 0 then 0
    else round((deals_won::numeric / appointments) * 100, 2)
  end as period_win_rate,
  revenue_cents
from aggregated
order by month_start desc, sort_order;

create or replace function public.recalculate_daily_sales_metrics(
  p_start_date date,
  p_end_date date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
  )
  insert into public.daily_sales_metrics (
    metric_date, sales_person_id, calls_gross, calls_net, talk_seconds,
    gatekeeper_contacts, connected_calls, direct_decision_maker_calls,
    decision_maker_contacts, appointments, setter_calls, setter_successes,
    closer_calls, closer_sales, no_shows, cancellations,
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
    coalesce(a.closer_sales, 0),
    coalesce(a.no_shows, 0),
    coalesce(a.cancellations, 0),
    coalesce(a.rescheduled_appointments, 0),
    coalesce(o.deals_won, 0),
    coalesce(o.revenue_cents, 0),
    null,
    now()
  from days d
  cross join public.sales_people p
  left join activity_totals a
    on a.metric_date = d.metric_date and a.sales_person_id = p.id
  left join opportunity_totals o
    on o.metric_date = d.metric_date and o.sales_person_id = p.id
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
$$;

create or replace function public.cleanup_dashboard_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff_month date := (
    date_trunc('month', now() at time zone 'Europe/Berlin') - interval '2 months'
  )::date;
  cutoff_timestamp timestamptz := cutoff_month::timestamp at time zone 'Europe/Berlin';
  deleted_raw bigint;
  deleted_opportunities bigint;
  deleted_metrics bigint;
  deleted_summaries bigint;
  deleted_targets bigint;
  deleted_sync_runs bigint;
begin
  with deleted as (
    delete from public.close_raw_activities
    where occurred_at < cutoff_timestamp
    returning 1
  ) select count(*) into deleted_raw from deleted;

  with deleted as (
    delete from public.close_opportunity_facts
    where won_date < cutoff_month
    returning 1
  ) select count(*) into deleted_opportunities from deleted;

  with deleted as (
    delete from public.daily_sales_metrics
    where metric_date < cutoff_month
    returning 1
  ) select count(*) into deleted_metrics from deleted;

  with deleted as (
    delete from public.daily_summaries
    where summary_date < cutoff_month
    returning 1
  ) select count(*) into deleted_summaries from deleted;

  with deleted as (
    delete from public.sales_targets
    where period_end < cutoff_month
    returning 1
  ) select count(*) into deleted_targets from deleted;

  with deleted as (
    delete from public.sync_runs
    where started_at < cutoff_timestamp
    returning 1
  ) select count(*) into deleted_sync_runs from deleted;

  return jsonb_build_object(
    'cutoffMonth', cutoff_month,
    'deletedRawActivities', deleted_raw,
    'deletedOpportunityFacts', deleted_opportunities,
    'deletedDailyMetrics', deleted_metrics,
    'deletedSummaries', deleted_summaries,
    'deletedTargets', deleted_targets,
    'deletedSyncRuns', deleted_sync_runs
  );
end;
$$;

grant select on public.dashboard_daily_metrics to authenticated;
grant select on public.dashboard_monthly_trends to authenticated;
grant execute on function public.get_dashboard_metrics(text, date) to authenticated;
grant execute on function public.get_call_hour_performance(text, date) to authenticated;
revoke all on function public.recalculate_daily_sales_metrics(date, date) from public, anon, authenticated;
grant execute on function public.recalculate_daily_sales_metrics(date, date) to service_role;
revoke all on function public.cleanup_dashboard_history() from public, anon, authenticated;
grant execute on function public.cleanup_dashboard_history() to service_role;

revoke all on public.close_raw_activities from anon, authenticated;
revoke all on public.close_activity_facts from anon, authenticated;
revoke all on public.close_opportunity_facts from anon, authenticated;
revoke all on public.sync_runs from anon;

commit;
