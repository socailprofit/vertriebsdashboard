begin;

create or replace function public.get_antony_status_report(p_period text,p_reference_date date default ((now() at time zone 'Europe/Berlin')::date))
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $function$
declare
 v_snapshot timestamptz;
 v_cutoff timestamptz;
 v_start date;
 v_end date;
 v_result jsonb;
begin
 if auth.uid() is null or not public.has_antony_access() then
  raise exception 'Nicht berechtigt' using errcode='42501';
 end if;
 if p_period is null or p_period not in ('day','week','month','trend') or p_reference_date is null then
  raise exception 'Ungültiger Zeitraum' using errcode='22023';
 end if;
 select snapshot_started_at into v_snapshot from public.close_reconciliation_state where resource='funnel';
 if v_snapshot is null then raise exception 'Statusdaten noch nicht synchronisiert' using errcode='55000'; end if;
 v_cutoff:=least(now(),v_snapshot,((p_reference_date+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond');
 v_end:=(v_cutoff at time zone 'Europe/Berlin')::date;
 v_start:=case p_period when 'day' then p_reference_date
  when 'week' then date_trunc('week',p_reference_date::timestamp)::date
  when 'month' then date_trunc('month',p_reference_date::timestamp)::date
  when 'trend' then (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
 -- The source sync began its complete lead-status history on 1 July 2026.
 -- Never silently turn unavailable earlier history into zero performance.
 if v_start<'2026-07-01'::date then raise exception 'Statushistorie erst ab 01.07.2026 verfügbar' using errcode='22023'; end if;

 with events as materialized (
  select e.source_event_id,e.lead_id,e.occurred_at,e.previous_status,e.new_status,
   coalesce(l.display_name,e.lead_id) lead_name,
   coalesce(old.label,'Anderer Close-Status') previous_label,
   coalesce(new.label,'Anderer Close-Status') new_label
  from public.close_funnel_events e
  left join private.antony_status_definitions old on old.status_id=e.previous_status
  left join private.antony_status_definitions new on new.status_id=e.new_status
  left join public.close_funnel_leads l on l.lead_id=e.lead_id
  where e.source_kind='lead_status_change' and e.is_current and e.withdrawn_at is null
   and e.previous_status is distinct from e.new_status
   and e.occurred_at >= (v_start::timestamp at time zone 'Europe/Berlin')
   and e.occurred_at <= v_cutoff
   and (old.metric_key is not null or new.metric_key is not null)
 ), status_rows as (
  select d.status_id,d.label,d.metric_key,d.sort_order,
   count(distinct e.lead_id) filter(where e.new_status=d.status_id) entered_leads,
   count(distinct e.lead_id) filter(where e.previous_status=d.status_id) left_leads,
   count(*) filter(where e.new_status=d.status_id) entered_events,
   count(*) filter(where e.previous_status=d.status_id) left_events
  from private.antony_status_definitions d
  left join events e on e.new_status=d.status_id or e.previous_status=d.status_id
  where d.metric_key is not null group by d.status_id
 ), transitions as (
  select previous_status,new_status,previous_label,new_label,count(*) events,count(distinct lead_id) leads
  from events group by previous_status,new_status,previous_label,new_label
 )
 select jsonb_build_object(
  'version','2026-09-09.historical-statuses','period',jsonb_build_object('type',p_period,'start',v_start,'end',v_end),
  'data_as_of',v_snapshot,'cutoff',v_cutoff,'coverage_start','2026-07-01',
  'statuses',(select coalesce(jsonb_agg(to_jsonb(s) order by sort_order),'[]'::jsonb) from status_rows s),
  'transitions',(select coalesce(jsonb_agg(to_jsonb(t) order by previous_status,events desc,new_status),'[]'::jsonb) from transitions t),
  'events',(select coalesce(jsonb_agg(to_jsonb(e) order by occurred_at,source_event_id),'[]'::jsonb) from events e)
 ) into v_result;
 -- Attendance is independent of the status-transition counts above. Only
 -- published, explicitly documented outcomes are eligible; no calendar fallback.
 with source as materialized (
  select distinct on (e.source_event_id) e.source_event_id,e.lead_id,e.occurred_at,e.event_type,e.payload
  from public.close_funnel_events e
  where e.source_kind='custom_activity' and e.is_current and e.withdrawn_at is null
   and e.payload->>'status'='published'
   and e.event_type in ('setter_activity','closer_activity','attendance_activity')
   and e.occurred_at >= (v_start::timestamp at time zone 'Europe/Berlin') and e.occurred_at <= v_cutoff
  order by e.source_event_id,e.occurred_at desc
 ), outcomes as (
  select source_event_id,lead_id,occurred_at,'setter' stage,
   case when payload->'custom'->>'cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo'
    in ('✅ Closer terminiert','❌ Disqualifiziert','🔎 Setter Follow Up') then 'show' else 'unknown' end outcome,
   payload->'custom'->>'cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' result
  from source where event_type='setter_activity'
  union all
  select source_event_id,lead_id,occurred_at,'closer',
   case when payload->'custom'->>'cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn'
    in ('1. ✅ Verkauft - in CC1','2. 🔥 CC2 vereinbart','3. ✅ Verkauft - in CC2 🔥','4. ❌ Nicht verkauft') then 'show' else 'unknown' end,
   payload->'custom'->>'cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn'
  from source where event_type='closer_activity'
  union all
  select s.source_event_id,s.lead_id,s.occurred_at,v.stage,
   case v.result when 'Nicht erschienen' then 'no_show' when '⛔ Abgesagt' then 'cancelled'
    when '🔄 Termin verschoben' then 'rescheduled' else 'unknown' end,v.result
  from source s cross join lateral (values
   ('setter',s.payload->'custom'->>'cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz'),
   ('closer',s.payload->'custom'->>'cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q')) v(stage,result)
  where s.event_type='attendance_activity' and nullif(v.result,'') is not null
  union all
  select source_event_id,lead_id,occurred_at,'unassigned','unknown',null
  from source where event_type='attendance_activity'
   and nullif(payload->'custom'->>'cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz','') is null
   and nullif(payload->'custom'->>'cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q','') is null
 ), evidence as (
  select o.*,coalesce(l.display_name,o.lead_id) lead_name from outcomes o
  left join public.close_funnel_leads l on l.lead_id=o.lead_id
 )
 select v_result || jsonb_build_object('attendance_events',coalesce(jsonb_agg(to_jsonb(e) order by occurred_at,source_event_id,stage),'[]'::jsonb),
  'attendance_basis','published_explicit_activity_outcomes') into v_result from evidence e;
 return v_result;
end;
$function$;
revoke all on function public.get_antony_status_report(text,date) from public,anon;
grant execute on function public.get_antony_status_report(text,date) to authenticated;
comment on function public.get_antony_status_report(text,date) is
 'Historical Setting-to-Sold lead status changes. Unique leads and repeated transitions are separate. Separate explicit attendance outcomes; no calendar, booking, cohort, forecast or opportunity fallback. Leadership authorization required.';
commit;
