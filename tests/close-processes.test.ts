import assert from "node:assert/strict";
import test from "node:test";
import { deriveCloseProcesses, REPLACEMENT_WINDOW_MS, type ProcessBooking, type ProcessEvent } from "../supabase/functions/_shared/close-processes.ts";
import { type MeetingRow } from "../supabase/functions/_shared/close-meetings.ts";

const asOf = "2026-09-15T12:00:00Z";
const booking: ProcessBooking = { source_activity_id: "booking", lead_id: "lead", close_user_id: "opener", occurred_at: "2026-08-15T08:00:00Z" };
function meeting(overrides: Partial<MeetingRow> = {}): MeetingRow {
  return { meeting_id: "old", lead_id: "lead", contact_id: "contact", owner_id: "setter", starts_at: "2026-09-10T08:00:00Z",
    ends_at: "2026-09-10T09:00:00Z", date_created: "2026-08-15T08:10:00Z", date_updated: "2026-09-10T07:00:00Z",
    status: "canceled", participant_ids: [], calendar_event_uids: [], excluded_purpose: false,
    booking_activity_id: "booking", booking_owner_id: "opener", ...overrides };
}
function replacement(overrides: Partial<MeetingRow> = {}): MeetingRow {
  return meeting({ meeting_id: "replacement", starts_at: "2026-10-15T08:00:00Z", ends_at: "2026-10-15T09:00:00Z",
    date_created: "2026-09-10T07:30:00Z", date_updated: "2026-09-10T07:30:00Z", status: "upcoming",
    booking_activity_id: null, booking_owner_id: null, ...overrides });
}
function event(event_type: ProcessEvent["event_type"], overrides: Partial<ProcessEvent> = {}): ProcessEvent {
  return { event_type, source_event_id: event_type, source_kind: "custom_activity", lead_id: "lead",
    occurred_at: "2026-09-10T08:30:00Z", setter_id: "setter", closer_id: "closer", ...overrides };
}
const run = (options: Partial<Parameters<typeof deriveCloseProcesses>[0]> = {}) => deriveCloseProcesses({
  meetings: [meeting(), replacement()], bookings: [booking], events: [], dataAsOf: asOf, ...options,
});

test("a documented September slot moved to October remains one process and one initial setting success", () => {
  const r = run();
  assert.equal(r.processes.length, 1); assert.equal(r.diagnostics.replacements, 1);
  const p = r.processes[0];
  assert.equal(p.opened_at, booking.occurred_at); assert.equal(p.opening_booking_id, "booking");
  assert.equal(p.initial_planned_at, "2026-09-10T08:00:00Z"); assert.equal(p.first_meeting_at, "2026-10-15T08:00:00Z");
  assert.equal(p.next_meeting_at, "2026-10-15T08:00:00Z"); assert.equal(p.state, "rescheduled");
  assert.equal(p.setter_at, null); assert.equal(p.closed_at, null);
  assert.equal(r.meetingRelations.filter(m => m.counts_as_setting_success).length, 1);
  const old = r.meetingRelations.find(m => m.meeting_id === "old")!, next = r.meetingRelations.find(m => m.meeting_id === "replacement")!;
  assert.equal(old.superseded_by_meeting_id, "replacement"); assert.equal(old.counts_as_setting_success, false);
  assert.equal(next.replaces_meeting_id, "old"); assert.equal(next.booking_activity_id, "booking");
  assert.equal(next.booking_owner_id, "opener");
  assert.equal(next.meeting_stage,"setter");assert.equal(next.stage_basis,"documented_setter_booking");assert.equal(next.stage_source_event_id,"booking");
});

test("consultation metadata does not reopen a lost process or create Setter/CC2 calendar evidence",()=>{
 const r=run({meetings:[meeting({status:"completed"}),replacement({excluded_purpose:true,purpose_code:"consultation"})],
   events:[event("setter_qualified"),event("cc2_agreed",{occurred_at:"2026-09-11T08:00:00Z"}),event("closer_lost",{occurred_at:"2026-09-12T08:00:00Z"})]});
 assert.equal(r.processes.length,1);assert.equal(r.processes[0].state,"lost");assert.equal(r.processes[0].next_meeting_at,null);
 assert.equal(r.meetingRelations.some(m=>m.meeting_id==="replacement"),false);
 assert.equal(r.meetingRelations.filter(m=>m.counts_as_setting_success).length,1);
});

test("09:00 cancellation, 09:30 rebooking and 11:00 slot do not create a final NoShow or performed call", () => {
  const m = meeting({ date_updated: "2026-09-10T09:00:00Z" });
  const n = replacement({ date_created: "2026-09-10T09:30:00Z", starts_at: "2026-09-10T11:00:00Z", ends_at: "2026-09-10T12:00:00Z" });
  const r = run({ meetings: [m, n], events: [event("setter_cancelled", { meeting_id: "old", occurred_at: "2026-09-10T09:00:00Z" }),
    event("setter_no_show", { meeting_id: "old", occurred_at: "2026-09-10T09:01:00Z" })] });
  assert.equal(r.processes.length, 1); assert.equal(r.processes[0].setter_at, null);
  assert.equal(r.processes[0].state, "awaiting_result"); assert.equal(r.diagnostics.replacements, 1);
  assert.equal(r.eventRelations.find(e => e.event_type === "setter_cancelled")?.applies_to_state, false);
  assert.equal(r.eventRelations.find(e => e.event_type === "setter_no_show")?.applies_to_state, false);
});

test("replacement booked one or two elapsed days later is linked inclusively", () => {
  for (const delay of [24 * 60 * 60 * 1000, REPLACEMENT_WINDOW_MS]) {
    const created = new Date(Date.parse(meeting().date_updated) + delay).toISOString();
    const r = run({ meetings: [meeting(), replacement({ date_created: created, date_updated: created })] });
    assert.equal(r.diagnostics.replacements, 1, created);
  }
});

test("the 48 hour window measures booking time, not the replacement's future appointment date", () => {
  const r = run({ meetings: [meeting(), replacement({ starts_at: "2027-02-01T09:00:00Z", ends_at: "2027-02-01T10:00:00Z" })] });
  assert.equal(r.diagnostics.replacements, 1); assert.equal(r.processes[0].next_meeting_at, "2027-02-01T09:00:00Z");
});

test("the elapsed-hour rule is deterministic across month, year and DST boundaries", () => {
  for (const at of ["2026-09-30T23:30:00+02:00", "2026-12-31T23:30:00+01:00", "2026-10-24T23:30:00+02:00"]) {
    const created = new Date(Date.parse(at) + REPLACEMENT_WINDOW_MS).toISOString();
    const r = run({ meetings: [meeting({ date_updated: at }), replacement({ date_created: created, date_updated: created,
      starts_at: "2027-02-01T09:00:00Z", ends_at: "2027-02-01T10:00:00Z" })], dataAsOf: "2027-01-15T12:00:00Z" });
    assert.equal(r.diagnostics.replacements, 1, at);
  }
});

test("beyond 48 hours no calendar replacement is invented and rebooking alone does not create another success", () => {
  const at = new Date(Date.parse(meeting().date_updated) + REPLACEMENT_WINDOW_MS + 1).toISOString();
  const otherBooking = { ...booking, source_activity_id: "again", occurred_at: at };
  const r = run({ meetings: [meeting(), replacement({ booking_activity_id: "again", booking_owner_id: "opener", date_created: at })], bookings: [booking, otherBooking] });
  assert.equal(r.diagnostics.replacements, 0); assert.equal(r.processes.length, 1);
  assert.equal(r.meetingRelations.filter(m => m.counts_as_setting_success).length, 1);
  assert.equal(r.meetingRelations.find(m => m.meeting_id === "replacement")?.relation_type, "continuation");
});

test("new documented booking after an explicit terminal outcome creates a linked new process", () => {
  const again = { ...booking, source_activity_id: "again", occurred_at: "2026-09-12T08:00:00Z" };
  const r = run({ meetings: [meeting({ status: "completed" }), replacement({ booking_activity_id: "again", date_created: "2026-09-12T08:05:00Z" })],
    bookings: [booking, again], events: [event("setter_disqualified")] });
  assert.equal(r.processes.length, 2); assert.equal(r.processes[0].closed_at, "2026-09-10T08:30:00Z");
  assert.equal(r.processes[1].process_id, "close-process:again"); assert.equal(r.processes[1].previous_process_id, "close-process:booking");
  assert.equal(r.meetingRelations.filter(m => m.counts_as_setting_success).length, 2);
});

test("a terminal result before cancellation still makes a later documented booking a new process", () => {
  const again = { ...booking, source_activity_id: "again", occurred_at: "2026-09-10T07:30:00Z" };
  const r = run({ bookings: [booking, again], meetings: [meeting(), replacement({ booking_activity_id: "again" })],
    events: [event("closer_lost", { occurred_at: "2026-09-09T08:30:00Z" })] });
  assert.equal(r.processes.length, 2); assert.equal(r.diagnostics.replacements, 0);
});

test("rapid lead status labels alone never create final performance, a process or a rebooking", () => {
  assert.equal(run({ meetings: [], bookings: [], events: [event("status_changed"), event("status_changed", { source_event_id: "status2" })] }).processes.length, 0);
  const r = run({ meetings: [meeting({ status: "upcoming" })], events: [event("status_changed")] });
  assert.equal(r.processes[0].setter_at, null); assert.equal(r.processes[0].closed_at, null);
  assert.equal(r.processes[0].state, "awaiting_result"); assert.equal(r.eventRelations[1]?.source_event_id, "status_changed");
});

test("two candidate replacements are withheld instead of arbitrarily selecting a winner", () => {
  const r = run({ meetings: [meeting(), replacement(), replacement({ meeting_id: "also", starts_at: "2026-10-16T08:00:00Z", ends_at: "2026-10-16T09:00:00Z" })] });
  assert.equal(r.diagnostics.replacements, 0); assert.equal(r.diagnostics.ambiguousReplacements, 2);
  assert.equal(r.meetingRelations.length, 1); assert.equal(r.meetingRelations[0].superseded_by_meeting_id, null);
});

test("one candidate cannot replace two cancelled original appointments", () => {
  const second = { ...booking, source_activity_id: "second", occurred_at: "2026-09-01T08:00:00Z" };
  const r = run({ bookings: [booking, second], meetings: [meeting(), meeting({ meeting_id: "old2", booking_activity_id: "second" }), replacement()] });
  assert.equal(r.diagnostics.replacements, 0); assert.equal(r.diagnostics.ambiguousReplacements, 1);
});

test("excluded purpose, another lead, unknown owner and creation before cancellation cannot replace", () => {
  for (const overrides of [{ excluded_purpose: true }, { lead_id: "other" }, { owner_id: null }, { date_created: "2026-09-09T07:30:00Z" }]) {
    assert.equal(run({ meetings: [meeting(), replacement(overrides)] }).diagnostics.replacements, 0);
  }
});

test("an explicitly performed original meeting must not disappear as a cancelled replacement", () => {
  const r = run({ events: [event("setter_follow_up", { meeting_id: "old" })] });
  assert.equal(r.diagnostics.replacements, 0); assert.equal(r.processes[0].setter_at, "2026-09-10T08:30:00Z");
  assert.equal(r.processes[0].state, "follow_up");
});

test("future NoShow and completed events cannot change the actual process stage", () => {
  const m = meeting({ status: "upcoming", starts_at: "2026-10-15T08:00:00Z", ends_at: "2026-10-15T09:00:00Z" });
  const r = run({ meetings: [m], events: [event("setter_no_show", { meeting_id: "old" }), event("setter_qualified", { meeting_id: "old" }),
    event("closer_completed", { occurred_at: "2026-10-15T09:00:00Z" })] });
  assert.equal(r.processes[0].stage, "setter"); assert.equal(r.processes[0].state, "scheduled");
  assert.equal(r.processes[0].setter_at, null); assert.equal(r.diagnostics.ignoredFutureEvents, 3);
});

test("an advance cancellation can preserve replacement evidence without becoming a future negative KPI", () => {
  const m = meeting({ starts_at: "2026-09-25T08:00:00Z", ends_at: "2026-09-25T09:00:00Z", status: "upcoming" });
  const r = run({ meetings: [m, replacement()], events: [event("setter_cancelled", { meeting_id: "old", occurred_at: "2026-09-10T07:00:00Z" })] });
  assert.equal(r.diagnostics.replacements, 1); assert.equal(r.processes[0].state, "rescheduled"); assert.equal(r.processes[0].setter_at, null);
});

test("known same-ID moves preserve process identity without creating replacement pairs", () => {
  const first = run({ meetings: [meeting({ status: "upcoming" })] });
  const moved = run({ meetings: [meeting({ status: "upcoming", starts_at: "2026-11-10T08:00:00Z", ends_at: "2026-11-10T09:00:00Z" })], previousRelations: first.meetingRelations });
  assert.equal(first.processes[0].process_id, moved.processes[0].process_id);
  assert.equal(moved.meetingRelations.length, 1); assert.equal(moved.diagnostics.replacements, 0);
  assert.equal(moved.processes[0].next_meeting_at, "2026-11-10T08:00:00Z");
});

test("same-ID move to an earlier same-day time cannot revive the prior slot's NoShow", () => {
  const m=meeting({status:'upcoming',starts_at:'2026-09-10T09:00:00Z',ends_at:'2026-09-10T10:00:00Z',date_updated:'2026-09-10T10:30:00Z'});
  const oldOutcome=event('setter_no_show',{meeting_id:'old',occurred_at:'2026-09-10T10:05:00Z'});
  const revisions=[{meeting_id:'old',source_updated_at:'2026-09-10T10:30:00Z',old_starts_at:'2026-09-10T10:00:00Z',new_starts_at:m.starts_at}];
  const r=run({meetings:[m],events:[oldOutcome],meetingRevisions:revisions});
  assert.equal(r.processes[0].state,'awaiting_result');assert.equal(r.diagnostics.supersededTimeEvidence,1);
  assert.equal(r.eventRelations.find(e=>e.event_type==='setter_no_show')?.applies_to_state,false);
  assert.equal(run({meetings:[m],events:[oldOutcome]}).processes[0].state,'no_show'); // Generic date_updated alone is not evidence of a time change.
  const after=run({meetings:[m],events:[oldOutcome,event('setter_follow_up',{occurred_at:'2026-09-10T10:45:00Z'})],meetingRevisions:revisions});
  assert.equal(after.processes[0].state,'follow_up');assert.equal(after.processes[0].setter_at,'2026-09-10T10:45:00Z');
});

test("only actual start-time revisions create a proof floor; RSVP or unchanged-time records do not", () => {
  const m=meeting({status:'upcoming'}),ns=event('setter_no_show',{meeting_id:'old'});
  const r=run({meetings:[m],events:[ns],meetingRevisions:[{meeting_id:'old',source_updated_at:'2026-09-10T10:30:00Z',old_starts_at:m.starts_at,new_starts_at:m.starts_at}]});
  assert.equal(r.processes[0].state,'no_show');assert.equal(r.diagnostics.supersededTimeEvidence,0);
  const actual=run({meetings:[m],events:[event('setter_follow_up')],meetingRevisions:[{meeting_id:'old',source_updated_at:'2026-09-10T10:30:00Z',old_starts_at:'2026-09-10T09:00:00Z',new_starts_at:m.starts_at}]});
  assert.equal(actual.processes[0].setter_at,'2026-09-10T08:30:00Z'); // An actual older call remains actual work; it is not proof of the moved slot.
});

test("verified replacement survives a later unrelated cancelled-calendar update", () => {
  const first = run();
  const updated = run({ meetings: [meeting({ date_updated: "2026-09-14T08:00:00Z" }), replacement()], previousRelations: first.meetingRelations });
  assert.equal(updated.diagnostics.replacements, 1); assert.equal(updated.diagnostics.preservedReplacementLinks, 1);
  assert.deepEqual(updated.meetingRelations, first.meetingRelations);
});

test("withdrawn cancellation or performed evidence invalidates stale replacement relations", () => {
  const first = run();
  assert.equal(run({ meetings: [meeting({ status: "upcoming" }), replacement()], previousRelations: first.meetingRelations }).diagnostics.replacements, 0);
  assert.equal(run({ events: [event("setter_completed", { meeting_id: "old" })], previousRelations: first.meetingRelations }).diagnostics.replacements, 0);
  assert.equal(run({ bookings: [], previousRelations: first.meetingRelations }).meetingRelations.length, 0);
});

test("a proven replacement can itself be replaced later without losing the process or its original booking", () => {
  const first = run();
  const second = run({ previousRelations: first.meetingRelations, meetings: [meeting(),
    replacement({ status: "canceled", date_updated: "2026-09-14T08:00:00Z" }),
    replacement({ meeting_id: "third", starts_at: "2026-11-10T08:00:00Z", ends_at: "2026-11-10T09:00:00Z",
      date_created: "2026-09-15T08:00:00Z", date_updated: "2026-09-15T08:00:00Z" })] });
  assert.equal(second.diagnostics.replacements, 2); assert.equal(second.processes.length, 1);
  assert.equal(second.processes[0].next_meeting_id, "third"); assert.equal(second.processes[0].next_meeting_at, "2026-11-10T08:00:00Z");
  assert.equal(second.meetingRelations.find(m => m.meeting_id === "third")?.booking_activity_id, "booking");
  assert.equal(second.meetingRelations.filter(m => m.counts_as_setting_success).length, 1);
});

test("newly imported terminal evidence corrects a formerly assumed replacement relationship", () => {
  const again = { ...booking, source_activity_id: "again", occurred_at: "2026-09-10T07:30:00Z" };
  const meetings = [meeting(), replacement({ booking_activity_id: "again" })];
  const first = run({ meetings, bookings: [booking, again] });
  assert.equal(first.diagnostics.replacements, 1);
  const corrected = run({ meetings, bookings: [booking, again], previousRelations: first.meetingRelations,
    events: [event("closer_lost", { occurred_at: "2026-09-09T08:00:00Z" })] });
  assert.equal(corrected.diagnostics.replacements, 0); assert.equal(corrected.processes.length, 2);
});

test("completed old-lead work stays distinct from new bookings and milestones retain their own dates", () => {
  const r = run({ meetings: [meeting({ status: "completed" })], events: [event("setter_qualified", { occurred_at: "2026-08-25T08:30:00Z" }),
    event("cc2_agreed", { occurred_at: "2026-09-05T10:00:00Z" }), event("customer_won", { occurred_at: "2026-09-14T09:00:00Z", source_kind: "opportunity" })] });
  const p = r.processes[0];
  assert.equal(p.opened_at, "2026-08-15T08:00:00Z"); assert.equal(p.qualified_at, "2026-08-25T08:30:00Z");
  assert.equal(p.cc2_at, "2026-09-05T10:00:00Z"); assert.equal(p.won_at, "2026-09-14T09:00:00Z");
  assert.equal(p.state, "won"); assert.equal(p.next_meeting_at, null); assert.equal(r.processes.length, 1);
});

test("historical actual calls without documented booking stay explicitly undocumented", () => {
  const r = run({ bookings: [], meetings: [], events: [event("setter_follow_up")] });
  assert.equal(r.processes.length, 1); assert.equal(r.processes[0].documented_booking, false);
  assert.equal(r.processes[0].opening_booking_id, null); assert.equal(r.processes[0].first_meeting_at, null);
  assert.equal(r.processes[0].state, "follow_up"); assert.equal(r.meetingRelations.length, 0);
});

test("a true first customer acquisition overrides an earlier lost outcome on the same process", () => {
  const r = run({ meetings: [], events: [event("closer_lost"), event("customer_won", { occurred_at: "2026-09-12T09:00:00Z", source_kind: "opportunity" })] });
  assert.equal(r.processes.length, 1); assert.equal(r.processes[0].state, "won"); assert.equal(r.processes[0].won_at, "2026-09-12T09:00:00Z");
});

test("date-only Won does not invent an earlier completion time for another booking on the same Berlin day", () => {
  const dateWon = event("customer_won", { occurred_at: "2026-09-09T22:00:00Z", occurred_at_precision: "date", source_kind: "opportunity" });
  const sameDay = {...booking,source_activity_id:"same-day",occurred_at:"2026-09-10T09:00:00Z"};
  const nextDay = {...booking,source_activity_id:"next-day",occurred_at:"2026-09-10T22:00:00Z"};
  const same = run({ meetings: [], bookings: [booking,sameDay], events: [dateWon] });
  assert.equal(same.processes.length,1);assert.equal(same.processes[0].closed_at_precision,"date");
  assert.equal(same.eventRelations.find(e=>e.event_type==='customer_won')?.occurred_at_precision,'date');
  const next = run({ meetings: [], bookings: [booking,sameDay,nextDay], events: [dateWon] });
  assert.equal(next.processes.length,2);assert.equal(next.processes[1].opening_booking_id,'next-day');
});

test("date-only Won preserves same-day Setter and Closer milestones without reopening its won state", () => {
  const dateWon=event('customer_won',{occurred_at:'2026-09-09T22:00:00Z',occurred_at_precision:'date',source_kind:'opportunity'});
  const setter=event('setter_qualified',{occurred_at:'2026-09-10T10:00:00Z'});
  const closer=event('closer_sold',{occurred_at:'2026-09-10T16:00:00Z'});
  const r=run({meetings:[],events:[dateWon,setter,closer]});
  assert.equal(r.processes.length,1);const p=r.processes[0];
  assert.equal(p.setter_at,setter.occurred_at);assert.equal(p.qualified_at,setter.occurred_at);assert.equal(p.closer_at,closer.occurred_at);
  assert.equal(p.won_at,dateWon.occurred_at);assert.equal(p.state,'won');assert.equal(p.stage,'customer');
  assert.equal(p.closed_at,dateWon.occurred_at);assert.equal(p.closed_at_precision,'date');
  assert(r.eventRelations.filter(e=>['setter_qualified','closer_sold'].includes(e.event_type)).every(e=>e.applies_to_state));
});

test("a first booking on a date-only Won day remains documented instead of falling behind its midnight anchor", () => {
  const b={...booking,occurred_at:'2026-09-10T07:00:00Z'};
  const dateWon=event('customer_won',{occurred_at:'2026-09-09T22:00:00Z',occurred_at_precision:'date',source_kind:'opportunity'});
  const r=run({bookings:[b],meetings:[meeting({status:'completed',date_created:'2026-09-10T07:05:00Z'})],
    events:[dateWon,event('setter_qualified'),event('closer_sold',{occurred_at:'2026-09-10T16:00:00Z'})]});
  assert.equal(r.processes.length,1);const p=r.processes[0];
  assert.equal(p.process_id,'close-process:booking');assert.equal(p.documented_booking,true);assert.equal(p.opened_at,b.occurred_at);
  assert.equal(p.first_meeting_at,'2026-09-10T08:00:00Z');assert.equal(p.state,'won');
  assert.equal(p.qualified_at,'2026-09-10T08:30:00Z');assert.equal(p.closer_at,'2026-09-10T16:00:00Z');
  assert.equal(r.diagnostics.undocumentedProcesses,0);assert.equal(r.meetingRelations[0].counts_as_setting_success,true);
});

test("simultaneous contradictory outcomes are unclear rather than ordered by source ID", () => {
  for(const [a,b] of [['a','z'],['z','a']]) {
    const events=[event('setter_qualified',{source_event_id:a}),event('setter_disqualified',{source_event_id:b})];
    const r=run({meetings:[meeting({status:'completed'})],events,bookings:[booking,{...booking,source_activity_id:'later',occurred_at:'2026-09-11T08:00:00Z'}]});
    assert.equal(r.processes.length,1);const p=r.processes[0];
    assert.equal(p.state,'unclear');assert.equal(p.stage,'setter');assert.equal(p.setter_at,'2026-09-10T08:30:00Z');
    assert.equal(p.qualified_at,null);assert.equal(p.closed_at,null);assert.equal(p.latest_event_id,null);
    assert.equal(r.diagnostics.conflictingStateGroups,1);
    assert(r.eventRelations.filter(e=>e.event_type.startsWith('setter_')).every(e=>e.state_conflict&&!e.applies_to_state));
  }
});

test("conflicting Closer outcomes retain performed work but invent neither CC2 nor final loss", () => {
  const r=run({meetings:[],events:[event('cc2_agreed'),event('closer_lost')]});
  assert.equal(r.processes[0].state,'unclear');assert.equal(r.processes[0].closer_at,'2026-09-10T08:30:00Z');
  assert.equal(r.processes[0].cc2_at,null);assert.equal(r.processes[0].closed_at,null);
});

test("later unambiguous evidence resolves a conflict and canonical Won wins over concurrent CRM outcome labels", () => {
  const conflict=[event('setter_qualified'),event('setter_disqualified')];
  const r=run({meetings:[],events:[...conflict,event('setter_follow_up',{occurred_at:'2026-09-11T09:00:00Z'})]});
  assert.equal(r.processes[0].state,'follow_up');assert.equal(r.processes[0].closed_at,null);
  const won=run({meetings:[],events:[event('closer_lost'),event('customer_won',{source_kind:'opportunity'})]});
  assert.equal(won.processes[0].state,'won');assert.equal(won.diagnostics.conflictingStateGroups,0);
});

test("ordinary events after terminal do not silently reopen a process without new booking", () => {
  const r = run({ meetings: [], events: [event("closer_lost"), event("setter_follow_up", { occurred_at: "2026-09-12T09:00:00Z" })] });
  assert.equal(r.processes.length, 1); assert.equal(r.processes[0].state, "lost"); assert.equal(r.diagnostics.eventsAfterTerminalWithoutBooking, 1);
  assert.equal(r.eventRelations.find(e => e.event_type === "setter_follow_up")?.applies_to_state, false);
  assert.equal(r.eventRelations.find(e => e.event_type === "closer_lost")?.applies_to_state, true);
});

test("CC1 or CC2 sale awaits verified Won and does not invent an acquired customer", () => {
  for (const type of ["closer_sold", "cc2_sold"] as const) {
    const r = run({ meetings: [], events: [event(type)] });
    assert.equal(r.processes[0].state, "sold_pending_won"); assert.equal(r.processes[0].won_at, null);
    assert.equal(r.processes[0].closed_at, null); assert.equal(r.processes[0].closer_at, "2026-09-10T08:30:00Z");
    assert.equal(r.processes[0].stage, type === "cc2_sold" ? "cc2" : "closer");
  }
});

test("attendance evidence ends with the Berlin meeting day and cannot attach to the previous slot", () => {
  const nextDay = event("setter_no_show", { meeting_id: "old", occurred_at: "2026-09-10T22:00:00Z" });
  const noMatch = run({ meetings: [meeting({ status: "upcoming" })], events: [nextDay] });
  assert.equal(noMatch.diagnostics.unassignedNegativeEvents, 1);
  assert.equal(noMatch.processes[0].state, "awaiting_result");
  const b2 = { ...booking, source_activity_id: "second", occurred_at: "2026-09-01T08:00:00Z" };
  const second = meeting({ meeting_id: "second", booking_activity_id: "second", status: "upcoming", starts_at: "2026-09-10T12:00:00Z", ends_at: "2026-09-10T13:00:00Z" });
  const r = run({ meetings: [meeting({ status: "upcoming" }), second], bookings: [booking, b2],
    events: [event("setter_no_show", { meeting_id: "old", occurred_at: "2026-09-10T12:30:00Z" })] });
  assert.equal(r.diagnostics.unassignedNegativeEvents, 1);
});

test("replaying the same snapshot is deterministic and does not duplicate a process or event relation", () => {
  const events = [event("setter_qualified"), event("setter_qualified")];
  const first = run({ meetings: [meeting({ status: "completed" })], events });
  const repeated = run({ meetings: [meeting({ status: "completed" })], events, previousRelations: first.meetingRelations, previousProcesses: first.processes });
  assert.deepEqual(repeated, first); assert.equal(repeated.eventRelations.length, 2);
  assert.equal(repeated.processes.length, 1);
});

test("invalid timestamps and duplicate identity fail closed", () => {
  assert.throws(() => run({ dataAsOf: "2026-09-15" }), /invalid_process_timestamp/);
  assert.throws(() => run({ bookings: [booking, booking] }), /duplicate_process_booking/);
  assert.throws(() => run({ meetings: [meeting(), meeting()] }), /duplicate_process_meeting/);
  assert.throws(() => run({ events: [event("setter_follow_up"), event("setter_follow_up", { occurred_at: "2026-09-10T09:00:00Z" })] }), /conflicting_process_event/);
});
