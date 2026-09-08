begin;

-- Append-only calendar revisions; raw CRM outcomes remain unchanged.
create table public.close_meeting_time_history (
 revision_id bigint generated always as identity primary key,
 meeting_id text not null,
 old_starts_at timestamptz not null,old_ends_at timestamptz not null,
 new_starts_at timestamptz not null,new_ends_at timestamptz not null,
 source_updated_at timestamptz not null,observed_at timestamptz not null
);
create index close_meeting_time_history_meeting on public.close_meeting_time_history(meeting_id,source_updated_at);
alter table public.close_meeting_time_history enable row level security;
revoke all on public.close_meeting_time_history from public,anon,authenticated;
grant select,insert on public.close_meeting_time_history to service_role;
grant usage on sequence public.close_meeting_time_history_revision_id_seq to service_role;
create function public.record_close_meeting_time_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.close_meeting_time_history(meeting_id,old_starts_at,old_ends_at,new_starts_at,new_ends_at,source_updated_at,observed_at)
 values(new.meeting_id,old.starts_at,old.ends_at,new.starts_at,new.ends_at,new.date_updated,new.last_seen_at);
 return new;
end;$$;
revoke all on function public.record_close_meeting_time_change() from public,anon,authenticated;
create trigger record_close_meeting_time_change after update on public.close_meetings
 for each row when(old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at)
 execute function public.record_close_meeting_time_change();

-- Each proof must belong to ONE scheduled occurrence. A same-day Setter
-- activity after the start (before the next meeting) proves attendance.
-- A calendar ending or an RSVP does not. Later-day follow-ups are not borrowed.
-- Cancellations can be documented before the start, but become a KPI only when
-- that appointment is due. Evidence from before a reschedule stays historical.
create function public.get_setter_meeting_evidence_internal(p_as_of date)
returns table(meeting_id text,source_activity_id text,kind text,occurred_at timestamptz)
language sql stable security definer set search_path='' set jit=off as $$
 with cutoff as (select least(public.get_sales_data_as_of_internal(),((p_as_of+1)::timestamp at time zone 'Europe/Berlin')-interval '1 microsecond') at),
 calendar as materialized (
 select m.*,h.occurred_at booking_created_at,
  (select max(t.source_updated_at) from public.close_meeting_time_history t where t.meeting_id=m.meeting_id and t.old_starts_at<>t.new_starts_at) revision_since,
  (select min(n.starts_at) from public.close_meetings n where n.lead_id=m.lead_id and n.meeting_id<>m.meeting_id
   and n.removed_at is null and n.booking_activity_id is not null and n.starts_at>m.starts_at) next_start
 from public.get_setter_meetings_internal('0001-01-01','9999-12-31',false) m
 left join public.close_booking_history h on h.source_activity_id=m.booking_activity_id
),
 facts as materialized (
 select f.source_activity_id,f.lead_id,f.occurred_at,
 case when f.setter_calls=1 then 'attended'
  when r.payload->>'custom_activity_type_id'='actitype_6dnbcILqqeo0iGpRCEjOas' then
   case r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz'
    when 'Nicht erschienen' then 'no_show' when '⛔ Abgesagt' then 'cancelled' when '🔄 Termin verschoben' then 'rescheduled' end end kind
 from public.close_activity_facts f left join public.close_raw_activities r on r.close_activity_id=f.source_activity_id
 where f.source_type='custom_activity' and f.occurred_at<=(select at from cutoff)),
 candidates as (
 select m.meeting_id,f.*,count(*) over(partition by f.source_activity_id) candidates
 from calendar m join facts f on f.lead_id=m.lead_id and f.kind is not null
  and f.occurred_at>=coalesce(m.revision_since,'-infinity'::timestamptz)
  and f.occurred_at<coalesce(m.next_start,'infinity'::timestamptz)
  and f.occurred_at<(((greatest(m.starts_at,m.ends_at) at time zone 'Europe/Berlin')::date+1)::timestamp at time zone 'Europe/Berlin')
  and f.occurred_at>=case when f.kind in ('cancelled','rescheduled') then coalesce(m.booking_created_at,m.date_created) else m.starts_at end
 ) select c.meeting_id,c.source_activity_id,c.kind,c.occurred_at from candidates c join calendar m on m.meeting_id=c.meeting_id where c.candidates=1 and m.starts_at<=(select at from cutoff);
$$;
revoke all on function public.get_setter_meeting_evidence_internal(date) from public,anon,authenticated;
grant execute on function public.get_setter_meeting_evidence_internal(date) to service_role;

-- Sanitize only reporting payloads: unproven/future/superseded Setter statuses
-- cannot reappear via a different funnel, period or source-filter aggregation.
create function public.get_antony_outcome_payloads_internal(p_as_of date)
returns setof public.close_raw_activities language sql stable security definer set search_path='' set jit=off as $$
 with proof as materialized(select distinct source_activity_id from public.get_setter_meeting_evidence_internal(p_as_of)
  where kind in ('no_show','cancelled','rescheduled'))
 select s.* from public.close_raw_activities r
 left join proof e on e.source_activity_id=r.close_activity_id
 cross join lateral jsonb_populate_record(r,jsonb_build_object('payload',
  case when e.source_activity_id is null then r.payload-'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' else r.payload end)) s where r.activity_type='custom_activity';
$$;
revoke all on function public.get_antony_outcome_payloads_internal(date) from public,anon,authenticated;
grant execute on function public.get_antony_outcome_payloads_internal(date) to service_role;

create function public.get_setter_meeting_outcomes_internal(p_start_date date,p_end_date date)
returns table(meeting_id text,lead_id text,starts_at timestamptz,source text,owner text,outcome text)
language sql stable security definer set search_path='' set jit=off as $$
 with evidence as materialized(select * from public.get_setter_meeting_evidence_internal(p_end_date))
 select m.meeting_id,m.lead_id,m.starts_at,coalesce(l.lead_source,'Nicht zugeordnet'),
 coalesce(sp.slug,case when m.booking_owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'unassigned' end),
 case when m.starts_at>public.get_sales_data_as_of_internal() then 'future'
 when exists(select 1 from evidence e where e.meeting_id=m.meeting_id and e.kind='attended') then 'attended'
 when s.kinds>1 then 'unknown'
 when s.kind is not null then s.kind
 when m.status in ('canceled','declined-by-lead','declined-by-org') then 'cancelled'
 else 'unknown' end
 from public.get_setter_meetings_internal(p_start_date,p_end_date,false) m
 left join public.close_lead_reporting l on l.lead_id=m.lead_id
 left join public.sales_people sp on sp.close_user_id=m.booking_owner_id
 left join lateral (select count(distinct e.kind) kinds,max(e.kind) kind from evidence e where e.meeting_id=m.meeting_id
  and e.occurred_at=(select max(x.occurred_at) from evidence x where x.meeting_id=m.meeting_id and x.kind<>'attended')
  and e.kind<>'attended') s on true;
$$;
revoke all on function public.get_setter_meeting_outcomes_internal(date,date) from public,anon,authenticated;
grant execute on function public.get_setter_meeting_outcomes_internal(date,date) to service_role;

create function public.get_setter_attendance_metrics_internal(p_start_date date,p_end_date date)
returns jsonb language sql stable security definer set search_path='' set jit=off as $$
 with outcomes as materialized(select * from public.get_setter_meeting_outcomes_internal(p_start_date,p_end_date)),
 groups as(select source,owner,count(*) scheduled,count(*) filter(where outcome<>'future') elapsed,
  count(*) filter(where outcome='future') future,count(*) filter(where outcome='attended') attended,
  count(*) filter(where outcome='no_show') no_show,count(*) filter(where outcome='cancelled') cancelled,
  count(*) filter(where outcome='rescheduled') rescheduled,count(*) filter(where outcome='unknown') unknown
  from outcomes group by source,owner),
 totals as(select count(*) scheduled,count(*) filter(where outcome<>'future') elapsed,
  count(*) filter(where outcome='future') future,count(*) filter(where outcome='attended') attended,
  count(*) filter(where outcome='no_show') no_show,count(*) filter(where outcome='cancelled') cancelled,
  count(*) filter(where outcome='rescheduled') rescheduled,count(*) filter(where outcome='unknown') unknown from outcomes)
 select to_jsonb(t)||jsonb_build_object('period_start',p_start_date,'period_end',p_end_date,'timezone','Europe/Berlin',
 'data_as_of',public.get_sales_data_as_of_internal(),'show_rate',round(100.0*t.attended/nullif(t.elapsed,0),2),
 'by_source',coalesce((select jsonb_agg(to_jsonb(g) order by source,owner) from groups g),'[]'::jsonb)) from totals t;
$$;
revoke all on function public.get_setter_attendance_metrics_internal(date,date) from public,anon,authenticated;
grant execute on function public.get_setter_attendance_metrics_internal(date,date) to service_role;

create or replace function public.get_antony_meeting_metrics(p_start_date date,p_end_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.has_antony_access() then raise exception 'Nicht berechtigt' using errcode='42501';end if;
 return public.get_setter_attendance_metrics_internal(p_start_date,p_end_date);
end;$$;

create or replace function public.get_antony_activity_facts_internal(p_reference_date date)
returns setof public.close_activity_facts language sql stable security definer set search_path='' as $$
 select r.* from public.close_activity_facts f
 left join public.get_antony_outcome_payloads_internal(p_reference_date) payload on payload.close_activity_id=f.source_activity_id
 cross join lateral jsonb_populate_record(f,jsonb_build_object('appointments',0,
 'no_shows',case when f.source_type='custom_activity' and payload.payload->>'custom_activity_type_id'='actitype_6dnbcILqqeo0iGpRCEjOas' then case when 'Nicht erschienen' in (payload.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz',payload.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q') then 1 else 0 end else f.no_shows end,
 'cancellations',case when f.source_type='custom_activity' and payload.payload->>'custom_activity_type_id'='actitype_6dnbcILqqeo0iGpRCEjOas' then case when '⛔ Abgesagt' in (payload.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz',payload.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q') then 1 else 0 end else f.cancellations end,
 'rescheduled_appointments',case when f.source_type='custom_activity' and payload.payload->>'custom_activity_type_id'='actitype_6dnbcILqqeo0iGpRCEjOas' then case when '🔄 Termin verschoben' in (payload.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz',payload.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q') then 1 else 0 end else f.rescheduled_appointments end)) r
 where f.occurred_at<=public.get_sales_data_as_of_internal()
 union all
 select r.* from public.get_setter_meetings_internal('0001-01-01',p_reference_date) m
 cross join lateral jsonb_populate_record(null::public.close_activity_facts,jsonb_build_object(
  'source_activity_id',m.meeting_id,'source_type','custom_activity','close_user_id',m.booking_owner_id,'lead_id',m.lead_id,
  'occurred_at',m.starts_at,'metric_date',(m.starts_at at time zone 'Europe/Berlin')::date,
  'metric_hour',extract(hour from m.starts_at at time zone 'Europe/Berlin')::smallint,
  'calls_gross',0,'calls_net',0,'talk_seconds',0,'gatekeeper_contacts',0,'connected_calls',0,
  'direct_decision_maker_calls',0,'decision_maker_contacts',0,'appointments',1,'setter_calls',0,
  'setter_successes',0,'closer_calls',0,'closer_sales',0,'no_shows',0,'cancellations',0,'rescheduled_appointments',0,
  'closer_second_calls',0,'closer_decided_calls',0,'mapping_version','2026-09-08.calendar-time','mapped_at',m.last_seen_at)) r;
$$;

create or replace function public.get_antony_journey_metrics_internal(p_period text,p_reference_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_start date;v_end date;v_result jsonb;
begin
 if p_reference_date is null or p_period is null or p_period not in ('day','week','month','three_months') then raise exception 'Invalid reporting period' using errcode='22023';end if;
 v_start:=case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date when 'month' then date_trunc('month',p_reference_date::timestamp)::date else (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
 v_end:=case when p_period='week' then least(v_start+4,p_reference_date) else p_reference_date end;
 with events as materialized (select f.*, r.payload,
 r.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' setter_result,
 r.payload->>'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' closer_result,
 r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' setter_status,
 r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' closer_status
 from public.get_antony_activity_facts_internal(p_reference_date) f left join public.get_antony_outcome_payloads_internal(p_reference_date) r on r.close_activity_id=f.source_activity_id
 where f.source_type='custom_activity' and f.metric_date<=v_end and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')),
 customers as materialized (select * from public.get_customer_acquisitions_internal(v_end)),
 bookings as (select * from public.get_close_first_bookings_internal(v_end)
 where booked_date>=(date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date),
 journeys as (
 select b.*,l.lead_source,s.at setter_at,q.at qualified_at,c.at closer_at,oc.at observed_closer_at,
 ag.at cc2_agreed_at,held.at cc2_held_at,lastc.result,lastc.at last_closer_at,firstsale.at first_sale_at,
 case when cs.at>lastc.at then cs.status end latest_closer_status,
 cust.won_date,case when lastc.result in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥','4. ❌ Nicht verkauft') then true else false end decided
 from bookings b left join public.close_lead_reporting l on l.lead_id=b.lead_id
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.setter_calls=1) s on true
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.occurred_at>=s.at and e.setter_successes=1) q on true
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.occurred_at>=q.at and e.closer_calls=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') c on true
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_calls=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') oc on true
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_second_calls=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') ag on true
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_calls=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and (e.occurred_at>ag.at or e.closer_result='3. ✅ Verkauft - in CC2 🔥')) held on true
 left join lateral(select max(e.occurred_at) at,case when count(distinct coalesce(e.closer_result,''))=1 then max(e.closer_result) end result from events e
 where e.lead_id=b.lead_id and e.closer_calls=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and e.occurred_at=(select max(x.occurred_at) from events x where x.lead_id=b.lead_id and x.closer_calls=1 and x.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and x.occurred_at>=b.booked_at)) lastc on true
 left join lateral(select min(e.occurred_at) at from events e where e.lead_id=b.lead_id and e.closer_sales=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and e.occurred_at>=c.at) firstsale on true
 left join lateral(select max(e.occurred_at) at,case when count(distinct e.closer_status)=1 then max(e.closer_status) else 'Unklar' end status from events e where e.lead_id=b.lead_id and e.closer_status is not null and e.occurred_at=(select max(x.occurred_at) from events x where x.lead_id=b.lead_id and x.closer_status is not null and x.occurred_at>=b.booked_at)) cs on true
 left join customers cust on cust.lead_id=b.lead_id and cust.won_date>=(b.booked_at at time zone 'Europe/Berlin')::date and cust.closer_close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
 ), grouped as (
 select coalesce(j.lead_source,'Nicht zugeordnet') source,case when j.owner_id is null then 'unassigned' else coalesce(p.slug,case when j.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end owner,
 j.booked_date,count(*) booked_leads,count(*) filter(where setter_at is not null) setter_arrived,
 count(*) filter(where qualified_at is not null) closer_qualified,count(*) filter(where closer_at is not null) closer_arrived,
 count(*) filter(where closer_at is not null and decided) decided_leads,
 count(*) filter(where closer_at is not null and result in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥')) sold_leads,
 count(*) filter(where closer_at is not null and result in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥') and won_date>=(first_sale_at at time zone 'Europe/Berlin')::date) new_customers,
 count(*) filter(where won_date is not null) observed_customers,
 count(*) filter(where observed_closer_at is not null and closer_at is null) unlinked_closer,
 count(*) filter(where won_date is not null and not(coalesce(closer_at is not null and result in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥') and won_date>=(first_sale_at at time zone 'Europe/Berlin')::date,false))) unlinked_customer,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at) cc2_agreed,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and cc2_held_at is not null) cc2_held,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and cc2_held_at is not null and result in ('3. ✅ Verkauft - in CC2 🔥','4. ❌ Nicht verkauft')) cc2_decided,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and cc2_held_at is not null and result='3. ✅ Verkauft - in CC2 🔥') cc2_sold,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and cc2_held_at is not null and result='4. ❌ Nicht verkauft') cc2_lost,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and cc2_held_at is null and latest_closer_status is null) cc2_waiting,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and cc2_held_at is not null and not decided and latest_closer_status is null) cc2_open,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and not decided and latest_closer_status='⛔ Abgesagt') cc2_cancelled,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and not decided and latest_closer_status='Nicht erschienen') cc2_no_show,
 count(*) filter(where closer_at is not null and cc2_agreed_at>=closer_at and not decided and latest_closer_status='🔄 Termin verschoben') cc2_rescheduled,
 count(*) filter(where cc2_held_at is not null and cc2_agreed_at is null) cc2_missing_agreement,
 count(*) filter(where closer_at is not null and cc2_agreed_at is null and cc2_held_at is null and result='1. ✅ Verkauft - in CC1') cc1_sold,
 count(*) filter(where closer_at is not null and cc2_agreed_at is null and cc2_held_at is null and result='4. ❌ Nicht verkauft') cc1_lost
 from journeys j left join public.sales_people p on p.close_user_id=j.owner_id group by 1,2,3
 ), setter_days as (
 select metric_date date,coalesce(p.slug,case when e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) owner,count(*) calls,count(distinct e.lead_id) leads,
 count(*) filter(where e.setter_result='✅ Closer terminiert') qualified,count(*) filter(where e.setter_result='🔎 Setter Follow Up') followup,
 count(*) filter(where e.setter_result='❌ Disqualifiziert') disqualified,count(*) filter(where coalesce(e.setter_result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) unrated
 from events e left join public.sales_people p on p.close_user_id=e.close_user_id where e.metric_date>=v_start and e.setter_calls=1 group by 1,2
 ), setter_origin as (
 select e.*,b.booked_date from events e left join public.get_close_first_bookings_internal(v_end) b on b.lead_id=e.lead_id and b.booked_at<=e.occurred_at where e.setter_calls=1 and e.metric_date>=v_start
 ), customer_origin as (
 select o.*,b.booked_date from customers o left join public.get_close_first_bookings_internal(v_end) b on b.lead_id=o.lead_id and b.booked_date<=o.won_date where o.won_date>=v_start and o.closer_close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
 ), closer_events as (
 select e.*,exists(select 1 from events old where old.lead_id=e.lead_id and old.closer_second_calls=1 and old.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and old.occurred_at<e.occurred_at) after_cc2
 from events e where e.closer_calls=1 and e.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and e.metric_date>=v_start
 )
 select jsonb_build_object('reporting_version','2026-09-08.cohort-v3',
 'funnel_by_source',coalesce((select jsonb_agg(to_jsonb(g) order by g.source,g.owner) from grouped g where g.booked_date>=v_start),'[]'::jsonb),
 'cohort_history',coalesce((select jsonb_agg(to_jsonb(g) order by g.booked_date,g.source,g.owner) from grouped g),'[]'::jsonb),
 'setter_by_day',coalesce((select jsonb_agg(to_jsonb(s) order by s.date,s.owner) from setter_days s),'[]'::jsonb),
 'timeline',coalesce((select jsonb_agg(to_jsonb(z) order by z.date,z.hour_bucket) from (select metric_date date,metric_hour hour_bucket,sum(setter_calls) setter_calls,sum(closer_second_calls) filter(where close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') cc2_agreed,sum(closer_sales) filter(where close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') closer_sales from events where metric_date>=v_start group by 1,2) z),'[]'::jsonb),
 'period_bridge',jsonb_build_object(
 'setter_calls',(select count(*) from setter_origin),'setter_leads',(select count(distinct lead_id) from setter_origin),
 'setter_from_period_bookings',(select count(*) from setter_origin where booked_date>=v_start),
 'setter_from_prior_bookings',(select count(*) from setter_origin where booked_date<v_start),
 'setter_without_booking',(select count(*) from setter_origin where booked_date is null),
 'new_customers',(select count(*) from customer_origin),'customers_from_period_bookings',(select count(*) from customer_origin where booked_date>=v_start),
 'customers_from_prior_bookings',(select count(*) from customer_origin where booked_date<v_start),'customers_without_booking',(select count(*) from customer_origin where booked_date is null),
 'sales_after_prior_won',(select count(*) from events e join customers o on o.lead_id=e.lead_id where e.metric_date>=v_start and e.closer_sales=1 and o.won_date<e.metric_date),
 'cc2_calls',(select count(*) from closer_events where after_cc2 or closer_result='3. ✅ Verkauft - in CC2 🔥'),
 'cc1_calls',(select count(*) from closer_events where not after_cc2 and closer_result<>'3. ✅ Verkauft - in CC2 🔥'),
 'cc2_lost',(select count(*) from closer_events where after_cc2 and closer_result='4. ❌ Nicht verkauft'),
 'cc1_lost',(select count(*) from closer_events where not after_cc2 and closer_result='4. ❌ Nicht verkauft')),
 'coverage',jsonb_build_object('retention_start',(date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date,
 'complete_period',v_start>=(date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date and v_end<=(now() at time zone 'Europe/Berlin')::date)) into v_result;
 return v_result;
end;$$;

create or replace function public.get_antony_activity_origins_internal(p_period text,p_reference_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_start date;v_end date;v_result jsonb;
begin
 if p_period not in ('day','week','month','three_months') or p_period is null or p_reference_date is null then raise exception 'Invalid period';end if;
 v_start:=case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date when 'month' then date_trunc('month',p_reference_date::timestamp)::date else (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
 v_end:=case when p_period='week' then least(v_start+4,p_reference_date) else p_reference_date end;
 with all_events as (
    select f.source_activity_id, f.lead_id, f.occurred_at, f.close_user_id, f.setter_calls,
      f.metric_date, f.appointments, f.setter_successes, f.closer_calls, f.closer_second_calls, f.closer_decided_calls, f.closer_sales,
      r.payload->>'custom_activity_type_id' as activity_type,
      r.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' as setter_result,
      r.payload->>'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' as closer_result,
      r.payload->>'custom.cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c' as followup_result,
      r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' as setter_status,
      r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' as closer_status
    from public.get_antony_activity_facts_internal(p_reference_date) f
    left join public.get_antony_outcome_payloads_internal(p_reference_date) r on r.close_activity_id=f.source_activity_id
    where f.source_type='custom_activity' and f.metric_date <= v_end
      and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')

 ), events as (
 select e.*,b.booked_date,b.owner_id,coalesce(l.lead_source,'Nicht zugeordnet') source,
 case when b.owner_id is null then 'unassigned' else coalesce(p.slug,case when b.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end owner
 from all_events e left join public.get_close_first_bookings_internal(v_end) b on b.lead_id=e.lead_id and b.booked_at<=e.occurred_at
 left join public.close_lead_reporting l on l.lead_id=e.lead_id left join public.sales_people p on p.close_user_id=b.owner_id
 where e.metric_date>=v_start
 and (e.appointments>0 or e.setter_calls>0 or e.closer_calls>0 or e.setter_status is not null or e.closer_status is not null or e.activity_type='actitype_38qU8FYNxY0WkWAy66Uc65')
 ), grouped as (
    select source,owner,booked_date,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65') as followup_contacts,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Follow Up') as further_followups,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Termin vereinbart') as followup_appointments,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: unqualifiziert') as followup_disqualified,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: kein Interesse') as followup_no_interest,
      count(*) filter(where setter_calls=1) as setter_calls,
      count(*) filter(where setter_calls=1 and setter_result='✅ Closer terminiert') as setter_qualified,
      count(*) filter(where setter_calls=1 and setter_result='🔎 Setter Follow Up') as setter_followups,
      count(*) filter(where setter_calls=1 and setter_result='❌ Disqualifiziert') as setter_disqualified,
      count(*) filter(where setter_calls=1 and coalesce(setter_result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as setter_unrated,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='Nicht erschienen') as setter_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='⛔ Abgesagt') as setter_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='🔄 Termin verschoben') as setter_rescheduled,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='Nicht erschienen') as closer_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='⛔ Abgesagt') as closer_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='🔄 Termin verschoben') as closer_rescheduled,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') as closer_calls,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='1. ✅ Verkauft - in CC1') as cc1_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='3. ✅ Verkauft - in CC2 🔥') as cc2_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='2. 🔥 CC2 vereinbart') as cc2_agreed,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='4. ❌ Nicht verkauft') as closer_lost,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and coalesce(closer_result,'') not in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥','2. 🔥 CC2 vereinbart','4. ❌ Nicht verkauft')) as closer_unrated
,
 sum(appointments) appointments,
 count(*) filter(where setter_calls=1 and booked_date>=v_start) setter_from_period_bookings,
 count(*) filter(where setter_calls=1 and booked_date<v_start) setter_from_prior_bookings,
 count(*) filter(where setter_calls=1 and booked_date is null) setter_without_booking
,
 count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and (closer_result='3. ✅ Verkauft - in CC2 🔥' or exists(select 1 from all_events old where old.lead_id=events.lead_id and old.closer_second_calls=1 and old.occurred_at<events.occurred_at))) cc2_calls,
 count(*) filter(where closer_result='4. ❌ Nicht verkauft' and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and exists(select 1 from all_events old where old.lead_id=events.lead_id and old.closer_second_calls=1 and old.occurred_at<events.occurred_at)) cc2_lost,
 count(*) filter(where closer_result='4. ❌ Nicht verkauft' and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and not exists(select 1 from all_events old where old.lead_id=events.lead_id and old.closer_second_calls=1 and old.occurred_at<events.occurred_at)) cc1_lost,
 count(*) filter(where closer_sales=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and exists(select 1 from public.get_customer_acquisitions_internal(v_end) o where o.lead_id=events.lead_id and o.won_date<events.metric_date)) sales_after_prior_won
 from events group by source,owner,booked_date
 ), customers as (
 select coalesce(l.lead_source,'Nicht zugeordnet') source,
 case when b.owner_id is null then 'unassigned' else coalesce(p.slug,case when b.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end owner,
 b.booked_date,count(*) new_customers
 from public.get_customer_acquisitions_internal(v_end) o
 left join public.get_close_first_bookings_internal(v_end) b on b.lead_id=o.lead_id and b.booked_date<=o.won_date
 left join public.close_lead_reporting l on l.lead_id=o.lead_id left join public.sales_people p on p.close_user_id=b.owner_id
 where o.won_date>=v_start and o.closer_close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
 group by 1,2,3
 ), combined as (
 select coalesce(to_jsonb(g),'{}'::jsonb)||jsonb_build_object('source',coalesce(g.source,c.source),'owner',coalesce(g.owner,c.owner),
 'booked_date',coalesce(g.booked_date,c.booked_date),'new_customers',coalesce(c.new_customers,0)) row
 from grouped g full join customers c on c.source=g.source and c.owner=g.owner and c.booked_date is not distinct from g.booked_date
 )
 select jsonb_build_object('activity_by_origin',coalesce((select jsonb_agg(row order by row->>'booked_date',row->>'source',row->>'owner') from combined),'[]'::jsonb),
 'origin_basis','First documented booking, independent of report window. Missing or future bookings remain unknown. Activity dates and cohort conversion are separate.') into v_result;
 return v_result;
end;$$;

CREATE OR REPLACE FUNCTION public.get_antony_process_metrics_internal(p_period text, p_reference_date date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_start date; v_end date; v_result jsonb;
begin
  if p_reference_date is null or p_period is null or p_period not in ('day','week','month','three_months') then
    raise exception 'Invalid process reporting period' using errcode='22023';
  end if;
  v_start := case p_period when 'day' then p_reference_date
    when 'week' then date_trunc('week',p_reference_date::timestamp)::date
    when 'month' then date_trunc('month',p_reference_date::timestamp)::date
    else (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
  v_end := case when p_period='week' then least(v_start+4,p_reference_date) else p_reference_date end;

  with all_events as (
    select f.source_activity_id, f.lead_id, f.occurred_at, f.close_user_id, f.setter_calls,
      f.metric_date, f.appointments, f.setter_successes, f.closer_calls, f.closer_second_calls, f.closer_decided_calls, f.closer_sales,
      r.payload->>'custom_activity_type_id' as activity_type,
      r.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' as setter_result,
      r.payload->>'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' as closer_result,
      r.payload->>'custom.cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c' as followup_result,
      r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' as setter_status,
      r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' as closer_status
    from public.get_antony_activity_facts_internal(p_reference_date) f
    left join public.get_antony_outcome_payloads_internal(p_reference_date) r on r.close_activity_id=f.source_activity_id
    where f.source_type='custom_activity' and f.metric_date <= v_end
      and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')
  ), events as (select * from all_events where metric_date >= v_start), totals as (
    select
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65') as followup_contacts,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Follow Up') as further_followups,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Termin vereinbart') as followup_appointments,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: unqualifiziert') as followup_disqualified,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: kein Interesse') as followup_no_interest,
      count(*) filter(where setter_calls=1) as setter_calls,
      count(*) filter(where setter_calls=1 and setter_result='✅ Closer terminiert') as setter_qualified,
      count(*) filter(where setter_calls=1 and setter_result='🔎 Setter Follow Up') as setter_followups,
      count(*) filter(where setter_calls=1 and setter_result='❌ Disqualifiziert') as setter_disqualified,
      count(*) filter(where setter_calls=1 and coalesce(setter_result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as setter_unrated,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='Nicht erschienen') as setter_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='⛔ Abgesagt') as setter_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='🔄 Termin verschoben') as setter_rescheduled,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='Nicht erschienen') as closer_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='⛔ Abgesagt') as closer_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='🔄 Termin verschoben') as closer_rescheduled,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') as closer_calls,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='1. ✅ Verkauft - in CC1') as cc1_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='3. ✅ Verkauft - in CC2 🔥') as cc2_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='2. 🔥 CC2 vereinbart') as cc2_agreed,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='4. ❌ Nicht verkauft') as closer_lost,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and coalesce(closer_result,'') not in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥','2. 🔥 CC2 vereinbart','4. ❌ Nicht verkauft')) as closer_unrated
    from events
  ), setter_order as (
    select lead_id, occurred_at, setter_result, dense_rank() over(partition by lead_id order by occurred_at desc) as latest
    from events where setter_calls=1 and lead_id is not null
  ), latest_quality as (
    -- Contradictory results at the same timestamp remain unassessed.
    select lead_id, max(occurred_at) as occurred_at, case when count(distinct coalesce(setter_result,''))=1 then max(setter_result) end as result
    from setter_order where latest=1 group by lead_id
  ), quality_attribution as (
    select q.*, l.lead_source,
      booking.owner_id as owner_id,
      case when booking.found then 'booking_activity' else 'unassigned' end as attribution
    from latest_quality q left join public.close_lead_reporting l on l.lead_id=q.lead_id
    left join (select true found,b.* from public.get_close_first_bookings_internal(v_end) b) booking
 on booking.lead_id=q.lead_id and booking.booked_at<=q.occurred_at
  ), quality_groups as (
    select coalesce(q.lead_source,'Nicht zugeordnet') as source,
      case when q.owner_id is null then 'unassigned' else coalesce(p.slug,case when q.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end as owner,
      q.attribution, count(*) as assessed_leads,
      count(*) filter(where q.result='✅ Closer terminiert') as qualified,
      count(*) filter(where q.result='🔎 Setter Follow Up') as followup,
      count(*) filter(where q.result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where coalesce(q.result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated
    from quality_attribution q left join public.sales_people p on p.close_user_id=q.owner_id
    group by 1,2,3
  ), booked_leads as (
 select * from public.get_close_first_bookings_internal(v_end)
 where booked_date>=(date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date
  ), cohort_outcomes as (
    select b.*, l.lead_source, coalesce(s.arrived,false) as arrived, s.result, n.status,
      exists(select 1 from all_events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_calls=1) as closer_arrived,
      exists(select 1 from all_events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_sales=1) as sold,
      exists(select 1 from public.get_customer_acquisitions_internal(v_end) o where o.lead_id=b.lead_id and o.won_date>=(b.booked_at at time zone 'Europe/Berlin')::date and o.won_date<=v_end
        and o.status_id='stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL') as customer
    from booked_leads b left join public.close_lead_reporting l on l.lead_id=b.lead_id
    left join lateral (
      select true as arrived, case when count(distinct coalesce(e.setter_result,''))=1 then max(e.setter_result) end as result
      from all_events e where e.lead_id=b.lead_id and e.setter_calls=1 and e.occurred_at=(
        select max(x.occurred_at) from all_events x where x.lead_id=b.lead_id and x.setter_calls=1 and x.occurred_at>=b.booked_at
      ) having count(*)>0
    ) s on true
    left join lateral (
      select case when count(distinct coalesce(e.setter_status,''))=1 then max(e.setter_status) end as status
      from all_events e where e.lead_id=b.lead_id and e.occurred_at=(
        select max(x.occurred_at) from all_events x where x.lead_id=b.lead_id and x.setter_status is not null and x.occurred_at>=b.booked_at
      ) and e.setter_status is not null
    ) n on true
  ), cohort_groups as (
    select coalesce(c.lead_source,'Nicht zugeordnet') as source,
      case when c.owner_id is null then 'unassigned' else coalesce(p.slug,case when c.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end as owner,
      c.booked_date,count(*) as booked_leads, count(*) filter(where arrived) as setter_arrived,
      count(*) filter(where not arrived) as not_in_setter,
      count(*) filter(where not arrived and coalesce(status,'') not in ('Nicht erschienen','⛔ Abgesagt','🔄 Termin verschoben')) as pending,
      count(*) filter(where not arrived and status='Nicht erschienen') as no_show,
      count(*) filter(where not arrived and status='⛔ Abgesagt') as cancelled,
      count(*) filter(where not arrived and status='🔄 Termin verschoben') as rescheduled,
      count(*) filter(where arrived and result='✅ Closer terminiert') as qualified,
      count(*) filter(where arrived and result='🔎 Setter Follow Up') as followup,
      count(*) filter(where arrived and result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where arrived and coalesce(result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated,
      count(*) filter(where closer_arrived) as closer_arrived,
      count(*) filter(where sold) as sold_leads, count(*) filter(where customer) as new_customers
    from cohort_outcomes c left join public.sales_people p on p.close_user_id=c.owner_id group by 1,2,3
  ), quality as (
    select count(*) as assessed_leads,
      count(*) filter(where result='✅ Closer terminiert') as qualified,
      count(*) filter(where result='🔎 Setter Follow Up') as followup,
      count(*) filter(where result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where coalesce(result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated
    from latest_quality
  )
  select jsonb_build_object('period',jsonb_build_object('start',v_start,'end',v_end,'timezone','Europe/Berlin'),
    'activity',to_jsonb(t), 'lead_quality',to_jsonb(q),
    'quality_by_source',coalesce((select jsonb_agg(to_jsonb(g) order by g.source,g.owner) from quality_groups g),'[]'::jsonb),
    'booking_cohort',coalesce((select jsonb_agg(to_jsonb(c) order by c.source,c.owner) from cohort_groups c where c.booked_date>=v_start),'[]'::jsonb),
    'booking_cohort_history',coalesce((select jsonb_agg(to_jsonb(c) order by c.booked_date,c.source,c.owner) from cohort_groups c),'[]'::jsonb),
    'quality_basis','Latest Setter result per distinct lead inside period. Supplier: first documented booking; missing booking stays unassigned. Source: current Close field, not historical.',
    'cohort_basis','Distinct leads whose first documented booking is within period; outcomes after booking through period end. Booking actor is supplier. Repeat bookings count once. Arrival share is progress to cutoff, not a mature show rate. No-Shows/cancellations/reschedules shown only for leads not yet in Setter.')
  into v_result from totals t cross join quality q;
  return v_result || public.get_antony_journey_metrics_internal(p_period,p_reference_date) || public.get_antony_activity_origins_internal(p_period,p_reference_date);
end;
$function$;

create or replace function public.get_antony_activity_origins_internal(p_period text,p_reference_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_start date;v_end date;v_result jsonb;
begin
 if p_period not in ('day','week','month','three_months') or p_period is null or p_reference_date is null then raise exception 'Invalid period';end if;
 v_start:=case p_period when 'day' then p_reference_date when 'week' then date_trunc('week',p_reference_date::timestamp)::date when 'month' then date_trunc('month',p_reference_date::timestamp)::date else (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
 v_end:=case when p_period='week' then least(v_start+4,p_reference_date) else p_reference_date end;
 with all_events as (
    select f.source_activity_id, f.lead_id, f.occurred_at, f.close_user_id, f.setter_calls,
      f.metric_date, f.appointments, f.setter_successes, f.closer_calls, f.closer_second_calls, f.closer_decided_calls, f.closer_sales,
      r.payload->>'custom_activity_type_id' as activity_type,
      r.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' as setter_result,
      r.payload->>'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' as closer_result,
      r.payload->>'custom.cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c' as followup_result,
      r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' as setter_status,
      r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' as closer_status
    from public.get_antony_activity_facts_internal(p_reference_date) f
    left join public.get_antony_outcome_payloads_internal(p_reference_date) r on r.close_activity_id=f.source_activity_id
    where f.source_type='custom_activity' and f.metric_date <= v_end
      and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')

 ), events as (
 select e.*,b.booked_date,b.owner_id,coalesce(l.lead_source,'Nicht zugeordnet') source,
 case when b.owner_id is null then 'unassigned' else coalesce(p.slug,case when b.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end owner
 from all_events e left join public.get_close_first_bookings_internal(v_end) b on b.lead_id=e.lead_id and b.booked_at<=e.occurred_at
 left join public.close_lead_reporting l on l.lead_id=e.lead_id left join public.sales_people p on p.close_user_id=b.owner_id
 where e.metric_date>=v_start
 and (e.appointments>0 or e.setter_calls>0 or e.closer_calls>0 or e.setter_status is not null or e.closer_status is not null or e.activity_type='actitype_38qU8FYNxY0WkWAy66Uc65')
 ), grouped as (
    select source,owner,booked_date,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65') as followup_contacts,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Follow Up') as further_followups,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Termin vereinbart') as followup_appointments,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: unqualifiziert') as followup_disqualified,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: kein Interesse') as followup_no_interest,
      count(*) filter(where setter_calls=1) as setter_calls,
      count(*) filter(where setter_calls=1 and setter_result='✅ Closer terminiert') as setter_qualified,
      count(*) filter(where setter_calls=1 and setter_result='🔎 Setter Follow Up') as setter_followups,
      count(*) filter(where setter_calls=1 and setter_result='❌ Disqualifiziert') as setter_disqualified,
      count(*) filter(where setter_calls=1 and coalesce(setter_result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as setter_unrated,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='Nicht erschienen') as setter_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='⛔ Abgesagt') as setter_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='🔄 Termin verschoben') as setter_rescheduled,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='Nicht erschienen') as closer_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='⛔ Abgesagt') as closer_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='🔄 Termin verschoben') as closer_rescheduled,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') as closer_calls,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='1. ✅ Verkauft - in CC1') as cc1_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='3. ✅ Verkauft - in CC2 🔥') as cc2_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='2. 🔥 CC2 vereinbart') as cc2_agreed,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='4. ❌ Nicht verkauft') as closer_lost,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and coalesce(closer_result,'') not in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥','2. 🔥 CC2 vereinbart','4. ❌ Nicht verkauft')) as closer_unrated
,
 sum(appointments) appointments,
 count(*) filter(where setter_calls=1 and booked_date>=v_start) setter_from_period_bookings,
 count(*) filter(where setter_calls=1 and booked_date<v_start) setter_from_prior_bookings,
 count(*) filter(where setter_calls=1 and booked_date is null) setter_without_booking
,
 count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and (closer_result='3. ✅ Verkauft - in CC2 🔥' or exists(select 1 from all_events old where old.lead_id=events.lead_id and old.closer_second_calls=1 and old.occurred_at<events.occurred_at))) cc2_calls,
 count(*) filter(where closer_result='4. ❌ Nicht verkauft' and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and exists(select 1 from all_events old where old.lead_id=events.lead_id and old.closer_second_calls=1 and old.occurred_at<events.occurred_at)) cc2_lost,
 count(*) filter(where closer_result='4. ❌ Nicht verkauft' and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and not exists(select 1 from all_events old where old.lead_id=events.lead_id and old.closer_second_calls=1 and old.occurred_at<events.occurred_at)) cc1_lost,
 count(*) filter(where closer_sales=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and exists(select 1 from public.get_customer_acquisitions_internal(v_end) o where o.lead_id=events.lead_id and o.won_date<events.metric_date)) sales_after_prior_won
 from events group by source,owner,booked_date
 ), customers as (
 select coalesce(l.lead_source,'Nicht zugeordnet') source,
 case when b.owner_id is null then 'unassigned' else coalesce(p.slug,case when b.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end owner,
 b.booked_date,count(*) new_customers
 from public.get_customer_acquisitions_internal(v_end) o
 left join public.get_close_first_bookings_internal(v_end) b on b.lead_id=o.lead_id and b.booked_date<=o.won_date
 left join public.close_lead_reporting l on l.lead_id=o.lead_id left join public.sales_people p on p.close_user_id=b.owner_id
 where o.won_date>=v_start and o.closer_close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR'
 group by 1,2,3
 ), combined as (
 select coalesce(to_jsonb(g),'{}'::jsonb)||jsonb_build_object('source',coalesce(g.source,c.source),'owner',coalesce(g.owner,c.owner),
 'booked_date',coalesce(g.booked_date,c.booked_date),'new_customers',coalesce(c.new_customers,0)) row
 from grouped g full join customers c on c.source=g.source and c.owner=g.owner and c.booked_date is not distinct from g.booked_date
 )
 select jsonb_build_object('activity_by_origin',coalesce((select jsonb_agg(row order by row->>'booked_date',row->>'source',row->>'owner') from combined),'[]'::jsonb),
 'origin_basis','First documented booking, independent of report window. Missing or future bookings remain unknown. Activity dates and cohort conversion are separate.') into v_result;
 return v_result;
end;$$;

CREATE OR REPLACE FUNCTION public.get_antony_process_metrics_internal(p_period text, p_reference_date date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_start date; v_end date; v_result jsonb;
begin
  if p_reference_date is null or p_period is null or p_period not in ('day','week','month','three_months') then
    raise exception 'Invalid process reporting period' using errcode='22023';
  end if;
  v_start := case p_period when 'day' then p_reference_date
    when 'week' then date_trunc('week',p_reference_date::timestamp)::date
    when 'month' then date_trunc('month',p_reference_date::timestamp)::date
    else (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
  v_end := case when p_period='week' then least(v_start+4,p_reference_date) else p_reference_date end;

  with all_events as (
    select f.source_activity_id, f.lead_id, f.occurred_at, f.close_user_id, f.setter_calls,
      f.metric_date, f.appointments, f.setter_successes, f.closer_calls, f.closer_second_calls, f.closer_decided_calls, f.closer_sales,
      r.payload->>'custom_activity_type_id' as activity_type,
      r.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' as setter_result,
      r.payload->>'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' as closer_result,
      r.payload->>'custom.cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c' as followup_result,
      r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' as setter_status,
      r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' as closer_status
    from public.get_antony_activity_facts_internal(p_reference_date) f
    left join public.get_antony_outcome_payloads_internal(p_reference_date) r on r.close_activity_id=f.source_activity_id
    where f.source_type='custom_activity' and f.metric_date <= v_end
      and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')
  ), events as (select * from all_events where metric_date >= v_start), totals as (
    select
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65') as followup_contacts,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Follow Up') as further_followups,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Termin vereinbart') as followup_appointments,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: unqualifiziert') as followup_disqualified,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: kein Interesse') as followup_no_interest,
      count(*) filter(where setter_calls=1) as setter_calls,
      count(*) filter(where setter_calls=1 and setter_result='✅ Closer terminiert') as setter_qualified,
      count(*) filter(where setter_calls=1 and setter_result='🔎 Setter Follow Up') as setter_followups,
      count(*) filter(where setter_calls=1 and setter_result='❌ Disqualifiziert') as setter_disqualified,
      count(*) filter(where setter_calls=1 and coalesce(setter_result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as setter_unrated,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='Nicht erschienen') as setter_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='⛔ Abgesagt') as setter_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='🔄 Termin verschoben') as setter_rescheduled,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='Nicht erschienen') as closer_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='⛔ Abgesagt') as closer_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='🔄 Termin verschoben') as closer_rescheduled,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') as closer_calls,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='1. ✅ Verkauft - in CC1') as cc1_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='3. ✅ Verkauft - in CC2 🔥') as cc2_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='2. 🔥 CC2 vereinbart') as cc2_agreed,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='4. ❌ Nicht verkauft') as closer_lost,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and coalesce(closer_result,'') not in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥','2. 🔥 CC2 vereinbart','4. ❌ Nicht verkauft')) as closer_unrated
    from events
  ), setter_order as (
    select lead_id, occurred_at, setter_result, dense_rank() over(partition by lead_id order by occurred_at desc) as latest
    from events where setter_calls=1 and lead_id is not null
  ), latest_quality as (
    -- Contradictory results at the same timestamp remain unassessed.
    select lead_id, max(occurred_at) as occurred_at, case when count(distinct coalesce(setter_result,''))=1 then max(setter_result) end as result
    from setter_order where latest=1 group by lead_id
  ), quality_attribution as (
    select q.*, l.lead_source,
      booking.owner_id as owner_id,
      case when booking.found then 'booking_activity' else 'unassigned' end as attribution
    from latest_quality q left join public.close_lead_reporting l on l.lead_id=q.lead_id
    left join (select true found,b.* from public.get_close_first_bookings_internal(v_end) b) booking
 on booking.lead_id=q.lead_id and booking.booked_at<=q.occurred_at
  ), quality_groups as (
    select coalesce(q.lead_source,'Nicht zugeordnet') as source,
      case when q.owner_id is null then 'unassigned' else coalesce(p.slug,case when q.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end as owner,
      q.attribution, count(*) as assessed_leads,
      count(*) filter(where q.result='✅ Closer terminiert') as qualified,
      count(*) filter(where q.result='🔎 Setter Follow Up') as followup,
      count(*) filter(where q.result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where coalesce(q.result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated
    from quality_attribution q left join public.sales_people p on p.close_user_id=q.owner_id
    group by 1,2,3
  ), booked_leads as (
 select * from public.get_close_first_bookings_internal(v_end)
 where booked_date>=(date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date
  ), cohort_outcomes as (
    select b.*, l.lead_source, coalesce(s.arrived,false) as arrived, s.result, n.status,
      exists(select 1 from all_events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_calls=1) as closer_arrived,
      exists(select 1 from all_events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_sales=1) as sold,
      exists(select 1 from public.get_customer_acquisitions_internal(v_end) o where o.lead_id=b.lead_id and o.won_date>=(b.booked_at at time zone 'Europe/Berlin')::date and o.won_date<=v_end
        and o.status_id='stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL') as customer
    from booked_leads b left join public.close_lead_reporting l on l.lead_id=b.lead_id
    left join lateral (
      select true as arrived, case when count(distinct coalesce(e.setter_result,''))=1 then max(e.setter_result) end as result
      from all_events e where e.lead_id=b.lead_id and e.setter_calls=1 and e.occurred_at=(
        select max(x.occurred_at) from all_events x where x.lead_id=b.lead_id and x.setter_calls=1 and x.occurred_at>=b.booked_at
      ) having count(*)>0
    ) s on true
    left join lateral (
      select case when count(distinct coalesce(e.setter_status,''))=1 then max(e.setter_status) end as status
      from all_events e where e.lead_id=b.lead_id and e.occurred_at=(
        select max(x.occurred_at) from all_events x where x.lead_id=b.lead_id and x.setter_status is not null and x.occurred_at>=b.booked_at
      ) and e.setter_status is not null
    ) n on true
  ), cohort_groups as (
    select coalesce(c.lead_source,'Nicht zugeordnet') as source,
      case when c.owner_id is null then 'unassigned' else coalesce(p.slug,case when c.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end as owner,
      c.booked_date,count(*) as booked_leads, count(*) filter(where arrived) as setter_arrived,
      count(*) filter(where not arrived) as not_in_setter,
      count(*) filter(where not arrived and coalesce(status,'') not in ('Nicht erschienen','⛔ Abgesagt','🔄 Termin verschoben')) as pending,
      count(*) filter(where not arrived and status='Nicht erschienen') as no_show,
      count(*) filter(where not arrived and status='⛔ Abgesagt') as cancelled,
      count(*) filter(where not arrived and status='🔄 Termin verschoben') as rescheduled,
      count(*) filter(where arrived and result='✅ Closer terminiert') as qualified,
      count(*) filter(where arrived and result='🔎 Setter Follow Up') as followup,
      count(*) filter(where arrived and result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where arrived and coalesce(result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated,
      count(*) filter(where closer_arrived) as closer_arrived,
      count(*) filter(where sold) as sold_leads, count(*) filter(where customer) as new_customers
    from cohort_outcomes c left join public.sales_people p on p.close_user_id=c.owner_id group by 1,2,3
  ), quality as (
    select count(*) as assessed_leads,
      count(*) filter(where result='✅ Closer terminiert') as qualified,
      count(*) filter(where result='🔎 Setter Follow Up') as followup,
      count(*) filter(where result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where coalesce(result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated
    from latest_quality
  )
  select jsonb_build_object('period',jsonb_build_object('start',v_start,'end',v_end,'timezone','Europe/Berlin'),
    'activity',to_jsonb(t), 'lead_quality',to_jsonb(q),
    'quality_by_source',coalesce((select jsonb_agg(to_jsonb(g) order by g.source,g.owner) from quality_groups g),'[]'::jsonb),
    'booking_cohort',coalesce((select jsonb_agg(to_jsonb(c) order by c.source,c.owner) from cohort_groups c where c.booked_date>=v_start),'[]'::jsonb),
    'booking_cohort_history',coalesce((select jsonb_agg(to_jsonb(c) order by c.booked_date,c.source,c.owner) from cohort_groups c),'[]'::jsonb),
    'quality_basis','Latest Setter result per distinct lead inside period. Supplier: first documented booking; missing booking stays unassigned. Source: current Close field, not historical.',
    'cohort_basis','Distinct leads whose first documented booking is within period; outcomes after booking through period end. Booking actor is supplier. Repeat bookings count once. Arrival share is progress to cutoff, not a mature show rate. No-Shows/cancellations/reschedules shown only for leads not yet in Setter.')
  into v_result from totals t cross join quality q;
  return v_result || public.get_antony_journey_metrics_internal(p_period,p_reference_date) || public.get_antony_activity_origins_internal(p_period,p_reference_date);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_antony_process_metrics_internal(p_period text, p_reference_date date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_start date; v_end date; v_result jsonb;
begin
  if p_reference_date is null or p_period is null or p_period not in ('day','week','month','three_months') then
    raise exception 'Invalid process reporting period' using errcode='22023';
  end if;
  v_start := case p_period when 'day' then p_reference_date
    when 'week' then date_trunc('week',p_reference_date::timestamp)::date
    when 'month' then date_trunc('month',p_reference_date::timestamp)::date
    else (date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date end;
  v_end := case when p_period='week' then least(v_start+4,p_reference_date) else p_reference_date end;

  with all_events as (
    select f.source_activity_id, f.lead_id, f.occurred_at, f.close_user_id, f.setter_calls,
      f.metric_date, f.appointments, f.setter_successes, f.closer_calls, f.closer_second_calls, f.closer_decided_calls, f.closer_sales,
      r.payload->>'custom_activity_type_id' as activity_type,
      r.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' as setter_result,
      r.payload->>'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn' as closer_result,
      r.payload->>'custom.cf_cCwSCrUsnKXzbenn1zkdqrjNIjM6ewkGgpdj4w4Yb4c' as followup_result,
      r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' as setter_status,
      r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' as closer_status
    from public.get_antony_activity_facts_internal(p_reference_date) f
    left join public.get_antony_outcome_payloads_internal(p_reference_date) r on r.close_activity_id=f.source_activity_id
    where f.source_type='custom_activity' and f.metric_date <= v_end
      and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')
  ), events as (select * from all_events where metric_date >= v_start), totals as (
    select
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65') as followup_contacts,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Follow Up') as further_followups,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: Termin vereinbart') as followup_appointments,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: unqualifiziert') as followup_disqualified,
      count(*) filter(where activity_type='actitype_38qU8FYNxY0WkWAy66Uc65' and followup_result='Entscheider: kein Interesse') as followup_no_interest,
      count(*) filter(where setter_calls=1) as setter_calls,
      count(*) filter(where setter_calls=1 and setter_result='✅ Closer terminiert') as setter_qualified,
      count(*) filter(where setter_calls=1 and setter_result='🔎 Setter Follow Up') as setter_followups,
      count(*) filter(where setter_calls=1 and setter_result='❌ Disqualifiziert') as setter_disqualified,
      count(*) filter(where setter_calls=1 and coalesce(setter_result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as setter_unrated,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='Nicht erschienen') as setter_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='⛔ Abgesagt') as setter_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and setter_status='🔄 Termin verschoben') as setter_rescheduled,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='Nicht erschienen') as closer_no_shows,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='⛔ Abgesagt') as closer_cancellations,
      count(*) filter(where activity_type='actitype_6dnbcILqqeo0iGpRCEjOas' and closer_status='🔄 Termin verschoben') as closer_rescheduled,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR') as closer_calls,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='1. ✅ Verkauft - in CC1') as cc1_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='3. ✅ Verkauft - in CC2 🔥') as cc2_sales,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='2. 🔥 CC2 vereinbart') as cc2_agreed,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and closer_result='4. ❌ Nicht verkauft') as closer_lost,
      count(*) filter(where closer_calls=1 and close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' and coalesce(closer_result,'') not in ('1. ✅ Verkauft - in CC1','3. ✅ Verkauft - in CC2 🔥','2. 🔥 CC2 vereinbart','4. ❌ Nicht verkauft')) as closer_unrated
    from events
  ), setter_order as (
    select lead_id, occurred_at, setter_result, dense_rank() over(partition by lead_id order by occurred_at desc) as latest
    from events where setter_calls=1 and lead_id is not null
  ), latest_quality as (
    -- Contradictory results at the same timestamp remain unassessed.
    select lead_id, max(occurred_at) as occurred_at, case when count(distinct coalesce(setter_result,''))=1 then max(setter_result) end as result
    from setter_order where latest=1 group by lead_id
  ), quality_attribution as (
    select q.*, l.lead_source,
      booking.owner_id as owner_id,
      case when booking.found then 'booking_activity' else 'unassigned' end as attribution
    from latest_quality q left join public.close_lead_reporting l on l.lead_id=q.lead_id
    left join (select true found,b.* from public.get_close_first_bookings_internal(v_end) b) booking
 on booking.lead_id=q.lead_id and booking.booked_at<=q.occurred_at
  ), quality_groups as (
    select coalesce(q.lead_source,'Nicht zugeordnet') as source,
      case when q.owner_id is null then 'unassigned' else coalesce(p.slug,case when q.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end as owner,
      q.attribution, count(*) as assessed_leads,
      count(*) filter(where q.result='✅ Closer terminiert') as qualified,
      count(*) filter(where q.result='🔎 Setter Follow Up') as followup,
      count(*) filter(where q.result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where coalesce(q.result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated
    from quality_attribution q left join public.sales_people p on p.close_user_id=q.owner_id
    group by 1,2,3
  ), booked_leads as (
 select first.*, (select min(h.occurred_at) from public.close_meetings m join public.close_booking_history h on h.source_activity_id=m.booking_activity_id where m.lead_id=first.lead_id and m.starts_at=first.booked_at and m.removed_at is null) as booking_created_at from public.get_close_first_bookings_internal(v_end) first
 where booked_date>=(date_trunc('month',now() at time zone 'Europe/Berlin')-interval '2 months')::date
  ), cohort_outcomes as (
    select b.*, l.lead_source, coalesce(s.arrived,false) as arrived, s.result, n.status,
      exists(select 1 from all_events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_calls=1) as closer_arrived,
      exists(select 1 from all_events e where e.lead_id=b.lead_id and e.occurred_at>=b.booked_at and e.closer_sales=1) as sold,
      exists(select 1 from public.get_customer_acquisitions_internal(v_end) o where o.lead_id=b.lead_id and o.won_date>=(b.booked_at at time zone 'Europe/Berlin')::date and o.won_date<=v_end
        and o.status_id='stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL') as customer
    from booked_leads b left join public.close_lead_reporting l on l.lead_id=b.lead_id
    left join lateral (
      select true as arrived, case when count(distinct coalesce(e.setter_result,''))=1 then max(e.setter_result) end as result
      from all_events e where e.lead_id=b.lead_id and e.setter_calls=1 and e.occurred_at=(
        select max(x.occurred_at) from all_events x where x.lead_id=b.lead_id and x.setter_calls=1 and x.occurred_at>=b.booked_at
      ) having count(*)>0
    ) s on true
    left join lateral (
      select case when count(distinct coalesce(e.setter_status,''))=1 then max(e.setter_status) end as status
      from all_events e where e.lead_id=b.lead_id and e.occurred_at=(
        select max(x.occurred_at) from all_events x where x.lead_id=b.lead_id and x.setter_status is not null and x.occurred_at>=case when x.setter_status in ('⛔ Abgesagt','🔄 Termin verschoben') then coalesce(b.booking_created_at,b.booked_at) else b.booked_at end
      ) and e.setter_status is not null
    ) n on true
  ), cohort_groups as (
    select coalesce(c.lead_source,'Nicht zugeordnet') as source,
      case when c.owner_id is null then 'unassigned' else coalesce(p.slug,case when c.owner_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then 'antony' else 'other' end) end as owner,
      c.booked_date,count(*) as booked_leads, count(*) filter(where arrived) as setter_arrived,
      count(*) filter(where not arrived) as not_in_setter,
      count(*) filter(where not arrived and c.booked_at>public.get_sales_data_as_of_internal()) as future,
      count(*) filter(where not arrived and c.booked_at<=public.get_sales_data_as_of_internal() and coalesce(status,'') not in ('Nicht erschienen','⛔ Abgesagt','🔄 Termin verschoben')) as pending,
      count(*) filter(where not arrived and status='Nicht erschienen') as no_show,
      count(*) filter(where not arrived and status='⛔ Abgesagt') as cancelled,
      count(*) filter(where not arrived and status='🔄 Termin verschoben') as rescheduled,
      count(*) filter(where arrived and result='✅ Closer terminiert') as qualified,
      count(*) filter(where arrived and result='🔎 Setter Follow Up') as followup,
      count(*) filter(where arrived and result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where arrived and coalesce(result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated,
      count(*) filter(where closer_arrived) as closer_arrived,
      count(*) filter(where sold) as sold_leads, count(*) filter(where customer) as new_customers
    from cohort_outcomes c left join public.sales_people p on p.close_user_id=c.owner_id group by 1,2,3
  ), quality as (
    select count(*) as assessed_leads,
      count(*) filter(where result='✅ Closer terminiert') as qualified,
      count(*) filter(where result='🔎 Setter Follow Up') as followup,
      count(*) filter(where result='❌ Disqualifiziert') as disqualified,
      count(*) filter(where coalesce(result,'') not in ('✅ Closer terminiert','🔎 Setter Follow Up','❌ Disqualifiziert')) as unrated
    from latest_quality
  )
  select jsonb_build_object('period',jsonb_build_object('start',v_start,'end',v_end,'timezone','Europe/Berlin'),
    'activity',to_jsonb(t), 'lead_quality',to_jsonb(q),
    'quality_by_source',coalesce((select jsonb_agg(to_jsonb(g) order by g.source,g.owner) from quality_groups g),'[]'::jsonb),
    'booking_cohort',coalesce((select jsonb_agg(to_jsonb(c) order by c.source,c.owner) from cohort_groups c where c.booked_date>=v_start),'[]'::jsonb),
    'booking_cohort_history',coalesce((select jsonb_agg(to_jsonb(c) order by c.booked_date,c.source,c.owner) from cohort_groups c),'[]'::jsonb),
    'quality_basis','Latest Setter result per distinct lead inside period. Supplier: first documented booking; missing booking stays unassigned. Source: current Close field, not historical.',
    'cohort_basis','Distinct leads whose first documented booking is within period; outcomes after booking through period end. Booking actor is supplier. Repeat bookings count once. Arrival share is progress to cutoff, not a mature show rate. No-Shows/cancellations/reschedules shown only for leads not yet in Setter.')
  into v_result from totals t cross join quality q;
  return v_result || jsonb_build_object('setter_attendance',public.get_setter_attendance_metrics_internal(v_start,v_end)) || public.get_antony_journey_metrics_internal(p_period,p_reference_date) || public.get_antony_activity_origins_internal(p_period,p_reference_date);
end;
$function$;

create or replace function public.get_antony_pipeline_snapshot(p_reference_date date default (now() at time zone 'Europe/Berlin')::date)
returns jsonb language sql stable security definer set search_path='' as $$
 with parameters as (select p_reference_date as_of,(date_trunc('month',p_reference_date::timestamp)-interval '2 months')::date window_start),
 events as (
 select f.lead_id,case when f.appointments=1 then coalesce((select h.occurred_at from public.close_meetings m join public.close_booking_history h on h.source_activity_id=m.booking_activity_id where m.meeting_id=f.source_activity_id),f.occurred_at) else f.occurred_at end as occurred_at,
 case when f.closer_calls=1 and f.close_user_id='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR' then case when f.closer_sales=1 then 'sold_pending_won' when f.closer_decided_calls=1 then 'closed' when f.closer_second_calls=1 then 'pending_decision_cc2' else 'unrated' end
 when r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' is not null then case r.payload->>'custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q' when '⛔ Abgesagt' then 'closed' when 'Nicht erschienen' then 'closer_no_show' when '🔄 Termin verschoben' then 'rescheduled_closer' else 'unrated' end
 when f.setter_calls=1 then case r.payload->>'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo' when '✅ Closer terminiert' then 'closer_scheduled' when '🔎 Setter Follow Up' then 'setter_followup' when '❌ Disqualifiziert' then 'closed' else 'unrated' end
 when r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' is not null then case r.payload->>'custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz' when '⛔ Abgesagt' then 'closed' when 'Nicht erschienen' then 'setter_no_show' when '🔄 Termin verschoben' then 'rescheduled_setter' else 'unrated' end
 when f.appointments=1 then case when f.occurred_at>public.get_sales_data_as_of_internal() then 'setter_planned' else 'setter_pending' end end status
 from public.get_antony_activity_facts_internal(p_reference_date) f join parameters p on f.metric_date between p.window_start and p.as_of
 left join public.get_antony_outcome_payloads_internal(p_reference_date) r on r.close_activity_id=f.source_activity_id
 where f.lead_id is not null and f.source_type='custom_activity' and f.close_user_id in ('user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy','user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4','user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR')
 ), ordered as (select *,dense_rank() over(partition by lead_id order by occurred_at desc) rank from events where status is not null),
 latest as (select lead_id,max(occurred_at) status_since,case when count(distinct status)=1 then max(status) else 'unrated' end status from ordered where rank=1 group by lead_id),
 open as (select l.* from latest l where l.status<>'closed' and not exists(select 1 from public.close_opportunity_facts o where o.lead_id=l.lead_id and o.won_date<=p_reference_date))
 select jsonb_build_object('as_of',p.as_of,'window_start',p.window_start,'timezone','Europe/Berlin','retention_months',3,
 'counts',jsonb_build_object('total_open',count(o.lead_id),
 'setter_planned',count(*) filter(where o.status='setter_planned'),'setter_pending',count(*) filter(where o.status='setter_pending'),'setter_followup',count(*) filter(where o.status='setter_followup'),'rescheduled_setter',count(*) filter(where o.status='rescheduled_setter'),'setter_no_show',count(*) filter(where o.status='setter_no_show'),'closer_scheduled',count(*) filter(where o.status='closer_scheduled'),'rescheduled_closer',count(*) filter(where o.status='rescheduled_closer'),'closer_no_show',count(*) filter(where o.status='closer_no_show'),'pending_decision_cc2',count(*) filter(where o.status='pending_decision_cc2'),'sold_pending_won',count(*) filter(where o.status='sold_pending_won'),'unrated',count(*) filter(where o.status='unrated'),
 'from_previous_months',count(*) filter(where (o.status_since at time zone 'Europe/Berlin')::date<date_trunc('month',p.as_of::timestamp)::date),
 'older_than_14_days',count(*) filter(where (o.status_since at time zone 'Europe/Berlin')::date<p.as_of-14)),
 'oldest_open_date',(min(o.status_since) at time zone 'Europe/Berlin')::date)
 from parameters p left join open o on true group by p.as_of,p.window_start;
$$;

alter function public.get_antony_activity_facts_internal(date) set jit=off;
alter function public.get_antony_process_metrics_internal(text,date) set jit=off;
commit;
