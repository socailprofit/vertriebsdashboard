import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mapCustomActivity, CLOSE_USERS, ACTIVITY_TYPES, CUSTOM_FIELDS, metricTimeInReportingTimezone } from '../supabase/functions/_shared/close-mapping.ts';
import { prepareCustomReconciliation } from '../supabase/functions/_shared/close-reconciliation.ts';
// npm install --prefix /tmp/kpi-sql @electric-sql/pglite@0.3.14 --no-audit --no-fund
// node tests/verify-kpi-sql.mjs /tmp/kpi-sql/node_modules/@electric-sql/pglite/dist/index.js
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db = new PGlite();
const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
// Freeze only this disposable database's clock so the dated audit fixture also
// exercises the real retention/freshness checks when run in a later month.
await db.exec(`create or replace function pg_catalog.now() returns timestamptz language sql stable as $$select '2026-09-07T12:00:00Z'::timestamptz$$;`);
await db.exec(`create role anon; create role authenticated; create role service_role;
  create schema extensions; create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
  create schema auth; create function auth.uid() returns uuid language sql as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;
  create function public.has_antony_access() returns boolean language sql as $$select true$$;
  create function public.has_dashboard_access() returns boolean language sql as $$select true$$;`);
await db.exec(read('fixtures/kpi-schema.sql'));
await db.exec(read('../supabase/migrations/20260907121749_normalize_transfer_opportunities.sql'));
await db.exec(read('../supabase/migrations/20260908071339_reconcile_antony_kpis.sql'));
await db.exec(read('../supabase/migrations/20260908071341_add_antony_process_metrics.sql'));
await db.exec(read('../supabase/migrations/20260908071707_fix_lead_snapshot_delete_guard.sql'));
for(const [slug,id] of Object.entries(CLOSE_USERS)) await db.query('insert into sales_people(close_user_id,slug,display_name,color) values($1,$2,$2,$3)',[id,slug,'#123456']);
const keys={sourceActivityId:'source_activity_id',sourceType:'source_type',closeUserId:'close_user_id',leadId:'lead_id',occurredAt:'occurred_at',callsGross:'calls_gross',callsNet:'calls_net',talkSeconds:'talk_seconds',gatekeeperContacts:'gatekeeper_contacts',connectedCalls:'connected_calls',directDecisionMakerCalls:'direct_decision_maker_calls',decisionMakerContacts:'decision_maker_contacts',appointments:'appointments',setterCalls:'setter_calls',setterSuccesses:'setter_successes',closerCalls:'closer_calls',closerSecondCalls:'closer_second_calls',closerDecidedCalls:'closer_decided_calls',closerSales:'closer_sales',noShows:'no_shows',cancellations:'cancellations',rescheduledAppointments:'rescheduled_appointments',productFocus:'product_focus',mappingVersion:'mapping_version'};
function fixture(id,type,result,field,day='2026-09-01',user=CLOSE_USERS.antony,lead=id){
 const raw={id,lead_id:lead,user_id:user,activity_at:day+'T10:00:00Z',custom_activity_type_id:type,status:'published',custom_fields:[{id:field,value:result}]};
 const f=mapCustomActivity(raw),time=metricTimeInReportingTimezone(raw.activity_at);
 return {raw:{close_activity_id:id,activity_type:'custom_activity',close_user_id:user,lead_id:lead,occurred_at:raw.activity_at,payload:{custom_activity_type_id:type,['custom.'+field]:result}},
 fact:{...Object.fromEntries(Object.entries(f).map(([k,v])=>[keys[k],v])),metric_date:time.metricDate,metric_hour:time.metricHour,mapped_at:new Date().toISOString()}};
}
let fixtures=[fixture('setting',ACTIVITY_TYPES.setterCall,'✅ Closer terminiert',CUSTOM_FIELDS.setterResult,'2026-08-31'),fixture('cc2',ACTIVITY_TYPES.closerCall,'2. 🔥 CC2 vereinbart',CUSTOM_FIELDS.closerResult),fixture('sale',ACTIVITY_TYPES.closerCall,'1. ✅ Verkauft - in CC1',CUSTOM_FIELDS.closerResult,'2026-09-04'),fixture('gf',ACTIVITY_TYPES.openingCall,'GF nicht erreichbar',CUSTOM_FIELDS.openingGatekeeperResult,'2026-09-01',CLOSE_USERS.michael),fixture('transfer',ACTIVITY_TYPES.openingCall,'✅ Durchgestellt',CUSTOM_FIELDS.openingGatekeeperResult,'2026-09-01',CLOSE_USERS.michael)];
const won={opportunity_id:'won',lead_id:'customer',opener_close_user_id:null,setter_close_user_id:null,closer_close_user_id:CLOSE_USERS.antony,won_at:'2026-09-04T12:00:00Z',won_date:'2026-09-04',status_id:'stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL',value_cents:1520000,value_period:'one_time',mapping_version:'test',payload:{}};
await db.exec(`insert into close_activity_facts(source_activity_id,source_type,close_user_id,occurred_at,metric_date,metric_hour,calls_gross,calls_net,mapping_version) values ('call','call','${CLOSE_USERS.michael}','2026-09-01T08:00Z','2026-09-01',10,1,1,'test');`);
let epoch=Date.parse('2026-09-07T12:00:00Z')-20000;
function reportingRows(items,opps) {
 return [...new Set([...items.filter(x=>x.fact.setter_calls===1||x.fact.appointments===1).map(x=>x.fact.lead_id),...opps.map(x=>x.lead_id)])].map(lead_id=>({lead_id,opener_close_user_id:CLOSE_USERS.felix,lead_source:'LinkedIn'}));
}
async function reconcile(items=fixtures,opps=[won],leads=reportingRows(items,opps)) {
 epoch+=1000;
 return db.query('select reconcile_close_custom_and_won($1,$2,$3,$4,$5,$6,$7) result', ['2026-07-01','2026-09-07',new Date(epoch).toISOString(),JSON.stringify(items.map(x=>x.raw)),JSON.stringify(items.map(x=>x.fact)),JSON.stringify(opps),JSON.stringify(leads)]);
}
await reconcile();
let first=await db.query("select calls_gross,calls_net,gatekeeper_contacts,connected_calls from daily_sales_metrics where metric_date='2026-09-01' and sales_person_id=(select id from sales_people where slug='michael')");
assert.deepEqual(first.rows[0],{calls_gross:1,calls_net:1,gatekeeper_contacts:1,connected_calls:1});
for(const [period,reference,setting,closers,sales] of [['day','2026-09-01',0,1,0],['week','2026-09-04',1,2,1],['month','2026-09-04',0,2,1]]){
 const r=(await db.query('select * from get_antony_closing_metrics_internal($1,$2)',[period,reference])).rows[0];
 assert.equal(Number(r.setter_calls),setting);assert.equal(Number(r.closer_calls),closers);assert.equal(Number(r.closer_sales),sales);
 if(period==='day'){assert.equal(r.setter_success_rate,null);assert.equal(r.closer_success_rate,null);}
 if(period==='week')assert.equal(Number(r.closer_success_rate),100);
}
const weekly=(await db.query("select get_weekly_review_kpis('2026-08-31') j")).rows[0].j;
assert.equal(weekly.closing.setter_calls,1);assert.equal(weekly.closing.closer_period_ratio,200);assert.equal(weekly.closing.new_customers,1);
let repeat=await reconcile();assert.equal(repeat.rows[0].result.custom_before,5);assert.equal(repeat.rows[0].result.custom_after,5);
assert.equal(Number((await db.query('select count(*) n from close_activity_facts')).rows[0].n),6);
// A deleted/draft activity and a Won changed to lost disappear, without touching calls.
await reconcile(fixtures.filter(x=>x.fact.source_activity_id!=='sale'),[]);
assert.equal(Number((await db.query("select count(*) n from close_activity_facts where source_type='call'")).rows[0].n),1);
assert.equal(Number((await db.query('select count(*) n from close_opportunity_facts')).rows[0].n),0);
// A newer close-status ends earlier rescheduled/CC2 pipeline states.
const pending=fixture('pending',ACTIVITY_TYPES.closerCall,'2. 🔥 CC2 vereinbart',CUSTOM_FIELDS.closerResult,'2026-09-01',CLOSE_USERS.antony,'same-lead');
const cancel=fixture('cancel',ACTIVITY_TYPES.noShow,'⛔ Abgesagt',CUSTOM_FIELDS.closerNoShow,'2026-09-04',CLOSE_USERS.antony,'same-lead');
await reconcile([pending,cancel],[]);
assert.equal((await db.query("select get_antony_pipeline_snapshot('2026-09-07') j")).rows[0].j.counts.total_open,0);
// Invalid/stale snapshots fail atomically.
await assert.rejects(db.query('select reconcile_close_custom_and_won($1,$2,$3,$4,$5,$6,$7)',['2026-07-01','2026-09-07',new Date(epoch-1000).toISOString(),'[]','[]','[]','[]']));
const bad=fixture('bad',ACTIVITY_TYPES.setterCall,'✅ Closer terminiert',CUSTOM_FIELDS.setterResult,'2026-06-01');
await assert.rejects(reconcile([bad],[]));
assert.equal(Number((await db.query('select count(*) n from close_activity_facts')).rows[0].n),3);
const acl=(await db.query("select has_function_privilege('anon','public.reconcile_close_custom_and_won(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb)','execute') anon,has_function_privilege('authenticated','public.reconcile_close_custom_and_won(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb)','execute') authenticated,has_function_privilege('service_role','public.reconcile_close_custom_and_won(date,date,timestamptz,jsonb,jsonb,jsonb,jsonb)','execute') service_role")).rows[0];
assert.deepEqual(acl,{anon:false,authenticated:false,service_role:true});
// Late actual hours remain visible, and historical custom corrections preserve unrelated archives.
await db.exec(`insert into monthly_kpi_snapshots(month_start,calls_gross,newsletters) values('2026-08-01',999,7);
  insert into close_newsletter_sends(close_email_id,close_user_id,sent_at,mapping_version) values('email','${CLOSE_USERS.michael}','2026-08-06T10:00Z','test');`);
const late=fixture('late',ACTIVITY_TYPES.setterCall,'✅ Closer terminiert',CUSTOM_FIELDS.setterResult,'2026-08-06');
late.raw.occurred_at=late.fact.occurred_at='2026-08-06T16:16:00Z';late.fact.metric_hour=18;
const oldTransfer=fixture('old-transfer',ACTIVITY_TYPES.openingCall,'✅ Durchgestellt',CUSTOM_FIELDS.openingGatekeeperResult,'2026-08-06',CLOSE_USERS.michael);
await reconcile([late,oldTransfer],[]);
const series=(await db.query("select * from get_antony_performance_series_internal('day','2026-08-06')")).rows;
assert.equal(series.at(-1).metric_hour,18);assert.equal(Number(series.at(-1).closer_appointments_cumulative),1);
assert.deepEqual((await db.query("select calls_gross,newsletters,gatekeeper_contacts,connected_calls from monthly_kpi_snapshots where month_start='2026-08-01'")).rows[0],{calls_gross:999,newsletters:7,gatekeeper_contacts:1,connected_calls:1});
assert.equal(Number((await db.query('select sum(newsletters) n from daily_sales_metrics')).rows[0].n),1);
// Lead qualification follows the booking actor, independent of current Opener and Setter.
const booking=(id,lead,day,user=CLOSE_USERS.michael)=>fixture(id,ACTIVITY_TYPES.followUp,'Entscheider: Termin vereinbart',CUSTOM_FIELDS.followUpDecisionMakerResult,day,user,lead);
const setter=(id,lead,result,day='2026-09-04')=>fixture(id,ACTIVITY_TYPES.setterCall,result,CUSTOM_FIELDS.setterResult,day,CLOSE_USERS.antony,lead);
const status=(id,lead,result,day='2026-09-02')=>fixture(id,ACTIVITY_TYPES.noShow,result,CUSTOM_FIELDS.setterNoShow,day,CLOSE_USERS.antony,lead);
const processItems=[
 booking('book1','lead1','2026-08-31'), booking('book1-repeat','lead1','2026-09-01'),
 setter('fu1','lead1','🔎 Setter Follow Up','2026-09-01'),setter('fu2','lead1','🔎 Setter Follow Up','2026-09-02'),setter('qual1','lead1','✅ Closer terminiert'),
 fixture('sale1',ACTIVITY_TYPES.closerCall,'3. ✅ Verkauft - in CC2 🔥',CUSTOM_FIELDS.closerResult,'2026-09-04',CLOSE_USERS.antony,'lead1'),
 booking('book2','lead2','2026-09-01',CLOSE_USERS.felix),status('ns2','lead2','Nicht erschienen'),status('cancel2','lead2','⛔ Abgesagt','2026-09-03'),
 booking('book3','lead3','2026-09-01',CLOSE_USERS.felix),
 booking('book4','lead4','2026-09-01'),status('ns4','lead4','Nicht erschienen'),setter('qual4','lead4','✅ Closer terminiert'),
 booking('book5','lead5','2026-09-01'),setter('conflict5a','lead5','✅ Closer terminiert'),setter('conflict5b','lead5','❌ Disqualifiziert'),
 setter('prior-unbooked','lead6','❌ Disqualifiziert'),
];
const processWon={...won,lead_id:'lead1'};
await reconcile(processItems,[processWon]);
const processAt=async(period,date)=>(await db.query('select get_antony_process_metrics_internal($1,$2) j',[period,date])).rows[0].j;
const processWeek=await processAt('week','2026-09-04');
assert.equal(processWeek.activity.setter_calls,7);assert.equal(processWeek.activity.setter_followups,2);
assert.deepEqual(processWeek.lead_quality,{assessed_leads:4,qualified:2,followup:0,disqualified:1,unrated:1});
const bookedMichael=processWeek.booking_cohort.find(x=>x.owner==='michael');
assert.equal(bookedMichael.booked_leads,3);assert.equal(bookedMichael.setter_arrived,3);
assert.equal(bookedMichael.qualified,2);assert.equal(bookedMichael.no_show,0);assert.equal(bookedMichael.unrated,1);
assert.equal(bookedMichael.closer_arrived,1);assert.equal(bookedMichael.sold_leads,1);assert.equal(bookedMichael.new_customers,1);
const bookedFelix=processWeek.booking_cohort.find(x=>x.owner==='felix');
assert.equal(bookedFelix.booked_leads,2);assert.equal(bookedFelix.setter_arrived,0);
assert.equal(bookedFelix.cancelled,1);assert.equal(bookedFelix.no_show,0);assert.equal(bookedFelix.pending,1);
const attributed=processWeek.quality_by_source.find(x=>x.owner==='michael');
assert.equal(attributed.assessed_leads,3);assert.equal(attributed.attribution,'booking_activity');
const fallback=processWeek.quality_by_source.find(x=>x.owner==='felix');
assert.equal(fallback.assessed_leads,1);assert.equal(fallback.attribution,'current_opener');
assert.equal((await processAt('day','2026-09-01')).booking_cohort.find(x=>x.owner==='michael').setter_arrived,1);
assert.equal((await processAt('month','2026-09-04')).booking_cohort.find(x=>x.owner==='michael').booked_leads,3);
assert.equal((await processAt('three_months','2026-09-04')).booking_cohort.find(x=>x.owner==='michael').booked_leads,3);
assert.equal((await processAt('day','2026-09-07')).booking_cohort.length,0);
// Missing appointment-only metadata must fail before replacing facts.
await assert.rejects(reconcile(processItems,[processWon],reportingRows(processItems,[processWon]).filter(x=>x.lead_id!=='lead2')));
assert.equal(Number((await db.query('select count(*) n from close_lead_reporting')).rows[0].n),6);
await db.exec('create or replace function public.has_antony_access() returns boolean language sql as $$select false$$;');
await assert.rejects(db.query("select get_antony_process_metrics('week','2026-09-04')"));
await db.exec('create or replace function public.has_antony_access() returns boolean language sql as $$select true$$;');
assert.equal((await db.query("select has_function_privilege('anon','public.get_antony_process_metrics(text,date)','execute') allowed")).rows[0].allowed,false);
assert.equal((await db.query("select has_function_privilege('authenticated','public.get_antony_process_metrics_internal(text,date)','execute') allowed")).rows[0].allowed,false);
console.log('PASS: booking cohorts, real booking owner vs Setter/Opener, repeated follow-ups, contradictory results, late arrival after No-Show, cancelled/pending separation, sales/Won, all four periods, metadata rollback, private access.');
// Optional privately held CRM fixture proves the same real comparisons through SQL.
if(process.argv[3]) {
  const prepared=prepareCustomReconciliation(JSON.parse(fs.readFileSync(process.argv[3],'utf8')),'2026-07-01','2026-09-07');
  const actual=prepared.facts.map(f=>{const raw=prepared.raw.find(r=>r.id===f.sourceActivityId);const time=metricTimeInReportingTimezone(f.occurredAt);return {
    raw:{close_activity_id:raw.id,activity_type:'custom_activity',close_user_id:raw.user_id,lead_id:raw.lead_id,occurred_at:raw.activity_at,payload:raw},
    fact:{...Object.fromEntries(Object.entries(f).map(([k,v])=>[keys[k],v])),metric_date:time.metricDate,metric_hour:time.metricHour,mapped_at:new Date().toISOString()}
  }});
  await reconcile(actual,[]);
  for(const [period,date,setting,closer,cc2] of [['day','2026-09-04',3,0,0],['week','2026-09-04',8,1,1],['month','2026-08-31',8,6,3],['month','2026-09-07',8,1,1]]){
    const r=(await db.query('select * from get_antony_closing_metrics_internal($1,$2)',[period,date])).rows[0];
    assert.equal(Number(r.setter_calls),setting);assert.equal(Number(r.closer_calls),closer);assert.equal(Number(r.closer_second_calls),cc2);
    const points=(await db.query('select * from get_antony_performance_series_internal($1,$2)',[period,date])).rows;
    assert.equal(Number(points.at(-1).closer_calls_cumulative),closer);
  }
  if(process.argv[4]) {
    const evidence=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));
    const extra=evidence.bookings.flatMap(x=>x.results).map(x=>{
      const item=fixture(x.id,x.custom_activity_type_id,x.custom_fields[0].value,x.custom_fields[0].id,x.activity_at.slice(0,10),x.user_id,x.lead_id);
      item.raw.occurred_at=item.fact.occurred_at=x.activity_at;
      const time=metricTimeInReportingTimezone(x.activity_at);item.fact.metric_date=time.metricDate;item.fact.metric_hour=time.metricHour;
      return item;
    });
    const combined=[...actual,...extra];
    const metadata=reportingRows(combined,[]).map(row=>evidence.metadata.find(x=>x.lead_id===row.lead_id)||{lead_id:row.lead_id,opener_close_user_id:null,lead_source:null});
    await reconcile(combined,[],metadata);
    const observed=await processAt('week','2026-09-04');
    const booked=observed.booking_cohort.find(x=>x.source==='LinkedIn'&&x.owner==='michael');
    assert.equal(booked.booked_leads,1);assert.equal(booked.setter_arrived,1);assert.equal(booked.followup,1);assert.equal(booked.no_show,0);
    assert.equal(observed.quality_by_source.find(x=>x.source==='LinkedIn').attribution,'booking_activity');
    const august=await processAt('month','2026-08-31');
    assert.equal(august.quality_by_source.find(x=>x.source==='DMC').attribution,'current_opener');
    console.log('PASS: real linked booking Sep2 Michael -> Setter Sep4 Antony, LinkedIn, Setter Follow Up; DMC August has explicitly marked current-Opener fallback.');
  }
  console.log('PASS: real Close fixture through SQL: day 3 setters; week 8 setters/1 CC2; August 8 setters/6 closers; September 8 setters/1 CC2; graph totals match.');
}
console.log('PASS: migration, day/week/month, Antony setting, explicit decisions, GF, AI parity, stable IDs, replacement, rollback, pipeline closure, late hours, archive preservation and RPC grants.');
await db.close();
