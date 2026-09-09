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
await db.exec(read('../supabase/migrations/20260908154243_funnel_snapshot_json_envelope.sql'));
await db.exec(read('../supabase/migrations/20260908155026_restore_complete_lead_attribution_guard.sql'));
const M='user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy';
const row={lead_id:'lead',event_type:'setter_activity',occurred_at:'2026-08-10T08:00:00Z',meeting_id:null,previous_status:null,new_status:'published',setter_id:M,closer_id:null,source_event_id:'activity',source_kind:'custom_activity',source_updated_at:'2026-08-10T08:01:00Z',source_revision:'a'.repeat(64),payload:{date_created:'2026-08-10T08:00:00Z',status:'published'}};
const args=[[],[],[],[],[],[],[],[row],[],[],[],[]];
async function sync(at,events=[row],extra={}){
 const values=[...args];values[7]=events;
 for(const [i,v] of Object.entries(extra))values[Number(i)]=v;
 const keys=['p_raw','p_facts','p_opportunities','p_leads','p_bookings','p_meetings','p_calendar_leads','p_events','p_processes','p_meeting_relations','p_event_relations','p_funnel_leads'];
 const envelope={p_start_date:'2026-07-01',p_end_date:'2026-09-10',p_snapshot_started_at:at,p_status_created_since:'2026-07-01T00:00Z',...Object.fromEntries(keys.map((key,i)=>[key,values[i]]))};
 // PostgREST-shaped outer JSON decode plus lateral function invocation: exactly
 // one argument is projected, and the 16 existing fields are decoded inside.
 return db.query(`select pgrst_call.j from (select $1::json body) pgrst_payload
 cross join lateral json_to_record(pgrst_payload.body) as pgrst_args(p_snapshot jsonb)
 cross join lateral (select public.reconcile_close_funnel_payload(pgrst_args.p_snapshot) j) pgrst_call`,[JSON.stringify({p_snapshot:envelope})]);
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
for(const invalid of [null,[],{}, {unexpected:[]}]){
 await assert.rejects(()=>db.query('select reconcile_close_funnel_payload($1)',[JSON.stringify(invalid)]),/Invalid funnel envelope/);
}
const access=(await db.query("select has_function_privilege('anon','reconcile_close_funnel_payload(jsonb)','execute') a,has_function_privilege('authenticated','reconcile_close_funnel_payload(jsonb)','execute') b,has_function_privilege('service_role','reconcile_close_funnel_payload(jsonb)','execute') c")).rows[0];
assert.deepEqual(access,{a:false,b:false,c:true});
await assert.rejects(()=>sync('2026-09-10T11:46:00Z'),/Stale reconciliation snapshot/);
console.log('PASS one-field REST envelope, strict shape, service-role-only access and unchanged stale-snapshot rejection.');
await db.close();
