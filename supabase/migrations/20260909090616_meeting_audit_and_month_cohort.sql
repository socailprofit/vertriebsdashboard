begin;
create or replace function public.get_reporting_calendar_internal(p_period text,p_reference_date date) returns jsonb
language sql stable security definer set search_path='' set jit=off as $$
with bounds as (
 select case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date else date_trunc('month',p_reference_date::timestamp)::date end start_date,
 case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date+6 else (date_trunc('month',p_reference_date::timestamp)+interval '1 month - 1 day')::date end end_date,
 least(public.get_sales_data_as_of_internal(),((p_reference_date+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond') cutoff
), setter as materialized(select m.* from bounds b cross join lateral public.get_setter_meetings_internal(b.start_date,b.end_date,false) m),
 outcomes as materialized(select o.* from bounds b cross join lateral public.get_setter_meeting_outcomes_internal(b.start_date,p_reference_date) o),
 planned as materialized(select x from jsonb_array_elements(public.get_antony_pipeline_snapshot(p_reference_date)->'scheduled_meetings') x),
 details as (
 select m.meeting_id,m.lead_id,m.starts_at,
 public.get_close_opener_internal(m.lead_id) owner,
 case when s.meeting_id is not null then 'setter' else coalesce(pl.x->>'stage','unassigned') end stage,
 case when m.starts_at>b.cutoff then case when m.status in ('canceled','cancelled','declined-by-lead','declined-by-org') then 'cancelled_plan' else 'planned' end
 when s.meeting_id is not null then coalesce(o.outcome,'unknown') else 'unknown' end outcome,
 coalesce((p.payload->>'first_meeting_at')::timestamptz,case when pl.x is not null then (select min((q.payload->>'first_meeting_at')::timestamptz) from public.close_sales_processes q where q.lead_id=m.lead_id and q.retired_at is null and (q.payload->>'opened_at')::timestamptz<=b.cutoff having count(*)=1) end) first_meeting_at,
 m.starts_at<=b.cutoff and s.meeting_id is not null and coalesce(o.outcome,'unknown') not in ('rescheduled','future') showrate_due,
 exists(select 1 from public.close_meeting_time_history h where h.meeting_id=m.meeting_id) rescheduled,
 b.cutoff data_as_of
 from public.close_meetings m cross join bounds b
 left join setter s on s.meeting_id=m.meeting_id
 left join outcomes o on o.meeting_id=m.meeting_id
 left join planned pl on pl.x->>'meeting_id'=m.meeting_id
 left join lateral (select min(r.process_id) process_id from public.close_process_meetings r where r.meeting_id=m.meeting_id and r.removed_at is null having count(distinct r.process_id)=1) rel on true
 left join public.close_sales_processes p on p.process_id=rel.process_id and p.retired_at is null
 where m.removed_at is null and not m.excluded_purpose and m.date_created<=b.cutoff
 and (m.starts_at at time zone 'Europe/Berlin')::date between b.start_date and b.end_date
 and not exists(select 1 from public.close_process_meetings r where r.meeting_id=m.meeting_id and r.removed_at is null and nullif(r.payload->>'superseded_by_meeting_id','') is not null)
)
select coalesce(jsonb_agg(to_jsonb(d) order by starts_at,meeting_id),'[]'::jsonb) from details d;
$$;
revoke all on function public.get_reporting_calendar_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_reporting_calendar_internal(text,date) to service_role;
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
,
 (select coalesce(jsonb_agg(jsonb_build_object(
 'lead_id',d->>'lead_id','process_id',d->>'process_id','source',d->>'source',
 'owner',public.get_close_opener_internal(d->>'lead_id'),'first_meeting_at',d->>'first_meeting_at',
 'setter_result',d->>'setter_result','state',d->>'state','stage',d->>'stage',
 'setter_at',d->>'setter_at','closer_at',d->>'closer_at','won_at',d->>'won_at'
 ) order by d->>'first_meeting_at',d->>'process_id'),'[]'::jsonb) from (select data d from public.get_close_process_rows_internal((public.get_sales_data_as_of_internal() at time zone 'Europe/Berlin')::date)) current_processes
 where (d->>'documented_booking')::boolean
 and (d->>'booked_date')::date between v_start and v_end
 and (d->>'first_meeting_at')::timestamptz<=least(public.get_sales_data_as_of_internal(),((v_end+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond'))
 into flow,timeline,lead_rows;
 origins:=public.get_close_process_activity_origins_internal(p_period,p_reference_date);
 return result||origins||jsonb_build_object('period_pipelines',public.get_period_pipelines_internal(p_period,p_reference_date,origins->'activity_by_origin'))||jsonb_build_object('calendar_rows',public.get_reporting_calendar_internal(p_period,p_reference_date),'lead_quality_rows',lead_rows,'owner_labels',public.get_close_opener_labels_internal(),'attribution_basis','close_lead_opener','reporting_version','2026-09-08.persistent-process','flow',flow,'timeline',timeline,
 'coverage',(result->'coverage')||jsonb_build_object('history_complete',true),
 'setter_attendance',(result->'setter_attendance')||jsonb_build_object('by_source',result->'setter_attendance'->'by_source'),
 'cohort_history',cohorts,'booking_cohort_history',cohorts,
 'funnel_by_source',coalesce((select jsonb_agg(c) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),'[]'::jsonb),
 'booking_cohort',coalesce((select jsonb_agg(c) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),'[]'::jsonb));
end;$function$;



revoke all on function public.get_antony_process_metrics_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_antony_process_metrics_internal(text,date) to service_role;


commit;
