begin;

-- Historical three-month rankings must not include events after the selected
-- reference date. Preserve the existing RPC and all its KPI definitions.
do $migration$
declare v_before text; v_after text;
begin
  v_before := pg_get_functiondef('public.get_call_hour_performance(text,date)'::regprocedure);
  v_after := replace(v_before,
    'when ''trend'' then (date_trunc(''month'', p_reference_date::timestamp) + interval ''1 month - 1 day'')::date',
    'when ''trend'' then p_reference_date');
  if v_after <> v_before then
    execute v_after;
  elsif position('when ''trend'' then p_reference_date' in v_before) = 0 then
    raise exception 'Unexpected call-hour period definition; review before migration';
  end if;
end;
$migration$;

-- Add diagnostic counts without replacing the existing call/appointment
-- mapping. No CRM data is backfilled or changed by this read-only report.
create or replace function public.get_call_hour_report(
  p_period text,
  p_reference_date date default ((now() at time zone 'Europe/Berlin')::date)
) returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.has_dashboard_access() then
    raise exception 'Nicht berechtigt' using errcode = '42501';
  end if;
  if p_period is null or p_period not in ('day','week','month','trend') or p_reference_date is null then
    raise exception 'Invalid period' using errcode = '22023';
  end if;
  with base as materialized (
    select * from public.get_call_hour_performance(p_period, p_reference_date)
  ), bounds as (
    select min(period_start) start_date, max(period_end) end_date from base
  ), entries as (
    select p.slug, f.metric_hour, f.decision_maker_contacts, f.direct_decision_maker_calls,
      coalesce(r.payload->>'custom.cf_8Bjba56AJvfLXwNKJwhjVJwSmCdaHBlTVyH25kxp3M1',
        r.payload->>'custom.cf_cQiYFFuU9Cz20rbmDRy4qQiNYftCi4PZ6bMqCBPQdLB', '') result,
      coalesce(r.payload->>'custom.cf_LBuW6DB7vmgifhe2JUasZIhYvrOIjcAd7xB8hzYQrJ9',
        r.payload->>'custom.cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c', '') decision_result
    from public.close_activity_facts f
    join public.close_raw_activities r on r.close_activity_id = f.source_activity_id
    join public.sales_people p on p.close_user_id = f.close_user_id and p.active
    cross join bounds b
    where f.metric_date between b.start_date and b.end_date
      and r.activity_type = 'custom_activity'
      and r.payload->>'custom_activity_type_id' in ('actitype_3YiimGlbRMzQxr2O3hPKHJ','actitype_38qU8FYNxY0WkWAy66Uc65')
  ), counts as (
    select slug, metric_hour,
      sum(direct_decision_maker_calls) filter (where decision_maker_contacts > 0) as direct_decision_maker_calls,
      count(*) filter (where decision_maker_contacts = 0 and (
        result in ('CEO nicht erreichbar','GF nicht erreichbar')
        or decision_result in ('CEO nicht erreichbar','GF nicht erreichbar')
        or (result = '🛑 Kein Gatekeeper' and decision_result in ('Nicht erreicht','Nicht erreichbar','Keine Antwort'))
      )) as gf_unavailable_calls,
      count(*) filter (where decision_maker_contacts = 0 and result in ('CEO nicht erreichbar','GF nicht erreichbar')) as gatekeeper_unavailable_calls,
      count(*) filter (where result = 'Nicht durchgestellt') as gatekeeper_rejected,
      count(*) filter (where result = 'E-Mail senden') as gatekeeper_email_requested,
      count(*) filter (where result = 'Kein Interesse') as gatekeeper_no_interest
    from entries group by slug, metric_hour
  )
  select coalesce(jsonb_agg(to_jsonb(b) || jsonb_build_object(
    'direct_decision_maker_calls', coalesce(c.direct_decision_maker_calls, 0),
    'gf_unavailable_calls', coalesce(c.gf_unavailable_calls, 0),
    'gatekeeper_unavailable_calls', coalesce(c.gatekeeper_unavailable_calls, 0),
    'gatekeeper_rejected', coalesce(c.gatekeeper_rejected, 0),
    'gatekeeper_email_requested', coalesce(c.gatekeeper_email_requested, 0),
    'gatekeeper_no_interest', coalesce(c.gatekeeper_no_interest, 0)
  ) order by b.slug, b.metric_hour), '[]'::jsonb) into v_result
  from base b left join counts c on c.slug = b.slug and c.metric_hour = b.metric_hour;
  return v_result;
end;
$function$;
revoke all on function public.get_call_hour_report(text,date) from public, anon;
grant execute on function public.get_call_hour_report(text,date) to authenticated;
commit;
