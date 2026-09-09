import test from 'node:test';
import assert from 'node:assert/strict';
import {stageRows,stageDetails} from '../pipeline-details.mjs';
test('stage membership and overlapping KPI filters come exclusively from Supabase statuses',()=>{
 const rows=[{stages:{closer1:['cancelled',null,'qualified']}},{stages:{closer1:['rejected','attended']}},{stages:{closer1:['planned',null,'qualified']}},{closer_at:'2026-09-01'}];
 const cc1=stageRows(rows,'closer1');assert.equal(cc1.length,3);assert.equal(cc1[0].status,'cancelled');assert.ok(cc1[1].tags.includes('attended'));assert.ok(!cc1[2].tags.includes('attended'));
});
test('CC2 pending and no-show statuses cannot turn into conducted calls in the frontend',()=>{
 const cc2=stageRows([{stages:{cc2:['planned',null]}},{stages:{cc2:['no_show',null]}},{cc2_at:'2026-09-01'}],'cc2');
 assert.equal(cc2.length,2);assert.ok(cc2.every(r=>!r.tags.includes('attended')));
});
test('stage details show source records and status options instead of explanatory tiles',()=>{
 const html=stageDetails([{lead_id:'lead_test',display_name:'<unsafe>',first_meeting_at:'2026-09-15',stages:{first:['planned']}}],'first');
 assert.match(html,/Noch anstehend · 1/);assert.match(html,/data-stage-filter/);assert.match(html,/&lt;unsafe&gt;/);assert.doesNotMatch(html,/<unsafe>/);
});
