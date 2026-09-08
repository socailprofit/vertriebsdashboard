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
const M='user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',F='user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4',A='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR';
await db.exec("insert into close_reconciliation_state values('custom_and_won','2026-09-10T11:15Z');");
const metricDate=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
async function meeting(id,at,extra={}){
 const row={meeting_id:id,lead_id:id,owner_id:M,starts_at:at,ends_at:new Date(Date.parse(at)+1800000).toISOString(),date_created:'2026-09-10T08:00:00Z',date_updated:'2026-09-10T08:00:00Z',status:'upcoming',participant_ids:[],calendar_event_uids:[],excluded_purpose:false,booking_activity_id:`booking-${id}`,booking_owner_id:F,last_seen_at:'2026-09-10T11:15Z',...extra};
 await db.query('insert into close_meetings select * from jsonb_populate_record(null::close_meetings,$1)',[JSON.stringify(row)]);return row;
}
await meeting('october','2026-10-15T08:00Z');
for(let i=0;i<7;i++)await meeting(`sep${i}`,`2026-09-${String(i+11).padStart(2,'0')}T08:00Z`);
await meeting('october2','2026-10-16T08:00Z');
await db.query("insert into close_activity_facts(source_activity_id,source_type,lead_id,close_user_id,occurred_at,metric_date,metric_hour,appointments,mapping_version) values('old-booking','custom_activity','october',$1,'2026-09-10T08:00Z','2026-09-10',10,1,'test')",[F]);
const metrics=async(start,end)=>(await db.query('select get_antony_meeting_metrics($1,$2) j',[start,end])).rows[0].j;
assert.equal((await metrics('2026-09-01','2026-09-30')).scheduled,7);
assert.equal((await metrics('2026-10-01','2026-10-31')).scheduled,2);
let closing=(await db.query("select * from get_antony_closing_metrics_internal('month','2026-09-30')")).rows[0];
assert.equal(Number(closing.appointments),7);assert.equal(Number(closing.setter_calls),0);
closing=(await db.query("select * from get_antony_closing_metrics_internal('month','2026-10-31')")).rows[0];
assert.equal(Number(closing.appointments),2);assert.equal(Number(closing.setter_calls),0);assert.equal(Number(closing.closer_calls),0);
const oct=(await db.query("select get_antony_process_metrics_internal('month','2026-10-31') j")).rows[0].j;
assert.equal(oct.funnel_by_source.reduce((s,r)=>s+r.booked_leads,0),2);
assert.equal(oct.funnel_by_source.reduce((s,r)=>s+r.setter_arrived,0),0);
console.log('PASS September creation / 7 September + 2 October appointments, future pipeline has no invented calls.');

// Inclusive end dates and UTC/Berlin boundaries, including a 25-hour DST day.
for(const [id,at] of [['start','2025-12-31T23:00:00Z'],['last','2026-02-01T22:59:59.999Z'],['before','2025-12-31T22:59:59.999Z'],['after','2026-02-01T23:00:00Z']])await meeting(id,at);
const ids=(await db.query("select meeting_id from get_setter_meetings_internal('2026-01-01','2026-02-01',false) order by meeting_id")).rows.map(r=>r.meeting_id);
assert.deepEqual(ids,['last','start']);
await meeting('dst-start','2026-10-24T22:00Z');await meeting('dst-end','2026-10-25T22:59:59Z');await meeting('dst-out','2026-10-25T23:00Z');
assert.equal((await metrics('2026-10-25','2026-10-25')).scheduled,2);
await assert.rejects(()=>metrics('2026-02-02','2026-02-01'),/Invalid meeting date range/);
console.log('PASS arbitrary inclusive date ranges, start/end/pre/post boundary and Berlin DST.');

// A custom outcome in the future cannot leak into any period or open state.
for(const [id,at] of [['observed','2026-09-10T11:14:59Z'],['after-snapshot','2026-09-10T11:16Z'],['later-today','2026-09-10T15:00Z'],['future-month','2026-10-15T08:00Z']]){
 await db.query("insert into close_activity_facts(source_activity_id,source_type,lead_id,close_user_id,occurred_at,metric_date,metric_hour,setter_calls,closer_calls,no_shows,mapping_version) values($1,'custom_activity',$1,$2,$3,$4,13,1,1,1,'test')",[id,A,at,metricDate(at)]);
 await db.query("insert into close_raw_activities(close_activity_id,activity_type,lead_id,close_user_id,occurred_at,payload) values($1,'custom_activity',$1,$2,$3,$4)",[id,A,at,JSON.stringify({'custom_activity_type_id':'actitype_7iu5gw2AEBDGBHD7Mqcz3S','custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo':'🔎 Setter Follow Up','custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz':'Nicht erschienen'})]);
 await db.query("insert into close_activity_facts(source_activity_id,source_type,lead_id,close_user_id,occurred_at,metric_date,metric_hour,no_shows,mapping_version) values($1,'custom_activity',$1,$2,$3,$4,13,1,'test')",[id+'-noshow',M,at,metricDate(at)]);
 await db.query("insert into close_raw_activities(close_activity_id,activity_type,lead_id,close_user_id,occurred_at,payload) values($1,'custom_activity',$1,$2,$3,$4)",[id+'-noshow',M,at,JSON.stringify({'custom_activity_type_id':'actitype_6dnbcILqqeo0iGpRCEjOas','custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz':'Nicht erschienen'})]);
}
await meeting('today-observed','2026-09-10T11:00Z');await meeting('today-future','2026-09-10T15:00Z');
for(const period of ['day','week','month']){
 const c=(await db.query('select * from get_antony_closing_metrics_internal($1,$2)',[period,'2026-09-10'])).rows[0];
 assert.equal(Number(c.setter_calls),1);assert.equal(Number(c.closer_calls),1);assert.equal(Number(c.appointments),1);
 const series=(await db.query('select * from get_antony_performance_series_internal($1,$2)',[period,'2026-09-10'])).rows;
 assert.equal(Number(series.at(-1).appointments_cumulative),1);
 if(period==='day')assert.equal(series.at(-1).metric_hour,13); // Berlin 13:15 snapshot, not 14:00 now or 17:00 day-end.
 const p=(await db.query('select get_antony_process_metrics_internal($1,$2) j',[period,'2026-09-10'])).rows[0].j;
 assert.equal(p.activity.setter_calls,1);assert.equal(p.activity.setter_no_shows,0); // No matched meeting: no verified No-Show.
}
assert.equal((await metrics('2026-09-10','2026-09-10')).future,1);
assert.equal((await db.query("select * from get_antony_closing_metrics_internal('month','2026-10-31')")).rows[0].setter_calls,0);
console.log('PASS exact source cutoff for calls/No-Shows/day chart; future events excluded in all performance periods.');

for(const [id,status] of [['early-cancel','⛔ Abgesagt'],['early-move','🔄 Termin verschoben']]){
 await meeting(id,'2026-09-10T11:00Z');
 await db.query("insert into close_booking_history values($1,$2,$3,'2026-09-10T08:00Z','2026-09-10')",['booking-'+id,id,F]);
 await db.query("insert into close_activity_facts(source_activity_id,source_type,lead_id,close_user_id,occurred_at,metric_date,metric_hour,cancellations,rescheduled_appointments,mapping_version) values($1,'custom_activity',$5,$2,'2026-09-10T10:00Z','2026-09-10',12,$3,$4,'test')",[id+'-outcome',M,status==='⛔ Abgesagt'?1:0,status==='🔄 Termin verschoben'?1:0,id]);
 await db.query("insert into close_raw_activities(close_activity_id,activity_type,lead_id,close_user_id,occurred_at,payload) values($1,'custom_activity',$4,$2,'2026-09-10T10:00Z',$3)",[id+'-outcome',M,JSON.stringify({'custom_activity_type_id':'actitype_6dnbcILqqeo0iGpRCEjOas','custom.cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz':status}),id]);
}
const cancelled=(await db.query("select get_antony_process_metrics_internal('day','2026-09-10') j")).rows[0].j;
assert.equal(cancelled.booking_cohort.reduce((n,r)=>n+r.cancelled,0),1);
assert.equal(cancelled.booking_cohort.reduce((n,r)=>n+r.rescheduled,0),1);
const open=(await db.query("select get_antony_pipeline_snapshot('2026-09-10') j")).rows[0].j;
assert.equal(open.counts.rescheduled_setter,1);
assert.equal(open.counts.setter_pending,1); // only today-observed, not the cancelled/rescheduled meetings.
console.log('PASS pre-meeting cancellations/reschedules remain visible and do not reopen when scheduled start passes.');

// Advancing the source clock activates already stored meetings; no new INSERT.
const nBefore=Number((await db.query('select count(*) n from close_meetings')).rows[0].n);
await db.exec("create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select '2026-10-16T12:00Z'::timestamptz$$;update close_reconciliation_state set snapshot_started_at='2026-10-16T11:00Z';");
assert.equal((await metrics('2026-10-15','2026-10-16')).elapsed,2);
assert.equal(Number((await db.query('select count(*) n from close_meetings')).rows[0].n),nBefore);
console.log('PASS future appointments activate from persisted records after a month change without re-import.');

// Execute the real atomic sync RPC: future records, updates, rollback and removal.
await db.exec("create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select '2026-09-10T12:00Z'::timestamptz$$;truncate close_meetings,close_booking_history,close_activity_facts,close_raw_activities,close_reconciliation_state,close_lead_reporting;");
await db.query("insert into close_activity_facts(source_activity_id,source_type,lead_id,close_user_id,occurred_at,metric_date,metric_hour,appointments,mapping_version) values('b','custom_activity','lead',$1,'2026-09-10T08:00Z','2026-09-10',10,1,'test')",[F]);
await db.query("insert into close_raw_activities(close_activity_id,activity_type,lead_id,close_user_id,occurred_at,payload) values('b','custom_activity','lead',$1,'2026-09-10T08:00Z','{}')",[F]);
const facts=(await db.query('select * from close_activity_facts')).rows,raw=(await db.query('select * from close_raw_activities')).rows;
const bookings=[{source_activity_id:'b',lead_id:'lead',close_user_id:F,occurred_at:'2026-09-10T08:00Z',metric_date:'2026-09-10'}];
const leads=[{lead_id:'lead',opener_close_user_id:F,lead_source:'North Data'}];
const cal={meeting_id:'persist',lead_id:'lead',owner_id:M,starts_at:'2026-10-15T08:00Z',ends_at:'2026-10-15T08:30Z',date_created:'2026-09-10T08:01Z',date_updated:'2026-09-10T08:01Z',status:'upcoming',participant_ids:[],calendar_event_uids:[],excluded_purpose:false,booking_activity_id:'b',booking_owner_id:F};
const rpc=(time,calendar=[cal],rawRows=raw,factRows=facts)=>db.query("select reconcile_close_calendar_snapshot('2026-07-01','2026-09-10',$1,$2,$3,'[]',$4,$5,$6,$7) j",[time,...[rawRows,factRows,leads,bookings,calendar,calendar.length?leads:[]].map(JSON.stringify)]);
await rpc('2026-09-10T11:59:00Z');
assert.equal((await metrics('2026-10-01','2026-10-31')).scheduled,1);
await assert.rejects(()=>rpc('2026-09-10T11:59:00Z'),/Stale reconciliation snapshot/);
const futureFact={...facts[0],source_activity_id:'future',appointments:0,setter_calls:1,occurred_at:'2026-09-10T15:00:00Z',metric_hour:17};
const futureRaw={...raw[0],close_activity_id:'future',occurred_at:'2026-09-10T15:00:00Z'};
await assert.rejects(()=>rpc('2026-09-10T11:59:01Z',[cal],[...raw,futureRaw],[...facts,futureFact]),/Future performance in snapshot/);
assert.equal((await db.query("select count(*) n from close_activity_facts where source_activity_id='future'")).rows[0].n,0);
await rpc('2026-09-10T11:59:02Z',[{...cal,starts_at:'2026-11-15T09:00Z',ends_at:'2026-11-15T09:30Z'}]);
assert.equal((await metrics('2026-10-01','2026-10-31')).scheduled,0);assert.equal((await metrics('2026-11-01','2026-11-30')).scheduled,1);
await rpc('2026-09-10T11:59:03Z',[]);
assert.equal((await db.query('select count(*) n from close_meetings')).rows[0].n,1);
assert.equal((await metrics('2026-11-01','2026-11-30')).scheduled,0);
console.log('PASS atomic calendar snapshot: persistent future records, rescheduling, removals, stale rejection, future-performance rollback.');

// Raw calendar rows and internal functions remain inaccessible to browser roles.
const priv=(await db.query("select has_table_privilege('anon','close_meetings','select') a,has_table_privilege('authenticated','close_meetings','select') b,has_function_privilege('authenticated','get_antony_activity_facts_internal(date)','execute') c")).rows[0];
assert.deepEqual(priv,{a:false,b:false,c:false});
await db.exec('create or replace function has_antony_access() returns boolean language sql as $$select false$$;');
await assert.rejects(()=>metrics('2026-09-01','2026-09-30'),/Nicht berechtigt/);
await db.close();
console.log('PASS calendar privacy and leadership-only range endpoint.');
