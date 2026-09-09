begin;
create or replace function public.get_reporting_calendar_internal(p_period text,p_reference_date date) returns jsonb
language sql stable security definer set search_path='' set jit=off as $$
with bounds as (
 select case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date else date_trunc('month',p_reference_date::timestamp)::date end start_date,
 case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date+6 else (date_trunc('month',p_reference_date::timestamp)+interval '1 month - 1 day')::date end end_date,
 least(public.get_sales_data_as_of_internal(),((p_reference_date+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond') cutoff
), setter as materialized(select m.* from bounds b cross join lateral public.get_setter_meetings_internal(b.start_date,b.end_date,false) m),
 outcomes as materialized(select o.* from bounds b cross join lateral public.get_setter_meeting_outcomes_internal(b.start_date,p_reference_date) o),
 planned as materialized(select x from jsonb_array_elements(public.get_antony_pipeline_snapshot_internal(p_reference_date)->'scheduled_meetings') x),
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
commit;
