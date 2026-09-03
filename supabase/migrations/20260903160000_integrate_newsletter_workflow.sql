begin;

-- Newsletter ist keine Call-Activity. Der separate, ausschließlich
-- serverseitig lesbare Bestand hält die Statusentwicklung genau des einen
-- freigegebenen Close-Workflows fest. Die JSON-Rohantwort bleibt für spätere
-- Abgleiche verfügbar, aber niemals für Dashboard-Browser erreichbar.
create table public.close_newsletter_subscriptions (
  close_subscription_id text primary key,
  workflow_id text not null,
  created_by_close_user_id text,
  subscription_created_at timestamptz not null,
  subscription_updated_at timestamptz not null,
  status text not null,
  mapping_version text not null,
  payload jsonb not null default '{}'::jsonb
);

create index close_newsletter_subscriptions_completed_lookup_idx
  on public.close_newsletter_subscriptions (subscription_updated_at desc, created_by_close_user_id)
  where status in ('goal', 'finished');

alter table public.close_newsletter_subscriptions enable row level security;
grant select, insert, update on public.close_newsletter_subscriptions to service_role;
revoke all on public.close_newsletter_subscriptions from anon, authenticated;

-- Close zeigt im Newsletter-Report nur Kontakte als „Completed“, die das Ziel
-- erreicht oder den Workflow beendet haben. Der Zeitpunkt ist date_updated,
-- weil der Statuswechsel — nicht die ursprüngliche Anmeldung — die Leistung
-- darstellt. Zuordnung erfolgt zum Ersteller der Anmeldung; Antony wird wegen
-- fehlender sales_people-Zuordnung nicht in Michael/Felix eingerechnet.
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
  ), newsletter_totals as (
    select
      (s.subscription_updated_at at time zone 'Europe/Berlin')::date as metric_date,
      p.id as sales_person_id,
      count(*)::integer as newsletters
    from public.close_newsletter_subscriptions s
    join public.sales_people p on p.close_user_id = s.created_by_close_user_id
    where s.status in ('goal', 'finished')
      and (s.subscription_updated_at at time zone 'Europe/Berlin')::date between p_start_date and p_end_date
    group by (s.subscription_updated_at at time zone 'Europe/Berlin')::date, p.id
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
  deleted_newsletter_subscriptions bigint;
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
    delete from public.close_newsletter_subscriptions
    where subscription_updated_at < cutoff_timestamp
    returning 1
  ) select count(*) into deleted_newsletter_subscriptions from deleted;

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
    'deletedNewsletterSubscriptions', deleted_newsletter_subscriptions,
    'deletedDailyMetrics', deleted_metrics,
    'deletedSummaries', deleted_summaries,
    'deletedTargets', deleted_targets,
    'deletedSyncRuns', deleted_sync_runs
  );
end;
$$;

revoke all on function public.recalculate_daily_sales_metrics(date, date) from public, anon, authenticated;
grant execute on function public.recalculate_daily_sales_metrics(date, date) to service_role;
revoke all on function public.cleanup_dashboard_history() from public, anon, authenticated;
grant execute on function public.cleanup_dashboard_history() to service_role;

commit;
