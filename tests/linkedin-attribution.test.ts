import test from 'node:test';
import assert from 'node:assert/strict';
import {leadAttribution,mapWonOpportunity,mapCustomActivity,CUSTOM_FIELDS,ACTIVITY_TYPES,SALES_PIPELINE} from '../supabase/functions/_shared/close-mapping.ts';
const michael='user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy';
test('a LinkedIn source and Michael as setter never fill a missing opener',()=>{
 const attribution=leadAttribution([{id:CUSTOM_FIELDS.leadSource,value:'LinkedIn'},{id:CUSTOM_FIELDS.leadSetter,value:michael}]);
 assert.equal(attribution.openerUserId,null);assert.equal(attribution.setterUserId,michael);
 const result=mapWonOpportunity({id:'won',lead_id:'lead',status_type:'won',status_id:[...SALES_PIPELINE.wonStatusIds][0],pipeline_id:SALES_PIPELINE.id,date_won:'2026-09-01',value:100,value_period:'one_time'},attribution);
 assert.equal(result?.openerCloseUserId,null);assert.equal(result?.setterCloseUserId,michael);
});
test('documented actors remain responsible for their own calls and missing actors remain unknown',()=>{
 for(const actor of [michael,'another-owner',null]){
  const result=mapCustomActivity({id:'call',lead_id:'lead',user_id:actor,activity_at:'2026-09-01T08:00Z',status:'published',custom_activity_type_id:ACTIVITY_TYPES.setterCall,custom_fields:[]});
  assert.equal(result?.closeUserId,actor);assert.equal(result?.setterCalls,1);
 }
});
