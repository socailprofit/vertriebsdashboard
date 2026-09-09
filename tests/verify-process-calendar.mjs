import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {deriveCloseProcesses} from '../supabase/functions/_shared/close-processes.ts';
import {prepareFunnelEventSnapshot,toProcessEvents} from '../supabase/functions/_shared/close-funnel-events.ts';
import {prepareCustomReconciliation} from '../supabase/functions/_shared/close-reconciliation.ts';
import {ACTIVITY_TYPES,CUSTOM_FIELDS,CLOSE_USERS,metricTimeInReportingTimezone} from '../supabase/functions/_shared/close-mapping.ts';

const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema extensions;create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
create schema auth;create function auth.uid() returns uuid language sql as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;
create function has_dashboard_access() returns boolean language sql as $$select true$$;
create function has_antony_access() returns boolean language sql as $$select true$$;
create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select '2026-09-15T12:00:00Z'::timestamptz$$;`);
await db.exec(read('fixtures/kpi-schema.sql'));
await db.exec('create table antony_performance_goals(id integer);');
for(const m of ['20260907121749_normalize_transfer_opportunities','20260908071339_reconcile_antony_kpis','20260908071341_add_antony_process_metrics',
 '20260908071707_fix_lead_snapshot_delete_guard','20260908082307_audit_complete_sales_journey','20260908085704_fix_booking_cohort_filters',
 '20260908093505_optimize_cohort_report_plan','20260908124152_store_calendar_meetings','20260908124321_calendar_snapshot_safe_update',
 '20260908124714_use_meeting_time_for_antony','20260908125538_retain_pre_meeting_cancellations','20260908131505_setter_meeting_attendance',
 '20260908132556_calendar_reconciliation_execution','20260908145135_lead_funnel_event_history','20260908145158_process_calendar_replacements'])
 await db.exec(read('../supabase/migrations/'+m+'.sql'));

// Exercise the actual new metadata schema and reconciliation against this import fixture.
// Reporting functions are covered with their full dependency chain in verify-process-reporting.
await db.exec(read('../supabase/migrations/20260909105717_clarify_antony_reporting.sql').split('create or replace function public.get_reporting_calendar_internal')[0]+'commit;');

const F=CLOSE_USERS.felix,A=CLOSE_USERS.antony;
const asOf='2026-09-15T11:45:00Z';
function custom(id,lead,at,type,fields,user=A) {
 return {id,lead_id:lead,user_id:user,activity_at:at,date_created:at,date_updated:at,status:'published',custom_activity_type_id:type,
  ...Object.fromEntries(Object.entries(fields).map(([k,v])=>[`custom.${k}`,v]))};
}
const customRecords=[
 custom('new-booking','replacement-lead','2026-08-15T08:00:00Z',ACTIVITY_TYPES.openingCall,{[CUSTOM_FIELDS.openingDecisionMakerResult]:'Entscheider: Termin vereinbart'},F),
 custom('old-booking','repeat-lead','2026-08-01T08:00:00Z',ACTIVITY_TYPES.openingCall,{[CUSTOM_FIELDS.openingDecisionMakerResult]:'Entscheider: Termin vereinbart'},F),
 custom('repeat-booking','repeat-lead','2026-09-01T08:00:00Z',ACTIVITY_TYPES.followUp,{[CUSTOM_FIELDS.followUpDecisionMakerResult]:'Entscheider: Termin vereinbart'},F),
 custom('old-cancel','replacement-lead','2026-09-10T07:00:00Z',ACTIVITY_TYPES.noShow,{[CUSTOM_FIELDS.setterNoShow]:'⛔ Abgesagt'}),
 custom('actual-august','repeat-lead','2026-08-20T08:30:00Z',ACTIVITY_TYPES.setterCall,{[CUSTOM_FIELDS.setterResult]:'🔎 Setter Follow Up'}),
 custom('actual-september','repeat-lead','2026-09-05T08:30:00Z',ACTIVITY_TYPES.setterCall,{[CUSTOM_FIELDS.setterResult]:'🔎 Setter Follow Up'}),
];
function meeting(id,lead,at,bookingId,extra={}) {
 return {meeting_id:id,lead_id:lead,contact_id:null,owner_id:A,starts_at:at,ends_at:new Date(Date.parse(at)+3600000).toISOString(),
  date_created:'2026-08-15T08:05:00Z',date_updated:'2026-08-15T08:05:00Z',status:'completed',participant_ids:[],calendar_event_uids:[],
  excluded_purpose:false,booking_activity_id:bookingId,booking_owner_id:bookingId?F:null,...extra};
}
const meetings=[
 meeting('cancelled-original','replacement-lead','2026-09-10T08:00:00Z','new-booking',{status:'canceled',date_updated:'2026-09-10T07:00:00Z'}),
 meeting('october-replacement','replacement-lead','2026-10-15T08:00:00Z',null,{status:'upcoming',date_created:'2026-09-11T07:00:00Z',date_updated:'2026-09-11T07:00:00Z'}),
 meeting('august-setter','repeat-lead','2026-08-20T08:00:00Z','old-booking'),
 meeting('september-followup','repeat-lead','2026-09-05T08:00:00Z','repeat-booking',{date_created:'2026-09-01T08:05:00Z',date_updated:'2026-09-01T08:05:00Z'}),
];
const c=prepareCustomReconciliation(customRecords,'2026-07-01','2026-09-15',asOf);
const events=await prepareFunnelEventSnapshot({customRecords,meetings,statusChanges:[],opportunities:[],dataAsOf:asOf});
const flow=deriveCloseProcesses({meetings,bookings:c.bookings,events:toProcessEvents(events,asOf),dataAsOf:asOf});
assert.equal(flow.processes.length,2);assert.equal(flow.diagnostics.replacements,1);
const facts=c.facts.map(f=>({...Object.fromEntries(Object.entries(f).map(([k,v])=>[k.replace(/[A-Z]/g,l=>'_'+l.toLowerCase()),v])),
 metric_date:metricTimeInReportingTimezone(f.occurredAt).metricDate,metric_hour:metricTimeInReportingTimezone(f.occurredAt).metricHour,mapped_at:asOf}));
const raw=c.raw.map(r=>({close_activity_id:r.id,activity_type:'custom_activity',lead_id:r.lead_id,close_user_id:r.user_id,occurred_at:r.activity_at,payload:r}));
const leads=['replacement-lead','repeat-lead'].map(lead_id=>({lead_id,lead_source:'Cold Calling',opener_close_user_id:F}));
const funnelLeads=leads.map(l=>({...l,display_name:"Regular Close name",setter_id:A,closer_id:A}));
const rpc=(at,overrides={})=>{
 const rows={raw,facts,opportunities:[],leads,bookings:c.bookings,meetings,calendarLeads:leads,events,processes:flow.processes,
  meetingRelations:flow.meetingRelations,eventRelations:flow.eventRelations,funnelLeads,...overrides};
 return db.query(`select reconcile_close_funnel_snapshot('2026-07-01','2026-09-15',$1,
 $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'2026-07-01T00:00:00Z') j`,[at,...Object.values(rows).map(JSON.stringify)]);
};
const metrics=async(start,end)=>(await db.query('select get_antony_meeting_metrics($1,$2) j',[start,end])).rows[0].j;
const count=async table=>Number((await db.query(`select count(*) n from ${table}`)).rows[0].n);
await rpc(asOf);
assert.equal((await db.query("select display_name from close_funnel_leads limit 1")).rows[0].display_name,"Regular Close name");
assert.equal((await metrics('2026-09-01','2026-09-30')).scheduled,1);
assert.equal((await metrics('2026-09-01','2026-09-30')).cancelled,0);
assert.equal((await metrics('2026-09-01','2026-09-30')).attended,1);
assert.equal((await metrics('2026-08-01','2026-08-31')).attended,1);
assert.equal((await metrics('2026-10-01','2026-10-31')).scheduled,1);
assert.equal((await metrics('2026-10-01','2026-10-31')).future,1);
const inherited=(await db.query("select booking_activity_id,booking_owner_id from get_setter_meetings_internal('2026-10-01','2026-10-31',false)")).rows[0];
assert.deepEqual(inherited,{booking_activity_id:'new-booking',booking_owner_id:F});
assert.equal((await db.query("select booking_activity_id from close_meetings where meeting_id='october-replacement'")).rows[0].booking_activity_id,null);
assert.equal((await db.query("select booking_activity_id from close_meetings where meeting_id='cancelled-original'")).rows[0].booking_activity_id,'new-booking');
assert.equal(flow.meetingRelations.filter(r=>r.counts_as_setting_success).length,2);
assert.equal(flow.processes.find(p=>p.lead_id==='replacement-lead').first_meeting_at,'2026-10-15T08:00:00Z');
console.log('PASS real source normalizer → deterministic processes → atomic RPC → effective calendar; raw unique links preserved.');

// Repeating the same source snapshot updates observation time, not event or
// process cardinality. An invalid follow-up transaction rolls back completely.
const tables=['close_funnel_events','close_funnel_observations','close_sales_processes','close_process_meetings','close_process_events'];
const sizes=await Promise.all(tables.map(count));
await rpc('2026-09-15T11:46:00Z');
assert.deepEqual(await Promise.all(tables.map(count)),sizes);
await assert.rejects(()=>rpc('2026-09-15T11:47:00Z',{events:[{...events[0],source_revision:'bad'}]}),/Invalid funnel source revisions/);
assert.deepEqual(await Promise.all(tables.map(count)),sizes);
assert.equal((await db.query("select snapshot_started_at::text at from close_reconciliation_state where resource='funnel'")).rows[0].at,'2026-09-15 11:46:00+00');
assert.equal((await metrics('2026-09-01','2026-09-30')).scheduled,1);
console.log('PASS repeated full sync idempotency and all-or-nothing rollback of invalid history.');

// Actual August and September conversations remain their own activity counts;
// a repeated appointment is calendar workload, not another acquired process.
for(const [period,end] of [['month','2026-08-31'],['month','2026-09-15']]) {
 const c=(await db.query('select * from get_antony_closing_metrics_internal($1,$2)',[period,end])).rows[0];
 assert.equal(Number(c.setter_calls),1);assert.equal(Number(c.appointments),1);
}
for(const period of ['day','week','month','three_months']) {
 const p=(await db.query('select get_antony_process_metrics_internal($1,$2) j',[period,'2026-09-15'])).rows[0].j;
 assert.equal(p.activity.setter_no_shows,0);assert.equal(p.activity.setter_cancellations,0);
}
console.log('PASS old-lead follow-up remains actual September work without a second initial setting success.');

// Month rollover changes only the source clock. October already has its slot;
// the old September cancellation cannot be reassigned to that replacement.
const beforeCalendar=await count('close_meetings');
await db.exec("create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select '2026-10-15T12:00:00Z'::timestamptz$$;update close_reconciliation_state set snapshot_started_at='2026-10-15T11:00:00Z' where resource in ('custom_and_won','calendar','funnel');");
let october=await metrics('2026-10-01','2026-10-31');
assert.equal(october.elapsed,1);assert.equal(october.future,0);assert.equal(october.cancelled,0);assert.equal(october.no_show,0);assert.equal(october.unknown,1);
assert.equal(await count('close_meetings'),beforeCalendar);
assert.equal((await db.query("select count(*) n from get_setter_meeting_evidence_internal('2026-10-31') where source_activity_id='old-cancel'")).rows[0].n,0);
console.log('PASS next-month slot activation without re-import; superseded cancellation stays historical.');

// The durable source journal remains valid evidence after raw retention. A
// withdrawn current object must not revive via an old retained fact row.
await db.exec("update close_process_meetings set payload=jsonb_set(payload,'{relation_type}','\"ambiguous\"') where meeting_id='august-setter';");
assert.equal((await metrics('2026-08-01','2026-08-31')).attended,1); // Ambiguous relation does not erase an independently proven actual occurrence.
await db.exec("delete from close_activity_facts where source_activity_id='actual-august';delete from close_raw_activities where close_activity_id='actual-august';");
assert.equal((await metrics('2026-08-01','2026-08-31')).attended,1);
await db.exec("update close_funnel_events set is_current=false,withdrawn_at='2026-10-15T11:00:00Z' where source_event_id='actual-september';");
assert.equal((await metrics('2026-09-01','2026-09-30')).attended,0);
assert.equal((await db.query("select count(*) n from close_activity_facts where source_activity_id='actual-september'")).rows[0].n,1);
console.log('PASS durable attendance beyond raw retention; withdrawn source proof never resurrects from stale raw facts.');

const perms=(await db.query("select has_function_privilege('authenticated','get_setter_meetings_internal(date,date,boolean)','execute') calendar,has_function_privilege('anon','get_setter_meeting_evidence_internal(date)','execute') evidence,has_table_privilege('authenticated','close_process_meetings','select') relations")).rows[0];
assert.deepEqual(perms,{calendar:false,evidence:false,relations:false});
await db.exec('create or replace function has_antony_access() returns boolean language sql as $$select false$$;');
await assert.rejects(()=>metrics('2026-09-01','2026-09-30'),/Nicht berechtigt/);
await db.close();console.log('PASS private process/calendar evidence and unchanged leadership authorization.');
