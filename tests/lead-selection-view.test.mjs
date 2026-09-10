import test from 'node:test';
import assert from 'node:assert/strict';
import {statusBuckets,dimensionBuckets,renderSelectionReport,renderLeadEvidence,uniqueLeads} from '../lead-selection-view.mjs';
const lead=(id,status,owner=null)=>({lead_id:id,lead_name:id,status_id:status,status_label:status,dimensions:{owner},matching_events:1});
const group={key:'setting',label:'Setting',status_side:'old',leads:[lead('lead_A','No Show'),lead('lead_B','Follow-up'),lead('lead_C','Follow-up','Owner')]};
test('each current status has exactly one bucket; no-show leads remain in the source denominator',()=>{
 assert.deepEqual(statusBuckets(group.leads).map(x=>[x.label,x.leads.length]),[['Follow-up',2],['No Show',1]]);
 const html=renderSelectionReport({groups:[group]});assert.match(html,/66,7 %/);assert.match(html,/33,3 %/);assert.match(html,/1 von 3 Leads/);assert.doesNotMatch(html,/Show-Rate/);
});
test('repeated matching exits never inflate a lead selection',()=>assert.equal(uniqueLeads({...group,leads:[...group.leads,group.leads[0]]}).length,3));
test('missing dimensions remain visible and subgroup rates use their own denominator',()=>{
 assert.equal(dimensionBuckets(group.leads,'owner').find(x=>x.label==='Nicht gepflegt').leads.length,2);
 const html=renderSelectionReport({groups:[group]},'setting','owner');assert.match(html,/50 %/);assert.match(html,/Nicht gepflegt/);
});
test('identically named users with different CRM ids remain separate',()=>{
 const a=lead('a','S','Alex'),b=lead('b','S','Alex');a.dimensions.owner_id='u1';b.dimensions.owner_id='u2';assert.equal(dimensionBuckets([a,b],'owner').length,2);
});
test('independent closing/customer selections do not invent a cross-group win rate',()=>{
 const html=renderSelectionReport({groups:[group,{key:'customer',label:'Neukunden',status_side:'new',leads:[lead('lead_D','Sold')]}]},'customer');assert.match(html,/1 von 1 Leads/);assert.doesNotMatch(html,/1 von 3 Leads/);
});
test('popup carries exact filtered leads, escapes CRM text and rejects external source URLs',()=>{
 const dangerous={...group,share_url:'javascript:alert(1)',leads:[{...lead('lead_A','S'),lead_name:'<img onerror=alert(1)>'}]};
 const html=renderLeadEvidence({groups:[dangerous]},'setting','owner','status','S');assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
 assert.doesNotMatch(renderSelectionReport({groups:[dangerous]}),/href="javascript/);
 assert.match(renderLeadEvidence({groups:[group]},'setting','owner','status','No Show'),/1 von 3 Leads/);
});
