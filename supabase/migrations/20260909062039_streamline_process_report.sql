begin;
-- Do not calculate and discard legacy lead cohorts, journeys and attribution
-- when the durable process report already supplies all three.
create function public.get_antony_process_base_internal(p_period text,p_reference_date date)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
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
      f.metric_date, f.metric_hour, f.appointments, f.setter_successes, f.closer_calls, f.closer_second_calls, f.closer_decided_calls, f.closer_sales,
      r.payload->>'custom_activity_type_id' as activity_type,
      r.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' as setter_result,
      r.payload->>'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' as closer_result,
      r.payload->>'custom.cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c' as followup_result,
      r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' as setter_status,
      r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' as closer_status
    from public.get_antony_activity_facts_internal(p_reference_date) f
    left join public.get_antony_outcome_payloads_internal(p_reference_date) r on r.close_activity_id=f.source_activity_id
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
  ), quality as (
    select count(*) as assessed_leads,
      count(*) filter(where result='✅ Closer terminiert') as qualified,
      count(*) filter(where result='🔎 Setter Follow Up') as followup,
      count(*) filter(where result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where coalesce(result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated
    from latest_quality
  ), setter_days as (
 select metric_date date,coalesce(p.slug,case when e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) owner,count(*) calls,count(distinct e.lead_id) leads,
 count(*) filter(where e.setter_result='✅ Closer terminiert') qualified,count(*) filter(where e.setter_result='🔎 Setter Follow Up') followup,
 count(*) filter(where e.setter_result='❌ Disqualifiziert') disqualified,count(*) filter(where coalesce(e.setter_result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) unrated
 from events e left join public.sales_people p on p.close_user_id=e.close_user_id where e.metric_date>=v_start and e.setter_calls=1 group by 1,2

 )
select jsonb_build_object('period',jsonb_build_object('start',v_start,'end',v_end,'timezone','Europe/Berlin'),
'activity',to_jsonb(t),'lead_quality',to_jsonb(q),
'setter_by_day',coalesce((select jsonb_agg(to_jsonb(s) order by s.date,s.owner) from setter_days s),'[]'::jsonb),
'timeline',coalesce((select jsonb_agg(to_jsonb(z) order by z.date,z.hour_bucket) from (select metric_date date,metric_hour hour_bucket,sum(setter_calls) setter_calls,sum(closer_second_calls) filter(where close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') cc2_agreed,sum(closer_sales) filter(where close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') closer_sales from events where metric_date>=v_start group by 1,2) z),'[]'::jsonb),
'coverage',jsonb_build_object('retention_start',(date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date,
 'complete_period',v_start>=(date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date and v_end<=(now() at time zone 'Europe/Berlin')::date),
'cohort_basis','Same documented process, grouped by its first scheduled Setter meeting; progress through cutoff.')
into v_result from totals t cross join quality q;
return v_result||jsonb_build_object('setter_attendance',public.get_setter_attendance_metrics_internal(v_start,v_end));
end;$$;
revoke all on function public.get_antony_process_base_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_antony_process_base_internal(text,date) to service_role;
create or replace function public.get_antony_process_metrics_internal(p_period text,p_reference_date date default (now() at time zone 'Europe/Berlin')::date)
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $$
declare result jsonb; cohorts jsonb; v_start date; v_end date; flow jsonb; timeline jsonb;
begin
 if not exists(select 1 from public.close_reconciliation_state where resource='funnel') then return public.get_antony_process_metrics_legacy_internal(p_period,p_reference_date);end if;
 result:=public.get_antony_process_base_internal(p_period,p_reference_date);
 v_start:=(result->'period'->>'start')::date;v_end:=(result->'period'->>'end')::date;
 cohorts:=public.get_close_process_cohorts_internal(p_reference_date);
 with p as materialized(select data d from public.get_close_process_rows_internal(p_reference_date)),
 setter as (select e.*,p.d from public.close_process_events e join p on p.d->>'process_id'=e.process_id
  where e.removed_at is null and e.event_type in ('setter_completed','setter_qualified','setter_follow_up','setter_disqualified')
  and (e.occurred_at at time zone 'Europe/Berlin')::date between v_start and v_end and e.occurred_at<=public.get_sales_data_as_of_internal()),
 qualifications as (select ((d->>'qualified_at')::timestamptz at time zone 'Europe/Berlin')::date date,
 extract(hour from (d->>'qualified_at')::timestamptz at time zone 'Europe/Berlin')::integer hour_bucket,count(*) total
 from p where d->>'qualified_at' is not null group by 1,2)
 select jsonb_build_object('new_processes',(select coalesce(sum((c->>'booked_leads')::integer),0) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),
 'carried_in',(select count(distinct process_id) from setter where (d->>'booked_date')::date<v_start),
 'first_qualified',(select count(*) from p where ((d->>'qualified_at')::timestamptz at time zone 'Europe/Berlin')::date between v_start and v_end),
 'repeat_setter_calls',(select count(*) from setter where occurred_at>(d->>'setter_at')::timestamptz),
 'unlinked_setter_calls',(select count(*) from setter where d->>'booked_date' is null),
 'cohort_basis','first_scheduled_meeting'),
 (select coalesce(jsonb_agg(j||jsonb_build_object('first_qualified',coalesce(q.total,0)) order by j->>'date',j->>'hour_bucket'),'[]'::jsonb)
 from jsonb_array_elements(coalesce(result->'timeline','[]')) j left join qualifications q
 on q.date=(j->>'date')::date and q.hour_bucket=(j->>'hour_bucket')::integer)
 into flow,timeline;
 return result||public.get_close_process_activity_origins_internal(p_period,p_reference_date)||jsonb_build_object('reporting_version','2026-09-08.persistent-process','flow',flow,'timeline',timeline,
 'coverage',(result->'coverage')||jsonb_build_object('history_complete',true),
 'setter_attendance',(result->'setter_attendance')||jsonb_build_object('by_source',public.apply_close_supplier_rules_internal(result->'setter_attendance'->'by_source')),
 'cohort_history',cohorts,'booking_cohort_history',cohorts,
 'funnel_by_source',coalesce((select jsonb_agg(c) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),'[]'::jsonb),
 'booking_cohort',coalesce((select jsonb_agg(c) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),'[]'::jsonb));
end;$$;
revoke all on function public.get_antony_process_metrics_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_antony_process_metrics_internal(text,date) to service_role;


commit;
