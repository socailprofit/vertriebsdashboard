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
const M='user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',F='user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4';
const setterField='custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz',closerField='custom.cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q';
await db.exec("insert into close_reconciliation_state values('custom_and_won','2026-09-10T11:15Z');");
async function meeting(id,at,extra={}) {
 const row={meeting_id:id,lead_id:id,owner_id:M,starts_at:at,ends_at:new Date(Date.parse(at)+1800000).toISOString(),date_created:'2026-08-01T08:00Z',date_updated:'2026-08-01T08:00Z',status:'completed',participant_ids:[],calendar_event_uids:[],excluded_purpose:false,booking_activity_id:`booking-${id}`,booking_owner_id:F,last_seen_at:'2026-09-10T11:15Z',...extra};
 await db.query('insert into close_meetings select * from jsonb_populate_record(null::close_meetings,$1)',[JSON.stringify(row)]);
 await db.query('insert into close_booking_history values($1,$2,$3,$4,$5)',[row.booking_activity_id,row.lead_id,F,'2026-08-01T08:00Z','2026-08-01']);
 return row;
}
async function fact(id,lead,at,kind,other={}) {
 const isCall=kind==='attended';
 const payload={custom_activity_type_id:isCall?'actitype_7iu5gw2AEBDGBHD7Mqcz3S':'actitype_6dnbcILqqeo0iGpRCEjOas',...(isCall?{'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo':'🔎 Setter Follow Up'}:{[setterField]:kind}),...other};
 await db.query("insert into close_activity_facts(source_activity_id,source_type,lead_id,close_user_id,occurred_at,metric_date,metric_hour,setter_calls,no_shows,cancellations,rescheduled_appointments,mapping_version) values($1,'custom_activity',$2,$3,$4,($4::timestamptz at time zone 'Europe/Berlin')::date,extract(hour from $4::timestamptz at time zone 'Europe/Berlin'),$5,$6,$7,$8,'test')",[id,lead,M,at,isCall?1:0,kind==='Nicht erschienen'?1:0,kind==='⛔ Abgesagt'?1:0,kind==='🔄 Termin verschoben'?1:0]);
 await db.query("insert into close_raw_activities(close_activity_id,activity_type,lead_id,close_user_id,occurred_at,payload) values($1,'custom_activity',$2,$3,$4,$5)",[id,lead,M,at,JSON.stringify(payload)]);
}
const metrics=async(start,end)=>(await db.query('select get_antony_meeting_metrics($1,$2) j',[start,end])).rows[0].j;
const processMetrics=async(period='month',date='2026-09-10')=>(await db.query('select get_antony_process_metrics_internal($1,$2) j',[period,date])).rows[0].j;

// Same-period scheduled denominator, regardless of earlier booking month.
await meeting('show','2026-09-10T09:00Z');
await fact('show1','show','2026-09-10T09:20Z','attended');await fact('show2','show','2026-09-10T10:00Z','attended');
await meeting('missing','2026-09-10T10:00Z'); // completed + no proof is NOT attendance or No-Show.
await meeting('no-show','2026-09-10T08:00Z');await fact('ns','no-show','2026-09-10T08:01Z','Nicht erschienen');
await meeting('cancelled','2026-09-10T10:30Z');await fact('cancel','cancelled','2026-09-09T08:00Z','⛔ Abgesagt');
await meeting('future-today','2026-09-10T13:00Z',{status:'declined-by-lead'});
await fact('early-ns','future-today','2026-09-10T09:00Z','Nicht erschienen');
await meeting('october','2026-10-01T08:00Z',{status:'canceled'});await fact('early-cancel','october','2026-09-10T08:00Z','⛔ Abgesagt');
let m=await metrics('2026-09-01','2026-09-30');
assert.deepEqual(Object.fromEntries(['scheduled','elapsed','future','attended','no_show','cancelled','unknown','show_rate'].map(k=>[k,m[k]])),{scheduled:5,elapsed:4,future:1,attended:1,no_show:1,cancelled:1,unknown:1,show_rate:25});
assert.equal((await metrics('2026-10-01','2026-10-31')).future,1);
assert.equal((await metrics('2026-10-01','2026-10-31')).show_rate,null);
assert.equal((await metrics('2026-10-01','2026-10-31')).cancelled,0);
for(const period of ['day','week','month','three_months']) {
 const p=await processMetrics(period);
 assert.equal(p.activity.setter_no_shows,1);assert.equal(p.setter_attendance.no_show,1);
 assert.equal(p.setter_attendance.attended,1);
 assert.equal(p.activity.setter_calls,2); // Actual calls stay separate from meeting attendance.
}
const future=await processMetrics('month','2026-10-31');
assert.equal(future.booking_cohort.reduce((n,r)=>n+r.pending+r.no_show+r.cancelled+r.rescheduled,0),0);
assert.equal(future.booking_cohort.reduce((n,r)=>n+r.future,0),1);
console.log('PASS scheduled denominator, duplicate actual proofs, future negative statuses, all reporting periods, unknown is not No-Show.');

// A later-month conversation is not proof for a previous-month appointment.
await meeting('prior-month','2026-08-31T08:00Z');await fact('later-call','prior-month','2026-09-01T08:20Z','attended');
assert.equal((await metrics('2026-08-01','2026-08-31')).attended,0);
assert.equal((await metrics('2026-09-01','2026-09-30')).attended,1);
// Same lead with two slots: one proof only reaches its own occurrence.
await meeting('slot-a','2026-09-09T08:00Z',{lead_id:'repeat'});await meeting('slot-b','2026-09-09T10:00Z',{lead_id:'repeat'});
await fact('repeat-proof','repeat','2026-09-09T10:15Z','attended');
assert.equal((await metrics('2026-09-09','2026-09-09')).attended,1);
await meeting('amb-a','2026-09-08T08:00Z',{lead_id:'amb'});await meeting('amb-b','2026-09-08T08:00Z',{lead_id:'amb'});
await fact('ambiguous-proof','amb','2026-09-08T08:30Z','attended');
assert.equal((await metrics('2026-09-08','2026-09-08')).attended,0);
console.log('PASS no cross-month borrowed attendance, unique occurrence matching and ambiguous simultaneous slots withheld.');

// An identical ID reschedules across months: old No-Show survives only as raw history.
await meeting('move','2026-09-10T08:00Z');await fact('old-ns','move','2026-09-10T08:05Z','Nicht erschienen');
assert.equal((await metrics('2026-09-10','2026-09-10')).no_show,2);
await db.query("update close_meetings set starts_at='2026-10-12T08:00Z',ends_at='2026-10-12T08:30Z',date_updated='2026-09-10T09:00Z' where meeting_id='move'");
assert.equal((await metrics('2026-09-10','2026-09-10')).no_show,1);
assert.equal((await metrics('2026-10-01','2026-10-31')).scheduled,2);
assert.equal((await metrics('2026-10-01','2026-10-31')).no_show,0);
assert.equal((await db.query("select count(*) n from close_raw_activities where close_activity_id='old-ns'")).rows[0].n,1);
assert.equal((await db.query("select count(*) n from close_meeting_time_history where meeting_id='move'")).rows[0].n,1);
await db.query("update close_meetings set status='upcoming' where meeting_id='move'");
assert.equal((await db.query("select count(*) n from close_meeting_time_history where meeting_id='move'")).rows[0].n,1);
for(const period of ['day','week','month','three_months'])assert.equal((await processMetrics(period)).activity.setter_no_shows,1);
const open=(await db.query("select get_antony_pipeline_snapshot('2026-09-10') j")).rows[0].j;
assert.equal(open.counts.setter_no_show,1);
// A move to an earlier time on the same day must not revive the old No-Show.
await db.query("update close_meetings set starts_at='2026-09-10T07:00Z',ends_at='2026-09-10T07:30Z',date_updated='2026-09-10T10:00Z' where meeting_id='move'");
assert.equal((await metrics('2026-09-10','2026-09-10')).no_show,1);
await fact('new-show','move','2026-09-10T10:15Z','attended');
assert.equal((await metrics('2026-09-10','2026-09-10')).attended,2);
console.log('PASS month/same-day reschedules, old negative proof suppression, traceable revisions and new-slot attendance.');

// Exact source cutoff, including future within today's already elapsed clock hour.
await meeting('after-source','2026-09-10T11:16Z');await fact('unobserved','after-source','2026-09-10T11:17Z','Nicht erschienen');
assert.equal((await metrics('2026-09-10','2026-09-10')).future,2);
await meeting('exact-source','2026-09-10T11:15Z');await fact('exact-proof','exact-source','2026-09-10T11:15Z','attended');
assert.equal((await metrics('2026-09-10','2026-09-10')).attended,3);
// Jan 1-Feb 1 is inclusive, with Berlin midnight as the boundary.
for(const [id,at] of [['range-start','2025-12-31T23:00Z'],['range-last','2026-02-01T22:59:59Z'],['range-before','2025-12-31T22:59:59Z'],['range-after','2026-02-01T23:00Z']])await meeting(id,at);
assert.equal((await metrics('2026-01-01','2026-02-01')).scheduled,2);
await assert.rejects(()=>metrics('2026-02-02','2026-02-01'),/Invalid meeting date range/);
console.log('PASS exact current-data cutoff and inclusive custom-range calendar boundaries.');

const permissions=(await db.query("select has_table_privilege('authenticated','close_meeting_time_history','select') history,has_function_privilege('authenticated','get_setter_meeting_evidence_internal(date)','execute') evidence,has_function_privilege('anon','get_antony_meeting_metrics(date,date)','execute') api")).rows[0];
assert.deepEqual(permissions,{history:false,evidence:false,api:false});
await db.exec('create or replace function has_antony_access() returns boolean language sql as $$select false$$;');
await assert.rejects(()=>metrics('2026-09-01','2026-09-30'),/Nicht berechtigt/);
await db.close();console.log('PASS private revision/evidence storage and leadership-only aggregate API.');
