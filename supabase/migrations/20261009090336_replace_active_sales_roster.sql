begin;

-- Retire the identity, never its historic facts, targets or attribution.
alter table public.sales_people add column if not exists call_tracking_start date;
update public.sales_people set active=false where slug='felix';
insert into public.sales_people(close_user_id,slug,display_name,color,active,sort_order,call_tracking_start)
values ('user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR','anthony','Anthony Rigone','#f59e0b',true,20,'2026-10-09')
on conflict(close_user_id) do update set slug=excluded.slug,display_name=excluded.display_name,
 color=excluded.color,active=true,sort_order=excluded.sort_order,
 call_tracking_start=coalesce(public.sales_people.call_tracking_start,excluded.call_tracking_start);

-- Existing manager permissions stay intact; own performance gets its actual identity.
update public.profiles pr set sales_person_id=p.id
from public.sales_people p
where p.slug='anthony' and pr.display_name='Antony Rigone' and pr.role='manager'
 and (select count(*) from public.profiles where display_name='Antony Rigone' and role='manager')=1;

-- Same 150 weekday calls and 25% appointment target; other goals stay unset.
insert into public.sales_targets(sales_person_id,period_start,period_end,calls_gross,appointment_rate_target)
select p.id,'2026-10-09'::date,'2026-12-31'::date,
 150*(select count(*) from generate_series('2026-10-09'::date,'2026-12-31'::date,'1 day') d
      where extract(isodow from d)<=5),25
from public.sales_people p where p.slug='anthony'
on conflict(sales_person_id,period_start,period_end) do nothing;

-- Retired sales accounts fail the existing access checks even with an unexpired JWT.
create or replace function public.has_dashboard_access()
returns boolean language sql stable security definer set search_path='' as $function$
 select exists(select 1 from public.profiles pr
 where pr.user_id=auth.uid() and pr.must_change_password=false
 and (pr.role='manager' or exists(select 1 from public.sales_people p
       where p.id=pr.sales_person_id and p.active)));
$function$;

create or replace function public.get_close_opener_internal(p_lead_id text)
returns text language sql stable security definer set search_path='' as $function$
 select coalesce((select case
 when l.report_dimensions->>'backoffice_id'='linkedin' and nullif(l.report_dimensions->>'backoffice_basis','') is not null then 'linkedin'
 when p.active then p.slug
 when nullif(l.opener_close_user_id,'') is not null then 'outside_current_team'
 else 'unassigned' end from public.close_funnel_leads l
 left join public.sales_people p on p.close_user_id=l.opener_close_user_id where l.lead_id=p_lead_id),'unassigned');
$function$;

create or replace function public.get_close_opener_labels_internal()
returns jsonb language sql stable security definer set search_path='' as $function$
 select coalesce((select jsonb_object_agg(p.slug,p.display_name) from public.sales_people p where p.active),'{}'::jsonb)
 || jsonb_build_object('linkedin','LinkedIn','unassigned','Opener fehlt','outside_current_team','Ehemaliger / kein aktueller Team-Opener');
$function$;

-- A previous team's successful sync cannot prove Anthony's old call coverage.
CREATE OR REPLACE FUNCTION public.get_opening_monthly_review(p_reference_date date DEFAULT ((now() AT TIME ZONE 'Europe/Berlin'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET jit TO 'off'
AS $function$
declare v_date date;v_result jsonb;
begin
 if auth.uid() is null or not public.has_dashboard_access() then raise exception 'Nicht berechtigt' using errcode='42501';end if;
 if p_reference_date is null then raise exception 'Ungültiger Stichtag' using errcode='22023';end if;
 v_date:=least(p_reference_date,(now() at time zone 'Europe/Berlin')::date);
 with windows as (
  select (date_trunc('month',v_date::timestamp)-n*interval '1 month')::date start_date,
   least(v_date,(date_trunc('month',v_date::timestamp)-(n-1)*interval '1 month'-interval '1 day')::date) end_date,
   (date_trunc('month',v_date::timestamp)-(n-1)*interval '1 month'-interval '1 day')::date month_end
  from generate_series(0,2)n
 ), coverage as (
  select w.*,count(*) calendar_days,count(*) filter(where exists(
    select 1 from public.sync_runs r where r.status='success'
     and r.source_window_start <= (d at time zone 'Europe/Berlin')
     and r.source_window_end >= ((d+interval '1 day') at time zone 'Europe/Berlin')
   )) coverage_days
  from windows w cross join lateral generate_series(w.start_date::timestamp,w.end_date::timestamp,interval '1 day')d
  group by w.start_date,w.end_date,w.month_end
 ), metrics as (
  select to_jsonb(m)||jsonb_build_object('month_start',w.start_date,'month_end',w.end_date,
   'partial',w.end_date<w.month_end,'calls_coverage_complete',w.coverage_days=w.calendar_days and (p.call_tracking_start is null or p.call_tracking_start <= w.start_date),
   'calls_coverage_days',w.coverage_days,'calendar_days',w.calendar_days) row
  from coverage w cross join lateral public.get_dashboard_metrics('month',w.end_date)m
  join public.sales_people p on p.slug=m.slug and p.active
 ) select coalesce(jsonb_agg(row order by row->>'month_start',row->>'slug'),'[]'::jsonb) into v_result from metrics;
 return v_result;
end;$function$;


-- Materialise only the newly active identity from existing documented facts.
-- This is not a Close backfill, and does not recalculate Michael's or Felix's rows.
insert into public.daily_sales_metrics(metric_date,sales_person_id,calls_gross,calls_net,talk_seconds,
 gatekeeper_contacts,connected_calls,direct_decision_maker_calls,decision_maker_contacts,
 appointments,setter_calls,setter_successes,closer_calls,closer_second_calls,closer_sales,
 no_shows,cancellations,rescheduled_appointments)
select f.metric_date,p.id,sum(f.calls_gross),sum(f.calls_net),sum(f.talk_seconds),
 sum(f.gatekeeper_contacts),sum(f.connected_calls),sum(f.direct_decision_maker_calls),sum(f.decision_maker_contacts),
 sum(case when public.get_close_opener_internal(f.lead_id)='linkedin' then 0 else f.appointments end),
 sum(f.setter_calls),sum(f.setter_successes),sum(f.closer_calls),sum(f.closer_second_calls),sum(f.closer_sales),
 sum(f.no_shows),sum(f.cancellations),sum(f.rescheduled_appointments)
from public.close_activity_facts f join public.sales_people p on p.close_user_id=f.close_user_id and p.slug='anthony'
group by f.metric_date,p.id
on conflict(metric_date,sales_person_id) do nothing;

commit;
