-- The hosted safe-update extension requires a WHERE clause even for this
-- validated, complete replacement of the dedicated lead metadata snapshot.
begin;
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

  delete from public.close_lead_reporting where lead_id is not null;
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
