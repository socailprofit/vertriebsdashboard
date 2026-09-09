begin;

-- A verified replacement inherits the existing booking only in the reporting
-- projection. The original calendar record and its unique source link remain
-- untouched. Continuation meetings remain calendar workload even when they do
-- not create an additional initial setting success.
create or replace function public.get_setter_meetings_internal(p_start_date date,p_end_date date,p_current_cutoff boolean default true)
returns setof public.close_meetings language plpgsql stable security definer set search_path='' set jit=off as $$
begin
 if p_start_date is null or p_end_date is null or p_end_date<p_start_date then
  raise exception 'Invalid meeting date range' using errcode='22023';end if;
 return query
 with performed as materialized (
  select e.lead_id,e.occurred_at from public.close_funnel_events e where e.source_kind='custom_activity'
   and e.event_type='setter_activity' and e.is_current and e.withdrawn_at is null
   and e.payload->>'status'='published' and e.occurred_at<=public.get_sales_data_as_of_internal()
  union all select f.lead_id,f.occurred_at from public.close_activity_facts f
   where f.source_type='custom_activity' and f.setter_calls=1 and f.occurred_at<=public.get_sales_data_as_of_internal()
    and not exists(select 1 from public.close_funnel_events e where e.source_kind='custom_activity' and e.source_event_id=f.source_activity_id)
 )
 select projected.* from public.close_meetings m
 left join (select r.meeting_id,r.payload from public.close_process_meetings r
  join public.close_sales_processes p on p.process_id=r.process_id and p.retired_at is null
  where r.removed_at is null) relation on relation.meeting_id=m.meeting_id
 left join public.close_booking_history inherited on inherited.source_activity_id=relation.payload->>'booking_activity_id'
  and inherited.lead_id=m.lead_id and inherited.close_user_id=relation.payload->>'booking_owner_id'
 cross join lateral jsonb_populate_record(m,jsonb_build_object(
  'booking_activity_id',coalesce(m.booking_activity_id,inherited.source_activity_id),
  'booking_owner_id',coalesce(m.booking_owner_id,inherited.close_user_id))) projected
 where m.removed_at is null and projected.booking_activity_id is not null and not m.excluded_purpose
  and nullif(relation.payload->>'superseded_by_meeting_id','') is null
  and (coalesce(relation.payload->>'relation_type','')<>'ambiguous' or exists(
   select 1 from performed proof where proof.lead_id=m.lead_id and proof.occurred_at>=m.starts_at
    and proof.occurred_at<(((greatest(m.starts_at,m.ends_at) at time zone 'Europe/Berlin')::date+1)::timestamp at time zone 'Europe/Berlin')
    and not exists(select 1 from public.close_meetings competing where competing.lead_id=m.lead_id
     and competing.meeting_id<>m.meeting_id and competing.removed_at is null and not competing.excluded_purpose
     and competing.starts_at>=m.starts_at and competing.starts_at<=proof.occurred_at)))
  and m.starts_at >= (p_start_date::timestamp at time zone 'Europe/Berlin')
  and m.starts_at < ((p_end_date+1)::timestamp at time zone 'Europe/Berlin')
  and (not p_current_cutoff or p_end_date>(now() at time zone 'Europe/Berlin')::date
   or m.starts_at<=public.get_sales_data_as_of_internal());
end;$$;
revoke all on function public.get_setter_meetings_internal(date,date,boolean) from public,anon,authenticated;
grant execute on function public.get_setter_meetings_internal(date,date,boolean) to service_role;

-- Attendance is proven by the event belonging to that effective occurrence.
-- An original cancellation is never borrowed by its future replacement.
-- Current journal revisions retain evidence beyond raw activity retention;
-- withdrawn or unpublished source objects cannot reappear via the raw fallback.
create or replace function public.get_setter_meeting_evidence_internal(p_as_of date)
returns table(meeting_id text,source_activity_id text,kind text,occurred_at timestamptz)
language sql stable security definer set search_path='' set jit=off as $$
 with cutoff as (select least(public.get_sales_data_as_of_internal(),((p_as_of+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond') at),
 effective as materialized(select * from public.get_setter_meetings_internal('0001-01-01','9999-12-31',false)),
 calendar as materialized (
 select m.*,h.occurred_at booking_created_at,
  greatest((select max(t.source_updated_at) from public.close_meeting_time_history t where t.meeting_id=m.meeting_id and t.old_starts_at<>t.new_starts_at),
   case when r.payload->>'relation_type'='replacement' then greatest(m.date_created,(r.payload->>'cancellation_at')::timestamptz) end) revision_since,
  (select min(n.starts_at) from effective n where n.lead_id=m.lead_id and n.meeting_id<>m.meeting_id and n.starts_at>m.starts_at) next_start
 from effective m left join public.close_booking_history h on h.source_activity_id=m.booking_activity_id
 left join public.close_process_meetings r on r.meeting_id=m.meeting_id and r.removed_at is null
 ),
 facts as materialized (
 select e.source_event_id source_activity_id,e.lead_id,e.occurred_at,
  case when e.event_type='setter_activity' then 'attended'
   when e.event_type='attendance_activity' then case e.payload->'custom'->>'cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz'
    when 'Nicht erschienen' then 'no_show' when '⛔ Abgesagt' then 'cancelled' when '🔄 Termin verschoben' then 'rescheduled' end end kind
 from public.close_funnel_events e where e.source_kind='custom_activity' and e.is_current and e.withdrawn_at is null
  and e.payload->>'status'='published' and e.occurred_at<=(select at from cutoff)
 union all
 select f.source_activity_id,f.lead_id,f.occurred_at,
  case when f.setter_calls=1 then 'attended'
   when r.payload->>'custom_activity_type_id'='actitype_6dnbcILqqeo0iGpRCEjOas' then
    case r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz'
     when 'Nicht erschienen' then 'no_show' when '⛔ Abgesagt' then 'cancelled' when '🔄 Termin verschoben' then 'rescheduled' end end kind
 from public.close_activity_facts f left join public.close_raw_activities r on r.close_activity_id=f.source_activity_id
 where f.source_type='custom_activity' and f.occurred_at<=(select at from cutoff)
  and not exists(select 1 from public.close_funnel_events e where e.source_kind='custom_activity' and e.source_event_id=f.source_activity_id)
 ),
 candidates as (
 select m.meeting_id,f.*,count(*) over(partition by f.source_activity_id) candidates
 from calendar m join facts f on f.lead_id=m.lead_id and f.kind is not null
  and f.occurred_at>=coalesce(m.revision_since,'-infinity'::timestamptz)
  and f.occurred_at<coalesce(m.next_start,'infinity'::timestamptz)
  and f.occurred_at<(((greatest(m.starts_at,m.ends_at) at time zone 'Europe/Berlin')::date+1)::timestamp at time zone 'Europe/Berlin')
  and f.occurred_at>=case when f.kind in ('cancelled','rescheduled') then coalesce(m.booking_created_at,m.date_created) else m.starts_at end
 ) select c.meeting_id,c.source_activity_id,c.kind,c.occurred_at from candidates c
 join calendar m on m.meeting_id=c.meeting_id where c.candidates=1 and m.starts_at<=(select at from cutoff);
$$;
revoke all on function public.get_setter_meeting_evidence_internal(date) from public,anon,authenticated;
grant execute on function public.get_setter_meeting_evidence_internal(date) to service_role;

commit;
