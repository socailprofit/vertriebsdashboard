begin;
-- Calendar date selects the cohort; an earlier documented cancellation remains valid.

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
    from public.get_antony_activity_facts_internal(p_reference_date) f
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
 select first.*, (select min(h.occurred_at) from public.close_meetings m join public.close_booking_history h on h.source_activity_id=m.booking_activity_id where m.lead_id=first.lead_id and m.starts_at=first.booked_at and m.removed_at is null) as booking_created_at from public.get_close_first_bookings_internal(v_end) first
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
        select max(x.occurred_at) from all_events x where x.lead_id=b.lead_id and x.setter_status is not null and x.occurred_at>=case when x.setter_status in ('⛔ Abgesagt','🔄 Termin verschoben') then coalesce(b.booking_created_at,b.booked_at) else b.booked_at end
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

create or replace function public.get_antony_pipeline_snapshot(p_reference_date date default (now() at time zone 'Europe/Berlin')::date)
returns jsonb language sql stable security definer set search_path='' as $$
 with parameters as (select p_reference_date as_of,(date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date window_start),
 events as (
 select f.lead_id,case when f.appointments=1 then coalesce((select h.occurred_at from public.close_meetings m join public.close_booking_history h on h.source_activity_id=m.booking_activity_id where m.meeting_id=f.source_activity_id),f.occurred_at) else f.occurred_at end as occurred_at,
 case when f.closer_calls=1 and f.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then case when f.closer_sales=1 then 'sold_pending_won' when f.closer_decided_calls=1 then 'closed' when f.closer_second_calls=1 then 'pending_decision_cc2' else 'unrated' end
 when r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' is not null then case r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' when '⛔ Abgesagt' then 'closed' when 'Nicht erschienen' then 'closer_no_show' when '🔄 Termin verschoben' then 'rescheduled_closer' else 'unrated' end
 when f.setter_calls=1 then case r.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' when '✅ Closer terminiert' then 'closer_scheduled' when '🔎 Setter Follow Up' then 'setter_followup' when '❌ Disqualifiziert' then 'closed' else 'unrated' end
 when r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' is not null then case r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' when '⛔ Abgesagt' then 'closed' when 'Nicht erschienen' then 'setter_no_show' when '🔄 Termin verschoben' then 'rescheduled_setter' else 'unrated' end
 when f.appointments=1 then 'setter_pending' end status
 from public.get_antony_activity_facts_internal(p_reference_date) f join parameters p on f.metric_date between p.window_start and p.as_of
 left join public.close_raw_activities r on r.close_activity_id=f.source_activity_id
 where f.lead_id is not null and f.source_type='custom_activity' and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')
 ), ordered as (select *,dense_rank() over(partition by lead_id order by occurred_at desc) rank from events where status is not null),
 latest as (select lead_id,max(occurred_at) status_since,case when count(distinct status)=1 then max(status) else 'unrated' end status from ordered where rank=1 group by lead_id),
 open as (select l.* from latest l where l.status<>'closed' and not exists(select 1 from public.close_opportunity_facts o where o.lead_id=l.lead_id and o.won_date<=p_reference_date))
 select jsonb_build_object('as_of',p.as_of,'window_start',p.window_start,'timezone','Europe/Berlin','retention_months',3,
 'counts',jsonb_build_object('total_open',count(o.lead_id),
 'setter_pending',count(*) filter(where o.status='setter_pending'),'setter_followup',count(*) filter(where o.status='setter_followup'),'rescheduled_setter',count(*) filter(where o.status='rescheduled_setter'),'setter_no_show',count(*) filter(where o.status='setter_no_show'),'closer_scheduled',count(*) filter(where o.status='closer_scheduled'),'rescheduled_closer',count(*) filter(where o.status='rescheduled_closer'),'closer_no_show',count(*) filter(where o.status='closer_no_show'),'pending_decision_cc2',count(*) filter(where o.status='pending_decision_cc2'),'sold_pending_won',count(*) filter(where o.status='sold_pending_won'),'unrated',count(*) filter(where o.status='unrated'),
 'from_previous_months',count(*) filter(where (o.status_since at time zone 'Europe/Berlin')::date<date_trunc('month',p.as_of::timestamp)::date),
 'older_than_14_days',count(*) filter(where (o.status_since at time zone 'Europe/Berlin')::date<p.as_of-14)),
 'oldest_open_date',(min(o.status_since) at time zone 'Europe/Berlin')::date)
 from parameters p left join open o on true group by p.as_of,p.window_start;
$$;

commit;
