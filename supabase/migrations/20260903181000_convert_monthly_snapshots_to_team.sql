begin;

-- Korrektur des ersten Snapshot-Entwurfs: Historisch wird ausschließlich die
-- gesamte Teamleistung gesichert, nicht die Einzelleistung je Vertriebler.
-- Der Zwischenschritt bleibt migrationssicher: eventuell schon angelegte
-- Monatszeilen werden beim Umbau zu einer Teamzeile je Monat verdichtet.
create table public.monthly_kpi_snapshots_team_rebuild (
  month_start date primary key check (month_start = date_trunc('month', month_start)::date),
  calls_gross bigint not null default 0 check (calls_gross >= 0),
  calls_net bigint not null default 0 check (calls_net >= 0),
  gatekeeper_contacts bigint not null default 0 check (gatekeeper_contacts >= 0),
  connected_calls bigint not null default 0 check (connected_calls >= 0),
  direct_decision_maker_calls bigint not null default 0 check (direct_decision_maker_calls >= 0),
  decision_maker_contacts bigint not null default 0 check (decision_maker_contacts >= 0),
  appointments bigint not null default 0 check (appointments >= 0),
  newsletters bigint not null default 0 check (newsletters >= 0),
  snapshotted_at timestamptz not null default now()
);

insert into public.monthly_kpi_snapshots_team_rebuild (
  month_start, calls_gross, calls_net, gatekeeper_contacts, connected_calls,
  direct_decision_maker_calls, decision_maker_contacts, appointments,
  newsletters, snapshotted_at
)
select
  month_start,
  sum(calls_gross)::bigint,
  sum(calls_net)::bigint,
  sum(gatekeeper_contacts)::bigint,
  sum(connected_calls)::bigint,
  sum(direct_decision_maker_calls)::bigint,
  sum(decision_maker_contacts)::bigint,
  sum(appointments)::bigint,
  sum(newsletters)::bigint,
  min(snapshotted_at)
from public.monthly_kpi_snapshots
group by month_start;

drop table public.monthly_kpi_snapshots;
alter table public.monthly_kpi_snapshots_team_rebuild rename to monthly_kpi_snapshots;

-- Backend-only: Die Tabelle wird bewusst weder vom Browser noch vom
-- Dashboard gelesen. Zugriff erfolgt nur über Datenbankbetrieb bzw. Service.
alter table public.monthly_kpi_snapshots enable row level security;
revoke all on public.monthly_kpi_snapshots from anon, authenticated;

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
    month_start, calls_gross, calls_net, gatekeeper_contacts, connected_calls,
    direct_decision_maker_calls, decision_maker_contacts, appointments,
    newsletters
  )
  select
    p_month_start,
    coalesce(sum(m.calls_gross), 0)::bigint,
    coalesce(sum(m.calls_net), 0)::bigint,
    coalesce(sum(m.gatekeeper_contacts), 0)::bigint,
    coalesce(sum(m.connected_calls), 0)::bigint,
    coalesce(sum(m.direct_decision_maker_calls), 0)::bigint,
    coalesce(sum(m.decision_maker_contacts), 0)::bigint,
    coalesce(sum(m.appointments), 0)::bigint,
    coalesce(sum(m.newsletters), 0)::bigint
  from public.daily_sales_metrics m
  where m.metric_date >= p_month_start
    and m.metric_date < (p_month_start + interval '1 month')::date
  on conflict (month_start) do nothing;

  get diagnostics snapshot_rows = row_count;
  return snapshot_rows;
end;
$$;

-- Ergänzt nur mögliche Lücken; bereits gesicherte Monatsabschlüsse bleiben
-- unverändert. So bleibt der Monatsstand auch nach der Drei-Monats-Bereinigung
-- nachvollziehbar.
select public.materialize_monthly_kpi_snapshot(month_start)
from (
  select distinct date_trunc('month', metric_date)::date as month_start
  from public.daily_sales_metrics
  where metric_date < date_trunc('month', now() at time zone 'Europe/Berlin')::date
) completed_months
order by month_start;

revoke all on function public.materialize_monthly_kpi_snapshot(date) from public, anon, authenticated;

commit;
