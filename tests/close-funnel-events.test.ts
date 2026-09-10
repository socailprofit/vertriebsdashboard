import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVITY_TYPES, CLOSE_USERS, CUSTOM_FIELDS, SALES_PIPELINE } from "../supabase/functions/_shared/close-mapping.ts";
import { prepareMeetingSnapshot } from "../supabase/functions/_shared/close-meetings.ts";
import { ACQUISITION_WON_STATUS_ID, OPPORTUNITY_DEAL_TYPE_FIELD, prepareFunnelEventSnapshot, toProcessEvents, validateFunnelLeadRecord } from "../supabase/functions/_shared/close-funnel-events.ts";
import { prepareCustomReconciliation } from "../supabase/functions/_shared/close-reconciliation.ts";
import { deriveCloseProcesses } from "../supabase/functions/_shared/close-processes.ts";

const dataAsOf = "2026-09-10T12:00:00Z";
const activity = (overrides = {}) => ({ id: "custom-1", lead_id: "lead-1", user_id: CLOSE_USERS.antony,
  activity_at: "2026-02-12T09:00:00Z", date_created: "2026-02-12T09:00:00Z", date_updated: "2026-02-12T09:00:00Z",
  custom_activity_type_id: ACTIVITY_TYPES.setterCall, status: "published",
  [`custom.${CUSTOM_FIELDS.setterResult}`]: "🔎 Setter Follow Up", ...overrides });
const status = (overrides = {}) => ({ id: "status-1", lead_id: "lead-1", user_id: CLOSE_USERS.antony,
  activity_at: "2026-09-10T09:00:00Z", date_created: "2026-09-10T09:00:00Z", date_updated: "2026-09-10T09:00:00Z",
  old_status_id: "status-old", new_status_id: "status-new", ...overrides });
const won = (overrides = {}) => ({ id: "opportunity-1", lead_id: "lead-1", pipeline_id: SALES_PIPELINE.id,
  status_id: ACQUISITION_WON_STATUS_ID, status_type: "won" as const, date_won: "2026-09-04",
  value_period: "one_time" as const, date_created: "2026-02-10T10:00:00Z", date_updated: "2026-09-04T15:00:00Z", ...overrides });
const input = (overrides = {}) => ({ customRecords: [], meetings: [], statusChanges: [], opportunities: [], dataAsOf, ...overrides });

test("full source history persists older Setter activity without a reporting-window cutoff", async () => {
  const events = await prepareFunnelEventSnapshot(input({ customRecords: [activity()] }));
  assert.equal(events.length, 1);
  assert.equal(events[0].occurred_at, "2026-02-12T09:00:00Z");
  assert.equal(events[0].setter_id, CLOSE_USERS.antony);
  assert.equal(toProcessEvents(events, dataAsOf)[0].event_type, "setter_follow_up");
});
test("same snapshot order, duplicate source rows and sync time do not create revisions", async () => {
  const row = activity();
  const first = await prepareFunnelEventSnapshot(input({ customRecords: [row] }));
  const reordered = Object.fromEntries(Object.entries(row).reverse());
  const second = await prepareFunnelEventSnapshot(input({ customRecords: [reordered, row], dataAsOf: "2026-09-11T12:00:00Z" }));
  assert.deepEqual(first, second);
  assert.match(first[0].source_revision, /^[a-f0-9]{64}$/);
});
test("corrections and reversions share external identity, retain distinct source revisions", async () => {
  const original = (await prepareFunnelEventSnapshot(input({ customRecords: [activity()] })))[0];
  const corrected = (await prepareFunnelEventSnapshot(input({ customRecords: [activity({ status: "draft", date_updated: "2026-09-10T10:00:00Z" })] })))[0];
  const reverted = (await prepareFunnelEventSnapshot(input({ customRecords: [activity({ date_updated: "2026-09-10T11:00:00Z" })] })))[0];
  assert.equal(original.source_event_id, corrected.source_event_id);
  assert.equal(original.event_type, corrected.event_type);
  assert.notEqual(original.source_revision, corrected.source_revision);
  assert.notEqual(original.source_revision, reverted.source_revision);
  assert.deepEqual(toProcessEvents([corrected], dataAsOf), []);
});
test("removed appointment outcome stays same fixed source type, but no longer yields a booking", async () => {
  const record = activity({ custom_activity_type_id: ACTIVITY_TYPES.openingCall,
    [`custom.${CUSTOM_FIELDS.openingDecisionMakerResult}`]: "Entscheider: Termin vereinbart" });
  const before = await prepareFunnelEventSnapshot(input({ customRecords: [record] }));
  assert.equal(toProcessEvents(before, dataAsOf)[0].event_type, "booking");
  assert.equal(before[0].setter_id, null, "booking author is not automatically the Setter");
  const after = await prepareFunnelEventSnapshot(input({ customRecords: [{ ...record,
    [`custom.${CUSTOM_FIELDS.openingDecisionMakerResult}`]: "Entscheider: Follow Up", date_updated: dataAsOf }], historicalBookingSourceIds: new Set([record.id]) }));
  assert.equal(after[0].event_type, before[0].event_type);
  assert.deepEqual(toProcessEvents(after, dataAsOf), []);
});
test("ordinary Opening/Follow-up facts stay in raw performance but do not inflate the sales-funnel journal", async () => {
  const rows = [activity({ id: "opening", user_id: CLOSE_USERS.michael, custom_activity_type_id: ACTIVITY_TYPES.openingCall,
    activity_at: "2026-09-09T09:00:00Z", [`custom.${CUSTOM_FIELDS.openingGatekeeperResult}`]: "✅ Durchgestellt" }),
    activity({ id: "follow-up", custom_activity_type_id: ACTIVITY_TYPES.followUp,
      [`custom.${CUSTOM_FIELDS.followUpDecisionMakerResult}`]: "Entscheider: Follow Up" })];
  const historical = await prepareFunnelEventSnapshot(input({ customRecords: rows }));
  assert.deepEqual(historical, []);
  const retained = prepareCustomReconciliation(rows, "2026-07-01", "2026-09-10", dataAsOf);
  assert.equal(retained.raw.length, 1);
  assert.equal(retained.facts[0].connectedCalls, 1);
});
test("historical booking markers retain removed outcomes, drafts and reactivation without inventing a booking", async () => {
  for (const type of [ACTIVITY_TYPES.openingCall, ACTIVITY_TYPES.followUp]) {
    const row = activity({ custom_activity_type_id: type, status: "draft" });
    assert.deepEqual(await prepareFunnelEventSnapshot(input({ customRecords: [row] })), []);
    const kept = await prepareFunnelEventSnapshot(input({ customRecords: [row], historicalBookingSourceIds: new Set([row.id]) }));
    assert.equal(kept.length, 1); assert.deepEqual(toProcessEvents(kept, dataAsOf), []);
    const field = type === ACTIVITY_TYPES.openingCall ? CUSTOM_FIELDS.openingDecisionMakerResult : CUSTOM_FIELDS.followUpDecisionMakerResult;
    const reactivated = await prepareFunnelEventSnapshot(input({ customRecords: [{ ...row, status: "published", [`custom.${field}`]: "4: ✅ Termin vereinbart" }] }));
    assert.deepEqual(toProcessEvents(reactivated, dataAsOf).map(e => e.event_type), ["booking"]);
  }
});
test("filtering unrelated Opening rows cannot conceal contradictory source revisions in one page snapshot", async () => {
  const row = activity({ custom_activity_type_id: ACTIVITY_TYPES.openingCall,
    [`custom.${CUSTOM_FIELDS.openingDecisionMakerResult}`]: "Entscheider: Termin vereinbart" });
  await assert.rejects(() => prepareFunnelEventSnapshot(input({ customRecords: [row, { ...row, status: "draft" }] })), /unstable_funnel_pagination/);
});
test("PII, descriptions, notes and unknown CRM custom fields never enter journal payload", async () => {
  const events = await prepareFunnelEventSnapshot(input({ customRecords: [activity({ note: "PRIVATE_NOTE", lead_name: "PRIVATE_NAME", email: "PRIVATE_EMAIL",
    "custom.cf_unrelated": "PRIVATE_CUSTOM" })], statusChanges: [status({ new_status_label: "PRIVATE_LABEL" })] }));
  assert(!JSON.stringify(events).includes("PRIVATE_"));
});
test("one Close ID with contradictory page versions fails closed instead of counting both", async () => {
  await assert.rejects(() => prepareFunnelEventSnapshot(input({ customRecords: [activity(), activity({ status: "draft" })] })), /unstable_funnel_pagination/);
});
test("former authors remain historical evidence without reassignment; unknown types are excluded", async () => {
  const journal=await prepareFunnelEventSnapshot(input({ customRecords: [activity({ user_id: "other-user" }), activity({ custom_activity_type_id: "other-type" })] }));
  assert.equal(journal.length,1);assert.equal(journal[0].setter_id,"other-user");
  assert.equal(toProcessEvents(journal,dataAsOf)[0].setter_id,"other-user");
});
test("future dated CRM outcomes are preserved but excluded from actual process events", async () => {
  const events = await prepareFunnelEventSnapshot(input({ customRecords: [activity({ activity_at: "2026-10-01T09:00:00Z" })] }));
  assert.equal(events.length, 1);
  assert.deepEqual(toProcessEvents(events, dataAsOf), []);
  assert.equal(toProcessEvents(events, "2026-10-01T09:00:00Z").length, 1);
});
test("a pre-existing source edited after the snapshot cutoff fails closed for every source kind", async () => {
  const futureUpdate = "2026-09-10T12:00:00.001Z";
  const meeting = prepareMeetingSnapshot([{ id: "meeting-race", lead_id: "lead-1", user_id: CLOSE_USERS.antony,
    starts_at: "2026-10-01T10:00:00Z", ends_at: "2026-10-01T11:00:00Z",
    date_created: "2026-09-01T09:00:00Z", date_updated: futureUpdate }], [], dataAsOf).meetings;
  for (const rows of [
    { customRecords: [activity({ date_updated: futureUpdate })] },
    { statusChanges: [status({ date_updated: futureUpdate })] },
    { opportunities: [won({ date_updated: futureUpdate })] },
    { meetings: meeting },
  ]) await assert.rejects(() => prepareFunnelEventSnapshot(input(rows)), /funnel_source_changed_during_snapshot/);
});
test("a source created after cutoff waits for the next snapshot instead of invalidating older data", async () => {
  const after = "2026-09-10T12:00:00.001Z";
  assert.deepEqual(await prepareFunnelEventSnapshot(input({ customRecords: [activity({ date_created: after, date_updated: after })],
    statusChanges: [status({ date_created: after, date_updated: after })], opportunities: [won({ date_created: after, date_updated: after })] })), []);
});
test("refreshed current lead metadata requires matching identity, explicit status and an observed timestamp", () => {
  const lead = { id: "lead-1", status_id: "status-1", date_updated: dataAsOf };
  validateFunnelLeadRecord(lead, "lead-1", dataAsOf);
  for (const invalid of [{ ...lead, id: "wrong-lead" }, { ...lead, status_id: null }, { ...lead, date_updated: "2026-09-10" }])
    assert.throws(() => validateFunnelLeadRecord(invalid, "lead-1", dataAsOf), /invalid_funnel_lead/);
  assert.throws(() => validateFunnelLeadRecord({ ...lead, date_updated: "2026-09-10T12:00:00.001Z" }, "lead-1", dataAsOf), /funnel_source_changed_during_snapshot/);
});
test("lead status changes including fast consolidated revisions are history, never KPI performance", async () => {
  const first = await prepareFunnelEventSnapshot(input({ statusChanges: [status()] }));
  const updated = await prepareFunnelEventSnapshot(input({ statusChanges: [status({ new_status_id: "another-status", date_updated: "2026-09-10T09:30:00Z" })] }));
  assert.equal(first[0].source_event_id, updated[0].source_event_id);
  assert.notEqual(first[0].source_revision, updated[0].source_revision);
  assert.equal(first[0].previous_status, "status-old");
  assert.deepEqual(toProcessEvents(updated, dataAsOf).map(e => e.event_type), ["status_changed"]);
});
test("meeting moves between months produce revisions, not performed Setter calls or new bookings", async () => {
  const record = { id: "meeting-1", lead_id: "lead-1", user_id: CLOSE_USERS.antony, title: "Setter",
    starts_at: "2026-09-10T10:00:00Z", ends_at: "2026-09-10T11:00:00Z", date_created: "2026-09-01T09:00:00Z", date_updated: "2026-09-01T09:00:00Z",
    attendees: [{ contact_id: "contact-1", name: "PRIVATE_NAME", email: "PRIVATE_EMAIL", status: "yes" }], status: "completed" };
  const before = await prepareFunnelEventSnapshot(input({ meetings: prepareMeetingSnapshot([record], [], dataAsOf).meetings }));
  const after = await prepareFunnelEventSnapshot(input({ meetings: prepareMeetingSnapshot([{ ...record, starts_at: "2026-10-15T09:00:00Z",
    ends_at: "2026-10-15T10:00:00Z", date_updated: dataAsOf }], [], dataAsOf).meetings }));
  assert.equal(before[0].source_event_id, after[0].source_event_id);
  assert.notEqual(before[0].source_revision, after[0].source_revision);
  assert.equal(after[0].occurred_at, "2026-10-15T09:00:00Z");
  assert(!JSON.stringify(before).includes("PRIVATE_"));
  assert.deepEqual(toProcessEvents(before, dataAsOf), []);
});
test("participant and calendar UID ordering has no effect on source revision", async () => {
  const meeting = { meeting_id: "meeting-1", lead_id: "lead-1", owner_id: CLOSE_USERS.antony, contact_id: null,
    starts_at: "2026-10-01T10:00:00Z", ends_at: "2026-10-01T11:00:00Z", date_created: "2026-09-01T09:00:00Z", date_updated: "2026-09-01T09:00:00Z",
    status: "upcoming", participant_ids: [{ contact_id: "c1", user_id: null, status: "yes" }, { contact_id: "c2", user_id: null, status: "no" }],
    calendar_event_uids: ["uid1", "uid2"], excluded_purpose: false, booking_activity_id: null, booking_owner_id: null };
  const a = await prepareFunnelEventSnapshot(input({ meetings: [meeting] }));
  const b = await prepareFunnelEventSnapshot(input({ meetings: [{ ...meeting, participant_ids: [...meeting.participant_ids].reverse(), calendar_event_uids: ["uid2", "uid1"] }] }));
  assert.deepEqual(a, b);
});
test("calendar purpose persists as a categorical journal field without activating consultation performance",async()=>{
 const record={id:"purpose-meeting",lead_id:"lead-1",user_id:CLOSE_USERS.antony,title:"Beratung: PRIVATE_PERSON",
  starts_at:"2026-10-01T10:00:00Z",ends_at:"2026-10-01T10:30:00Z",date_created:"2026-09-01T09:00:00Z",date_updated:"2026-09-01T09:00:00Z"};
 const calendar=prepareMeetingSnapshot([record],[],dataAsOf);
 const events=await prepareFunnelEventSnapshot(input({meetings:calendar.meetings}));
 assert.equal(events[0].payload.purpose_code,"consultation");assert.equal(events[0].payload.excluded_purpose,true);
 assert.equal(JSON.stringify(events).includes("PRIVATE_PERSON"),false);assert.deepEqual(toProcessEvents(events,dataAsOf),[]);
 const invalid=await prepareFunnelEventSnapshot(input({meetings:[{...calendar.meetings[0],purpose_code:"PRIVATE_CATEGORY"}]}));
 assert.equal(invalid[0].payload.purpose_code,"unclassified");assert.equal(JSON.stringify(invalid).includes("PRIVATE_CATEGORY"),false);
});
test("only the first exact Neukunde status event creates an acquisition, including older phases", async () => {
 const customer="stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory";
 const events=await prepareFunnelEventSnapshot(input({opportunities:[won()],statusChanges:[
  status({id:"old",new_status_id:customer,date_created:"2026-02-19T09:00:00Z",activity_at:"2026-02-19T09:00:00Z"}),
  status({id:"repeat",new_status_id:customer}),status({id:"general",lead_id:"lead-2",new_status_id:"sold-general"})]}));
 const process=toProcessEvents(events,dataAsOf).filter(e=>e.event_type==="customer_won");
 assert.deepEqual(process.map(e=>[e.source_event_id,e.occurred_at]),[["old","2026-02-19T09:00:00Z"]]);
});
test("future acquisition and custom-sale assertions are not an additional actual new customer", async () => {
  const events = await prepareFunnelEventSnapshot(input({ opportunities: [won({ date_won: "2026-10-01" })], customRecords: [activity({ custom_activity_type_id: ACTIVITY_TYPES.closerCall,
    [`custom.${CUSTOM_FIELDS.closerResult}`]: "3. ✅ Verkauft - in CC2 🔥" })] }));
  assert.deepEqual(toProcessEvents(events, dataAsOf).map(e => e.event_type), ["cc2_sold"]);
});
test("opportunity dates and deal type never substitute the Neukunde status event", async () => {
 for(const date of ["2026-03-29","2026-09-10","2026-10-25"]){
  const events=await prepareFunnelEventSnapshot(input({opportunities:[won({date_won:date,[`custom.${OPPORTUNITY_DEAL_TYPE_FIELD}`]:"Neukunde"})]}));
  assert.deepEqual(toProcessEvents(events,"2026-12-01T00:00:00Z"),[]);
 }
});
test("a status event recorded in the future is not an actual customer",async()=>{
 const events=await prepareFunnelEventSnapshot(input({statusChanges:[status({date_created:"2026-10-01T09:00:00Z",new_status_id:"stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory"})]}));
 assert.equal(toProcessEvents(events,dataAsOf).filter(e=>e.event_type==="customer_won").length,0);
});
test("explicit Setter and Closer outcomes support deterministic process attribution", async () => {
  const cases = [
    [ACTIVITY_TYPES.setterCall, CUSTOM_FIELDS.setterResult, "✅ Closer terminiert", ["setter_qualified"]],
    [ACTIVITY_TYPES.setterCall, CUSTOM_FIELDS.setterResult, "❌ Disqualifiziert", ["setter_disqualified"]],
    [ACTIVITY_TYPES.closerCall, CUSTOM_FIELDS.closerResult, "2. 🔥 CC2 vereinbart", ["cc2_agreed"]],
    [ACTIVITY_TYPES.closerCall, CUSTOM_FIELDS.closerResult, "4. ❌ Nicht verkauft", ["closer_follow_up"]],
    [ACTIVITY_TYPES.noShow, CUSTOM_FIELDS.setterNoShow, "⛔ Abgesagt", ["setter_cancelled"]],
    [ACTIVITY_TYPES.noShow, CUSTOM_FIELDS.setterNoShow, "🔄 Termin verschoben", ["setter_rescheduled"]],
    [ACTIVITY_TYPES.noShow, CUSTOM_FIELDS.closerNoShow, "Nicht erschienen", ["closer_no_show"]],
  ] as const;
  for (const [type, field, value, expected] of cases) {
    const events = await prepareFunnelEventSnapshot(input({ customRecords: [activity({ custom_activity_type_id: type, [`custom.${field}`]: value })] }));
    assert.deepEqual(toProcessEvents(events, dataAsOf).map(e => e.event_type), expected);
  }
});
test("invalid source identity, timestamps or impossible Won date fail closed", async () => {
  for (const row of [activity({ id: "" }), activity({ date_updated: "2026-09-01" }), activity({ activity_at: "bad" })])
    await assert.rejects(() => prepareFunnelEventSnapshot(input({ customRecords: [row] })));
  await assert.rejects(() => prepareFunnelEventSnapshot(input({ opportunities: [won({ date_won: "2026-02-30" })] })), /invalid_funnel_won_date/);
  await assert.rejects(() => prepareFunnelEventSnapshot(input({ statusChanges: [status({ new_status_id: null })] })), /invalid_funnel_new_status/);
});

test("source-to-process integration carries September cancellation plus October replacement as one booked process", async () => {
  const raw = [activity({ id: "booking", custom_activity_type_id: ACTIVITY_TYPES.openingCall, user_id: CLOSE_USERS.felix,
    activity_at: "2026-09-01T09:00:00Z", date_created: "2026-09-01T09:00:00Z", date_updated: "2026-09-01T09:00:00Z",
    [`custom.${CUSTOM_FIELDS.openingDecisionMakerResult}`]: "Entscheider: Termin vereinbart" }),
  activity({ id: "cancellation", custom_activity_type_id: ACTIVITY_TYPES.noShow,
    activity_at: "2026-09-02T09:00:00Z", date_created: "2026-09-02T09:00:00Z", date_updated: "2026-09-02T09:00:00Z",
    [`custom.${CUSTOM_FIELDS.setterNoShow}`]: "⛔ Abgesagt" })];
  const bookings = prepareCustomReconciliation(raw, "2026-07-01", "2026-09-10", dataAsOf).bookings;
  const meeting = { id: "meeting-old", lead_id: "lead-1", user_id: CLOSE_USERS.antony, title: "Setter",
    starts_at: "2026-09-15T10:00:00Z", ends_at: "2026-09-15T11:00:00Z", date_created: "2026-09-01T09:30:00Z",
    date_updated: "2026-09-02T09:00:00Z", status: "canceled" };
  const meetings = prepareMeetingSnapshot([meeting, { ...meeting, id: "meeting-new", status: "upcoming",
    starts_at: "2026-10-15T10:00:00Z", ends_at: "2026-10-15T11:00:00Z", date_created: "2026-09-03T09:00:00Z",
    date_updated: "2026-09-03T09:00:00Z" }], bookings, dataAsOf).meetings;
  const events = await prepareFunnelEventSnapshot(input({ customRecords: raw, meetings }));
  const flow = deriveCloseProcesses({ meetings, bookings, events: toProcessEvents(events, dataAsOf), dataAsOf });
  assert.equal(flow.processes.length, 1);
  assert.equal(flow.diagnostics.replacements, 1);
  assert.equal(flow.processes[0].next_meeting_at, "2026-10-15T10:00:00Z");
  assert.equal(flow.processes[0].setter_at, null);
  assert.equal(flow.meetingRelations.find(r => r.meeting_id === "meeting-new")?.relation_type, "replacement");
  assert.equal(flow.eventRelations.find(r => r.source_event_id === "cancellation")?.applies_to_state, false);
});
