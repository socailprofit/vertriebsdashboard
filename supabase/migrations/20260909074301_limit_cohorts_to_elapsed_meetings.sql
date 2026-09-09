begin;
-- Keep future bookings in the journal/calendar only, outside actual cohorts.
create or replace function public.get_close_process_cohorts_internal(p_as_of date) returns jsonb
language sql stable security definer set search_path='' set jit=off as $$
 with rows as materialized (
 select data d,(data->>'first_meeting_at')::timestamptz start,
 (data->>'progression_setter_at')::timestamptz s,(data->>'progression_qualified_at')::timestamptz q,
 (data->>'progression_closer_at')::timestamptz c,(data->>'progression_cc2_at')::timestamptz cc2,
 (data->>'sold_at')::timestamptz sold,(data->>'decided_at')::timestamptz decided,
 (data->>'won_at')::timestamptz won
 from public.get_close_process_rows_internal(p_as_of)
 where (data->>'documented_booking')::boolean and data->>'first_meeting_at' is not null
 and (data->>'first_meeting_at')::timestamptz<=least(public.get_sales_data_as_of_internal(),((p_as_of+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond')
 ), stages as (
 select r.*,s>=start setter_ok,q>=s and s>=start qualified_ok,c>=q and q>=s and s>=start closer_ok,
 post.held_at cc2_held_at,post.decided_at cc2_decision_at,post.last_decision cc2_last_decision
 from rows r left join lateral (
 select min(e.occurred_at) filter(where e.event_type in ('closer_completed','closer_sold','cc2_sold','closer_follow_up','closer_lost')) held_at,
 min(e.occurred_at) filter(where e.event_type in ('closer_sold','cc2_sold','closer_lost')) decided_at,
 (array_agg(e.event_type order by e.occurred_at desc,e.source_event_id desc) filter(where e.event_type in ('closer_sold','cc2_sold','closer_lost')))[1] last_decision
 from public.close_process_events e where e.process_id=r.d->>'process_id' and e.removed_at is null
 and coalesce((e.payload->>'applies_to_state')::boolean,true) and not coalesce((e.payload->>'state_conflict')::boolean,false)
 and e.occurred_at>r.cc2 and e.occurred_at<=least(public.get_sales_data_as_of_internal(),((p_as_of+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond')
 ) post on true
 ), groups as (
 select d->>'source' source,d->>'owner' owner,d->>'booked_date' booked_date,
 count(*) booked_leads,count(*) filter(where setter_ok) setter_arrived,
 count(*) filter(where qualified_ok) closer_qualified,count(*) filter(where closer_ok) closer_arrived,
 count(*) filter(where closer_ok and decided>=c) decided_leads,count(*) filter(where closer_ok and sold>=c) sold_leads,
 count(*) filter(where closer_ok and (case when d->>'won_at_precision'='date' then (won at time zone 'Europe/Berlin')::date>=(c at time zone 'Europe/Berlin')::date else won>=c end)) new_customers,count(*) filter(where won is not null and (case when d->>'won_at_precision'='date' then (won at time zone 'Europe/Berlin')::date>=(start at time zone 'Europe/Berlin')::date else won>=start end)) observed_customers,
 count(*) filter(where d->>'closer_at' is not null and not coalesce(closer_ok,false)) unlinked_closer,
 count(*) filter(where (case when d->>'won_at_precision'='date' then (won at time zone 'Europe/Berlin')::date>=(start at time zone 'Europe/Berlin')::date else won>=start end) and not coalesce(closer_ok,false)) unlinked_customer,
 count(*) filter(where closer_ok and cc2>=c) cc2_agreed,
 count(*) filter(where closer_ok and cc2>=c and cc2_held_at is not null) cc2_held,
 count(*) filter(where closer_ok and cc2>=c and cc2_decision_at is not null) cc2_decided,
 count(*) filter(where closer_ok and cc2>=c and cc2_last_decision in ('closer_sold','cc2_sold')) cc2_sold,
 count(*) filter(where closer_ok and cc2>=c and cc2_last_decision='closer_lost') cc2_lost,
 count(*) filter(where closer_ok and cc2>=c and cc2_held_at is null and d->>'closer_result'='cc2_agreed') cc2_waiting,
 count(*) filter(where closer_ok and cc2>=c and cc2_held_at is not null and cc2_decision_at is null and d->>'state' not in ('cancelled','rescheduled','no_show','won','lost','disqualified')) cc2_open,
 count(*) filter(where closer_ok and cc2>=c and d->>'state'='cancelled') cc2_cancelled,
 count(*) filter(where closer_ok and cc2>=c and d->>'state'='no_show') cc2_no_show,
 count(*) filter(where closer_ok and cc2>=c and d->>'state'='rescheduled') cc2_rescheduled,
 count(*) filter(where d->>'closer_result'='cc2_sold' and cc2 is null) cc2_missing_agreement,
 count(*) filter(where closer_ok and sold>=c and cc2 is null and d->>'closer_result'='closer_sold') cc1_sold,
 count(*) filter(where closer_ok and decided>=c and cc2 is null and d->>'closer_result'='closer_lost') cc1_lost,
 count(*) filter(where not coalesce(setter_ok,false)) not_in_setter,
 count(*) filter(where not coalesce(setter_ok,false) and d->>'next_meeting_at' is not null) future,
 count(*) filter(where not coalesce(setter_ok,false) and d->>'next_meeting_at' is null and d->>'state'='no_show') no_show,
 count(*) filter(where not coalesce(setter_ok,false) and d->>'next_meeting_at' is null and d->>'state'='cancelled') cancelled,
 count(*) filter(where not coalesce(setter_ok,false) and d->>'next_meeting_at' is null and d->>'state'='rescheduled') rescheduled,
 count(*) filter(where not coalesce(setter_ok,false) and d->>'next_meeting_at' is null and d->>'state' not in ('no_show','cancelled','rescheduled')) pending,
 count(*) filter(where setter_ok and d->>'setter_result'='setter_qualified') qualified,
 count(*) filter(where setter_ok and d->>'setter_result'='setter_follow_up') followup,
 count(*) filter(where setter_ok and d->>'setter_result'='setter_disqualified') disqualified,
 count(*) filter(where setter_ok and coalesce(d->>'setter_result','') not in ('setter_qualified','setter_follow_up','setter_disqualified')) unrated
 from stages group by 1,2,3
 ) select coalesce(jsonb_agg(to_jsonb(g) order by booked_date,source,owner),'[]'::jsonb) from groups g;
$$;
revoke all on function public.get_close_process_cohorts_internal(date) from public,anon,authenticated;
commit;
