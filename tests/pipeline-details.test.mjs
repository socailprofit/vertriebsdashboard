import test from 'node:test';
import assert from 'node:assert/strict';
import {stageRows,stageSummary} from '../pipeline-details.mjs';
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
 assert.deepEqual(summary,[{label:'Vorgänge in dieser Stufe',value:'3'},{label:'Durchgeführt (bisher)',value:'1'},{label:'Noch anstehend',value:'1'},{label:'Aktuell abgesagt',value:'1'}]);
 assert.doesNotMatch(JSON.stringify(summary),/lead_secret|private-name|https|<a/);
});
test('CC2 summary retains previous performance and flags a missing agreement',()=>{
 const summary=stageSummary([{stages:{cc2:['cancelled','attended']}},{stages:{cc2:['sold','attended','missing_agreement']}}],'cc2');
 assert.equal(summary.find(r=>r.label==='Durchgeführt (bisher)').value,'2');
 assert.equal(summary.find(r=>r.label==='CC2-Vereinbarung nicht belegt').value,'1');
});
