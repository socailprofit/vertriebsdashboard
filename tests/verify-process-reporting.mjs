import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const M='user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',F='user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4',A='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR';
const ASOF='2026-09-10T11:15:00Z';
async function main(){
 const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create schema extensions;create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
   create schema auth;create function auth.uid() returns uuid language sql as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;
   create function has_dashboard_access() returns boolean language sql as $$select true$$;
   create function has_antony_access() returns boolean language sql as $$select true$$;
   create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select '2026-09-10T12:00Z'::timestamptz$$;`);
  await db.exec(read('fixtures/kpi-schema.sql'));
  await db.exec('create table antony_performance_goals(id integer);');
  for(const name of ['20260907121749_normalize_transfer_opportunities','20260908071339_reconcile_antony_kpis','20260908071341_add_antony_process_metrics','20260908071707_fix_lead_snapshot_delete_guard','20260908082307_audit_complete_sales_journey','20260908085704_fix_booking_cohort_filters','20260908093505_optimize_cohort_report_plan','20260908124152_store_calendar_meetings','20260908124321_calendar_snapshot_safe_update','20260908124714_use_meeting_time_for_antony','20260908125538_retain_pre_meeting_cancellations','20260908131505_setter_meeting_attendance','20260908132556_calendar_reconciliation_execution','20260908145135_lead_funnel_event_history','20260908145158_process_calendar_replacements','20260909060833_persistent_process_reporting']) {const sql=read('../supabase/migrations/'+name+'.sql');try{await db.exec(sql);}catch(e){const at=Number(e.position||0);throw new Error(name+': '+e.message+' near '+sql.slice(Math.max(0,at-100),at+100));}}
  await db.exec(read('../supabase/migrations/20260909060453_allow_funnel_task_source.sql'));
  await db.exec(read('../supabase/migrations/20260909060845_record_calendar_stage_evidence.sql'));
  await db.exec(read('../supabase/migrations/20260909061101_respect_documented_open_followups.sql'));
  await db.exec(read('../supabase/migrations/20260909061553_stabilize_current_plans.sql'));
  await db.exec(read('../supabase/migrations/20260909062039_streamline_process_report.sql'));
  await db.exec(read('../supabase/migrations/20260909071023_closeup_actionable_cases.sql'));
  await db.exec(read('../supabase/migrations/20260909071406_direct_contact_breakdown.sql'));
  await db.exec(read('../supabase/migrations/20260909074301_limit_cohorts_to_elapsed_meetings.sql'));
  await db.query("insert into sales_people(close_user_id,slug,display_name,color) values($1,'michael','Test','#369'),($2,'felix','Test F','#f90')",[M,F]);
  await db.query("insert into close_reconciliation_state values('custom_and_won',$1),('funnel',$1)",[ASOF]);
  let serial=0,failures=0;
  const stock=async()=>(await db.query("select get_antony_pipeline_snapshot('2026-08-01') j")).rows[0].j;
  const report=async(period='month',date='2026-09-10')=>(await db.query('select get_antony_process_metrics_internal($1,$2) j',[period,date])).rows[0].j;
  const rows=async()=>(await db.query("select data from get_close_process_rows_internal('2026-09-10')")).rows.map(r=>r.data);
  const cohorts=async()=>(await db.query("select get_close_process_cohorts_internal('2026-09-10') j")).rows[0].j;
  const origins=async(period='month',date='2026-09-10')=>(await db.query('select get_close_process_activity_origins_internal($1,$2) j',[period,date])).rows[0].j;
  async function reset(){await db.exec("delete from close_reconciliation_state where resource='antony_tasks'");await db.exec('truncate close_process_events,close_process_meetings,close_sales_processes,close_funnel_events,close_funnel_leads,close_meetings,close_booking_history,close_activity_facts,close_raw_activities,close_opportunity_facts,close_lead_reporting,close_supplier_rules;');}
  async function scenario(name,fn){await reset();try{await fn();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+': '+e.message);}}
  async function funnel(id,first='2026-09-01T08:00:00Z',source='DMC',extra={}){
   const payload={process_id:id,lead_id:id,documented_booking:true,opened_at:'2026-01-01T08:00:00Z',first_meeting_at:first,booking_owner_id:M,...extra};
   await db.query('insert into close_sales_processes(process_id,lead_id,payload,last_seen_at) values($1,$2,$3,$4)',[id,payload.lead_id,JSON.stringify(payload),ASOF]);
   await db.query('insert into close_funnel_leads(lead_id,lead_source,last_seen_at) values($1,$2,$3) on conflict(lead_id) do nothing',[payload.lead_id,source,ASOF]);
   await db.query('insert into close_lead_reporting(lead_id,lead_source,opener_close_user_id) values($1,$2,$3) on conflict(lead_id) do nothing',[payload.lead_id,source,M]);
   return payload;
  }
  async function event(id,type,at,applies=true){
   const source='event-'+ ++serial,payload={applies_to_state:applies};
   await db.query("insert into close_process_events(source_kind,source_event_id,event_type,process_id,occurred_at,payload,last_seen_at) values('custom_activity',$1,$2,$3,$4,$5,$6)",[source,type,id,at,JSON.stringify(payload),ASOF]);return source;
  }
  async function meeting(processId,at){
   const id='meeting-'+ ++serial,booking='booking-'+id;
   const row={meeting_id:id,lead_id:processId,owner_id:M,starts_at:at,ends_at:new Date(Date.parse(at)+1800000).toISOString(),date_created:'2026-09-01T08:00:00Z',date_updated:'2026-09-01T08:00:00Z',status:'upcoming',participant_ids:[],calendar_event_uids:[],excluded_purpose:false,booking_activity_id:booking,booking_owner_id:M,last_seen_at:ASOF};
   await db.query('insert into close_meetings select * from jsonb_populate_record(null::close_meetings,$1)',[JSON.stringify(row)]);
   await db.query('insert into close_booking_history values($1,$2,$3,$4,$5)',[booking,processId,M,'2026-01-01T08:00:00Z','2026-01-01']);
   await db.query('insert into close_process_meetings(meeting_id,process_id,payload,last_seen_at) values($1,$2,$3,$4)',[id,processId,JSON.stringify({meeting_id:id,process_id:processId,relation_type:'original',counts_as_setting_success:true}),ASOF]);
  }
  async function won(lead,date,id='won-'+ ++serial){
   const payload={acquisition:true,won_date:date,won_at:date+'T12:00:00Z',date_won:date,deal_type:'Neukunde',value_cents:100,value_period:'one_time'};
   await db.query("insert into close_funnel_events(lead_id,event_type,occurred_at,new_status,closer_id,source_event_id,source_kind,source_updated_at,source_revision,payload,first_seen_at,last_seen_at) values($1,'customer_won',$2,'stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL',$3,$4,'opportunity',$2,$5,$6,$7,$7)",[lead,date+'T12:00:00Z',A,id,'a'.repeat(64),JSON.stringify(payload),ASOF]);
   return id;
  }
  async function activity(processId,lead,type,at,{applies=true,unlinked=false}={}){
   const id=unlinked?'unlinked-'+ ++serial:await event(processId,type,at,applies);
   const setter=type.startsWith('setter_'),actor=setter?M:A;
   const result={setter_qualified:'✅ Closer terminiert',setter_follow_up:'🔎 Setter Follow Up',setter_disqualified:'❌ Disqualifiziert',cc2_agreed:'2. 🔥 CC2 vereinbart',cc2_sold:'3. ✅ Verkauft - in CC2 🔥',closer_sold:'1. ✅ Verkauft - in CC1',closer_lost:'4. ❌ Nicht verkauft'}[type];
   const payload={custom_activity_type_id:setter?'actitype_7iu5gw2AEBDGBHD7Mqcz3S':'closer-test',[setter?'custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo':'custom.cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn']:result};
   await db.query("insert into close_activity_facts(source_activity_id,source_type,lead_id,close_user_id,occurred_at,metric_date,metric_hour,setter_calls,setter_successes,closer_calls,closer_second_calls,closer_sales,mapping_version) values($1,'custom_activity',$2,$3,$4,($4::timestamptz at time zone 'Europe/Berlin')::date,extract(hour from $4::timestamptz at time zone 'Europe/Berlin'),$5,$6,$7,$8,$9,'test')",[id,lead,actor,at,setter?1:0,type==='setter_qualified'?1:0,setter?0:1,type==='cc2_agreed'?1:0,['closer_sold','cc2_sold'].includes(type)?1:0]);
   await db.query("insert into close_raw_activities(close_activity_id,activity_type,lead_id,close_user_id,occurred_at,payload) values($1,'custom_activity',$2,$3,$4,$5)",[id,lead,actor,at,JSON.stringify(payload)]);
   return id;
  }
  await scenario('open follow-up survives raw-data retention and the selected historical month',async()=>{
   await funnel('old','2026-04-01T08:00:00Z');await event('old','setter_follow_up','2026-04-01T08:10:00Z');
   const s=await stock();assert.equal(s.counts.total_open,1);assert.equal(s.counts.setter_followup,1);assert.equal(s.as_of,'2026-09-10');
   assert.equal((await report()).flow.new_processes,0);assert.equal((await report()).flow.first_qualified,0);
  });
  await scenario('October follow-up is planned now, not a missing September Setter or No-Show',async()=>{
   await funnel('oct','2026-05-01T08:00:00Z');await event('oct','setter_follow_up','2026-05-01T08:10:00Z');await meeting('oct','2026-10-15T08:00:00Z');
   const s=await stock();assert.equal(s.counts.total_open,1);assert.equal(s.counts.setter_planned,1);assert.equal(s.counts.setter_followup,0);assert.equal(s.counts.setter_no_show,0);
   assert.deepEqual(s.next_by_month,[{month:'2026-10-01',stage:'setter',count:1}]);
   const m=(await db.query("select get_antony_meeting_metrics('2026-10-01','2026-10-31') j")).rows[0].j;
   assert.equal(m.future,1);assert.equal(m.attended,0);assert.equal(m.no_show,0);assert.equal(m.show_rate,null);
  });
  await scenario('an older qualification is not another new qualification after a later Setter follow-up',async()=>{
   await funnel('qualified','2026-08-01T08:00:00Z');await event('qualified','setter_qualified','2026-08-01T08:20:00Z');await event('qualified','setter_follow_up','2026-09-02T08:20:00Z');
   const p=await report();assert.equal(p.flow.first_qualified,0);assert.equal(p.flow.carried_in,1);assert.equal(p.flow.repeat_setter_calls,1);
   const s=await stock();assert.equal(s.counts.setter_followup,1);assert.equal(s.counts.closer_followup,0);
  });
  await scenario('a Setter calendar after qualification never becomes a guessed Closer appointment',async()=>{
   await funnel('stage-conflict');await event('stage-conflict','setter_qualified','2026-09-02T08:20:00Z');await meeting('stage-conflict','2026-10-15T08:00:00Z');
   const s=await stock();assert.equal(s.counts.total_open,1);assert.equal(s.counts.planning_needs_review,1);
   assert.equal(s.counts.setter_planned,0);assert.equal(s.counts.closer_planned,0);assert.equal(s.counts.closer_scheduled,0);
   assert.deepEqual(s.next_by_month,[{month:'2026-10-01',stage:'unassigned',count:1}]);
  });
  await scenario('first Neukunden-Won survives retention and later sale confirmation stays in the old acquisition month',async()=>{
   await funnel('customer','2026-02-01T08:00:00Z');await won('customer','2026-03-01','original');await won('customer','2026-09-02','duplicate');await event('customer','customer_won','2026-03-01T12:00:00Z');await event('customer','closer_sold','2026-09-02T08:00:00Z',false);
   const acquisitions=(await db.query("select opportunity_id,won_date from get_customer_acquisitions_internal('2026-09-10')")).rows;
   assert.equal(acquisitions.length,1);assert.equal(acquisitions[0].opportunity_id,'original');assert.equal(new Date(acquisitions[0].won_date).toISOString().slice(0,10),'2026-03-01');
   assert.equal((await db.query("select * from get_antony_closing_metrics_internal('month','2026-09-10')")).rows[0].new_customers,0);
   assert.equal((await stock()).counts.total_open,0);
  });
  await scenario('date-only Won is not forced to occur at noon before a same-day afternoon Closer',async()=>{
   await funnel('date-only','2026-09-01T08:00:00Z');await event('date-only','setter_qualified','2026-09-01T09:00:00Z');
   await event('date-only','closer_sold','2026-09-09T16:00:00Z');
   const id=await event('date-only','customer_won','2026-09-09T12:00:00Z');
   await db.query("update close_process_events set payload=payload||'{\"occurred_at_precision\":\"date\"}' where source_event_id=$1",[id]);
   const [g]=await cohorts();assert.equal(g.observed_customers,1);assert.equal(g.new_customers,1);
  });
  await scenario('an early unlinked Closer does not hide a subsequent correctly sequenced Closer',async()=>{
   await funnel('sequence');await event('sequence','closer_completed','2026-09-01T09:00:00Z');await event('sequence','setter_qualified','2026-09-02T08:00:00Z');await event('sequence','closer_completed','2026-09-03T08:00:00Z');
   const [g]=await cohorts();assert.equal(g.setter_arrived,1);assert.equal(g.closer_qualified,1);assert.equal(g.closer_arrived,1);
  });
  await scenario('contradictory simultaneous outcomes do not choose an arbitrary event ID',async()=>{
   await funnel('ambiguous');await event('ambiguous','setter_qualified','2026-09-02T08:00:00Z');await event('ambiguous','setter_disqualified','2026-09-02T08:00:00Z');
   const s=await stock();assert.equal(s.counts.total_open,1);assert.equal(s.counts.unrated,1);
  });
  await scenario('a marked source conflict preserves an unresolved state without generating a qualification',async()=>{
   await funnel('conflict');const a=await event('conflict','setter_qualified','2026-09-02T08:00:00Z',false),b=await event('conflict','setter_disqualified','2026-09-02T08:00:00Z',false);
   await db.query("update close_process_events set payload=payload||'{\"state_conflict\":true}' where source_event_id in ($1,$2)",[a,b]);
   assert.equal((await stock()).counts.unrated,1);assert.equal((await report()).flow.first_qualified,0);
   const [g]=await cohorts();assert.equal(g.setter_arrived,1);assert.equal(g.closer_qualified,0);assert.equal(g.unrated,1);
  });
  await scenario('a Closer with no verified qualifying Setter remains a visible documentation gap',async()=>{
   await funnel('gap');await event('gap','closer_completed','2026-09-02T08:00:00Z');
   const [g]=await cohorts();assert.equal(g.closer_arrived,0);assert.equal(g.unlinked_closer,1);
  });
  await scenario('only actual CC2 decisions enter the nested decided and sold subsets',async()=>{
   await funnel('cc2');await event('cc2','setter_qualified','2026-09-01T09:00:00Z');await event('cc2','cc2_agreed','2026-09-02T09:00:00Z');await event('cc2','cc2_sold','2026-09-03T09:00:00Z');
   const [g]=await cohorts();assert.equal(g.cc2_agreed,1);assert.equal(g.cc2_held,1);assert.equal(g.cc2_decided,1);assert.equal(g.cc2_sold,1);
   assert(g.cc2_sold+g.cc2_lost<=g.cc2_decided);assert(g.cc2_decided<=g.cc2_held);assert(g.cc2_held<=g.cc2_agreed);
  });
  await scenario('a cancelled CC2 is not an already-held open CC2',async()=>{
   await funnel('cc2-cancel');await event('cc2-cancel','setter_qualified','2026-09-01T09:00:00Z');await event('cc2-cancel','cc2_agreed','2026-09-02T09:00:00Z');await event('cc2-cancel','closer_cancelled','2026-09-03T09:00:00Z');
   const [g]=await cohorts();assert.equal(g.cc2_cancelled,1);assert.equal(g.cc2_held,0);assert.equal(g.cc2_open,0);assert.equal(g.cc2_waiting,0);
  });
  await scenario('a subsequent CC2 decision is not lost behind a prior unconfirmed CC1 sale',async()=>{
   await funnel('cc2-second-decision');await event('cc2-second-decision','setter_qualified','2026-09-01T09:00:00Z');await event('cc2-second-decision','closer_sold','2026-09-02T09:00:00Z');await event('cc2-second-decision','cc2_agreed','2026-09-03T09:00:00Z');await event('cc2-second-decision','closer_lost','2026-09-04T09:00:00Z');
   const [g]=await cohorts();assert.equal(g.cc2_held,1);assert.equal(g.cc2_lost,1);assert.equal(g.cc2_decided,1);assert.equal(g.cc2_sold,0);
   assert(g.cc2_sold+g.cc2_lost<=g.cc2_decided);assert(g.cc2_decided<=g.cc2_held);
  });
  await scenario('source attribution is identical for a channel cohort and calendar attendance',async()=>{
   await funnel('channel','2026-09-01T08:00:00Z','LinkedIn');await meeting('channel','2026-09-05T08:00:00Z');
   await db.query("insert into close_supplier_rules values('LinkedIn','linkedin')");
   const [g]=await cohorts();assert.equal(g.owner,'linkedin');
   const m=(await db.query("select get_antony_meeting_metrics('2026-09-01','2026-09-30') j")).rows[0].j;
   assert.equal(m.by_source[0].owner,'linkedin');
   const id=await event('channel','setter_follow_up','2026-09-05T08:10:00Z');
   await db.query("insert into close_activity_facts(source_activity_id,source_type,lead_id,close_user_id,occurred_at,metric_date,metric_hour,setter_calls,mapping_version) values($1,'custom_activity','channel',$2,'2026-09-05T08:10:00Z','2026-09-05',10,1,'test')",[id,M]);
   await db.query("insert into close_raw_activities(close_activity_id,activity_type,lead_id,close_user_id,occurred_at,payload) values($1,'custom_activity','channel',$2,'2026-09-05T08:10:00Z',$3)",[id,M,JSON.stringify({custom_activity_type_id:'actitype_7iu5gw2AEBDGBHD7Mqcz3S','custom.cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo':'🔎 Setter Follow Up'})]);
   const p=await report();assert.equal(p.quality_by_source[0].owner,'linkedin');assert.equal(p.activity_by_origin.find(r=>r.setter_calls===1).owner,'linkedin');
   assert.equal(p.setter_by_day[0].owner,'michael');
   const full=(await db.query("select get_antony_report('month','2026-09-10') j")).rows[0].j;
   assert.equal(full.planner.appointment_by_owner.linkedin,1);assert.equal(full.planner.appointment_by_owner.michael,undefined);
  });
  await scenario('empty populations stay empty and do not create a show rate',async()=>{
   assert.deepEqual(await cohorts(),[]);assert.equal((await stock()).counts.total_open,0);
   const m=(await db.query("select get_antony_meeting_metrics('2026-09-01','2026-09-30') j")).rows[0].j;
   assert.equal(m.scheduled,0);assert.equal(m.show_rate,null);
  });
  await scenario('second process uses its own first meeting and supplier without inheriting the old CC2',async()=>{
   await funnel('old-process','2026-08-01T08:00:00Z','DMC',{lead_id:'same-lead'});
   await event('old-process','setter_qualified','2026-08-01T09:00:00Z');await event('old-process','cc2_agreed','2026-08-02T09:00:00Z');await event('old-process','closer_lost','2026-08-03T09:00:00Z');
   await funnel('new-process','2026-09-01T08:00:00Z','DMC',{lead_id:'same-lead',booking_owner_id:F});
   await activity('old-process','same-lead','setter_follow_up','2026-09-02T09:00:00Z',{applies:false});
   await activity('new-process','same-lead','setter_qualified','2026-09-03T09:00:00Z');
   await activity('new-process','same-lead','closer_lost','2026-09-04T09:00:00Z');
   const p=await origins();assert.equal(p.period_bridge.setter_calls,2);assert.equal(p.period_bridge.setter_leads,1);assert.equal(p.period_bridge.setter_processes,2);
   assert.equal(p.period_bridge.setter_from_period_bookings,1);assert.equal(p.period_bridge.setter_from_prior_bookings,1);
   assert.equal(p.period_bridge.cc2_calls,0);assert.equal(p.period_bridge.cc1_calls,1);assert.equal(p.period_bridge.cc1_lost,1);assert.equal(p.period_bridge.cc2_lost,0);
   const old=p.activity_by_origin.find(r=>r.owner==='michael'),fresh=p.activity_by_origin.find(r=>r.owner==='felix');
   assert.equal(old.booked_date,'2026-08-01');assert.equal(old.setter_calls,1);assert.equal(fresh.booked_date,'2026-09-01');assert.equal(fresh.setter_qualified,1);
   assert.equal(p.quality_by_source.reduce((n,r)=>n+r.assessed_leads,0),2);
   assert.equal(p.quality_by_source.find(r=>r.owner==='michael').followup,1);assert.equal(p.quality_by_source.find(r=>r.owner==='felix').qualified,1);
   const q=await origins('three_months');assert.equal(q.period_bridge.setter_from_period_bookings,2);assert.equal(q.period_bridge.setter_from_prior_bookings,0);
  });
  await scenario('CC2 follows process history while unlinked and future activity cannot invent a CC1 or CC2 origin',async()=>{
   await funnel('cc-history','2026-05-01T08:00:00Z','DMC',{lead_id:'shared'});await event('cc-history','cc2_agreed','2026-05-02T09:00:00Z');
   await activity('cc-history','shared','closer_lost','2026-09-02T09:00:00Z',{applies:false});
   await activity(null,'shared','closer_lost','2026-09-03T09:00:00Z',{unlinked:true});
   await activity(null,'shared','setter_follow_up','2026-09-03T10:00:00Z',{unlinked:true});
   await activity(null,'shared','closer_sold','2026-09-04T09:00:00Z',{unlinked:true});
   await funnel('plain-closer','2026-09-01T08:00:00Z','DMC',{lead_id:'shared'});await activity('plain-closer','shared','closer_completed','2026-09-05T09:00:00Z');
   await activity('cc-history','shared','closer_lost','2026-09-10T13:00:00Z',{applies:false});
   const p=await origins();assert.equal(p.period_bridge.closer_calls,4);assert.equal(p.period_bridge.cc2_calls,1);assert.equal(p.period_bridge.cc1_calls,2);assert.equal(p.period_bridge.cc2_lost,1);
   assert.equal(p.period_bridge.cc1_lost,0);assert.equal(p.period_bridge.closer_lost_unassigned,1);assert.equal(p.period_bridge.cc_unassigned_calls,1);
   assert.equal(p.period_bridge.setter_without_booking,1);assert.equal(p.activity_by_origin.find(r=>r.owner==='unassigned').booked_date,null);
  });
  await scenario('first acquisition is attributed to its exact process and never to another process on the same lead',async()=>{
   await funnel('old-acq','2026-05-01T08:00:00Z','DMC',{lead_id:'buyer'});await event('old-acq','closer_lost','2026-05-03T08:00:00Z');
   await funnel('new-acq','2026-09-01T08:00:00Z','DMC',{lead_id:'buyer',booking_owner_id:F});
   const id=await won('buyer','2026-09-04');
   await db.query("insert into close_process_events(source_kind,source_event_id,event_type,process_id,occurred_at,payload,last_seen_at) values('opportunity',$1,'customer_won','new-acq','2026-09-04T12:00:00Z','{}',$2)",[id,ASOF]);
   await won('buyer','2026-09-05');
   let p=await origins();assert.equal(p.period_bridge.new_customers,1);assert.equal(p.period_bridge.customers_from_period_bookings,1);assert.equal(p.period_bridge.customers_from_prior_bookings,0);
   assert.equal(p.activity_by_origin[0].owner,'felix');assert.equal(p.activity_by_origin[0].booked_date,'2026-09-01');
   await db.query("update close_process_events set removed_at=$1 where source_kind='opportunity'",[ASOF]);
   p=await origins();assert.equal(p.period_bridge.new_customers,1);assert.equal(p.period_bridge.customers_without_booking,1);assert.equal(p.activity_by_origin[0].owner,'unassigned');
   await won('buyer','2026-03-01','earlier-acquisition');p=await origins();assert.equal(p.period_bridge.new_customers,0);
  });
  await scenario('conflicting latest Setter results stay one unassessed process and channel rules remain consistent',async()=>{
   await funnel('quality-channel','2026-09-01T08:00:00Z','LinkedIn');await db.query("insert into close_supplier_rules values('LinkedIn','linkedin')");
   await activity('quality-channel','quality-channel','setter_qualified','2026-09-02T09:00:00Z');
   await activity('quality-channel','quality-channel','setter_disqualified','2026-09-02T09:00:00Z');
   const p=await origins();assert.equal(p.quality_by_source.length,1);assert.equal(p.quality_by_source[0].assessed_leads,1);assert.equal(p.quality_by_source[0].unrated,1);assert.equal(p.quality_by_source[0].qualified,0);assert.equal(p.quality_by_source[0].owner,'linkedin');
   assert.equal(p.activity_by_origin[0].setter_calls,2);assert.equal(p.activity_by_origin[0].owner,'linkedin');
   const empty=await origins('day','2026-09-01');assert.deepEqual(empty.activity_by_origin,[]);assert.deepEqual(empty.quality_by_source,[]);assert.equal(empty.period_bridge.cc2_calls,0);
  });
  await scenario('service worker without a user UID can read only the dedicated internal snapshot entry point',async()=>{
   await funnel('worker-stock');await event('worker-stock','setter_follow_up','2026-09-02T08:00:00Z');
   await db.exec('create or replace function auth.uid() returns uuid language sql as $$select null::uuid$$;');
   try {
    await db.exec('set role service_role');
    const r=(await db.query("select get_antony_pipeline_snapshot_internal('2026-09-10') j")).rows[0].j;
    assert.equal(r.persistent,true);assert.equal(r.counts.total_open,1);assert.equal(r.counts.setter_followup,1);
    await assert.rejects(db.query("select get_antony_pipeline_snapshot('2026-09-10')"),e=>e.code==='42501');
    await db.exec('reset role');
    for(const role of ['anon','authenticated']) {
     await db.exec('set role '+role);
     await assert.rejects(db.query("select get_antony_pipeline_snapshot_internal('2026-09-10')"),e=>e.code==='42501');
     await assert.rejects(db.query("select get_antony_pipeline_snapshot('2026-09-10')"),e=>e.code==='42501');
     await db.exec('reset role');
    }
   } finally {
    await db.exec("reset role;create or replace function auth.uid() returns uuid language sql as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;");
   }
   // A valid identity alone never bypasses the leadership permission check.
   await db.exec('create or replace function has_antony_access() returns boolean language sql as $$select false$$;');
   try {await assert.rejects(db.query("select get_antony_pipeline_snapshot('2026-09-10')"),e=>e.code==='42501');}
   finally {await db.exec('create or replace function has_antony_access() returns boolean language sql as $$select true$$;');}
   assert.equal((await stock()).counts.total_open,1);
  });
  await scenario('calendar stage follows a proven relation and never activates a speculative CC2 classification',async()=>{
   await funnel('stage-evidence');await meeting('stage-evidence','2026-10-15T08:00:00Z');
   assert.equal((await rows())[0].next_stage,'setter'); // Existing proven Setter relations remain compatible.
   await db.query("update close_process_meetings r set payload=payload||jsonb_build_object('meeting_stage','setter','stage_basis','documented_setter_booking','stage_source_event_id',m.booking_activity_id) from close_meetings m where m.meeting_id=r.meeting_id");
   assert.equal((await rows())[0].next_stage,'setter');assert.equal((await stock()).counts.setter_planned,1);
   await db.exec("update close_process_meetings set payload=payload||'{\"stage_source_event_id\":\"not-the-booking\"}'");
   assert.equal((await rows())[0].next_stage,'unassigned');let s=await stock();assert.equal(s.counts.setter_planned,0);assert.equal(s.counts.planning_needs_review,1);
   await db.exec("update close_process_meetings set payload=payload||'{\"meeting_stage\":\"cc2\"}'");
   assert.equal((await rows())[0].next_stage,'unassigned');s=await stock();assert.equal(s.counts.cc2_planned,0);assert.equal(s.counts.planning_needs_review,1);
   assert.deepEqual(s.next_by_month,[{month:'2026-10-01',stage:'unassigned',count:1}]);
   const p=await report();assert.equal(p.flow.first_qualified,0);assert.equal(p.activity.setter_calls,0);assert.equal(p.activity.closer_calls,0);
  });
  async function taskPlan(lead,due='2026-10-14T09:30:00Z',created='2026-08-26T09:00:00Z',addMeeting=true){
   const id='task-'+ ++serial,dateOnly=due.length===10;
   const payload={task_type:'lead',assigned_to:A,is_complete:false,date_created:created,purpose_code:'follow_up',due_date:due.slice(0,10),due_at:dateOnly?null:due,due_precision:dateOnly?'date':'timestamp'};
   await db.query("insert into close_funnel_events(lead_id,event_type,occurred_at,source_event_id,source_kind,new_status,source_updated_at,source_revision,payload,first_seen_at,last_seen_at) values($1,'task_state',$2,$3,'task','open',$2,$4,$5,$6,$6)",[lead,created,id,'a'.repeat(64),JSON.stringify(payload),ASOF]);
   if(addMeeting){await db.query("insert into close_funnel_events(lead_id,event_type,occurred_at,source_event_id,source_kind,new_status,source_updated_at,source_revision,payload,first_seen_at,last_seen_at) values($1,'meeting_scheduled',$2,$3,'meeting','upcoming',$4,$5,$6,$7,$7)",[lead,due,'calendar-'+id,created,'a'.repeat(64),JSON.stringify({owner_id:A,date_created:created,purpose_code:'consultation',excluded_purpose:true}),ASOF]);}
   await db.query("insert into close_reconciliation_state values('antony_tasks',$1) on conflict(resource) do update set snapshot_started_at=excluded.snapshot_started_at",[ASOF]);return id;
  }
  await scenario('negative conversation plus documented October continuation preserves decision and original cohort',async()=>{
   await funnel('cc2old','2026-07-14T08:00Z');await event('cc2old','setter_follow_up','2026-07-14T09:00Z');await event('cc2old','cc2_agreed','2026-08-19T08:00Z');await event('cc2old','closer_lost','2026-08-26T08:30Z');
   const before=await rows();assert.equal(before[0].state,'lost');const decided=before[0].decided_at;
   await taskPlan('cc2old');const s=await stock();assert.equal(s.counts.total_open,1);assert.equal(s.counts.cc2_planned,1);assert.equal(s.counts.task_planned,1);
   assert.deepEqual(s.next_by_month,[{month:'2026-10-01',stage:'cc2',count:1}]);assert.equal(s.current_actions[0].meeting_confirmed,true);
   const after=(await rows())[0];assert.equal(after.state,'lost');assert.equal(after.decided_at,decided);assert.equal(after.booked_date,'2026-07-14');
  });
  await scenario('task does not prove a call or calendar stage by itself',async()=>{
   await funnel('generic','2026-08-01T08:00Z');await event('generic','setter_qualified','2026-08-01T09:00Z');await taskPlan('generic','2026-10-14',undefined,false);
   const s=await stock();assert.equal(s.counts.task_planned,1);assert.equal(s.counts.closer_planned,0);assert.equal(s.current_actions[0].due_at,null);assert.equal(s.current_actions[0].meeting_confirmed,false);
   const p=await report();assert.equal(p.activity.closer_calls,0);assert.equal(p.activity.setter_calls,0);
  });
  await scenario('stale, withdrawn and missing-scope tasks cannot revive a lost process',async()=>{
   await funnel('stale','2026-08-01T08:00Z');await event('stale','closer_lost','2026-08-26T08:30Z');await taskPlan('stale',undefined,'2026-08-20T08:00Z');assert.equal((await stock()).counts.total_open,0);
   await db.exec("update close_funnel_events set payload=jsonb_set(payload,'{date_created}','\"2026-08-26T09:00:00Z\"') where source_kind='task'");assert.equal((await stock()).counts.total_open,1);
   await db.exec("delete from close_reconciliation_state where resource='antony_tasks'");assert.equal((await stock()).counts.total_open,0);
  });
  await scenario('Won, disqualification and new documented process block automatic task reopening',async()=>{
   for(const type of ['customer_won','setter_disqualified']){
    await funnel(type,'2026-08-01T08:00Z');await event(type,type,'2026-08-25T08:00Z');await taskPlan(type);
   }
   assert.equal((await stock()).counts.total_open,0);
   await funnel('old-process','2026-07-01T08:00Z','DMC',{lead_id:'same'});await event('old-process','closer_lost','2026-08-25T08:00Z');await taskPlan('same');
   await funnel('new-process','2026-09-01T08:00Z','DMC',{lead_id:'same',opened_at:'2026-09-01T07:00Z'});
   assert.equal((await stock()).counts.task_planned,0);
  });
  await scenario('duplicate matching calendar events stay neutral instead of guessing CC2',async()=>{
   await funnel('amb','2026-08-01T08:00Z');await event('amb','cc2_agreed','2026-08-25T08:00Z');await taskPlan('amb');await taskPlan('amb');
   const s=await stock();assert.equal(s.counts.cc2_planned,0);assert.equal(s.counts.task_planned,1);assert.equal(s.current_actions[0].meeting_confirmed,false);
  });
  await scenario('a still-open follow-up recorded before same-day conversation logging stays planned under explicit CC2 status',async()=>{
   await funnel('prelogged','2026-07-14T08:00Z');await event('prelogged','cc2_agreed','2026-08-19T08:00Z');await event('prelogged','closer_lost','2026-08-26T10:51:37Z');
   await db.exec("update close_funnel_leads set status_id='stat_ohblHuUMB0T7CwMfQSZhu0xWc2GDGaOEtCYOHeMMA6c'");await taskPlan('prelogged',undefined,'2026-08-26T08:52:49Z');
   assert.equal((await stock()).counts.cc2_planned,1);assert.equal((await rows())[0].state,'lost');
   await db.exec("update close_funnel_leads set status_id='stat_P1L8WuHSs14kYHbMuTRYQtuD98mjJIXMn9dnQNmEWCT'");assert.equal((await stock()).counts.total_open,0);
  });
  await scenario('completing a reminder preserves its active future calendar but never creates a call',async()=>{
   await funnel('reminder','2026-08-01T08:00Z');await event('reminder','cc2_agreed','2026-08-25T08:00Z');await taskPlan('reminder');
   assert.equal((await stock()).counts.cc2_planned,1);
   await db.exec("update close_funnel_events set is_current=false,withdrawn_at='2026-09-10T11:00Z' where source_kind='task'");
   let s=await stock();assert.equal(s.counts.cc2_planned,1);assert.equal(s.counts.task_planned,0);assert.equal(s.current_actions.length,0);
   await db.exec("update close_funnel_events set new_status='canceled' where source_kind='meeting'");s=await stock();assert.equal(s.counts.cc2_planned,0);
   assert.equal((await report()).activity.closer_calls,0);
  });
  await scenario('a proven CC2 calendar identity moves to its new month even when its reminder was not edited',async()=>{
   await funnel('move','2026-08-01T08:00Z');await event('move','cc2_agreed','2026-08-25T08:00Z');await taskPlan('move');
   await db.exec("update close_funnel_events set is_current=false where source_kind='meeting'");
   await db.exec("insert into close_funnel_events(lead_id,event_type,occurred_at,source_event_id,source_kind,new_status,source_updated_at,source_revision,payload,first_seen_at,last_seen_at) select lead_id,event_type,'2026-11-14T09:30Z',source_event_id,source_kind,new_status,'2026-09-09T08:00Z',repeat('b',64),payload,first_seen_at,last_seen_at from close_funnel_events where source_kind='meeting'");
   const s=await stock();assert.deepEqual(s.next_by_month,[{month:'2026-11-01',stage:'cc2',count:1}]);assert.equal(s.current_actions[0].due_date,'2026-11-14');assert.equal(s.counts.cc2_planned,1);
  });
  await scenario('lean base preserves every retained legacy activity, timeline, attendance and coverage field',async()=>{
   await funnel('equivalent');await activity('equivalent','equivalent','setter_qualified','2026-09-02T08:00Z');await activity('equivalent','equivalent','cc2_agreed','2026-09-03T08:00Z');await meeting('equivalent','2026-09-02T08:00Z');
   for(const period of ['day','week','month','three_months']) {
    const got=(await db.query('select get_antony_process_base_internal($1,$2) new,get_antony_process_metrics_legacy_internal($1,$2) old',[period,'2026-09-10'])).rows[0];
    for(const key of ['period','activity','lead_quality','setter_by_day','timeline','setter_attendance','coverage'])assert.deepEqual(got.new[key],got.old[key],period+':'+key);
   }
  });
  await scenario('Close-Up uses a later meeting on the same lead without requiring a process relation',async()=>{
   await funnel('replacement');await event('replacement','setter_no_show','2026-09-09T08:00Z');
   assert.equal((await stock()).critical_counts.no_show,1);
   await meeting('replacement','2026-10-14T08:00Z');await db.exec('delete from close_process_meetings');
   let s=await stock();assert.equal(s.critical_counts.total,0);assert.equal(s.counts.setter_no_show,0);
   assert.equal(s.next_by_month[0].month,'2026-10-01');
   assert.equal(s.scheduled_meetings.length,1);assert.equal(s.scheduled_meetings[0].lead_id,'replacement');assert.match(s.scheduled_meetings[0].starts_at,/2026-10-14/);
   await db.exec("update close_meetings set status='canceled'");s=await stock();assert.equal(s.critical_counts.no_show,1);
  });
  await scenario('Close-Up ignores meetings and outcomes recorded after its data cutoff',async()=>{
   await funnel('cutoff');await event('cutoff','setter_cancelled','2026-09-09T08:00Z');
   await event('cutoff','customer_won','2026-09-10T11:30Z');
   await meeting('cutoff','2026-10-14T08:00Z');
   await db.exec("update close_meetings set date_created='2026-09-10T11:30Z',date_updated='2026-09-10T11:30Z'");
   const s=await stock();assert.equal(s.critical_counts.cancelled,1);assert.deepEqual(s.next_by_month,[]);
   assert.equal((await rows())[0].won_at,null);
  });
  await scenario('Close-Up lists each lead once and separates calendar plans from unresolved leads',async()=>{
   await funnel('old','2026-08-01T08:00Z','DMC',{lead_id:'same',opened_at:'2026-08-01T07:00Z'});
   await event('old','setter_no_show','2026-08-01T08:00Z');
   await funnel('new','2026-09-01T08:00Z','DMC',{lead_id:'same',opened_at:'2026-09-01T07:00Z'});
   let s=await stock();assert.equal(s.critical_counts.total,1);assert.equal(s.critical_cases[0].process_id,'new');
   assert.equal(s.critical_counts.no_show,0);
  });
  await scenario('contact diagnosis separates reached, unavailable and unknown without changing the transfer denominator',async()=>{
   await funnel('contact');
   async function contact(gate,decision,contacts){
    const raw=await activity('contact','contact','setter_follow_up','2026-09-09T08:00Z');
    await db.query("update close_raw_activities set payload=$2 where close_activity_id=$1",[raw,JSON.stringify({custom_activity_type_id:'actitype_3YiimGlbRMzQxr2O3hPKHJ','custom.cf_8Bjba56AJvfLXwNKJwhjVJwSmCdaHBlTVyH25kxp3M1':gate,'custom.cf_LBuW6DB7vmgifhe2JUasZIhYvrOIjcAd7xB8hzYQrJ9':decision})]);
    await db.query("update close_activity_facts set decision_maker_contacts=$2,gatekeeper_contacts=$3,connected_calls=$3 where source_activity_id=$1",[raw,contacts,gate==='✅ Durchgestellt'?1:0]);
   }
   await contact('✅ Durchgestellt','2: 🟡 Follow Up',1);
   await contact('🛑 Kein Gatekeeper','2: 🟡 Follow Up',1);
   await contact('🛑 Kein Gatekeeper','Nicht erreicht',0);
   await contact('CEO nicht erreichbar',null,0);
   await contact('🛑 Kein Gatekeeper',null,0);
   const c=(await db.query("select get_transfer_breakdown('month','2026-09-10') j")).rows[0].j[0];
   assert.equal(c.evaluated,1);assert.equal(c.transferred,1);assert.equal(c.direct,3);assert.equal(c.unavailable,1);
   assert.equal(c.direct_reached,1);assert.equal(c.direct_not_reached,1);assert.equal(c.direct_unknown,1);assert.equal(c.unreachable_route_unknown,1);
  });
  await scenario('same-day future first meetings stay outside actual cohorts at the exact data cutoff',async()=>{
   await funnel('elapsed','2026-09-10T10:00:00Z');
   await funnel('boundary','2026-09-10T11:15:00Z');
   await funnel('future-today','2026-09-10T11:15:00.001Z');
   await funnel('future-month','2026-10-01T08:00:00Z');
   let groups=await cohorts();assert.equal(groups.reduce((n,g)=>n+g.booked_leads,0),2);
   const later=(await db.query("select get_close_process_cohorts_internal('2026-10-31') j")).rows[0].j;
   assert.equal(later.reduce((n,g)=>n+g.booked_leads,0),2);
   assert.equal((await rows()).length,4); // planning survives in the history
  });
  await scenario('August origin gains September conversations without entering the September cohort',async()=>{
   await funnel('august','2026-08-20T08:00:00Z');await funnel('september','2026-09-02T08:00:00Z');
   await activity('august','august','setter_qualified','2026-09-03T09:00:00Z');
   await activity('august','august','closer_completed','2026-09-04T09:00:00Z');
   await activity('september','september','setter_follow_up','2026-09-05T09:00:00Z');
   await activity('august','august','closer_completed','2026-10-02T09:00:00Z');
   const g=await cohorts(),old=g.find(r=>r.booked_date==='2026-08-20'),fresh=g.find(r=>r.booked_date==='2026-09-02');
   assert.equal(old.booked_leads,1);assert.equal(old.setter_arrived,1);assert.equal(old.closer_arrived,1);
   assert.equal(fresh.booked_leads,1);assert.equal(fresh.setter_arrived,1);assert.equal(fresh.closer_arrived,0);
   const august=(await db.query("select get_close_process_cohorts_internal('2026-08-31') j")).rows[0].j;
   assert.equal(august[0].setter_arrived,0);assert.equal(august[0].closer_arrived,0);
   const p=await origins();assert.equal(p.period_bridge.setter_calls,2);assert.equal(p.period_bridge.setter_from_prior_bookings,1);assert.equal(p.period_bridge.setter_from_period_bookings,1);assert.equal(p.period_bridge.closer_calls,1);
  });
  // The latest contract attributes acquisition to the explicit Close Opener.
  await reset();await funnel('same-totals');await activity('same-totals','same-totals','setter_qualified','2026-09-02T08:00Z');
  const oldTotals=(await report()).activity;
  await db.exec(read('../supabase/migrations/20260909075330_attribute_tracking_to_close_opener.sql'));
  assert.deepEqual((await report()).activity,oldTotals,'changing acquisition credit must not change performed activity');
  await scenario('North Data and Messe appointments follow explicit Opener, never the booking actor',async()=>{
   for(const source of ['North Data','Messe','DMC','LinkedIn']){
    await funnel(source);await db.query('update close_funnel_leads set lead_source=$2,opener_close_user_id=$3 where lead_id=$1',[source,source,F]);
    await db.query('update close_lead_reporting set lead_source=$2 where lead_id=$1',[source,source]);
    await meeting(source,'2026-09-09T08:00Z');
   }
   for(const r of await rows())assert.equal(r.owner,'felix');
   const c=await cohorts();assert.equal(c.reduce((n,r)=>n+r.booked_leads,0),4);assert(c.every(r=>r.owner==='felix'));
   const full=(await db.query("select get_antony_report('month','2026-09-10') j")).rows[0].j;
   assert.equal(full.planner.appointment_by_owner.felix,4);assert.equal(full.planner.appointment_by_owner.michael,undefined);
   assert.equal(full.process.owner_labels.felix,'Felix Wenk');
   assert.equal(full.process.setter_attendance.by_source.find(r=>r.source==='LinkedIn').owner,'felix');
  });
  await scenario('missing and historical Openers remain distinct and do not become Michael',async()=>{
   await funnel('missing');await funnel('historical');
   await db.query("update close_funnel_leads set opener_close_user_id='user_FPLFlQiqihA76cqW4vpbxfKYJFNsmGjtqNJpnOE87PF' where lead_id='historical'");
   const r=await rows();assert.equal(r.find(x=>x.lead_id==='missing').owner,'unassigned');
   assert.equal(r.find(x=>x.lead_id==='historical').owner,'user_FPLFlQiqihA76cqW4vpbxfKYJFNsmGjtqNJpnOE87PF');
   const p=await report();assert.equal(p.owner_labels.user_FPLFlQiqihA76cqW4vpbxfKYJFNsmGjtqNJpnOE87PF,'Paul Rietig');
   await db.query("update close_funnel_leads set opener_close_user_id=$1 where lead_id='missing'",[M]);assert.equal((await rows()).find(x=>x.lead_id==='missing').owner,'michael');
   await db.query("update close_funnel_leads set opener_close_user_id=$1 where lead_id='missing'",[F]);assert.equal((await rows()).find(x=>x.lead_id==='missing').owner,'felix');
  });
  await db.exec(read('../supabase/migrations/20260909080903_retain_linkedin_channel_except_cold_calls.sql'));
  await scenario('only LinkedIn Cold Calls has variable personal acquisition credit',async()=>{
   for(const source of ['LinkedIn','Inbound LinkedIn Ads','LinkedIn Follow Up','LinkedIn Cold Calls','Messe','North Data']){
    await funnel(source);await db.query('update close_funnel_leads set lead_source=$2,opener_close_user_id=$3 where lead_id=$1',[source,source,F]);
   }
   const r=await rows();
   for(const row of r)assert.equal(row.owner,['LinkedIn','Inbound LinkedIn Ads','LinkedIn Follow Up'].includes(row.source)?'linkedin':'felix');
   await db.query("update close_funnel_leads set opener_close_user_id=null where lead_id='LinkedIn Cold Calls'");
   assert.equal((await rows()).find(x=>x.source==='LinkedIn Cold Calls').owner,'unassigned');
  });
  if(failures) throw new Error(`${failures} process reporting scenarios failed`);
 } finally {await db.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
