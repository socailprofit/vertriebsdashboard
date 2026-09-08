begin;
-- Additional read-only reporting. Uses the existing reconciled facts/raw choices;
-- never interprets CRM notes or invents lead-quality grades.
create or replace function public.get_antony_process_metrics_internal(
  p_period text, p_reference_date date default (now() at time zone 'Europe/Berlin')::date
) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
      case when booking.found then booking.owner_id else l.opener_close_user_id end as owner_id,
      case when booking.found then 'booking_activity' when l.opener_close_user_id is not null then 'current_opener' else 'unassigned' end as attribution
    from latest_quality q left join public.close_lead_reporting l on l.lead_id=q.lead_id
    left join lateral (
      select true as found, case when count(distinct e.close_user_id)=1 then max(e.close_user_id) end as owner_id
      from all_events e where e.lead_id=q.lead_id and e.appointments=1 and e.occurred_at=(
        select max(b.occurred_at) from all_events b where b.lead_id=q.lead_id and b.appointments=1 and b.occurred_at<=q.occurred_at
      ) having count(*)>0
    ) booking on true
  ), quality_groups as (
    select coalesce(q.lead_source,'Nicht zugeordnet') as source,
      case when q.owner_id is null then 'unassigned' else coalesce(p.slug,'other') end as owner,
      q.attribution, count(*) as assessed_leads,
      count(*) filter(where q.result='✅ Closer terminiert') as qualified,
      count(*) filter(where q.result='🔎 Setter Follow Up') as followup,
      count(*) filter(where q.result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where coalesce(q.result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated
    from quality_attribution q left join public.sales_people p on p.close_user_id=q.owner_id
    group by 1,2,3
  ), first_bookings as (
    -- One booking cohort per distinct lead, even after repeated calls/rescheduling.
    select lead_id, min(occurred_at) as booked_at from events
    where appointments=1 and lead_id is not null group by lead_id
  ), booked_leads as (
    select b.lead_id,b.booked_at,
      case when count(distinct e.close_user_id)=1 then max(e.close_user_id) end as owner_id
    from first_bookings b join events e on e.lead_id=b.lead_id and e.appointments=1 and e.occurred_at=b.booked_at
    group by b.lead_id,b.booked_at
  ), cohort_outcomes as (
    select b.*, l.lead_source, coalesce(s.arrived,false) as arrived, s.result, n.status,
      exists(select 1 from all_events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_calls=1) as closer_arrived,
      exists(select 1 from all_events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_sales=1) as sold,
      exists(select 1 from public.close_opportunity_facts o where o.lead_id=b.lead_id and o.won_at>=b.booked_at and o.won_date<=v_end
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
      case when c.owner_id is null then 'unassigned' else coalesce(p.slug,'other') end as owner,
      count(*) as booked_leads, count(*) filter(where arrived) as setter_arrived,
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
    from cohort_outcomes c left join public.sales_people p on p.close_user_id=c.owner_id group by 1,2
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
    'booking_cohort',coalesce((select jsonb_agg(to_jsonb(c) order by c.source,c.owner) from cohort_groups c),'[]'::jsonb),
    'quality_basis','Latest Setter result per distinct lead inside period. Supplier: latest recorded prior booking; explicitly marked current Opener fallback. Source: current Close field, not historical.',
    'cohort_basis','Distinct leads first booked within period; outcomes after booking through period end. Booking actor is supplier. Repeat bookings count once. Arrival share is progress to cutoff, not a mature show rate. No-Shows/cancellations/reschedules shown only for leads not yet in Setter.')
  into v_result from totals t cross join quality q;
  return v_result;
end;
$$;
revoke all on function public.get_antony_process_metrics_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_antony_process_metrics_internal(text,date) to service_role;

create or replace function public.get_antony_process_metrics(
 p_period text,p_reference_date date default (now() at time zone 'Europe/Berlin')::date
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_antony_access() then
   raise exception 'Nicht berechtigt' using errcode='42501';
 end if;
 return public.get_antony_process_metrics_internal(p_period,p_reference_date);
end;
$$;
revoke all on function public.get_antony_process_metrics(text,date) from public,anon;
grant execute on function public.get_antony_process_metrics(text,date) to authenticated;
commit;
