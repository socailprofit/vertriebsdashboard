import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { selectCohort } from '../cohort-filters.mjs';

const code=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const inventory=code.slice(code.indexOf('function renderAntonyPipeline() {'),code.indexOf('function renderWeeklyReview()'));
function renderInventory(pipeline) {
  const nodes=Object.fromEntries(['#antony-pipeline-grid','#antony-pipeline-note','#antony-pipeline-period'].map(id=>[id,{}]));
  const context=vm.createContext({state:{antonyPipeline:pipeline},document:{querySelector:id=>nodes[id]},
    number:n=>String(n??'—'),germanDate:d=>d,escapeHtml:t=>String(t).replaceAll('<','&lt;'),monthLabel:d=>d});
  vm.runInContext(inventory+';renderAntonyPipeline();',context);
  return nodes;
}

test('an October replacement remains planned in a September inventory, not a pending follow-up',()=>{
  const rendered=renderInventory({persistent:true,as_of:'2026-09-08',counts:{total_open:1,setter_planned:1,setter_followup:0,from_previous_months:1,older_than_14_days:0},next_by_month:[{month:'2026-10-01',stage:'setter',count:1}]});
  const html=rendered['#antony-pipeline-grid'].innerHTML;
  assert.match(html,/2026-10-01/);assert.match(html,/1 Setter/);
  assert.doesNotMatch(html,/Setter-Follow-up/);assert.doesNotMatch(html,/nicht erschienen/);
  assert.match(rendered['#antony-pipeline-period'].textContent,/aktueller Gesamtbestand/);
});

test('planning for Setter, Closer and CC2 shares a month total without inventing missing dates',()=>{
  const rendered=renderInventory({persistent:true,as_of:'2026-09-08',counts:{total_open:5,setter_planned:1,closer_planned:1,cc2_planned:2,setter_followup:1},next_by_month:[{month:'2026-10-01',stage:'setter',count:1},{month:'2026-10-01',stage:'closer',count:1},{month:'2026-10-01',stage:'cc2',count:2}]});
  const html=rendered['#antony-pipeline-grid'].innerHTML;
  assert.match(html,/1 Setter · 1 Closer · 2 CC2/);assert.match(html,/<dd>4<\/dd>/);
  assert.match(html,/Setter-Follow-up/);
  const missing=renderInventory({persistent:true,as_of:'2026-09-08',counts:{total_open:1,setter_followup:1},next_by_month:[]});
  assert.match(missing['#antony-pipeline-grid'].innerHTML,/Kein zukünftiger Termin eindeutig zugeordnet/);
  assert.doesNotMatch(missing['#antony-pipeline-grid'].innerHTML,/2026-10/);
});

test('old cohorts become selectable only when persistent history is explicitly complete',()=>{
  const source={period:{start:'2026-09-01',end:'2026-09-08'},coverage:{retention_start:'2026-07-01'},cohort_history:[{source:'DMC',owner:'michael',booked_date:'2026-02-10',booked_leads:1,observed_customers:1}],booking_cohort_history:[]};
  const filters={source:'all',owner:'all',cohort:'2026-02-01'};
  assert.equal(selectCohort(source,filters).cohort_complete,false);
  const persisted=selectCohort({...source,coverage:{...source.coverage,history_complete:true}},filters);
  assert.equal(persisted.cohort_complete,true);assert.equal(persisted.funnel_by_source[0].observed_customers,1);
  assert.equal(persisted.period.end,'2026-09-08');
});

test('the graph uses first qualifications rather than repeated qualification entries when supplied',()=>{
  const script=code.slice(code.indexOf('const antonyPerformanceSeries ='),code.indexOf('function renderAntonyProcess()'));
  const nodes=Object.fromEntries(['#antony-performance-chart','#antony-performance-note','#antony-performance-period'].map(id=>[id,{}]));
  const state={period:'month',antonyPerformance:[{bucket_date:'2026-09-01',bucket_label:'01.09.',closer_appointments_cumulative:4},{bucket_date:'2026-09-02',bucket_label:'02.09.',closer_appointments_cumulative:7}],antonyProcess:{flow:{first_qualified:2},timeline:[{date:'2026-09-01',first_qualified:1},{date:'2026-09-02',first_qualified:1}]}};
  const context=vm.createContext({state,document:{querySelector:id=>nodes[id]},number:n=>String(n??0),escapeHtml:String,periodCaption:()=> 'September 2026',chartValuesTable:()=>''});
  vm.runInContext(script+';renderAntonyPerformance();',context);
  assert.match(nodes['#antony-performance-chart'].innerHTML,/Erstmals zum Closer<b>2<\/b>/);
  assert.doesNotMatch(nodes['#antony-performance-chart'].innerHTML,/Erstmals zum Closer<b>7<\/b>/);
  state.antonyProcess={};
  vm.runInContext('renderAntonyPerformance();',context);
  assert.match(nodes['#antony-performance-chart'].innerHTML,/Qualifizierungen \(alle Ergebnisse\)<b>7<\/b>/);
  assert.doesNotMatch(nodes['#antony-performance-chart'].innerHTML,/Erstmals zum Closer/);
});
