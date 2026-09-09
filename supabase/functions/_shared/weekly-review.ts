import { LEAD_SOURCES } from "./close-mapping.ts";

export function kpiRate(numerator: unknown, denominator: unknown): number | null {
  const n = kpiCount(numerator), d = kpiCount(denominator);
  return n !== null && d !== null && d > 0 ? Math.round(n / d * 10000) / 100 : null;
}

export const KPI_RULES = [
  "Durchstellung: nur exakt durchgestellt / bewertbare Vorzimmerkontakte; GF/CEO nicht erreichbar, Mailbox, ausserhalb Geschaeftszeit und direkte Entscheider ausgeschlossen. Anrufzahlen bleiben erhalten.",
  "Setter-Gespraechsergebnisse: Closer terminiert / durchgefuehrte Setter Calls ist der Qualifizierungsanteil aller Gespraeche, einschliesslich Wiederholungen; keine Showrate und keine Quote neuer Vorgaenge. flow.first_qualified zaehlt die erste Qualifizierung je Vorgang im Zeitraum.",
  "Closer: Antony nach Aktivitaetsnutzer. Abschlussquote: Verkauft / explizite Entscheidungen (Verkauft oder Nicht verkauft). Offene CC2 und fehlende Ergebnisse sind keine Entscheidungen.",
  "Periodenverhaeltnisse verbinden unterschiedliche Ereignisse desselben Zeitraums; keine Kohortenconversion und keine Teilnahmequote. Werte ueber 100 Prozent sind moeglich. Keine Ursache oder Funnelverluste daraus behaupten.",
  "Kundenabschluesse: erste gewonnene Neukunden-Opportunity je Lead am dokumentierten Won-Datum, keine Upsells oder Verlaengerungen. Aeltere Vorgaenge koennen erst jetzt gewonnen werden; ein spaeteres Ja verschiebt oder verdoppelt den Neukunden nicht.",
  "Null bedeutet keine Grundgesamtheit. Weder null noch fehlende Historie als 0 Prozent oder Leistungsverlust bewerten.",
  "Leadqualitaet: letztes Setter-Ergebnis je dokumentiertem Vertriebsvorgang im Aktivitaetszeitraum, getrennt nach Quelle und Terminlieferant dieses Vorgangs; zwei echte Vorgaenge desselben Leads bleiben getrennt. Ohne Vorgangszuordnung wird ein Lead separat als unbekannt ausgewertet. Aktuelle Leadquelle ist keine historische Quellenmessung.",
  "Terminzeitpunkt: nur nachweisbare Setter-Kalendertermine, zugeordnet nach tatsaechlichem Meeting-Datum und nicht Erstell- oder Buchungsdatum. Zukunftstermine sind Planung und weder Setter/Closer Calls noch Shows, No-Shows oder sonstige Ist-Performance. Aktueller Tag nur bis data_as_of, keine Hochrechnung.",
  "Vorgangskohorte: ein dokumentierter Vertriebsvorgang zaehlt einmal nach seinem ersten zugeordneten Setter-Kalendertermin; Erstellzeit und erste Buchung des gesamten Leads sind keine Kohortenbasis. Ergebnisse bis Stichtag muessen zum selben Vorgang gehoeren. Eindeutige Ersatztermine erzeugen keinen neuen Vorgang; eine Verschiebung vor dem ersten durchgefuehrten Setter verschiebt die Kalenderzuordnung. Erst beendeter Vorgang plus neue dokumentierte Buchung erlaubt einen neuen Vorgang.",
  "Setter-Showrate: attended / elapsed aus setter_attendance, also nachweislich durchgefuehrte unter den faelligen geplanten Meetings dieses Zeitraums. future ist ausgeschlossen; unknown ist kein No-Show. setter_arrived / booked_leads ist dagegen Vorgangsfortschritt bis Stichtag und enthaelt offene Termine.",
  "Follow-up-Kontakte, Setter-Follow-ups und CC2-Vereinbarungen sind protokollierte Ereignisse; nicht automatisch aktuell offen. Leadqualitaet auf kleinen Stichproben nicht als endgueltige Rangliste bewerten.",
  "open_pipeline ist bei persistent=true der aktuelle Bestand dokumentierter offener Vorgaenge zum angegebenen Datenstand, unabhaengig vom Zeitraumfilter und nicht auf drei Monate begrenzt. Es ist keine Kopie beliebiger Close-Statuswerte und kein historischer Wochentrend. Bei persistent=false gilt nur das angegebene gespeicherte Fenster.",
  "Geplante Vorgaenge in setter_planned/closer_planned/cc2_planned und next_by_month sind bereits terminiert, kein fehlender Follow-up-Schritt und kein Verlust. planning_needs_review bedeutet unklare Terminphase; weder Setter noch Closer erfinden. next_by_month und counts ueberlappen und duerfen nicht addiert werden. Nur bestaetigten aktuellen offenen Zustand fuer Handlungsbedarf verwenden, nicht historische Follow-up-Ergebnisse.",
  "funnel_by_source verknuepft dieselben Vorgaenge chronologisch: erster Setter-Kalendertermin, Setter, Qualifizierung, Closer, optionale CC2 und Neukunde. Jede Quote braucht Zaehler und konkrete Vorstufenbasis; dokumentierte Ergebnisse ohne Vorstufen stehen unter unlinked. observed_customers zaehlt belegte Neukunden dieser Vorgangsgruppe auch bei fehlenden Zwischenschritten; diese werden nicht erfunden.",
  "CC2 ist ein optionaler Folgeweg nach CC1, keine Pflichtstufe fuer direkte CC1-Verkaeufe. Vereinbart ist nicht durchgefuehrt. Folgegespraech nur nach dokumentierter CC2-Vereinbarung oder ausdruecklichem Verkauf in CC2. Ohne passende Historie ist die Phase unklar.",
  "activity_by_origin und period_bridge ordnen jetzige Aktivitaeten dem ersten Setter-Termin ihres eigenen Vorgangs zu: im Zeitraum, frueher oder unbekannt. CC2-Historie bleibt innerhalb desselben Vorgangs. Niemals September-Gespraeche aus August-Vorgaengen durch neue September-Vorgaenge teilen. Uebergangsquoten nur aus derselben Vorgangskohorte; unbekannte Zuordnung nicht auffuellen.",
  "flow.new_processes sind Vorgaenge mit Ersttermin im Zeitraum; carried_in sind aeltere Vorgaenge mit Setter-Arbeit im Zeitraum; repeat_setter_calls sind Folgegespraeche, keine neuen Qualifizierungen. unlinked_setter_calls ist fehlende Zuordnung. Diese Mengen koennen sich ueberschneiden und bilden keine additive Pipeline.",
  "Terminlieferant und Gespraechsmitarbeiter sind getrennt: owner=linkedin ist ein Lieferkanal, keine Person. Eine LinkedIn-Zuordnung aendert nicht, wer einen tatsaechlichen Call durchgefuehrt hat. Fehlende Lieferantenzuordnung nicht aus Aktivitaetsnutzer oder aktuellem Opener erfinden.",
];

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

export function kpiCount(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "" || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function dateString(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function timestampString(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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
      calls_gross: kpiCount(funnel.calls_gross),
      calls_net: kpiCount(funnel.calls_net),
      net_rate: kpiRate(funnel.calls_net, funnel.calls_gross),
      gatekeeper_contacts: kpiCount(funnel.gatekeeper_contacts),
      connected_calls: kpiCount(funnel.connected_calls),
      transfer_rate: kpiRate(funnel.connected_calls, funnel.gatekeeper_contacts),
      decision_maker_contacts: kpiCount(funnel.decision_maker_contacts),
      appointments: kpiCount(funnel.appointments),
      appointment_rate: kpiRate(funnel.appointments, funnel.decision_maker_contacts),
    },
    kpi_rules: KPI_RULES,
    process: buildProcessInput(root.process),
    closing: {
      appointments: kpiCount(closing.appointments),
      setter_calls: kpiCount(closing.setter_calls),
      setter_successes: kpiCount(closing.setter_successes),
      setter_conversion_rate: kpiRate(closing.setter_successes, closing.setter_calls),
      closer_calls: kpiCount(closing.closer_calls),
      closer_period_ratio: kpiRate(closing.closer_calls, closing.setter_successes),
      cc2_agreed: kpiCount(closing.cc2_agreed),
      cc2_rate: kpiRate(closing.cc2_agreed, closing.closer_calls),
      decided_closer_calls: kpiCount(closing.decided_closer_calls),
      closer_sales: kpiCount(closing.closer_sales),
      closer_close_rate: kpiRate(closing.closer_sales, closing.decided_closer_calls),
      new_customers: kpiCount(closing.new_customers),
      appointment_to_closer_period_ratio: kpiRate(closing.closer_calls, closing.appointments),
    },
    data_basis: {
      too_small: boolean(basis.too_small) || kpiCount(funnel.appointments) === null || kpiCount(closing.closer_calls) === null,
      rule: "Zu klein bei weniger als 5 Terminen oder weniger als 5 Closer Calls.",
    },
  };
}

export const PROCESS_COUNT_KEYS = [
  "followup_contacts", "further_followups", "followup_appointments", "followup_disqualified", "followup_no_interest",
  "setter_calls", "setter_qualified", "setter_followups", "setter_disqualified", "setter_unrated",
  "setter_no_shows", "setter_cancellations", "setter_rescheduled", "closer_no_shows", "closer_cancellations", "closer_rescheduled",
  "closer_calls", "cc1_sales", "cc2_sales", "cc2_agreed", "closer_lost", "closer_unrated",
] as const;
const JOURNEY_KEYS = ["booked_leads","setter_arrived","closer_qualified","closer_arrived","decided_leads","sold_leads","new_customers","observed_customers","unlinked_closer","unlinked_customer","cc2_agreed","cc2_held","cc2_decided","cc2_sold","cc2_lost","cc2_waiting","cc2_open","cc2_cancelled", "cc2_no_show", "cc2_rescheduled", "cc2_missing_agreement","cc1_sold","cc1_lost"] as const;
const BRIDGE_KEYS = ["setter_calls","setter_leads","setter_processes","setter_from_period_bookings","setter_from_prior_bookings","setter_without_booking","new_customers","customers_from_period_bookings","customers_from_prior_bookings","customers_without_booking","sales_after_prior_won","cc2_calls","cc1_calls","cc1_lost","cc2_lost","cc_unassigned_calls","closer_lost_unassigned"] as const;
const FLOW_KEYS = ["new_processes","carried_in","first_qualified","repeat_setter_calls","unlinked_setter_calls"] as const;
const ATTENDANCE_KEYS = ["scheduled","elapsed","future","attended","no_show","cancelled","rescheduled","unknown"] as const;
const QUALITY_KEYS = ["assessed_leads", "qualified", "followup", "disqualified", "unrated"] as const;
const COHORT_KEYS = ["booked_leads", "setter_arrived", "not_in_setter", "pending", "future", "no_show", "cancelled", "rescheduled", "qualified", "followup", "disqualified", "unrated", "closer_arrived", "sold_leads", "new_customers"] as const;
function counts(source: unknown, keys: readonly string[]) {
  const row = record(source);
  return Object.fromEntries(keys.map(key => [key, kpiCount(row[key])]));
}
function safeQualityDimensions(source: unknown) {
  const row = record(source);
  return {
    source: typeof row.source === "string" && LEAD_SOURCES.has(row.source) ? row.source : "Nicht zugeordnet",
    owner: ["michael", "felix", "antony", "linkedin", "other", "unassigned"].includes(String(row.owner)) ? String(row.owner) : "unassigned",
  };
}
function aggregateCohortCounts(source: unknown, keys: readonly string[]) {
  const groups = new Map<string, ReturnType<typeof safeQualityDimensions> & Record<string, unknown>>();
  for(const value of Array.isArray(source) ? source : []) {
    const dims = safeQualityDimensions(value), id=JSON.stringify(dims);
    const row=counts(value,keys), previous=groups.get(id);
    if(!previous) groups.set(id,{...dims,...row});
    else for(const k of keys) previous[k]=previous[k]===null || row[k]===null ? null : Number(previous[k])+Number(row[k]);
  }
  return [...groups.values()];
}
// Only categorical labels and aggregates: never lead IDs, names, notes or email.
export function buildProcessInput(source: unknown) {
  const root = record(source), period = record(root.period), flow = record(root.flow), coverage = record(root.coverage), attendance = record(root.setter_attendance);
  const qualityRows = Array.isArray(root.quality_by_source) ? root.quality_by_source : null;
  return {
    period: {start: dateString(period.start), end: dateString(period.end), timezone: REPORTING_TIMEZONE},
    flow: {...counts(flow,FLOW_KEYS),cohort_basis: flow.cohort_basis === "first_scheduled_meeting" ? "first_scheduled_meeting" : "unknown"},
    coverage: {history_complete: boolean(coverage.history_complete),complete_period: typeof coverage.complete_period === "boolean" ? coverage.complete_period : null},
    setter_attendance: {
      period_start:dateString(attendance.period_start),period_end:dateString(attendance.period_end),data_as_of:timestampString(attendance.data_as_of),
      ...counts(attendance,ATTENDANCE_KEYS),show_rate:kpiRate(attendance.attended,attendance.elapsed),
      by_source:aggregateCohortCounts(attendance.by_source,ATTENDANCE_KEYS).slice(0,225),
    },
    activity: counts(root.activity, PROCESS_COUNT_KEYS),
    period_bridge: counts(root.period_bridge, BRIDGE_KEYS),
    activity_by_origin: (Array.isArray(root.activity_by_origin) ? root.activity_by_origin : []).slice(0,500).map(value=>({
      ...safeQualityDimensions(value), booked_date: dateString(record(value).booked_date) || null,
      ...counts(value,[...PROCESS_COUNT_KEYS,...BRIDGE_KEYS,"appointments"]),
    })),
    funnel_by_source: aggregateCohortCounts(root.funnel_by_source,JOURNEY_KEYS).slice(0,225),
    // Derive totals from the same process groups instead of a legacy lead total.
    lead_quality: qualityRows ? Object.fromEntries(QUALITY_KEYS.map(key => [key,qualityRows.some(row=>kpiCount(record(row)[key])===null) ? null : qualityRows.reduce((sum,row)=>sum+Number(record(row)[key]),0)])) : counts(root.lead_quality, QUALITY_KEYS),
    quality_by_source: (Array.isArray(root.quality_by_source) ? root.quality_by_source : []).slice(0,225).map(value => {
      const row = record(value);
      return {...safeQualityDimensions(row), ...counts(row, QUALITY_KEYS),
        attribution: ["sales_process", "booking_activity", "current_opener", "unassigned"].includes(String(row.attribution)) ? row.attribution : "unassigned",
        qualified_share: kpiRate(row.qualified, row.assessed_leads)};
    }),
    booking_cohort: aggregateCohortCounts(root.booking_cohort,COHORT_KEYS).slice(0,225).map(value => {
      const row = record(value);
      return {...safeQualityDimensions(row), ...counts(row, COHORT_KEYS),
        setter_arrival_progress: kpiRate(row.setter_arrived, row.booked_leads),
        qualified_share_of_arrivals: kpiRate(row.qualified, row.setter_arrived)};
    }),
  };
}

// Die KI darf offene Pipeline nur als aggregierte Momentaufnahme sehen. Die
// Whitelist verhindert, dass spaetere Erweiterungen des Datenbank-RPCs wie
// Lead-IDs, Namen oder Notizen unbemerkt an das Modell weitergereicht werden.
export function buildPipelineInput(source: unknown) {
  const root = record(source);
  const counts = record(root.counts);
  const persistent = boolean(root.persistent),coverage=record(root.coverage);
  const planned = new Map<string,{month:string;stage:string;count:number}>();
  for(const value of Array.isArray(root.next_by_month) ? root.next_by_month : []) {
    const row=record(value),month=dateString(row.month),count=kpiCount(row.count);
    if(!/^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(month) || !["setter","closer","cc2","unassigned"].includes(String(row.stage)) || count===null) continue;
    if(dateString(root.as_of) && month < dateString(root.as_of).slice(0,7)+"-01") continue;
    const stage=String(row.stage),key=month+":"+stage,previous=planned.get(key);
    planned.set(key,{month,stage,count:(previous?.count ?? 0)+count});
  }

  return {
    persistent,
    as_of: dateString(root.as_of),
    data_as_of:timestampString(root.data_as_of),
    timezone: REPORTING_TIMEZONE,
    window_start: dateString(root.window_start),
    retention_months: persistent ? null : kpiCount(root.retention_months),
    counts: {
      total_open: kpiCount(counts.total_open),
      setter_planned:kpiCount(counts.setter_planned),setter_cancelled:kpiCount(counts.setter_cancelled),
      closer_planned:kpiCount(counts.closer_planned),cc2_planned:kpiCount(counts.cc2_planned),
      closer_followup:kpiCount(counts.closer_followup),closer_cancelled:kpiCount(counts.closer_cancelled),
      planning_needs_review:kpiCount(counts.planning_needs_review),
      setter_pending: kpiCount(counts.setter_pending),
      setter_followup: kpiCount(counts.setter_followup),setter_no_show:kpiCount(counts.setter_no_show),
      rescheduled_setter:kpiCount(counts.rescheduled_setter),closer_no_show:kpiCount(counts.closer_no_show),
      sold_pending_won:kpiCount(counts.sold_pending_won),unrated:kpiCount(counts.unrated),
      closer_scheduled: kpiCount(counts.closer_scheduled),
      rescheduled_closer: kpiCount(counts.rescheduled_closer),
      pending_decision_cc2: kpiCount(counts.pending_decision_cc2),
      from_previous_months: kpiCount(counts.from_previous_months),
      older_than_14_days: kpiCount(counts.older_than_14_days),
    },
    next_by_month:[...planned.values()].sort((a,b)=>a.month.localeCompare(b.month)||a.stage.localeCompare(b.stage)).slice(0,120),
    coverage:{unlinked_processes:kpiCount(coverage.unlinked_processes)},
    oldest_open_date: dateString(root.oldest_open_date),
    interpretation: persistent
      ? "Aktueller Gesamtbestand dokumentierter offener Vorgaenge zum Datenstand, unabhaengig vom Zeitraumfilter und ohne Drei-Monatsbegrenzung. Kalenderplanung ist kein ueberfaelliger Follow-up und keine Ist-Performance. Planungsliste und Stufenzaehler ueberlappen."
      : "Aggregierter Bestand nur aus dem angegebenen gespeicherten Fenster; Vollstaendigkeit unbekannt. Kein historischer Trend und keine Kopie aktueller Close-Opportunity-Statuswerte.",
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
  "setter_conversion_rate",
  "closer_period_ratio",
  "cc2_rate",
  "closer_close_rate",
  "appointment_to_closer_period_ratio",
] as const;

function roundedDelta(current: number | null, previous: number | null) {
  if (current === null || previous === null) return null;
  return Math.round((current - previous) * 100) / 100;
}

// Die Nettoquote wird nicht vom Modell frei interpretiert. 70 bis 80 Prozent
// sind bei Social Profit der normale Arbeitsbereich und damit keine besondere
// Staerke. Unter 70 Prozent entsteht ein konkreter Pruefhinweis fuer die
// Leadlistenqualitaet; eine Ursache wird daraus weiterhin nicht behauptet.
export function classifyNetRate(netRate: number | null, callsGross: number | null) {
  if (callsGross === null || callsGross <= 0 || netRate === null) {
    return {
      status: "no_data",
      interpretation: "Keine belastbare Grundgesamtheit; die Nettoquote ist nicht bewertbar.",
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
    return sentence.replace(/\s+/g, " ").trim();
  });
  if (sentences.length !== 5) throw new Error("openai_output_invalid");
  if (sentences.some((sentence) => sentence.length > 320)) throw new Error("openai_output_invalid");
  return sentences;
}
