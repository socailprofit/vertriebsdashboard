import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { selectCohort } from '../cohort-filters.mjs';

const code=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const upcoming=code.slice(code.indexOf('function renderUpcomingMeetings()'),code.indexOf('function renderWeeklyReview()'));
function renderMeetings(pipeline) {
 const node={};const context=vm.createContext({state:{antonyPipeline:pipeline},document:{querySelector:()=>node},escapeHtml:String,Date:class extends Date {static now(){return Date.parse('2026-09-09T12:00Z');}}});
 vm.runInContext(upcoming+';renderUpcomingMeetings();',context);return node.innerHTML;
}
test('October calendar stays concrete and no old inventory is rendered',()=>{
 const html=renderMeetings({data_as_of:'2026-09-09T12:00Z',scheduled_meetings:[{lead_id:'lead_abc',meeting_id:'m1',starts_at:'2026-10-14T09:30Z',stage:'cc2'}],critical_cases:[{lead_id:'lead_old'}]});
 assert.match(html,/14.10.2026, 11:30/);assert.match(html,/lead_abc/);assert.doesNotMatch(html,/lead_old|Prognose/);
});
test('next appointments deduplicate meeting ids and exclude elapsed meetings',()=>{
 const m={lead_id:'lead_abc',meeting_id:'m1',starts_at:'2026-10-14T09:30Z',stage:'cc2'};
 const html=renderMeetings({scheduled_meetings:[m,m,{...m,meeting_id:'old',starts_at:'2026-09-01T09:30Z'}]});
 assert.equal((html.match(/app.close.com/g)||[]).length,1);
 assert.match(renderMeetings({}),/noch nicht verfügbar/);
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
