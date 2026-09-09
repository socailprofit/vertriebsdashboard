import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema extensions;create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
create schema auth;create function auth.uid() returns uuid language sql as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;
create function has_dashboard_access() returns boolean language sql as $$select true$$;
create function has_antony_access() returns boolean language sql as $$select true$$;
create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select '2026-09-10T12:00Z'::timestamptz$$;`);
await db.exec(read('fixtures/kpi-schema.sql'));
await db.exec('create table antony_performance_goals(id integer);');
for(const m of ['20260907121749_normalize_transfer_opportunities','20260908071339_reconcile_antony_kpis','20260908071341_add_antony_process_metrics','20260908071707_fix_lead_snapshot_delete_guard','20260908082307_audit_complete_sales_journey','20260908085704_fix_booking_cohort_filters','20260908093505_optimize_cohort_report_plan','20260908124152_store_calendar_meetings','20260908124321_calendar_snapshot_safe_update','20260908124714_use_meeting_time_for_antony','20260908125538_retain_pre_meeting_cancellations','20260908131505_setter_meeting_attendance','20260908132556_calendar_reconciliation_execution'])await db.exec(read('../supabase/migrations/'+m+'.sql'));
await db.exec(read('../supabase/migrations/20260908145135_lead_funnel_event_history.sql'));
const EVENT_COUNT = Number(process.env.FUNNEL_BENCH_EVENTS ?? 13900);
const PROCESS_COUNT = Number(process.env.FUNNEL_BENCH_PROCESSES ?? 1032);
const MEETING_COUNT = Number(process.env.FUNNEL_BENCH_MEETINGS ?? 3055);
const RAW_COUNT = Number(process.env.FUNNEL_BENCH_RAW ?? 783);
const BOOKING_COUNT = Math.min(RAW_COUNT,425), LINKED_COUNT=Math.min(MEETING_COUNT,BOOKING_COUNT,388);
const RELATION_COUNT=Math.min(EVENT_COUNT,2172);
const sourceAt = '2026-08-10T08:00:00Z';
const M = 'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy';
const processes = Array.from({length:PROCESS_COUNT},(_,i)=>({process_id:`process-${i}`,lead_id:`lead-${i}`,state:'follow_up',stage:'setter',closed_at:null}));
const events = Array.from({length:EVENT_COUNT},(_,i)=>({
 lead_id:`lead-${i%PROCESS_COUNT}`,event_type:'setter_activity',occurred_at:sourceAt,meeting_id:null,
 previous_status:null,new_status:'published',setter_id:M,closer_id:null,
 source_event_id:`activity-${i}`,source_kind:'custom_activity',source_updated_at:sourceAt,
 source_revision:i.toString(16).padStart(64,'0'),payload:{date_created:sourceAt,status:'published',user_id:M,custom:{result:'follow_up',fixture_padding:'x'.repeat(512)}}
}));
const relations = events.slice(0,RELATION_COUNT).map((e,i)=>({source_kind:e.source_kind,source_event_id:e.source_event_id,event_type:'setter_follow_up',occurred_at:sourceAt,
 process_id:`process-${i%PROCESS_COUNT}`,applies_to_state:true,payload:{setter_id:M,occurred_at_precision:'timestamp'}}));
const leads = processes.map(p=>({lead_id:p.lead_id,lead_source:'Cold Calling',opener_close_user_id:M,setter_id:M,closer_id:null,status_id:'status-follow-up',source_updated_at:sourceAt}));
await db.query("insert into sales_people(close_user_id,slug,display_name,color) values($1,'michael','Fixture','#fff')",[M]);
await db.query(`insert into close_activity_facts(source_activity_id,source_type,close_user_id,lead_id,occurred_at,metric_date,metric_hour,
 appointments,setter_calls,closer_calls,no_shows,cancellations,rescheduled_appointments,mapping_version)
 select 'raw-'||i,'custom_activity',$1,'lead-'||(i%$2),$3,'2026-08-10',10,
 case when i<$5 then 1 else 0 end,
 case when i>=$5 and (i-$5)%5=0 then 1 else 0 end,
 case when i>=$5 and (i-$5)%5=1 then 1 else 0 end,
 case when i>=$5 and (i-$5)%5=2 then 1 else 0 end,
 case when i>=$5 and (i-$5)%5=3 then 1 else 0 end,
 case when i>=$5 and (i-$5)%5=4 then 1 else 0 end,'test'
 from generate_series(0,$4-1) i`,[M,PROCESS_COUNT,sourceAt,RAW_COUNT,BOOKING_COUNT]);
const facts=(await db.query('select * from close_activity_facts order by source_activity_id')).rows;
const raw=facts.map(f=>({close_activity_id:f.source_activity_id,activity_type:'custom_activity',close_user_id:M,lead_id:f.lead_id,occurred_at:sourceAt,payload:{}}));
const bookings=facts.filter(f=>f.appointments===1).map(f=>({source_activity_id:f.source_activity_id,lead_id:f.lead_id,close_user_id:M,occurred_at:sourceAt,metric_date:'2026-08-10'}));
const meetings=Array.from({length:MEETING_COUNT},(_,i)=>({meeting_id:`meeting-${i}`,lead_id:`lead-${i%PROCESS_COUNT}`,owner_id:M,starts_at:'2026-09-09T08:00Z',ends_at:'2026-09-09T08:30Z',date_created:sourceAt,date_updated:sourceAt,status:'completed',participant_ids:[],calendar_event_uids:[],excluded_purpose:false,booking_activity_id:i<LINKED_COUNT?`raw-${i}`:null,booking_owner_id:i<LINKED_COUNT?M:null}));
const meetingRelations=meetings.slice(0,LINKED_COUNT).map((m,i)=>({meeting_id:m.meeting_id,process_id:`process-${i%PROCESS_COUNT}`,relation_type:'initial'}));
const performanceLeadIds=new Set(facts.map(f=>f.lead_id));
const performanceLeads=leads.filter(l=>performanceLeadIds.has(l.lead_id));
const calendarLeads=leads.slice(0,LINKED_COUNT);
await db.query(`insert into close_activity_facts(source_activity_id,source_type,close_user_id,lead_id,occurred_at,metric_date,metric_hour,calls_gross,calls_net,mapping_version)
 select 'call-'||i,'call',$1,'lead-'||(i%$2),$3,'2026-08-10',10,1,1,'test' from generate_series(0,19999) i`,[M,PROCESS_COUNT,sourceAt]);
const optimized=process.env.FUNNEL_BENCH_OPTIMIZED!=='0';
if(optimized){
 await db.exec(read('../supabase/migrations/20260908153602_stage_funnel_snapshot_inputs.sql'));
 await db.exec(read('../supabase/migrations/20260908155026_restore_complete_lead_attribution_guard.sql'));
}
const envelope=process.env.FUNNEL_BENCH_ENVELOPE==='1';
if(envelope)await db.exec(read('../supabase/migrations/20260908154243_funnel_snapshot_json_envelope.sql'));
async function sync(at, currentEvents=events) {
 const rows=[raw,facts,[],performanceLeads,bookings,meetings,calendarLeads,currentEvents,processes,meetingRelations,relations,leads];
 const args=rows.map(JSON.stringify);
 const start=performance.now();
 if(envelope){
  const keys=['p_raw','p_facts','p_opportunities','p_leads','p_bookings','p_meetings','p_calendar_leads','p_events','p_processes','p_meeting_relations','p_event_relations','p_funnel_leads'];
  const snapshot={p_start_date:'2026-07-01',p_end_date:'2026-09-10',p_snapshot_started_at:at,p_status_created_since:'2026-07-01T00:00Z',...Object.fromEntries(keys.map((key,i)=>[key,rows[i]]))};
  await db.query(`select pgrst_call.j from (select $1::json body) pgrst_payload
   cross join lateral json_to_record(pgrst_payload.body) as pgrst_args(p_snapshot jsonb)
   cross join lateral (select public.reconcile_close_funnel_payload(pgrst_args.p_snapshot) j) pgrst_call`,[JSON.stringify({p_snapshot:snapshot})]);
 } else {
 await db.query("select reconcile_close_funnel_snapshot('2026-07-01','2026-09-10',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'2026-07-01T00:00Z') j",[at,...args]);
 }
 return Math.round(performance.now()-start);
}
const firstMs=await sync('2026-09-10T11:40:00Z');
console.log(JSON.stringify({phase:'first',optimized,envelope,events:EVENT_COUNT,processes:PROCESS_COUNT,meetings:MEETING_COUNT,raw:RAW_COUNT,eventRelations:RELATION_COUNT,milliseconds:firstMs}));
const repeatMs=await sync('2026-09-10T11:41:00Z');
console.log(JSON.stringify({phase:'idempotent-repeat',events:EVENT_COUNT,processes:PROCESS_COUNT,milliseconds:repeatMs}));
assert.equal((await db.query('select count(*) n from close_funnel_events')).rows[0].n,EVENT_COUNT);
assert.equal((await db.query('select count(*) n from close_funnel_observations')).rows[0].n,EVENT_COUNT);
assert.equal((await db.query('select count(*) n from close_sales_processes where retired_at is null')).rows[0].n,PROCESS_COUNT);
assert.equal((await db.query('select count(*) n from close_process_events where removed_at is null')).rows[0].n,RELATION_COUNT);
const corrected=events.map((event,i)=>i<100?{...event,source_revision:'f'+event.source_revision.slice(1),source_updated_at:'2026-09-10T10:00:00Z',new_status:'draft'}:event);
const correctionMs=await sync('2026-09-10T11:42:00Z',corrected);
console.log(JSON.stringify({phase:'100-corrections',events:EVENT_COUNT,processes:PROCESS_COUNT,milliseconds:correctionMs}));
assert.equal((await db.query('select count(*) n from close_funnel_events where is_current')).rows[0].n,EVENT_COUNT);
assert.equal((await db.query('select count(*) n from close_funnel_events')).rows[0].n,EVENT_COUNT+Math.min(100,EVENT_COUNT));
assert.equal((await db.query('select count(*) n from close_meetings where removed_at is null')).rows[0].n,MEETING_COUNT);
assert.equal((await db.query("select count(*) n from close_activity_facts where source_type='call'")).rows[0].n,20000);
if(optimized){
 const before=(await db.query("select snapshot_started_at from close_reconciliation_state where resource='funnel'")).rows[0].snapshot_started_at;
 await assert.rejects(()=>sync('2026-09-10T11:43:00Z',[...corrected,corrected[0]]),/Invalid funnel source revisions/);
 assert.deepEqual((await db.query("select snapshot_started_at from close_reconciliation_state where resource='funnel'")).rows[0].snapshot_started_at,before);
 assert.equal((await db.query("select count(*) n from pg_class where relnamespace=pg_my_temp_schema() and relname like '_close_%'")).rows[0].n,0);
 const [old,newMeeting]=[meetings[0],meetings.at(-1)];
 newMeeting.booking_activity_id=old.booking_activity_id;newMeeting.booking_owner_id=old.booking_owner_id;
 newMeeting.lead_id=old.lead_id;old.booking_activity_id=null;old.booking_owner_id=null;
 await sync('2026-09-10T11:44:00Z',corrected);
 assert.equal((await db.query("select meeting_id from close_meetings where booking_activity_id='raw-0'")).rows[0].meeting_id,newMeeting.meeting_id);
 assert.equal((await db.query("select count(*) n from pg_class where relnamespace=pg_my_temp_schema() and relname like '_close_%'")).rows[0].n,0);
 const grants=(await db.query("select has_function_privilege('anon','reconcile_close_funnel_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz)','execute') a,has_function_privilege('authenticated','reconcile_close_calendar_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)','execute') b")).rows[0];
 assert.deepEqual(grants,{a:false,b:false});
 console.log('PASS staged inputs preserve rollback, source-link transfers, call facts and service-role-only access; temp relations disappear at commit.');
}
console.log('PASS volume snapshot keeps source/process identity and immutable corrections. PGlite/WASM timing is comparative, not a production latency guarantee.');
await db.close();
