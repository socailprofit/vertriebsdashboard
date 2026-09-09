import {stageSummary, stageRows, bookingScopeReport} from './pipeline-details.mjs?v=2026-09-09-origin-aligned';
import {calendarDetails} from "./calendar-view.mjs?v=2026-09-09-cc2-evidence-fix";
import {activityCards, processDetails, quota, filterTrackingSource, LEAD_SOURCE_OPTIONS, originQualityPie} from "./antony-view.mjs?v=2026-09-09-source-groups";
import {TRACKING_MEMBERS, memberResults} from "./tracking-view.mjs?v=2026-09-09-origin-aligned";
import { workdaysBetween, goalPeriodRange, salesTargetForRange, grossCallPerformanceClass } from "./sales-goals.mjs?v=2026-09-09-cc2-evidence-fix";
import { transition, totalCounts, JOURNEY_KEYS } from "./pipeline-metrics.mjs?v=2026-09-09-cc2-evidence-fix";
import { installChartPopover } from "./chart-popover.mjs?v=2026-09-09-best-call-times";
installChartPopover();
import { escapeHtml, safeColor } from "./render-security.mjs?v=2026-09-09-cc2-evidence-fix";
// Die Versionskennung an allen Datei-Verweisen sorgt dafür, dass ein Browser
// nach einer Veröffentlichung nicht die alte Datei weiterbenutzt. Sie steht in
// index.html, hier und in data.js und wird bei jedem Release erhöht.
import * as data from "./data.js?v=2026-09-09-best-call-times";
import { calculateAntonyPlan, calculateAntonyMonthForecast } from "./antony-planner.mjs?v=2026-09-09-cc2-evidence-fix";
import { renderCallTimeProfile } from "./call-time-view.mjs?v=2026-09-09-best-call-times";
import { hasAntonyDashboardAccess, hasWeeklyReviewAccess } from "./access-control.mjs?v=2026-09-09-cc2-evidence-fix";

// Sobald die finalen Profilbilder vorliegen, muss nur hier der jeweilige Pfad
// (zum Beispiel "./assets/profiles/michael.webp") eingetragen werden. Bei null
// oder einem nicht ladbaren Bild bleibt automatisch der Initialen-Platzhalter.
const PROFILE_IMAGES = Object.freeze({
  michael: "./assets/profiles/michael.png",
  felix: "./assets/profiles/felix.png",
  antony: "./assets/profiles/antony.png",
});

const PROFILE_INITIALS = Object.freeze({
  michael: "MG",
  felix: "FW",
  antony: "AR",
});

// Sichtbarer Kennzahlenumfang, am 2026-09-02 festgelegt. Gesprächszeit läuft als
// Nebenangabe in der Rangliste mit. Setter, Closer, No Shows, Deals und Umsatz
// werden weiter importiert, aber nicht angezeigt.
const metricDefinitions = [
  { key: "callsGross", label: "Anrufe brutto", detail: "Ausgehend, endgültiger Status", format: number, target: "calls_gross" },
  { key: "callsNet", label: "Anrufe netto", detail: "Abgeschlossen und angenommen", format: number, target: "calls_net" },
  { key: "netRate", label: "Nettoquote", detail: "Netto-Anrufe ÷ Brutto-Anrufe", format: percent, noTarget: true },
  { key: "gatekeeper", label: "Vorzimmer (bewertbar)", detail: "Durchstellversuche ohne Nichterreichbarkeit", format: number, target: "gatekeeper_contacts" },
  { key: "connected", label: "Durchstellungen", detail: "Vom Vorzimmer durchgestellt", format: number, target: "connected_calls" },
  { key: "connectionRate", label: "Durchstellquote", detail: "Durchstellungen ÷ bewertbare Vorzimmer-Ergebnisse", format: percent, rateTarget: "transfer_rate_target", ratio: ["connected", "gatekeeper"] },
  { key: "directDecisionMakers", label: "Entscheider direkt", detail: "Ohne Vorzimmer erreicht", format: number, noTarget: true },
  { key: "decisionMakers", label: "Entscheider gesamt", detail: "Direkt und durchgestellt", format: number, target: "decision_maker_contacts" },
  { key: "appointments", label: "Termine", detail: "Termin vereinbart", format: number, target: "appointments" },
  { key: "appointmentRate", label: "Terminquote", detail: "Termine ÷ Entscheider", format: percent, rateTarget: "appointment_rate_target", ratio: ["appointments", "decisionMakers"] },
  { key: "mailbox", label: "Mailbox", detail: "Close-Outcome 📮 Mailbox", format: number, noTarget: true },
  { key: "outsideBusinessHours", label: "Außerhalb Geschäftszeit", detail: "Close-Outcome außerhalb der Geschäftszeiten", format: number, noTarget: true },
  { key: "newsletters", label: "Newsletter versendet", detail: "Tatsächlich versendete E-Mails im Newsletter-Workflow", format: count, noTarget: true },
];

// Zielspalten, die der Chef pflegen kann. Die Reihenfolge bestimmt das Formular.
const targetFields = [
  ["calls_gross", "Anrufe brutto"],
  ["calls_net", "Anrufe netto"],
  ["gatekeeper_contacts", "Vorzimmer"],
  ["connected_calls", "Durchstellungen"],
  ["transfer_rate_target", "Durchstellquote (%)"],
  ["decision_maker_contacts", "Entscheider gesamt"],
  ["appointments", "Termine"],
  ["appointment_rate_target", "Terminquote (%)"],
];

const periodLabels = { day: "Tag", week: "Woche", month: "Monat" };
const viewCopy = {
  team: ["Gemeinsamer Wettbewerb", "Michael gegen Felix", "Alle Kernkennzahlen getrennt, vergleichbar und als Team zusammengeführt."],
  antony: ["Vertriebssteuerung", "Antony im Fokus", "Leistung im Zeitraum und nächste Schritte vom Setter bis zum Neukunden."],
  chef: ["Steuerung", "Ziele setzen", "Ziele bestimmen die Farben der Kennzahlen im gesamten Dashboard."],
  betrieb: ["Betrieb", "Sync-Status", "Zustand des Datenimports aus Close."],
};

const state = {
  view: "team",
  period: "month",
  referenceDate: berlinToday(),
  // Ohne bewusst gewählten historischen Stichtag folgt die Ansicht automatisch
  // dem Berliner Kalendertag — auch wenn das Dashboard über Mitternacht offen
  // bleibt. Nur ein ausdrücklich gesetzter Rückblick bleibt fest stehen.
  datePinned: false,
  people: [],
  metrics: {},
  hours: [],
  trends: [],
  targets: [],
  closing: null,
  antonyPipeline: null,
  antonyProcess: null,
  antonyPerformance: [],
  antonyGoal: null,
  antonyCustomerValueCents: 0,
  plannerOpen: true,
  antonyRateMode: "current",
  antonyPlannerMetrics: {},
  antonyPlannerClosing: null,
  antonyPlannerPeriodRange: { start: null, end: null },
  weeklyReview: null,
  kpiAssistant: { answer: null, error: null, loading: false, remainingRequests: null },
  periodRange: { start: null, end: null },
  profile: { displayName: null, role: "sales", salesPersonId: null, mustChangePassword: false, email: null },
  syncRun: null,
  heatmapRate: "quality",
  series: [],
  trendHours: [],
  trendRate: "quality",
  widget: null,
  lastCalculated: null,
  status: "start",
  error: null,
  unsubscribe: null,
  forcePasswordSetup: false,
  passwordChangeInProgress: false,
};

// --- Formatierung ------------------------------------------------------------

function berlinToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function number(value) {
  return new Intl.NumberFormat("de-DE").format(Math.round(value || 0));
}

function count(value) {
  return value === null || value === undefined ? "—" : number(value);
}

function minutes(value) {
  const total = Math.round(value || 0);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

function percent(value) {
  return value === null || value === undefined ? "—" : `${Math.round(value)} %`;
}

function decimal(value) {
  return value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(value);
}

function euros(cents) {
  return cents === null || cents === undefined
    ? "—"
    : new Intl.NumberFormat("de-DE", {
      style: "currency", currency: "EUR", maximumFractionDigits: 0,
    }).format(cents / 100);
}

function germanDate(isoDate) {
  if (!isoDate || !Number.isFinite(new Date(`${isoDate}T12:00:00Z`).getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(`${isoDate}T12:00:00Z`));
}

function monthLabel(isoDate) {
  if (!isoDate || !Number.isFinite(new Date(`${isoDate}T12:00:00Z`).getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" })
    .format(new Date(`${isoDate}T12:00:00Z`));
}

function calendarMonthRange(isoDate) {
  const start = new Date(`${isoDate.slice(0, 7)}-01T12:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function initials(displayName) {
  return displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function firstName(displayName) {
  return displayName.split(/\s+/)[0];
}

function renderPersonAvatar({ slug, name, initials: avatarInitials, image }) {
  const safeSlug = escapeHtml(slug);
  const safeInitials = escapeHtml(avatarInitials || initials(name));
  const imageMarkup = image
    ? `<img src="${escapeHtml(image)}" alt="" data-profile-image />`
    : "";
  const fallbackHidden = image ? " hidden" : "";

  return `<span class="person-avatar person-avatar--${safeSlug}" aria-hidden="true">
    ${imageMarkup}
    <span class="person-avatar-fallback"${fallbackHidden}>${safeInitials}</span>
  </span>`;
}

function renderTeamAvatar() {
  return `<span class="person-avatar person-avatar--team" aria-hidden="true">
    <svg viewBox="0 0 24 24" focusable="false">
      <circle cx="8" cy="9" r="2.4"></circle>
      <circle cx="16" cy="9" r="2.4"></circle>
      <path d="M3.8 17c.4-2.7 2-4.1 4.2-4.1s3.8 1.4 4.2 4.1"></path>
      <path d="M11.8 17c.4-2.7 2-4.1 4.2-4.1s3.8 1.4 4.2 4.1"></path>
    </svg>
  </span>`;
}

function renderDashboardAvatar(slug, name) {
  if (slug === "team") return renderTeamAvatar();
  return renderPersonAvatar({
    slug,
    name,
    initials: PROFILE_INITIALS[slug],
    image: PROFILE_IMAGES[slug],
  });
}

function enableProfileImageFallbacks(container) {
  container.querySelectorAll("[data-profile-image]").forEach((image) => {
    const fallback = image.nextElementSibling;
    const showFallback = () => {
      image.hidden = true;
      if (fallback) fallback.hidden = false;
    };

    image.addEventListener("error", showFallback, { once: true });
    if (image.complete && image.naturalWidth === 0) showFallback();
  });
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function canViewAntony() {
  return state.status === "preview" || hasAntonyDashboardAccess(state.profile);
}

function canViewWeeklyReview() {
  return state.status === "preview" || hasWeeklyReviewAccess(state.profile);
}

function canViewThreeMonthReview() {
  return state.period === "month" && ["team", "michael", "felix"].includes(state.view);
}

// --- Daten laden -------------------------------------------------------------

// Eine Zeile aus get_dashboard_metrics auf die Namen bringen, die die Ansicht
// nutzt. Die Quoten kommen aus der Datenbank, nicht aus dem Browser.
function toPerson(row) {
  return {
    slug: row.slug,
    displayName: row.display_name,
    color: row.color,
    callsGross: Number(row.calls_gross),
    callsNet: Number(row.calls_net),
    netRate: Number(row.net_rate),
    talkMinutes: Number(row.talk_seconds) / 60,
    gatekeeper: Number(row.gatekeeper_contacts),
    connected: Number(row.connected_calls),
    connectionRate: Number(row.gatekeeper_contacts) > 0 ? Number(row.connection_rate) : null,
    directDecisionMakers: Number(row.direct_decision_maker_calls),
    decisionMakers: Number(row.decision_maker_contacts),
    appointments: Number(row.appointments),
    appointmentRate: Number(row.appointment_rate),
    mailbox: Number(row.mailbox_calls ?? 0),
    outsideBusinessHours: Number(row.outside_business_hours_calls ?? 0),
    dealsWon: Number(row.deals_won),
    winRate: Number(row.win_rate),
    revenue: Number(row.revenue_cents),
    newsletters: row.newsletters === null ? null : Number(row.newsletters),
  };
}

let refreshRevision = 0;
async function loadAll(revision = refreshRevision) {
  const period=state.period,referenceDate=state.referenceDate,view=state.view,antonyAccess=canViewAntony() && view === "antony";
  const plannerPeriodRange=calendarMonthRange(referenceDate),goalsRange=goalPeriodRange(period,referenceDate);
  const metricRequest=data.loadMetrics(period,referenceDate);
  const [people,metricRows,hourRows,trends,trendHours,weeklyReview,report,plannerMetricRows,antonyGoal,transferBreakdown] = await Promise.all([
    data.loadPeople(),metricRequest,data.loadHourPerformance(period,referenceDate),
    period === "month" ? data.loadTrends() : [],
    period === "month" ? data.loadHourPerformance("trend",referenceDate) : [],
    antonyAccess && canViewWeeklyReview() ? data.loadLatestWeeklyReview().catch(()=>null) : null,
    antonyAccess ? data.loadAntonyReport(period,referenceDate) : null,
    !antonyAccess ? [] : period === "month" ? metricRequest : data.loadMetrics("month",referenceDate),
    antonyAccess ? data.loadAntonyGoal("month",plannerPeriodRange.start) : null,
    data.loadTransferBreakdown(period,referenceDate),
  ]);
  const first=metricRows[0],periodRange=first?{start:first.period_start,end:first.period_end}:{start:referenceDate,end:referenceDate};
  const [series,targets,syncRun]=await Promise.all([
    data.loadDailySeries(periodRange.start,periodRange.end),data.loadTargets(goalsRange.start,goalsRange.end),
    state.profile.role === "operator" ? data.loadLatestSyncRun() : null,
  ]);
  // Never overwrite a newer selection or resurrect data after logout.
  if(revision !== refreshRevision || period !== state.period || referenceDate !== state.referenceDate || view !== state.view)return false;
  const metrics=Object.fromEntries(metricRows.map(row=>[row.slug,toPerson(row)]));
  for(const person of people){
    const m=metrics[person.slug];if(!m)continue;
    const own=hourRows.filter(row=>row.slug===person.slug);
    m.mailbox=own.reduce((n,row)=>n+Number(row.mailbox_calls??0),0);
    m.outsideBusinessHours=own.reduce((n,row)=>n+Number(row.outside_business_hours_calls??0),0);
  }
  const times=series.map(row=>row.calculated_at).filter(Boolean).sort();
  Object.assign(state,{
    people,metrics,hours:hourRows,trends,trendHours,weeklyReview,series,targets,periodRange,syncRun,transferBreakdown,
    closing:report?.closing??null,antonyProcess:report?.process??null,
    antonyPipeline:report?.pipeline??null,antonyPerformance:report?.performance??[],
    antonyPlannerMetrics:Object.fromEntries(plannerMetricRows.map(row=>[row.slug,toPerson({...row,
      appointments:report?.planner?.appointment_by_owner?.[row.slug]??0})])),
    antonyPlannerClosing:report?.planner?.closing??null,antonyPlannerProcess:report?.planner?.process??null,
    antonyPlannerPeriodRange:plannerPeriodRange,antonyGoal,
    antonyCustomerValueCents:Number(antonyGoal?.customer_value_cents??0),
    antonyRateMode:antonyGoal && [antonyGoal.appointment_to_closer_rate_override,antonyGoal.show_rate_override,antonyGoal.closing_rate_override,antonyGoal.decision_rate_override,antonyGoal.confirmation_rate_override].some(v=>v!=null)?"custom":"current",
    lastCalculated:times.at(-1)??null,
  });
  return true;
}

// --- Ziele -------------------------------------------------------------------

// Brutto-Ziele gelten für den ganzen Tag, die ganze Arbeitswoche oder den
// ganzen Monat. Das anteilige Soll bis zum Stichtag steuert nur die Ampelfarbe.
function callGoalRange(elapsed = false) {
  const range = goalPeriodRange(state.period, state.referenceDate);
  return elapsed && range.end > state.referenceDate ? { ...range, end: state.referenceDate } : range;
}

function targetFor(personId, column, elapsed = false) {
  const range = column === "calls_gross" ? callGoalRange(elapsed) : state.periodRange;
  return salesTargetForRange(state.targets, personId, column, range);
}

function callGoalCopy(personId) {
  const full = targetFor(personId, "calls_gross");
  if (full === null) return "kein Ziel";
  const label = { day: "Tagesziel", week: "Wochenziel", month: "Monatsziel" }[state.period] || "Ziel";
  const elapsed = targetFor(personId, "calls_gross", true);
  const pace = elapsed !== null && elapsed < full
    ? ` · Soll bis ${germanDate(state.referenceDate)}: ${number(elapsed)}` : "";
  return `${label} ${number(full)}${pace}`;
}

function callGoalTooltip(personId) {
  const elapsed = targetFor(personId, "calls_gross", true);
  return elapsed === null ? "Kein Werktagsziel im gewählten Zeitraum."
    : `Farbe bis zum Stichtag: unter ${number(elapsed * 2 / 3)} rot, ab ${number(elapsed * 2 / 3)} gelb, ab ${number(elapsed)} grün. Grundlage: 100 / 150 Brutto-Anrufe je Montag bis Freitag und Person.`;
}

function metricPerformanceClass(key, value, target, personId) {
  if (key === "callsGross") return grossCallPerformanceClass(value, targetFor(personId, "calls_gross", true));
  return performanceClass(value === null || target === null ? null : attainment(value, target));
}

function metricTarget(metric, personId) {
  if (metric.rateTarget) return targetFor(personId, metric.rateTarget);
  if (metric.target) return targetFor(personId, metric.target);
  return null;
}

function attainment(value, target) {
  if (!target) return null;
  return Math.min(130, (value / target) * 100);
}

// Ohne hinterlegtes Ziel bleibt eine Zahl neutral. Sie rot zu färben würde
// behaupten, sie sei zu niedrig — dafür fehlt die Grundlage.
function performanceClass(score) {
  if (score === null) return "is-neutral";
  if (score >= 100) return "is-strong";
  if (score >= 70) return "is-ok";
  return "is-weak";
}

// --- Rendern -----------------------------------------------------------------

// Vier Werte tragen die erste Ebene. Alles andere ist eine Ebene tiefer
// erreichbar, statt gleichzeitig um Aufmerksamkeit zu konkurrieren.
const CORE_KEYS = ["callsGross", "callsNet", "netRate", "decisionMakers", "appointments", "appointmentRate"];

function coreMetrics() {
  return CORE_KEYS.map((key) => metricDefinitions.find((metric) => metric.key === key));
}

const DETAIL_ORDER = [
  "mailbox", "outsideBusinessHours", "gatekeeper", "connected", "connectionRate", "directDecisionMakers",
  "newsletters",
];

function detailMetrics() {
  const rest = metricDefinitions.filter((metric) => !CORE_KEYS.includes(metric.key));
  return rest.slice().sort((a, b) => {
    const ia = DETAIL_ORDER.indexOf(a.key);
    const ib = DETAIL_ORDER.indexOf(b.key);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

const SAMMELANSICHTEN = new Set(["team", "chef", "betrieb"]);

// In einer Personenansicht bleibt nur diese Person übrig — samt Diagrammen,
// Trichter und Stundenprofil. Vorher liefen alle drei Blöcke gedimmt mit, und
// jede Ansicht zeigte am Ende dieselben Zahlen.
function orderedPeople() {
  const mitDaten = state.people.filter((person) => state.metrics[person.slug]);
  if (state.view === "antony") return [];
  if (SAMMELANSICHTEN.has(state.view)) return mitDaten;
  const eigene = mitDaten.filter((person) => person.slug === state.view);
  return eigene.length > 0 ? eigene : mitDaten;
}

function periodCaption() {
  const { start, end } = state.periodRange;
  if (!start) return "";
  if (state.period === "day") return germanDate(start);
  if (state.period === "month") return monthLabel(start);
  return `${germanDate(start)} – ${germanDate(end)}`;
}

function renderNav() {
  const buttons = [`<button class="nav-button nav-button--person" data-view="team">${renderTeamAvatar()}<span>Team</span></button>`];
  state.people.forEach((person) => {
    const profileInitials = PROFILE_INITIALS[person.slug];
    const label = escapeHtml(firstName(person.display_name));
    if (!profileInitials) {
      buttons.push(`<button class="nav-button" data-view="${escapeHtml(person.slug)}">${label}</button>`);
      return;
    }
    const avatar = renderPersonAvatar({
      slug: person.slug,
      name: person.display_name,
      initials: profileInitials,
      image: PROFILE_IMAGES[person.slug],
    });
    buttons.push(`<button class="nav-button nav-button--person" data-view="${escapeHtml(person.slug)}">${avatar}<span>${label}</span></button>`);
  });
  if (canViewAntony()) {
    const antonyAvatar = renderPersonAvatar({
      slug: "antony",
      name: "Antony Rigone",
      initials: PROFILE_INITIALS.antony,
      image: PROFILE_IMAGES.antony,
    });
    buttons.push(`<button class="nav-button nav-button--person" data-view="antony">${antonyAvatar}<span>Antony</span></button>`);
  }

  const navigation = document.querySelector(".view-nav");
  navigation.innerHTML = buttons.join("");
  enableProfileImageFallbacks(navigation);
}

function renderHeader() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  document.querySelectorAll("[data-period]").forEach((button) => {
    button.classList.toggle("active", button.dataset.period === state.period);
  });

  const person = state.people.find((entry) => entry.slug === state.view);
  const copy = viewCopy[state.view] ?? [
    "Persönliche Ansicht",
    `${person ? firstName(person.display_name) : "Person"} im Fokus`,
    "Der eigene Fortschritt prominent, das Team bleibt als Vergleich sichtbar.",
  ];

  document.querySelector("#view-kicker").textContent = copy[0];
  document.querySelector("#page-title").textContent = copy[1];
  document.querySelector("#view-description").textContent = copy[2];
  document.querySelector("#core-note").textContent = periodCaption();
  document.querySelector("#footer-context").textContent = `Zeitraum: ${periodLabels[state.period]} · ${periodCaption()}`;

  if (state.widget) {
    if (state.widget === "trend") {
      document.querySelector("#widget-trend").hidden = !canViewThreeMonthReview();
    }
    return;
  }
  const antonyView = state.view === "antony";
  [
    "#widget-kernwerte", "#widget-verlauf", "#dashboard-analysis-row",
    "#widget-details",
  ].forEach((selector) => {
    document.querySelector(selector).hidden = antonyView;
  });
  document.querySelector("#widget-trend").hidden = !canViewThreeMonthReview();
  document.querySelector("#antony-section").hidden = !antonyView;

  const role = state.profile.role;
  const leads = role === "manager" || role === "operator";
  document.querySelector("#manager-section").hidden = true;
  document.querySelector("#operations-section").hidden = state.view !== "betrieb" || role !== "operator";
}

// Gewichtet aus den Kernwerten. Ohne Ziele gibt es keine Zielerreichung.
function weightedScore(metrics, salesPersonId) {
  const parts = [
    ["callsNet", "calls_net", 0.35],
    ["decisionMakers", "decision_maker_contacts", 0.3],
    ["appointments", "appointments", 0.35],
  ];
  let score = 0;
  let weightUsed = 0;
  for (const [key, column, weight] of parts) {
    const target = targetFor(salesPersonId, column);
    if (!target) continue;
    score += Math.min(1.2, metrics[key] / target) * weight;
    weightUsed += weight;
  }
  return weightUsed === 0 ? null : Math.round((score / weightUsed / 1.2) * 100);
}

function teamEntry() {
  const people = orderedPeople();
  if (people.length < 2) return null;
  const sum = (key) => people.reduce((total, person) => total + (state.metrics[person.slug][key] ?? 0), 0);
  const metrics = {
    callsGross: sum("callsGross"), callsNet: sum("callsNet"), talkMinutes: sum("talkMinutes"),
    gatekeeper: sum("gatekeeper"), connected: sum("connected"),
    directDecisionMakers: sum("directDecisionMakers"), decisionMakers: sum("decisionMakers"),
    appointments: sum("appointments"), mailbox: sum("mailbox"),
    outsideBusinessHours: sum("outsideBusinessHours"),
    newsletters: people.every((person) => state.metrics[person.slug].newsletters === null) ? null : sum("newsletters"),
  };
  // Team-Quoten aus den Summen, nicht als Mittel der Einzelquoten — sonst zählte
  // jemand mit wenigen Gesprächen genauso schwer wie jemand mit vielen.
  metrics.netRate = safeRate(metrics.callsNet, metrics.callsGross);
  metrics.connectionRate = metrics.gatekeeper > 0 ? safeRate(metrics.connected, metrics.gatekeeper) : null;
  metrics.appointmentRate = safeRate(metrics.appointments, metrics.decisionMakers);
  return { slug: "team", label: "Team", color: "#9fb4d0", targetId: people.map((p) => p.id), metrics };
}

function boardEntries() {
  const entries = orderedPeople().map((person) => ({
    slug: person.slug,
    label: firstName(person.display_name),
    color: person.color,
    targetId: person.id,
    metrics: state.metrics[person.slug],
  }));
  const team = teamEntry();
  if (team) entries.push(team);
  return entries;
}

// --- Kernwerte ---------------------------------------------------------------

function renderCore() {
  const coreGrid = document.querySelector("#core-grid");
  coreGrid.innerHTML = boardEntries().map((entry) => {
    const values = coreMetrics().map((metric) => {
      const value = entry.metrics[metric.key];
      // metricTarget behandelt zielfreie Kennzahlen bereits richtig. Die
      // Detailansicht nutzt es, die Kernwerte taten es nicht — deshalb brach
      // hier alles ab, sobald eine Kennzahl ohne Ziel nach oben rückte.
      const target = metricTarget(metric, entry.targetId);
      const tone = metricPerformanceClass(metric.key, value, target, entry.targetId);
      return `
        <div class="core-value ${tone}">
          <span class="core-label">${metric.label}</span>
          <strong>${metric.format(value)}</strong>
        </div>`;
    }).join("");

    return `
      <article class="core-card" style="--person-color:${safeColor(entry.color)}">
        <header>
          <span class="core-identity">
            ${renderDashboardAvatar(entry.slug, entry.label)}
            <span class="core-name">${escapeHtml(entry.label)}</span>
          </span>
        </header>
        <div class="core-values">${values}</div>
      </article>`;
  }).join("");
  enableProfileImageFallbacks(coreGrid);
}

function storedAntonyGoal(row = state.antonyGoal) {
  if (!row) return {};
  return {
    targetNewCustomers: Number(row.target_new_customers ?? 0),
    targetRevenueCents: Number(row.target_revenue_cents ?? 0),
    customerValueCents: Number(row.customer_value_cents ?? 0),
    appointmentToCloserRateOverride: row.appointment_to_closer_rate_override == null
      ? null
      : Number(row.appointment_to_closer_rate_override),
    showRateOverride: row.show_rate_override == null ? null : Number(row.show_rate_override),
    closingRateOverride: row.closing_rate_override == null ? null : Number(row.closing_rate_override),
    decisionRateOverride: row.decision_rate_override == null ? null : Number(row.decision_rate_override),
    confirmationRateOverride: row.confirmation_rate_override == null ? null : Number(row.confirmation_rate_override),
  };
}

function plannerNumber(form, name) {
  const raw = String(new FormData(form).get(name) ?? "").trim();
  return raw === "" ? null : Number(raw);
}

function goalForAntonyRateMode(goal) {
  if (state.antonyRateMode === "custom") return goal;
  return {
    ...goal,
    appointmentToCloserRateOverride: null,
    showRateOverride: null,
    closingRateOverride: null,
    decisionRateOverride: null,confirmationRateOverride: null,
  };
}

function plannerGoalFromForm() {
  const form = document.querySelector("#antony-plan-form");
  const targetRevenueCents = Math.round((plannerNumber(form, "target_revenue_eur") ?? 0) * 100);
  const customerValueCents = Number(state.antonyCustomerValueCents ?? 0);
  return goalForAntonyRateMode({
    targetNewCustomers: customerValueCents > 0 ? Math.ceil(targetRevenueCents / customerValueCents) : 0,
    targetRevenueCents,
    customerValueCents,
    rateMode: state.antonyRateMode,
    appointmentToCloserRateOverride: plannerNumber(form, "appointment_to_closer_rate_override"),
    showRateOverride: plannerNumber(form, "show_rate_override"),
    closingRateOverride: plannerNumber(form, "closing_rate_override"),
    decisionRateOverride: plannerNumber(form,"decision_rate_override"),confirmationRateOverride: plannerNumber(form,"confirmation_rate_override"),
  });
}

function antonyActuals(metrics = state.metrics, closingRow = state.closing) {
  const michael = Number(metrics.michael?.appointments ?? 0);
  const felix = Number(metrics.felix?.appointments ?? 0);
  const closing = closingRow ?? {};
  return {
    michaelAppointments: michael,
    felixAppointments: felix,
    appointments: Number(closing.appointments ?? michael + felix),
    closerAppointments: Number(closing.setter_successes ?? 0),
    closerCalls: Number(closing.closer_calls ?? 0),
    decidedCloserCalls: Number(closing.decided_closer_calls ?? 0),
    sales: Number(closing.closer_sales ?? 0),
    newCustomers: Number(closing.new_customers ?? 0),
  };
}

function antonyPlannerActuals() {
  return {...antonyActuals(state.antonyPlannerMetrics,state.antonyPlannerClosing),
    journey:totalCounts(state.antonyPlannerProcess?.funnel_by_source,JOURNEY_KEYS)};
}

function plannerPeriodEnd() {
  return state.antonyPlannerPeriodRange.end;
}

function antonyMonthProgress() {
  const start = state.antonyPlannerPeriodRange.start;
  const end = state.antonyPlannerPeriodRange.end;
  if (!start || !end) return { elapsed: 0, remaining: 0, total: 0 };
  const cutoff = [state.referenceDate, berlinToday()].sort()[0];
  const progressDate = cutoff < start
    ? null
    : (cutoff > end ? end : cutoff);
  const total = workdaysBetween(start, end);
  const elapsed = progressDate ? workdaysBetween(start, progressDate) : 0;
  return { elapsed, remaining: Math.max(0, total - elapsed), total };
}

function remainingPlannerWorkdays() {
  return antonyMonthProgress().remaining;
}

function canSaveAntonyGoal() {
  return canViewAntony();
}

function renderAntonyCustomerValue() {
  const input=document.querySelector("#antony-ist-customer-value");
  if(document.activeElement!==input) input.value=state.antonyCustomerValueCents>0?state.antonyCustomerValueCents/100:"";
}

function renderAntonyMonthProjection(goal) {
  const actual=antonyPlannerActuals();
  const forecast=calculateAntonyMonthForecast({journey:actual.journey,customerValueCents:goal.customerValueCents,plannedFirstMeetings:state.antonyPlannerProcess?.month_planning?.first_meetings});
  const rates=forecast.currentRates;
  const rows=[['Ersttermine im Monat',forecast.projectedAppointments],['Mögliche Closer Calls',forecast.projectedCloserCalls],['Mögliche Neukunden',forecast.projectedCustomers]];
  document.querySelector('#antony-month-projection').innerHTML=`
    <div class="antony-plan-lead"><span>Monatsprognose · ${monthLabel(state.antonyPlannerPeriodRange.start)}</span><strong>Aus der aktuellen Monatspipeline</strong></div>
    <div class="antony-month-projection-values">${rows.map(([label,value],i)=>`<div><span>${label}</span><strong>${value===null?'—':(i?'≈ ':'')+decimal(value)}</strong></div>`).join('')}
      <div><span>Rechnerischer Umsatz</span><strong>${forecast.projectedRevenueCents===null?'—':'≈ '+euros(forecast.projectedRevenueCents)}</strong></div></div>
    <p class="antony-plan-pace">${number(forecast.elapsedAppointments)} fällige Ersttermine + ${forecast.plannedFirstMeetings===null?'—':number(forecast.plannedFirstMeetings)} noch anstehende Ersttermine im gewählten Monat. Jeder Vorgang zählt einmal. Verschobene Ersttermine zählen im Monat ihres gültigen Termindatums.</p>
    <div class="antony-plan-rates">${[['Termin → Closer',rates.appointmentToCloser],['Durchführung / Terminierung',rates.show],['Entscheidung',rates.decision],['Closing',rates.closing],['Bestätigung in Close',rates.confirmation]].map(([label,value])=>`<span><b>${value===null?'—':decimal(value)+' %'}</b> ${label}<small>${value===null?'Grundgesamtheit fehlt':'belegte Monatskohorte'}</small></span>`).join('')}</div>
    <p class="antony-plan-pace">${forecast.projectedCustomers===null?'Noch keine belastbare Monatsprognose: Es fehlen belegte Übergänge in dieser Monatskohorte.':'Modell: Ersttermine dieses Monats × die belegten Übergangsquoten derselben Kohorte. Vorläufig; offene Vorgänge können die Quoten verändern.'} Ältere Closer Calls fließen nicht ein. Zukunftstermine liefern keine Ist-Quote; die Aussagekraft steigt mit abgeschlossenen Vorgängen. ${goal.customerValueCents>0?'Umsatz = mögliche Neukunden × eingegebener Kundenwert.':'Für den rechnerischen Umsatz den Kundenwert eintragen.'} Eigene Simulationsraten ändern diese Prognose nicht.</p>`;
}

function renderAntonyPlannerResults(goal) {
  renderAntonyMonthProjection(goal);
  const container = document.querySelector("#antony-plan-results");
  const actual = antonyPlannerActuals();
  const plan = calculateAntonyPlan({ actual, goal });
  const plannerMonth = monthLabel(state.antonyPlannerPeriodRange.start);

  if (plan.requiredCustomers <= 0 || Number(goal.customerValueCents) <= 0) {
    container.innerHTML = `<p class="antony-plan-empty">Oben den Kundenwert eintragen und hier den Wunschumsatz wählen – die gesamte Leistungskette aktualisiert sich sofort.</p>`;
    return;
  }

  const blockingRates = [
    ["Termin → Closer-Termin", plan.effectiveRates.appointmentToCloser],
    ["Durchführung / Terminierung", plan.effectiveRates.show],
    ["Closingrate", plan.effectiveRates.closing],
    ["Entscheidungsquote",plan.effectiveRates.decision],["Bestätigung in Close",plan.effectiveRates.confirmation],
  ].filter(([, value]) => value === null || value <= 0).map(([label, value]) => value === 0 ? `${label} (aktuell 0 %)` : label);

  const targetParts = [`${number(plan.requiredCustomers)} Neukunden`, euros(goal.targetRevenueCents)];

  const achieved = plan.cohortActuals;
  const pipeline = [
    ["Vorgänge mit Ersttermin", plan.requiredAppointments, achieved.appointments],
    ["Zum Closer qualifiziert", plan.requiredCloserAppointments, achieved.closerAppointments],
    ["Vorgänge mit Closer Call",plan.requiredCloserCalls,achieved.closerCalls],
    ["Entschiedene Closer Calls", plan.requiredDecidedCloserCalls, achieved.decidedCloserCalls],
    ["Verkäufe im Gespräch",plan.requiredSales,achieved.sales],
    ["Neukunden gesamt", plan.requiredCustomers, achieved.newCustomers],
  ];
  const pipelineMarkup = pipeline.map(([label, required, achieved]) => {
    const progress = required > 0 && achieved !== null ? Math.min(100, (achieved / required) * 100) : 0;
    const gap = achieved === null || required === null ? null : Math.max(0, required - achieved);
    return `
      <article class="antony-plan-step">
        <span>${label}</span>
        <strong>${required === null ? "—" : number(required)}</strong>
        <small>${achieved === null ? "—" : number(achieved)} aus der Startgruppe · ${gap === null ? "Rate oder Ist-Basis fehlt" : gap > 0 ? `noch ${number(gap)}` : "Zielmenge erreicht"}</small>
        <span class="antony-plan-track"><i style="width:${progress}%"></i></span>
      </article>`;
  }).join("");

  const rates = [
    ["Termin → Closer", plan.effectiveRates.appointmentToCloser, goal.appointmentToCloserRateOverride],
    ["Durchführung / Terminierung", plan.effectiveRates.show, goal.showRateOverride],
    ["Closingrate", plan.effectiveRates.closing, goal.closingRateOverride],
    ["Entscheidungsquote",plan.effectiveRates.decision,goal.decisionRateOverride],["Bestätigung in Close",plan.effectiveRates.confirmation,goal.confirmationRateOverride],
  ].map(([label, value, override]) => `
    <span><b>${value === null ? "—" : decimal(value)+" %"}</b> ${label}<small>${state.antonyRateMode === "custom" ? "Simulation" : "belegt"}</small></span>`).join("");

  const workdays = remainingPlannerWorkdays();
  const anchor = state.referenceDate === berlinToday() ? "Ab dem nächsten Arbeitstag" : `Nach dem ${germanDate(state.referenceDate)}`;
  const pace = workdays > 0
    ? `${anchor} bleiben ${number(workdays)} Arbeitstage: Ø ${decimal(plan.gaps.appointments / workdays)} Vorgänge mit Ersttermin und Ø ${decimal(plan.gaps.closerAppointments / workdays)} zum Closer qualifizierte Vorgänge pro Arbeitstag.`
    : `Der gewählte Zeitraum enthält ab dem Stichtag keine weiteren Arbeitstage. Offen bleiben ${number(plan.gaps.appointments)} Vorgänge mit Ersttermin und ${number(plan.gaps.customers)} Neukunden.`;

  container.innerHTML = `
    <div class="antony-plan-lead">
      <span>${state.antonyRateMode === "custom" ? "Simulation · eigene Annahmen" : "Monatsziel · belegte Raten"} · ${plannerMonth}</span>
      <strong>${targetParts.join(" · ")}</strong>
      <small>${number(plan.requiredCustomers)} Neukunden ergeben sich automatisch aus Wunschumsatz ÷ Kundenwert. Fortschritt und Raten beziehen sich auf dieselbe Startgruppe mit Ersttermin in diesem Monat.</small>
    </div>
    ${blockingRates.length ? `<p class="planner-basis-missing">Keine belastbare Rückwärtsrechnung: ${escapeHtml(blockingRates.join(", "))}. Die Ist-Zahlen bleiben sichtbar. Für eine Simulation „Eigene Raten“ wählen und Annahmen eingeben.</p>` : ""}
    <div class="antony-plan-chain">${pipelineMarkup}</div>
    <div class="antony-plan-rates">${rates}</div>
    ${blockingRates.length ? "" : `<p class="antony-plan-pace">${pace}</p>`}`;
}

function renderAntonyPlanner() {
  const planner = document.querySelector("#antony-planner");
  const form = document.querySelector("#antony-plan-form");
  const storedGoal = storedAntonyGoal();
  const actualPlan = calculateAntonyPlan({ actual: antonyPlannerActuals(), goal: {} });
  const setValue = (name, value) => {
    form.elements[name].value = value === null || value === undefined ? "" : value;
  };

  planner.open = state.plannerOpen;
  const inheritedRevenue = storedGoal.targetRevenueCents > 0
    ? storedGoal.targetRevenueCents
    : storedGoal.targetNewCustomers * state.antonyCustomerValueCents;
  const targetRevenueEur = inheritedRevenue > 0 ? inheritedRevenue / 100 : 40_000;
  const revenueInput = form.elements.target_revenue_eur;
  revenueInput.max = String(Math.max(200_000, Math.ceil(targetRevenueEur / 10_000) * 10_000));
  setValue("target_revenue_eur", targetRevenueEur);
  setValue("appointment_to_closer_rate_override", storedGoal.appointmentToCloserRateOverride ?? actualPlan.currentRates.appointmentToCloser ?? "");
  setValue("show_rate_override", storedGoal.showRateOverride ?? actualPlan.currentRates.show ?? "");
  setValue("closing_rate_override", storedGoal.closingRateOverride ?? actualPlan.currentRates.closing ?? "");

  document.querySelector("#current-appointment-to-closer-rate").textContent = actualPlan.currentRates.appointmentToCloser === null
    ? "Aktuell noch keine belastbare Basis"
    : `Aktuell ${decimal(actualPlan.currentRates.appointmentToCloser)} %`;
  document.querySelector("#current-show-rate").textContent = actualPlan.currentRates.show === null
    ? "Aktuell noch keine belastbare Basis"
    : `Aktuell ${decimal(actualPlan.currentRates.show)} %`;
  document.querySelector("#current-closing-rate").textContent = actualPlan.currentRates.closing === null
    ? "Aktuell noch keine belastbare Basis"
    : `Aktuell ${decimal(actualPlan.currentRates.closing)} %`;

  for(const [name,key] of [["decision","decision"],["confirmation","confirmation"]]) {
    setValue(name+"_rate_override",storedGoal[key+"RateOverride"]??actualPlan.currentRates[key]??"");
    document.querySelector("#current-"+name+"-rate").textContent=actualPlan.currentRates[key]===null?"Noch keine Grundgesamtheit":`Aktuell ${decimal(actualPlan.currentRates[key])} %`;
  }
  renderAntonyRateMode();

  const save = document.querySelector("#antony-plan-save");
  save.hidden = !canSaveAntonyGoal();
  document.querySelector("#antony-plan-status").textContent = canSaveAntonyGoal()
    ? ""
    : "Rechnen ist ohne Speichern möglich. Speichern kann Antony oder die Dashboard-Leitung.";
  const formGoal = plannerGoalFromForm();
  renderAntonyRangeOutputs(formGoal);
  renderAntonyPlannerResults(formGoal);
}

function rateOutput(value) { return value === "" ? "Annahme eingeben" : `${number(value)} %`; }

function renderAntonyRangeOutputs(goal) {
  const form = document.querySelector("#antony-plan-form");
  document.querySelector("#antony-target-revenue-output").textContent = euros(goal.targetRevenueCents);
  document.querySelector("#antony-derived-customer-target").textContent = state.antonyCustomerValueCents > 0
    ? `entspricht ${number(goal.targetNewCustomers)} Neukunden bei ${euros(state.antonyCustomerValueCents)} Kundenwert`
    : "Für die Neukundenberechnung zuerst oben den Kundenwert eintragen.";
  document.querySelector("#antony-appointment-rate-output").textContent = rateOutput(form.elements.appointment_to_closer_rate_override.value);
  document.querySelector("#antony-show-rate-output").textContent = rateOutput(form.elements.show_rate_override.value);
  for(const key of ["decision","confirmation"])document.querySelector("#antony-"+key+"-rate-output").textContent=rateOutput(form.elements[key+"_rate_override"].value);
  document.querySelector("#antony-closing-rate-output").textContent = rateOutput(form.elements.closing_rate_override.value);
}

function renderAntonyRateMode() {
  const customMode = state.antonyRateMode === "custom";
  document.querySelectorAll("[data-antony-rate-mode]").forEach((button) => {
    const active = button.dataset.antonyRateMode === state.antonyRateMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelector("#antony-custom-rates").hidden = !customMode;
  document.querySelector("#antony-rate-mode-copy").textContent = customMode
    ? "Simulation: Alle eingetragenen Raten sind eigene Annahmen. Leere Felder bitte ausfüllen; Ist-Daten bleiben unverändert."
    : "Dieselben Vorgänge mit Ersttermin im Monat. Offene Fälle begrenzen die Aussagekraft.";
}

// Antony ist eine eigene Arbeitsansicht. Die Mengen stammen vollständig aus
// der geschützten Datenbankfunktion; die Kreise setzen nur die zugehörigen
// Zähler und Nenner ins Verhältnis und zeigen die Basis direkt daneben.
function processRate(n, d, label = "") {
  const ratio = transition(n, d);
  const rate = ratio.rate === null ? "—" : `${decimal(ratio.rate)} %`;
  const basis = ratio.numerator === null || ratio.denominator === null ? "Daten fehlen" : `${number(ratio.numerator)} von ${number(ratio.denominator)}${label ? ` ${label}` : ""}`;
  return `<span class="process-rate"><b>${rate}</b><span>${escapeHtml(basis)}</span></span>`;
}

function renderAntony() {
  const container = document.querySelector("#antony-donuts");
  const profile = document.querySelector("#antony-profile-avatar");
  profile.innerHTML = renderDashboardAvatar("antony", "Antony Rigone");
  enableProfileImageFallbacks(profile);
  const p=state.antonyProcess;
  const cards=activityCards(state.closing,p);
  container.innerHTML=cards.length?cards.map(({label,value,details,note})=>`<button type="button" class="antony-activity" data-chart-point="${escapeHtml(JSON.stringify({title:label,time:periodCaption(),rows:details,note}))}"><span>${escapeHtml(label)}</span><strong>${value == null ? "—" : number(value)}</strong><span class="activity-detail-icon" aria-hidden="true">↗</span></button>`).join(""):'<p>Kennzahlen für diesen Zeitraum nicht verfügbar.</p>';
  document.querySelector("#antony-note").textContent="Aktivitäten im Zeitraum · einschließlich älterer Vorgänge. Details per Klick.";
  const dataTime=p?.setter_attendance?.data_as_of||state.antonyPipeline?.data_as_of;
  document.querySelector("#antony-data-time").textContent=dataTime?`Datenstand ${new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(dataTime))}`:"Aktivitäten im gewählten Zeitraum";
  document.querySelector("#antony-origin-title").textContent=`Monats-Pipeline · ${monthLabel(state.antonyPlannerPeriodRange.start)}`;
  document.querySelector("#antony-origin-pipelines").innerHTML=renderProcessPipeline(state.antonyPlannerProcess);
  renderAntonyProcess();
  renderAntonyPerformance(); renderUpcomingMeetings(); renderAntonyCustomerValue(); renderAntonyPlanner(); renderKpiAssistant();
}

const antonyPerformanceSeries = Object.freeze([
  { key: "appointments_cumulative", label: "Termine", color: "#3b9dff" },
  { key: "setter_calls_cumulative", label: "Setter durchgeführt", color: "#4ac7df" },
  { key: "closer_appointments_cumulative", label: "Closer terminiert", color: "#9b8cff" },
  { key: "closer_calls_cumulative", label: "Closer durchgeführt", color: "#36d399" },
  { key: "cc2_agreed_cumulative", label: "CC2 vereinbart", color: "#f5a524" },
  { key: "new_customers_cumulative", label: "Neukunden", color: "#91d960" },
]);

function renderAntonyPerformance() {
  const chart = document.querySelector("#antony-performance-chart");
  const note = document.querySelector("#antony-performance-note");
  const period = document.querySelector("#antony-performance-period");
  const timeline=state.antonyProcess?.timeline || [];
  const hasFirstQualifications=timeline.some(point=>Object.hasOwn(point,"first_qualified")) || state.antonyProcess?.flow?.first_qualified === 0;
  const rows = (Array.isArray(state.antonyPerformance) ? state.antonyPerformance : []).map(row=>{
    const matching=timeline.filter(point=>state.period === "day" ? point.date===row.bucket_date && point.hour_bucket<=row.metric_hour : point.date<=row.bucket_date);
    return {...row,...Object.fromEntries(["setter_calls","cc2_agreed","closer_sales"].map(key=>[key+"_cumulative",matching.reduce((n,point)=>n+Number(point[key]??0),0)])),
      ...(hasFirstQualifications?{closer_appointments_cumulative:matching.reduce((n,point)=>n+Number(point.first_qualified??0),0)}:{})};
  });
  period.textContent = periodCaption();

  if (rows.length < 2) {
    chart.innerHTML = `<p class="antony-analysis-empty">Für diesen Zeitraum liegen noch nicht genug Zeitpunkte für einen Verlauf vor.</p>`;
    note.textContent = "Die Kennzahlen oben bleiben verfügbar. Der Verlauf erscheint ab zwei Zeitpunkten.";
    return;
  }

  const visibleSeries = antonyPerformanceSeries.filter((series) =>
    state.period !== "day" || series.key !== "new_customers_cumulative").map(series=>series.key === "closer_appointments_cumulative" ? {...series,label:hasFirstQualifications ? "Erstmals zum Closer" : "Qualifizierungen (alle Ergebnisse)"} : series);
  const width = 960;
  const height = 300;
  const pad = { left: 42, right: 20, top: 20, bottom: 28 };
  const values = visibleSeries.flatMap((series) => rows.map((row) => Number(row[series.key] ?? 0)));
  const maxValue = Math.max(4, Math.ceil(Math.max(0, ...values) / 4) * 4);
  const x = (index) => pad.left + (index / Math.max(1, rows.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => height - pad.bottom - (Number(value ?? 0) / maxValue) * (height - pad.top - pad.bottom);
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = (maxValue / 4) * index;
    const position = y(value);
    return `<g><line x1="${pad.left}" y1="${position.toFixed(1)}" x2="${width - pad.right}" y2="${position.toFixed(1)}" />
      <text x="${pad.left - 9}" y="${(position + 4).toFixed(1)}">${number(value)}</text></g>`;
  }).join("");
  const paths = visibleSeries.map((series) => {
    const d = rows.map((row, index) =>
      `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(row[series.key]).toFixed(1)}`).join(" ");
    const last = rows[rows.length - 1];
    return `<path d="${d}" style="stroke:${series.color}" />
      ${rows.map((row, index) => `<circle cx="${x(index).toFixed(1)}" cy="${y(row[series.key]).toFixed(1)}" r="4" style="fill:${series.color}"><title>${escapeHtml(`${row.bucket_label} · ${series.label}: ${number(row[series.key])} insgesamt bis zu diesem Zeitpunkt`)}</title></circle>`).join("")}`;
  }).join("");
  const labels = rows.map((row, index) => ({
    label: row.bucket_label,
    index,
  })).filter(({ index }) => {
    const interval = Math.max(1, Math.ceil((rows.length - 1) / 5));
    return index === 0 || index === rows.length - 1 || index % interval === 0;
  });

  const hitWidth = (width - pad.left - pad.right) / Math.max(1, rows.length - 1);
  const hitAreas = rows.map((row, index) => {
    const time = `${periodCaption()} · ${row.bucket_label}${state.period === "day" ? " Uhr" : ""}`;
    const payload = { title: "Vertriebsverlauf", time, rows: visibleSeries.map((series) => ({ label: series.label, value: `${number(row[series.key])}` })), note: "Anzahl bis zu diesem Zeitpunkt aufsummiert · Berliner Zeit" };
    const left = Math.max(pad.left, x(index) - hitWidth / 2);
    const right = Math.min(width - pad.right, x(index) + hitWidth / 2);
    return `<rect class="chart-hit-area" x="${left}" y="${pad.top - 7}" width="${right - left}" height="${height - pad.bottom - pad.top + 14}" tabindex="0" role="button" aria-label="${escapeHtml(`Werte anzeigen: ${time}`)}" data-chart-point="${escapeHtml(JSON.stringify(payload))}" />`;
  }).join("");
  chart.innerHTML = `
    <div class="antony-performance-legend">${visibleSeries.map((series) => {
      const last = rows[rows.length - 1];
      return `<span><i style="background:${series.color}"></i>${series.label}<b>${number(last[series.key])}</b></span>`;
    }).join("")}</div>
    <div class="chart-axis-copy"><span>Anzahl · bis zum jeweiligen Zeitpunkt aufsummiert</span><span>${state.period === "day" ? "Uhrzeit" : "Datum"}</span></div>
    <svg viewBox="0 0 ${width} ${height}" role="group" aria-label="Kumulierter Antony-Funnel im gewählten Zeitraum">
      <g class="antony-performance-grid">${grid}</g>
      <g class="antony-performance-lines">${paths}</g>${hitAreas}
    </svg>
    <div class="antony-performance-axis">${labels.map(({ label, index }) =>
      `<span style="left:${(index / (rows.length - 1)) * 100}%">${escapeHtml(label)}</span>`).join("")}</div>
    `;

  note.textContent = state.period === "day"
    ? `Jeder Punkt zeigt die bis zu diesem Stundenabschnitt aufsummierte Anzahl; eine waagerechte Linie bedeutet keinen Zuwachs. Zeitraum ${rows[0].bucket_label} bis ${rows.at(-1).bucket_label} Uhr (Berlin), einschließlich Gesprächen vor 08 oder nach 17 Uhr. Neukunden werden am Tag nur als Summe gezeigt, weil das Won-Datum keine belastbare Uhrzeit enthält.`
    : "Aktivitäten aller Quellen am Ereignisdatum, aufsummiert. Punkt anklicken für Datum und Werte.";
}

let trackingSelection=null, trackingSource=null, trackingRequest=0;
function renderAntonyProcess() {
  const container=document.querySelector("#antony-process-content");
  const selection=trackingSelection||{period:state.period,date:state.referenceDate,owner:"all",source:"all"};
  const report=trackingSelection?trackingSource:state.antonyProcess;
  const source=filterTrackingSource(report?.tracking_new,selection.source||"all");
  const rows=Array.isArray(source?.lead_quality_rows)?source.lead_quality_rows:[];
  const grouped=memberResults(rows).filter(r=>selection.owner==="all"||r.owner===selection.owner);
  container.innerHTML=`<div class="tracking-controls"><label>Zeitraum<select id="tracking-period">${[["day","Tag"],["week","Woche"],["month","Monat"]].map(([v,l])=>`<option value="${v}" ${selection.period===v?"selected":""}>${l}</option>`).join("")}</select></label><label>Datum<input type="date" id="tracking-date" value="${escapeHtml(selection.date)}"></label><label>Herkunft<select id="tracking-owner"><option value="all">Alle</option>${Object.entries(TRACKING_MEMBERS).map(([v,l])=>`<option value="${v}" ${selection.owner===v?"selected":""}>${l}</option>`).join("")}</select></label><label>Leadquelle<select id="tracking-source"><option value="all">Alle Quellen</option>${LEAD_SOURCE_OPTIONS.map(v=>`<option value="${escapeHtml(v)}" ${selection.source===v?"selected":""}>${escapeHtml(v)}</option>`).join("")}</select></label><button type="button" id="tracking-reset">Wie oben</button></div>
  <div id="tracking-status" role="status">${source?`${germanDate(source.period.start)} – ${germanDate(source.period.end)}${selection.period!==state.period||selection.date!==state.referenceDate?" · eigener Tabellenzeitraum":" · neue Buchungen wie Monats-Pipeline"}`:"Wird geladen …"}</div>
  <p class="antony-basis">Neue Buchungen mit Ersttermin im gewählten Zeitraum · Herkunft = Opener bzw. LinkedIn-Kanal · Leadquelle = Close-Feld „1.02 Leadquelle“. Gespräche können von anderen Personen geführt worden sein.</p><div class="chart-table-scroll"><table id="lead-quality-table"><thead><tr>${["Herkunft","Neue Vorgänge","Setter durchgeführt","Closer durchgeführt","Neukunden","Setter-Showrate","Closer-Showrate","Neukundenquote"].map(t=>`<th scope="col">${t}</th>`).join("")}</tr></thead><tbody>${source?grouped.map(r=>{const meetings=(source.calendar_rows||[]).filter(m=>m.owner===r.owner);const cohort=totalCounts(source.funnel_by_source?.filter(row=>row.owner===r.owner),["closer_qualified","setter_arrived"]);return `<tr><th scope="row">${escapeHtml(r.label)}</th>${[r.leads,r.setter,r.closer,r.customers].map(n=>`<td>${number(n)}</td>`).join("")}${["setter","closer","customer"].map(kind=>`<td>${originQualityPie(source.quality_by_origin?.filter(q=>q.owner===r.owner),kind)}</td>`).join("")}</tr><tr><td colspan="8"><details><summary>Vorgänge und Kalendertermine · Details</summary><p class="antony-basis">Nur die neue Buchungsgruppe der Monats-Pipeline. Kalendertermine und Showraten gehören zu denselben Vorgängen; frühere Buchungen sind ausgeschlossen.</p>${processDetails(rows.filter(row=>row.owner===r.owner))}<h4>Kalendertermine · ${meetings.length}</h4>${calendarDetails(meetings)}</details></td></tr>`;}).join(""):'<tr><td colspan="8">Wird geladen …</td></tr>'}</tbody></table></div>`;
  if(source) {
    const owners=new Set(grouped.map(r=>r.owner));
    const sums=Object.fromEntries(["leads","setter","closer","customers"].map(k=>[k,grouped.reduce((n,r)=>n+r[k],0)]));
    const cohort=totalCounts(source.funnel_by_source?.filter(r=>owners.has(r.owner)),["closer_qualified","setter_arrived"]);
    const meetings=(source.calendar_rows||[]).filter(r=>owners.has(r.owner));
    container.querySelector("table").insertAdjacentHTML("beforeend",`<tfoot><tr><th scope="row">Auswahl gesamt</th>${[sums.leads,sums.setter,sums.closer,sums.customers].map(n=>`<td>${number(n)}</td>`).join('')}${["setter","closer","customer"].map(kind=>`<td>${originQualityPie(source.quality_by_origin?.filter(q=>owners.has(q.owner)),kind)}</td>`).join("")}</tr></tfoot>`);
  }
  if(source&&selection.owner==="all"){
    const unassigned=(source.calendar_rows||[]).filter(m=>!m.owner||m.owner==="unassigned");
    if(unassigned.length)container.querySelector("tbody").insertAdjacentHTML("beforeend",`<tr><td colspan="8"><details><summary>Termine ohne belegte Herkunft · ${unassigned.length}</summary>${calendarDetails(unassigned)}</details></td></tr>`);
  }
  for(const id of ["tracking-period","tracking-date","tracking-owner","tracking-source"])document.querySelector("#"+id).addEventListener("change",updateTrackingSelection);
  document.querySelector("#tracking-reset").addEventListener("click",()=>{trackingRequest++;trackingSelection=null;trackingSource=null;renderAntonyProcess();});
}
async function updateTrackingSelection(event) {
  const previous=trackingSelection||{period:state.period,date:state.referenceDate,owner:"all",source:"all"};
  const next={period:document.querySelector("#tracking-period").value,date:document.querySelector("#tracking-date").value,owner:document.querySelector("#tracking-owner").value,source:document.querySelector("#tracking-source").value};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(next.date))return;
  const source=trackingSelection?trackingSource:state.antonyProcess;
  trackingSelection=next;
  if(source&&next.period===previous.period&&next.date===previous.date){trackingSource=source;renderAntonyProcess();return;}
  const request=++trackingRequest;trackingSource=null;renderAntonyProcess();
  try {const result=await data.loadAntonyProcessMetrics(next.period,next.date);if(request!==trackingRequest)return;trackingSource=result;renderAntonyProcess();}
  catch {if(request===trackingRequest)document.querySelector("#tracking-status").textContent="Laden fehlgeschlagen. Zeitraum erneut wählen.";}
}

function renderProcessPipeline(source, scoped=false) {
  if(!scoped && source?.month_pipeline_rows?.every(r=>r.booking_scope)) {
    const fresh=bookingScopeReport(source,'new'),older=bookingScopeReport(source,'carryover'),unknown=bookingScopeReport(source,'unknown');
    return `<p class="antony-basis"><strong>${fresh.month_pipeline_rows.length} im Monat neu vereinbart</strong> · ${older.month_pipeline_rows.length} früher vereinbart. Nur Ersttermine im gewählten Terminmonat.</p>${renderProcessPipeline(fresh,true)}${older.month_pipeline_rows.length?`<details><summary>Früher vereinbart · ${older.month_pipeline_rows.length} separat anzeigen</summary>${renderProcessPipeline(older,true)}</details>`:''}${unknown.month_pipeline_rows.length?`<details><summary>Buchungsmonat ungeklärt · ${unknown.month_pipeline_rows.length}</summary>${renderProcessPipeline(unknown,true)}</details>`:''}<p class="antony-basis">Die Monatsprognose berücksichtigt auch separat ausgewiesene ältere Buchungen mit Ersttermin in diesem Monat.</p>`;
  }
  if(!Array.isArray(source?.funnel_by_source))return '<p>Monatsgruppe noch nicht verfügbar.</p>';
  const t=totalCounts(source.funnel_by_source,JOURNEY_KEYS);
  const observedCloser=source.funnel_by_source.every(r=>r.observed_closer!==undefined)?source.funnel_by_source.reduce((n,r)=>n+Number(r.observed_closer),0):t.closer_arrived;
  const details=source.month_pipeline_rows||[];
  const closerCount=source.month_pipeline_rows?stageRows(details,'closer1').length:Math.max(t.closer_qualified||0,observedCloser||0);
  const stages=[
    ['first','Setter-Termin',source.month_pipeline_rows?details.length:t.booked_leads,null,null,'Startbasis'],
    ['setter','Setter durchgeführt',t.setter_arrived,t.setter_arrived,t.booked_leads,'Vorgängen'],
    ['closer1','Closer 1',closerCount,t.closer_qualified,t.setter_arrived,'Setter-Vorgängen qualifiziert'],
    ['cc2','CC2',source.month_pipeline_rows?stageRows(details,'cc2').length:t.cc2_agreed,t.cc2_agreed,t.closer_arrived,'Closer-Vorgängen · vereinbart'],
    ['won','Neukunde',t.observed_customers,t.observed_customers,t.booked_leads,'Vorgängen'],
  ];
  const rail=stages.map(([key,title,n,num,den,basis],i)=>{
    const r=transition(num,den).rate;
    const popup={title:key==='setter'?'Setter-Status im Monat':title,time:monthLabel(state.antonyPlannerPeriodRange.start),rows:stageSummary(source.month_pipeline_rows,key),note:['first','setter'].includes(key)?'Nur Vorgänge mit erstem Setter-Termin in diesem Monat, einschließlich noch anstehender Ersttermine. Follow-up ist ein Ergebnis der durchgeführten Gespräche und zählt nicht zusätzlich.':'Dieselbe Ersttermin-Monatsgruppe. Bisherige Durchführung und aktueller Status können sich überschneiden.'};
    return `<article class="process-stage ${key==='cc2'?'process-stage-optional':''} ${key==='won'?'process-stage-won':''}"><div class="process-stage-head"><span class="process-node" aria-hidden="true">${i+1}</span><span class="process-stage-title">${title}${key==='cc2'?'<small class="process-optional-label">optional</small>':''}</span><strong data-process-count="${key}">${n==null?'—':number(n)}</strong>${den===null?'<span class="process-start">Ersttermine · gesamter Monat</span>':`<progress max="100" value="${r??0}" aria-label="${escapeHtml(quota(num,den,basis))}"></progress>${processRate(num,den,basis)}`}<button type="button" class="process-detail-toggle" data-chart-point="${escapeHtml(JSON.stringify(popup))}" aria-label="Details zu ${title}">Details ↗</button></div></article>`;
  }).join('');
  const gaps=t.unlinked_closer||t.unlinked_customer||t.cc2_missing_agreement;
  const asof=source.cohort_data_as_of||source.setter_attendance?.data_as_of;
  return `<div class="process-flow"><p class="antony-basis">${scoped?'Diese Buchungsgruppe':'Dieselben Vorgänge'} mit erstem Setter im gewählten Monat${asof?` · Fortschritt bis ${germanDate(asof.slice(0,10))}`:''}. Zukunft ist Planung.</p><div class="process-rail">${rail}</div>${gaps?`<details class="process-data-gap"><summary>Fehlende Zwischenbelege in dieser Gruppe</summary><p>${number(t.unlinked_closer)} Closer · ${number(t.unlinked_customer)} Neukunden · ${number(t.cc2_missing_agreement)} CC2. Belegte Ergebnisse bleiben erhalten; daraus entsteht keine erfundene Übergangsquote.</p></details>`:''}</div>`;
}

function renderUpcomingMeetings() {
  const container=document.querySelector("#upcoming-meetings");
  const planned=state.antonyPipeline?.scheduled_meetings;
  if(!Array.isArray(planned)){container.innerHTML="<p>Kalenderstand noch nicht verfügbar.</p>";return;}
  const cutoff=Math.max(Date.now(),Date.parse(state.antonyPipeline.data_as_of)||0);
  const unique=new Map();
  for(const row of planned) {
    if(!/^lead_[A-Za-z0-9]+$/.test(row.lead_id)||!row.meeting_id||!Number.isFinite(Date.parse(row.starts_at))||Date.parse(row.starts_at)<=cutoff)continue;
    unique.set(row.meeting_id,row);
  }
  const rows=[...unique.values()].sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at));
  let previousMonth="";
  const rendered=rows.map(row=>{
    const stage=({setter:"Setter",closer:"Closer",cc2:"CC2"}[row.stage]||"Folgetermin");
    const when=new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(row.starts_at));
    const month=new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",month:"long",year:"numeric"}).format(new Date(row.starts_at));
    const heading=month!==previousMonth?`<div class="calendar-month"><dt>${escapeHtml(month)}</dt></div>`:"";previousMonth=month;
    return `${heading}<div><dt><a href="https://app.close.com/lead/${encodeURIComponent(row.lead_id)}/" target="_blank" rel="noopener noreferrer">${escapeHtml(row.display_name||stage)} · ${escapeHtml(when)} Uhr ↗</a></dt></div>`;
  });
  container.innerHTML=rows.length?`<dl class="open-work-list">${rendered.slice(0,4).join('')}</dl>${rows.length>4?`<details class="upcoming-more"><summary>Weitere ${rows.length-4} Kalendertermine</summary><dl class="open-work-list">${rendered.slice(4).join('')}</dl></details>`:''}`:"<p>Keine weiteren Kalendertermine vorhanden.</p>";
}

function renderWeeklyReview() {
  const section = document.querySelector("#weekly-review");
  const content = document.querySelector("#weekly-review-content");
  const period = document.querySelector("#weekly-review-period");
  const permitted = state.view === "antony" && canViewWeeklyReview();
  section.hidden = !permitted;
  if (!permitted) {
    content.replaceChildren();
    period.textContent = "";
    return;
  }
  const review = state.weeklyReview;

  if (!review?.content) {
    period.textContent = "Letzte abgeschlossene Vertriebswoche";
    content.innerHTML = `<p class="weekly-review-empty">Noch kein Wochenreview vorhanden. Der erste Review wird nach dem nächsten erfolgreichen Montagslauf angezeigt.</p>`;
    return;
  }

  period.textContent = `${germanDate(review.week_start)} – ${germanDate(review.week_end)}`;
  const sentences = String(review.content).split("\n").map((sentence) => sentence.trim()).filter(Boolean);
  content.innerHTML = `<ul>${sentences.map((sentence) => `<li>${escapeHtml(sentence)}</li>`).join("")}</ul>`;
}

function renderKpiAssistant() {
  const form = document.querySelector("#kpi-assistant-form");
  const submit = document.querySelector("#kpi-assistant-submit");
  const answer = document.querySelector("#kpi-assistant-answer");
  if (!form || !submit || !answer) return;

  submit.disabled = state.kpiAssistant.loading;
  submit.textContent = state.kpiAssistant.loading ? "Analysiert …" : "Fragen";

  const text = state.kpiAssistant.error || state.kpiAssistant.answer;
  if (!text && !state.kpiAssistant.loading) {
    answer.hidden = true;
    answer.replaceChildren();
    return;
  }

  answer.hidden = false;
  if (state.kpiAssistant.loading) {
    answer.innerHTML = `<p class="kpi-assistant-loading">Die aggregierten Kennzahlen werden analysiert …</p>`;
    return;
  }

  answer.innerHTML = `<p class="${state.kpiAssistant.error ? "kpi-assistant-error" : ""}">${escapeHtml(text)}</p>${
    Number.isInteger(state.kpiAssistant.remainingRequests)
      ? `<small>Noch ${number(state.kpiAssistant.remainingRequests)} KPI-Fragen heute.</small>`
      : ""
  }`;
}

// Zielerreichung getrennt von den Kernwerten: Nicht jede Kennzahl hat ein Ziel,
// und die wenigen, die eines haben, sollen nicht zwischen den anderen
// untergehen. Die Liste ergibt sich aus den tatsächlich gepflegten Zielen —
// kommt später eines dazu, erscheint es hier von selbst.
const GOAL_METRICS = [
  ["callsGross", "Anrufe brutto", "calls_gross", number],
  ["callsNet", "Anrufe netto", "calls_net", number],
  ["gatekeeper", "Vorzimmer", "gatekeeper_contacts", number],
  ["connected", "Durchstellungen", "connected_calls", number],
  ["connectionRate", "Durchstellquote", "transfer_rate_target", percent],
  ["decisionMakers", "Entscheider gesamt", "decision_maker_contacts", number],
  ["appointments", "Termine", "appointments", number],
  ["appointmentRate", "Terminquote", "appointment_rate_target", percent],
];

function renderGoals() {
  const zeilen = boardEntries().flatMap((entry) =>
    GOAL_METRICS.flatMap(([key, label, column, format]) => {
      const ziel = targetFor(entry.targetId, column);
      if (ziel === null) return [];
      const ist = entry.metrics[key];
      if (ist === null || ist === undefined) return [];
      const anteil = ist / ziel * 100;
      const tone = metricPerformanceClass(key, ist, ziel, entry.targetId);
      return [`
        <div class="goal-item ${tone}"${key === "callsGross" ? ` title="${escapeHtml(callGoalTooltip(entry.targetId))}"` : ""}>
          <span class="goal-head"><b>${escapeHtml(entry.label)}</b> · ${label}</span>
          <span class="goal-track"><i style="width:${Math.min(100, anteil)}%;background:${safeColor(entry.color)}"></i></span>
          <span class="goal-figure">${format(ist)} <small>von ${format(ziel)} · ${Math.round(anteil)} %${key === "callsGross" ? ` ${state.period === "month" ? "Monatsziel" : state.period === "week" ? "Wochenziel" : "Tagesziel"}` : ""}</small></span>
        </div>`];
    }));

  document.querySelector("#goal-strip").innerHTML = zeilen.length === 0
    ? `<p class="empty-note">Noch keine Ziele hinterlegt. Ohne Ziel bleibt eine Kennzahl farblos — das ist beabsichtigt, eine Farbe ohne Vorgabe wäre geraten.</p>`
    : zeilen.join("");
}

// --- Diagramme ---------------------------------------------------------------

// Ein Liniendiagramm ohne Bibliothek. Das ist Voraussetzung dafür, dass ein
// Abschnitt später als eigenständiges Widget in einer fremden Seite läuft.
function chartValuesTable(labels, series, unit) {
  return `<details class="chart-values"><summary>Alle Werte anzeigen · ${escapeHtml(unit)}</summary>
    <div class="chart-table-scroll"><table><caption>Exakte Werte · ${escapeHtml(unit)}</caption>
    <thead><tr><th scope="col">Zeitpunkt</th>${series.map((entry) => `<th scope="col">${escapeHtml(entry.label)}</th>`).join("")}</tr></thead>
    <tbody>${labels.map((label, index) => `<tr><th scope="row">${escapeHtml(label)}</th>${series.map((entry) => `<td>${number(entry.values[index])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
}

function lineChart(points, seriesByPerson, format, pointLabel = "Tage", unit = "Anzahl") {
  if (!points.length) return `<p class="empty-note">Für diesen Zeitraum liegen keine Werte vor.</p>`;
  const hourly = pointLabel === "Stunden";
  const labels = points.map((point) => hourly
    ? `${String(point).padStart(2, "0")}:00–${String(Number(point) + 1).padStart(2, "0")}:00 Uhr`
    : new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(`${point}T12:00:00Z`)));
  const width = 440, height = 210;
  const pad = { left: 44, right: 24, top: 16, bottom: 38 };
  const values = Object.values(seriesByPerson).flat().filter(Number.isFinite);
  const max = Math.max(4, Math.ceil(Math.max(0, ...values) / 4) * 4);
  const x = (index) => points.length === 1 ? (width + pad.left - pad.right) / 2
    : pad.left + index * (width - pad.left - pad.right) / (points.length - 1);
  const y = (value) => height - pad.bottom - (Number(value) / max) * (height - pad.top - pad.bottom);
  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = max * i / 4;
    return `<line class="chart-grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}"/><text class="chart-tick" x="${pad.left - 8}" y="${y(value) + 4}" text-anchor="end">${format(value)}</text>`;
  }).join("");
  const interval = Math.max(1, Math.ceil((points.length - 1) / 4));
  const ticks = points.map((point, index) => {
    if (index !== points.length - 1 && index % interval !== 0) return "";
    // Avoid nearly overlapping labels at the end of a month.
    if (index !== points.length - 1 && index > points.length - 1 - interval * 0.6) return "";
    const label = hourly ? `${String(point).padStart(2, "0")}:00` : String(point).slice(8, 10) + "." + String(point).slice(5, 7) + ".";
    return `<text class="chart-tick" x="${x(index)}" y="${height - 12}" text-anchor="middle">${label}</text>`;
  }).join("");
  const series = Object.entries(seriesByPerson).map(([slug, values]) => {
    const person = state.people.find((entry) => entry.slug === slug);
    return { label: firstName(person?.display_name ?? slug), values, color: safeColor(person?.color ?? "#8fa3bf") };
  });
  const lines = series.map((entry) => {
    const d = entry.values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index)} ${y(value)}`).join(" ");
    return `<path class="series-line" d="${d}" style="stroke:${entry.color}"/>` + entry.values.map((value, index) =>
      `<circle cx="${x(index)}" cy="${y(value)}" r="3.5" fill="${entry.color}"><title>${escapeHtml(`${entry.label} · ${labels[index]} · ${format(value)} ${unit}`)}</title></circle>`).join("");
  }).join("");
  const hitWidth = (width - pad.left - pad.right) / Math.max(1, points.length - 1);
  const hitAreas = points.map((point, index) => {
    const time = hourly ? `${germanDate(state.periodRange.start)} · ${labels[index]}` : `${labels[index]} ${String(point).slice(0, 4)}`;
    const payload = { title: unit, time, rows: series.map((entry) => ({ label: entry.label, value: `${format(entry.values[index])} ${unit}` })), note: `Einzelwert je ${hourly ? "Stunde" : "Kalendertag"} · Berliner Zeit` };
    const left = Math.max(pad.left, x(index) - hitWidth / 2);
    const right = Math.min(width - pad.right, x(index) + hitWidth / 2);
    return `<rect class="chart-hit-area" x="${left}" y="${pad.top - 7}" width="${points.length === 1 ? width - pad.left - pad.right : right - left}" height="${height - pad.bottom - pad.top + 14}" tabindex="0" role="button" aria-label="${escapeHtml(`Werte anzeigen: ${time}`)}" data-chart-point="${escapeHtml(JSON.stringify(payload))}" />`;
  }).join("");
  return `<div class="chart-axis-copy"><span>${escapeHtml(unit)} je ${hourly ? "Stunde" : "Kalendertag"}</span><span>${hourly ? "Uhrzeit" : "Datum"}</span></div>
    <svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${escapeHtml(`${unit} je ${hourly ? 'Stunde' : 'Tag'}, ${labels[0]} bis ${labels[labels.length - 1]}; jede Farbe steht für eine Person`)}">${grid}${ticks}${lines}${hitAreas}</svg>
    ${chartValuesTable(labels, series, `${unit} je ${hourly ? "Stunde" : "Tag"}`)}`;
}

function renderSeries() {
  const title = document.querySelector("#series-title");
  const legend = orderedPeople().map((person) => `
    <span><i class="legend-dot" style="background:${safeColor(person.color)}"></i>${escapeHtml(firstName(person.display_name))}</span>`).join("");
  document.querySelector("#series-legend").innerHTML = legend;

  // Ein Tag ist kein 14-Tage-Rückblick. Die großen Diagramme zeigen deshalb
  // die Anrufaktivität dieses einen Tages stündlich und getrennt je Person.
  if (state.period === "day") {
    title.textContent = "Aktivität am Tag";
    const hours = Array.from({ length: 10 }, (_, index) => index + 8);
    document.querySelector("#series-note").textContent =
      `Erfasste Aktivität am ${germanDate(state.periodRange.start)}: jeder Punkt zählt Anrufe innerhalb einer Stunde (08:00–17:59 Uhr, Berliner Zeit). Werte außerhalb dieses Fensters sind hier nicht dargestellt.`;
    const metrics = [
      ["Anrufe brutto", "calls_gross"],
      ["Anrufe netto", "calls_net"],
    ];
    document.querySelector("#series-charts").innerHTML = metrics.map(([label, key]) => {
      const seriesByPerson = {};
      orderedPeople().forEach((person) => {
        seriesByPerson[person.slug] = hours.map((hour) => {
          const row = state.hours.find((entry) => entry.slug === person.slug && entry.metric_hour === hour);
          return Number(row?.[key] ?? 0);
        });
      });
      return `
        <article class="chart-card">
          <h3>${label}</h3>
          <div class="chart-body">${lineChart(hours, seriesByPerson, number, "Stunden", "Anrufe")}</div>
        </article>`;
    }).join("");
    return;
  }

  title.textContent = "Entwicklung im Zeitraum";

  const days = [...new Set(state.series.map((row) => row.metric_date))].sort();
  document.querySelector("#series-note").textContent = days.length === 0
    ? "Für diesen Zeitraum liegen keine Tageswerte vor."
    : `Tageswerte im gewählten Zeitraum: ${germanDate(days[0])} bis ${germanDate(days[days.length - 1])}.`;
  // Die Verlaufsdiagramme zeigen Mengen. Quoten stehen in den Kernwerten,
  // weil sie dort stets aus der richtigen Grundgesamtheit berechnet werden.
  const columns = {
    callsGross: "calls_gross",
    callsNet: "calls_net",
    decisionMakers: "decision_maker_contacts",
    appointments: "appointments",
  };

  document.querySelector("#series-charts").innerHTML = coreMetrics().filter((metric) => columns[metric.key]).map((metric) => {
    const column = columns[metric.key];
    const seriesByPerson = {};
    orderedPeople().forEach((person) => {
      seriesByPerson[person.slug] = days.map((day) => {
        const row = state.series.find((entry) => entry.metric_date === day && entry.slug === person.slug);
        return row ? Number(row[column]) : 0;
      });
    });
    return `
      <article class="chart-card">
        <h3>${metric.label}</h3>
        <div class="chart-body">${lineChart(days, seriesByPerson, metric.format, "Tage", metric.key === "appointments" ? "Termine" : metric.key === "decisionMakers" ? "Entscheiderkontakte" : "Anrufe")}</div>
      </article>`;
  }).join("");
}

// Querliegender Trichter: eine Zeile je Stufe, Anteile als Balken.
function renderFunnel() {
  const steps = [
    ["Netto-Anrufe", "callsNet"],
    ["Vorzimmer (bewertbar)", "gatekeeper"],
    ["Durchgestellt", "connected"],
    ["Entscheider", "decisionMakers"],
    ["Termine", "appointments"],
  ];
  const people = orderedPeople();
  const totals = steps.map(([, key]) => people.reduce((sum, person) => sum + state.metrics[person.slug][key], 0));
  const widest = Math.max(1, ...totals);

  // Die Durchstellquote ist die wichtigste Diagnose innerhalb der
  // Kontaktstufen, aber keine Kern-KPI. In der Teamansicht stehen deshalb der
  // gewichtete Teamwert und beide Personen direkt nebeneinander; in einer
  // Personenansicht bleibt nur deren eigener Donut stehen.
  const transferEntries = boardEntries().slice().sort((a, b) => {
    if (a.slug === "team") return -1;
    if (b.slug === "team") return 1;
    return 0;
  });
  document.querySelector("#transfer-donuts").innerHTML = transferEntries.map((entry) => {
    const base = Number(entry.metrics.gatekeeper ?? 0);
    const successes = Number(entry.metrics.connected ?? 0);
    const rate = base > 0 ? safeRate(successes, base) : null;
    const safeRateValue = rate === null ? 0 : Math.min(100, Math.max(0, rate));
    const aria = rate === null
      ? `${entry.label}: keine Vorzimmer-Kontakte`
      : `${entry.label}: ${Math.round(rate)} Prozent Durchstellquote, ${successes} von ${base}`;
    const breakdown=(state.transferBreakdown || []).filter(row=>entry.slug === "team" || row.slug === entry.slug);
    const fields=[["Entscheider/GF direkt erreicht","direct_reached"],["Entscheider/GF direkt nicht erreicht","direct_not_reached"],["Direkter Versuch ohne Ergebnis","direct_unknown"],["GF nicht erreicht · Kontaktweg unklar","unreachable_route_unknown"],["Durchgestellt","transferred"],["Nicht durchgestellt","rejected"],["E-Mail senden","email_requested"],["Kein Interesse","no_interest"],["GF/CEO nicht erreichbar · ausgeschlossen","unavailable"],["Direkter Kontakt · ausgeschlossen","direct"],["Fehlendes / anderes Ergebnis · ausgeschlossen","unknown"]];
    const payload={title:`${entry.label}: Durchstellquote`,time:periodCaption(),rows:[{label:"Durchgestellt / bewertbar",value:`${successes} / ${base}`}],note:"Mailbox, außerhalb der Geschäftszeiten und GF/CEO nicht erreichbar zählen nicht in die Durchstellquote."};
    if(breakdown.length)payload.rows.push(...fields.map(([label,key])=>({label,value:number(breakdown.reduce((sum,row)=>sum+Number(row[key]??0),0))})));
    const conflicts=breakdown.reduce((sum,row)=>sum+Number(row.conflicting_results??0),0);
    if(conflicts)payload.rows.push({label:"Widersprüchliche CRM-Ergebnisse · prüfen",value:number(conflicts)});
    return `
      <article class="transfer-donut-card" tabindex="0" role="button" aria-label="${escapeHtml(aria+". Aufschlüsselung anzeigen")}" data-chart-point="${escapeHtml(JSON.stringify(payload))}" style="--donut-color:${safeColor(entry.color)}">
        <span class="transfer-donut" style="--donut-rate:${safeRateValue}" role="img" aria-label="${escapeHtml(aria)}">
          <strong>${rate === null ? "–" : `${Math.round(rate)} %`}</strong>
        </span>
        <span class="transfer-donut-copy">
          <b>${escapeHtml(entry.label)}</b>
          <small>${successes} von ${base} bewertbaren Vorzimmer-Kontakten durchgestellt</small>
        </span>
      </article>`;
  }).join("");

  const categories=[["Vorzimmer-Kontakt","evaluated"],["Entscheider/GF direkt erreicht","direct_reached"],
    ["Entscheider/GF direkt nicht erreicht","direct_not_reached"],["GF nicht erreicht · Zugangsweg offen","unreachable_route_unknown"],
    ["Direktversuch · Ergebnis offen","direct_unknown"]];
  const contactBreakdown=`<div class="table-scroll"><table class="contact-type-table"><thead><tr><th>Kontaktart</th>${transferEntries.map(e=>`<th>${escapeHtml(e.label)}</th>`).join("")}</tr></thead><tbody>${categories.map(([label,key])=>`<tr><th>${escapeHtml(label)}</th>${transferEntries.map(entry=>{
    const parts=(state.transferBreakdown||[]).filter(row=>entry.slug==="team"||row.slug===entry.slug);
    return `<td>${parts.length?number(parts.reduce((n,row)=>n+Number(row[key]||0),0)):"–"}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table></div>`;
  document.querySelector("#funnel").innerHTML = steps.map(([label, key], index) => {
    const bars = people.map((person) => {
      const value = state.metrics[person.slug][key];
      return `<i style="width:${(value / widest) * 100}%;background:${safeColor(person.color)}" title="${escapeHtml(firstName(person.display_name))}: ${number(value)}"></i>`;
    }).join("");
    return `
      <div class="funnel-row">
        <span class="funnel-label">${label}</span>
        <span class="funnel-bar">${bars}</span>
        <span class="funnel-total">${number(totals[index])}</span>
    </div>`;
  }).join("") + contactBreakdown;
  document.querySelector("#funnel-note").textContent =
    "Durchstellquote = „Durchgestellt“ ÷ bewertbare Vorzimmer-Ergebnisse. „CEO/GF nicht erreichbar“, Mailbox, außerhalb der Geschäftszeiten und direkte Entscheidergespräche zählen nicht mit. Ablehnung, „E-Mail senden“ und „Kein Interesse“ zählen als nicht durchgestellt. Der Teamwert entsteht aus den Summen.";
}

// Beide Stundenansichten verwenden dieselbe Regel und dieselben Unter-KPIs.
function renderHours() {
  document.querySelector("#hours-title").textContent = state.period === "day"
    ? `Anrufzeiten am ${germanDate(state.periodRange.start)}` : "Beste Anrufzeiten";
  document.querySelector("#hours-rate-switch").hidden = false;
  document.querySelector("#hours-chart").innerHTML = renderCallTimeProfile(
    state.hours, orderedPeople(), state.heatmapRate, periodCaption(),
  );
}

function renderTrendHours() {
  document.querySelector("#trend-hours").innerHTML = renderCallTimeProfile(
    state.trendHours, orderedPeople(), state.trendRate, "Dreimonatsrückblick",
  );
}

// --- Details -----------------------------------------------------------------

function renderDetails() {
  document.querySelector("#details-row").innerHTML = boardEntries().map((entry) => {
    const rows = detailMetrics().map((metric) => {
      const value = entry.metrics[metric.key];
      const target = metric.noTarget ? null : (metric.rateTarget ? targetFor(entry.targetId, metric.rateTarget) : targetFor(entry.targetId, metric.target));
      const tone = metricPerformanceClass(metric.key, value, target, entry.targetId);
      return `
        <div class="detail-line ${tone}">
          <span>${metric.label}</span>
          <strong>${metric.format(value)}</strong>
        </div>`;
    }).join("");
    return `
      <details class="detail-block" style="--person-color:${safeColor(entry.color)}">
        <summary>${escapeHtml(entry.label)}</summary>
        <div class="detail-lines">${rows}</div>
      </details>`;
  }).join("");
}

function renderTrends() {
  const columns = [
    ["calls_gross", "Brutto", number],
    ["calls_net", "Netto-Anrufe", number],
    ["net_rate", "Nettoquote", percent],
    ["connection_rate", "Durchstellquote", percent],
    ["decision_maker_contacts", "Entscheider", number],
    ["appointments", "Termine", number],
    ["appointment_rate", "Terminquote", percent],
  ];
  const months = [...new Set(state.trends.map((row) => row.month_start))].sort().reverse();

  const rows = months.flatMap((month) => orderedPeople().map((person) => {
    const row = state.trends.find((entry) => entry.month_start === month && entry.slug === person.slug);
    if (!row) return "";
    const cells = columns.map(([key, , format]) => `<td>${format(key === "connection_rate" && Number(row.gatekeeper_contacts) === 0 ? null : Number(row[key]))}</td>`).join("");
    return `<tr><td>${monthLabel(month)}</td><td><span class="status-chip" style="color:${safeColor(person.color)}">${escapeHtml(firstName(person.display_name))}</span></td>${cells}</tr>`;
  })).join("");

  document.querySelector("#trend-head").innerHTML =
    `<tr><th>Monat</th><th>Person</th>${columns.map(([, label]) => `<th>${label}</th>`).join("")}</tr>`;
  document.querySelector("#trend-rows").innerHTML = rows || `<tr><td colspan="8">Noch keine Monatsdaten vorhanden.</td></tr>`;
}

function renderManager() {
  if (state.profile.role !== "manager" && state.profile.role !== "operator") return;

  const startField = document.querySelector("#target-period-start");
  const endField = document.querySelector("#target-period-end");
  if (!startField.value) startField.value = state.periodRange.start;
  if (!endField.value) endField.value = state.periodRange.end;

  document.querySelector("#goal-fields").innerHTML = targetFields.map(([column, label]) => {
    const inputs = state.people.map((person) => {
      const existing = state.targets.find((target) => target.sales_person_id === person.id);
      const value = existing?.[column] ?? "";
      return `<input id="goal-${escapeHtml(person.slug)}-${column}" name="${escapeHtml(person.id)}--${column}" type="number" min="0" step="any" value="${escapeHtml(value)}" placeholder="${escapeHtml(firstName(person.display_name))}" aria-label="${label}, Ziel für ${escapeHtml(person.display_name)}" />`;
    }).join("");
    return `<div class="goal-field"><label for="goal-${escapeHtml(state.people[0]?.slug)}-${column}">${label}</label>${inputs}</div>`;
  }).join("");

  if (state.profile.role !== "operator") return;
  const sync = state.syncRun;
  document.querySelector("#sync-detail").innerHTML = sync
    ? `<span>Status: <strong>${escapeHtml(sync.status)}</strong></span><span>${sync.completed_at ? germanDate(sync.completed_at.slice(0, 10)) : "läuft"}</span><span>${number(sync.fetched_records ?? 0)} gelesen</span><span>${number(sync.upserted_records ?? 0)} gespeichert</span>`
    : `<span>Noch kein Sync-Lauf erfasst.</span>`;
}

// Muss mit dem Supabase-Cron-Job übereinstimmen. Die krummen Minuten vermeiden
// Lastspitzen und bleiben für die sichtbare "nächster Lauf"-Schätzung bewusst
// konstant.
const SYNC_MINUTEN = [7, 22, 37, 52];

function minutesToNextSync() {
  const jetzt = new Date();
  const vergangen = jetzt.getMinutes() * 60 + jetzt.getSeconds();
  const naechste = SYNC_MINUTEN.find((minute) => minute * 60 > vergangen) ?? (SYNC_MINUTEN[0] + 60);
  return Math.max(0, Math.ceil((naechste * 60 - vergangen) / 60));
}

function minutesSince(isoTimestamp) {
  if (!isoTimestamp) return null;
  const differenz = Date.now() - Date.parse(isoTimestamp);
  if (Number.isNaN(differenz)) return null;
  return Math.max(0, Math.floor(differenz / 60000));
}

function renderSyncBadge() {
  const label = state.status === "live" ? "Live-Daten"
    : state.status === "preview" ? "Designvorschau"
    : state.status === "loading" ? "Lädt" : "Getrennt";
  let note;
  if (state.status === "live") {
    const her = minutesSince(state.lastCalculated);
    const bis = minutesToNextSync();
    const zuletzt = her === null ? "Stand unbekannt" : her < 1 ? "gerade aktualisiert" : `zuletzt vor ${her} Min`;
    note = `${zuletzt} · nächster Lauf in ~${bis} Min`;
  } else if (state.status === "preview") {
    note = "Beispielzahlen, nicht aus Close";
  } else {
    note = state.error ?? "Verbindung wird aufgebaut";
  }

  const titel = state.status === "live"
    ? "Der Sync läuft alle 15 Minuten über Supabase Cron. Der angezeigte nächste Lauf ist eine Schätzung."
    : "";

  document.querySelector(".sync-status").innerHTML =
    `<span class="sync-dot ${state.status === "live" ? "is-live" : ""}" aria-hidden="true"></span>
     <span title="${escapeHtml(titel)}"><strong>${label}</strong><small>${escapeHtml(note)}</small></span>`;
}

function updateUrl() {
  if (state.widget) return;
  const url = new URL(window.location.href);
  url.searchParams.set("view", state.view);
  url.searchParams.set("period", state.period);
  if (state.datePinned) {
    url.searchParams.set("date", state.referenceDate);
    url.searchParams.set("historisch", "1");
  } else {
    // Alte Links enthielten immer ein Datum, obwohl es nur der damalige
    // Standardtag war. Ohne historisch=1 darf ein Link deshalb nicht morgen
    // auf gestern stehen bleiben.
    url.searchParams.delete("date");
    url.searchParams.delete("historisch");
  }
  window.history.replaceState({}, "", url);
}

function render() {
  if (state.view === "antony" && !canViewAntony()) {
    const own = state.people.find((person) => person.id === state.profile.salesPersonId);
    state.view = own?.slug ?? "team";
  }
  renderNav();
  renderHeader();
  renderWeeklyReview();
  if (state.view === "antony") {
    renderAntony();
    renderSyncBadge();
    updateUrl();
    return;
  }
  renderCore();
  renderSeries();
  renderFunnel();
  renderHours();
  renderDetails();
  if (canViewThreeMonthReview()) {
    renderTrendHours();
  }
  renderSyncBadge();
  updateUrl();
}

// --- Ablauf ------------------------------------------------------------------

function showError(message) {
  state.status = "error";
  state.error = message;
  renderSyncBadge();
  const box = document.querySelector("#load-error");
  box.textContent = message;
  box.hidden = false;
}

async function refresh() {
  if (new URLSearchParams(location.search).get("preview") === "1") {samplePreview();render();return;}
  const revision=++refreshRevision;
  const shell=document.querySelector(".app-shell");
  try {
    document.querySelector("#load-error").hidden=true;
    state.status="loading";shell.setAttribute("aria-busy","true");renderSyncBadge();
    if(!await loadAll(revision))return;
    state.status="live";state.error=null;delete shell.dataset.stale;document.querySelector("#retry-load").hidden=true;
    document.querySelector("#load-error").hidden=true;render();
  } catch(error) {
    if(revision!==refreshRevision)return;
    shell.dataset.stale="true";document.querySelector("#retry-load").hidden=false;
    state.closing=null;state.antonyProcess=null;
    state.antonyPlannerClosing=null;state.antonyPlannerProcess=null;
    document.querySelector("#antony-section").hidden=true;
    document.querySelector("#widget-kernwerte").hidden=true;
    showError("Daten konnten nicht vollständig geladen werden. Es werden keine gemischten oder alten Zahlen angezeigt.");
  } finally {
    if(revision===refreshRevision)shell.removeAttribute("aria-busy");
  }
}

// Scheitert der Start nach erfolgreicher Anmeldung, ist die Anmeldemaske der
// einzige Ort, an dem die Meldung ankommt — die Anwendung selbst ist dann noch
// nicht sichtbar.
function reportStartupFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  document.querySelector("#login-status").textContent = `Anmeldung erfolgreich, aber das Laden schlug fehl: ${message}`;
  showApp(false);
  showError(message);
}

function showApp(visible) {
  document.querySelector(".app-shell").hidden = !visible;
  document.querySelector("#login-screen").hidden = visible;
  document.querySelector("#password-setup-screen").hidden = true;
}

function showPasswordSetup() {
  document.querySelector(".app-shell").hidden = true;
  document.querySelector("#login-screen").hidden = true;
  document.querySelector("#password-setup-screen").hidden = false;
}

let sessionGeneration = 0;
let pendingSessionStart = null;
function startSession() {
  const generation = sessionGeneration;
  if (pendingSessionStart?.generation === generation) return pendingSessionStart.promise;
  const promise = initializeSession(generation);
  pendingSessionStart = { generation, promise };
  const clear = () => { if (pendingSessionStart?.promise === promise) pendingSessionStart = null; };
  promise.then(clear, clear);
  return promise;
}

async function initializeSession(generation) {
  const [profile, session] = await Promise.all([data.loadProfile(), data.currentSession()]);
  if (generation !== sessionGeneration || !session) return;
  state.sessionUserId = session.user.id;
  state.profile = { ...profile, email: session?.user?.email ?? null };
  if (state.forcePasswordSetup || state.profile.mustChangePassword) {
    state.status = "password-setup";
    showPasswordSetup();
    return;
  }

  // Direkte oder alte Antony-Links duerfen die geschuetzten RPCs fuer andere
  // Konten nicht einmal im Hintergrund anfragen.
  if (state.view === "antony" && !canViewAntony()) state.view = "team";

  showApp(true);
  renderNav();
  await refresh();
  if (generation !== sessionGeneration) return;

  // Wer einer Person zugeordnet ist, startet in der eigenen Ansicht.
  const own = state.people.find((person) => person.id === state.profile.salesPersonId);
  if (own && state.view === "team") {
    state.view = own.slug;
    if (state.view === "antony") await refresh();
    else render();
    if (generation !== sessionGeneration) return;
  }

  state.unsubscribe?.();
  state.unsubscribe = data.subscribeToUpdates(() => refresh());
}

function endSession() {
  sessionGeneration++;
  state.sessionUserId = null;
  refreshRevision++;
  state.antonyPlannerProcess=null;state.transferBreakdown=null;
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.profile = { displayName: null, role: "sales", salesPersonId: null, mustChangePassword: false, email: null };
  state.closing = null;
  state.antonyPipeline = null;
  state.antonyProcess = null;
  state.antonyPerformance = [];
  state.antonyGoal = null;
  state.antonyCustomerValueCents = 0;
  state.plannerOpen = true;
  state.antonyRateMode = "current";
  state.antonyPlannerMetrics = {};
  state.antonyPlannerClosing = null;
  state.antonyPlannerPeriodRange = { start: null, end: null };
  state.weeklyReview = null;
  state.kpiAssistant = { answer: null, error: null, loading: false, remainingRequests: null };
  state.forcePasswordSetup = false;
  state.passwordChangeInProgress = false;
  showApp(false);
}

function readInitialState() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const period = params.get("period");
  const date = params.get("date");
  if (view) state.view = view;
  if (period && periodLabels[period]) state.period = period;
  if (date && params.get("historisch") === "1" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    state.referenceDate = date;
    state.datePinned = true;
  }
}

document.querySelector("#retry-load").addEventListener("click",()=>refresh());

document.addEventListener("click", (event) => {
  const antonyRateModeButton = event.target.closest("[data-antony-rate-mode]");
  if (antonyRateModeButton) {
    state.antonyRateMode = antonyRateModeButton.dataset.antonyRateMode;
    renderAntonyRateMode();
    const goal = plannerGoalFromForm();
    renderAntonyRangeOutputs(goal);
    renderAntonyPlannerResults(goal);
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    if (viewButton.dataset.view === "antony" && !canViewAntony()) return;
    const previousView = state.view;
    state.view = viewButton.dataset.view;
    render();
    if (previousView !== state.view && (previousView === "antony" || state.view === "antony")) refresh();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const periodButton = event.target.closest("[data-period]");
  if (periodButton) {
    state.period = periodButton.dataset.period;
    state.kpiAssistant = { answer: null, error: null, loading: false, remainingRequests: null };
    refresh();
    return;
  }
  const trendRateButton = event.target.closest("[data-trend-rate]");
  if (trendRateButton) {
    state.trendRate = trendRateButton.dataset.trendRate;
    document.querySelectorAll("[data-trend-rate]").forEach((button) => {
      button.classList.toggle("active", button.dataset.trendRate === state.trendRate);
    });
    renderTrendHours();
    return;
  }
  const rateButton = event.target.closest("[data-rate]");
  if (rateButton) {
    state.heatmapRate = rateButton.dataset.rate;
    document.querySelectorAll("[data-rate]").forEach((button) => {
      button.classList.toggle("active", button.dataset.rate === state.heatmapRate);
    });
    renderHours();
  }
});

document.querySelector("#reference-date").addEventListener("change", (event) => {
  const selectedDate = event.target.value || berlinToday();
  state.referenceDate = selectedDate;
  state.datePinned = selectedDate !== berlinToday();
  state.kpiAssistant = { answer: null, error: null, loading: false, remainingRequests: null };
  refresh();
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const status = document.querySelector("#login-status");
  status.textContent = "Anmeldung läuft …";
  try {
    await data.signIn(String(form.get("email")).trim(), String(form.get("password")));
    status.textContent = "";
  } catch (error) {
    status.textContent = `Anmeldung fehlgeschlagen: ${error.message}`;
  }
});

document.querySelector("#password-setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  const status = document.querySelector("#password-setup-status");

  if (password.length < 6) {
    status.textContent = "Das persönliche Passwort muss mindestens 6 Zeichen haben.";
    return;
  }
  if (password !== confirmation) {
    status.textContent = "Die beiden Passwörter stimmen nicht überein.";
    return;
  }

  state.passwordChangeInProgress = true;
  status.textContent = "Persönliches Passwort wird gespeichert …";
  try {
    await data.updatePassword(password);
    if (state.profile.mustChangePassword) await data.completePasswordSetup();
    state.forcePasswordSetup = false;
    state.profile.mustChangePassword = false;
    status.textContent = "";
    await startSession();
  } catch (error) {
    status.textContent = `Passwort konnte nicht gespeichert werden: ${error.message}`;
  } finally {
    state.passwordChangeInProgress = false;
  }
});

document.querySelector("#password-setup-sign-out").addEventListener("click", () => data.signOut());
document.querySelector("#sign-out").addEventListener("click", () => data.signOut());

document.querySelector("#kpi-assistant-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = String(new FormData(event.currentTarget).get("question") ?? "").trim();
  if (question.length < 3 || question.length > 500) {
    state.kpiAssistant = {
      answer: null,
      error: "Bitte eine Frage mit 3 bis 500 Zeichen eingeben.",
      loading: false,
      remainingRequests: null,
    };
    renderKpiAssistant();
    return;
  }

  if (state.status === "preview") {
    state.kpiAssistant = {
      answer: "In der Vorschau wird kein kostenpflichtiger API-Aufruf ausgeführt. Nach Anmeldung beantwortet die KI diese Frage ausschließlich aus dem gewählten KPI-Zeitraum und dem Social-Profit-Kontext.",
      error: null,
      loading: false,
      remainingRequests: null,
    };
    renderKpiAssistant();
    return;
  }

  state.kpiAssistant = { answer: null, error: null, loading: true, remainingRequests: null };
  renderKpiAssistant();
  try {
    const result = await data.askKpiAssistant(question, state.period, state.referenceDate);
    state.kpiAssistant = {
      answer: result.answer,
      error: null,
      loading: false,
      remainingRequests: result.remainingRequests,
    };
  } catch (error) {
    state.kpiAssistant = {
      answer: null,
      error: error.message,
      loading: false,
      remainingRequests: null,
    };
  }
  renderKpiAssistant();
});

// Ziele schreiben darf ausschließlich der Manager. Die Policy setzt das
// serverseitig durch, das Formular erscheint nur passend dazu.
document.querySelector("#goal-editor").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#goal-status");
  const form = new FormData(event.currentTarget);
  const periodStart = String(form.get("period_start"));
  const periodEnd = String(form.get("period_end"));

  if (!periodStart || !periodEnd || periodEnd < periodStart) {
    status.textContent = "Bitte einen gültigen Zeitraum angeben.";
    return;
  }

  const session = await data.currentSession();
  const rows = state.people.map((person) => {
    const row = {
      sales_person_id: person.id,
      period_start: periodStart,
      period_end: periodEnd,
      created_by: session?.user?.id ?? null,
    };
    targetFields.forEach(([column]) => {
      const raw = form.get(`${person.id}--${column}`);
      const value = raw === "" || raw === null ? null : Number(raw);
      row[column] = column.endsWith("_target") ? value : (value ?? 0);
    });
    return row;
  });

  status.textContent = "Ziele werden gespeichert …";
  try {
    await data.saveTargets(rows);
    status.textContent = "Ziele gespeichert.";
    await refresh();
  } catch (error) {
    status.textContent = `Speichern fehlgeschlagen: ${error.message}`;
  }
  setTimeout(() => { status.textContent = ""; }, 4000);
});

document.querySelector("#antony-planner").addEventListener("toggle", (event) => {
  state.plannerOpen = event.currentTarget.open;
});

document.querySelector("#antony-plan-form").addEventListener("input", () => {
  const goal = plannerGoalFromForm();
  renderAntonyRangeOutputs(goal);
  renderAntonyPlannerResults(goal);
});

const antonyCustomerValueInput = document.querySelector("#antony-ist-customer-value");

antonyCustomerValueInput.addEventListener("input", () => {
  const value = Number(antonyCustomerValueInput.value);
  state.antonyCustomerValueCents = Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
  const status = document.querySelector("#antony-ist-value-status");
  status.textContent = state.antonyCustomerValueCents > 0
    ? (canSaveAntonyGoal() && state.status !== "preview" ? "wird beim Verlassen gespeichert" : "lokale Berechnung")
    : "für die Zielrechnung erforderlich";
  renderAntonyCustomerValue();
  const goal = plannerGoalFromForm();
  renderAntonyRangeOutputs(goal);
  renderAntonyPlannerResults(goal);
});

antonyCustomerValueInput.addEventListener("change", async () => {
  const status = document.querySelector("#antony-ist-value-status");
  if (state.antonyCustomerValueCents <= 0) return;
  if (!canSaveAntonyGoal() || state.status === "preview") {
    status.textContent = state.status === "preview" ? "Vorschau · nicht gespeichert" : "lokale Berechnung";
    return;
  }

  const storedGoal = storedAntonyGoal();
  status.textContent = "wird gespeichert …";
  try {
    state.antonyGoal = await data.saveAntonyGoal({
      period_type: "month",
      period_start: state.antonyPlannerPeriodRange.start,
      period_end: plannerPeriodEnd(),
      target_new_customers: storedGoal.targetNewCustomers ?? 0,
      target_revenue_cents: storedGoal.targetRevenueCents ?? 0,
      customer_value_cents: state.antonyCustomerValueCents,
      appointment_to_closer_rate_override: storedGoal.appointmentToCloserRateOverride ?? null,
      show_rate_override: storedGoal.showRateOverride ?? null,
      closing_rate_override: storedGoal.closingRateOverride ?? null,
      decision_rate_override:storedGoal.decisionRateOverride??null,confirmation_rate_override:storedGoal.confirmationRateOverride??null,
    });
    status.textContent = "gespeichert";
  } catch (error) {
    status.textContent = `nicht gespeichert: ${error.message}`;
  }
});

document.querySelector("#antony-plan-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#antony-plan-status");
  const goal = plannerGoalFromForm();
  const overrides = [
    goal.appointmentToCloserRateOverride,
    goal.showRateOverride,
    goal.closingRateOverride,goal.decisionRateOverride,goal.confirmationRateOverride,
  ];

  if (!canSaveAntonyGoal()) {
    status.textContent = "Dieser Plan kann nur von Antony oder der Dashboard-Leitung gespeichert werden.";
    return;
  }
  if (!Number.isInteger(goal.targetNewCustomers) || goal.targetNewCustomers < 0) {
    status.textContent = "Das Neukundenziel muss eine ganze Zahl ab 0 sein.";
    return;
  }
  if (goal.targetNewCustomers <= 0 && goal.targetRevenueCents <= 0) {
    status.textContent = "Bitte mindestens ein Neukunden- oder Umsatzziel eintragen.";
    return;
  }
  if (goal.customerValueCents <= 0) {
    status.textContent = "Bitte einen Kundenwert größer als 0 € eintragen.";
    return;
  }
  if (overrides.some((value) => value !== null && (!Number.isFinite(value) || value <= 0 || value > 100))) {
    status.textContent = "Angepasste Quoten müssen zwischen 0,1 % und 100 % liegen.";
    return;
  }

  status.textContent = "Zielplan wird gespeichert …";
  try {
    state.antonyGoal = await data.saveAntonyGoal({
      period_type: "month",
      period_start: state.antonyPlannerPeriodRange.start,
      period_end: plannerPeriodEnd(),
      target_new_customers: goal.targetNewCustomers,
      target_revenue_cents: goal.targetRevenueCents,
      customer_value_cents: goal.customerValueCents,
      appointment_to_closer_rate_override: goal.appointmentToCloserRateOverride,
      show_rate_override: goal.showRateOverride,
      closing_rate_override: goal.closingRateOverride,
      decision_rate_override:goal.decisionRateOverride,confirmation_rate_override:goal.confirmationRateOverride,
    });
    state.plannerOpen = true;
    renderAntony();
    document.querySelector("#antony-plan-status").textContent = "Zielplan gespeichert.";
  } catch (error) {
    status.textContent = `Speichern fehlgeschlagen: ${error.message}`;
  }
});

function samplePreview() {
  const people = [
    { id: "p1", slug: "michael", display_name: "Michael Giesbrecht", color: "#3b9dff", sort_order: 10 },
    { id: "p2", slug: "felix", display_name: "Felix Wenk", color: "#f5a524", sort_order: 20 },
  ];
  state.people = people;
  state.metrics = {
    michael: { slug: "michael", displayName: "Michael Giesbrecht", color: "#3b9dff", callsGross: 479, callsNet: 312, netRate: 65.1, talkMinutes: 642, gatekeeper: 186, connected: 121, connectionRate: 65.1, directDecisionMakers: 44, decisionMakers: 165, appointments: 58, appointmentRate: 35.2, mailbox: 31, outsideBusinessHours: 7, dealsWon: 7, winRate: 12.1, revenue: 4200000, newsletters: null },
    felix: { slug: "felix", displayName: "Felix Wenk", color: "#f5a524", callsGross: 408, callsNet: 233, netRate: 57.1, talkMinutes: 401, gatekeeper: 152, connected: 68, connectionRate: 44.7, directDecisionMakers: 27, decisionMakers: 95, appointments: 21, appointmentRate: 22.1, mailbox: 18, outsideBusinessHours: 11, dealsWon: 3, winRate: 14.3, revenue: 1600000, newsletters: null },
  };
  state.periodRange = { start: "2026-09-01", end: "2026-09-30" };
  // Wie die echten Ziele: 150 Brutto-Anrufe je Arbeitstag und 25 % Terminquote.
  state.targets = ["p1", "p2"].map((id) => ({
    sales_person_id: id, period_start: "2026-09-01", period_end: "2026-09-30",
    calls_gross: 150 * 22, calls_net: 0, gatekeeper_contacts: 0, connected_calls: 0,
    decision_maker_contacts: 0, appointments: 0,
    transfer_rate_target: null, appointment_rate_target: 25,
  }));
  state.hours = [];
  for (let hour = 8; hour <= 17; hour += 1) {
    const shape = [38, 52, 61, 57, 34, 41, 66, 72, 59, 44][hour - 8];
    people.forEach((person, index) => {
      const callsGross = 40 - index * 12;
      const callsNet = 24 - index * 8;
      const mailboxCalls = [5, 3, 1, 2, 4, 2, 1, 1, 2, 4][hour - 8] - (index && hour % 2 === 0 ? 1 : 0);
      const outsideBusinessHoursCalls = [3, 1, 0, 0, 1, 0, 0, 0, 1, 3][hour - 8];
      const decisionMakers = Math.max(2, Math.round((shape / 100) * (10 - index * 2)));
      state.hours.push({
        slug: person.slug, metric_hour: hour,
        calls_gross: callsGross, calls_net: callsNet,
        mailbox_calls: Math.max(0, mailboxCalls),
        outside_business_hours_calls: outsideBusinessHoursCalls,
        productive_calls: Math.max(0, callsNet - mailboxCalls - outsideBusinessHoursCalls),
        net_rate: shape - 6 + index * 3,
        gatekeeper_contacts: 18 - index * 5, connected_calls: 10 - index * 3,
        decision_maker_contacts: decisionMakers,
        appointments: Math.max(0, Math.round(decisionMakers * (0.18 + ((hour - 8) % 4) * 0.05))),
        transfer_rate: shape - index * 11,
      });
    });
  }
  state.trendHours = state.hours;
  state.trends = ["2026-09-01", "2026-08-01", "2026-07-01"].flatMap((month, monthIndex) =>
    people.map((person, index) => ({
      month_start: month, slug: person.slug, display_name: person.display_name, color: person.color,
      calls_gross: 479 - index * 71 - monthIndex * 40,
      calls_net: 312 - index * 79 - monthIndex * 25,
      net_rate: 65.1 - index * 8 - monthIndex * 2,
      gatekeeper_contacts: 186 - index * 34 - monthIndex * 15,
      connected_calls: 121 - index * 53 - monthIndex * 9,
      connection_rate: 65.1 - index * 20.4 - monthIndex * 2,
      decision_maker_contacts: 165 - index * 70 - monthIndex * 12,
      appointments: 58 - index * 37 - monthIndex * 4,
      appointment_rate: 35.2 - index * 13.1 - monthIndex,
    })));
  state.profile = { displayName: "Vorschau", role: "operator", salesPersonId: null, email: null };
  state.closing = {
    appointments: 79,
    setter_calls: 68,
    setter_successes: 45,
    setter_success_rate: 66.2,
    closer_calls: 37,
    closer_second_calls: 9,
    decided_closer_calls: 28,
    closer_sales: 8,
    closer_success_rate: 28.6,
    new_customers: 8,
  };
  state.antonyGoal = {
    period_type: "month",
    period_start: "2026-09-01",
    period_end: "2026-09-30",
    target_new_customers: 4,
    target_revenue_cents: 4_000_000,
    customer_value_cents: 1_000_000,
    appointment_to_closer_rate_override: null,
    show_rate_override: null,
    closing_rate_override: null,
  };
  state.antonyCustomerValueCents = state.antonyGoal.customer_value_cents;
  state.antonyRateMode = "current";
  state.antonyPlannerMetrics = state.metrics;
  state.antonyPlannerClosing = state.closing;
  state.antonyPlannerPeriodRange = { start: "2026-09-01", end: "2026-09-30" };
  state.weeklyReview = {
    week_start: "2026-08-24",
    week_end: "2026-08-28",
    content: [
      "Die Terminquote lag innerhalb des internen Zielkorridors.",
      "Der größte Engpass lag zwischen Entscheiderkontakt und Termin.",
      "Closer-Periodenverhältnis und Terminquote lagen unter der Vorwoche; wegen nur vier Closer Calls ist diese Tendenz noch nicht belastbar.",
      "Antony sollte nächste Woche die Durchführung bereits terminierter Closer Calls priorisieren.",
      "Prüfe jeden offenen Closer-Termin am Vortag und bestätige ihn verbindlich.",
    ].join("\n"),
  };
  state.antonyProcess = {
    period: {start:"2026-09-01",end:"2026-09-07"},
    activity: {followup_contacts:12,further_followups:4,followup_appointments:3,followup_disqualified:2,followup_no_interest:1,
      setter_calls:10,setter_qualified:4,setter_followups:3,setter_disqualified:2,setter_unrated:1,
      setter_no_shows:1,setter_cancellations:2,setter_rescheduled:1,closer_no_shows:1,closer_cancellations:0,closer_rescheduled:2,
      closer_calls:5,cc1_sales:1,cc2_agreed:2,cc2_sales:1,closer_lost:1,closer_unrated:0},
    lead_quality:{assessed_leads:8,qualified:4,followup:2,disqualified:1,unrated:1},
    booking_cohort:[{source:"LinkedIn",owner:"michael",booked_leads:6,setter_arrived:3,not_in_setter:3,pending:1,no_show:1,cancelled:0,rescheduled:1,qualified:2,followup:1,disqualified:0,unrated:0,closer_arrived:1,sold_leads:1,new_customers:1},
      {source:"Cold Calling",owner:"felix",booked_leads:4,setter_arrived:2,not_in_setter:2,pending:1,no_show:0,cancelled:1,rescheduled:0,qualified:1,followup:0,disqualified:1,unrated:0,closer_arrived:1,sold_leads:0,new_customers:0}],
    quality_by_source:[{source:"LinkedIn",owner:"michael",attribution:"booking_activity",assessed_leads:5,qualified:3,followup:1,disqualified:0,unrated:1},
      {source:"Cold Calling",owner:"felix",attribution:"current_opener",assessed_leads:3,qualified:1,followup:1,disqualified:1,unrated:0}]
  };
  state.antonyProcess.reporting_version="2026-09-08.journey-v2";
  state.antonyProcess.funnel_by_source=state.antonyProcess.booking_cohort.map(row=>({
    ...Object.fromEntries(JOURNEY_KEYS.map(key=>[key,0])),booked_leads:row.booked_leads,setter_arrived:row.setter_arrived,
    closer_qualified:row.qualified,closer_arrived:Math.min(row.closer_arrived,row.qualified),decided_leads:row.sold_leads,
    sold_leads:row.sold_leads,new_customers:row.new_customers,observed_customers:row.new_customers,source:row.source,owner:row.owner,
  }));
  // Synthetic preview data exercise the same persistent-flow contract as live reports.
  state.antonyProcess.coverage={retention_start:"2026-07-01",complete_period:true,history_complete:true};
  state.antonyProcess.cohort_history=state.antonyProcess.funnel_by_source.map(row=>({...row,booked_date:"2026-09-03"}));
  state.antonyProcess.booking_cohort_history=state.antonyProcess.booking_cohort.map(row=>({...row,booked_date:"2026-09-03"}));
  state.antonyProcess.activity_by_origin=[{...state.antonyProcess.activity,source:"LinkedIn",owner:"michael",booked_date:"2026-08-01"}];
  state.antonyProcess.flow={new_processes:10,carried_in:24,first_qualified:32,repeat_setter_calls:18,unlinked_setter_calls:1,cohort_basis:"first_scheduled_meeting"};
  state.antonyProcess.setter_attendance={period_start:"2026-09-01",period_end:"2026-09-07",data_as_of:"2026-09-07T16:00:00Z",by_source:[{source:"LinkedIn",owner:"michael",scheduled:6,elapsed:6,future:0,attended:3,no_show:1,cancelled:0,rescheduled:1,unknown:1},{source:"Cold Calling",owner:"felix",scheduled:4,elapsed:4,future:0,attended:2,no_show:0,cancelled:1,rescheduled:0,unknown:1}]};
  state.antonyPlannerProcess=state.antonyProcess;
  state.antonyPipeline = {
    critical_counts:{no_show:1,cancelled:1,without_meeting:2},
    critical_cases:[{lead_id:"lead_preview",process_id:"preview",stage:"setter",reason:"no_show",status_since:"2026-09-07T09:00:00Z"}],
    scheduled_meetings:[{lead_id:"lead_previewCalendar",meeting_id:"preview",starts_at:"2026-10-14T09:30:00Z",stage:"setter"}],
    persistent:true, data_as_of:"2026-09-07T16:00:00Z", next_by_month:[{month:"2026-09-01",stage:"setter",count:3},{month:"2026-10-01",stage:"setter",count:2}],
    as_of: "2026-09-07",
    window_start: "2026-07-01",
    retention_months: 3,
    counts: {
      total_open: 19,
      setter_planned: 5,
      setter_pending: 3,
      closer_scheduled: 5,
      rescheduled_closer: 2,
      pending_decision_cc2: 4,
      from_previous_months: 6,
      older_than_14_days: 2,
    },
    oldest_open_date: "2026-07-22",
  };
  const previewPerformanceLength = state.period === "week" ? 5 : 14;
  const previewPerformancePoints = state.period === "day"
    ? Array.from({ length: 10 }, (_, index) => ({
        bucket_label: `${String(index + 8).padStart(2, "0")}:00`,
        appointments_cumulative: Math.round((79 * (index + 1)) / 10),
        closer_appointments_cumulative: Math.round((45 * (index + 1)) / 10),
        closer_calls_cumulative: Math.round((37 * (index + 1)) / 10),
        new_customers_cumulative: null,
      }))
    : Array.from({ length: previewPerformanceLength }, (_, index) => ({
        bucket_label: `${String(index + 1).padStart(2, "0")}.09.`,
        appointments_cumulative: Math.round((79 * (index + 1)) / previewPerformanceLength),
        closer_appointments_cumulative: Math.round((45 * (index + 1)) / previewPerformanceLength),
        closer_calls_cumulative: Math.round((37 * (index + 1)) / previewPerformanceLength),
        new_customers_cumulative: Math.round((8 * (index + 1)) / previewPerformanceLength),
      }));
  const previewDivisor=previewPerformancePoints.length;
  state.antonyPerformance = previewPerformancePoints.map((point,index)=>({...point,bucket_date:state.period === "day" ? "2026-09-07" : `2026-09-${String(index+1).padStart(2,"0")}`,metric_hour:state.period === "day" ? index+8 : null}));
  state.antonyProcess.timeline=state.antonyPerformance.map((point,index)=>({date:point.bucket_date,hour_bucket:point.metric_hour??12,
    setter_calls:Math.round(68*(index+1)/previewDivisor)-Math.round(68*index/previewDivisor),
    cc2_agreed:Math.round(9*(index+1)/previewDivisor)-Math.round(9*index/previewDivisor),
    first_qualified:Math.round(32*(index+1)/previewDivisor)-Math.round(32*index/previewDivisor)}));
  state.series = [];
  for (let day = 1; day <= 14; day += 1) {
    const datum = `2026-09-${String(day).padStart(2, "0")}`;
    const welle = Math.sin(day / 2.2);
    people.forEach((person, index) => {
      state.series.push({
        metric_date: datum,
        slug: person.slug,
        calls_net: Math.round(26 - index * 9 + welle * 7),
        connection_rate: Math.round(62 - index * 19 + welle * 9),
        appointments: Math.max(0, Math.round(4 - index * 2 + welle * 2)),
        appointment_rate: Math.round(34 - index * 12 + welle * 6),
      });
    });
  }
  state.syncRun = { status: "success", started_at: "2026-09-02T14:08:43Z", completed_at: "2026-09-02T14:08:47Z", fetched_records: 45, upserted_records: 90 };
  state.status = "preview";
}

// Ein Abschnitt für sich, ohne Kopfzeile, Navigation und Fußzeile — damit sich
// jeder Block später per iframe einbetten lässt, ohne den Code zu spalten.
function applyWidgetMode(name) {
  state.widget = name;
  document.body.classList.add("is-widget");
  document.querySelectorAll("[data-widget]").forEach((section) => {
    section.hidden = section.dataset.widget !== name;
  });
  document.querySelector("#topbar").hidden = true;
  document.querySelector("#workspace-header").hidden = true;
  document.querySelector("#footer").hidden = true;
  document.querySelector("#manager-section").hidden = true;
  document.querySelector("#operations-section").hidden = true;
}

function boot() {
  readInitialState();
  // Das Abzeichen ändert sich laufend. Beim Tageswechsel folgt die
  // Standardansicht dem neuen Berliner Datum und fragt die neuen Tageswerte
  // nach; ein bewusst gewählter historischer Stichtag bleibt unverändert.
  setInterval(() => {
    if (state.status !== "live") return;
    const today = berlinToday();
    if (!state.datePinned && state.referenceDate !== today) {
      state.referenceDate = today;
      document.querySelector("#reference-date").value = today;
      refresh();
      return;
    }
    renderSyncBadge();
  }, 20000);
  document.querySelector("#reference-date").value = state.referenceDate;

  const params = new URLSearchParams(window.location.search);
  const widget = params.get("widget");
  if (widget) applyWidgetMode(widget);

  if (params.get("preview") === "1") {
    document.querySelector("#preview-banner").hidden = false;
    samplePreview();
    showApp(true);
    render();
    return;
  }

  if (!data.isConfigured) {
    showApp(false);
    document.querySelector("#login-form").hidden = true;
    document.querySelector("#login-status").textContent =
      "Supabase ist noch nicht verbunden: In config.js fehlt der Publishable Key.";
    return;
  }

  data.onAuthChange((event, session) => {
    if (!session) {
      endSession();
      return;
    }
    // Supabase kennzeichnet einen Einladungs-/Wiederherstellungslink als
    // PASSWORD_RECOVERY. Der Link darf nur die Passwortseite öffnen, nie die
    // Kennzahlen. Bei eingeladenen Konten greift zusätzlich die serverseitige
    // must_change_password-Sperre aus dem Profil.
    if (event === "PASSWORD_RECOVERY") state.forcePasswordSetup = true;
    // Focus and token refresh can emit another sign-in event for the same user.
    // They must not restart every dashboard query or compete with boot().
    if (["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].includes(event) && state.sessionUserId === session.user.id) return;
    if (!state.passwordChangeInProgress) startSession().catch(reportStartupFailure);
  });

  data.currentSession()
    .then((session) => { if (session) return startSession(); showApp(false); })
    .catch(reportStartupFailure);
}

boot();
