import {
  ACTIVITY_TYPES, CLOSE_USERS, CUSTOM_FIELDS, SALES_PIPELINE, REPORTING_TIMEZONE,
  mapCustomActivity, mapWonOpportunity, metricTimeInReportingTimezone, type CloseOpportunity, type LeadAttribution,
} from "./close-mapping.ts";
import { normalizeCloseTask } from "./close-tasks.ts";
import { normalizeCustomRecord } from "./close-reconciliation.ts";
import { isObservedAt, safeMeetingPurposeCode, type MeetingRow } from "./close-meetings.ts";

type Row = Record<string, unknown>;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const LEAD_STATUS_FIELDS = ["id", "lead_id", "user_id", "activity_at", "date_created", "date_updated", "old_status_id", "new_status_id"];
export const OPPORTUNITY_DEAL_TYPE_FIELD = "cf_wlmXj1eeFF6P9Zoz49WNuFULPX0jsKRyArR8O4PX6ZQ";
export const FUNNEL_OPPORTUNITY_FIELDS = ["id", "lead_id", "pipeline_id", "status_id", "status_type", "date_won", "date_created", "date_updated", "value", "value_period", `custom.${OPPORTUNITY_DEAL_TYPE_FIELD}`];
// Verified against the Sales pipeline definition. Upsell/renewal is not acquisition.
export const ACQUISITION_WON_STATUS_ID = "stat_CxgagrC23GIjKjEqvE931SP6CK9tkfuKaYZzuFQZyuL";
export type FunnelSourceKind = "custom_activity" | "meeting" | "lead_status_change" | "opportunity" | "task";
export type FunnelEvent = {
  lead_id: string; event_type: string; occurred_at: string; meeting_id: string | null;
  previous_status: string | null; new_status: string | null;
  setter_id: string | null; closer_id: string | null;
  source_event_id: string; source_kind: FunnelSourceKind; source_updated_at: string;
  source_revision: string; payload: { [key: string]: JsonValue };
};
type UnversionedEvent = Omit<FunnelEvent, "source_revision">;
export type FunnelEventSnapshotInput = {
  customRecords: Row[]; meetings: MeetingRow[]; statusChanges: Row[];
  opportunities: (CloseOpportunity & { date_created?: string; date_updated?: string })[];
  attributions?: Map<string, LeadAttribution>; dataAsOf: string;
  historicalBookingSourceIds?: ReadonlySet<string>;
  taskRecords?: Row[];
};
const salesUsers = new Set<string>(Object.values(CLOSE_USERS));
const knownTypes = new Set<string>(Object.values(ACTIVITY_TYPES));
const customTypeNames: Record<string, string> = {
  [ACTIVITY_TYPES.openingCall]: "opening_activity", [ACTIVITY_TYPES.followUp]: "followup_activity",
  [ACTIVITY_TYPES.setterCall]: "setter_activity", [ACTIVITY_TYPES.closerCall]: "closer_activity",
  [ACTIVITY_TYPES.noShow]: "attendance_activity",
};
const id = (value: unknown, code: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value;
};
const nullableId = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const timestamp = (value: unknown, code: string): string => {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(code);
  return value;
};
const customValue = (value: unknown): JsonValue => {
  if (value == null) return null;
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (Array.isArray(value) && value.every(v => typeof v === "string")) return [...value].sort();
  throw new Error("invalid_funnel_custom_value");
};
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
async function revision(event: UnversionedEvent): Promise<FunnelEvent> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(event)));
  return { ...event, source_revision: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("") };
}
function base(source_kind: FunnelSourceKind, source_event_id: string, lead_id: string, occurred_at: string, source_updated_at: string): UnversionedEvent {
  return { source_kind, source_event_id, lead_id, occurred_at, source_updated_at,
    event_type: source_kind, meeting_id: null, previous_status: null, new_status: null,
    setter_id: null, closer_id: null, payload: {} };
}
function assertSourceObserved(sourceUpdatedAt: string, dataAsOf: string) {
  if (!isObservedAt(sourceUpdatedAt, dataAsOf)) throw new Error("funnel_source_changed_during_snapshot");
}
export function validateFunnelLeadRecord(record: Row, expectedLeadId: string, dataAsOf: string): void {
  if (id(record.id, "invalid_funnel_lead_metadata") !== expectedLeadId) throw new Error("invalid_funnel_lead_metadata");
  id(record.status_id, "invalid_funnel_lead_status");
  assertSourceObserved(timestamp(record.date_updated, "invalid_funnel_lead_updated"), dataAsOf);
}

/**
 * Normalize COMPLETE source snapshots, with no reporting-period cutoff.
 * Identity is the external object/activity ID; its source revision is a SHA-256
 * of the canonical permitted fields and source update time, never sync time.
 * Each fixed event type represents an object's current revision, not another
 * KPI occurrence. The persistence layer supersedes revisions and withdraws
 * absent objects only for source kinds whose pagination completed successfully.
 */
export async function prepareFunnelEventSnapshot(input: FunnelEventSnapshotInput): Promise<FunnelEvent[]> {
  timestamp(input.dataAsOf, "invalid_funnel_snapshot_time");
  const rows: UnversionedEvent[] = [];
  const customVersions = new Map<string, string>();
  for (const record of input.customRecords) {
    if (!knownTypes.has(String(record.custom_activity_type_id)) || !salesUsers.has(String(record.user_id))) continue;
    const activity = normalizeCustomRecord(record);
    const created = timestamp(record.date_created, "invalid_funnel_custom_created");
    const updated = timestamp(record.date_updated, "invalid_funnel_custom_updated");
    if (!isObservedAt(created, input.dataAsOf)) continue;
    assertSourceObserved(updated, input.dataAsOf);
    timestamp(activity.activity_at, "invalid_funnel_custom_occurred");
    const fields = Object.fromEntries(Object.values(CUSTOM_FIELDS).filter(field => field !== CUSTOM_FIELDS.leadSource
      && field !== CUSTOM_FIELDS.leadOpener && field !== CUSTOM_FIELDS.leadSetter && field !== CUSTOM_FIELDS.leadCloser)
      .filter(field => Object.hasOwn(record, `custom.${field}`)).map(field => [field, customValue(record[`custom.${field}`])]));
    const sourceContent = canonicalJson({ id: activity.id, lead_id: activity.lead_id, user_id: activity.user_id,
      activity_at: activity.activity_at, created, updated, type: activity.custom_activity_type_id, status: activity.status, fields });
    const priorContent = customVersions.get(activity.id);
    if (priorContent && priorContent !== sourceContent) throw new Error("unstable_funnel_pagination");
    customVersions.set(activity.id, sourceContent);
    // Gatekeeper/opening performance already lives in raw/facts. The durable
    // sales-funnel journal needs current bookings and corrections of any
    // previously documented booking, including withdrawn/draft revisions.
    if ((activity.custom_activity_type_id === ACTIVITY_TYPES.openingCall || activity.custom_activity_type_id === ACTIVITY_TYPES.followUp)
      && !mapCustomActivity(activity)?.appointments && !input.historicalBookingSourceIds?.has(activity.id)) continue;
    const event = base("custom_activity", id(activity.id, "invalid_funnel_source_id"), id(activity.lead_id, "invalid_funnel_lead_id"), activity.activity_at, updated);
    event.event_type = customTypeNames[activity.custom_activity_type_id];
    event.new_status = activity.status;
    // The author of a Setter/Closer activity is direct evidence for that role.
    // A booking author, calendar participant or later lead owner is not.
    event.setter_id = activity.custom_activity_type_id === ACTIVITY_TYPES.setterCall ? activity.user_id ?? null : null;
    event.closer_id = activity.custom_activity_type_id === ACTIVITY_TYPES.closerCall ? activity.user_id ?? null : null;
    event.payload = { custom_activity_type_id: activity.custom_activity_type_id, user_id: activity.user_id ?? null,
      date_created: created, status: activity.status, custom: fields };
    rows.push(event);
  }
  for (const meeting of input.meetings) {
    // Non-lead service calendar objects have no lead history; they remain in the
    // existing raw calendar snapshot. Non-Setter lead meetings remain metadata.
    if (!meeting.lead_id) continue;
    timestamp(meeting.date_created, "invalid_funnel_meeting_created");
    if (!isObservedAt(meeting.date_created, input.dataAsOf)) continue;
    const event = base("meeting", id(meeting.meeting_id, "invalid_funnel_source_id"), id(meeting.lead_id, "invalid_funnel_lead_id"),
      timestamp(meeting.starts_at, "invalid_funnel_meeting_start"), timestamp(meeting.date_updated, "invalid_funnel_meeting_updated"));
    assertSourceObserved(event.source_updated_at, input.dataAsOf);
    const endsAt = timestamp(meeting.ends_at, "invalid_funnel_meeting_end");
    if (Date.parse(endsAt) < Date.parse(event.occurred_at)) throw new Error("invalid_funnel_meeting_duration");
    event.event_type = "meeting_scheduled";
    event.meeting_id = meeting.meeting_id;
    event.new_status = meeting.status;
    const participants = meeting.participant_ids.map(p => ({ contact_id: nullableId(p.contact_id), user_id: nullableId(p.user_id), status: nullableId(p.status) }));
    participants.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
    event.payload = { starts_at: meeting.starts_at, ends_at: endsAt, date_created: meeting.date_created,
      owner_id: meeting.owner_id, contact_id: meeting.contact_id, participant_ids: participants,
      calendar_event_uids: [...new Set(meeting.calendar_event_uids)].sort(), excluded_purpose: meeting.excluded_purpose,
      purpose_code: safeMeetingPurposeCode(meeting.purpose_code),
      booking_activity_id: meeting.booking_activity_id, booking_owner_id: meeting.booking_owner_id };
    rows.push(event);
  }
  for (const record of input.statusChanges) {
    const created = timestamp(record.date_created, "invalid_funnel_status_created");
    if (!isObservedAt(created, input.dataAsOf)) continue;
    const event = base("lead_status_change", id(record.id, "invalid_funnel_source_id"), id(record.lead_id, "invalid_funnel_lead_id"),
      timestamp(record.activity_at, "invalid_funnel_status_occurred"), timestamp(record.date_updated, "invalid_funnel_status_updated"));
    assertSourceObserved(event.source_updated_at, input.dataAsOf);
    event.event_type = "lead_status_changed";
    event.previous_status = id(record.old_status_id, "invalid_funnel_previous_status");
    event.new_status = id(record.new_status_id, "invalid_funnel_new_status");
    event.payload = { user_id: nullableId(record.user_id), date_created: created };
    rows.push(event);
  }
  for (const opportunity of input.opportunities) {
    if (opportunity.pipeline_id && opportunity.pipeline_id !== SALES_PIPELINE.id) continue;
    // Keep current revisions even when status is no longer Won, if fetched by
    // an all-opportunities source. They can withdraw an earlier Won assertion.
    id(opportunity.id, "invalid_funnel_source_id"); id(opportunity.lead_id, "invalid_funnel_lead_id");
    id(opportunity.status_id, "invalid_funnel_opportunity_status");
    const created = opportunity.date_created == null ? null : timestamp(opportunity.date_created, "invalid_funnel_opportunity_created");
    if (created && !isObservedAt(created, input.dataAsOf)) continue;
    const attribution = input.attributions?.get(opportunity.lead_id) ?? { openerUserId: null, setterUserId: null, closerUserId: null };
    const fact = mapWonOpportunity(opportunity, attribution);
    if (opportunity.status_type === "won" && SALES_PIPELINE.wonStatusIds.has(opportunity.status_id) && !fact) throw new Error("invalid_funnel_won_date");
    // Date-only Won is explicitly date precision, not a fabricated Close time.
    const occurredAt = fact?.wonAt ?? created ?? timestamp(opportunity.date_updated, "missing_funnel_opportunity_time");
    const updated = opportunity.date_updated == null ? occurredAt : timestamp(opportunity.date_updated, "invalid_funnel_opportunity_updated");
    assertSourceObserved(updated, input.dataAsOf);
    const event = base("opportunity", opportunity.id, opportunity.lead_id, occurredAt, updated);
    event.event_type = "opportunity_state";
    event.new_status = opportunity.status_id;
    event.setter_id = attribution.setterUserId;
    event.closer_id = attribution.closerUserId;
    const dealType = (opportunity as unknown as Row)[`custom.${OPPORTUNITY_DEAL_TYPE_FIELD}`] ?? null;
    event.payload = { status_type: opportunity.status_type ?? null, pipeline_id: opportunity.pipeline_id ?? null,
      date_won: opportunity.date_won ?? null, date_created: created,
      won_at: fact?.wonAt ?? null, won_date: fact?.wonDate ?? null,
      value_cents: fact?.valueCents ?? null, value_period: fact?.valuePeriod ?? null,
      opener_id: attribution.openerUserId,
      occurred_at_precision: opportunity.date_won?.length === 10 ? "date" : "timestamp",
      deal_type: typeof dealType === "string" ? dealType : null,
      acquisition: opportunity.status_type === "won" && opportunity.status_id === ACQUISITION_WON_STATUS_ID
        && (dealType === null || dealType === "Neukunde"),
      attribution_basis: "lead_fields_at_sync" };
    rows.push(event);
  }
  for (const record of input.taskRecords ?? []) {
    const task = normalizeCloseTask(record, input.dataAsOf);
    if (!task) continue;
    // occurred_at is the observed source revision time. Fälligkeit lives only
    // in the explicitly precise due fields, including an unanchored date-only.
    const event = base("task", task.task_id, task.lead_id, task.date_updated, task.date_updated);
    event.event_type = "task_state";
    event.new_status = task.is_complete ? "completed" : "open";
    event.payload = { task_type: task.task_type, assigned_to: task.assigned_to, contact_id: task.contact_id,
      date_created: task.date_created, date: task.date, due_at: task.due_at, due_date: task.due_date,
      due_precision: task.due_precision, is_complete: task.is_complete, is_dateless: task.is_dateless,
      purpose_code: task.purpose_code };
    rows.push(event);
  }
  const byIdentity = new Map<string, UnversionedEvent>();
  for (const row of rows) {
    const key = `${row.source_kind}:${row.source_event_id}`;
    const prior = byIdentity.get(key);
    if (prior && canonicalJson(prior) !== canonicalJson(row)) throw new Error("unstable_funnel_pagination");
    byIdentity.set(key, row);
  }
  return Promise.all([...byIdentity.values()].sort((a, b) => `${a.source_kind}:${a.source_event_id}`.localeCompare(`${b.source_kind}:${b.source_event_id}`)).map(revision));
}

export type FunnelProcessEventType = "booking" | "setter_completed" | "setter_qualified" | "setter_follow_up" | "setter_disqualified"
  | "setter_cancelled" | "setter_rescheduled" | "setter_no_show" | "closer_completed" | "cc2_agreed" | "closer_follow_up"
  | "closer_lost" | "closer_sold" | "cc2_sold" | "closer_cancelled" | "closer_rescheduled" | "closer_no_show" | "customer_won" | "status_changed";
export type FunnelProcessEvent = {
  source_event_id: string; source_kind: FunnelSourceKind; lead_id: string; occurred_at: string;
  event_type: FunnelProcessEventType; meeting_id: string | null; setter_id: string | null; closer_id: string | null;
  occurred_at_precision: "timestamp" | "date";
};
function berlinDateAnchor(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: REPORTING_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(guess)).map(part => [part.type, part.value]));
  const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(guess - (represented - guess)).toISOString();
}
/** Interpret current revisions only. Lead statuses and calendar RSVP/completion
 * never invent conversations, qualification, sales or negative attendance. */
export function toProcessEvents(events: FunnelEvent[], dataAsOf: string): FunnelProcessEvent[] {
  timestamp(dataAsOf, "invalid_funnel_snapshot_time");
  const output: FunnelProcessEvent[] = [];
  const datePrecision = (event: FunnelEvent) => event.source_kind === "opportunity" && event.payload.occurred_at_precision === "date"
    && typeof event.payload.won_date === "string";
  const push = (event: FunnelEvent, event_type: FunnelProcessEventType) => output.push({
    source_event_id: event.source_event_id, source_kind: event.source_kind, lead_id: event.lead_id,
    // Date-only Won is known on its date, including mornings. Midnight is a
    // computational date anchor, never evidence of an exact signing time.
    occurred_at: datePrecision(event) ? berlinDateAnchor(event.payload.won_date as string) : event.occurred_at,
    occurred_at_precision: datePrecision(event) ? "date" : "timestamp",
    event_type, meeting_id: event.meeting_id, setter_id: event.setter_id, closer_id: event.closer_id,
  });
  const firstWonByLead = new Map<string, FunnelEvent>();
  for (const event of events) {
    if (datePrecision(event) ? String(event.payload.won_date) > metricTimeInReportingTimezone(dataAsOf).metricDate
      : !isObservedAt(event.occurred_at, dataAsOf)) continue;
    if (event.source_kind === "lead_status_change") { push(event, "status_changed"); continue; }
    if (event.source_kind === "opportunity" && event.payload.acquisition === true) {
      const old = firstWonByLead.get(event.lead_id);
      if (!old || Date.parse(event.occurred_at) < Date.parse(old.occurred_at)
        || (Date.parse(event.occurred_at) === Date.parse(old.occurred_at) && event.source_event_id < old.source_event_id)) firstWonByLead.set(event.lead_id, event);
    }
    if (event.source_kind !== "custom_activity" || event.payload.status !== "published") continue;
    const fields = event.payload.custom as Record<string, JsonValue>;
    const activity = normalizeCustomRecord({ id: event.source_event_id, lead_id: event.lead_id,
      user_id: event.payload.user_id, activity_at: event.occurred_at,
      custom_activity_type_id: event.payload.custom_activity_type_id, status: event.payload.status,
      ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [`custom.${key}`, value])) });
    const fact = mapCustomActivity(activity);
    if (!fact) continue;
    if (fact.appointments) push(event, "booking");
    if (fact.setterCalls) {
      const result = fields[CUSTOM_FIELDS.setterResult];
      push(event, result === "✅ Closer terminiert" ? "setter_qualified" : result === "🔎 Setter Follow Up" ? "setter_follow_up"
        : result === "❌ Disqualifiziert" ? "setter_disqualified" : "setter_completed");
    }
    if (fact.closerCalls) {
      const result = fields[CUSTOM_FIELDS.closerResult];
      push(event, result === "2. 🔥 CC2 vereinbart" ? "cc2_agreed" : result === "4. ❌ Nicht verkauft" ? "closer_lost"
        : result === "1. ✅ Verkauft - in CC1" ? "closer_sold" : result === "3. ✅ Verkauft - in CC2 🔥" ? "cc2_sold" : "closer_completed");
    }
    // The custom template allows one field for each stage. Keep both explicit
    // facts; process attribution still requires unique calendar/time evidence.
    for (const [field, prefix] of [[CUSTOM_FIELDS.setterNoShow, "setter"], [CUSTOM_FIELDS.closerNoShow, "closer"]] as const) {
      if (activity.custom_activity_type_id !== ACTIVITY_TYPES.noShow) continue;
      const value = fields[field];
      if (value === "Nicht erschienen") push(event, `${prefix}_no_show`);
      if (value === "⛔ Abgesagt") push(event, `${prefix}_cancelled`);
      if (value === "🔄 Termin verschoben") push(event, `${prefix}_rescheduled`);
    }
  }
  for (const event of firstWonByLead.values()) push(event, "customer_won");
  return output.sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)
    || `${a.source_kind}:${a.source_event_id}:${a.event_type}`.localeCompare(`${b.source_kind}:${b.source_event_id}:${b.event_type}`));
}
