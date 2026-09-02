import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  CLOSE_USERS,
  CUSTOM_FIELDS,
  MAPPING_VERSION,
  REPORTING_TIMEZONE,
  SALES_PIPELINE,
  leadAttribution,
  mapCall,
  mapCustomActivity,
  mapWonOpportunity,
  type ActivityFact,
  type CloseCall,
  type CloseCustomActivity,
  type CloseOpportunity,
} from "../_shared/close-mapping.ts";

const CLOSE_API_BASE = "https://api.close.com/api/v1";
const TARGET_USER_IDS = [CLOSE_USERS.michael, CLOSE_USERS.felix];
const MAX_RANGE_DAYS = 31;
const PAGE_SIZE = 100;
const MAX_RECORDS_PER_RESOURCE = 20_000;
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

type JsonRecord = Record<string, unknown>;
type SyncMode = "dry-run" | "write";

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

function metricTime(occurredAt: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: REPORTING_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(occurredAt)).map((part) => [part.type, part.value]),
  );
  return {
    metricDate: `${parts.year}-${parts.month}-${parts.day}`,
    metricHour: Number(parts.hour),
  };
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
    throw new SyncError(
      "close_api_error",
      `Close API ${result.status} for ${path}: ${details}`,
      { closeStatus: result.status, closePath: path },
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
      throw new Error(`Close API safety limit reached for ${path}`);
    }
    skip += page.data.length;
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
  const time = metricTime(fact.occurredAt);
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

async function upsertBatches(
  supabase: ReturnType<typeof createClient>, table: string, rows: JsonRecord[], onConflict: string,
) {
  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase.from(table).upsert(rows.slice(index, index + 500), { onConflict });
    if (error) throw error;
  }
}

function summarize(facts: ActivityFact[], deals: Array<NonNullable<ReturnType<typeof mapWonOpportunity>>>) {
  const result: Record<string, Record<string, number | null>> = {};
  for (const [slug, userId] of Object.entries({ michael: CLOSE_USERS.michael, felix: CLOSE_USERS.felix })) {
    const ownFacts = facts.filter((fact) => fact.closeUserId === userId);
    const ownDeals = deals.filter((deal) => deal.openerCloseUserId === userId);
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
      newsletters: null,
    };
  }
  return result;
}

Deno.serve(async (request) => {
  if (request.method === "GET") {
    return response(200, {
      ok: true,
      service: "close-sync",
      state: "manual-test-ready",
      defaultMode: "dry-run",
      scheduled: false,
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
        metadata: { mode, mappingVersion: MAPPING_VERSION, scheduled: false },
      }).select("id").single();
      if (error) throw error;
      syncRunId = data.id;
    }

    const [rawCalls, rawCustomActivities, opportunities] = await Promise.all([
      closeList<JsonRecord>(closeApiKey, "/activity/call/", {
        user_id: TARGET_USER_IDS.join(","), activity_at__gte: startTimestamp, activity_at__lt: endTimestamp,
      }),
      closeList<JsonRecord>(closeApiKey, "/activity/custom/", {
        user_id: TARGET_USER_IDS.join(","), activity_at__gte: startTimestamp, activity_at__lt: endTimestamp,
      }),
      closeList<CloseOpportunity>(closeApiKey, "/opportunity/", {
        status_id__in: [...SALES_PIPELINE.wonStatusIds].join(","),
        date_won__gte: startDate,
        date_won__lt: nextDate,
      }),
    ]);

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
    warnings.push("Newsletter has no verified Close source and remains null.");

    if (mode === "write" && supabase) {
      const rawRows = [
        ...rawCalls.map((record) => rawActivityRow(record, "call")),
        ...rawCustomActivities.map((record) => rawActivityRow(record, "custom_activity")),
      ];
      const factRows = activityFacts.map(activityFactRow);
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
      const { error: recalculateError } = await supabase.rpc("recalculate_daily_sales_metrics", {
        p_start_date: startDate, p_end_date: endDate,
      });
      if (recalculateError) throw recalculateError;
      const { error: cleanupError } = await supabase.rpc("cleanup_dashboard_history");
      if (cleanupError) throw cleanupError;
      const { error: runError } = await supabase.from("sync_runs").update({
        status: "success",
        completed_at: new Date().toISOString(),
        fetched_records: rawCalls.length + rawCustomActivities.length + opportunities.length,
        upserted_records: rawRows.length + factRows.length + opportunityRows.length,
        metadata: { mode, mappingVersion: MAPPING_VERSION, scheduled: false, warnings },
      }).eq("id", syncRunId);
      if (runError) throw runError;
    }

    return response(200, {
      ok: true,
      mode,
      wroteData: mode === "write",
      scheduled: false,
      range: { startDate, endDate, timezone: REPORTING_TIMEZONE },
      mappingVersion: MAPPING_VERSION,
      fetched: { calls: rawCalls.length, customActivities: rawCustomActivities.length, wonOpportunities: opportunities.length },
      mapped: { activities: activityFacts.length, deals: deals.length },
      people: summarize(activityFacts, deals),
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
      : { error: "sync_failed" };
    return response(500, { ok: false, ...failure });
  }
});
