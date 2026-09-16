begin;

-- Re-evaluate only retained Call facts from their own stored Close evidence.
-- This is not a history import or an adjustment to a person's expected total.
-- Appointment, decision-maker, Setting and Closing facts remain unchanged.
with classified as (
 select f.source_activity_id,
   case when r.payload->>'direction' in ('inbound','outbound')
     and r.payload->>'status' in ('completed','no-answer','busy','failed','timeout','cancel') then 1 else 0 end::smallint gross,
   case when r.payload->>'direction' in ('inbound','outbound')
     and r.payload->>'status'='completed' and r.payload->>'disposition'='answered' then 1 else 0 end::smallint net,
   greatest(0,coalesce((r.payload->>'duration')::integer,0)) duration
 from public.close_activity_facts f
 join public.close_raw_activities r on r.close_activity_id=f.source_activity_id and r.activity_type='call'
 join public.sales_people p on p.close_user_id=f.close_user_id and p.slug in ('michael','felix')
 where f.source_type='call'
)
update public.close_activity_facts f
set calls_gross=c.gross,calls_net=c.net,talk_seconds=case when c.net=1 then c.duration else 0 end,
 mapping_version='2026-09-16.all-calls',mapped_at=now()
from classified c where c.source_activity_id=f.source_activity_id;

-- Refresh only the three Call columns; all other published KPIs stay intact.
with totals as (
 select f.metric_date,p.id sales_person_id,sum(f.calls_gross)::integer gross,
   sum(f.calls_net)::integer net,sum(f.talk_seconds)::integer seconds
 from public.close_activity_facts f
 join public.sales_people p on p.close_user_id=f.close_user_id and p.slug in ('michael','felix')
 where f.source_type='call'
 group by f.metric_date,p.id
)
update public.daily_sales_metrics d
set calls_gross=t.gross,calls_net=t.net,talk_seconds=t.seconds
from totals t where t.metric_date=d.metric_date and t.sales_person_id=d.sales_person_id;

-- Reuse the one existing job and its secret reference, timeout and source window.
-- The legacy name stays stable for existing runbooks; the schedule is five minutes.
do $$
declare v_id bigint;
begin
 select jobid into strict v_id from cron.job where jobname='close_sync_every_15_minutes';
 perform cron.alter_job(v_id,schedule:='2-59/5 * * * *');
end;$$;

commit;
