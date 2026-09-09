import { ACTIVITY_TYPES, CLOSE_USERS, CUSTOM_FIELDS } from '../supabase/functions/_shared/close-mapping.ts';
import { prepareFunnelEventSnapshot, toProcessEvents } from '../supabase/functions/_shared/close-funnel-events.ts';
import { prepareCustomReconciliation } from '../supabase/functions/_shared/close-reconciliation.ts';
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
await db.exec(read('../supabase/migrations/20260908155026_restore_complete_lead_attribution_guard.sql'));
await db.exec(read('../supabase/migrations/20260908154243_funnel_snapshot_json_envelope.sql'));
await db.exec(read('../supabase/migrations/20260908160718_retained_funnel_booking_sources.sql'));

const markerIds=async()=>new Set((await db.query('select * from get_close_funnel_booking_source_ids()')).rows.map(r=>r.source_event_id));
const source=(id,type,result,status='published')=>({id,lead_id:'lead-'+id,user_id:CLOSE_USERS.antony,
 activity_at:'2026-02-10T09:00:00Z',date_created:'2026-02-10T09:00:00Z',date_updated:'2026-02-10T09:00:00Z',custom_activity_type_id:type,status,
 ['custom.'+(type===ACTIVITY_TYPES.openingCall?CUSTOM_FIELDS.openingDecisionMakerResult:CUSTOM_FIELDS.followUpDecisionMakerResult)]:result});
const bookingA=source('booking-a',ACTIVITY_TYPES.openingCall,'Entscheider: Termin vereinbart');
const bookingB=source('booking-b',ACTIVITY_TYPES.followUp,'4: ✅ Termin vereinbart');
const unrelated=source('unrelated',ACTIVITY_TYPES.openingCall,'Entscheider: Follow Up');
const neverPublished=source('never-published',ACTIVITY_TYPES.followUp,'Entscheider: Termin vereinbart','draft');
async function sync(at,records){
 const markers=await markerIds();
 const events=await prepareFunnelEventSnapshot({customRecords:records,meetings:[],statusChanges:[],opportunities:[],dataAsOf:at,historicalBookingSourceIds:markers});
 const reconciled=prepareCustomReconciliation(records,'2026-07-01','2026-09-10',at);
 assert.equal(reconciled.raw.length,0);assert.equal(reconciled.facts.length,0); // all historical, no retained KPI rewrite
 const snapshot={p_start_date:'2026-07-01',p_end_date:'2026-09-10',p_snapshot_started_at:at,p_status_created_since:'2026-07-01T00:00:00Z',
 p_raw:[],p_facts:[],p_opportunities:[],p_leads:[],p_bookings:reconciled.bookings,p_meetings:[],p_calendar_leads:[],
 p_events:events,p_processes:[],p_meeting_relations:[],p_event_relations:[],p_funnel_leads:[]};
 await db.query('select reconcile_close_funnel_payload($1)',[JSON.stringify(snapshot)]);
 return events;
}
let events=await sync('2026-09-10T11:40:00Z',[bookingA,bookingB,unrelated,neverPublished]);
assert.equal(events.length,2);assert.deepEqual([...await markerIds()],['booking-a','booking-b']);
const corrected={...bookingA,['custom.'+CUSTOM_FIELDS.openingDecisionMakerResult]:'Entscheider: Follow Up',date_updated:'2026-09-10T10:00:00Z'};
events=await sync('2026-09-10T11:41:00Z',[corrected,bookingB]);
assert.equal(events.length,2);assert.deepEqual(toProcessEvents(events,'2026-09-10T11:41:00Z').map(e=>e.source_event_id),['booking-b']);
const drafts=[corrected,bookingB].map(r=>({...r,status:'draft',date_updated:'2026-09-10T10:30:00Z'}));
events=await sync('2026-09-10T11:42:00Z',drafts);
assert.equal(events.length,2);assert.deepEqual(toProcessEvents(events,'2026-09-10T11:42:00Z'),[]);
await sync('2026-09-10T11:43:00Z',[]);
assert.equal((await db.query('select count(*) n from close_funnel_events where is_current')).rows[0].n,0);
assert.deepEqual([...await markerIds()],['booking-a','booking-b']);
const revisions=(await db.query('select count(*) n from close_funnel_events')).rows[0].n;
events=await sync('2026-09-10T11:44:00Z',drafts);
assert.equal((await db.query('select count(*) n from close_funnel_events')).rows[0].n,revisions);
assert.equal((await db.query('select count(*) n from close_funnel_events where is_current')).rows[0].n,2);
assert.deepEqual(toProcessEvents(events,'2026-09-10T11:44:00Z'),[]);
events=await sync('2026-09-10T11:45:00Z',[{...bookingA,date_updated:'2026-09-10T11:00:00Z'},drafts[1]]);
assert.deepEqual(toProcessEvents(events,'2026-09-10T11:45:00Z').map(e=>e.source_event_id),['booking-a']);
assert.deepEqual([...await markerIds()],['booking-a','booking-b']);
const grants=(await db.query("select has_function_privilege('anon','get_close_funnel_booking_source_ids()','execute') a,has_function_privilege('authenticated','get_close_funnel_booking_source_ids()','execute') b,has_function_privilege('service_role','get_close_funnel_booking_source_ids()','execute') c")).rows[0];
assert.deepEqual(grants,{a:false,b:false,c:true});
console.log('PASS published booking markers survive corrected outcomes, drafts, withdrawal and reactivation; unrelated/draft-only Opening rows stay excluded.');
console.log('PASS full source revisions remain immutable and marker RPC is service-role-only.');
await db.close();
