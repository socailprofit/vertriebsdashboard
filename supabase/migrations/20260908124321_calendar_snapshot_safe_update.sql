begin;
-- Explicit scope for the production safe-update setting.
create or replace function public.reconcile_close_calendar_snapshot(
 p_start_date date,p_end_date date,p_snapshot_started_at timestamptz,
 p_raw jsonb,p_facts jsonb,p_opportunities jsonb,p_leads jsonb,p_bookings jsonb,
 p_meetings jsonb,p_calendar_leads jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if jsonb_typeof(p_meetings) is distinct from 'array' or jsonb_array_length(p_meetings)>20000
  or jsonb_typeof(p_calendar_leads) is distinct from 'array' or jsonb_array_length(p_calendar_leads)>20000
 then raise exception 'Invalid calendar snapshot';end if;
 if exists(select 1 from jsonb_populate_recordset(null::public.close_meetings,p_meetings) m
  where m.meeting_id is null or m.starts_at is null or m.ends_at is null or m.date_created is null or m.date_updated is null
   or m.ends_at<m.starts_at or m.date_created>p_snapshot_started_at or m.excluded_purpose is null
   or jsonb_typeof(m.participant_ids) is distinct from 'array'
   or (m.booking_activity_id is null)<>(m.booking_owner_id is null)
   or (m.booking_activity_id is not null and (m.excluded_purpose or m.owner_id is null or not exists(
    select 1 from jsonb_array_elements(p_bookings) b where b->>'source_activity_id'=m.booking_activity_id
     and b->>'lead_id'=m.lead_id and b->>'close_user_id'=m.booking_owner_id
     and (b->>'occurred_at')::timestamptz<=m.starts_at)))
 ) or exists(select 1 from jsonb_array_elements(p_meetings) m group by m->>'meeting_id' having count(*)>1)
 or exists(select 1 from jsonb_array_elements(p_meetings) m where m->>'booking_activity_id' is not null group by m->>'booking_activity_id' having count(*)>1)
 then raise exception 'Invalid calendar rows';end if;
 if exists(select 1 from jsonb_array_elements(p_calendar_leads) l where l->>'lead_id' is null or not exists(
  select 1 from jsonb_array_elements(p_meetings) m where m->>'lead_id'=l->>'lead_id' and m->>'booking_activity_id' is not null
   and ((m->>'starts_at')::timestamptz at time zone 'Europe/Berlin')::date>=p_start_date))
 or exists(select 1 from jsonb_array_elements(p_meetings) m where m->>'booking_activity_id' is not null
  and ((m->>'starts_at')::timestamptz at time zone 'Europe/Berlin')::date>=p_start_date
  and not exists(select 1 from jsonb_array_elements(p_calendar_leads) l where l->>'lead_id'=m->>'lead_id'))
 then raise exception 'Incomplete calendar attribution';end if;
 -- Existing validation and advisory lock cover custom facts, Won, bookings,
 -- their metadata, the calendar and the observation cutoff in ONE transaction.
 v_result:=public.reconcile_close_sales_snapshot(p_start_date,p_end_date,p_snapshot_started_at,
  p_raw,p_facts,p_opportunities,p_leads,p_bookings);
 if exists(select 1 from jsonb_array_elements(p_facts) f where (f->>'occurred_at')::timestamptz>p_snapshot_started_at)
 then raise exception 'Future performance in snapshot';end if;
 -- Unlink first so a rescheduled/recreated record can acquire its source link
 -- without violating the one-to-one identity constraint. No status deduplication.
 update public.close_meetings set booking_activity_id=null,booking_owner_id=null where meeting_id is not null;
 update public.close_meetings m set removed_at=p_snapshot_started_at
  where removed_at is null and not exists(select 1 from jsonb_array_elements(p_meetings) x where x->>'meeting_id'=m.meeting_id);
 insert into public.close_meetings(meeting_id,lead_id,contact_id,owner_id,starts_at,ends_at,date_created,date_updated,
  status,participant_ids,calendar_event_uids,excluded_purpose,booking_activity_id,booking_owner_id,last_seen_at,removed_at)
 select meeting_id,lead_id,contact_id,owner_id,starts_at,ends_at,date_created,date_updated,
  status,participant_ids,calendar_event_uids,excluded_purpose,booking_activity_id,booking_owner_id,p_snapshot_started_at,null
 from jsonb_populate_recordset(null::public.close_meetings,p_meetings)
 on conflict(meeting_id) do update set lead_id=excluded.lead_id,contact_id=excluded.contact_id,owner_id=excluded.owner_id,
  starts_at=excluded.starts_at,ends_at=excluded.ends_at,date_created=excluded.date_created,date_updated=excluded.date_updated,
  status=excluded.status,participant_ids=excluded.participant_ids,calendar_event_uids=excluded.calendar_event_uids,
  excluded_purpose=excluded.excluded_purpose,booking_activity_id=excluded.booking_activity_id,booking_owner_id=excluded.booking_owner_id,
  last_seen_at=excluded.last_seen_at,removed_at=null;
 insert into public.close_lead_reporting(lead_id,opener_close_user_id,lead_source)
 select lead_id,opener_close_user_id,lead_source from jsonb_populate_recordset(null::public.close_lead_reporting,p_calendar_leads)
 on conflict(lead_id) do update set opener_close_user_id=excluded.opener_close_user_id,lead_source=excluded.lead_source;
 insert into public.close_reconciliation_state values('calendar',p_snapshot_started_at)
 on conflict(resource) do update set snapshot_started_at=excluded.snapshot_started_at;
 return v_result||jsonb_build_object('meetings',jsonb_array_length(p_meetings),'data_as_of',p_snapshot_started_at);
end;$$;
commit;
