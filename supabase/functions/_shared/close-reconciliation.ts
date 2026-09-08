import { CLOSE_USERS, CUSTOM_FIELDS, ACTIVITY_TYPES, mapCustomActivity, mapWonOpportunity, metricTimeInReportingTimezone, type CloseCustomActivity, type CloseOpportunity, type LeadAttribution } from "./close-mapping.ts";

type Row = Record<string, unknown>;
// No CRM notes, names or conversation text are needed for reconciliation.
export const CUSTOM_RECONCILIATION_FIELDS = [
  "id", "lead_id", "user_id", "activity_at", "date_created", "date_updated",
  "custom_activity_type_id", "status",
  ...Object.entries(CUSTOM_FIELDS).filter(([name]) => !name.startsWith("lead")).map(([, id]) => `custom.${id}`),
];

export function normalizeCustomRecord(record: Row): CloseCustomActivity {
  if (typeof record.id !== "string" || typeof record.lead_id !== "string"
    || typeof record.activity_at !== "string" || !Number.isFinite(Date.parse(record.activity_at))
    || !["published", "draft"].includes(String(record.status))) throw new Error("invalid_custom_activity");
  return {
    id: record.id, lead_id: record.lead_id,
    user_id: typeof record.user_id === "string" ? record.user_id : null,
    activity_at: record.activity_at,
    custom_activity_type_id: String(record.custom_activity_type_id),
    status: record.status as "published" | "draft",
    custom_fields: Object.entries(record).filter(([key]) => key.startsWith("custom.cf_"))
      .map(([key, value]) => ({ id: key.slice(7), value: value as string | number | string[] | null })),
  };
}

// Called only after ALL pages have loaded. No creation-time cutoff: old drafts
// can be published late and activity_at can be backdated. Identity is the Close
// activity ID, never company name, author name or an approximate timestamp.
export function prepareCustomReconciliation(records: Row[], startDate: string, endDate: string) {
  const byId = new Map<string, Row>();
  for (const row of records) {
    if (!Object.values(CLOSE_USERS).includes(row.user_id as typeof CLOSE_USERS.michael)) continue;
    if (!Object.values(ACTIVITY_TYPES).includes(row.custom_activity_type_id as typeof ACTIVITY_TYPES.openingCall)) continue;
    const activity = normalizeCustomRecord(row);
    const previous = byId.get(activity.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error("unstable_custom_pagination");
    byId.set(activity.id, row);
  }
  const raw = [...byId.values()].filter(row => {
    const date = metricTimeInReportingTimezone(String(row.activity_at)).metricDate;
    return date >= startDate && date <= endDate;
  });
  const facts = raw.map(normalizeCustomRecord).map(mapCustomActivity).filter(fact => fact !== null);
  const bookings = [...byId.values()].map(normalizeCustomRecord).map(mapCustomActivity)
    .filter(f => f !== null && f.appointments === 1 && metricTimeInReportingTimezone(f.occurredAt).metricDate <= endDate)
    .map(f => ({ source_activity_id: f!.sourceActivityId, lead_id: f!.leadId,
      close_user_id: f!.closeUserId, occurred_at: f!.occurredAt,
      metric_date: metricTimeInReportingTimezone(f!.occurredAt).metricDate }));
  return { raw, facts, bookings };
}

export function closingReconciliationTotals(facts: ReturnType<typeof prepareCustomReconciliation>["facts"], startDate: string, endDate: string) {
  const rows = facts.filter(f => {
    const date = metricTimeInReportingTimezone(f.occurredAt).metricDate;
    return date >= startDate && date <= endDate;
  });
  const sum = (key: "appointments" | "setterCalls" | "setterSuccesses" | "closerCalls" | "closerSecondCalls" | "closerDecidedCalls" | "closerSales", closerOnly = false) =>
    rows.filter(f => !closerOnly || f.closeUserId === CLOSE_USERS.antony).reduce((n, f) => n + f[key], 0);
  return { appointments: sum("appointments"), setterCalls: sum("setterCalls"), setterSuccesses: sum("setterSuccesses"),
    closerCalls: sum("closerCalls", true), cc2Agreed: sum("closerSecondCalls", true),
    decidedCloserCalls: sum("closerDecidedCalls", true), closerSales: sum("closerSales", true) };
}

export function prepareWonReconciliation(records: CloseOpportunity[], attributions: Map<string, LeadAttribution>, startDate: string, endDate: string) {
  const byId = new Map<string, CloseOpportunity>();
  for (const row of records) {
    const previous = byId.get(row.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error("unstable_won_pagination");
    byId.set(row.id, row);
  }
  return [...byId.values()].map(row => {
    const attribution = attributions.get(row.lead_id);
    if (!attribution) throw new Error("missing_won_attribution_fetch");
    const fact = mapWonOpportunity(row, attribution);
    if (!fact) throw new Error("invalid_won_snapshot");
    return fact;
  }).filter(fact => fact.wonDate >= startDate && fact.wonDate <= endDate);
}

type LeadReportingRow = {lead_id: string; opener_close_user_id: string | null; lead_source: string | null};
export function prepareLeadReportingSnapshot(rows: LeadReportingRow[], facts: ReturnType<typeof prepareCustomReconciliation>["facts"], deals: Array<{leadId: string}>) {
  // Won is fetched with a UTC boundary buffer. Its out-of-window leads must
  // not enter the exact retained metadata snapshot sent to the atomic RPC.
  const required = new Set([...facts.filter(f => isProcessReportingFact(f)).map(f => f.leadId), ...deals.map(d => d.leadId)]);
  const byId = new Map(rows.map(row => [row.lead_id, row]));
  if (byId.size !== rows.length) throw new Error("duplicate_lead_reporting_metadata");
  return [...required].map(id => {
    const row = id ? byId.get(id) : undefined;
    if (!row) throw new Error("missing_lead_reporting_metadata");
    return row;
  });
}

export function isProcessReportingFact(f: ReturnType<typeof prepareCustomReconciliation>["facts"][number]) {
  return f.setterCalls > 0 || f.appointments > 0 || f.closerCalls > 0 || f.noShows > 0 || f.cancellations > 0 || f.rescheduledAppointments > 0;
}
