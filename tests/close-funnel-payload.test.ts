import assert from "node:assert/strict";
import test from "node:test";
import { funnelPayloadBytes } from "../supabase/functions/_shared/close-funnel-payload.ts";

const snapshot = () => ({ p_start_date: "2026-07-01", p_end_date: "2026-09-10", p_snapshot_started_at: "2026-09-10T11:00:00Z",
  p_raw: [], p_facts: [], p_opportunities: [], p_leads: [], p_bookings: [], p_meetings: [], p_calendar_leads: [],
  p_events: [{ source_event_id: "PRIVATE_ID", payload: { text: 'äö😀"\\\nPRIVATE_VALUE' } }], p_processes: [],
  p_meeting_relations: [], p_event_relations: [], p_funnel_leads: [], p_status_created_since: "2026-07-01T00:00:00Z" });
test("section totals equal the exact UTF-8 RPC envelope including non-ASCII and JSON escaping", () => {
  const payload = snapshot(), result = funnelPayloadBytes(payload);
  assert.equal(result.totalBytes, new TextEncoder().encode(JSON.stringify({ p_snapshot: payload })).length);
  assert.equal(result.sections.p_events.rows, 1);
  assert.equal(result.sections.p_events.bytes, new TextEncoder().encode(JSON.stringify(payload.p_events)).length);
  assert(!JSON.stringify(result).includes("PRIVATE_"));
});
test("size diagnostics cannot silently omit an undefined section or expose unexpected section names", () => {
  assert.throws(() => funnelPayloadBytes({ ...snapshot(), p_events: undefined }), /incomplete_funnel_payload_diagnostics/);
  assert.throws(() => funnelPayloadBytes({ ...snapshot(), PRIVATE_FIELD: [] }), /unexpected_funnel_payload_sections/);
});
