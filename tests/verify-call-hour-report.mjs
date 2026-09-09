import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// node tests/verify-call-hour-report.mjs /tmp/dashboard-hour-tests/node_modules/@electric-sql/pglite/dist/index.js
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
const read = (name) => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
await db.exec(`create role anon; create role authenticated;
  create schema extensions; create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
  create schema auth; create function auth.uid() returns uuid language sql stable as $$
    select case when current_setting('test.denied',true)='true' then null else '11111111-1111-1111-1111-111111111111'::uuid end $$;
  create function public.has_dashboard_access() returns boolean language sql stable as $$select auth.uid() is not null$$;
  create function public.get_close_opener_internal(text) returns text language sql stable as $$select case when $1='linkedin' then 'linkedin' else 'michael' end$$;`);
await db.exec(read('fixtures/kpi-schema.sql'));
const previous = read('../supabase/migrations/20260909115217_exclude_linkedin_channel_from_personal_appointments.sql');
await db.exec(previous.slice(previous.indexOf('CREATE OR REPLACE FUNCTION'), previous.indexOf('$function$;') + '$function$;'.length));
await db.exec(read('../supabase/migrations/20260909124042_add_call_hour_diagnostics.sql'));
await db.exec("insert into sales_people(close_user_id,slug,display_name,color) values ('user_m','michael','Michael','#4488ff'),('user_f','felix','Felix','#ffaa00')");

const gatekeeper = 'custom.cf_8Bjba56AJvfLXwNKJwhjVJwSmCdaHBlTVyH25kxp3M1';
const decision = 'custom.cf_LBuW6DB7vmgifhe2JUasZIhYvrOIjcAd7xB8hzYQrJ9';
async function add(id, counts = {}, payload = {}, options = {}) {
  const day = options.day ?? '2026-09-07', hour = options.hour ?? 9;
  const type = options.type ?? 'custom_activity';
  const fact = {source_activity_id:id,source_type:type,close_user_id:options.user ?? 'user_m',
    lead_id:options.lead ?? id,occurred_at:`${day}T${String(hour-2).padStart(2,'0')}:00:00Z`,
    metric_date:day,metric_hour:hour,mapping_version:'test',...counts};
  const keys = Object.keys(fact);
  await db.query(`insert into close_activity_facts(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(fact));
  await db.query('insert into close_raw_activities(close_activity_id,activity_type,occurred_at,payload) values($1,$2,$3,$4)',
    [id,type,fact.occurred_at,JSON.stringify(type === 'custom_activity' ? {custom_activity_type_id:'actitype_3YiimGlbRMzQxr2O3hPKHJ',...payload} : payload)]);
}
for (let i=0;i<20;i++) await add(`call-${i}`,{calls_gross:1,calls_net:1},
  {outcome_id:i<2?'outcome_030sp0X2TRtdT8YPJfqwWS':i===2?'outcome_030spLYZrlWBQ9kEiPfudv':'answered'}, {type:'call'});
await add('transfer',{gatekeeper_contacts:1,connected_calls:1,decision_maker_contacts:1,appointments:1},{[gatekeeper]:'✅ Durchgestellt'});
await add('reject',{gatekeeper_contacts:1},{[gatekeeper]:'Nicht durchgestellt'});
await add('email',{gatekeeper_contacts:1},{[gatekeeper]:'E-Mail senden'});
await add('interest',{gatekeeper_contacts:1},{[gatekeeper]:'Kein Interesse'});
await add('gf',{}, {[gatekeeper]:'GF nicht erreichbar'});
await add('direct-unreachable',{direct_decision_maker_calls:1},{[gatekeeper]:'🛑 Kein Gatekeeper',[decision]:'Nicht erreichbar'});
await add('direct',{direct_decision_maker_calls:1,decision_maker_contacts:1},{[gatekeeper]:'🛑 Kein Gatekeeper'});
await add('conflict',{decision_maker_contacts:1},{[gatekeeper]:'CEO nicht erreichbar'});
await add('channel',{decision_maker_contacts:1,appointments:1},{}, {lead:'linkedin'});
await add('felix-gf',{}, {'custom.cf_cQiYFFuU9Cz20rbmDRy4qQiNYftCi4PZ6bMqCBPQdLB':'CEO nicht erreichbar',custom_activity_type_id:'actitype_38qU8FYNxY0WkWAy66Uc65'}, {user:'user_f',hour:10});
await add('july',{calls_gross:1,calls_net:1},{},{type:'call',day:'2026-07-01',hour:20});
await add('future',{calls_gross:1,calls_net:1},{},{type:'call',day:'2026-09-10',hour:21});

for (const period of ['day','week','month','trend']) {
  const date = period==='day'?'2026-09-07':'2026-09-09';
  const report = (await db.query('select get_call_hour_report($1,$2) report',[period,date])).rows[0].report;
  const base = (await db.query('select * from get_call_hour_performance($1,$2)',[period,date])).rows;
  assert.equal(report.length,48);
  for (const original of base) {
    const row = report.find(r=>r.slug===original.slug && r.metric_hour===original.metric_hour);
    for (const key of Object.keys(original)) {
      const expected = original[key] instanceof Date ? original[key].toISOString().slice(0,10)
        : typeof row[key] === 'number' ? Number(original[key]) : original[key];
      assert.deepEqual(row[key],expected,`${period} ${key}`);
    }
  }
  const michael = report.find(r=>r.slug==='michael' && r.metric_hour===9);
  assert.equal(michael.calls_gross,20);
  assert.equal(michael.calls_net,20);
  assert.equal(michael.productive_calls,17);
  assert.equal(michael.gatekeeper_contacts,4);
  assert.equal(michael.connected_calls,1);
  assert.equal(michael.transfer_rate,25);
  assert.equal(michael.appointments,1); // LinkedIn bleibt ausgeschlossen.
  assert.equal(michael.gf_unavailable_calls,2); // Einmal Vorzimmer, einmal explizit direkt.
  assert.equal(michael.gatekeeper_unavailable_calls,1);
  assert.equal(michael.direct_decision_maker_calls,1); // Direkter Fehlversuch ist kein Kontakt.
  assert.equal(michael.gatekeeper_rejected,1);
  assert.equal(michael.gatekeeper_email_requested,1);
  assert.equal(michael.gatekeeper_no_interest,1);
  assert.equal(report.find(r=>r.slug==='felix' && r.metric_hour===10).gf_unavailable_calls,1);
  assert.equal(report.find(r=>r.slug==='michael' && r.metric_hour===21).calls_gross,0);
  assert.equal(report[0].period_end,date);
  if(period==='trend') {
    assert.equal(report[0].period_start,'2026-07-01');
    assert.equal(report.find(r=>r.slug==='michael' && r.metric_hour===20).calls_gross,1);
  }
}
for(const params of [['invalid','2026-09-09'],[null,'2026-09-09'],['month',null]]) {
  await assert.rejects(db.query('select get_call_hour_report($1,$2)',params));
}
const privileges=(await db.query("select has_function_privilege('anon','get_call_hour_report(text,date)','execute') anon, has_function_privilege('authenticated','get_call_hour_report(text,date)','execute') authenticated")).rows[0];
assert.deepEqual(privileges,{anon:false,authenticated:true});
await db.exec("select set_config('test.denied','true',false)");
await assert.rejects(db.query("select get_call_hour_report('month','2026-09-09')"), /Nicht berechtigt/);
await db.close();
console.log('Stundenbericht: vier Zeiträume, unveränderte Kern-KPIs, GF-Diagnosen, LinkedIn-Ausschluss, Stichtag und Zugriffsschutz geprüft.');
