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
await db.exec(read('../supabase/migrations/20260908153602_stage_funnel_snapshot_inputs.sql'));
if(process.env.FUNNEL_TEST_BROKEN_GUARD!=='1')await db.exec(read('../supabase/migrations/20260908155026_restore_complete_lead_attribution_guard.sql'));
const M='user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy';
const row={lead_id:'lead',event_type:'setter_activity',occurred_at:'2026-08-10T08:00:00Z',meeting_id:null,previous_status:null,new_status:'published',setter_id:M,closer_id:null,source_event_id:'activity',source_kind:'custom_activity',source_updated_at:'2026-08-10T08:01:00Z',source_revision:'a'.repeat(64),payload:{date_created:'2026-08-10T08:00:00Z',status:'published'}};
const args=[[],[],[],[],[],[],[],[row],[],[],[],[]];
async function sync(at,events=[row],extra={}){
 const values=[...args];values[7]=events;
 for(const [i,v] of Object.entries(extra))values[Number(i)]=v;
 return db.query("select reconcile_close_funnel_snapshot('2026-07-01','2026-09-10',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'2026-07-01T00:00Z') j",[at,...values.map(JSON.stringify)]);
}
await sync('2026-09-10T11:40:00Z');
await sync('2026-09-10T11:41:00Z');
assert.equal((await db.query('select count(*) n from close_funnel_events')).rows[0].n,1);
assert.equal((await db.query('select count(*) n from close_funnel_observations')).rows[0].n,1);
const corrected={...row,source_revision:'b'.repeat(64),source_updated_at:'2026-09-10T09:00:00Z',new_status:'draft',payload:{...row.payload,status:'draft'}};
await sync('2026-09-10T11:42:00Z',[corrected]);
assert.equal((await db.query('select count(*) n from close_funnel_events')).rows[0].n,2);
assert.equal((await db.query("select source_revision from close_funnel_events where is_current")).rows[0].source_revision,corrected.source_revision);
await sync('2026-09-10T11:43:00Z',[]);
assert.equal((await db.query('select count(*) n from close_funnel_events where is_current')).rows[0].n,0);
assert.equal((await db.query('select count(*) n from close_funnel_events')).rows[0].n,2);
await sync('2026-09-10T11:44:00Z',[row]);
assert.equal((await db.query('select count(*) n from close_funnel_events')).rows[0].n,2);
assert.equal((await db.query('select count(*) n from close_funnel_observations')).rows[0].n,4);
console.log('PASS source-ID idempotency, immutable correction/withdrawal/reactivation observations.');
const oldStatus={...row,source_kind:'lead_status_change',event_type:'lead_status_changed',source_event_id:'old-status',occurred_at:'2026-06-01T08:00:00Z',payload:{date_created:'2026-06-01T08:00:00Z'}};
await sync('2026-09-10T11:45:00Z',[row,oldStatus]);
await sync('2026-09-10T11:46:00Z',[row]);
assert.equal((await db.query("select is_current from close_funnel_events where source_event_id='old-status'")).rows[0].is_current,true);
const before=(await db.query("select snapshot_started_at from close_reconciliation_state where resource='funnel'")).rows[0].snapshot_started_at;
await assert.rejects(()=>sync('2026-09-10T11:47:00Z',[{...row,lead_id:null}]),/Invalid funnel source revisions/);
assert.deepEqual((await db.query("select snapshot_started_at from close_reconciliation_state where resource='funnel'")).rows[0].snapshot_started_at,before);
console.log('PASS bounded status coverage preserves older history; invalid history rolls back the entire calendar transaction.');
const priv=(await db.query("select has_table_privilege('anon','close_funnel_events','select') a,has_table_privilege('authenticated','close_sales_processes','select') b,has_table_privilege('authenticated','close_process_events','select') c")).rows[0];
assert.deepEqual(priv,{a:false,b:false,c:false});
console.log('PASS private history/process tables are not accessible to browser roles.');
// Each metric independently requires attribution, including leads with ONLY a
// Closer/attendance outcome and no appointment/Setter fact in this window.
const counterKinds=['setter_calls','appointments','closer_calls','no_shows','cancellations','rescheduled_appointments'];
for(const [i,counter] of counterKinds.entries()){
 const activityId=`only-${counter}`,leadId=`lead-${counter}`,at=`2026-09-10T11:${47+i}:00Z`;
 await db.query(`insert into close_activity_facts(source_activity_id,source_type,close_user_id,lead_id,occurred_at,metric_date,metric_hour,mapping_version,${counter})
 values($1,'custom_activity',$2,$3,'2026-08-10T08:00Z','2026-08-10',10,'test',1)`,[activityId,M,leadId]);
 const fact=(await db.query('select * from close_activity_facts where source_activity_id=$1',[activityId])).rows[0];
 await db.query('delete from close_activity_facts where source_activity_id=$1',[activityId]);
 const raw={close_activity_id:activityId,activity_type:'custom_activity',lead_id:leadId,close_user_id:M,occurred_at:'2026-08-10T08:00Z',payload:{}};
 const leads=[{lead_id:leadId,opener_close_user_id:M,lead_source:'Cold Calling'}];
 const bookings=counter==='appointments'?[{source_activity_id:activityId,lead_id:leadId,close_user_id:M,occurred_at:'2026-08-10T08:00Z',metric_date:'2026-08-10'}]:[];
 const payload={0:[raw],1:[fact],3:leads,4:bookings};
 await sync(at,[row],payload);
 const state=(await db.query("select snapshot_started_at from close_reconciliation_state where resource='funnel'")).rows[0].snapshot_started_at;
 const later=new Date(Date.parse(at)+1000).toISOString();
 await assert.rejects(()=>sync(later,[row],{...payload,3:[]}),/Incomplete lead attribution snapshot/);
 await assert.rejects(()=>sync(later,[row],{...payload,3:[...leads,{...leads[0],lead_id:'unrelated'}]}),/Incomplete lead attribution snapshot/);
 assert.deepEqual((await db.query("select snapshot_started_at from close_reconciliation_state where resource='funnel'")).rows[0].snapshot_started_at,state);
 assert.equal((await db.query('select lead_id from close_lead_reporting where lead_id=$1',[leadId])).rows[0].lead_id,leadId);
}
console.log('PASS all six independent sales/attendance facts require their exact lead attribution; missing/extra leads roll back.');
await db.exec(read('../supabase/migrations/20260909060453_allow_funnel_task_source.sql'));
const task={...row,source_kind:'task',source_event_id:'task-followup',event_type:'task_state',new_status:'open',
 payload:{task_type:'lead',assigned_to:'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR',is_complete:false,purpose_code:'follow_up',date_created:'2026-08-10T08:00Z'}};
await sync('2026-09-10T11:54:00Z',[row,task]);
await assert.rejects(()=>db.query("select confirm_close_task_snapshot('2026-09-10T11:53:00Z',1)"),/no longer matches/);
await assert.rejects(()=>db.query("select confirm_close_task_snapshot('2026-09-10T11:54:00Z',0)"),/Incomplete/);
await db.query("select confirm_close_task_snapshot('2026-09-10T11:54:00Z',1)");
await sync('2026-09-10T11:55:00Z',[row]);
assert.equal((await db.query("select is_current from close_funnel_events where source_kind='task'")).rows[0].is_current,false);
assert.equal((await db.query("select (select snapshot_started_at from close_reconciliation_state where resource='antony_tasks')=(select snapshot_started_at from close_reconciliation_state where resource='funnel') same")).rows[0].same,false);
await db.query("select confirm_close_task_snapshot('2026-09-10T11:55:00Z',0)");
assert.equal((await db.query("select has_function_privilege('authenticated','confirm_close_task_snapshot(timestamptz,integer)','execute') allowed")).rows[0].allowed,false);
console.log('PASS task source coverage, stale/count guards, withdrawn tasks, empty complete snapshot and browser denial.');
await db.close();
