import {createReadRecovery,isTransientReadError,isAccessError} from './read-recovery.mjs?v=2026-09-10-recovery';
import { renderOpeningMonthly } from './opening-monthly-view.mjs?v=2026-09-10-plain-comparison';
import { renderHistoryChart } from './lead-history-chart.mjs?v=2026-09-11-dual-setting';
import { filterLeadReport } from './lead-selection-model.mjs?v=2026-09-11-dual-setting';
import { renderLeadFilters } from './lead-selection-filters.mjs?v=2026-09-11-dual-setting';
import { renderSelectionReport, renderLeadEvidence, selectionPreview } from "./lead-selection-view.mjs?v=2026-09-11-dual-setting";
import { workdaysBetween, goalPeriodRange, salesTargetForRange, grossCallPerformanceClass } from "./sales-goals.mjs?v=2026-09-09-cc2-evidence-fix";
import { installChartPopover } from "./chart-popover.mjs?v=2026-09-10-separate-groups";
installChartPopover();
import { escapeHtml, safeColor } from "./render-security.mjs?v=2026-09-09-cc2-evidence-fix";
// Die Versionskennung an allen Datei-Verweisen sorgt dafür, dass ein Browser
// nach einer Veröffentlichung nicht die alte Datei weiterbenutzt. Sie steht in
// index.html, hier und in data.js und wird bei jedem Release erhöht.
import * as data from "./data.js?v=2026-09-10-usage";
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

const periodLabels = { day: "Tag", week: "Woche", month: "Monat", trend: "3 Monate" };
const viewCopy = {
  team: ["Gemeinsamer Wettbewerb", "Michael gegen Felix", "Alle Kernkennzahlen getrennt, vergleichbar und als Team zusammengeführt."],
  antony: ["Vertriebssteuerung", "Antony im Fokus", "Relevante Leads von Setting bis Neukunde, aufgeteilt nach aktuellem Close-Status."],
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
  antonyLeadReport: null,
  leadSelection: "setting",
  leadDimension: "lead_source",
  leadFilters: {role:"owner"},
  leadChartSeries: ["setting_source","setting","setter_show","cc1_show","cc2_show","customer"],
  periodRange: { start: null, end: null },
  profile: { displayName: null, role: "sales", salesPersonId: null, mustChangePassword: false, email: null },
  syncRun: null,
  heatmapRate: "quality",
  series: [],
  trendHours: [],
  trendRate: "quality",
  openingView: "months",
  openingChartUnit: "counts",
  openingChartMetrics: ["calls_gross","net_rate"],
  goalsVisible: false,
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
let backgroundRefreshPending = false;
let refreshInFlight = false;
let lastCompleteContext = null;
const readContext=()=>[state.sessionUserId,state.view==='antony'?'antony':'opening',state.period,state.referenceDate].join('|');
async function loadAll(revision = refreshRevision) {
  const period=state.period,referenceDate=state.referenceDate,view=state.view;
  const optionalErrors=[];
  const optional=async(label,request,fallback)=>{
    try{return await request();}catch(error){
      if(!isTransientReadError(error))throw error;
      optionalErrors.push({label,error});return fallback;
    }
  };
  const unchanged=()=>revision===refreshRevision && period===state.period && referenceDate===state.referenceDate && view===state.view;
  if (canViewAntony() && view === "antony") {
    const [people,report,syncRun] = await Promise.all([
      optional("Mitarbeiterliste",()=>data.loadPeople(),state.people||[]),data.loadAntonyLeadReport(period,referenceDate),
      state.profile.role === "operator" ? optional("Sync-Status",()=>data.loadLatestSyncRun(),state.syncRun||null) : null,
    ]);
    if (!unchanged()) return false;
    Object.assign(state,{people,antonyLeadReport:report,periodRange:report.period,syncRun,lastCalculated:report.data_as_of,optionalErrors});
    return true;
  }
  const goalsRange=goalPeriodRange(period,referenceDate);
  const [people,metricRows,hourRows,trends,trendHours,transferBreakdown] = await Promise.all([
    data.loadPeople(),data.loadMetrics(period,referenceDate),data.loadHourPerformance(period,referenceDate),
    period === "month" ? data.loadTrends(referenceDate) : [],
    period === "month" ? data.loadHourPerformance("trend",referenceDate) : [],
    data.loadTransferBreakdown(period,referenceDate),
  ]);
  const first=metricRows[0],periodRange=first?{start:first.period_start,end:first.period_end}:{start:referenceDate,end:referenceDate};
  const [series,targets,syncRun]=await Promise.all([
    data.loadDailySeries(periodRange.start,periodRange.end),data.loadTargets(goalsRange.start,goalsRange.end),
    state.profile.role === "operator" ? optional("Sync-Status",()=>data.loadLatestSyncRun(),state.syncRun||null) : null,
  ]);
  if(!unchanged()) return false;
  const metrics=Object.fromEntries(metricRows.map(row=>[row.slug,toPerson(row)]));
  for(const person of people){
    const m=metrics[person.slug];if(!m)continue;
    const own=hourRows.filter(row=>row.slug===person.slug);
    m.mailbox=own.reduce((n,row)=>n+Number(row.mailbox_calls??0),0);
    m.outsideBusinessHours=own.reduce((n,row)=>n+Number(row.outside_business_hours_calls??0),0);
  }
  const times=series.map(row=>row.calculated_at).filter(Boolean).sort();
  Object.assign(state,{people,metrics,hours:hourRows,trends,trendHours,series,targets,periodRange,syncRun,transferBreakdown,
    antonyLeadReport:null,lastCalculated:times.at(-1)??null,optionalErrors});
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
      name: "Antony",
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
    if(button.dataset.period === "trend") button.hidden=state.view !== "antony";
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
  document.querySelector("#reference-date").max=antonyView?berlinToday():"";
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
      const goalLabel = metric.key === "callsGross"
        ? `${{day:"Tagesziel",week:"Wochenziel",month:"Monatsziel"}[state.period] || "Ziel"}: ${number(target)}`
        : metric.key === "appointmentRate" ? `Ziel: ${percent(target)}` : null;
      return `
        <div class="core-value ${tone}">
          <span class="core-label">${metric.label}</span>
          <strong>${metric.format(value)}</strong>
          ${target !== null && goalLabel ? `<small class="core-target">${escapeHtml(goalLabel)}</small>` : ""}
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

function renderAntony() {
  document.dispatchEvent(new Event("dashboard-private-reset"));
  const leadDialog=document.querySelector("#lead-evidence-dialog");
  leadDialog.close();leadDialog.innerHTML="";
  const report=filterLeadReport(state.antonyLeadReport,state.leadFilters);
  const profile=document.querySelector("#antony-profile-avatar");
  profile.innerHTML=renderDashboardAvatar("antony","Antony");
  enableProfileImageFallbacks(profile);
  document.querySelector("#antony-lead-report").innerHTML=renderSelectionReport(report,state.leadSelection,state.leadDimension,state.leadChartSeries);
  const filterControls=document.querySelector("#lead-filter-controls");
  if(filterControls)filterControls.innerHTML=renderLeadFilters(state.antonyLeadReport,state.leadFilters);
  const at=report?.data_as_of;
  document.querySelector("#antony-data-time").textContent=at?`Aktueller Status · Stand ${new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",dateStyle:"short",timeStyle:"short"}).format(new Date(at))} Uhr`:"Leaddaten werden geladen …";
}

// Zielerreichung getrennt von den Kernwerten: Nicht jede Kennzahl hat ein Ziel,
// und die beiden vereinbarten Ziele bleiben getrennt von zielfreien Quoten.
const GOAL_METRICS = [
  ["callsGross", "Anrufe brutto", "calls_gross", number],
  ["appointmentRate", "Entscheider → Termin", "appointment_rate_target", percent],
];

function renderGoals() {
  document.querySelector("#goal-strip").hidden=!state.goalsVisible;
  document.querySelector("#toggle-goals").setAttribute("aria-expanded",String(state.goalsVisible));
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
    : `<p class="goal-hint">150 Brutto-Anrufe je Arbeitstag und Person · 25 % Entscheider → Termin. Andere Quoten ohne Ziel.</p>`+zeilen.join("");
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

function renderOpeningReview() {
  document.querySelector("#opening-monthly-kpis").innerHTML=renderOpeningMonthly(state.trends,state.people,state.view,state.referenceDate,state.openingView,{unit:state.openingChartUnit,metrics:state.openingChartMetrics});
}

function renderTrendHours() {
  renderOpeningReview();
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
  const label = state.status === "live" ? (state.backgroundError?"Letzter Datenstand":"Live-Daten")
    : state.status === "preview" ? "Designvorschau"
    : state.status === "loading" ? "Lädt" : "Getrennt";
  let note;
  if (state.status === "live") {
    const her = minutesSince(state.lastCalculated);
    const bis = minutesToNextSync();
    const zuletzt = her === null ? "Stand unbekannt" : her < 1 ? "gerade aktualisiert" : `zuletzt vor ${her} Min`;
    note = state.backgroundError?`${zuletzt} · ${state.backgroundRetry?"Verbindung wird automatisch erneut geprüft":"Aktualisierung fehlgeschlagen"}`:state.optionalErrors?.length?`${zuletzt} · ${state.optionalErrors.map(e=>e.label).join(", ")} wird erneut geladen`:`${zuletzt} · nächster Lauf in ~${bis} Min`;
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
  document.body.classList.toggle("is-opening-view",["team","michael","felix"].includes(state.view));
  const leadDialog=document.querySelector("#lead-evidence-dialog");
  leadDialog.close();leadDialog.innerHTML="";
  if (state.view === "antony" && !canViewAntony()) {
    const own = state.people.find((person) => person.id === state.profile.salesPersonId);
    state.view = own?.slug ?? "team";
  }
  renderNav();
  renderHeader();
  if (state.view === "antony") {
    renderAntony();
    renderSyncBadge();
    updateUrl();
    return;
  }
  renderCore();
  renderGoals();
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

async function refresh({background=false}={}) {
  if(background && refreshInFlight){backgroundRefreshPending=true;return;}
  if (new URLSearchParams(location.search).get("preview") === "1") {samplePreview();render();return;}
  const keepSnapshot=lastCompleteContext===readContext();
  background=keepSnapshot;
  const revision=++refreshRevision;
  refreshInFlight=true;
  const shell=document.querySelector(".app-shell");
  try {
    document.querySelector("#load-error").hidden=true;
    if(!keepSnapshot){
      state.status="loading";shell.setAttribute("aria-busy","true");shell.dataset.stale="true";
      renderNav();renderHeader();updateUrl();
    }
    renderSyncBadge();
    if(!await loadAll(revision))return;
    lastCompleteContext=readContext();
    state.status="live";state.error=null;state.backgroundError=false;delete shell.dataset.stale;document.querySelector("#retry-load").hidden=true;
    document.querySelector("#load-error").hidden=true;render();
    if(state.optionalErrors?.length)recovery.failed(state.optionalErrors[0].error);else recovery.success();
  } catch(error) {
    if(revision!==refreshRevision)return;
    recovery.failed(error);
    if(keepSnapshot&&!isAccessError(error)){
      state.status="live";state.backgroundError=true;state.backgroundRetry=isTransientReadError(error);renderSyncBadge();
      document.querySelector("#retry-load").hidden=false;return;
    }
    lastCompleteContext=null;
    shell.dataset.stale="true";document.querySelector("#retry-load").hidden=false;
    state.antonyLeadReport=null;
    document.querySelector("#antony-lead-report").innerHTML="";
    const dialog=document.querySelector("#lead-evidence-dialog");dialog.close();dialog.innerHTML="";
    document.dispatchEvent(new Event("dashboard-private-reset"));
    document.querySelector("#antony-section").hidden=true;
    document.querySelector("#widget-kernwerte").hidden=true;
    const message=isAccessError(error)?"Zugriff konnte nicht bestätigt werden. Bitte erneut anmelden.":isTransientReadError(error)
      ? "Verbindung vorübergehend unterbrochen. Die Daten werden automatisch erneut geladen."
      : "Die ausgewählte Auswertung konnte nicht geladen werden. Bitte erneut versuchen.";
    showError(message);
    console.warn("Dashboard-Abruf fehlgeschlagen",{abfrage:error.label||"Auswertung",code:error.code||error.name,status:error.status});
  } finally {
    if(revision===refreshRevision){
      refreshInFlight=false;shell.removeAttribute("aria-busy");
      if(backgroundRefreshPending){backgroundRefreshPending=false;recovery.signal();}
    }
  }
}

// Scheitert der Start nach erfolgreicher Anmeldung, ist die Anmeldemaske der
// einzige Ort, an dem die Meldung ankommt — die Anwendung selbst ist dann noch
// nicht sichtbar.
function reportStartupFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  document.querySelector("#login-status").textContent = isTransientReadError(error)?"Verbindung vorübergehend unterbrochen. Die Anmeldung wird automatisch erneut geprüft.":`Anmeldung konnte nicht abgeschlossen werden: ${message}`;
  showApp(false);
  showError(message);
  recovery.failed(error);
}

function showApp(visible) {
  if(!visible){const dialog=document.querySelector("#lead-evidence-dialog");dialog.close();dialog.innerHTML="";
    document.querySelector("#antony-lead-report").innerHTML="";
    document.querySelector("#lead-filter-controls")?.replaceChildren();
    document.dispatchEvent(new Event("dashboard-private-reset"));}
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
  const promise = initializeSession(generation).catch(error=>{if(generation===sessionGeneration)throw error;});
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
  state.unsubscribe = data.subscribeToUpdates(() => recovery.signal());
}

function endSession() {
  sessionExpected=false;recovery.stop();
  for(const id of ['core-grid','goal-strip','series-legend','series-charts','transfer-donuts','funnel','hours-chart','opening-monthly-kpis','trend-hours','details-row'])document.getElementById(id)?.replaceChildren();
  backgroundRefreshPending=false;refreshInFlight=false;lastCompleteContext=null;
  Object.assign(state,{people:[],metrics:{},hours:[],trends:[],trendHours:[],series:[],targets:[],optionalErrors:[],lastCalculated:null,syncRun:null});
  sessionGeneration++;
  state.sessionUserId = null;
  refreshRevision++;
  state.antonyLeadReport=null;state.transferBreakdown=null;
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.profile = { displayName: null, role: "sales", salesPersonId: null, mustChangePassword: false, email: null };
  state.antonyLeadReport=null;
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
  if (period && periodLabels[period] && (period!=="trend" || view==="antony")) state.period = period;
  if (date && params.get("historisch") === "1" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    state.referenceDate = state.view === "antony" ? [date,berlinToday()].sort()[0] : date;
    state.datePinned = true;
  }
}

document.querySelector("#retry-load").addEventListener("click",()=>refresh());

document.addEventListener("click", (event) => {
  if(canViewAntony() && state.view==="antony") {
    if(event.target.closest("[data-reset-lead-filters]")){state.leadFilters={role:"owner"};renderAntony();return;}
    const source=event.target.closest("[data-lead-source]");
    if(source){state.leadSelection=source.dataset.leadSource;renderAntony();return;}
    const detail=event.target.closest("[data-lead-evidence]");
    if(detail){const dialog=document.querySelector("#lead-evidence-dialog");
      dialog.innerHTML=renderLeadEvidence(filterLeadReport(state.antonyLeadReport,state.leadFilters),state.leadSelection,state.leadDimension,detail.dataset.leadEvidence,detail.dataset.leadValue);
      dialog.showModal();return;}
  }
  if(event.target.closest("[data-close-lead-dialog]")){document.querySelector("#lead-evidence-dialog").close();return;}
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    if (viewButton.dataset.view === "antony" && !canViewAntony()) return;
    const previousView = state.view;
    state.view = viewButton.dataset.view;
    if(state.view!=="antony" && state.period==="trend") state.period="month";
    if(state.view === "antony" && state.referenceDate > berlinToday()){state.referenceDate=berlinToday();document.querySelector("#reference-date").value=state.referenceDate;}
    if (previousView !== state.view && (previousView === "antony" || state.view === "antony")) refresh();
    else {render();if(state.status==="error")refresh();}
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if(event.target.closest("#toggle-goals")){state.goalsVisible=!state.goalsVisible;renderGoals();return;}
  const openingViewButton=event.target.closest("[data-opening-view]");
  if(openingViewButton && ["team","michael","felix"].includes(state.view)){
    state.openingView=openingViewButton.dataset.openingView==="development"?"development":"months";
    renderOpeningReview();document.querySelector(`[data-opening-view="${state.openingView}"]`).focus();return;
  }
  const openingUnitButton=event.target.closest("[data-opening-unit]");
  if(openingUnitButton && canViewThreeMonthReview()){
    state.openingChartUnit=openingUnitButton.dataset.openingUnit==="rates"?"rates":"counts";
    renderOpeningReview();document.querySelector(`[data-opening-unit="${state.openingChartUnit}"]`).focus();return;
  }
  const periodButton = event.target.closest("[data-period]");
  if (periodButton) {
    state.period = periodButton.dataset.period;
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
  const selectedDate = state.view === "antony" ? [event.target.value || berlinToday(),berlinToday()].sort()[0] : event.target.value || berlinToday();
  event.target.value=selectedDate;
  state.referenceDate = selectedDate;
  state.datePinned = selectedDate !== berlinToday();
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
  state.antonyLeadReport=selectionPreview(state.referenceDate,state.period);
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

let sessionExpected=false;
const recovery=createReadRecovery(()=>state.sessionUserId?refresh({background:true}):startSession().catch(reportStartupFailure),{
  enabled:()=>sessionExpected&&!state.forcePasswordSetup&&!state.profile.mustChangePassword,
  visible:()=>document.visibilityState!=="hidden"&&navigator.onLine!==false,
});
document.addEventListener("visibilitychange",()=>recovery.visibilityChanged());
window.addEventListener("online",()=>recovery.signal());

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

  sessionExpected=true;
  data.onAuthChange((event, session) => {
    if (!session) {
      endSession();
      return;
    }
    sessionExpected=true;
    // Supabase kennzeichnet einen Einladungs-/Wiederherstellungslink als
    // PASSWORD_RECOVERY. Der Link darf nur die Passwortseite öffnen, nie die
    // Kennzahlen. Bei eingeladenen Konten greift zusätzlich die serverseitige
    // must_change_password-Sperre aus dem Profil.
    if (event === "PASSWORD_RECOVERY") state.forcePasswordSetup = true;
    // Focus and token refresh can emit another sign-in event for the same user.
    // They must not restart every dashboard query or compete with boot().
    if (["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"].includes(event) && state.sessionUserId === session.user.id) {
      if(state.status==="error"||state.backgroundError)recovery.resume();
      return;
    }
    if (!state.passwordChangeInProgress) startSession().catch(reportStartupFailure);
  });

  data.currentSession()
    .then((session) => { if (session) return startSession(); sessionExpected=false;showApp(false); })
    .catch(reportStartupFailure);
}

boot();

document.addEventListener("change",event=>{
 if(event.target.dataset.openingMetric && canViewThreeMonthReview()){
  const key=event.target.dataset.openingMetric;
  state.openingChartMetrics=[...state.openingChartMetrics.filter(k=>k.endsWith("_rate")!==key.endsWith("_rate")),key];
  renderOpeningReview();document.querySelector(`[data-opening-metric="${key}"]`).focus();return;
 }
 if(event.target.dataset.leadChartSeries && canViewAntony() && state.view==="antony"){
  const key=event.target.dataset.leadChartSeries;
  state.leadChartSeries=event.target.checked?[...new Set([...state.leadChartSeries,key])]:state.leadChartSeries.filter(k=>k!==key);
  const report=filterLeadReport(state.antonyLeadReport,state.leadFilters),group=report.groups.find(g=>g.key===state.leadSelection)||report.groups[0];
  document.querySelector("#lead-history-chart").innerHTML=renderHistoryChart(report,group,state.leadChartSeries);
  document.querySelector(`[data-lead-chart-series="${key}"]`).focus();return;
 }
 if(event.target.dataset.leadFilter && canViewAntony() && state.view==="antony"){
  const key=event.target.dataset.leadFilter;
  if(key==="role")state.leadFilters.employee="";
  state.leadFilters[key]=event.target.value;
  renderAntony();document.querySelector(`#lead-filter-${key}`).focus();return;
 }
 if(event.target.id==="lead-dimension" && canViewAntony() && state.view==="antony"){
  state.leadDimension=event.target.value;renderAntony();document.querySelector("#lead-dimension").focus();
 }
});

// Native Escape support is retained; backdrop clicks close without swallowing table clicks.
document.querySelector("#lead-evidence-dialog").addEventListener("click",event=>{
 const dialog=event.currentTarget;
 if(event.target!==dialog)return;
 const box=dialog.getBoundingClientRect();
 if(event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY>box.bottom)dialog.close();
});
