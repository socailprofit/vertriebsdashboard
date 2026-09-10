begin;
alter table public.close_funnel_leads add column report_dimensions jsonb;
-- Keep the atomic snapshot transaction and protect metadata during a rolling deployment.
do $patch$
declare v_definition text; v_old text := $old$ insert into public.close_funnel_leads(lead_id,display_name,lead_source,opener_close_user_id,setter_id,closer_id,status_id,source_updated_at,last_seen_at)
 select lead_id,display_name,lead_source,opener_close_user_id,setter_id,closer_id,status_id,source_updated_at,p_snapshot_started_at
 from pg_temp._close_funnel_leads
 on conflict(lead_id) do update set display_name=excluded.display_name,lead_source=excluded.lead_source,opener_close_user_id=excluded.opener_close_user_id,
 setter_id=excluded.setter_id,closer_id=excluded.closer_id,status_id=excluded.status_id,source_updated_at=excluded.source_updated_at,last_seen_at=excluded.last_seen_at;
$old$; v_new text := $new$ insert into public.close_funnel_leads(lead_id,display_name,lead_source,opener_close_user_id,setter_id,closer_id,status_id,source_updated_at,last_seen_at,report_dimensions)
 select lead_id,display_name,lead_source,opener_close_user_id,setter_id,closer_id,status_id,source_updated_at,p_snapshot_started_at,report_dimensions
 from pg_temp._close_funnel_leads
 on conflict(lead_id) do update set display_name=excluded.display_name,lead_source=excluded.lead_source,opener_close_user_id=excluded.opener_close_user_id,
 setter_id=excluded.setter_id,closer_id=excluded.closer_id,status_id=excluded.status_id,source_updated_at=excluded.source_updated_at,last_seen_at=excluded.last_seen_at,
 report_dimensions=coalesce(excluded.report_dimensions,public.close_funnel_leads.report_dimensions);
$new$;
begin
 select pg_get_functiondef(p.oid) into strict v_definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='reconcile_close_funnel_snapshot';
 if position(v_old in v_definition)=0 then raise exception 'Snapshot function changed; review before migration'; end if;
 execute replace(v_definition,v_old,v_new);
end;$patch$;

create table private.antony_lead_report_sources (
 key text primary key, label text not null,
 status_side text not null check(status_side in ('old','new')), status_id text not null,
 time_zone text not null check(time_zone in ('UTC','Europe/Berlin')),
 share_url text not null check (share_url ~ '^https://app[.]close[.]com/leads/share/share_[A-Za-z0-9]+/$'),
 sort_order integer not null
);
alter table private.antony_lead_report_sources enable row level security;
revoke all on private.antony_lead_report_sources from public,anon,authenticated;
-- Match the actual source filters: Setting is UTC midnight (02:00 Berlin in summer),
-- Closing is Berlin midnight. The filter template stays fixed; the period is dynamic.
insert into private.antony_lead_report_sources values
 ('setting','Setting','old','stat_Bo9KBFViTrdAlKxJaSblfNcnB90ikOzf5g4ARS82mXb','UTC','https://app.close.com/leads/share/share_0KYXCeVX1xwDO6M8vqLJ3a/',1),
 ('closing','Closing','old','stat_v6fo1NvqjwqsIIzUS9kNDGVIJVfcDxTxYDXwpqE4gpn','Europe/Berlin','https://app.close.com/leads/share/share_6jdOVg18jKZE3j93ejbxGI/',2),
 ('customer','Neukunden','new','stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory','UTC','https://app.close.com/leads/share/share_4i50YOLJIX3Mqfx9bk74ug/',3);

create function public.get_antony_lead_selection_report(p_period text,p_reference_date date default ((now() at time zone 'Europe/Berlin')::date))
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
 ), sources as (
  select s.key,s.label,s.share_url,s.status_side,s.time_zone,s.selection_start,s.selection_end,s.sort_order,count(l.lead_id) total,
   count(l.lead_id) filter(where not l.metadata_ready) metadata_pending,
   coalesce(jsonb_agg(to_jsonb(l) order by l.last_recorded_at desc,l.lead_id) filter(where l.lead_id is not null),'[]'::jsonb) leads
  from bounds s left join leads l on l.key=s.key
  group by s.key,s.label,s.share_url,s.status_side,s.time_zone,s.selection_start,s.selection_end,s.sort_order
 )
 select jsonb_build_object('version','2026-09-10.lead-selections',
  'period',jsonb_build_object('type',p_period,'start',v_start,'end',v_end),
  'data_as_of',v_snapshot,'selection_date_field','date_created','status_basis','latest_synced_lead_status',
  'groups',coalesce(jsonb_agg(to_jsonb(s) order by s.sort_order),'[]'::jsonb)) into v_result from sources s;
 return v_result;
end;
$function$;
revoke all on function public.get_antony_lead_selection_report(text,date) from public,anon;
grant execute on function public.get_antony_lead_selection_report(text,date) to authenticated;
comment on function public.get_antony_lead_selection_report(text,date) is
 'Distinct leads matching Close status-change date_created selections; current synced status and CRM dimensions. Independent source denominators; leadership only.';
commit;
