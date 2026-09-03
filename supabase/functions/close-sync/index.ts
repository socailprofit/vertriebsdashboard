import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  CLOSE_USERS,
  CUSTOM_FIELDS,
  MAPPING_VERSION,
  NEWSLETTER_WORKFLOW,
  REPORTING_TIMEZONE,
  SALES_PIPELINE,
  leadAttribution,
  mapCall,
  mapCustomActivity,
  mapNewsletterCompletion,
  mapWonOpportunity,
  metricTimeInReportingTimezone,
  type ActivityFact,
  type CloseCall,
  type CloseCustomActivity,
  type CloseOpportunity,
  type CloseSequenceSubscription,
} from "../_shared/close-mapping.ts";

const CLOSE_API_BASE = "https://api.close.com/api/v1";
const TARGET_USER_IDS = [CLOSE_USERS.michael, CLOSE_USERS.felix];
const MAX_RANGE_DAYS = 31;
const RETENTION_MONTHS = 3;
// /activity/call/ and /activity/custom/ sort by date_created and expose no
// _order_by, so an activity_at filter is refused. Fetch a wider creation-time
// window and pick the reporting day from activity_at below. Logging happens on
// the day of the call, so two days absorb late entries and the Berlin offset.
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
  const message = typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error);
  return new SyncError("supabase_error", `${step}: ${message}`, { step, ...(code ? { code } : {}) });
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

async function closeRequest<T>(apiKey: string, path: string, params: Record<string, string> = {}) {
  const url = new URL(`${CLOSE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const result = await fetch(url, {
    headers: { authorization: `Basic ${btoa(`${apiKey}:`)}` },
  });
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
      { closeStatus: result.status, closePath: path, hints },
    );
  }
  return await result.json() as T;
}

async function closeList<T>(apiKey: string, path: string, params: Record<string, string>) {
  const records: T[] = [];
  let skip = 0;
  while (true) {
    const page = await closeRequest<{ data: T[]; has_more: boolean }>(apiKey, path, {
      ...params,
      _limit: String(PAGE_SIZE),
      _skip: String(skip),
    });
    records.push(...page.data);
    if (!page.has_more) return records;
    if (records.length >= MAX_RECORDS_PER_RESOURCE || page.data.length === 0) {
      throw new SyncError(
        "close_safety_limit",
        `Close API safety limit reached for ${path}`,
        { closePath: path },
      );
    }
    skip += page.data.length;
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

function normalizeCustomActivity(record: JsonRecord): CloseCustomActivity {
  return {
    id: String(record.id),
    lead_id: String(record.lead_id),
    user_id: typeof record.user_id === "string" ? record.user_id : null,
    activity_at: String(record.activity_at),
    custom_activity_type_id: String(record.custom_activity_type_id),
    status: record.status === "draft" ? "draft" : "published",
    custom_fields: customFieldsFrom(record),
  };
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
    closer_sales: fact.closerSales,
    no_shows: fact.noShows,
    cancellations: fact.cancellations,
    rescheduled_appointments: fact.rescheduledAppointments,
    product_focus: fact.productFocus,
    mapping_version: fact.mappingVersion,
    mapped_at: new Date().toISOString(),
  };
}

function newsletterSubscriptionRow(record: CloseSequenceSubscription) {
  return {
    close_subscription_id: record.id,
    workflow_id: record.sequence_id,
    created_by_close_user_id: record.created_by_id ?? null,
    subscription_created_at: record.date_created,
    subscription_updated_at: record.date_updated,
    status: record.status,
    mapping_version: MAPPING_VERSION,
    payload: record,
  };
}

async function upsertBatches(
  supabase: ReturnType<typeof createClient>, table: string, rows: JsonRecord[], onConflict: string,
) {
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase.from(table).upsert(rows.slice(index, index + 500), { onConflict });
    if (error) throw supabaseError(`upsert ${table}`, error);
  }
}

function summarize(
  facts: ActivityFact[],
  deals: Array<NonNullable<ReturnType<typeof mapWonOpportunity>>>,
  newsletterCompletions: Array<NonNullable<ReturnType<typeof mapNewsletterCompletion>>>,
  startTimestamp: string,
  endTimestamp: string,
) {
  const result: Record<string, Record<string, number | null>> = {};
  for (const [slug, userId] of Object.entries({ michael: CLOSE_USERS.michael, felix: CLOSE_USERS.felix })) {
    const ownFacts = facts.filter((fact) => fact.closeUserId === userId);
    const ownDeals = deals.filter((deal) => deal.openerCloseUserId === userId);
    const ownNewsletterCompletions = newsletterCompletions.filter((completion) => {
      const completedAt = Date.parse(completion.completedAt);
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
      newsletters: ownNewsletterCompletions.length,
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

  let supabase: ReturnType<typeof createClient> | null = null;
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
    const nextDate = addDays(endDate, 1);
    const startTimestamp = berlinMidnightUtc(startDate);
    const endTimestamp = berlinMidnightUtc(nextDate);
    // A Supabase secret named "Close API Key" is stored and shown in the
    // dashboard, but the edge runtime cannot expose a name containing spaces,
    // so that variant is unreadable here and is deliberately not consulted.
    // Prefer the conventional name; accept the mixed-case one that exists today.
    const closeApiKey = requiredEnvironment("CLOSE_API_KEY", "Close_API_Key");

    if (mode === "write") {
      supabase = createClient(
        requiredEnvironment("SUPABASE_URL"), requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data, error } = await supabase.from("sync_runs").insert({
        status: "running",
        source_window_start: startTimestamp,
        source_window_end: endTimestamp,
        metadata: { mode, mappingVersion: MAPPING_VERSION, trigger, scheduled },
      }).select("id").single();
      if (error) throw supabaseError("insert sync_runs", error);
      syncRunId = data.id;
    }

    const activityWindow = {
      user_id: TARGET_USER_IDS.join(","),
      date_created__gte: berlinMidnightUtc(addDays(startDate, -ACTIVITY_FETCH_BUFFER_DAYS)),
      date_created__lt: berlinMidnightUtc(addDays(nextDate, ACTIVITY_FETCH_BUFFER_DAYS)),
    };
    // Custom activities are fetched unfiltered by type: Close only allows the
    // custom_activity_type filter together with a single lead_id, which a daily
    // export across all leads cannot supply. mapCustomActivity drops the types
    // it does not know, so the type selection happens during mapping instead.
    // Der Workflow-Report zählt nur abgeschlossene Kontakte. Die Close-API
    // liefert deren aktuellen Status am Sequence-Subscription-Endpunkt; weil
    // ein Workflow klein ist, lesen wir die eine freigegebene Sequenz vollständig
    // und schreiben sie idempotent. So werden Statuswechsel mitgenommen.
    const [callResult, customResult, opportunityResult, newsletterResult] = await Promise.all([
      settle(closeList<JsonRecord>(closeApiKey, "/activity/call/", activityWindow)),
      settle(closeList<JsonRecord>(closeApiKey, "/activity/custom/", activityWindow)),
      settle(closeList<CloseOpportunity>(closeApiKey, "/opportunity/", {
        status_id__in: [...SALES_PIPELINE.wonStatusIds].join(","),
        date_won__gte: startDate,
        date_won__lt: nextDate,
      })),
      settle(closeList<CloseSequenceSubscription>(closeApiKey, "/sequence_subscription/", {
        sequence_id: NEWSLETTER_WORKFLOW.id,
      })),
    ]);

    const failures = [callResult, customResult, opportunityResult, newsletterResult]
      .map((result) => result.failure)
      .filter((failure): failure is SyncError => failure !== null);
    if (failures.length > 0) {
      throw new SyncError(
        "close_fetch_failed",
        failures.map((failure) => failure.message).join(" | "),
        { failed: failures.map((failure) => ({ category: failure.category, ...failure.safeDetail })) },
      );
    }

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
    const rawCustomActivities = customResult.value.filter(withinReportingWindow);
    const opportunities = opportunityResult.value;
    const retentionStart = rollingRetentionStart(endDate);
    let invalidNewsletterSubscriptions = 0;
    const newsletterSubscriptions = newsletterResult.value.filter((subscription) => {
      const updatedAt = Date.parse(subscription.date_updated);
      if (Number.isNaN(updatedAt) || Number.isNaN(Date.parse(subscription.date_created))) {
        invalidNewsletterSubscriptions += 1;
        return false;
      }
      return dateInBerlin(new Date(updatedAt)) >= retentionStart;
    });
    const newsletterCompletions = newsletterSubscriptions
      .map(mapNewsletterCompletion)
      .filter((completion): completion is NonNullable<typeof completion> => completion !== null);

    const callFacts = rawCalls.map((record) => mapCall(record as unknown as CloseCall));
    const customFacts = rawCustomActivities.map(normalizeCustomActivity).map(mapCustomActivity)
      .filter((fact): fact is ActivityFact => fact !== null);
    const activityFacts = [...callFacts, ...customFacts];

    const leadIds = [...new Set(opportunities.map((opportunity) => opportunity.lead_id))];
    const leadAttributions = new Map<string, ReturnType<typeof leadAttribution>>();
    for (let index = 0; index < leadIds.length; index += 10) {
      await Promise.all(leadIds.slice(index, index + 10).map(async (leadId) => {
        const lead = await closeRequest<JsonRecord>(closeApiKey, `/lead/${leadId}/`, {
          _fields: ["id", `custom.${CUSTOM_FIELDS.leadOpener}`, `custom.${CUSTOM_FIELDS.leadSetter}`, `custom.${CUSTOM_FIELDS.leadCloser}`].join(","),
        });
        leadAttributions.set(leadId, leadAttribution(customFieldsFrom(lead)));
      }));
    }

    const mappedDeals = opportunities.map((opportunity) => mapWonOpportunity(
      opportunity,
      leadAttributions.get(opportunity.lead_id) ?? { openerUserId: null, setterUserId: null, closerUserId: null },
    ));
    const deals = mappedDeals.filter((deal): deal is NonNullable<typeof deal> => deal !== null);
    const warnings: string[] = [];
    const unassignedDeals = opportunities.length - deals.length;
    if (unassignedDeals > 0) warnings.push(`${unassignedDeals} won opportunities could not be assigned to an opener.`);
    const recurringValueDeals = deals.filter((deal) => deal.valuePeriod !== "one_time").length;
    if (recurringValueDeals > 0) warnings.push(`${recurringValueDeals} recurring opportunities count as deals but not as one-time revenue.`);
    if (activitiesWithoutTimestamp > 0) {
      warnings.push(`${activitiesWithoutTimestamp} activities were skipped because activity_at could not be read.`);
    }
    if (invalidNewsletterSubscriptions > 0) {
      warnings.push(`${invalidNewsletterSubscriptions} newsletter subscriptions were skipped because Close timestamps could not be read.`);
    }

    if (mode === "write" && supabase) {
      const rawRows = [
        ...rawCalls.map((record) => rawActivityRow(record, "call")),
        ...rawCustomActivities.map((record) => rawActivityRow(record, "custom_activity")),
      ];
      const factRows = activityFacts.map(activityFactRow);
      const newsletterRows = newsletterSubscriptions.map(newsletterSubscriptionRow);
      const opportunityRows = deals.map((deal) => {
        const source = opportunities.find((opportunity) => opportunity.id === deal.opportunityId);
        return {
          opportunity_id: deal.opportunityId,
          lead_id: deal.leadId,
          opener_close_user_id: deal.openerCloseUserId,
          setter_close_user_id: deal.setterCloseUserId,
          closer_close_user_id: deal.closerCloseUserId,
          won_at: deal.wonAt,
          won_date: deal.wonAt.slice(0, 10),
          status_id: source?.status_id,
          value_cents: deal.valueCents,
          value_period: deal.valuePeriod,
          mapping_version: deal.mappingVersion,
          payload: source ?? {},
        };
      });
      await upsertBatches(supabase, "close_raw_activities", rawRows, "close_activity_id");
      await upsertBatches(supabase, "close_activity_facts", factRows, "source_activity_id");
      await upsertBatches(supabase, "close_opportunity_facts", opportunityRows, "opportunity_id");
      await upsertBatches(supabase, "close_newsletter_subscriptions", newsletterRows, "close_subscription_id");
      const newsletterMetricDates = newsletterCompletions
        .map((completion) => metricTimeInReportingTimezone(completion.completedAt).metricDate)
        .filter((metricDate) => metricDate >= retentionStart && metricDate <= endDate);
      const metricsStartDate = newsletterMetricDates.reduce(
        (earliest, metricDate) => metricDate < earliest ? metricDate : earliest,
        startDate,
      );
      const { error: recalculateError } = await supabase.rpc("recalculate_daily_sales_metrics", {
        p_start_date: metricsStartDate, p_end_date: endDate,
      });
      if (recalculateError) throw supabaseError("rpc recalculate_daily_sales_metrics", recalculateError);
      const { error: cleanupError } = await supabase.rpc("cleanup_dashboard_history");
      if (cleanupError) throw supabaseError("rpc cleanup_dashboard_history", cleanupError);
      const { error: runError } = await supabase.from("sync_runs").update({
        status: "success",
        completed_at: new Date().toISOString(),
        fetched_records: rawCalls.length + rawCustomActivities.length + opportunities.length + newsletterResult.value.length,
        upserted_records: rawRows.length + factRows.length + opportunityRows.length + newsletterRows.length,
        metadata: { mode, mappingVersion: MAPPING_VERSION, trigger, scheduled, warnings },
      }).eq("id", syncRunId);
      if (runError) throw supabaseError("update sync_runs", runError);
    }

    return response(200, {
      ok: true,
      mode,
      wroteData: mode === "write",
      trigger,
      scheduled,
      range: { startDate, endDate, timezone: REPORTING_TIMEZONE },
      mappingVersion: MAPPING_VERSION,
      fetched: {
        calls: callResult.value.length,
        customActivities: customResult.value.length,
        wonOpportunities: opportunities.length,
        newsletterSubscriptions: newsletterResult.value.length,
      },
      inWindow: {
        calls: rawCalls.length,
        customActivities: rawCustomActivities.length,
        newsletterSubscriptions: newsletterSubscriptions.length,
      },
      mapped: { activities: activityFacts.length, deals: deals.length, newsletterCompletions: newsletterCompletions.length },
      people: summarize(activityFacts, deals, newsletterCompletions, startTimestamp, endTimestamp),
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
    const failure = error instanceof SyncError
      ? { error: error.category, ...error.safeDetail }
      : { error: "sync_failed", ...(postgresCode(error) ? { code: postgresCode(error) } : {}) };
    return response(500, { ok: false, ...failure });
  }
});
