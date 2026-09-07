begin;
create table public.close_newsletter_sends (
 close_email_id text primary key,
 workflow_id text not null default 'seq_1CghCZOXaNSlwDSOIpljTy'
   check (workflow_id = 'seq_1CghCZOXaNSlwDSOIpljTy'),
 close_user_id text,
 sent_at timestamptz not null,
 mapping_version text not null
);
create index close_newsletter_sends_date_user_idx on public.close_newsletter_sends(sent_at,close_user_id);
alter table public.close_newsletter_sends enable row level security;
revoke all on public.close_newsletter_sends from public,anon,authenticated;
grant select,insert,update,delete on public.close_newsletter_sends to service_role;
comment on table public.close_newsletter_sends is 'Actual sent outgoing emails of the approved Newsletter workflow; no email bodies or recipient details.';

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
$function$
;

create or replace function public.replace_newsletter_sends(p_start_date date,p_end_date date,p_sends jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare affected integer;
begin
 if p_start_date is null or p_end_date is null or p_end_date < p_start_date
   or p_end_date-p_start_date > 100 or p_sends is null or jsonb_typeof(p_sends) <> 'array'
   or jsonb_array_length(p_sends) > 20000 then
   raise exception 'Invalid newsletter replacement window or payload';
 end if;
 perform pg_advisory_xact_lock(hashtext('public.replace_newsletter_sends'));
 if exists (
   select 1 from jsonb_to_recordset(p_sends) as s(close_email_id text,sent_at timestamptz,mapping_version text)
   where coalesce(s.close_email_id,'')='' or s.sent_at is null or s.mapping_version is null
     or (s.sent_at at time zone 'Europe/Berlin')::date not between p_start_date and p_end_date
 ) then raise exception 'Invalid newsletter send'; end if;
 delete from public.close_newsletter_sends
 where (sent_at at time zone 'Europe/Berlin')::date between p_start_date and p_end_date;
 insert into public.close_newsletter_sends(close_email_id,close_user_id,sent_at,mapping_version)
 select s.close_email_id,s.close_user_id,s.sent_at,s.mapping_version
 from jsonb_to_recordset(p_sends) as s(close_email_id text,close_user_id text,sent_at timestamptz,mapping_version text)
 on conflict(close_email_id) do update set close_user_id=excluded.close_user_id,
 sent_at=excluded.sent_at,mapping_version=excluded.mapping_version;
 get diagnostics affected = row_count;
 insert into public.daily_sales_metrics(metric_date,sales_person_id,newsletters)
 select d.day::date,p.id,count(s.close_email_id)::integer
 from generate_series(p_start_date::timestamp,p_end_date::timestamp,interval '1 day') d(day)
 cross join public.sales_people p
 left join public.close_newsletter_sends s on s.close_user_id=p.close_user_id
   and (s.sent_at at time zone 'Europe/Berlin')::date=d.day::date
 where p.active=true
 group by d.day,p.id
 on conflict(metric_date,sales_person_id) do update set newsletters=excluded.newsletters;
 -- Correct only newsletter totals in complete retained monthly archives.
 update public.monthly_kpi_snapshots m set newsletters=(
   select coalesce(sum(d.newsletters),0) from public.daily_sales_metrics d
   where d.metric_date>=m.month_start and d.metric_date<(m.month_start+interval '1 month')::date
 )
 where m.month_start>=p_start_date and (m.month_start+interval '1 month'-interval '1 day')::date<=p_end_date;
 return affected;
end;
$$;
revoke all on function public.replace_newsletter_sends(date,date,jsonb) from public,anon,authenticated;
grant execute on function public.replace_newsletter_sends(date,date,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.cleanup_dashboard_history()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  delete from public.close_newsletter_sends where sent_at < cutoff_timestamp;

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
$function$
;
commit;
