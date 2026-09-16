import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {mapCall,metricTimeInReportingTimezone,CLOSE_USERS} from '../supabase/functions/_shared/close-mapping.ts';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
await db.exec(`create schema extensions; create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
create schema cron;create table cron.job(jobid bigint,jobname text,schedule text);
insert into cron.job values(1,'close_sync_every_15_minutes','7,22,37,52 * * * *');
create function cron.alter_job(bigint,schedule text) returns void language sql as $$update cron.job set schedule=$2 where jobid=$1$$;`);
await db.exec(read('fixtures/kpi-schema.sql'));
await db.query("insert into sales_people(close_user_id,slug,display_name,color) values($1,'michael','Michael','#4488ff'),($2,'felix','Felix','#ffaa00')",[CLOSE_USERS.michael,CLOSE_USERS.felix]);
const calls=[];
for(const user_id of Object.values(CLOSE_USERS).slice(0,2)) for(const direction of ['inbound','outbound']) for(const status of ['created','in-progress','completed','no-answer','busy','failed','timeout','cancel']) for(const disposition of ['answered','no-answer','vm-left','vm-answer',null]){
 const call={id:`call_${calls.length}`,user_id,lead_id:'lead',activity_at:'2026-09-15T22:05:00Z',direction,status,disposition,duration:31};calls.push(call);
 await db.query("insert into close_raw_activities(close_activity_id,activity_type,close_user_id,occurred_at,payload) values($1,'call',$2,$3,$4)",[call.id,user_id,call.activity_at,call]);
 await db.query("insert into close_activity_facts(source_activity_id,source_type,close_user_id,occurred_at,metric_date,metric_hour,mapping_version) values($1,'call',$2,$3,'2026-09-16',0,'old')",[call.id,user_id,call.activity_at]);
}
await db.exec("insert into daily_sales_metrics(metric_date,sales_person_id,appointments,decision_maker_contacts,setter_calls,closer_calls) select '2026-09-16',id,7,19,4,3 from sales_people");
const migration=read('../supabase/migrations/20260916134758_align_call_tracking_and_five_minute_sync.sql');
for(let iteration=0;iteration<2;iteration++){
 await db.exec(migration);
 const facts=(await db.query('select * from close_activity_facts')).rows;
 for(const call of calls){const expected=mapCall(call),actual=facts.find(f=>f.source_activity_id===call.id);assert.equal(actual.calls_gross,expected.callsGross);assert.equal(actual.calls_net,expected.callsNet);assert.equal(actual.talk_seconds,expected.talkSeconds);assert.equal(actual.close_user_id,call.user_id);assert.equal(actual.metric_hour,metricTimeInReportingTimezone(call.activity_at).metricHour);}
 for(const daily of (await db.query('select * from daily_sales_metrics')).rows){assert.equal(daily.appointments,7);assert.equal(daily.decision_maker_contacts,19);assert.equal(daily.setter_calls,4);assert.equal(daily.closer_calls,3);assert.equal(daily.calls_gross,60);assert.equal(daily.calls_net,2);}
 assert.equal((await db.query('select schedule from cron.job')).rows[0].schedule,'2-59/5 * * * *');
}
// The actual persistent identity remains one row when an in-progress call
// finishes in the next source read; subsequent runs are replacements, not sums.
const pending=calls.find(c=>c.status==='in-progress');
const finished={...pending,status:'completed',disposition:'answered'};
await db.query('update close_raw_activities set payload=$1 where close_activity_id=$2',[finished,finished.id]);
await db.exec(migration);
assert.equal((await db.query('select count(*)::int n from close_activity_facts')).rows[0].n,calls.length);
assert.equal((await db.query('select calls_net from close_activity_facts where source_activity_id=$1',[finished.id])).rows[0].calls_net,1);
await db.close();
console.log('160 Call combinations: TypeScript/SQL parity, Berlin midnight, caller ownership, same-ID correction, idempotence, unchanged non-call KPIs, five-minute schedule verified.');
