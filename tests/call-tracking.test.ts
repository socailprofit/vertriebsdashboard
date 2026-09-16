import assert from 'node:assert/strict';
import test from 'node:test';
import {mapCall, CLOSE_USERS, CALL_MAPPING_VERSION, metricTimeInReportingTimezone, type CloseCall} from '../supabase/functions/_shared/close-mapping.ts';
const base: CloseCall={id:'call',user_id:CLOSE_USERS.michael,lead_id:'company',activity_at:'2026-09-16T10:40:39Z',direction:'outbound',status:'completed',disposition:'answered',duration:31};

test('All Calls includes final attempts in both directions, including cancelled attempts',()=>{
 for(const direction of ['inbound','outbound'] as const) for(const status of ['completed','no-answer','busy','failed','timeout','cancel']){
  const fact=mapCall({...base,direction,status});
  assert.equal(fact.callsGross,1,`${direction}/${status}`);
  assert.equal(fact.callsNet,status==='completed'?1:0);
  assert.equal(fact.talkSeconds,status==='completed'?31:0);
  assert.equal(fact.closeUserId,CLOSE_USERS.michael);
  assert.equal(fact.mappingVersion,CALL_MAPPING_VERSION);
 }
});
test('mailbox, abandoned, unanswered and pending calls never become conversations',()=>{
 for(const disposition of ['vm-answer','vm-left','no-answer','abandoned',null]){
  const fact=mapCall({...base,direction:'inbound',disposition});
  assert.equal(fact.callsGross,1);assert.equal(fact.callsNet,0);assert.equal(fact.talkSeconds,0);
 }
 for(const status of ['created','in-progress','unknown',undefined]){
  const fact=mapCall({...base,status});assert.equal(fact.callsGross,0);assert.equal(fact.callsNet,0);
 }
});
test('call date and hour follow Berlin activity time, independently of import/creation time',()=>{
 for(const [activity_at,date,hour] of [['2026-09-15T22:05:00Z','2026-09-16',0],['2026-01-15T23:05:00Z','2026-01-16',0],['2026-09-16T10:40:39Z','2026-09-16',12]] as const){
  const fact=mapCall({...base,activity_at});const time=metricTimeInReportingTimezone(fact.occurredAt);assert.equal(time.metricDate,date);assert.equal(time.metricHour,hour);
 }
});
