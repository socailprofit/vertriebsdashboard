import assert from "node:assert/strict";
import test from "node:test";
import { CLOSE_USERS } from "../supabase/functions/_shared/close-mapping.ts";
import { CLOSE_TASK_FIELDS, normalizeCloseTask, safeTaskPurposeCode } from "../supabase/functions/_shared/close-tasks.ts";
import { prepareFunnelEventSnapshot, toProcessEvents } from "../supabase/functions/_shared/close-funnel-events.ts";
const dataAsOf = "2026-09-10T12:00:00Z";
const task = (extra = {}) => ({ id: "task-1", _type: "lead", lead_id: "lead-1", assigned_to: CLOSE_USERS.antony,
 contact_id: "contact-1", date: "2026-10-15", date_created: "2026-09-01T08:00:00Z", date_updated: "2026-09-09T09:00:00Z",
 is_complete: false, is_dateless: false, text: "Follow up", ...extra });
const input = (extra = {}) => ({ customRecords: [], meetings: [], statusChanges: [], opportunities: [], dataAsOf, ...extra });
test("native date-only task keeps its October due date without any fabricated clock", async () => {
 const row = normalizeCloseTask(task(), dataAsOf)!;
 assert.equal(row.due_date, "2026-10-15"); assert.equal(row.due_at, null); assert.equal(row.due_precision, "date");
 const [event] = await prepareFunnelEventSnapshot(input({ taskRecords: [task()] }));
 assert.equal(event.occurred_at, task().date_updated); assert.equal(event.payload.due_at, null);
 assert.equal(event.new_status, "open"); assert.equal(event.setter_id, null); assert.equal(event.closer_id, null);
 assert.deepEqual(toProcessEvents([event], "2026-10-16T12:00:00Z"), []);
});
test("exact due timestamps preserve source time and derive the correct Berlin calendar day across DST", () => {
 for (const [date, day] of [["2026-03-28T23:30:00Z", "2026-03-29"], ["2026-03-29T22:30:00Z", "2026-03-30"], ["2026-10-25T23:30:00Z", "2026-10-26"]]) {
  const row = normalizeCloseTask(task({ date }), dataAsOf)!;
  assert.equal(row.due_at, date); assert.equal(row.due_date, day); assert.equal(row.due_precision, "timestamp");
 }
});
test("dateless task is unscheduled even if Close retains a native date value", () => {
 for (const date of [null, "2026-10-15"]) {
  const row = normalizeCloseTask(task({ is_dateless: true, date }), dataAsOf)!;
  assert.equal(row.due_at, null); assert.equal(row.due_date, null); assert.equal(row.due_precision, "none");
 }
});
test("only normalized exact Follow up becomes a closed purpose category; all source free text is omitted", async () => {
 for (const text of ["Follow up", " FOLLOW  UP ", "Follow\tup", "Ｆｏｌｌｏｗ ｕｐ"]) assert.equal(safeTaskPurposeCode(text), "follow_up");
 for (const text of ["Follow-up", "Follow up Kunde", "Nachfassen", "Do not Follow up", null]) assert.equal(safeTaskPurposeCode(text), null);
 const events = await prepareFunnelEventSnapshot(input({ taskRecords: [task({ text: "PRIVATE_TEXT", assigned_to_name: "PRIVATE_NAME", lead_name: "PRIVATE_COMPANY" })] }));
 assert(!JSON.stringify(events).includes("PRIVATE_")); assert.equal(events[0].payload.purpose_code, null);
 assert(!CLOSE_TASK_FIELDS.includes("assigned_to_name")); assert(!CLOSE_TASK_FIELDS.includes("lead_name"));
});
test("stable source ID and permitted fields give deterministic idempotent revisions", async () => {
 const first = await prepareFunnelEventSnapshot(input({ taskRecords: [task()] }));
 const second = await prepareFunnelEventSnapshot(input({ taskRecords: [Object.fromEntries(Object.entries(task()).reverse()), task()], dataAsOf: "2026-09-11T12:00:00Z" }));
 assert.deepEqual(first, second); assert.match(first[0].source_revision, /^[0-9a-f]{64}$/);
 const corrected = await prepareFunnelEventSnapshot(input({ taskRecords: [task({ date: "2026-11-02", date_updated: dataAsOf })] }));
 assert.equal(first[0].source_event_id, corrected[0].source_event_id); assert.notEqual(first[0].source_revision, corrected[0].source_revision);
 await assert.rejects(prepareFunnelEventSnapshot(input({ taskRecords: [task(), task({ is_complete: true })] })), /unstable_funnel_pagination/);
});
test("completion is explicit source metadata and absence never becomes a performed call or inferred completion", async () => {
 const [completed] = await prepareFunnelEventSnapshot(input({ taskRecords: [task({ is_complete: true })] }));
 assert.equal(completed.new_status, "completed"); assert.equal(completed.payload.is_complete, true);
 assert.deepEqual(toProcessEvents([completed], dataAsOf), []);
 assert.deepEqual(await prepareFunnelEventSnapshot(input({ taskRecords: [] })), []);
 assert.deepEqual(await prepareFunnelEventSnapshot(input()), await prepareFunnelEventSnapshot(input({ taskRecords: [] })));
});
test("scope is Antony lead tasks, and a source changed while fetching fails closed", async () => {
 assert.equal(normalizeCloseTask(task({ assigned_to: CLOSE_USERS.michael }), dataAsOf), null);
 assert.equal(normalizeCloseTask(task({ _type: "outgoing_call" }), dataAsOf), null);
 assert.equal(normalizeCloseTask(task({ date_created: "2026-09-11T12:00:00Z" }), dataAsOf), null);
 assert.throws(() => normalizeCloseTask(task({ date_updated: "2026-09-10T12:00:00.001Z" }), dataAsOf), /changed_during_snapshot/);
 for (const extra of [{ date: "2026-02-30" }, { date: null }, { is_complete: "false" }, { is_dateless: null }, { date_updated: "2026-09-01" }, { date_updated: "2026-08-01T00:00:00Z" }, { lead_id: null }]) {
  assert.throws(() => normalizeCloseTask(task(extra), dataAsOf), /invalid_task|missing_task/);
 }
});
