begin;
-- One population for the visible new-booking pipeline and origin-quality table.
create or replace function public.get_new_booking_tracking_internal(p_period text,p_reference_date date)
returns jsonb language sql stable security definer set search_path='' set jit=off as $$
with bounds as (
 select case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date else date_trunc('month',p_reference_date::timestamp)::date end start_date,
 case p_period when 'month' then (date_trunc('month',p_reference_date::timestamp)+interval '1 month - 1 day')::date else p_reference_date end end_date
), population as materialized (
 select r from jsonb_array_elements(public.get_month_pipeline_details_internal(p_reference_date)) r,bounds
 where r->>'booking_scope'='new' and ((r->>'first_meeting_at')::timestamptz at time zone 'Europe/Berlin')::date between start_date and end_date
), calendar as materialized (
 select c from bounds,jsonb_array_elements(public.get_reporting_calendar_internal(p_period,end_date)) c
 where exists(select 1 from population where r->>'lead_id'=c->>'lead_id'
 and (r->>'first_meeting_at')::timestamptz=(c->>'first_meeting_at')::timestamptz)
), aggregated as (
 select coalesce((select jsonb_agg(r) from population),'[]'::jsonb) leads,
 coalesce((select jsonb_agg(c) from calendar),'[]'::jsonb) meetings
)
select jsonb_build_object('period',jsonb_build_object('start',start_date,'end',end_date),
 'lead_quality_rows',leads,'calendar_rows',meetings,'quality_by_origin',public.get_origin_quality_rates_internal(meetings,leads),
 'funnel_by_source','[]'::jsonb,'population_basis','new_bookings_in_appointment_month')
from bounds,aggregated;
$$;
revoke all on function public.get_new_booking_tracking_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_new_booking_tracking_internal(text,date) to service_role;
CREATE OR REPLACE FUNCTION public.get_antony_process_metrics_internal(p_period text, p_reference_date date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare result jsonb; cohorts jsonb; v_start date; v_end date; flow jsonb; timeline jsonb; lead_rows jsonb; origins jsonb;
begin
 if not exists(select 1 from public.close_reconciliation_state where resource='funnel') then return public.get_antony_process_metrics_legacy_internal(p_period,p_reference_date);end if;
 result:=public.get_antony_process_base_internal(p_period,p_reference_date);
 v_start:=(result->'period'->>'start')::date;v_end:=(result->'period'->>'end')::date;
 cohorts:=public.get_close_process_cohorts_internal((public.get_sales_data_as_of_internal() at time zone 'Europe/Berlin')::date);
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
,
 (select coalesce(jsonb_agg(jsonb_build_object(
 'lead_id',d->>'lead_id','display_name',(select l.display_name from public.close_funnel_leads l where l.lead_id=d->>'lead_id'),'process_id',d->>'process_id','source',d->>'source',
 'owner',public.get_close_opener_internal(d->>'lead_id'),'first_meeting_at',d->>'first_meeting_at',
 'setter_result',d->>'setter_result','state',d->>'state','stage',d->>'stage',
 'setter_performed_by',(select case max(e.setter_id) when 'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'Antony' when 'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy' then 'Michael' when 'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4' then 'Felix' else null end from public.close_funnel_events e where e.lead_id=d->>'lead_id' and e.is_current and e.withdrawn_at is null and e.event_type='setter_activity' and e.occurred_at=(d->>'setter_at')::timestamptz having count(distinct e.setter_id)=1),
 'setter_at',d->>'setter_at','closer_at',d->>'closer_at','cc2_at',d->>'cc2_at','won_at',d->>'won_at'
 ) order by d->>'first_meeting_at',d->>'process_id'),'[]'::jsonb) from (select data d from public.get_close_process_rows_internal((public.get_sales_data_as_of_internal() at time zone 'Europe/Berlin')::date)) current_processes
 where (d->>'documented_booking')::boolean
 and (d->>'booked_date')::date between v_start and v_end
 and (d->>'first_meeting_at')::timestamptz<=least(public.get_sales_data_as_of_internal(),((v_end+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond'))
 into flow,timeline,lead_rows;
 origins:=public.get_close_process_activity_origins_internal(p_period,p_reference_date);
 return result||origins||jsonb_build_object('tracking_new',public.get_new_booking_tracking_internal(p_period,p_reference_date))||jsonb_build_object('quality_by_origin',public.get_origin_quality_rates_internal(public.get_reporting_calendar_internal(p_period,p_reference_date),lead_rows))||jsonb_build_object('month_pipeline_rows',public.get_month_pipeline_details_internal(p_reference_date))||jsonb_build_object('month_planning',jsonb_build_object('first_meetings',(
 select count(*) from public.get_close_process_rows_internal((public.get_sales_data_as_of_internal() at time zone 'Europe/Berlin')::date) rp
 where (rp.data->>'documented_booking')::boolean
 and (rp.data->>'first_meeting_at')::timestamptz>public.get_sales_data_as_of_internal()
 and date_trunc('month',(rp.data->>'first_meeting_at')::timestamptz at time zone 'Europe/Berlin')=date_trunc('month',p_reference_date::timestamp)
 and exists(select 1 from public.close_meetings m where m.lead_id=rp.data->>'lead_id' and m.starts_at=(rp.data->>'first_meeting_at')::timestamptz and m.status='upcoming' and m.removed_at is null and not m.excluded_purpose)
 )))||jsonb_build_object('period_pipelines',public.get_period_pipelines_internal(p_period,p_reference_date,origins->'activity_by_origin'))||jsonb_build_object('cohort_data_as_of',public.get_sales_data_as_of_internal(),'calendar_rows',public.get_reporting_calendar_internal(p_period,p_reference_date),'lead_quality_rows',lead_rows,'owner_labels',public.get_close_opener_labels_internal(),'attribution_basis','close_lead_opener','reporting_version','2026-09-08.persistent-process','flow',flow,'timeline',timeline,
 'coverage',(result->'coverage')||jsonb_build_object('history_complete',true),
 'setter_attendance',(result->'setter_attendance')||jsonb_build_object('by_source',result->'setter_attendance'->'by_source'),
 'cohort_history',cohorts,'booking_cohort_history',cohorts,
 'funnel_by_source',coalesce((select jsonb_agg(c) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),'[]'::jsonb),
 'booking_cohort',coalesce((select jsonb_agg(c) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),'[]'::jsonb));
end;$function$;
commit;
