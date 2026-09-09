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

test('October replacements are concrete calendar entries, not unresolved cases or monthly forecasts',()=>{
 const html=renderInventory({as_of:'2026-09-08',critical_counts:{no_show:0,cancelled:0,without_meeting:0},scheduled_meetings:[{lead_id:'lead_abc',meeting_id:'m1',starts_at:'2026-10-14T09:30:00Z',stage:'cc2'}],critical_cases:[]})['#antony-pipeline-grid'].innerHTML;
 assert.match(html,/CC2 · 14.10.2026, 11:30 Uhr/);
 assert.match(html,/app.close.com\/lead\/lead_abc/);
 assert.match(html,/Keine offenen Fälle ohne Folgetermin/);
 assert.doesNotMatch(html,/Weitere offene Verläufe|insgesamt|Hochrechnung/);
});

test('Close-Up displays only explicit critical groups and preserves missing-data state',()=>{
 const html=renderInventory({as_of:'2026-09-08',critical_counts:{no_show:1,cancelled:0,without_meeting:2},critical_cases:[{lead_id:'lead_abc',stage:'setter',reason:'no_show',status_since:'2026-09-02T08:00:00Z'}],scheduled_meetings:[],counts:{total_open:99}})['#antony-pipeline-grid'].innerHTML;
 assert.match(html,/No-Show ohne neuen Termin<\/dt><dd>1/);
 assert.match(html,/Weiterer Lead ohne zukünftigen Termin<\/dt><dd>2/);
 assert.doesNotMatch(html,/99|Offen gesamt|Weitere offene Verläufe/);
 assert.match(html,/Keine zukünftigen Termine vorhanden/);
 assert.match(renderInventory({counts:{}})['#antony-pipeline-grid'].innerHTML,/noch nicht verfügbar/);
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
