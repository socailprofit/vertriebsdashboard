import {
  kpiRate,
  kpiCount,
  KPI_RULES,
  buildBusinessContext,
  buildPipelineInput,
  buildProcessInput,
  businessContextIsConfigured,
  extractResponseText,
  REPORTING_TIMEZONE,
} from "./weekly-review.ts";

type JsonRecord = Record<string, unknown>;

export type AssistantPeriod = "day" | "week" | "month";

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? value as JsonRecord : {};
}

function dateString(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function personKey(value: unknown): string {
  if (typeof value !== "string") return "unbekannt";
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return safe || "unbekannt";
}

export function normalizeAssistantQuestion(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid_question");
  const question = value.trim().replace(/\s+/g, " ");
  if (question.length < 3 || question.length > 500) throw new Error("invalid_question");
  return question;
}

export function normalizeAssistantPeriod(value: unknown): AssistantPeriod {
  if (value === "day" || value === "week" || value === "month") return value;
  throw new Error("invalid_period");
}

export function normalizeReferenceDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("invalid_reference_date");
  }
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("invalid_reference_date");
  }
  return value;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// Der Vergleich bleibt zum gewaehlten Zeitraum passend: Vortag (am Montag
// Freitag), Vorwoche oder derselbe Monatstag im Vormonat, am Monatsende
// entsprechend geklemmt.
export function previousReferenceDate(period: AssistantPeriod, referenceDate: string): string {
  const current = new Date(`${normalizeReferenceDate(referenceDate)}T12:00:00.000Z`);
  if (period === "day") {
    do current.setUTCDate(current.getUTCDate() - 1);
    while (current.getUTCDay() === 0 || current.getUTCDay() === 6);
    return isoDate(current);
  }
  if (period === "week") {
    current.setUTCDate(current.getUTCDate() - 7);
    return isoDate(current);
  }

  const day = current.getUTCDate();
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth();
  const lastDayOfPreviousMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  return isoDate(new Date(Date.UTC(year, month - 1, Math.min(day, lastDayOfPreviousMonth), 12)));
}

const COUNT_KEYS = [
  "calls_gross",
  "calls_net",
  "gatekeeper_contacts",
  "connected_calls",
  "direct_decision_maker_calls",
  "decision_maker_contacts",
  "appointments",
  "newsletters",
] as const;

function metricRow(source: unknown) {
  const row = record(source);
  return {
    person: personKey(row.slug),
    period_start: dateString(row.period_start),
    period_end: dateString(row.period_end),
    calls_gross: kpiCount(row.calls_gross),
    calls_net: kpiCount(row.calls_net),
    net_rate: kpiRate(row.calls_net, row.calls_gross),
    gatekeeper_contacts: kpiCount(row.gatekeeper_contacts),
    connected_calls: kpiCount(row.connected_calls),
    transfer_rate: kpiRate(row.connected_calls, row.gatekeeper_contacts),
    direct_decision_maker_calls: kpiCount(row.direct_decision_maker_calls),
    decision_maker_contacts: kpiCount(row.decision_maker_contacts),
    appointments: kpiCount(row.appointments),
    appointment_rate: kpiRate(row.appointments, row.decision_maker_contacts),
    newsletters: row.newsletters === null || row.newsletters === undefined
      ? null
      : kpiCount(row.newsletters),
  };
}

export function buildAssistantMetrics(source: unknown) {
  const rows = (Array.isArray(source) ? source : []).slice(0, 12).map(metricRow);
  const teamCounts = Object.fromEntries(COUNT_KEYS.map((key) => [
    key,
    rows.length === 0 || rows.some(row => row[key] === null) ? null
      : rows.reduce((sum, row) => sum + (row[key] ?? 0), 0),
  ])) as Record<(typeof COUNT_KEYS)[number], number | null>;

  return {
    timezone: REPORTING_TIMEZONE,
    people: rows,
    team: {
      period_start: rows[0]?.period_start ?? "",
      period_end: rows[0]?.period_end ?? "",
      ...teamCounts,
      net_rate: kpiRate(teamCounts.calls_net, teamCounts.calls_gross),
      transfer_rate: kpiRate(teamCounts.connected_calls, teamCounts.gatekeeper_contacts),
      appointment_rate: kpiRate(teamCounts.appointments, teamCounts.decision_maker_contacts),
    },
  };
}

export function buildAssistantClosing(source: unknown) {
  const row = record(Array.isArray(source) ? source[0] : source);
  return {
    period_start: dateString(row.period_start),
    period_end: dateString(row.period_end),
    appointments: kpiCount(row.appointments),
    setter_calls: kpiCount(row.setter_calls),
    setter_successes: kpiCount(row.setter_successes),
    setter_conversion_rate: kpiRate(row.setter_successes, row.setter_calls),
    closer_calls: kpiCount(row.closer_calls),
    cc2_agreed: kpiCount(row.closer_second_calls),
    decided_closer_calls: kpiCount(row.decided_closer_calls),
    closer_sales: kpiCount(row.closer_sales),
    closer_close_rate: kpiRate(row.closer_sales, row.decided_closer_calls),
    new_customers: kpiCount(row.new_customers),
  };
}

type AssistantInputArgs = {
  question: unknown;
  period: unknown;
  referenceDate: unknown;
  currentMetrics: unknown;
  previousMetrics: unknown;
  currentClosing: unknown;
  previousClosing: unknown;
  currentProcess?: unknown;
  previousProcess?: unknown;
  pipeline: unknown;
  context: unknown;
};

// Nur diese Struktur darf die Supabase-Umgebung verlassen. Zusaetzliche
// Datenbankfelder, Rohpayloads, IDs, E-Mails und Close-Notizen werden verworfen.
export function buildAssistantInput(args: AssistantInputArgs) {
  const period = normalizeAssistantPeriod(args.period);
  const referenceDate = normalizeReferenceDate(args.referenceDate);
  const businessContext = buildBusinessContext(args.context);
  if (!businessContextIsConfigured(businessContext)) throw new Error("assistant_context_incomplete");

  return {
    kpi_rules: KPI_RULES,
    user_question: normalizeAssistantQuestion(args.question),
    selected_period: period,
    reference_date: referenceDate,
    comparison_reference_date: previousReferenceDate(period, referenceDate),
    business_context: businessContext,
    current: {
      dashboard: buildAssistantMetrics(args.currentMetrics),
      closing: buildAssistantClosing(args.currentClosing),
      process: buildProcessInput(args.currentProcess),
    },
    comparison: {
      dashboard: buildAssistantMetrics(args.previousMetrics),
      closing: buildAssistantClosing(args.previousClosing),
      process: buildProcessInput(args.previousProcess),
    },
    open_pipeline: buildPipelineInput(args.pipeline),
  };
}

export function parseAssistantAnswer(response: unknown): string {
  const parsed = record(JSON.parse(extractResponseText(response)));
  const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  if (answer.length < 2 || answer.length > 1_200) throw new Error("openai_output_invalid");
  return answer;
}
