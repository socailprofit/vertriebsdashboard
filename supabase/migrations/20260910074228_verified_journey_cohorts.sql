begin;
create or replace function public.get_antony_lead_selection_sources_internal(p_period text,p_reference_date date default ((now() at time zone 'Europe/Berlin')::date))
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $function$
declare v_snapshot timestamptz; v_start date; v_end date; v_result jsonb;
begin
 if auth.uid() is null or not public.has_antony_access() then raise exception 'Nicht berechtigt' using errcode='42501'; end if;
 if p_period is null or p_period not in ('day','week','month','trend') or p_reference_date is null then
  raise exception 'Ungültiger Zeitraum' using errcode='22023'; end if;
 select snapshot_started_at into v_snapshot from public.close_reconciliation_state where resource='funnel';
 if v_snapshot is null then raise exception 'Leaddaten noch nicht synchronisiert' using errcode='55000'; end if;
 v_snapshot:=least(v_snapshot,now());
 v_end:=least(p_reference_date,(v_snapshot at time zone 'Europe/Berlin')::date);
 v_start:=case p_period when 'day' then p_reference_date
  when 'week' then date_trunc('week',p_reference_date::timestamp)::date
  when 'month' then date_trunc('month',p_reference_date::timestamp)::date
  when 'trend' then (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
 if v_start<'2026-07-01'::date then raise exception 'Statushistorie erst ab 01.07.2026 verfügbar' using errcode='22023'; end if;

 with bounds as materialized (
  select s.*,(v_start::timestamp at time zone s.time_zone) selection_start,
   least(((p_reference_date+1)::timestamp at time zone s.time_zone),v_snapshot) selection_end
  from private.antony_lead_report_sources s
 ), selected as materialized (
  select s.key,e.lead_id,min((e.payload->>'date_created')::timestamptz) first_recorded_at,
   max((e.payload->>'date_created')::timestamptz) last_recorded_at,count(*) matching_events
  from bounds s join public.close_funnel_events e
   on (s.status_side='old' and e.previous_status=s.status_id) or (s.status_side='new' and e.new_status=s.status_id)
  where e.source_kind='lead_status_change' and e.is_current and e.withdrawn_at is null
   and (e.payload->>'date_created')::timestamptz >= s.selection_start
   and (e.payload->>'date_created')::timestamptz < s.selection_end
  group by s.key,e.lead_id
 ), leads as (
  select s.*,coalesce(l.display_name,s.lead_id) lead_name,l.status_id,
   coalesce(nullif(l.report_dimensions->>'status_label',''),d.label,'Status nicht verfügbar') status_label,
   coalesce(l.report_dimensions,'{}'::jsonb)||jsonb_build_object('lead_source',l.lead_source) dimensions,
   l.report_dimensions is not null metadata_ready
  from selected s left join public.close_funnel_leads l on l.lead_id=s.lead_id
  left join private.antony_status_definitions d on d.status_id=l.status_id
 ), history as materialized (
  select e.lead_id,e.source_event_id,(e.payload->>'date_created')::timestamptz recorded_at,e.previous_status,e.new_status status_id
  from public.close_funnel_events e
  where e.source_kind='lead_status_change' and e.is_current and e.withdrawn_at is null
   and exists(select 1 from selected s where s.lead_id=e.lead_id)
   and (e.payload->>'date_created')::timestamptz >= (select min(selection_start) from bounds)
   and (e.payload->>'date_created')::timestamptz < (select max(selection_end) from bounds)
 ), sources as (
  select s.key,s.label,s.share_url,s.status_side,s.status_id,s.time_zone,s.selection_start,s.selection_end,s.sort_order,count(l.lead_id) total,
   count(l.lead_id) filter(where not l.metadata_ready) metadata_pending,
   coalesce(jsonb_agg(to_jsonb(l) order by l.last_recorded_at desc,l.lead_id) filter(where l.lead_id is not null),'[]'::jsonb) leads
  from bounds s left join leads l on l.key=s.key
  group by s.key,s.label,s.share_url,s.status_side,s.status_id,s.time_zone,s.selection_start,s.selection_end,s.sort_order
 )
 select jsonb_build_object('version','2026-09-10.lead-selections',
  'period',jsonb_build_object('type',p_period,'start',v_start,'end',v_end),
  'data_as_of',v_snapshot,'selection_date_field','date_created','status_basis','latest_synced_lead_status',
  'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.recorded_at,h.source_event_id) from history h),'[]'::jsonb),
  'groups',coalesce(jsonb_agg(to_jsonb(s) order by s.sort_order),'[]'::jsonb)) into v_result from sources s;
 return v_result;
end;
$function$;

revoke all on function public.get_antony_lead_selection_sources_internal(text,date) from public,anon,authenticated;
-- No source-based or former-user-based Backoffice inference. A later verified
-- CRM rule may populate report_dimensions.backoffice_id with its evidence.
create or replace function public.get_close_opener_internal(p_lead_id text) returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select case
 when l.report_dimensions->>'backoffice_id'='linkedin' and nullif(l.report_dimensions->>'backoffice_basis','') is not null then 'linkedin'
 when p.slug in ('michael','felix','antony') then p.slug
 when nullif(l.opener_close_user_id,'') is not null then 'outside_current_team'
 else 'unassigned' end from public.close_funnel_leads l
 left join public.sales_people p on p.close_user_id=l.opener_close_user_id where l.lead_id=p_lead_id),'unassigned');
$$;

-- A complete per-lead history is authoritative outside the rolling window.
do $patch$
declare d text; old text := '(e.source_kind<>''lead_status_change'' or (e.payload->>''date_created'')::timestamptz>=p_status_created_since)';
begin
 select pg_get_functiondef(p.oid) into strict d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='reconcile_close_funnel_snapshot';
 if position(old in d)=0 then raise exception 'Snapshot history guard changed';end if;
 execute replace(d,old,'(e.source_kind<>''lead_status_change'' or (e.payload->>''date_created'')::timestamptz>=p_status_created_since or exists(select 1 from pg_temp._close_funnel_leads h where h.lead_id=e.lead_id and (h.report_dimensions->>''status_history_complete_at'')::timestamptz=p_snapshot_started_at))');
end;$patch$;

create or replace function public.get_antony_lead_selection_report(p_period text,p_reference_date date default ((now() at time zone 'Europe/Berlin')::date))
returns jsonb language plpgsql stable security definer set search_path='' set jit=off as $function$
declare r jsonb; cal jsonb; evidence jsonb; leads jsonb; v_start timestamptz; v_end timestamptz; v_history_end timestamptz;
begin
 if auth.uid() is null or not public.has_antony_access() then raise exception 'Nicht berechtigt' using errcode='42501';end if;
 r:=public.get_antony_lead_selection_sources_internal(p_period,p_reference_date);
 v_start:=((r->'period'->>'start')::date::timestamp at time zone 'Europe/Berlin');
 v_end:=least((r->>'data_as_of')::timestamptz,((p_reference_date+1)::timestamp at time zone 'Europe/Berlin'));
 select greatest(v_end,max((g->>'selection_end')::timestamptz)) into v_history_end from jsonb_array_elements(r->'groups') g;
 -- Calendar time, not lead creation or booking month. Historical cutoffs are
 -- applied inside the proven calendar mapper; never return future plans here.
 select coalesce(jsonb_agg(c),'[]'::jsonb) into cal
 from generate_series(date_trunc('month',v_start at time zone 'Europe/Berlin'),
 date_trunc('month',p_reference_date::timestamp),interval '1 month') m
 cross join lateral jsonb_array_elements(public.get_reporting_calendar_internal('month',
 least(p_reference_date,(m+interval '1 month - 1 day')::date))) c
 where (c->>'starts_at')::timestamptz>=v_start and (c->>'starts_at')::timestamptz<v_end;

 with ids as materialized (
  select distinct g->>'lead_id' lead_id from jsonb_array_elements(cal) g
  union select l->>'lead_id' from jsonb_array_elements(r->'groups') g cross join lateral jsonb_array_elements(g->'leads') l
  union select e.lead_id from public.close_funnel_events e where e.is_current and e.withdrawn_at is null
   and e.source_kind='custom_activity' and e.event_type in ('setter_activity','closer_activity','attendance_activity')
   and e.occurred_at>=v_start and e.occurred_at<v_end
 ), events as (
  select e.lead_id,e.source_event_id,e.source_kind,e.event_type,e.occurred_at,
   (e.payload->>'date_created')::timestamptz recorded_at,e.previous_status,e.new_status status_id,
   e.payload->>'status' publication_status,
   e.payload->'custom'->>'cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' setter_result,
   e.payload->'custom'->>'cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' closer_result,
   e.payload->'custom'->>'cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' setter_no_show,
   e.payload->'custom'->>'cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' closer_no_show
  from public.close_funnel_events e join ids using(lead_id)
  where e.is_current and e.withdrawn_at is null and e.source_kind in ('lead_status_change','custom_activity')
   and e.occurred_at<v_history_end and (e.payload->>'date_created')::timestamptz<v_history_end
 ), metadata as (
  select i.lead_id,coalesce(l.display_name,i.lead_id) lead_name,l.status_id,
   coalesce(l.report_dimensions->>'status_label',d.label,'Status nicht verfügbar') status_label,
   coalesce(l.report_dimensions,'{}'::jsonb)||jsonb_build_object('lead_source',l.lead_source) dimensions
  from ids i left join public.close_funnel_leads l using(lead_id)
  left join private.antony_status_definitions d on d.status_id=l.status_id
 )
 select (select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at,e.source_event_id),'[]'::jsonb) from events e),
 (select coalesce(jsonb_agg(to_jsonb(l) order by l.lead_id),'[]'::jsonb) from metadata l) into evidence,leads;
 return r||jsonb_build_object('version','2026-09-10.verified-journey','activity_history',evidence,
  'calendar',cal,'leads',leads,'activity_start',v_start,'activity_end',v_end,
  'backoffice_rule_verified',false);
end;$function$;
revoke all on function public.get_antony_lead_selection_report(text,date) from public,anon;
grant execute on function public.get_antony_lead_selection_report(text,date) to authenticated;
commit;
