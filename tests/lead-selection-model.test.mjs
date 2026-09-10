import test from 'node:test';import assert from 'node:assert/strict';
import {selectionPopulation,filterLeadReport,NO_SHOW_STATUS_IDS} from '../lead-selection-model.mjs';
const noShow=[...NO_SHOW_STATUS_IDS][0];
const leads=Array.from({length:17},(_,i)=>({lead_id:`lead_${i}`,status_id:i<6?noShow:'followup',dimensions:{owner_id:i%2?'user_A':'user_B',lead_source:i<9?'DMC':'LinkedIn',industry:'Industrie'}}));
const report={groups:[{key:'setting',leads}]};
test('17 total, 6 No Shows, 11 relevant; unknown statuses are not silently relevant',()=>{
 assert.equal(selectionPopulation(report.groups[0]).relevant.length,11);assert.equal(selectionPopulation(report.groups[0]).noShows.length,6);
 assert.equal(selectionPopulation({key:'setting',leads:[{lead_id:'unknown'}]}).relevant.length,0);
});
test('employee/source/industry/status filters intersect and carry the same cohort into every calculation',()=>{
 const g=filterLeadReport(report,{role:'owner',employee:'user_A',source:'DMC',industry:'Industrie'}).groups[0];
 assert.equal(g.total,4);assert.equal(selectionPopulation(g).noShows.length,3);assert.equal(selectionPopulation(g).relevant.length,1);assert.equal(g.unfiltered_total,17);
 assert.equal(filterLeadReport(report,{status:noShow}).groups[0].total,6);
});
test('missing fields can be filtered explicitly and clearing filters restores the complete base',()=>{
 const r={groups:[{key:'setting',leads:[...leads,{lead_id:'empty',status_id:'followup'}]}]};
 assert.equal(filterLeadReport(r,{source:'__missing__'}).groups[0].total,1);assert.equal(filterLeadReport(r,{}).groups[0].total,18);
});
