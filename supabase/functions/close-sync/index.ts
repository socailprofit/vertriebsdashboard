import { LEAD_DIMENSION_FIELDS, isSelectedStatusEvent, leadDimensions } from "../_shared/close-lead-dimensions.ts";
import { fetchStableClosePages, ClosePaginationError } from "../_shared/close-list-pages.ts";
import { CLOSE_TASK_FIELDS } from "../_shared/close-tasks.ts";
import { isProcessReportingFact, normalizeCustomRecord, CUSTOM_RECONCILIATION_FIELDS, prepareLeadReportingSnapshot, prepareCustomReconciliation, prepareWonReconciliation, closingReconciliationTotals } from "../_shared/close-reconciliation.ts";
import { MEETING_FIELDS, prepareMeetingSnapshot, type MeetingLink } from "../_shared/close-meetings.ts";
import { FUNNEL_OPPORTUNITY_FIELDS, LEAD_STATUS_FIELDS, prepareFunnelEventSnapshot, toProcessEvents, validateFunnelLeadRecord } from "../_shared/close-funnel-events.ts";
import { deriveCloseProcesses, PROCESS_RULE_VERSION, type FunnelProcess, type MeetingProcessRelation } from "../_shared/close-processes.ts";
import { CloseReadBudgetError, CloseReadTimeoutError, createCloseReadLimiter, fetchCloseLeadMetadata, redactClosePath, type CloseReadLimiter, type CloseSearchPage } from "../_shared/close-read-client.ts";
import { funnelPayloadBytes } from "../_shared/close-funnel-payload.ts";
import { FunnelUploadError, uploadCloseFunnelSnapshot } from "../_shared/close-funnel-upload.ts";
import { retrySnapshotSelect, safeSupabaseJwtIssue } from "../_shared/snapshot-read-retry.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.115.0";
import {
  CLOSE_USERS,
  ACTIVITY_TYPES,
  CUSTOM_FIELDS,
  MAPPING_VERSION,
  REPORTING_TIMEZONE,
  SALES_PIPELINE,
  leadAttribution,
  mapCall,
  mapCustomActivity,
  mapNewsletterSend,
  mapWonOpportunity,
  metricTimeInReportingTimezone,
  type ActivityFact,
  type CloseCall,
  type CloseOpportunity,
  type CloseNewsletterEmail,
} from "../_shared/close-mapping.ts";

const CLOSE_API_BASE = "https://api.close.com/api/v1";
const SALES_USER_IDS = [CLOSE_USERS.michael, CLOSE_USERS.felix];
const CUSTOM_ACTIVITY_USER_IDS = [...SALES_USER_IDS, CLOSE_USERS.antony];
const MAX_RANGE_DAYS = 31;
const RETENTION_MONTHS = 3;
// Call imports retain the existing creation-time buffer. Custom activities
// are fully paginated without a creation cutoff and reconciled by activity_at.
const ACTIVITY_FETCH_BUFFER_DAYS = 2;
const PAGE_SIZE = 100;
const MAX_RECORDS_PER_RESOURCE = 20_000;
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

// Vocabulary used to characterise a Close error without quoting it.
const CLOSE_ERROR_HINTS = [
  "activity_at", "date_created", "date_updated", "sort", "order_by", "query",
  "_skip", "_cursor", "_limit", "cursor", "pagination", "offset",
  "combined", "supported", "required", "together", "instead", "deprecated",
];

type JsonRecord = Record<string, unknown>;
type SyncMode = "dry-run" | "write";
type SyncTrigger = "manual" | "supabase-cron";
type FunnelLeadRow = { lead_id: string; display_name?: string | null; lead_source: string | null; opener_close_user_id: string | null;
  setter_id: string | null; closer_id: string | null; status_id: string | null; source_updated_at: string | null; report_dimensions?: Record<string, unknown> | null };
type StoredMeetingLink = MeetingLink & { starts_at: string };
type MeetingTimeRevision = { meeting_id: string; source_updated_at: string; old_starts_at: string; new_starts_at: string };

async function readPersistentRows<T>(supabase: SupabaseClient, table: string, columns: string, orderBy: string, activeColumn?: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await retrySnapshotSelect(() => {
      let query = supabase.from(table).select(columns).order(orderBy).range(offset, offset + 999);
      if (activeColumn) query = query.is(activeColumn, null);
      return query.abortSignal(AbortSignal.timeout(15_000));
    });
    if (error) throw supabaseError(`read ${table}`, error);
    rows.push(...data as unknown as T[]);
    if (data.length < 1000) return rows;
    if (offset >= MAX_RECORDS_PER_RESOURCE - 1000) throw new Error("persistent_funnel_snapshot_limit");
  }
}

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

// The full message goes to the function log, which is private. Only `category`
// and `safeDetail` reach the caller, whose Actions log is public.
class SyncError extends Error {
  constructor(
    readonly category: string,
    message: string,
    readonly safeDetail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// Supabase client errors carry a Postgres SQLSTATE. The code identifies the
// problem — a missing table, a denied permission, a violated constraint — and
// unlike the accompanying message it cannot carry row content into a log.
function postgresCode(error: unknown) {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

// The step name is ours, so reporting it says where a write failed without
// quoting anything the database returned. The message stays in the log only.
function supabaseError(step: string, error: unknown) {
  const code = postgresCode(error);
  const jwtIssue = safeSupabaseJwtIssue(error);
  const message = jwtIssue ? `JWT validation failed (${jwtIssue})` : typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error);
  return new SyncError("supabase_error", `${step}: ${message}`, { step, ...(code ? { code } : {}), ...(jwtIssue ? { jwtIssue } : {}) });
}

function requiredEnvironment(name: string, ...fallbackNames: string[]) {
  for (const candidate of [name, ...fallbackNames]) {
    const value = Deno.env.get(candidate);
    if (value) return value;
  }
  const names = [name, ...fallbackNames].join(" or ");
  throw new SyncError("missing_server_secret", `Missing server secret: ${names}`, { secret: names });
}

function dateInBerlin(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function rollingRetentionStart(date: string) {
  const [year, month] = date.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  firstOfMonth.setUTCMonth(firstOfMonth.getUTCMonth() - (RETENTION_MONTHS - 1));
  return firstOfMonth.toISOString().slice(0, 10);
}

function berlinMidnightUtc(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day));
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: REPORTING_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(guess).map((part) => [part.type, part.value]),
  );
  const representedAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  const offsetMilliseconds = representedAsUtc - guess.getTime();
  return new Date(Date.UTC(year, month - 1, day) - offsetMilliseconds).toISOString();
}

function validateDate(value: unknown, fallback: string) {
  const date = typeof value === "string" ? value : fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new SyncError("invalid_date", `Invalid date: ${date}`, { date });
  }
  return date;
}

function syncTrigger(value: unknown): SyncTrigger {
  return value === "supabase-cron" ? "supabase-cron" : "manual";
}

function customFieldsFrom(record: JsonRecord) {
  return Object.entries(record)
    .filter(([key]) => key.startsWith("custom.cf_"))
    .map(([key, value]) => ({
      id: key.slice("custom.".length),
      value: value as string | number | string[] | null,
    }));
}

async function closeRequest<T>(apiKey: string, path: string, params: Record<string, string>, reader: CloseReadLimiter, searchBody?: JsonRecord) {
  if (searchBody && path !== "/data/search/") throw new Error("unsupported_close_read_operation");
  const url = new URL(`${CLOSE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
  const result = await reader.run(signal => fetch(url, {
    method: searchBody ? "POST" : "GET", signal,
    headers: { authorization: `Basic ${btoa(`${apiKey}:`)}`, ...(searchBody ? { "content-type": "application/json" } : {}) },
    ...(searchBody ? { body: JSON.stringify(searchBody) } : {}),
  }));
  if (!result.ok) {
    const details = (await result.text()).slice(0, 500);
    // Close's message must not reach the caller's public log, so probe it with a
    // fixed vocabulary of our own strings and report only which ones occur.
    // That identifies a rejected filter without echoing anything Close wrote.
    const hints = [...new Set([...Object.keys(params), ...CLOSE_ERROR_HINTS])]
      .filter((hint) => details.includes(hint));
    throw new SyncError(
      "close_api_error",
      `Close API ${result.status} for ${path}: ${details}`,
      { closeStatus: result.status, closePath: redactClosePath(path), hints },
    );
  }
  return await result.json() as T;
  } catch (error) {
    if (error instanceof SyncError) throw error;
    const timedOut = error instanceof CloseReadTimeoutError || error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    const budget = error instanceof CloseReadBudgetError || timedOut && reader.isBudgetExhausted();
    throw new SyncError(budget ? "close_read_budget_exhausted" : timedOut ? "close_request_timed_out" : "close_transport_error",
      budget ? "Close read budget exhausted" : timedOut ? "Close request timed out" : "Close transport failed",
      { closePath: redactClosePath(path), retryOnNextSchedule: true });
  }
}

async function closeList<T>(apiKey: string, path: string, params: Record<string, string>, reader: CloseReadLimiter) {
  const startedAt = Date.now();
  let count = 0, pages = 0, lastLog = 0;
  const diagnostic = (outcome: string) => console.log(JSON.stringify({ event: "close_resource_read", outcome,
    closePath: redactClosePath(path), count, pages, elapsedMs: Date.now() - startedAt }));
  try {
    return await fetchStableClosePages<T>((skip, limit) => closeRequest(apiKey, path, {
      ...params, _limit: String(limit), _skip: String(skip),
    }, reader), { pageSize: PAGE_SIZE, maxRecords: MAX_RECORDS_PER_RESOURCE,
      onProgress: progress => {
        count = progress.recordsRead; pages = progress.pagesFetched;
        if (progress.complete || pages-lastLog >= 25) { diagnostic(progress.complete ? "complete" : "progress"); lastLog=pages; }
      },
    });
  } catch (error) {
    diagnostic(error instanceof SyncError ? error.category : "failed");
    if (error instanceof ClosePaginationError) throw new SyncError(error.code, error.code,
      { closePath: redactClosePath(path), offset: error.offset });
    throw error;
  }
}

// Collect a rejection instead of propagating it, so one run can report every
// Close resource that failed rather than only the first one to reject.
async function settle<T>(request: Promise<T[]>): Promise<{ value: T[]; failure: SyncError | null }> {
  try {
    return { value: await request, failure: null };
  } catch (error) {
    const failure = error instanceof SyncError ? error : new SyncError(
      "close_fetch_failed",
      error instanceof Error ? error.message : String(error),
    );
    return { value: [], failure };
  }
}

function rawActivityRow(record: JsonRecord, type: "call" | "custom_activity") {
  return {
    close_activity_id: String(record.id),
    activity_type: type,
    close_user_id: typeof record.user_id === "string" ? record.user_id : null,
    lead_id: typeof record.lead_id === "string" ? record.lead_id : null,
    occurred_at: String(record.activity_at),
    payload: record,
  };
}

function activityFactRow(fact: ActivityFact) {
  const time = metricTimeInReportingTimezone(fact.occurredAt);
  return {
    source_activity_id: fact.sourceActivityId,
    source_type: fact.sourceType,
    close_user_id: fact.closeUserId,
    lead_id: fact.leadId,
    occurred_at: fact.occurredAt,
    metric_date: time.metricDate,
    metric_hour: time.metricHour,
    calls_gross: fact.callsGross,
    calls_net: fact.callsNet,
    talk_seconds: fact.talkSeconds,
    gatekeeper_contacts: fact.gatekeeperContacts,
    connected_calls: fact.connectedCalls,
    direct_decision_maker_calls: fact.directDecisionMakerCalls,
    decision_maker_contacts: fact.decisionMakerContacts,
    appointments: fact.appointments,
    setter_calls: fact.setterCalls,
    setter_successes: fact.setterSuccesses,
    closer_calls: fact.closerCalls,
    closer_second_calls: fact.closerSecondCalls,
    closer_decided_calls: fact.closerDecidedCalls,
    closer_sales: fact.closerSales,
    no_shows: fact.noShows,
    cancellations: fact.cancellations,
    rescheduled_appointments: fact.rescheduledAppointments,
    product_focus: fact.productFocus,
    mapping_version: fact.mappingVersion,
    mapped_at: new Date().toISOString(),
  };
}


async function upsertBatches(
  supabase: SupabaseClient, table: string, rows: JsonRecord[], onConflict: string,
) {
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase.from(table).upsert(rows.slice(index, index + 500), { onConflict });
    if (error) throw supabaseError(`upsert ${table}`, error);
  }
}

async function readHistoricalBookingSourceIds(supabase: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const { data, error } = await retrySnapshotSelect(() => supabase.rpc("get_close_funnel_booking_source_ids")
      .range(offset, offset + 999).abortSignal(AbortSignal.timeout(15_000)));
    if (error) throw supabaseError("rpc get_close_funnel_booking_source_ids", error);
    const rows = (data ?? []) as Array<{ source_event_id: string }>;
    for (const row of rows) {
      if (typeof row.source_event_id !== "string" || !row.source_event_id || ids.has(row.source_event_id))
        throw new Error("invalid_historical_booking_markers");
      ids.add(row.source_event_id);
    }
    if (rows.length < 1000) return ids;
  }
  throw new SyncError("historical_booking_marker_limit", "Historical booking marker limit reached");
}

function summarize(
  facts: ActivityFact[],
  deals: Array<NonNullable<ReturnType<typeof mapWonOpportunity>>>,
  newsletterSends: Array<NonNullable<ReturnType<typeof mapNewsletterSend>>>,
  startTimestamp: string,
  endTimestamp: string,
) {
  const result: Record<string, Record<string, number | null>> = {};
  for (const [slug, userId] of Object.entries({ michael: CLOSE_USERS.michael, felix: CLOSE_USERS.felix })) {
    const ownFacts = facts.filter((fact) => fact.closeUserId === userId);
    const ownDeals = deals.filter((deal) => deal.openerCloseUserId === userId);
    const ownNewsletterSends = newsletterSends.filter((completion) => {
      const completedAt = Date.parse(completion.sentAt);
      return completion.closeUserId === userId
        && completedAt >= Date.parse(startTimestamp)
        && completedAt < Date.parse(endTimestamp);
    });
    const sum = (key: keyof ActivityFact) => ownFacts.reduce((total, fact) => total + Number(fact[key] ?? 0), 0);
    result[slug] = {
      callsGross: sum("callsGross"),
      callsNet: sum("callsNet"),
      gatekeeperContacts: sum("gatekeeperContacts"),
      connectedCalls: sum("connectedCalls"),
      directDecisionMakerCalls: sum("directDecisionMakerCalls"),
      decisionMakerContacts: sum("decisionMakerContacts"),
      appointments: sum("appointments"),
      dealsWon: ownDeals.length,
      newsletters: ownNewsletterSends.length,
    };
  }
  return result;
}

Deno.serve(async (request) => {
  if (request.method === "GET") {
    return response(200, {
      ok: true,
      service: "close-sync",
      state: "ready",
      defaultMode: "dry-run",
      scheduler: "external",
      mappingVersion: MAPPING_VERSION,
    });
  }
  if (request.method !== "POST") return response(405, { ok: false, error: "method_not_allowed" });

  let supabase: SupabaseClient | null = null;
  let syncRunId: string | null = null;

  try {
    const expectedSecret = requiredEnvironment("CLOSE_SYNC_SECRET");
    if (request.headers.get("x-sync-secret") !== expectedSecret) {
      return response(401, { ok: false, error: "unauthorized" });
    }

    const body = await request.json().catch(() => ({})) as JsonRecord;
    const yesterday = dateInBerlin(new Date(Date.now() - 86_400_000));
    const startDate = validateDate(body.startDate, yesterday);
    const endDate = validateDate(body.endDate, startDate);
    const rangeDays = Math.round(
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000,
    ) + 1;
    if (rangeDays < 1 || rangeDays > MAX_RANGE_DAYS) {
      return response(400, { ok: false, error: "invalid_range", maxDays: MAX_RANGE_DAYS });
    }
    const mode: SyncMode = body.mode === "write" ? "write" : "dry-run";
    const trigger = syncTrigger(body.trigger);
    const scheduled = trigger === "supabase-cron";
    const newsletterOnly = body.newsletterOnly === true;
    const snapshotStartedAt = new Date().toISOString();
    const today = dateInBerlin(new Date());
    const retentionStart = rollingRetentionStart(today);
    const reconciliationEnd = today;
    if (startDate < retentionStart || endDate > today) {
      return response(400, { ok: false, error: "outside_retention_window", retentionStart, today });
    }
    const nextDate = addDays(endDate, 1);
    const startTimestamp = berlinMidnightUtc(startDate);
    const endTimestamp = berlinMidnightUtc(nextDate);
    // A Supabase secret named "Close API Key" is stored and shown in the
    // dashboard, but the edge runtime cannot expose a name containing spaces,
    // so that variant is unreadable here and is deliberately not consulted.
    // Prefer the conventional name; accept the mixed-case one that exists today.
    const closeApiKey = requiredEnvironment("CLOSE_API_KEY", "Close_API_Key");
    const closeReads = createCloseReadLimiter();

    supabase = createClient(
      requiredEnvironment("SUPABASE_URL"), requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    if (mode === "write") {
      const { data, error } = await supabase.from("sync_runs").insert({
        status: "running",
        source_window_start: startTimestamp,
        source_window_end: endTimestamp,
        metadata: { mode, mappingVersion: MAPPING_VERSION, trigger, scheduled },
      }).select("id").single();
      if (error) throw supabaseError("insert sync_runs", error);
      syncRunId = data.id;
    }
    const markPhase = async (phase: string, counts: Record<string, number> = {}) => {
      const phaseElapsedMs = Date.now() - Date.parse(snapshotStartedAt);
      const checkpoint = { phase, phaseElapsedMs, dataAsOf: snapshotStartedAt, ...counts };
      console.log(JSON.stringify({ event: "close_sync_phase", syncRunId, ...checkpoint }));
      if (mode !== "write" || !syncRunId) return;
      // Operational evidence only. A slow or rejected diagnostic update must
      // not hang the core snapshot or change its authorization/commit policy.
      try {
        const { error } = await supabase!.from("sync_runs").update({
          metadata: { mode, mappingVersion: MAPPING_VERSION, trigger, scheduled, ...checkpoint },
        }).eq("id", syncRunId).abortSignal(AbortSignal.timeout(3000));
        if (error) console.warn(JSON.stringify({ event: "close_sync_checkpoint_failed", phase,
          code: postgresCode(error), jwtIssue: safeSupabaseJwtIssue(error) }));
      } catch {
        console.warn(JSON.stringify({ event: "close_sync_checkpoint_failed", phase, code: "checkpoint_timeout" }));
      }
    };

    const activityWindow = {
      date_created__gte: berlinMidnightUtc(addDays(startDate, -ACTIVITY_FETCH_BUFFER_DAYS)),
      date_created__lt: berlinMidnightUtc(addDays(nextDate, ACTIVITY_FETCH_BUFFER_DAYS)),
    };
    // Custom activities are fetched unfiltered by type: Close only allows the
    // custom_activity_type filter together with a single lead_id, which a daily
    // export across all leads cannot supply. mapCustomActivity drops the types
    // it does not know, so the type selection happens during mapping instead.
    // Fetch only metadata. Scan all creation dates: a previously scheduled email
    // may be sent much later. Fail closed at the pagination safety limit.
    await markPhase("fetching_sources");
    const statusCreatedSince = berlinMidnightUtc(retentionStart);
    const [callResult, customResult, opportunityResult, newsletterResult, meetingResult, statusResult, taskResult] = await Promise.all([
      settle(newsletterOnly ? Promise.resolve([]) : closeList<JsonRecord>(closeApiKey, "/activity/call/", {
        ...activityWindow,
        user_id: SALES_USER_IDS.join(","),
      }, closeReads)),
      settle(newsletterOnly ? Promise.resolve([]) : closeList<JsonRecord>(closeApiKey, "/activity/custom/", {
        // Historical conversation evidence includes former staff; performance mapping
        // still resolves only the configured sales users.
        _fields: CUSTOM_RECONCILIATION_FIELDS.join(","),
      }, closeReads)),
      settle(newsletterOnly ? Promise.resolve([]) : closeList<CloseOpportunity>(closeApiKey, "/opportunity/", {
        status_id__in: [...SALES_PIPELINE.wonStatusIds].join(","),
        // Full Won history proves the first acquisition; recurring/up-sell
        // opportunities remain separate from new-customer process events.
        _fields: FUNNEL_OPPORTUNITY_FIELDS.join(","),
      }, closeReads)),
      settle(closeList<CloseNewsletterEmail>(closeApiKey, "/activity/email/", {
        _fields: "id,sequence_id,user_id,date_sent,direction,status",
      }, closeReads)),
      // No creation/start/end cutoff: known future calendar events must survive
      // month boundaries and remain available without a later re-import.
      settle(newsletterOnly ? Promise.resolve([]) : closeList<JsonRecord>(closeApiKey, "/activity/meeting/", {
        _fields: MEETING_FIELDS.join(","),
      }, closeReads)),
      settle(newsletterOnly ? Promise.resolve([]) : closeList<JsonRecord>(closeApiKey, "/activity/status_change/lead/", {
        date_created__gte: statusCreatedSince,
        _fields: LEAD_STATUS_FIELDS.join(","),
      }, closeReads)),
      settle(newsletterOnly ? Promise.resolve([]) : closeList<JsonRecord>(closeApiKey, "/task/", {
        _type: "lead", assigned_to: CLOSE_USERS.antony, is_complete: "false",
        _fields: CLOSE_TASK_FIELDS.join(","),
      }, closeReads)),
    ]);

    const failures = [callResult, customResult, opportunityResult, newsletterResult, meetingResult, statusResult, taskResult]
      .map((result) => result.failure)
      .filter((failure): failure is SyncError => failure !== null);
    if (failures.length > 0) {
      throw new SyncError(
        "close_fetch_failed",
        failures.map((failure) => failure.message).join(" | "),
        { failed: failures.map((failure) => ({ category: failure.category, ...failure.safeDetail })) },
      );
    }
    await markPhase("sources_fetched", { calls: callResult.value.length, customActivities: customResult.value.length,
      opportunities: opportunityResult.value.length, emailMetadata: newsletterResult.value.length,
      meetings: meetingResult.value.length, statusActivities: statusResult.value.length, tasks: taskResult.value.length });

    // The reporting day is decided here rather than by Close, on the same field
    // the mapping reports on. Raw rows are filtered too, so nothing outside the
    // window reaches storage or the counts.
    const startMilliseconds = Date.parse(startTimestamp);
    const endMilliseconds = Date.parse(endTimestamp);
    let activitiesWithoutTimestamp = 0;
    const withinReportingWindow = (record: JsonRecord) => {
      const activityAt = typeof record.activity_at === "string" ? Date.parse(record.activity_at) : NaN;
      if (Number.isNaN(activityAt)) {
        activitiesWithoutTimestamp += 1;
        return false;
      }
      return activityAt >= startMilliseconds && activityAt < endMilliseconds;
    };
    const rawCalls = callResult.value.filter(withinReportingWindow);
    const reconciled = prepareCustomReconciliation(customResult.value, retentionStart, reconciliationEnd, snapshotStartedAt);
    await markPhase("loading_persisted_history", { bookings: reconciled.bookings.length, retainedFacts: reconciled.facts.length });
    const [storedMeetingLinks, storedProcesses, storedRelations, storedFunnelLeads, storedMeetingRevisions, historicalBookingSourceIds] = newsletterOnly
      ? [[], [], [], [], [], new Set<string>()] as [StoredMeetingLink[], Array<{payload: FunnelProcess}>, Array<{payload: MeetingProcessRelation}>, FunnelLeadRow[], MeetingTimeRevision[], Set<string>]
      : await Promise.all([
        readPersistentRows<StoredMeetingLink>(supabase, "close_meetings", "meeting_id,lead_id,booking_activity_id,booking_owner_id,starts_at", "meeting_id", "removed_at"),
        readPersistentRows<{payload: FunnelProcess}>(supabase, "close_sales_processes", "payload", "process_id", "retired_at"),
        readPersistentRows<{payload: MeetingProcessRelation}>(supabase, "close_process_meetings", "payload", "meeting_id", "removed_at"),
        readPersistentRows<FunnelLeadRow>(supabase, "close_funnel_leads", "lead_id,display_name,lead_source,opener_close_user_id,setter_id,closer_id,status_id,source_updated_at,report_dimensions", "lead_id"),
        readPersistentRows<MeetingTimeRevision>(supabase, "close_meeting_time_history", "meeting_id,source_updated_at,old_starts_at,new_starts_at", "revision_id"),
        readHistoricalBookingSourceIds(supabase),
      ]);
    await markPhase("persisted_history_loaded", { storedMeetings: storedMeetingLinks.length, storedProcesses: storedProcesses.length,
      storedRelations: storedRelations.length, storedLeads: storedFunnelLeads.length, storedMeetingRevisions: storedMeetingRevisions.length, historicalBookingMarkers: historicalBookingSourceIds.size });
    const previousMeetingLinks = storedMeetingLinks.filter(row => row.booking_activity_id);
    const calendar = prepareMeetingSnapshot(meetingResult.value, reconciled.bookings, snapshotStartedAt, previousMeetingLinks);
    const oldMeetingById = new Map(storedMeetingLinks.map(meeting => [meeting.meeting_id, meeting]));
    const meetingRevisions = [...storedMeetingRevisions];
    // The trigger stores these actual moves when the transaction commits. The
    // current process replay must see them already in that very same snapshot.
    for (const meeting of calendar.meetings) {
      const old = oldMeetingById.get(meeting.meeting_id);
      if (old && Date.parse(old.starts_at) !== Date.parse(meeting.starts_at)) meetingRevisions.push({
        meeting_id: meeting.meeting_id, source_updated_at: meeting.date_updated,
        old_starts_at: old.starts_at, new_starts_at: meeting.starts_at,
      });
    }
    const rawCustomActivities = reconciled.raw;
    const opportunities = opportunityResult.value;

    const newsletterSends = [...new Map(newsletterResult.value
      .map(mapNewsletterSend)
      .filter((send): send is NonNullable<typeof send> => send !== null)
      .filter((send) => {
        const day = metricTimeInReportingTimezone(send.sentAt).metricDate;
        return day >= retentionStart && day <= endDate;
      }).map((send) => [send.emailId, send])).values()];

    const callFacts = rawCalls.map((record) => mapCall(record as unknown as CloseCall));
    const customFacts = reconciled.facts;
    const activityFacts = [...callFacts, ...customFacts];

    const calendarLeadIds = new Set(calendar.meetings.filter(m => m.booking_activity_id
      && metricTimeInReportingTimezone(m.starts_at).metricDate >= retentionStart).map(m => m.lead_id));
    const retainedWonLeadIds = opportunities.filter(opportunity => {
      const fact = mapWonOpportunity(opportunity, { openerUserId: null, setterUserId: null, closerUserId: null });
      return fact && fact.wonDate >= retentionStart && fact.wonDate <= reconciliationEnd;
    }).map(opportunity => opportunity.lead_id);
    // Refresh every selected lead on every scheduled run, including status-only
    // leads and older selections retained after the rolling event fetch window.
    const selectedLeadIds = new Set([
      ...statusResult.value.filter(isSelectedStatusEvent).map(row => String(row.lead_id)),
      ...storedFunnelLeads.filter(row => row.report_dimensions?.selection_tracked === true).map(row => row.lead_id),
    ]);
    // Full status histories prove earlier acquisitions and phase entries. The
    // complete per-lead scope also permits safe reconciliation of deletions.
    const historicalStatusRows: JsonRecord[] = [];
    const historyLeadIds = [...selectedLeadIds].sort();
    for (let offset = 0; offset < historyLeadIds.length; offset += 40) {
      historicalStatusRows.push(...await closeList<JsonRecord>(closeApiKey, "/activity/status_change/lead/", {
        lead_id: historyLeadIds.slice(offset, offset + 40).join(","),
        _fields: LEAD_STATUS_FIELDS.join(","),
      }, closeReads));
    }
    const historyScope = new Set(historyLeadIds);
    // The complete second read supersedes the earlier rolling-window read.
    const completeStatusRows = [...statusResult.value.filter(row => !historyScope.has(String(row.lead_id))), ...historicalStatusRows];
    const activeLeadIds = new Set([...selectedLeadIds, ...retainedWonLeadIds,
      ...taskResult.value.map(row => String(row.lead_id)),
      ...[...calendarLeadIds].filter((id): id is string => id !== null),
      ...customFacts.filter(fact => isProcessReportingFact(fact)).map(fact => fact.leadId).filter((id): id is string => id !== null),
      ...storedProcesses.filter(row => row.payload.closed_at === null).map(row => row.payload.lead_id)]);
    const knownTypes = new Set<string>(Object.values(ACTIVITY_TYPES));
    const knownAuthors = new Set<string>(CUSTOM_ACTIVITY_USER_IDS);
    const historicalProcessLeadIds = customResult.value.filter(row => knownTypes.has(String(row.custom_activity_type_id)) && knownAuthors.has(String(row.user_id)))
      .map(normalizeCustomRecord).map(mapCustomActivity).filter(fact => fact && isProcessReportingFact(fact))
      .map(fact => fact!.leadId).filter((leadId): leadId is string => leadId !== null);
    const allFunnelLeadIds = new Set([...activeLeadIds, ...historicalProcessLeadIds,
      ...opportunities.map(opportunity => opportunity.lead_id),
      ...calendar.meetings.filter(m => m.booking_activity_id && m.lead_id).map(m => m.lead_id!)]);
    const funnelLeadById = new Map(storedFunnelLeads.filter(row => allFunnelLeadIds.has(row.lead_id)).map(row => [row.lead_id, row]));
    // Current performance, planned appointments and unresolved older processes
    // refresh each run. Historical terminal metadata is cached; current lead
    // status is evidence for present stock only, never a backdated KPI event.
    const leadIds = [...allFunnelLeadIds].filter(leadId => activeLeadIds.has(leadId) || !funnelLeadById.has(leadId)).sort();
    const leadReportingRows: Array<{lead_id:string;opener_close_user_id:string|null;lead_source:string|null}> = [];
    const leadAttributions = new Map<string, ReturnType<typeof leadAttribution>>();
    await markPhase("refreshing_lead_metadata", { requestedLeads: leadIds.length });
    const [refreshedLeads, reportUsers] = await Promise.all([
      fetchCloseLeadMetadata(leadIds,
        ["id", "display_name", "status_id", "status_label", "date_updated", ...Object.values(LEAD_DIMENSION_FIELDS).map(id => `custom.${id}`)],
        body => closeRequest<CloseSearchPage>(closeApiKey, "/data/search/", {}, closeReads, body)),
      newsletterOnly ? Promise.resolve([]) : closeList<JsonRecord>(closeApiKey, "/user/", { _fields: "id,first_name,last_name" }, closeReads),
    ]);
    const reportUserNames = new Map(reportUsers.map(user => [String(user.id), [user.first_name, user.last_name]
      .filter(part => typeof part === "string" && part.trim()).join(" ").trim()]));
    await markPhase("lead_metadata_refreshed", { refreshedLeads: refreshedLeads.length });
    for (const lead of refreshedLeads) {
        const leadId = lead.id as string;
        validateFunnelLeadRecord(lead, leadId, snapshotStartedAt);
        const fields = customFieldsFrom(lead);
        const attribution = leadAttribution(fields);
        const source = fields.find(field => field.id === CUSTOM_FIELDS.leadSource)?.value;
        funnelLeadById.set(leadId, { lead_id: leadId, display_name: typeof lead.display_name === "string" ? lead.display_name.trim() || null : null, opener_close_user_id: attribution.openerUserId,
          setter_id: attribution.setterUserId, closer_id: attribution.closerUserId,
          status_id: lead.status_id as string, source_updated_at: lead.date_updated as string,
          lead_source: typeof source === "string" ? source.trim() || null : null,
          report_dimensions: { ...leadDimensions(lead, reportUserNames, selectedLeadIds.has(leadId)),
            status_history_complete_at: historyScope.has(leadId) ? snapshotStartedAt : null } });
    }
    const funnelLeads = [...funnelLeadById.values()].sort((a, b) => a.lead_id.localeCompare(b.lead_id));
    if (funnelLeads.length !== allFunnelLeadIds.size) throw new Error("incomplete_funnel_lead_metadata");
    for (const lead of funnelLeads) {
      leadAttributions.set(lead.lead_id, { openerUserId: lead.opener_close_user_id, setterUserId: lead.setter_id, closerUserId: lead.closer_id });
      leadReportingRows.push({ lead_id: lead.lead_id, opener_close_user_id: lead.opener_close_user_id, lead_source: lead.lead_source });
    }

    await markPhase("normalizing_funnel", { sourceCustomActivities: customResult.value.length, sourceMeetings: calendar.meetings.length });
    const funnelEvents = await prepareFunnelEventSnapshot({ customRecords: customResult.value,
      meetings: calendar.meetings, statusChanges: completeStatusRows, opportunities, taskRecords: taskResult.value,
      attributions: leadAttributions, dataAsOf: snapshotStartedAt, historicalBookingSourceIds });
    const processEvents = toProcessEvents(funnelEvents, snapshotStartedAt);
    await markPhase("deriving_processes", { sourceRevisions: funnelEvents.length, processEvents: processEvents.length });
    const flow = deriveCloseProcesses({ meetings: calendar.meetings, bookings: reconciled.bookings,
      events: processEvents, dataAsOf: snapshotStartedAt,
      previousProcesses: storedProcesses.map(row => row.payload), previousRelations: storedRelations.map(row => row.payload), meetingRevisions });
    const semanticEventById = new Map(processEvents.map(event => [`${event.source_kind}:${event.source_event_id}:${event.event_type}`, event]));
    const processEventRelations = flow.eventRelations.map(relation => {
      const event = semanticEventById.get(`${relation.source_kind}:${relation.source_event_id}:${relation.event_type}`);
      if (!event) throw new Error("missing_funnel_process_event");
      return { ...relation, payload: { ...event, applies_to_state: relation.applies_to_state } };
    });
    const flowDiagnostics = { ...flow.diagnostics, sourceRevisions: funnelEvents.length, processes: flow.processes.length,
      processEvents: processEventRelations.length, meetingRelations: flow.meetingRelations.length,
      historicalLeadMetadata: funnelLeads.length, fetchedLeadMetadata: leadIds.length,
      statusCreatedSince, ruleVersion: PROCESS_RULE_VERSION, apiReads: closeReads.diagnostics };
    await markPhase("processes_derived", { processes: flow.processes.length, eventRelations: processEventRelations.length,
      meetingRelations: flow.meetingRelations.length });

    const deals = prepareWonReconciliation(opportunities, leadAttributions, retentionStart, reconciliationEnd);
    const leadReporting = prepareLeadReportingSnapshot(leadReportingRows, customFacts, deals);
    const warnings: string[] = [];
    const unassignedDeals = deals.filter(deal => !deal.openerCloseUserId).length;
    if (unassignedDeals > 0) warnings.push(`${unassignedDeals} won opportunities have no opener; closer attribution is retained.`);
    const recurringValueDeals = deals.filter((deal) => deal.valuePeriod !== "one_time").length;
    if (recurringValueDeals > 0) warnings.push(`${recurringValueDeals} recurring opportunities count as deals but not as one-time revenue.`);
    if (activitiesWithoutTimestamp > 0) {
      warnings.push(`${activitiesWithoutTimestamp} activities were skipped because activity_at could not be read.`);
    }
    const unassignedNewsletterSends = newsletterSends.filter((send) =>
      !Object.values(CLOSE_USERS).includes(send.closeUserId as typeof CLOSE_USERS.michael)).length;
    if (unassignedNewsletterSends) warnings.push(`${unassignedNewsletterSends} newsletter sends have no known sales user.`);

    const rawRows = [
      ...rawCalls.map((record) => rawActivityRow(record, "call")),
      ...rawCustomActivities.map((record) => rawActivityRow(record, "custom_activity")),
    ];
    const factRows = activityFacts.map(activityFactRow);
    const newsletterRows = newsletterSends.map((send) => ({
      close_email_id: send.emailId, close_user_id: send.closeUserId,
      sent_at: send.sentAt, mapping_version: send.mappingVersion,
    }));
    const opportunityRows = deals.map((deal) => {
      const source = opportunities.find((opportunity) => opportunity.id === deal.opportunityId);
      return {
        opportunity_id: deal.opportunityId,
        lead_id: deal.leadId,
        opener_close_user_id: deal.openerCloseUserId,
        setter_close_user_id: deal.setterCloseUserId,
        closer_close_user_id: deal.closerCloseUserId,
        won_at: deal.wonAt,
        won_date: deal.wonDate,
        status_id: source?.status_id,
        value_cents: deal.valueCents,
        value_period: deal.valuePeriod,
        mapping_version: deal.mappingVersion,
        payload: source ?? {},
      };
    });
    const snapshotPayload = {
      p_start_date: retentionStart, p_end_date: reconciliationEnd,
      p_snapshot_started_at: snapshotStartedAt,
      p_raw: rawRows.filter(row => row.activity_type === "custom_activity"),
      p_facts: factRows.filter(row => row.source_type === "custom_activity"),
      p_opportunities: opportunityRows,
      p_leads: leadReporting,
      p_bookings: reconciled.bookings,
      p_meetings: calendar.meetings,
      p_calendar_leads: leadReportingRows.filter(row => calendarLeadIds.has(row.lead_id)),
      p_events: funnelEvents,
      p_processes: flow.processes,
      p_meeting_relations: flow.meetingRelations,
      p_event_relations: processEventRelations,
      p_funnel_leads: funnelLeads,
      p_status_created_since: statusCreatedSince,
    };
    const payloadBytes = funnelPayloadBytes(snapshotPayload);
    const funnelDiagnostics: JsonRecord = { ...flowDiagnostics, payloadBytes };
    await markPhase("snapshot_prepared", { payloadBytes: payloadBytes.totalBytes,
      ...Object.fromEntries(Object.entries(payloadBytes.sections).map(([section, value]) => [`${section}_bytes`, value.bytes])) });
    if (mode === "write" && supabase) {
      // Calls keep their explicitly requested daily range. Custom activities
      // and Won records reconcile the entire retained window atomically.
      await upsertBatches(supabase, "close_raw_activities", rawRows.filter(row => row.activity_type === "call"), "close_activity_id");
      await upsertBatches(supabase, "close_activity_facts", factRows.filter(row => row.source_type === "call"), "source_activity_id");
      if (!newsletterOnly) {
        await markPhase("committing_funnel", { sourceRevisions: funnelEvents.length, processes: flow.processes.length });
        // The complete snapshot is prepared privately in bounded requests.
        // Only the final RPC publishes it; keep time for newsletter/metrics.
        // Allow one bounded finalizer retry without aborting a near-complete
        // transaction; reserve 15s before the 145s cron deadline for downstream work.
        const uploadBudgetMs = Math.min(85_000, 130_000 - (Date.now() - Date.parse(snapshotStartedAt)));
        if (uploadBudgetMs < 1000 || !syncRunId) throw new SyncError("funnel_upload_budget_exhausted", "No time remains for a complete funnel upload");
        const uploaded = await uploadCloseFunnelSnapshot({
          runId: syncRunId,
          snapshot: snapshotPayload,
          budgetMs: uploadBudgetMs,
          rpc: (name, args, signal) => supabase!.rpc(name, args).abortSignal(signal),
          onProgress: progress => markPhase(`funnel_upload_${progress.phase}`, {
            completedChunks: progress.completedChunks, totalChunks: progress.totalChunks,
            payloadBytes: progress.payloadBytes, uploadElapsedMs: progress.elapsedMs,
          }),
        });
        const committed = uploaded.data as JsonRecord | null;
        if (!committed || committed.funnel_events !== funnelEvents.length || committed.processes !== flow.processes.length)
          throw new SyncError("invalid_funnel_commit_response", "Funnel commit counts could not be verified");
        funnelDiagnostics.upload = uploaded.diagnostics;
        const { error: taskCoverageError } = await supabase.rpc("confirm_close_task_snapshot", {
          p_snapshot: snapshotStartedAt, p_expected_task_count: funnelEvents.filter(event => event.source_kind === "task").length,
        });
        if (taskCoverageError) throw supabaseError("rpc confirm_close_task_snapshot", taskCoverageError);
        await markPhase("funnel_committed");
      }
      // One atomic replacement also removes deleted/reassigned sends and old
      // completion counts. Only the newsletter KPI is backfilled historically.
      const { error: newsletterError } = await supabase.rpc("replace_newsletter_sends", {
        p_start_date: retentionStart, p_end_date: endDate, p_sends: newsletterRows,
      });
      if (newsletterError) throw supabaseError("rpc replace_newsletter_sends", newsletterError);
      await markPhase("newsletter_written");
      if (!newsletterOnly) {
        const { error: recalculateError } = await supabase.rpc("recalculate_daily_sales_metrics", {
          p_start_date: retentionStart, p_end_date: reconciliationEnd,
        });
        if (recalculateError) throw supabaseError("rpc recalculate_daily_sales_metrics", recalculateError);
        await markPhase("metrics_recalculated");
      }
      const { error: cleanupError } = await supabase.rpc("cleanup_dashboard_history");
      if (cleanupError) throw supabaseError("rpc cleanup_dashboard_history", cleanupError);
      const { error: runError } = await supabase.from("sync_runs").update({
        status: "success",
        completed_at: new Date().toISOString(),
        fetched_records: rawCalls.length + customResult.value.length + opportunities.length + newsletterResult.value.length + meetingResult.value.length + statusResult.value.length + taskResult.value.length,
        upserted_records: rawRows.length + factRows.length + opportunityRows.length + newsletterRows.length + funnelEvents.length + flow.processes.length,
        metadata: { mode, mappingVersion: MAPPING_VERSION, trigger, scheduled, phase: "complete", warnings, calendar: calendar.diagnostics,
          funnel: funnelDiagnostics, dataAsOf: snapshotStartedAt },
      }).eq("id", syncRunId);
      if (runError) throw supabaseError("update sync_runs", runError);
    }

    return response(200, {
      ok: true,
      mode,
      wroteData: mode === "write",
      trigger,
      scheduled,
      newsletterOnly,
      range: { startDate, endDate, timezone: REPORTING_TIMEZONE },
      mappingVersion: MAPPING_VERSION,
      calendar: calendar.diagnostics,
      funnel: funnelDiagnostics,
      dataAsOf: snapshotStartedAt,
      fetched: {
        calls: callResult.value.length,
        customActivities: customResult.value.length,
        wonOpportunities: opportunities.length,
        emailMetadata: newsletterResult.value.length,
        leadStatusActivities: statusResult.value.length, tasks: taskResult.value.length,
      },
      inWindow: {
        calls: rawCalls.length,
        customActivities: rawCustomActivities.length,
        newsletterSends: newsletterSends.length,
      },
      mapped: { activities: activityFacts.length, deals: deals.length, newsletterSends: newsletterSends.length },
      reconciliationRange: { startDate: retentionStart, endDate: reconciliationEnd },
      leadReporting: {total:leadReporting.length, missingSource:leadReporting.filter(row => !row.lead_source).length, missingOpener:leadReporting.filter(row => !row.opener_close_user_id).length},
      closingReconciliation: closingReconciliationTotals(customFacts, retentionStart, reconciliationEnd),
      people: summarize(activityFacts.filter(fact => {
        const day = metricTimeInReportingTimezone(fact.occurredAt).metricDate;
        return day >= startDate && day <= endDate;
      }), deals.filter(deal => deal.wonDate >= startDate && deal.wonDate <= endDate), newsletterSends, startTimestamp, endTimestamp),
      warnings,
      syncRunId,
    });
  } catch (error) {
    console.error(error);
    if (supabase && syncRunId) {
      await supabase.from("sync_runs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message.slice(0, 1_000) : "Unknown sync error",
      }).eq("id", syncRunId);
    }
    const failure = error instanceof CloseReadBudgetError
      ? { error: "close_read_budget_exhausted", retryOnNextSchedule: true }
      : error instanceof FunnelUploadError
      ? { error: error.code }
      : error instanceof Error && error.message === "funnel_source_changed_during_snapshot"
      ? { error: "source_snapshot_changed", retryOnNextSchedule: true }
      : error instanceof SyncError
      ? { error: error.category, ...error.safeDetail }
      : { error: "sync_failed", ...(postgresCode(error) ? { code: postgresCode(error) } : {}) };
    return response(500, { ok: false, ...failure });
  }
});
