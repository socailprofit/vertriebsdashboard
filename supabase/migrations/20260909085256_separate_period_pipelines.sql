begin;
-- Activity is partitioned by the documented first calendar meeting of its
-- persistent process. Booking creation never selects a reporting period.
create or replace function public.get_period_pipelines_internal(p_period text,p_reference_date date,p_activity jsonb)
returns jsonb language sql stable security definer set search_path='' set jit=off as $$
with bounds as (
 select case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date
 when 'month' then date_trunc('month',p_reference_date::timestamp)::date
 else (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end start_date,
 case p_period when 'day' then p_reference_date when 'week' then (date_trunc('week',p_reference_date::timestamp)::date+4)
 else (date_trunc('month',p_reference_date::timestamp)+interval '1 month' - interval '1 day')::date end calendar_end
), limits as (
 select *,least(p_reference_date,calendar_end) end_date,
 least(public.get_sales_data_as_of_internal(),((least(p_reference_date,calendar_end)+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond') cutoff from bounds
), processes as materialized (
 select p.process_id,p.lead_id,(p.payload->>'first_meeting_at')::timestamptz first_at,
 case when (p.payload->>'first_meeting_at')::timestamptz < (l.start_date::timestamp at time zone 'Europe/Berlin') then 'prior'
 when ((p.payload->>'first_meeting_at')::timestamptz at time zone 'Europe/Berlin')::date between l.start_date and l.calendar_end then 'current'
 else 'unknown' end origin
 from public.close_sales_processes p cross join limits l where p.retired_at is null
 and (p.payload->>'opened_at')::timestamptz<=l.cutoff
), calendar_links as (
 select r.meeting_id,case when count(distinct r.process_id)=1 then min(r.process_id) end process_id
 from public.close_process_meetings r join processes p on p.process_id=r.process_id where r.removed_at is null group by r.meeting_id
), meetings as materialized (
 select distinct on(m.meeting_id) m.meeting_id,r.process_id,coalesce(p.origin,'unknown') origin,m.starts_at,
 m.starts_at<=l.cutoff elapsed,coalesce(m.status,'') not in ('canceled','cancelled','declined','declined-by-lead') valid
 from limits l cross join lateral public.get_setter_meetings_internal(l.start_date,l.calendar_end,false) m
 left join calendar_links r on r.meeting_id=m.meeting_id left join processes p on p.process_id=r.process_id
 where m.date_created<=l.cutoff order by m.meeting_id
), activity as (
 select a,case when (a->>'booked_date')::date<l.start_date then 'prior'
 when (a->>'booked_date')::date between l.start_date and l.end_date then 'current' else 'unknown' end origin
 from jsonb_array_elements(coalesce(p_activity,'[]'::jsonb)) a cross join limits l
), active_processes as (
 select p.process_id,p.origin from processes p cross join limits l
 where p.first_at between (l.start_date::timestamp at time zone 'Europe/Berlin') and l.cutoff
 union
 select p.process_id,p.origin from processes p join public.close_process_events e on e.process_id=p.process_id cross join limits l
 where e.removed_at is null and e.occurred_at between (l.start_date::timestamp at time zone 'Europe/Berlin') and l.cutoff
 and e.event_type in ('setter_completed','setter_qualified','setter_follow_up','setter_disqualified','closer_completed','closer_sold','cc2_sold','cc2_agreed','closer_follow_up','closer_lost','customer_won')
 union select process_id,origin from meetings where elapsed and process_id is not null
), groups as (
 select g.origin,g.ord,jsonb_build_object('origin',g.origin,
 'processes',(select count(*) from active_processes p where p.origin=g.origin),
 'setter_meetings',(select count(*) from meetings m where m.origin=g.origin and m.elapsed),
 'future_setter_meetings',(select count(*) from meetings m where m.origin=g.origin and not m.elapsed and m.valid),
 'closer_meetings',null,'future_closer_meetings',null,
 'setter_calls',coalesce((select sum((a->>'setter_calls')::integer) from activity a where a.origin=g.origin),0),
 'closer_calls',coalesce((select sum((a->>'closer_calls')::integer) from activity a where a.origin=g.origin),0),
 'cc2_agreed',coalesce((select sum((a->>'cc2_agreed')::integer) from activity a where a.origin=g.origin),0),
 'new_customers',coalesce((select sum((a->>'new_customers')::integer) from activity a where a.origin=g.origin),0)) data
 from (values('current',1),('prior',2),('unknown',3)) g(origin,ord)
)
select jsonb_build_object('period_start',l.start_date,'period_end',l.end_date,'planning_end',l.calendar_end,
 'data_as_of',l.cutoff,'origin_basis','first_scheduled_setter_meeting','calendar_coverage','setter_only',
 'groups',(select jsonb_agg(data order by ord) from groups)) from limits l;
$$;
revoke all on function public.get_period_pipelines_internal(text,date,jsonb) from public,anon,authenticated;
grant execute on function public.get_period_pipelines_internal(text,date,jsonb) to service_role;

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
 return result||origins||jsonb_build_object('period_pipelines',public.get_period_pipelines_internal(p_period,p_reference_date,origins->'activity_by_origin'))||jsonb_build_object('lead_quality_rows',lead_rows,'owner_labels',public.get_close_opener_labels_internal(),'attribution_basis','close_lead_opener','reporting_version','2026-09-08.persistent-process','flow',flow,'timeline',timeline,
 'coverage',(result->'coverage')||jsonb_build_object('history_complete',true),
 'setter_attendance',(result->'setter_attendance')||jsonb_build_object('by_source',result->'setter_attendance'->'by_source'),
 'cohort_history',cohorts,'booking_cohort_history',cohorts,
 'funnel_by_source',coalesce((select jsonb_agg(c) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),'[]'::jsonb),
 'booking_cohort',coalesce((select jsonb_agg(c) from jsonb_array_elements(cohorts) c where (c->>'booked_date')::date between v_start and v_end),'[]'::jsonb));
end;$function$;



revoke all on function public.get_antony_process_metrics_internal(text,date) from public,anon,authenticated;
grant execute on function public.get_antony_process_metrics_internal(text,date) to service_role;

CREATE OR REPLACE FUNCTION public.get_antony_report(p_period text, p_reference_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
 SET statement_timeout TO '20s'
AS $function$
declare c jsonb;p jsonb;mc jsonb;mp jsonb;
begin
 if auth.uid() is null or not public.has_antony_access() then raise exception 'Nicht berechtigt' using errcode='42501';end if;
 if p_period is null or p_reference_date is null or p_period not in ('day','week','month') then raise exception 'Invalid period' using errcode='22023';end if;
 select to_jsonb(x) into c from public.get_antony_closing_metrics_internal(p_period,p_reference_date) x;
 p:=public.get_antony_process_metrics_internal(p_period,p_reference_date);
 if p_period='month' then mc:=c;mp:=p;else
  select to_jsonb(x) into mc from public.get_antony_closing_metrics_internal('month',p_reference_date) x;
  mp:=public.get_antony_process_metrics_internal('month',p_reference_date);
 end if;
 return jsonb_build_object('closing',c,'process',p,'data_as_of',public.get_sales_data_as_of_internal(),
 'performance',(select coalesce(jsonb_agg(to_jsonb(x) order by x.bucket_index),'[]'::jsonb) from public.get_antony_performance_series_internal(p_period,p_reference_date) x),
 'pipeline',public.get_antony_pipeline_snapshot(p_reference_date),
 'quarter',null,
 'planner',jsonb_build_object('closing',mc,'process',mp,'appointment_by_owner',(select coalesce(jsonb_object_agg(x.slug,x.n),'{}'::jsonb) from (select public.get_close_opener_internal(m.lead_id) slug,count(*) n
 from public.get_setter_meetings_internal(date_trunc('month',p_reference_date::timestamp)::date,p_reference_date,true) m
 left join public.close_funnel_leads l on l.lead_id=m.lead_id group by 1) x)));
end;$function$;

commit;
