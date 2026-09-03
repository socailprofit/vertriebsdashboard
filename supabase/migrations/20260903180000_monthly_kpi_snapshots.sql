begin;

-- Ein Monatsabschluss bleibt dauerhaft erhalten, auch wenn die operativen
-- Tageswerte nach drei Monaten bereinigt werden. Die acht Werte sind bewusst
-- Rohgrößen: Alle späteren Quoten lassen sich daraus nachvollziehbar bilden.
create table if not exists public.monthly_kpi_snapshots (
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  sales_person_id uuid not null references public.sales_people(id) on delete restrict,
  calls_gross bigint not null default 0 check (calls_gross >= 0),
  calls_net bigint not null default 0 check (calls_net >= 0),
  gatekeeper_contacts bigint not null default 0 check (gatekeeper_contacts >= 0),
  connected_calls bigint not null default 0 check (connected_calls >= 0),
  direct_decision_maker_calls bigint not null default 0 check (direct_decision_maker_calls >= 0),
  decision_maker_contacts bigint not null default 0 check (decision_maker_contacts >= 0),
  appointments bigint not null default 0 check (appointments >= 0),
  newsletters bigint not null default 0 check (newsletters >= 0),
  snapshotted_at timestamptz not null default now(),
  primary key (month_start, sales_person_id)
);

create index if not exists monthly_kpi_snapshots_person_month_idx
  on public.monthly_kpi_snapshots (sales_person_id, month_start desc);

alter table public.monthly_kpi_snapshots enable row level security;

drop policy if exists monthly_kpi_snapshots_authenticated_read on public.monthly_kpi_snapshots;
create policy monthly_kpi_snapshots_authenticated_read
on public.monthly_kpi_snapshots for select
to authenticated
using (true);

revoke all on public.monthly_kpi_snapshots from anon;
grant select (
  month_start, sales_person_id, calls_gross, calls_net, gatekeeper_contacts,
  connected_calls, direct_decision_maker_calls, decision_maker_contacts,
  appointments, newsletters, snapshotted_at
) on public.monthly_kpi_snapshots to authenticated;

-- Legt genau einen unveränderlichen Monatsabschluss je Person an. Falls der
-- Job wiederholt wird, bleibt der bereits gesicherte Stand unangetastet.
create or replace function public.materialize_monthly_kpi_snapshot(p_month_start date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_month date := date_trunc('month', now() at time zone 'Europe/Berlin')::date;
  snapshot_rows integer;
begin
  if p_month_start is null or p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception 'Monthly snapshot must start on the first calendar day';
  end if;

  if p_month_start >= current_month then
    raise exception 'Cannot snapshot an unfinished current or future month';
  end if;

  insert into public.monthly_kpi_snapshots (
    month_start, sales_person_id, calls_gross, calls_net, gatekeeper_contacts,
    connected_calls, direct_decision_maker_calls, decision_maker_contacts,
    appointments, newsletters
  )
  select
    p_month_start,
    p.id,
    coalesce(sum(m.calls_gross), 0)::bigint,
    coalesce(sum(m.calls_net), 0)::bigint,
    coalesce(sum(m.gatekeeper_contacts), 0)::bigint,
    coalesce(sum(m.connected_calls), 0)::bigint,
    coalesce(sum(m.direct_decision_maker_calls), 0)::bigint,
    coalesce(sum(m.decision_maker_contacts), 0)::bigint,
    coalesce(sum(m.appointments), 0)::bigint,
    coalesce(sum(m.newsletters), 0)::bigint
  from public.sales_people p
  left join public.daily_sales_metrics m
    on m.sales_person_id = p.id
    and m.metric_date >= p_month_start
    and m.metric_date < (p_month_start + interval '1 month')::date
  where p.active = true
  group by p.id
  on conflict (month_start, sales_person_id) do nothing;

  get diagnostics snapshot_rows = row_count;
  return snapshot_rows;
end;
$$;

-- Der Datenbank-Job darf täglich laufen, schreibt aber nur am ersten lokalen
-- Kalendertag. So ist er unempfindlich gegen Monatslängen und Sommerzeit.
-- Der Vormonat ist dann bereits vom 23:52-UTC-Close-Sync vollständig erfasst.
create or replace function public.capture_previous_month_kpi_snapshots()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  berlin_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  if extract(day from berlin_today) <> 1 then
    return 0;
  end if;

  return public.materialize_monthly_kpi_snapshot(
    (date_trunc('month', berlin_today) - interval '1 month')::date
  );
end;
$$;

revoke all on function public.materialize_monthly_kpi_snapshot(date) from public, anon, authenticated;
revoke all on function public.capture_previous_month_kpi_snapshots() from public, anon, authenticated;

-- Bei Einführung vorhandene abgeschlossene Monate sichern, bevor die
-- Drei-Monats-Bereinigung ihre Tageswerte entfernt.
select public.materialize_monthly_kpi_snapshot(month_start)
from (
  select distinct date_trunc('month', metric_date)::date as month_start
  from public.daily_sales_metrics
  where metric_date < date_trunc('month', now() at time zone 'Europe/Berlin')::date
) completed_months
order by month_start;

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'capture_monthly_kpi_snapshots';

-- 00:05 UTC ist 01:05 bzw. 02:05 in Berlin und folgt damit dem letzten
-- stündlichen Close-Sync. Die Funktion selbst prüft zusätzlich den lokalen
-- Monatswechsel, sodass nie versehentlich an einem anderen Tag geschrieben wird.
select cron.schedule(
  'capture_monthly_kpi_snapshots',
  '5 0 * * *',
  $cron$
    select public.capture_previous_month_kpi_snapshots();
  $cron$
);

commit;
