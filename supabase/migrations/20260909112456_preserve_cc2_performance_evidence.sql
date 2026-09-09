begin;
create or replace function public.get_month_pipeline_details_internal(p_reference_date date)
returns jsonb language sql stable security definer set search_path='' set jit=off as $$
with source as materialized (
 select data d from public.get_close_process_rows_internal((public.get_sales_data_as_of_internal() at time zone 'Europe/Berlin')::date)
 where (data->>'documented_booking')::boolean
 and date_trunc('month',(data->>'first_meeting_at')::timestamptz at time zone 'Europe/Berlin')=date_trunc('month',p_reference_date::timestamp)
), calendar as materialized (
 select c from jsonb_array_elements(public.get_reporting_calendar_internal('month',(date_trunc('month',p_reference_date::timestamp)+interval '1 month - 1 day')::date)) c
), details as (
 select d->>'process_id' process_id,d->>'lead_id' lead_id,l.display_name,d->>'source' source,d->>'owner' owner,
 d->>'first_meeting_at' first_meeting_at,d->>'setter_at' setter_at,d->>'qualified_at' qualified_at,
 d->>'closer_at' closer_at,d->>'cc2_at' cc2_at,d->>'won_at' won_at,d->>'setter_result' setter_result,
 d->>'next_meeting_at' next_meeting_at,d->>'next_stage' next_stage,
 (d->>'first_meeting_at')::timestamptz>public.get_sales_data_as_of_internal() future_first,
 (select min(c->>'outcome') from calendar where c->>'lead_id'=d->>'lead_id' and (c->>'starts_at')::timestamptz=(d->>'first_meeting_at')::timestamptz having count(*)=1) first_outcome,
 cc1.event_type cc1_result,cc2.event_type cc2_result,
 exists(select 1 from public.close_process_events e where e.process_id=d->>'process_id' and e.removed_at is null and coalesce((e.payload->>'applies_to_state')::boolean,true) and not coalesce((e.payload->>'state_conflict')::boolean,false) and e.occurred_at>=(d->>'first_meeting_at')::timestamptz and e.occurred_at<=public.get_sales_data_as_of_internal() and e.event_type in ('closer_completed','closer_follow_up','closer_lost','closer_sold','cc2_agreed') and (d->>'cc2_at' is null or e.occurred_at<=(d->>'cc2_at')::timestamptz)) cc1_held,
 exists(select 1 from public.close_process_events e where e.process_id=d->>'process_id' and e.removed_at is null and coalesce((e.payload->>'applies_to_state')::boolean,true) and not coalesce((e.payload->>'state_conflict')::boolean,false) and e.occurred_at>=(d->>'first_meeting_at')::timestamptz and e.occurred_at<=public.get_sales_data_as_of_internal() and (e.event_type='cc2_sold' or (d->>'cc2_at' is not null and e.occurred_at>(d->>'cc2_at')::timestamptz and e.event_type in ('closer_completed','closer_follow_up','closer_lost','closer_sold')))) cc2_held
 from source left join public.close_funnel_leads l on l.lead_id=d->>'lead_id'
 left join lateral (
  select case when count(distinct e.event_type)>1 then 'unclear' else min(e.event_type) end event_type from public.close_process_events e
  where e.process_id=d->>'process_id' and e.removed_at is null
  and e.event_type in ('closer_completed','closer_follow_up','closer_cancelled','closer_rescheduled','closer_no_show','closer_lost','closer_sold','cc2_agreed')
  and e.occurred_at>= (d->>'first_meeting_at')::timestamptz and e.occurred_at<=public.get_sales_data_as_of_internal()
  and (d->>'cc2_at' is null or e.occurred_at<=(d->>'cc2_at')::timestamptz)
  and coalesce((e.payload->>'applies_to_state')::boolean,true) and not coalesce((e.payload->>'state_conflict')::boolean,false)
  group by e.occurred_at order by e.occurred_at desc limit 1
 ) cc1 on true
 left join lateral (
  select case when count(distinct e.event_type)>1 then 'unclear' else min(e.event_type) end event_type from public.close_process_events e
  where e.process_id=d->>'process_id' and e.removed_at is null
  and e.event_type in ('closer_completed','closer_follow_up','closer_cancelled','closer_rescheduled','closer_no_show','closer_lost','closer_sold','cc2_sold')
  and (e.event_type='cc2_sold' or (d->>'cc2_at' is not null and e.occurred_at>(d->>'cc2_at')::timestamptz)) and e.occurred_at>=(d->>'first_meeting_at')::timestamptz and e.occurred_at<=public.get_sales_data_as_of_internal()
  and coalesce((e.payload->>'applies_to_state')::boolean,true) and not coalesce((e.payload->>'state_conflict')::boolean,false)
  group by e.occurred_at order by e.occurred_at desc limit 1
 ) cc2 on true
)
select coalesce(jsonb_agg(to_jsonb(details)||jsonb_build_object('stages',jsonb_build_object(
'first',jsonb_build_array(coalesce(nullif(first_outcome,'cancelled_plan'),case when first_outcome='cancelled_plan' then 'cancelled' else 'unknown' end)),
'setter',jsonb_build_array(case when setter_at is not null then case setter_result when 'setter_qualified' then 'qualified' when 'setter_follow_up' then 'followup' when 'setter_disqualified' then 'disqualified' else 'unknown' end else coalesce(nullif(first_outcome,'cancelled_plan'),case when first_outcome='cancelled_plan' then 'cancelled' else 'unknown' end) end,case when setter_at is not null then 'attended' end),
'closer1',case when qualified_at is not null or cc1_held or cc1_result is not null then jsonb_build_array(case when cc1_result is not null then case cc1_result when 'closer_completed' then 'attended' when 'closer_follow_up' then 'followup' when 'closer_cancelled' then 'cancelled' when 'closer_rescheduled' then 'rescheduled' when 'closer_no_show' then 'no_show' when 'closer_lost' then 'rejected' when 'closer_sold' then 'sold' when 'cc2_sold' then 'sold' when 'cc2_agreed' then 'cc2' else 'unknown' end when qualified_at is not null then 'planned' else 'unknown' end,case when cc1_held then 'attended' end,case when qualified_at is not null then 'qualified' end) end,
'cc2',case when cc2_at is not null or cc2_held or cc2_result is not null then jsonb_build_array(case when cc2_result is not null then case cc2_result when 'closer_completed' then 'attended' when 'closer_follow_up' then 'followup' when 'closer_cancelled' then 'cancelled' when 'closer_rescheduled' then 'rescheduled' when 'closer_no_show' then 'no_show' when 'closer_lost' then 'rejected' when 'closer_sold' then 'sold' when 'cc2_sold' then 'sold' when 'cc2_agreed' then 'cc2' else 'unknown' end else 'planned' end,case when cc2_held then 'attended' end,case when cc2_at is null then 'missing_agreement' end) end,
'won',case when won_at is not null then jsonb_build_array('won') end)) order by first_meeting_at,process_id),'[]'::jsonb) from details;
$$;
revoke all on function public.get_month_pipeline_details_internal(date) from public,anon,authenticated;
grant execute on function public.get_month_pipeline_details_internal(date) to service_role;

commit;
