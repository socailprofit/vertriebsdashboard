import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;
create schema extensions;create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
create schema auth;create function auth.uid() returns uuid language sql as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;
create function has_dashboard_access() returns boolean language sql as $$select true$$;
create function has_antony_access() returns boolean language sql as $$select true$$;
create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select '2026-09-08T12:00Z'::timestamptz$$;`);
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
await db.exec(read('fixtures/kpi-schema.sql'));
await db.exec('create table antony_performance_goals(id integer);');
for(const m of ['20260907121749_normalize_transfer_opportunities','20260908071339_reconcile_antony_kpis','20260908071341_add_antony_process_metrics','20260908071707_fix_lead_snapshot_delete_guard','20260908082307_audit_complete_sales_journey','20260908085704_fix_booking_cohort_filters'])await db.exec(read('../supabase/migrations/'+m+'.sql'));
async function insert(table,rows){if(rows?.length)await db.query(`insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},$1)`,[JSON.stringify(rows)]);}
if(process.argv[3]){
 const s=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
 for(const [t,k] of [['sales_people','people'],['close_raw_activities','raw'],['close_activity_facts','facts'],['close_opportunity_facts','opportunities'],['close_lead_reporting','leads']])await insert(t,s[k]);
 const results={};
 for(const [label,period,date] of [['day','day','2026-09-08'],['week','week','2026-09-08'],['month','month','2026-09-08'],['august','month','2026-08-31'],['quarter','three_months','2026-09-08']]){
  const p=(await db.query('select get_antony_process_metrics_internal($1,$2) j',[period,date])).rows[0].j;
  results[label]=p;
  assert.equal(p.reporting_version,'2026-09-08.cohort-v3');
  for(const g of p.funnel_by_source){
   const keys=['booked_leads','setter_arrived','closer_qualified','closer_arrived','decided_leads','sold_leads','new_customers'];
   keys.slice(1).forEach((k,i)=>assert(g[k]<=g[keys[i]],`${label} ${k} must be a subset of ${keys[i]}`));
   assert(g.cc2_sold+g.cc2_lost<=g.cc2_decided);assert(g.cc2_decided<=g.cc2_held);assert(g.cc2_held<=g.cc2_agreed);
  }
  const b=p.period_bridge;
  assert.equal(b.setter_calls,p.activity.setter_calls);
  assert.equal(b.setter_from_period_bookings+b.setter_from_prior_bookings+b.setter_without_booking,b.setter_calls);
  assert.equal(b.customers_from_period_bookings+b.customers_from_prior_bookings+b.customers_without_booking,b.new_customers);
  if(period!=='three_months'){
   const c=(await db.query('select * from get_antony_closing_metrics_internal($1,$2)',[period,date])).rows[0];
   assert.equal(Number(c.new_customers),b.new_customers);assert.equal(Number(c.setter_calls),b.setter_calls);
   const chart=(await db.query('select * from get_antony_performance_series_internal($1,$2)',[period,date])).rows;
   assert.equal(Number(chart.at(-1).appointments_cumulative),Number(c.appointments));
   assert.equal(Number(chart.at(-1).closer_calls_cumulative),Number(c.closer_calls));
   if(period!=='day')assert.equal(Number(chart.at(-1).new_customers_cumulative),b.new_customers);
   p.closing=c;p.performance=chart;
  }
 }
 results.open=(await db.query("select get_antony_pipeline_snapshot('2026-09-08') j")).rows[0].j;
 results.transfer=(await db.query("select get_transfer_breakdown('day','2026-09-08') j")).rows[0].j;
 const felix=results.transfer.find(x=>x.slug==='felix');assert.equal(felix.evaluated,4);assert.equal(felix.transferred,1);assert.equal(felix.unavailable,5);
 assert.equal(results.month.activity.setter_calls,8);assert.equal(results.month.period_bridge.setter_leads,8);
 assert.equal(results.month.setter_by_day.filter(x=>x.owner==='michael').reduce((n,x)=>n+x.calls,0),7);
 assert.equal(results.month.setter_by_day.filter(x=>x.owner==='antony').reduce((n,x)=>n+x.calls,0),1);
 assert.equal(results.month.activity.setter_followups,6);assert.equal(results.month.activity.setter_disqualified,2);
 assert(results.open.counts.setter_followup>0);
 if(process.argv[4])fs.writeFileSync(process.argv[4],JSON.stringify(results,null,2),{mode:0o600});
 console.log('PASS real snapshot: day/week/month/August/quarter, all linked subsets, period origins, eight Setters, customer/chart parity, Felix 1/4 with 5 unreachable excluded, open Setter follow-ups.');
 await db.exec('truncate close_activity_facts,close_raw_activities,close_opportunity_facts,close_lead_reporting;');
}
const M='user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',A='user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR';
let seq=0;
async function event(lead,date,flags={},results={}){
 const id='synthetic-'+ ++seq,at=date.includes('T')?date:date+'T10:00Z';
 const fields={setter_result:'cf_Hf5tqUY58guUQ8T1IfImjdqQaEDYifo4QBNTjhm4VCo',closer_result:'cf_voRgeFZ9DSbfWqrwRSAfzr5ApVvUIzAyLOnkLdOp7qn',setter_status:'cf_tVzfPTMC6NzmyIvUg2gtxeyiMLfDEwlGudAV0qWuygz',closer_status:'cf_t4uNVPJbWYqRTGSVq7IZ3emn5vQAbKySFp9jT1koe1q'};
 await db.query('insert into close_raw_activities(close_activity_id,activity_type,close_user_id,lead_id,occurred_at,payload) values($1,\'custom_activity\',$2,$3,$4,$5)',[id,flags.appointments?M:A,lead,at,JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v])=>['custom.'+fields[k],v])))]);
 const cols=Object.keys(flags);
 await db.query(`insert into close_activity_facts(source_activity_id,source_type,close_user_id,lead_id,occurred_at,metric_date,metric_hour,mapping_version${cols.length?','+cols.join(','):''}) values($1,'custom_activity',$2,$3,$4,($4::timestamptz at time zone 'Europe/Berlin')::date,extract(hour from $4::timestamptz at time zone 'Europe/Berlin'),'test'${cols.map((_,i)=>',$'+(i+5)).join('')})`,[id,flags.appointments?M:A,lead,at,...Object.values(flags)]);
}
async function win(id,lead,date,deal='Neukunde'){
 await db.query("insert into close_opportunity_facts(opportunity_id,lead_id,closer_close_user_id,won_at,won_date,status_id,value_period,mapping_version,payload) values($1,$2,$3,$4::date+time '12:00',$4,'stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL','one_time','test',$5)",[id,lead,A,date,JSON.stringify({'custom.cf_wlmXj1eeFF6P9Zoz49WNuFULPX0jsKRyArR8O4PX6ZQ':deal})]);
}
await event('cc2','2026-08-10',{appointments:1});await event('cc2','2026-08-12',{setter_calls:1,setter_successes:1},{setter_result:'✅ Closer terminiert'});
await event('cc2','2026-08-20',{closer_calls:1,closer_second_calls:1},{closer_result:'2. 🔥 CC2 vereinbart'});
await event('cc2','2026-09-02T16:00Z',{closer_calls:1,closer_sales:1,closer_decided_calls:1},{closer_result:'3. ✅ Verkauft - in CC2 🔥'});await win('w1','cc2','2026-09-02');
await win('duplicate','cc2','2026-09-03');await win('upsell','upsell-lead','2026-09-04','Upsell');await win('renew','renew-lead','2026-09-04','Verlängerung');
await event('old-customer','2026-07-02',{appointments:1});await win('old-win','old-customer','2026-08-03');
await event('old-customer','2026-09-02',{closer_calls:1,closer_decided_calls:1,closer_sales:1},{closer_result:'1. ✅ Verkauft - in CC1'});
await event('followup','2026-09-01',{appointments:1});await event('followup','2026-09-02',{setter_calls:1},{setter_result:'🔎 Setter Follow Up'});
await event('cancel','2026-09-01',{closer_calls:1,closer_second_calls:1},{closer_result:'2. 🔥 CC2 vereinbart'});await event('cancel','2026-09-03',{}, {closer_status:'⛔ Abgesagt'});
let p=(await db.query("select get_antony_process_metrics_internal('three_months','2026-09-08') j")).rows[0].j;
const sum=k=>p.funnel_by_source.reduce((n,x)=>n+x[k],0);
assert.equal(sum('cc2_agreed'),1);assert.equal(sum('cc2_held'),1);assert.equal(sum('cc2_sold'),1);assert.equal(sum('new_customers'),1);assert.equal(sum('unlinked_customer'),1);
p=(await db.query("select get_antony_process_metrics_internal('month','2026-09-08') j")).rows[0].j;
assert.equal(p.period_bridge.new_customers,1);assert.equal(p.period_bridge.customers_from_prior_bookings,1);assert.equal(p.period_bridge.sales_after_prior_won,1);assert.equal(p.period_bridge.cc2_calls,1);
let o=(await db.query("select get_antony_pipeline_snapshot('2026-09-08') j")).rows[0].j;
assert.equal(o.counts.setter_followup,1);assert.equal(o.counts.pending_decision_cc2,0);assert.equal(o.counts.total_open,1);
// A later confirmation must not remove the already linked customer from its journey.
await event('cc2','2026-09-04',{closer_calls:1,closer_sales:1,closer_decided_calls:1},{closer_result:'3. ✅ Verkauft - in CC2 🔥'});
await event('cancel','2026-08-30',{appointments:1});
await event('cancel','2026-08-31',{setter_calls:1,setter_successes:1},{setter_result:'✅ Closer terminiert'});
for(const [lead,status] of [['cc2-no-show','Nicht erschienen'],['cc2-rescheduled','🔄 Termin verschoben']]){
 await event(lead,'2026-09-01',{appointments:1});
 await event(lead,'2026-09-01T14:00Z',{setter_calls:1,setter_successes:1},{setter_result:'✅ Closer terminiert'});
 await event(lead,'2026-09-02',{closer_calls:1,closer_second_calls:1},{closer_result:'2. 🔥 CC2 vereinbart'});
 await event(lead,'2026-09-03',{}, {closer_status:status});
}
await event('cc2-lost','2026-09-01',{appointments:1});
await event('cc2-lost','2026-09-02',{setter_calls:1,setter_successes:1},{setter_result:'✅ Closer terminiert'});
await event('cc2-lost','2026-09-03',{closer_calls:1,closer_second_calls:1},{closer_result:'2. 🔥 CC2 vereinbart'});
await event('cc2-lost','2026-09-04',{closer_calls:1,closer_decided_calls:1},{closer_result:'4. ❌ Nicht verkauft'});
p=(await db.query("select get_antony_process_metrics_internal('three_months','2026-09-08') j")).rows[0].j;
assert.equal(sum('new_customers'),1);assert.equal(sum('cc2_cancelled'),1);assert.equal(sum('cc2_no_show'),1);assert.equal(sum('cc2_rescheduled'),1);
assert.equal(sum('cc2_lost'),1);assert.equal(sum('cc2_waiting'),0);assert.equal(sum('cc2_open'),0);
assert.equal(sum('cc2_decided'),sum('cc2_sold')+sum('cc2_lost'));
o=(await db.query("select get_antony_pipeline_snapshot('2026-09-08') j")).rows[0].j;
assert.equal(o.counts.total_open,3);assert.equal(o.counts.closer_no_show,1);assert.equal(o.counts.rescheduled_closer,1);
await event('cc1-direct','2026-09-01',{appointments:1});
await event('cc1-direct','2026-09-02',{setter_calls:1,setter_successes:1},{setter_result:'✅ Closer terminiert'});
await event('cc1-direct','2026-09-03',{closer_calls:1,closer_sales:1,closer_decided_calls:1},{closer_result:'1. ✅ Verkauft - in CC1'});
await win('cc1-won','cc1-direct','2026-09-03');
p=(await db.query("select get_antony_process_metrics_internal('three_months','2026-09-08') j")).rows[0].j;
assert.equal(sum('cc1_sold'),1);assert.equal(sum('cc2_sold'),1);assert.equal(sum('sold_leads'),2);assert.equal(sum('new_customers'),2);
const acq=(await db.query("select count(*) n from get_customer_acquisitions_internal('2026-09-08')")).rows[0];assert.equal(Number(acq.n),3);
const permissions=(await db.query("select has_function_privilege('anon','get_antony_journey_metrics_internal(text,date)','execute') a,has_function_privilege('authenticated','get_customer_acquisitions_internal(date)','execute') b,has_function_privilege('anon','get_transfer_breakdown(text,date)','execute') c")).rows[0];assert.deepEqual(permissions,{a:false,b:false,c:false});
console.log('PASS synthetic: August booking → September CC2 sale, same-day Won without invented time, duplicate opportunities, upsell/renewal exclusion, later yes after prior-month Won, open FU and cancelled CC2, private helper privileges.');
console.log('PASS CC2 state: lost, cancelled, no-show and rescheduled are distinct; later repeated sales confirmation preserves the linked first acquisition.');

// A repeat booking must never move the same lead into a different cohort.
await event('rebooking','2026-08-31',{appointments:1});
await event('rebooking','2026-09-02',{appointments:1});
await event('rebooking','2026-09-03',{setter_calls:1},{setter_result:'🔎 Setter Follow Up'});
await event('future-booking','2026-09-02',{setter_calls:1},{setter_result:'🔎 Setter Follow Up'});
await event('future-booking','2026-09-04',{appointments:1});
await db.query("insert into close_booking_history values('old-booking','outside-retention',$1,'2026-05-12T10:00Z','2026-05-12')",[M]);
await event('outside-retention','2026-09-07',{appointments:1});
await event('outside-retention','2026-09-07T14:00Z',{setter_calls:1},{setter_result:'🔎 Setter Follow Up'});
for(const [period,date] of [['day','2026-09-03'],['week','2026-09-08'],['month','2026-09-08'],['three_months','2026-09-08']]){
 const first=(await db.query("select booked_date::text from get_close_first_bookings_internal($1) where lead_id='rebooking'",[date])).rows[0];
 assert.equal(first.booked_date,'2026-08-31');
 const report=(await db.query('select get_antony_process_metrics_internal($1,$2) j',[period,date])).rows[0].j;
 for(const key of ['setter_calls','closer_calls','cc2_agreed','setter_qualified','setter_followups','setter_disqualified'])
  assert.equal(report.activity_by_origin.reduce((n,r)=>n+Number(r[key]||0),0),report.activity[key],`${period}: ${key} origin sum`);
 assert.equal(report.activity_by_origin.reduce((n,r)=>n+Number(r.new_customers||0),0),report.period_bridge.new_customers);
 assert(!JSON.stringify(report.activity_by_origin).includes('rebooking'));
}
p=(await db.query("select get_antony_process_metrics_internal('month','2026-09-08') j")).rows[0].j;
assert(p.activity_by_origin.some(r=>r.booked_date==='2026-08-31' && r.setter_calls===1));
assert(p.activity_by_origin.some(r=>r.booked_date===null && r.setter_calls===1));
assert(p.activity_by_origin.some(r=>r.booked_date==='2026-05-12' && r.setter_calls===1));
assert(!p.cohort_history.some(r=>r.booked_date==='2026-05-12'));
assert.equal((await db.query("select booked_date::text from get_close_first_bookings_internal('2026-09-08') where lead_id='outside-retention'")).rows[0].booked_date,'2026-05-12');
// Exercise the actual production transaction, including deletion and rejection
// of stale/incomplete snapshots, rather than testing only a derived SELECT.
const raw=(await db.query('select * from close_raw_activities')).rows;
const facts=(await db.query('select * from close_activity_facts')).rows;
const won=(await db.query('select * from close_opportunity_facts')).rows;
const required=new Set([...facts.filter(f=>['setter_calls','appointments','closer_calls','no_shows','cancellations','rescheduled_appointments'].some(k=>f[k]>0)).map(f=>f.lead_id),...won.map(w=>w.lead_id)]);
const leads=[...required].map(lead_id=>({lead_id,opener_close_user_id:M,lead_source:'LinkedIn'}));
let history=[...(await db.query('select * from close_booking_history')).rows,...facts.filter(f=>f.appointments===1).map(f=>Object.fromEntries(['source_activity_id','lead_id','close_user_id','occurred_at','metric_date'].map(k=>[k,f[k]])))];
const rpc=(at,bookings)=>db.query("select reconcile_close_sales_snapshot('2026-07-01','2026-09-08',$1,$2,$3,$4,$5,$6) j",[at,...[raw,facts,won,leads,bookings].map(JSON.stringify)]);
await rpc('2026-09-08T12:00:00Z',history);
await assert.rejects(()=>rpc('2026-09-08T12:00:00Z',history),/Stale reconciliation snapshot/);
await assert.rejects(()=>rpc('2026-09-08T12:00:01Z',[]),/Incomplete booking snapshot/);
assert.equal(Number((await db.query('select count(*) n from close_booking_history')).rows[0].n),history.length);
history=history.filter(h=>h.source_activity_id!=='old-booking');
await rpc('2026-09-08T12:00:01Z',history);
assert.equal((await db.query("select booked_date::text from get_close_first_bookings_internal('2026-09-08') where lead_id='outside-retention'")).rows[0].booked_date,'2026-09-07');
const priv=(await db.query("select has_table_privilege('anon','close_booking_history','select') a,has_table_privilege('authenticated','close_booking_history','select') b,has_function_privilege('authenticated','reconcile_close_sales_snapshot(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb)','execute') c")).rows[0];
assert.deepEqual(priv,{a:false,b:false,c:false});
console.log('PASS fixed booking origin: rebookings, cross-month/week, before retention, future booking stays unknown, every period reconciles to origin totals.');
console.log('PASS actual reconciliation RPC: atomic full history, deletion correction, stale/incomplete snapshot rejection and private permissions.');
await db.close();
