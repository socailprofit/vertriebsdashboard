begin;

-- A previously documented booking stays in the audit scope after its current
-- outcome becomes draft/withdrawn/non-booking. Read ALL immutable revisions.
create function public.get_close_funnel_booking_source_ids()
returns table(source_event_id text) language sql stable security definer set search_path='' set jit=off as $$
 select distinct e.source_event_id from public.close_funnel_events e
 where e.source_kind='custom_activity' and e.payload->>'status'='published'
  and case e.event_type
   when 'opening_activity' then e.payload->'custom'->>'cf_LBuW6DB7vmgifhe2JUasZIhYvrOIjcAd7xB8hzYQrJ9'
   when 'followup_activity' then e.payload->'custom'->>'cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c'
  end in ('4: ✅ Termin vereinbart','Entscheider: Termin vereinbart')
 order by e.source_event_id;
$$;
revoke all on function public.get_close_funnel_booking_source_ids() from public,anon,authenticated;
grant execute on function public.get_close_funnel_booking_source_ids() to service_role;

commit;
