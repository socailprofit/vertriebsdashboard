begin;
-- A complete, minimal booking snapshot survives raw-activity retention. No
-- notes or contact details are stored. Corrections and deletions reconcile.
create table public.close_booking_history (
 source_activity_id text primary key, lead_id text not null,
 close_user_id text not null, occurred_at timestamptz not null,
 metric_date date not null check(metric_date=(occurred_at at time zone 'Europe/Berlin')::date)
);
create index close_booking_history_lead_time on public.close_booking_history(lead_id,occurred_at);
alter table public.close_booking_history enable row level security;
revoke all on public.close_booking_history from public,anon,authenticated;
grant all on public.close_booking_history to service_role;

create or replace function public.get_close_first_bookings_internal(p_as_of date)
returns table(lead_id text,booked_at timestamptz,booked_date date,owner_id text)
language sql stable security definer set search_path='' as $$
 with bookings as (
 select h.lead_id,h.occurred_at,h.close_user_id from public.close_booking_history h where h.metric_date<=p_as_of
 union
 select f.lead_id,f.occurred_at,f.close_user_id from public.close_activity_facts f
 where f.source_type='custom_activity' and f.appointments=1 and f.lead_id is not null and f.metric_date<=p_as_of
 ), first_dates as (select lead_id,min(occurred_at) at from bookings group by lead_id)
 select d.lead_id,d.at,(d.at at time zone 'Europe/Berlin')::date,
 case when count(distinct b.close_user_id)=1 then max(b.close_user_id) end
 from first_dates d join bookings b on b.lead_id=d.lead_id and b.occurred_at=d.at group by d.lead_id,d.at;
$$;
revoke all on function public.get_close_first_bookings_internal(date) from public,anon,authenticated;
grant execute on function public.get_close_first_bookings_internal(date) to service_role;
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
      select f->>'lead_id' as id from jsonb_array_elements(p_facts) f where (f->>'setter_calls')::int>0 or (f->>'appointments')::int>0 or (f->>'closer_calls')::int>0 or (f->>'no_shows')::int>0 or (f->>'cancellations')::int>0 or (f->>'rescheduled_appointments')::int>0
      union select o->>'lead_id' from jsonb_array_elements(p_opportunities) o
    ) required where not exists (select 1 from jsonb_array_elements(p_leads) l where l->>'lead_id'=required.id)
  ) or exists (
    select 1 from jsonb_array_elements(p_leads) l where l->>'lead_id' is null
      or not exists(select 1 from jsonb_array_elements(p_facts) f where f->>'lead_id'=l->>'lead_id' and ((f->>'setter_calls')::int>0 or (f->>'appointments')::int>0 or (f->>'closer_calls')::int>0 or (f->>'no_shows')::int>0 or (f->>'cancellations')::int>0 or (f->>'rescheduled_appointments')::int>0))
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

create or replace function public.reconcile_close_sales_snapshot(
 p_start_date date,p_end_date date,p_snapshot_started_at timestamptz,
 p_raw jsonb,p_facts jsonb,p_opportunities jsonb,p_leads jsonb,p_bookings jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if jsonb_typeof(p_bookings) is distinct from 'array' or jsonb_array_length(p_bookings)>20000 then raise exception 'Invalid booking snapshot';end if;
 if exists(select 1 from jsonb_populate_recordset(null::public.close_booking_history,p_bookings) b
 where b.source_activity_id is null or b.lead_id is null or b.occurred_at is null or b.metric_date is null
 or b.metric_date is distinct from (b.occurred_at at time zone 'Europe/Berlin')::date
 or b.metric_date>p_end_date or b.close_user_id is null or b.close_user_id not in (
 'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'))
 or exists(select 1 from jsonb_array_elements(p_bookings) b group by b->>'source_activity_id' having count(*)>1)
 then raise exception 'Invalid booking rows';end if;
 -- The retained subset must match in BOTH directions, including corrections.
 if exists(
 select 1 from jsonb_populate_recordset(null::public.close_booking_history,p_bookings) b
 full join (select * from jsonb_populate_recordset(null::public.close_activity_facts,p_facts) where appointments=1) f
 on f.source_activity_id=b.source_activity_id
 where (b.metric_date>=p_start_date or f.source_activity_id is not null)
 and (b.source_activity_id is null or f.source_activity_id is null or b.lead_id is distinct from f.lead_id
 or b.close_user_id is distinct from f.close_user_id or b.occurred_at is distinct from f.occurred_at)
 ) then raise exception 'Incomplete booking snapshot';end if;
 -- Same transaction and stale-snapshot lock as facts, Won and metadata.
 v_result:=public.reconcile_close_custom_and_won(p_start_date,p_end_date,p_snapshot_started_at,p_raw,p_facts,p_opportunities,p_leads);
 delete from public.close_booking_history where source_activity_id is not null;
 insert into public.close_booking_history select * from jsonb_populate_recordset(null::public.close_booking_history,p_bookings);
 return v_result||jsonb_build_object('booking_history',jsonb_array_length(p_bookings));
end;$$;
revoke all on function public.reconcile_close_sales_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reconcile_close_sales_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
create or replace function public.get_antony_journey_metrics_internal(p_period text,p_reference_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_start date;v_end date;v_result jsonb;
begin
 if p_reference_date is null or p_period is null or p_period not in ('day','week','month','three_months') then raise exception 'Invalid reporting period' using errcode='22023';end if;
 v_start:=case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date when 'month' then date_trunc('month',p_reference_date::timestamp)::date else (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
 v_end:=case when p_period='week' then least(v_start+4,p_reference_date) else p_reference_date end;
 with events as materialized (select f.*, r.payload,
 r.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' setter_result,
 r.payload->>'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' closer_result,
 r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' setter_status,
 r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' closer_status
 from public.close_activity_facts f left join public.close_raw_activities r on r.close_activity_id=f.source_activity_id
 where f.source_type='custom_activity' and f.metric_date<=v_end and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')),
 customers as materialized (select * from public.get_customer_acquisitions_internal(v_end)),
 bookings as (select * from public.get_close_first_bookings_internal(v_end)
 where booked_date>=(date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date),
 journeys as (
 select b.*,l.lead_source,s.at setter_at,q.at qualified_at,c.at closer_at,oc.at observed_closer_at,
 ag.at cc2_agreed_at,held.at cc2_held_at,lastc.result,lastc.at last_closer_at,firstsale.at first_sale_at,
 case when cs.at>lastc.at then cs.status end latest_closer_status,
 cust.won_date,case when lastc.result in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥','4. ❌ Nicht verkauft') then true else false end decided
 from bookings b left join public.close_lead_reporting l on l.lead_id=b.lead_id
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.setter_calls=1) s on true
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.occurred_at>=s.at and e.setter_successes=1) q on true
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.occurred_at>=q.at and e.closer_calls=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') c on true
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_calls=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') oc on true
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_second_calls=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') ag on true
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_calls=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and (e.occurred_at>ag.at or e.closer_result='3. ✅ Verkauft - in CC2 🔥')) held on true
 left join lateral(select max(e.occurred_at) at,case when count(distinct coalesce(e.closer_result,''))=1 then max(e.closer_result) end result from events e
 where e.lead_id=b.lead_id and e.closer_calls=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and e.occurred_at=(select max(x.occurred_at) from events x where x.lead_id=b.lead_id and x.closer_calls=1 and x.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and x.occurred_at>=b.booked_at)) lastc on true
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.closer_sales=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and e.occurred_at>=c.at) firstsale on true
 left join lateral(select max(e.occurred_at) at,case when count(distinct e.closer_status)=1 then max(e.closer_status) else 'Unklar' end status from events e where e.lead_id=b.lead_id and e.closer_status is not null and e.occurred_at=(select max(x.occurred_at) from events x where x.lead_id=b.lead_id and x.closer_status is not null and x.occurred_at>=b.booked_at)) cs on true
 left join customers cust on cust.lead_id=b.lead_id and cust.won_date>=(b.booked_at at time zone 'Europe/Berlin')::date and cust.closer_close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
 ), grouped as (
 select coalesce(j.lead_source,'Nicht zugeordnet') source,case when j.owner_id is null then 'unassigned' else coalesce(p.slug,case when j.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end owner,
 j.booked_date,count(*) booked_leads,count(*) filter(where setter_at is not null) setter_arrived,
 count(*) filter(where qualified_at is not null) closer_qualified,count(*) filter(where closer_at is not null) closer_arrived,
 count(*) filter(where closer_at is not null and decided) decided_leads,
 count(*) filter(where closer_at is not null and result in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥')) sold_leads,
 count(*) filter(where closer_at is not null and result in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥') and won_date>=(first_sale_at at time zone 'Europe/Berlin')::date) new_customers,
 count(*) filter(where won_date is not null) observed_customers,
 count(*) filter(where observed_closer_at is not null and closer_at is null) unlinked_closer,
 count(*) filter(where won_date is not null and not(coalesce(closer_at is not null and result in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥') and won_date>=(first_sale_at at time zone 'Europe/Berlin')::date,false))) unlinked_customer,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at) cc2_agreed,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and cc2_held_at is not null) cc2_held,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and cc2_held_at is not null and result in ('3. ✅ Verkauft - in CC2 🔥','4. ❌ Nicht verkauft')) cc2_decided,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and cc2_held_at is not null and result='3. ✅ Verkauft - in CC2 🔥') cc2_sold,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and cc2_held_at is not null and result='4. ❌ Nicht verkauft') cc2_lost,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and cc2_held_at is null and latest_closer_status is null) cc2_waiting,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and cc2_held_at is not null and not decided and latest_closer_status is null) cc2_open,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and not decided and latest_closer_status='⛔ Abgesagt') cc2_cancelled,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and not decided and latest_closer_status='Nicht erschienen') cc2_no_show,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and not decided and latest_closer_status='🔄 Termin verschoben') cc2_rescheduled,
 count(*) filter(where cc2_held_at is not null and cc2_agreed_at is null) cc2_missing_agreement,
 count(*) filter(where closer_at is not null and cc2_agreed_at is null and cc2_held_at is null and result='1. ✅ Verkauft - in CC1') cc1_sold,
 count(*) filter(where closer_at is not null and cc2_agreed_at is null and cc2_held_at is null and result='4. ❌ Nicht verkauft') cc1_lost
 from journeys j left join public.sales_people p on p.close_user_id=j.owner_id group by 1,2,3
 ), setter_days as (
 select metric_date date,coalesce(p.slug,case when e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) owner,count(*) calls,count(distinct e.lead_id) leads,
 count(*) filter(where e.setter_result='✅ Closer terminiert') qualified,count(*) filter(where e.setter_result='🔎 Setter Follow Up') followup,
 count(*) filter(where e.setter_result='❌ Disqualifiziert') disqualified,count(*) filter(where coalesce(e.setter_result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) unrated
 from events e left join public.sales_people p on p.close_user_id=e.close_user_id where e.metric_date>=v_start and e.setter_calls=1 group by 1,2
 ), setter_origin as (
 select e.*,b.booked_date from events e left join public.get_close_first_bookings_internal(v_end) b on b.lead_id=e.lead_id and b.booked_at<=e.occurred_at where e.setter_calls=1 and e.metric_date>=v_start
 ), customer_origin as (
 select o.*,b.booked_date from customers o left join public.get_close_first_bookings_internal(v_end) b on b.lead_id=o.lead_id and b.booked_date<=o.won_date where o.won_date>=v_start and o.closer_close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
 ), closer_events as (
 select e.*,exists(select 1 from events old where old.lead_id=e.lead_id and old.closer_second_calls=1 and old.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and old.occurred_at<e.occurred_at) after_cc2
 from events e where e.closer_calls=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and e.metric_date>=v_start
 )
 select jsonb_build_object('reporting_version','2026-09-08.cohort-v3',
 'funnel_by_source',coalesce((select jsonb_agg(to_jsonb(g) order by g.source,g.owner) from grouped g where g.booked_date>=v_start),'[]'::jsonb),
 'cohort_history',coalesce((select jsonb_agg(to_jsonb(g) order by g.booked_date,g.source,g.owner) from grouped g),'[]'::jsonb),
 'setter_by_day',coalesce((select jsonb_agg(to_jsonb(s) order by s.date,s.owner) from setter_days s),'[]'::jsonb),
 'timeline',coalesce((select jsonb_agg(to_jsonb(z) order by z.date,z.hour_bucket) from (select metric_date date,metric_hour hour_bucket,sum(setter_calls) setter_calls,sum(closer_second_calls) filter(where close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') cc2_agreed,sum(closer_sales) filter(where close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') closer_sales from events where metric_date>=v_start group by 1,2) z),'[]'::jsonb),
 'period_bridge',jsonb_build_object(
 'setter_calls',(select count(*) from setter_origin),'setter_leads',(select count(distinct lead_id) from setter_origin),
 'setter_from_period_bookings',(select count(*) from setter_origin where booked_date>=v_start),
 'setter_from_prior_bookings',(select count(*) from setter_origin where booked_date<v_start),
 'setter_without_booking',(select count(*) from setter_origin where booked_date is null),
 'new_customers',(select count(*) from customer_origin),'customers_from_period_bookings',(select count(*) from customer_origin where booked_date>=v_start),
 'customers_from_prior_bookings',(select count(*) from customer_origin where booked_date<v_start),'customers_without_booking',(select count(*) from customer_origin where booked_date is null),
 'sales_after_prior_won',(select count(*) from events e join customers o on o.lead_id=e.lead_id where e.metric_date>=v_start and e.closer_sales=1 and o.won_date<e.metric_date),
 'cc2_calls',(select count(*) from closer_events where after_cc2 or closer_result='3. ✅ Verkauft - in CC2 🔥'),
 'cc1_calls',(select count(*) from closer_events where not after_cc2 and closer_result<>'3. ✅ Verkauft - in CC2 🔥'),
 'cc2_lost',(select count(*) from closer_events where after_cc2 and closer_result='4. ❌ Nicht verkauft'),
 'cc1_lost',(select count(*) from closer_events where not after_cc2 and closer_result='4. ❌ Nicht verkauft')),
 'coverage',jsonb_build_object('retention_start',(date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date,
 'complete_period',v_start>=(date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date and v_end<=(now() at time zone 'Europe/Berlin')::date)) into v_result;
 return v_result;
end;$$;
revoke all on function public.get_antony_journey_metrics_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_antony_journey_metrics_internal(text,date) to service_role;



create or replace function public.get_antony_activity_origins_internal(p_period text,p_reference_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_start date;v_end date;v_result jsonb;
begin
 if p_period not in ('day','week','month','three_months') or p_period is null or p_reference_date is null then raise exception 'Invalid period';end if;
 v_start:=case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date when 'month' then date_trunc('month',p_reference_date::timestamp)::date else (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
 v_end:=case when p_period='week' then least(v_start+4,p_reference_date) else p_reference_date end;
 with all_events as (
    select f.source_activity_id, f.lead_id, f.occurred_at, f.close_user_id, f.setter_calls,
      f.metric_date, f.appointments, f.setter_successes, f.closer_calls, f.closer_second_calls, f.closer_decided_calls, f.closer_sales,
      r.payload->>'custom_activity_type_id' as activity_type,
      r.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' as setter_result,
      r.payload->>'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' as closer_result,
      r.payload->>'custom.cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c' as followup_result,
      r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' as setter_status,
      r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' as closer_status
    from public.close_activity_facts f
    left join public.close_raw_activities r on r.close_activity_id=f.source_activity_id
    where f.source_type='custom_activity' and f.metric_date <= v_end
      and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')

 ), events as (
 select e.*,b.booked_date,b.owner_id,coalesce(l.lead_source,'Nicht zugeordnet') source,
 case when b.owner_id is null then 'unassigned' else coalesce(p.slug,case when b.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end owner
 from all_events e left join public.get_close_first_bookings_internal(v_end) b on b.lead_id=e.lead_id and b.booked_at<=e.occurred_at
 left join public.close_lead_reporting l on l.lead_id=e.lead_id left join public.sales_people p on p.close_user_id=b.owner_id
 where e.metric_date>=v_start
 and (e.appointments>0 or e.setter_calls>0 or e.closer_calls>0 or e.setter_status is not null or e.closer_status is not null or e.activity_type='actitype_38qU8FYNxY0WkWAy66Uc65')
 ), grouped as (
    select source,owner,booked_date,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65') as followup_contacts,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Follow Up') as further_followups,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Termin vereinbart') as followup_appointments,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: unqualifiziert') as followup_disqualified,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: kein Interesse') as followup_no_interest,
      count(*) filter(where setter_calls=1) as setter_calls,
      count(*) filter(where setter_calls=1 and setter_result='✅ Closer terminiert') as setter_qualified,
      count(*) filter(where setter_calls=1 and setter_result='🔎 Setter Follow Up') as setter_followups,
      count(*) filter(where setter_calls=1 and setter_result='❌ Disqualifiziert') as setter_disqualified,
      count(*) filter(where setter_calls=1 and coalesce(setter_result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as setter_unrated,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='Nicht erschienen') as setter_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='⛔ Abgesagt') as setter_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='🔄 Termin verschoben') as setter_rescheduled,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='Nicht erschienen') as closer_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='⛔ Abgesagt') as closer_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='🔄 Termin verschoben') as closer_rescheduled,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') as closer_calls,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='1. ✅ Verkauft - in CC1') as cc1_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='3. ✅ Verkauft - in CC2 🔥') as cc2_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='2. 🔥 CC2 vereinbart') as cc2_agreed,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='4. ❌ Nicht verkauft') as closer_lost,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and coalesce(closer_result,'') not in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥','2. 🔥 CC2 vereinbart','4. ❌ Nicht verkauft')) as closer_unrated
,
 sum(appointments) appointments,
 count(*) filter(where setter_calls=1 and booked_date>=v_start) setter_from_period_bookings,
 count(*) filter(where setter_calls=1 and booked_date<v_start) setter_from_prior_bookings,
 count(*) filter(where setter_calls=1 and booked_date is null) setter_without_booking
,
 count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and (closer_result='3. ✅ Verkauft - in CC2 🔥' or exists(select 1 from all_events old where old.lead_id=events.lead_id and old.closer_second_calls=1 and old.occurred_at<events.occurred_at))) cc2_calls,
 count(*) filter(where closer_result='4. ❌ Nicht verkauft' and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and exists(select 1 from all_events old where old.lead_id=events.lead_id and old.closer_second_calls=1 and old.occurred_at<events.occurred_at)) cc2_lost,
 count(*) filter(where closer_result='4. ❌ Nicht verkauft' and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and not exists(select 1 from all_events old where old.lead_id=events.lead_id and old.closer_second_calls=1 and old.occurred_at<events.occurred_at)) cc1_lost,
 count(*) filter(where closer_sales=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and exists(select 1 from public.get_customer_acquisitions_internal(v_end) o where o.lead_id=events.lead_id and o.won_date<events.metric_date)) sales_after_prior_won
 from events group by source,owner,booked_date
 ), customers as (
 select coalesce(l.lead_source,'Nicht zugeordnet') source,
 case when b.owner_id is null then 'unassigned' else coalesce(p.slug,case when b.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end owner,
 b.booked_date,count(*) new_customers
 from public.get_customer_acquisitions_internal(v_end) o
 left join public.get_close_first_bookings_internal(v_end) b on b.lead_id=o.lead_id and b.booked_date<=o.won_date
 left join public.close_lead_reporting l on l.lead_id=o.lead_id left join public.sales_people p on p.close_user_id=b.owner_id
 where o.won_date>=v_start and o.closer_close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
 group by 1,2,3
 ), combined as (
 select coalesce(to_jsonb(g),'{}'::jsonb)||jsonb_build_object('source',coalesce(g.source,c.source),'owner',coalesce(g.owner,c.owner),
 'booked_date',coalesce(g.booked_date,c.booked_date),'new_customers',coalesce(c.new_customers,0)) row
 from grouped g full join customers c on c.source=g.source and c.owner=g.owner and c.booked_date is not distinct from g.booked_date
 )
 select jsonb_build_object('activity_by_origin',coalesce((select jsonb_agg(row order by row->>'booked_date',row->>'source',row->>'owner') from combined),'[]'::jsonb),
 'origin_basis','First documented booking, independent of report window. Missing or future bookings remain unknown. Activity dates and cohort conversion are separate.') into v_result;
 return v_result;
end;$$;
revoke all on function public.get_antony_activity_origins_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_antony_activity_origins_internal(text,date) to service_role;
CREATE OR REPLACE FUNCTION public.get_antony_process_metrics_internal(p_period text, p_reference_date date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_start date; v_end date; v_result jsonb;
begin
  if p_reference_date is null or p_period is null or p_period not in ('day','week','month','three_months') then
    raise exception 'Invalid process reporting period' using errcode='22023';
  end if;
  v_start := case p_period when 'day' then p_reference_date
    when 'week' then date_trunc('week',p_reference_date::timestamp)::date
    when 'month' then date_trunc('month',p_reference_date::timestamp)::date
    else (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
  v_end := case when p_period='week' then least(v_start+4,p_reference_date) else p_reference_date end;

  with all_events as (
    select f.source_activity_id, f.lead_id, f.occurred_at, f.close_user_id, f.setter_calls,
      f.metric_date, f.appointments, f.setter_successes, f.closer_calls, f.closer_second_calls, f.closer_decided_calls, f.closer_sales,
      r.payload->>'custom_activity_type_id' as activity_type,
      r.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' as setter_result,
      r.payload->>'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' as closer_result,
      r.payload->>'custom.cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c' as followup_result,
      r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' as setter_status,
      r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' as closer_status
    from public.close_activity_facts f
    left join public.close_raw_activities r on r.close_activity_id=f.source_activity_id
    where f.source_type='custom_activity' and f.metric_date <= v_end
      and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')
  ), events as (select * from all_events where metric_date >= v_start), totals as (
    select
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65') as followup_contacts,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Follow Up') as further_followups,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Termin vereinbart') as followup_appointments,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: unqualifiziert') as followup_disqualified,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: kein Interesse') as followup_no_interest,
      count(*) filter(where setter_calls=1) as setter_calls,
      count(*) filter(where setter_calls=1 and setter_result='✅ Closer terminiert') as setter_qualified,
      count(*) filter(where setter_calls=1 and setter_result='🔎 Setter Follow Up') as setter_followups,
      count(*) filter(where setter_calls=1 and setter_result='❌ Disqualifiziert') as setter_disqualified,
      count(*) filter(where setter_calls=1 and coalesce(setter_result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as setter_unrated,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='Nicht erschienen') as setter_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='⛔ Abgesagt') as setter_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='🔄 Termin verschoben') as setter_rescheduled,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='Nicht erschienen') as closer_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='⛔ Abgesagt') as closer_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='🔄 Termin verschoben') as closer_rescheduled,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') as closer_calls,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='1. ✅ Verkauft - in CC1') as cc1_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='3. ✅ Verkauft - in CC2 🔥') as cc2_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='2. 🔥 CC2 vereinbart') as cc2_agreed,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='4. ❌ Nicht verkauft') as closer_lost,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and coalesce(closer_result,'') not in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥','2. 🔥 CC2 vereinbart','4. ❌ Nicht verkauft')) as closer_unrated
    from events
  ), setter_order as (
    select lead_id, occurred_at, setter_result, dense_rank() over(partition by lead_id order by occurred_at desc) as latest
    from events where setter_calls=1 and lead_id is not null
  ), latest_quality as (
    -- Contradictory results at the same timestamp remain unassessed.
    select lead_id, max(occurred_at) as occurred_at, case when count(distinct coalesce(setter_result,''))=1 then max(setter_result) end as result
    from setter_order where latest=1 group by lead_id
  ), quality_attribution as (
    select q.*, l.lead_source,
      booking.owner_id as owner_id,
      case when booking.found then 'booking_activity' else 'unassigned' end as attribution
    from latest_quality q left join public.close_lead_reporting l on l.lead_id=q.lead_id
    left join (select true found,b.* from public.get_close_first_bookings_internal(v_end) b) booking
 on booking.lead_id=q.lead_id and booking.booked_at<=q.occurred_at
  ), quality_groups as (
    select coalesce(q.lead_source,'Nicht zugeordnet') as source,
      case when q.owner_id is null then 'unassigned' else coalesce(p.slug,case when q.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end as owner,
      q.attribution, count(*) as assessed_leads,
      count(*) filter(where q.result='✅ Closer terminiert') as qualified,
      count(*) filter(where q.result='🔎 Setter Follow Up') as followup,
      count(*) filter(where q.result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where coalesce(q.result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated
    from quality_attribution q left join public.sales_people p on p.close_user_id=q.owner_id
    group by 1,2,3
  ), booked_leads as (
 select * from public.get_close_first_bookings_internal(v_end)
 where booked_date>=(date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date
  ), cohort_outcomes as (
    select b.*, l.lead_source, coalesce(s.arrived,false) as arrived, s.result, n.status,
      exists(select 1 from all_events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_calls=1) as closer_arrived,
      exists(select 1 from all_events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_sales=1) as sold,
      exists(select 1 from public.get_customer_acquisitions_internal(v_end) o where o.lead_id=b.lead_id and o.won_date>=(b.booked_at at time zone 'Europe/Berlin')::date and o.won_date<=v_end
        and o.status_id='stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL') as customer
    from booked_leads b left join public.close_lead_reporting l on l.lead_id=b.lead_id
    left join lateral (
      select true as arrived, case when count(distinct coalesce(e.setter_result,''))=1 then max(e.setter_result) end as result
      from all_events e where e.lead_id=b.lead_id and e.setter_calls=1 and e.occurred_at=(
        select max(x.occurred_at) from all_events x where x.lead_id=b.lead_id and x.setter_calls=1 and x.occurred_at>=b.booked_at
      ) having count(*)>0
    ) s on true
    left join lateral (
      select case when count(distinct coalesce(e.setter_status,''))=1 then max(e.setter_status) end as status
      from all_events e where e.lead_id=b.lead_id and e.occurred_at=(
        select max(x.occurred_at) from all_events x where x.lead_id=b.lead_id and x.setter_status is not null and x.occurred_at>=b.booked_at
      ) and e.setter_status is not null
    ) n on true
  ), cohort_groups as (
    select coalesce(c.lead_source,'Nicht zugeordnet') as source,
      case when c.owner_id is null then 'unassigned' else coalesce(p.slug,case when c.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end as owner,
      c.booked_date,count(*) as booked_leads, count(*) filter(where arrived) as setter_arrived,
      count(*) filter(where not arrived) as not_in_setter,
      count(*) filter(where not arrived and coalesce(status,'') not in ('Nicht erschienen','⛔ Abgesagt','🔄 Termin verschoben')) as pending,
      count(*) filter(where not arrived and status='Nicht erschienen') as no_show,
      count(*) filter(where not arrived and status='⛔ Abgesagt') as cancelled,
      count(*) filter(where not arrived and status='🔄 Termin verschoben') as rescheduled,
      count(*) filter(where arrived and result='✅ Closer terminiert') as qualified,
      count(*) filter(where arrived and result='🔎 Setter Follow Up') as followup,
      count(*) filter(where arrived and result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where arrived and coalesce(result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated,
      count(*) filter(where closer_arrived) as closer_arrived,
      count(*) filter(where sold) as sold_leads, count(*) filter(where customer) as new_customers
    from cohort_outcomes c left join public.sales_people p on p.close_user_id=c.owner_id group by 1,2,3
  ), quality as (
    select count(*) as assessed_leads,
      count(*) filter(where result='✅ Closer terminiert') as qualified,
      count(*) filter(where result='🔎 Setter Follow Up') as followup,
      count(*) filter(where result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where coalesce(result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated
    from latest_quality
  )
  select jsonb_build_object('period',jsonb_build_object('start',v_start,'end',v_end,'timezone','Europe/Berlin'),
    'activity',to_jsonb(t), 'lead_quality',to_jsonb(q),
    'quality_by_source',coalesce((select jsonb_agg(to_jsonb(g) order by g.source,g.owner) from quality_groups g),'[]'::jsonb),
    'booking_cohort',coalesce((select jsonb_agg(to_jsonb(c) order by c.source,c.owner) from cohort_groups c where c.booked_date>=v_start),'[]'::jsonb),
    'booking_cohort_history',coalesce((select jsonb_agg(to_jsonb(c) order by c.booked_date,c.source,c.owner) from cohort_groups c),'[]'::jsonb),
    'quality_basis','Latest Setter result per distinct lead inside period. Supplier: first documented booking; missing booking stays unassigned. Source: current Close field, not historical.',
    'cohort_basis','Distinct leads whose first documented booking is within period; outcomes after booking through period end. Booking actor is supplier. Repeat bookings count once. Arrival share is progress to cutoff, not a mature show rate. No-Shows/cancellations/reschedules shown only for leads not yet in Setter.')
  into v_result from totals t cross join quality q;
  return v_result || public.get_antony_journey_metrics_internal(p_period,p_reference_date) || public.get_antony_activity_origins_internal(p_period,p_reference_date);
end;
$function$;


commit;
