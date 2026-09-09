import { CLOSE_USERS, metricTimeInReportingTimezone } from "./close-mapping.ts";

export const CLOSE_TASK_FIELDS = ["id", "_type", "lead_id", "assigned_to", "contact_id", "date", "date_created", "date_updated", "is_complete", "is_dateless", "text"];
export type CloseTaskRow = {
  task_id: string; lead_id: string; assigned_to: string; contact_id: string | null;
  task_type: "lead"; date: string | null; date_created: string; date_updated: string;
  due_at: string | null; due_date: string | null; due_precision: "timestamp" | "date" | "none";
  is_complete: boolean; is_dateless: boolean; purpose_code: "follow_up" | null;
};
const requiredId = (value: unknown, code: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value;
};
const instant = (value: unknown, code: string) => {
  if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(code);
  return value;
};
function plainDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
/** A closed category, never a free-text classifier. Punctuation, extra words
 * and translated guesses remain unclassified rather than changing semantics. */
export function safeTaskPurposeCode(text: unknown): "follow_up" | null {
  return typeof text === "string" && text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase() === "follow up" ? "follow_up" : null;
}

/** Close task.date is native actionability/due time, not evidence of a meeting
 * or conversation. Date-only input never receives a fabricated clock time.
 * This source is intentionally limited to Antony's lead tasks. */
export function normalizeCloseTask(record: Record<string, unknown>, dataAsOf: string): CloseTaskRow | null {
  instant(dataAsOf, "invalid_task_snapshot_time");
  if (record._type !== "lead" || record.assigned_to !== CLOSE_USERS.antony) return null;
  const task_id = requiredId(record.id, "invalid_task_source_id");
  const lead_id = requiredId(record.lead_id, "invalid_task_lead_id");
  const date_created = instant(record.date_created, "invalid_task_created");
  if (Date.parse(date_created) > Date.parse(dataAsOf)) return null;
  const date_updated = instant(record.date_updated, "invalid_task_updated");
  if (Date.parse(date_updated) > Date.parse(dataAsOf)) throw new Error("funnel_source_changed_during_snapshot");
  if (Date.parse(date_updated) < Date.parse(date_created)) throw new Error("invalid_task_source_time_order");
  if (typeof record.is_complete !== "boolean" || typeof record.is_dateless !== "boolean") throw new Error("invalid_task_status");
  const contact_id = record.contact_id == null ? null : requiredId(record.contact_id, "invalid_task_contact_id");
  let date: string | null = null, due_at: string | null = null, due_date: string | null = null;
  let due_precision: CloseTaskRow["due_precision"] = "none";
  if (record.date != null) {
    if (typeof record.date !== "string") throw new Error("invalid_task_due_date");
    date = record.date;
    if (plainDate(date)) {
      if (!record.is_dateless) { due_date = date; due_precision = "date"; }
    } else {
      instant(date, "invalid_task_due_date");
      if (!record.is_dateless) { due_at = date; due_date = metricTimeInReportingTimezone(date).metricDate; due_precision = "timestamp"; }
    }
  } else if (!record.is_dateless) throw new Error("missing_task_due_date");
  return { task_id, task_type: "lead", lead_id, assigned_to: CLOSE_USERS.antony, contact_id,
    date, date_created, date_updated, due_at, due_date, due_precision,
    is_complete: record.is_complete, is_dateless: record.is_dateless, purpose_code: safeTaskPurposeCode(record.text) };
}
