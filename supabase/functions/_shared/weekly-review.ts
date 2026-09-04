export const REPORTING_TIMEZONE = "Europe/Berlin";

type JsonRecord = Record<string, unknown>;

export type SalesWeek = {
  start: string;
  end: string;
  isoYear: number;
  isoWeek: number;
};

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? value as JsonRecord : {};
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function dateString(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function limitedText(value: unknown, maxLength = 500): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => limitedText(item, 300))
    .filter(Boolean)
    .slice(0, 12);
}

export function dateInReportingTimezone(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(value.getTime())) throw new Error("invalid_reference_date");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function isoWeekFor(date: string): { isoYear: number; isoWeek: number } {
  const value = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(value.getTime())) throw new Error("invalid_reference_date");
  const weekday = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - weekday);
  const isoYear = value.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1, 12));
  const isoWeek = Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return { isoYear, isoWeek };
}

// Eine abgeschlossene Vertriebswoche ist immer Montag bis Freitag. Als
// Referenz dient der Berliner Kalendertag, nicht die UTC-Uhrzeit der Function.
export function previousCompletedSalesWeek(referenceDate: string): SalesWeek {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) throw new Error("invalid_reference_date");
  const value = new Date(`${referenceDate}T12:00:00.000Z`);
  if (Number.isNaN(value.getTime())) throw new Error("invalid_reference_date");
  const daysSinceMonday = (value.getUTCDay() + 6) % 7;
  const currentMonday = addDays(referenceDate, -daysSinceMonday);
  const start = addDays(currentMonday, -7);
  const end = addDays(start, 4);
  return { start, end, ...isoWeekFor(start) };
}

// Diese Whitelist ist zugleich die Datenschutzgrenze zum Modell. Selbst wenn
// die Datenbankfunktion spaeter weitere Felder liefert, verlassen nur diese
// aggregierten Summen und Quoten die Supabase-Umgebung.
export function buildModelInput(source: unknown) {
  const root = record(source);
  const period = record(root.period);
  const funnel = record(root.funnel);
  const closing = record(root.closing);
  const basis = record(root.data_basis);

  return {
    period: {
      start: dateString(period.start),
      end: dateString(period.end),
      timezone: REPORTING_TIMEZONE,
    },
    funnel: {
      calls_gross: number(funnel.calls_gross),
      calls_net: number(funnel.calls_net),
      net_rate: number(funnel.net_rate),
      gatekeeper_contacts: number(funnel.gatekeeper_contacts),
      connected_calls: number(funnel.connected_calls),
      transfer_rate: number(funnel.transfer_rate),
      decision_maker_contacts: number(funnel.decision_maker_contacts),
      appointments: number(funnel.appointments),
      appointment_rate: number(funnel.appointment_rate),
    },
    closing: {
      setter_calls: number(closing.setter_calls),
      setter_successes: number(closing.setter_successes),
      setter_show_rate: number(closing.setter_show_rate),
      closer_calls: number(closing.closer_calls),
      closer_show_rate: number(closing.closer_show_rate),
      cc2_agreed: number(closing.cc2_agreed),
      cc2_rate: number(closing.cc2_rate),
      decided_closer_calls: number(closing.decided_closer_calls),
      closer_sales: number(closing.closer_sales),
      closer_close_rate: number(closing.closer_close_rate),
      new_customers: number(closing.new_customers),
      appointment_to_closer_rate: number(closing.appointment_to_closer_rate),
    },
    data_basis: {
      too_small: boolean(basis.too_small),
      rule: "Zu klein bei weniger als 5 Terminen oder weniger als 5 Closer Calls.",
    },
  };
}

// Die KI darf offene Pipeline nur als aggregierte Momentaufnahme sehen. Die
// Whitelist verhindert, dass spaetere Erweiterungen des Datenbank-RPCs wie
// Lead-IDs, Namen oder Notizen unbemerkt an das Modell weitergereicht werden.
export function buildPipelineInput(source: unknown) {
  const root = record(source);
  const counts = record(root.counts);

  return {
    as_of: dateString(root.as_of),
    timezone: REPORTING_TIMEZONE,
    window_start: dateString(root.window_start),
    retention_months: number(root.retention_months),
    counts: {
      total_open: number(counts.total_open),
      setter_pending: number(counts.setter_pending),
      closer_scheduled: number(counts.closer_scheduled),
      rescheduled_closer: number(counts.rescheduled_closer),
      pending_decision_cc2: number(counts.pending_decision_cc2),
      from_previous_months: number(counts.from_previous_months),
      older_than_14_days: number(counts.older_than_14_days),
    },
    oldest_open_date: dateString(root.oldest_open_date),
    interpretation: "Punktuelle, aggregierte offene Funnel-Stufen aus dem rollierenden Drei-Monats-Fenster; keine Ursachen oder aktiven Close-Opportunity-Statuswerte.",
  };
}

const FUNNEL_COUNT_KEYS = [
  "calls_gross",
  "calls_net",
  "gatekeeper_contacts",
  "connected_calls",
  "decision_maker_contacts",
  "appointments",
] as const;

const FUNNEL_RATE_KEYS = ["net_rate", "transfer_rate", "appointment_rate"] as const;

const CLOSING_COUNT_KEYS = [
  "setter_calls",
  "setter_successes",
  "closer_calls",
  "cc2_agreed",
  "decided_closer_calls",
  "closer_sales",
  "new_customers",
] as const;

const CLOSING_RATE_KEYS = [
  "setter_show_rate",
  "closer_show_rate",
  "cc2_rate",
  "closer_close_rate",
  "appointment_to_closer_rate",
] as const;

function roundedDelta(current: number, previous: number) {
  return Math.round((current - previous) * 100) / 100;
}

// Die Nettoquote wird nicht vom Modell frei interpretiert. 70 bis 80 Prozent
// sind bei Social Profit der normale Arbeitsbereich und damit keine besondere
// Staerke. Unter 70 Prozent entsteht ein konkreter Pruefhinweis fuer die
// Leadlistenqualitaet; eine Ursache wird daraus weiterhin nicht behauptet.
export function classifyNetRate(netRate: number, callsGross: number) {
  if (callsGross <= 0) {
    return {
      status: "no_data",
      interpretation: "Keine Brutto-Anrufe; die Nettoquote ist nicht bewertbar.",
    };
  }
  if (netRate < 70) {
    return {
      status: "lead_list_quality_warning",
      interpretation: "Unter dem internen Standard; Leadlisten-Qualitaet pruefen, aber keine Ursache behaupten.",
    };
  }
  if (netRate <= 80) {
    return {
      status: "standard",
      interpretation: "Interner Normalbereich; darf im Review nicht als besondere Staerke gelobt werden.",
    };
  }
  return {
    status: "above_standard",
    interpretation: "Ueber dem internen Normalbereich; nur mit ausreichender Grundgesamtheit positiv einordnen.",
  };
}

// Trends werden deterministisch berechnet, bevor das Modell die Daten sieht.
// Mengen erhalten eine absolute Differenz, Quoten eine Veraenderung in
// Prozentpunkten. Prozentuales Wachstum wird bewusst vermieden, weil es bei
// kleinen oder leeren Vorwochen irrefuehrend waere.
export function buildWeeklyComparison(
  current: ReturnType<typeof buildModelInput>,
  previous: ReturnType<typeof buildModelInput>,
) {
  return {
    funnel: {
      ...Object.fromEntries(FUNNEL_COUNT_KEYS.map((key) => [
        key,
        { absolute_change: roundedDelta(current.funnel[key], previous.funnel[key]) },
      ])),
      ...Object.fromEntries(FUNNEL_RATE_KEYS.map((key) => [
        key,
        { percentage_point_change: roundedDelta(current.funnel[key], previous.funnel[key]) },
      ])),
    },
    closing: {
      ...Object.fromEntries(CLOSING_COUNT_KEYS.map((key) => [
        key,
        { absolute_change: roundedDelta(current.closing[key], previous.closing[key]) },
      ])),
      ...Object.fromEntries(CLOSING_RATE_KEYS.map((key) => [
        key,
        { percentage_point_change: roundedDelta(current.closing[key], previous.closing[key]) },
      ])),
    },
    data_basis: {
      current_too_small: current.data_basis.too_small,
      previous_too_small: previous.data_basis.too_small,
      trend_reliable: !current.data_basis.too_small && !previous.data_basis.too_small,
    },
    business_signals: {
      current_net_rate: classifyNetRate(current.funnel.net_rate, current.funnel.calls_gross),
      previous_net_rate: classifyNetRate(previous.funnel.net_rate, previous.funnel.calls_gross),
      net_rate_standard_range: { minimum: 70, maximum: 80, unit: "percent" },
    },
  };
}

// Auch der statische Unternehmenskontext durchläuft eine feste Whitelist und
// Größenbegrenzung. Er wird manuell gepflegt und darf weder Close-Freitexte
// noch personenbezogene Datensätze enthalten.
export function buildBusinessContext(source: unknown) {
  const root = record(source);
  const company = record(root.company);
  const icp = record(root.icp);
  const sales = record(root.sales);

  return {
    company: {
      name: limitedText(company.name, 120),
      offer: limitedText(company.offer),
      business_model: limitedText(company.business_model, 300),
    },
    icp: {
      summary: limitedText(icp.summary),
      buyer_roles: textList(icp.buyer_roles),
      company_profile: limitedText(icp.company_profile),
      core_problems: textList(icp.core_problems),
    },
    sales: {
      motion: limitedText(sales.motion),
      kpi_definitions: textList(sales.kpi_definitions),
      priority_rules: textList(sales.priority_rules),
      benchmarks: textList(sales.benchmarks),
    },
  };
}

export function businessContextIsConfigured(context: ReturnType<typeof buildBusinessContext>) {
  return Boolean(
    context.company.name
    && context.company.offer
    && context.icp.summary
    && context.sales.motion,
  );
}

export function extractResponseText(response: unknown): string {
  const root = record(response);
  const output = Array.isArray(root.output) ? root.output : [];
  for (const item of output) {
    const content = Array.isArray(record(item).content) ? record(item).content as unknown[] : [];
    for (const part of content) {
      const candidate = record(part);
      if (candidate.type === "output_text" && typeof candidate.text === "string") {
        return candidate.text;
      }
    }
  }
  throw new Error("openai_output_missing");
}

export function parseReviewSentences(value: string): string[] {
  const parsed = record(JSON.parse(value));
  const requiredFields = ["strength", "bottleneck", "trend_and_conversion", "priority", "action"];
  const sentences = requiredFields.map((field) => {
    const sentence = parsed[field];
    if (typeof sentence !== "string" || !sentence.trim()) throw new Error("openai_output_invalid");
    return sentence.trim();
  });
  if (sentences.length !== 5) throw new Error("openai_output_invalid");
  if (sentences.some((sentence) => sentence.length > 320)) throw new Error("openai_output_invalid");
  return sentences;
}
