import test from 'node:test';
import assert from 'node:assert/strict';
import {stageRows,stageSummary,bookingScopeReport} from '../pipeline-details.mjs';
test('stage membership and overlapping KPI filters come exclusively from Supabase statuses',()=>{
 const rows=[{stages:{closer1:['cancelled',null,'qualified']}},{stages:{closer1:['rejected','attended']}},{stages:{closer1:['planned',null,'qualified']}},{closer_at:'2026-09-01'}];
 const cc1=stageRows(rows,'closer1');assert.equal(cc1.length,3);assert.equal(cc1[0].status,'cancelled');assert.ok(cc1[1].tags.includes('attended'));assert.ok(!cc1[2].tags.includes('attended'));
});
test('CC2 pending and no-show statuses cannot turn into conducted calls in the frontend',()=>{
 const cc2=stageRows([{stages:{cc2:['planned',null]}},{stages:{cc2:['no_show',null]}},{cc2_at:'2026-09-01'}],'cc2');
 assert.equal(cc2.length,2);assert.ok(cc2.every(r=>!r.tags.includes('attended')));
});
test('compact stage summary contains only status counts and never names or links',()=>{
 const summary=stageSummary([{lead_id:'lead_secret',display_name:'private-name',stages:{first:['planned']}},{stages:{first:['attended']}},{stages:{first:['cancelled']}}],'first');
 assert.deepEqual(summary,[{label:'Ersttermine im gewählten Monat',value:'3'},{label:'Durchgeführt (bisher)',value:'1'},{label:'Noch anstehend',value:'1'},{label:'Aktuell abgesagt',value:'1'}]);
 assert.doesNotMatch(JSON.stringify(summary),/lead_secret|private-name|https|<a/);
});
test('CC2 summary retains previous performance and flags a missing agreement',()=>{
 const summary=stageSummary([{stages:{cc2:['cancelled','attended']}},{stages:{cc2:['sold','attended','missing_agreement']}}],'cc2');
 assert.equal(summary.find(r=>r.label==='Durchgeführt (bisher)').value,'2');
 assert.equal(summary.find(r=>r.label==='CC2-Vereinbarung nicht belegt').value,'1');
});

test('setter summary identifies the full monthly cohort and follow-up as a subset',()=>{
 const result=stageSummary([{stages:{setter:['followup','attended']}},{stages:{setter:['planned']}}],'setter');
 assert.equal(result[0].label,'Ersttermine im gewählten Monat');
 assert.equal(result[0].value,'2');
 assert.equal(result.find(r=>r.label==='Davon Follow-up offen').value,'1');
});

test('booking groups exclude carryovers from new pipeline without losing upcoming appointments',()=>{
 const report={month_pipeline_rows:[{booking_scope:'new',future_first:false,stages:{setter:['attended']}},{booking_scope:'new',future_first:true},{booking_scope:'carryover',future_first:false,stages:{setter:['attended']}}]};
 const fresh=bookingScopeReport(report,'new');
 assert.equal(fresh.month_pipeline_rows.length,2);
 assert.equal(fresh.funnel_by_source[0].booked_leads,1);
 assert.equal(fresh.funnel_by_source[0].setter_arrived,1);
 assert.equal(bookingScopeReport(report,'carryover').month_pipeline_rows.length,1);
 assert.equal(report.month_pipeline_rows.length,3);
});
