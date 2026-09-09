// Manual CPU benchmark, deliberately outside *.test.* and without timing gates.
// Run: node tests/benchmark-close-processes.mjs [lead-count=5000]
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {deriveCloseProcesses} from '../supabase/functions/_shared/close-processes.ts';

const leadCount=Number(process.argv[2]??5000);
if(!Number.isSafeInteger(leadCount)||leadCount<1)throw new Error('Invalid benchmark lead count');
const input={meetings:[],bookings:[],events:[],dataAsOf:'2026-09-15T12:00:00Z'};
let expectedProcesses=leadCount,expectedReplacements=0;
for(let i=0;i<leadCount;i++) {
 const lead='synthetic-lead-'+i,shift=i*1000;
 const at=value=>new Date(Date.parse(value)+shift).toISOString();
 const replacement=i%10===0,terminal=i%10===1;
 if(replacement)expectedReplacements++;if(terminal)expectedProcesses++;
 const booking1={source_activity_id:`booking-${i}-1`,lead_id:lead,close_user_id:'synthetic-opener',occurred_at:at('2026-08-01T08:00:00Z')};
 const booking2={...booking1,source_activity_id:`booking-${i}-2`,occurred_at:at(replacement?'2026-09-11T07:00:00Z':'2026-09-01T08:00:00Z')};
 input.bookings.push(booking1,booking2);
 const meeting=(n,date,booking,status='completed')=>({meeting_id:`meeting-${i}-${n}`,lead_id:lead,contact_id:null,owner_id:'synthetic-setter',
  starts_at:at(date),ends_at:new Date(Date.parse(date)+shift+3600000).toISOString(),date_created:booking.occurred_at,date_updated:booking.occurred_at,
  status,participant_ids:[],calendar_event_uids:[],excluded_purpose:false,booking_activity_id:booking.source_activity_id,booking_owner_id:booking.close_user_id});
 const first=meeting(1,replacement?'2026-09-10T08:00:00Z':'2026-08-20T08:00:00Z',booking1,replacement?'canceled':'completed');
 if(replacement)first.date_updated=at('2026-09-10T07:00:00Z');
 input.meetings.push(first,meeting(2,replacement?'2026-10-15T08:00:00Z':'2026-09-10T08:00:00Z',booking2,replacement?'upcoming':'completed'));
 const event=(name,type,date,kind='custom_activity')=>({source_event_id:`${name}-${i}`,source_kind:kind,lead_id:lead,
  occurred_at:at(date),event_type:type,meeting_id:null,setter_id:'synthetic-setter',closer_id:null});
 input.events.push({...event('booking1','booking','2026-08-01T08:00:00Z'),source_event_id:booking1.source_activity_id},
  {...event('booking2','booking',replacement?'2026-09-11T07:00:00Z':'2026-09-01T08:00:00Z'),source_event_id:booking2.source_activity_id},
  event('outcome1',replacement?'setter_cancelled':terminal?'setter_disqualified':'setter_follow_up',replacement?'2026-09-10T07:00:00Z':'2026-08-20T08:30:00Z'),
  event('outcome2',replacement?'setter_no_show':'setter_follow_up',replacement?'2026-09-10T08:01:00Z':'2026-09-10T08:30:00Z'),
  event('status1','status_changed','2026-08-21T08:00:00Z','lead_status_change'),
  event('status2','status_changed','2026-09-12T08:00:00Z','lead_status_change'));
}
const start=performance.now(),cpu=process.cpuUsage();
const result=deriveCloseProcesses(input);
const elapsed=performance.now()-start,used=process.cpuUsage(cpu);
assert.equal(result.processes.length,expectedProcesses);assert.equal(result.meetingRelations.length,leadCount*2);
assert.equal(result.eventRelations.length,leadCount*6);assert.equal(result.diagnostics.replacements,expectedReplacements);
console.log(JSON.stringify({leads:leadCount,meetings:input.meetings.length,events:input.events.length,processes:result.processes.length,
 replacements:result.diagnostics.replacements,elapsed_ms:Math.round(elapsed),cpu_ms:Math.round((used.user+used.system)/1000),
 output_sha256:createHash('sha256').update(JSON.stringify(result)).digest('hex')}));
