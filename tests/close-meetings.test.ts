import assert from "node:assert/strict";
import test from "node:test";
import { CLOSE_USERS, ACTIVITY_TYPES, CUSTOM_FIELDS } from "../supabase/functions/_shared/close-mapping.ts";
import { prepareCustomReconciliation } from "../supabase/functions/_shared/close-reconciliation.ts";
import { isObservedAt, meetingWithinDates, prepareMeetingSnapshot } from "../supabase/functions/_shared/close-meetings.ts";

const asOf="2026-09-10T12:00:00Z";
const booking={source_activity_id:"booking",lead_id:"lead",close_user_id:CLOSE_USERS.felix,occurred_at:"2026-09-10T08:00:00Z"};
function meeting(overrides={}) {return {id:"meeting",lead_id:"lead",user_id:CLOSE_USERS.michael,starts_at:"2026-10-15T08:00:00Z",ends_at:"2026-10-15T08:30:00Z",date_created:"2026-09-10T08:10:00Z",date_updated:"2026-09-10T08:10:00Z",status:"upcoming",title:"Setter",attendees:[{contact_id:"contact",email:"private@example.test",name:"Private",status:"yes"}],...overrides};}
test("September creation and booking are assigned only to the actual October meeting",()=>{
 const {meetings,diagnostics}=prepareMeetingSnapshot([meeting()],[booking],asOf);
 assert.equal(diagnostics.linked,1);assert.equal(diagnostics.future,1);
 assert.equal(meetings[0].booking_owner_id,CLOSE_USERS.felix);assert.equal(meetings[0].owner_id,CLOSE_USERS.michael);
 assert.equal(meetingWithinDates(meetings[0].starts_at,"2026-09-01","2026-09-30"),false);
 assert.equal(meetingWithinDates(meetings[0].starts_at,"2026-10-01","2026-10-31"),true);
 assert(!JSON.stringify(meetings).includes("private@example.test"));assert(!JSON.stringify(meetings).includes("Private"));
 assert.equal(meetings[0].participant_ids[0].contact_id,"contact");
});
test("inclusive Berlin calendar bounds: start, final instant, immediately before and after",()=>{
 for(const [at,expected] of [["2025-12-31T23:00:00Z",true],["2026-02-01T22:59:59.999Z",true],["2025-12-31T22:59:59.999Z",false],["2026-02-01T23:00:00Z",false]] as const)
  assert.equal(meetingWithinDates(at,"2026-01-01","2026-02-01"),expected,at);
});
test("summer, DST change and year boundaries use Berlin rather than UTC dates",()=>{
 assert(meetingWithinDates("2026-09-30T22:00:00Z","2026-10-01","2026-10-01"));
 assert(!meetingWithinDates("2026-09-30T22:00:00Z","2026-09-01","2026-09-30"));
 assert(meetingWithinDates("2026-10-25T22:59:59Z","2026-10-25","2026-10-25"));
 assert(!meetingWithinDates("2026-10-25T23:00:00Z","2026-10-25","2026-10-25"));
 assert.throws(()=>meetingWithinDates(asOf,"2026-02-30","2026-03-01"));
});
test("current day uses the precise source observation time, not end of day",()=>{
 assert(isObservedAt(asOf,asOf));assert(!isObservedAt("2026-09-10T12:00:00.001Z",asOf));
 const custom=(activity_at:string)=>({id:activity_at,lead_id:"lead",user_id:CLOSE_USERS.antony,activity_at,custom_activity_type_id:ACTIVITY_TYPES.setterCall,status:"published",[`custom.${CUSTOM_FIELDS.setterResult}`]:"🔎 Setter Follow Up"});
 const result=prepareCustomReconciliation([custom("2026-09-10T11:59:59Z"),custom("2026-09-10T13:00:00Z"),custom("2026-10-15T08:00:00Z")],"2026-07-01","2026-09-10",asOf);
 assert.equal(result.facts.length,1);assert.equal(result.facts[0].setterCalls,1);
});
test("all calendar statuses remain metadata and never generate conversation performance",()=>{
 for(const status of ["upcoming","completed","in-progress","canceled","declined-by-lead",null]){
  const r=prepareMeetingSnapshot([meeting({status})],[booking],asOf);
  assert.equal(r.meetings[0].status,status);assert.equal(r.diagnostics.linked,1);
  for(const k of ["setter_calls","closer_calls","no_shows","setterCalls","closerCalls"])assert(!(k in r.meetings[0]));
 }
});
test("only a documented booking links a sales meeting; service meetings stay outside the KPI",()=>{
 assert.equal(prepareMeetingSnapshot([meeting()],[],asOf).diagnostics.linked,0);
 for(const title of ["Onboarding", "1:1 Coaching", "Videodreh", "Strategieberatung", "Beratung: Beispiel"])
  assert.equal(prepareMeetingSnapshot([meeting({title})],[booking],asOf).diagnostics.linked,0);
});
test("one source booking maps to the next calendar appointment; later meetings are not invented bookings",()=>{
 const r=prepareMeetingSnapshot([meeting(),meeting({id:"followup",starts_at:"2026-11-01T09:00:00Z",ends_at:"2026-11-01T10:00:00Z"})],[booking],asOf);
 assert.equal(r.diagnostics.linked,1);assert.equal(r.meetings.find(m=>m.meeting_id==="meeting")?.booking_activity_id,"booking");
});
test("ambiguous calendar ties or repeated booking claims are withheld, not deduplicated by status",()=>{
 assert.equal(prepareMeetingSnapshot([meeting(),meeting({id:"other",status:"canceled"})],[booking],asOf).diagnostics.linked,0);
 assert.equal(prepareMeetingSnapshot([meeting()],[booking,{...booking,source_activity_id:"other"}],asOf).diagnostics.linked,0);
});
test("rescheduling replaces the time of the same ID and future meetings persist without date windows",()=>{
 const before=prepareMeetingSnapshot([meeting()],[booking],asOf).meetings[0];
 const after=prepareMeetingSnapshot([meeting({starts_at:"2027-01-15T09:00:00Z",ends_at:"2027-01-15T10:00:00Z"})],[booking],asOf).meetings[0];
 assert.equal(before.meeting_id,after.meeting_id);assert.equal(after.starts_at,"2027-01-15T09:00:00Z");
 assert.equal(after.booking_activity_id,"booking");
});
test("invalid timestamps and contradictory pagination fail closed",()=>{
 assert.throws(()=>prepareMeetingSnapshot([meeting({starts_at:"2026-10-15"})],[booking],asOf),/invalid_meeting_record/);
 assert.throws(()=>prepareMeetingSnapshot([meeting(),meeting({status:"canceled"})],[booking],asOf),/unstable_meeting_pagination/);
});

test("stable meeting identity follows a reschedule past another appointment",()=>{
 const old=prepareMeetingSnapshot([meeting()],[booking],asOf).meetings;
 const records=[meeting({starts_at:"2026-11-15T09:00:00Z",ends_at:"2026-11-15T10:00:00Z"}),meeting({id:"different-meeting",starts_at:"2026-10-20T09:00:00Z",ends_at:"2026-10-20T10:00:00Z"})];
 const result=prepareMeetingSnapshot(records,[booking],asOf,old);
 assert.equal(result.meetings.find(m=>m.meeting_id==="meeting")?.booking_activity_id,"booking");
 assert.equal(result.meetings.find(m=>m.meeting_id==="different-meeting")?.booking_activity_id,null);
 assert.equal(result.diagnostics.linked,1);
});
test("stored links cannot be reused for a different lead, deleted booking or excluded purpose",()=>{
 const old=prepareMeetingSnapshot([meeting()],[booking],asOf).meetings;
 assert.equal(prepareMeetingSnapshot([meeting({lead_id:"other"})],[booking],asOf,old).diagnostics.linked,0);
 assert.equal(prepareMeetingSnapshot([meeting()],[],asOf,old).diagnostics.linked,0);
 assert.equal(prepareMeetingSnapshot([meeting({title:"Onboarding"})],[booking],asOf,old).diagnostics.linked,0);
});
