import assert from 'node:assert/strict';
import fs from 'node:fs';
export async function installIo(db){
 await db.exec(`create schema cron;create table cron.job(jobid bigint,jobname text,schedule text,command text);
 insert into cron.job values(1,'close_sync_every_15_minutes','2-59/5 * * * *','old');
 create function cron.alter_job(bigint,schedule text,command text) returns void language sql as $$update cron.job set schedule=$2,command=$3 where jobid=$1$$;`);
 const sql=fs.readFileSync(new URL('../supabase/migrations/20260917061946_reduce_sync_writes_and_business_hours.sql',import.meta.url),'utf8');
 await db.exec(sql);await db.exec(sql); // Replay is safe.
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260917062615_include_final_business_hour_dispatch.sql',import.meta.url),'utf8'));
}
export async function verifyIo(db,sync,row,M){
 assert.equal((await db.query("select close_sync_business_hours('2026-09-17T15:00:59Z') ok")).rows[0].ok,true);
 assert.equal((await db.query("select close_sync_business_hours('2026-09-17T15:01:00Z') ok")).rows[0].ok,false);
 for(const [at,expected] of [['2026-09-17T05:29Z',false],['2026-09-17T05:30Z',true],['2026-09-17T15:00Z',true],['2026-09-17T15:05Z',false],['2026-09-19T08:00Z',false],['2026-12-17T06:29Z',false],['2026-12-17T06:30Z',true],['2026-12-17T16:00Z',true],['2026-12-17T16:05Z',false],['2026-10-25T08:00Z',false]])
  assert.equal((await db.query('select close_sync_business_hours($1) ok',[at])).rows[0].ok,expected,at);
 const resume=(await db.query("select close_sync_resume_date('2026-09-21T05:30Z','2026-09-18T15:00Z')::text d")).rows[0].d;
 assert.equal(resume,'2026-09-18'); // Includes all Saturday/Sunday calls.
 const cron=(await db.query('select * from cron.job')).rows[0];assert.equal(cron.schedule,'*/5 5-16 * * 1-5');assert.match(cron.command,/if public.close_sync_business_hours\(now\(\)\) then/);
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`select has_function_privilege($1,'skip_unchanged_close_row()','execute') allowed`,[role])).rows[0].allowed,false);
 const meeting={meeting_id:'meeting',lead_id:'lead',contact_id:null,owner_id:M,starts_at:'2026-09-10T09:00Z',ends_at:'2026-09-10T09:30Z',date_created:'2026-09-09T08:00Z',date_updated:'2026-09-09T08:00Z',status:'completed',participant_ids:[],calendar_event_uids:[],excluded_purpose:false,booking_activity_id:null,booking_owner_id:null};
 const process={process_id:'process',lead_id:'lead'};
 const relation={meeting_id:'meeting',process_id:'process'};
 const eventRelation={source_kind:row.source_kind,source_event_id:row.source_event_id,event_type:row.event_type,process_id:'process',occurred_at:row.occurred_at};
 const raw={close_activity_id:'custom',activity_type:'custom_activity',close_user_id:M,lead_id:'lead',occurred_at:'2026-09-10T09:00Z',payload:{status:'published'}};
 const fact={source_activity_id:'custom',source_type:'custom_activity',close_user_id:M,lead_id:'lead',occurred_at:raw.occurred_at,metric_date:'2026-09-10',metric_hour:11,mapping_version:'test',mapped_at:'2026-09-10T11:56Z',...Object.fromEntries(['calls_gross','calls_net','talk_seconds','gatekeeper_contacts','connected_calls','direct_decision_maker_calls','appointments','setter_calls','setter_successes','closer_calls','closer_second_calls','closer_decided_calls','closer_sales','no_shows','cancellations','rescheduled_appointments'].map(k=>[k,0])),decision_maker_contacts:1};
 const task={...row,source_kind:'task',source_event_id:'task-io',event_type:'task_state',new_status:'open',payload:{task_type:'lead',assigned_to:'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR',is_complete:false,date_created:row.occurred_at}};
 const extra={0:[raw],1:[fact],5:[meeting],8:[process],9:[relation],10:[eventRelation]};
 await sync('2026-09-10T11:56Z',[row,task],extra);
 const tables=['close_meetings','close_sales_processes','close_process_meetings','close_process_events','close_raw_activities','close_activity_facts'];
 const identities=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await db.query(`select ctid::text id from ${t} order by ctid`)).rows])));
 const first=await identities();
 const eventTid=(await db.query("select ctid::text id from close_funnel_events where source_event_id=$1 and is_current",[row.source_event_id])).rows[0].id;
 fact.mapped_at='2026-09-10T11:57Z';
 await sync('2026-09-10T11:57Z',[row,task],extra);
 assert.deepEqual(await identities(),first,'Identical complete snapshot must not rewrite retained business rows');
 assert.equal((await db.query("select ctid::text id from close_funnel_events where source_event_id=$1 and is_current",[row.source_event_id])).rows[0].id,eventTid);
 await db.query("select confirm_close_task_snapshot('2026-09-10T11:57Z',1)"); // Task heartbeat is still exact.
 // A later edit must update the same activity and record the meeting reschedule.
 fact.decision_maker_contacts=0;meeting.starts_at='2026-09-10T10:00Z';meeting.ends_at='2026-09-10T10:30Z';meeting.date_updated='2026-09-10T11:57Z';
 await sync('2026-09-10T11:58Z',[row,task],extra);
 assert.equal((await db.query("select decision_maker_contacts from close_activity_facts where source_activity_id='custom'")).rows[0].decision_maker_contacts,0);
 assert.notDeepEqual((await identities()).close_meetings,first.close_meetings);
 assert.equal(Number((await db.query("select count(*) n from close_meeting_time_history where meeting_id='meeting'")).rows[0].n),1);
 // Only absence from a complete read removes a custom activity or meeting.
 await sync('2026-09-10T11:59Z',[row]);
 assert.equal(Number((await db.query("select count(*) n from close_activity_facts where source_activity_id='custom'")).rows[0].n),0);
 assert.equal((await db.query("select removed_at is not null removed from close_meetings where meeting_id='meeting'")).rows[0].removed,true);
 console.log('PASS no physical rewrites on identical complete snapshots; changed/deleted activities, meeting reschedules, strict task heartbeat, weekday/DST schedule and weekend catch-up.');
}
