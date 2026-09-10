import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
const sql=fs.readFileSync(new URL('../supabase/migrations/20260910062444_authoritative_lead_selections.sql',import.meta.url),'utf8');
const old=sql.match(/v_old text := \$old\$([\s\S]*?)\$old\$/)[1];
await db.exec(`create role anon;create role authenticated;create schema private;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;
create function public.has_antony_access() returns boolean language sql stable as $$select coalesce(current_setting('test.allowed',true),'true')<>'false'$$;
create table close_reconciliation_state(resource text,snapshot_started_at timestamptz);
insert into close_reconciliation_state values('funnel','2026-09-10T06:00:00Z');
create table close_funnel_leads(lead_id text primary key,display_name text,lead_source text,opener_close_user_id text,setter_id text,closer_id text,status_id text,source_updated_at timestamptz,last_seen_at timestamptz);
create table close_funnel_events(source_event_id text,lead_id text,occurred_at timestamptz,previous_status text,new_status text,source_kind text,is_current boolean default true,withdrawn_at timestamptz,payload jsonb);
create table private.antony_status_definitions(status_id text primary key,label text);
create function public.reconcile_close_funnel_snapshot(p_snapshot_started_at timestamptz) returns jsonb language plpgsql as $$begin
${old}
return '{}'::jsonb;end;$$;`);
await db.exec(sql);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260910070155_lead_selection_history.sql',import.meta.url),'utf8'));
const sources=(await db.query('select * from private.antony_lead_report_sources order by sort_order')).rows;
const [setting,closing,customer]=sources.map(x=>x.status_id);
async function lead(id,status){await db.query('insert into close_funnel_leads(lead_id,display_name,status_id,report_dimensions) values($1,$1,$2,$3)',[id,status,JSON.stringify({status_label:status,selection_tracked:true})]);}
async function event(id,lead,old,next,created,activity='2026-08-01T12:00Z',current=true,withdrawn=null,kind='lead_status_change'){
 await db.query('insert into close_funnel_events values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,lead,activity,old,next,kind,current,withdrawn,JSON.stringify({date_created:created})]);}
await lead('lead_A','Follow-up');await lead('lead_B','No Show');await lead('lead_C','CC2');await lead('lead_D','Sold');
await event('a1','lead_A',setting,'Other','2026-09-01T12:00Z');await event('a2','lead_A',setting,'Other','2026-09-03T12:00Z');
await event('b','lead_B',setting,'Other','2026-09-09T23:00Z');
await event('c','lead_C',closing,'Other','2026-08-31T22:00Z'); // Closing uses Berlin midnight.
await event('d','lead_D','Older CC2',customer,'2026-09-03T12:00Z'); // Independent acquisition.
await event('incoming','lead_incoming','Opening',setting,'2026-09-03T12:00Z');
await event('utc-before','lead_before',setting,'Other','2026-08-31T23:59:59Z');
await event('future','lead_future',setting,'Other','2026-09-10T07:00Z');
await event('old','lead_old',setting,'Other','2026-09-01T12:00Z',undefined,false);
await event('withdrawn','lead_deleted',setting,'Other','2026-09-01T12:00Z',undefined,true,'2026-09-02T00:00Z');
await event('call','lead_call',setting,'Other','2026-09-01T12:00Z',undefined,true,null,'custom_activity');
const report=async(p,d)=>(await db.query('select get_antony_lead_selection_report($1,$2) report',[p,d])).rows[0].report;
const month=await report('month','2026-09-10');
assert.deepEqual(month.groups.map(g=>g.total),[2,1,1]);
assert.equal(month.history.length,5);
assert(!month.history.some(e=>e.source_event_id==='future'));
assert.equal(month.groups[0].leads.find(x=>x.lead_id==='lead_A').matching_events,2);
assert.equal(month.groups[0].leads.find(x=>x.lead_id==='lead_A').status_label,'Follow-up'); // current, not destination
assert.equal(new Date(month.groups[0].selection_start).toISOString(),'2026-09-01T00:00:00.000Z');
assert.equal(new Date(month.groups[1].selection_start).toISOString(),'2026-08-31T22:00:00.000Z');
assert.deepEqual((await report('day','2026-09-10')).groups.map(g=>g.total),[0,0,0]);
assert.deepEqual((await report('week','2026-09-10')).groups.map(g=>g.total),[1,0,0]);
assert.equal((await report('trend','2026-09-10')).groups[0].total,3);
assert.deepEqual((await report('month','2026-08-31')).groups.map(g=>g.total),[1,0,0]);
await db.exec("set test.allowed='false'");await assert.rejects(report('month','2026-09-10'),/Nicht berechtigt/);
await db.exec("set test.allowed='true'");await assert.rejects(report('invalid','2026-09-10'),/Ungültiger Zeitraum/);
const grants=(await db.query("select has_function_privilege('anon','get_antony_lead_selection_report(text,date)','execute') allowed")).rows;assert.equal(grants[0].allowed,false);
console.log('Lead selection SQL verified: date_created, source time zones, current statuses, distinct cohorts, all periods, excluded revisions/future/activity, permission guard and snapshot migration.');
await db.close();
