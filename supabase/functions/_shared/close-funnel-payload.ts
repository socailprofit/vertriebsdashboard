const encoder = new TextEncoder();
const keys = ["p_start_date", "p_end_date", "p_snapshot_started_at", "p_raw", "p_facts", "p_opportunities", "p_leads",
  "p_bookings", "p_meetings", "p_calendar_leads", "p_events", "p_processes", "p_meeting_relations",
  "p_event_relations", "p_funnel_leads", "p_status_created_since"] as const;

/** Only fixed section names and counts leave this function; no source content. */
export function funnelPayloadBytes(snapshot: Record<string, unknown>) {
  const sections: Record<string, { bytes: number; rows: number | null }> = {};
  let totalBytes = encoder.encode('{"p_snapshot":{}}').byteLength + keys.length - 1;
  for (const key of keys) {
    const value = snapshot[key], encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("incomplete_funnel_payload_diagnostics");
    const bytes = encoder.encode(encoded).byteLength;
    sections[key] = { bytes, rows: Array.isArray(value) ? value.length : null };
    totalBytes += encoder.encode(JSON.stringify(key)).byteLength + 1 + bytes;
  }
  if (Object.keys(snapshot).length !== keys.length) throw new Error("unexpected_funnel_payload_sections");
  return { totalBytes, sections };
}
