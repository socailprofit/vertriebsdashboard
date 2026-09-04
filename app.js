// Die Versionskennung an allen Datei-Verweisen sorgt dafür, dass ein Browser
// nach einer Veröffentlichung nicht die alte Datei weiterbenutzt. Sie steht in
// index.html, hier und in data.js und wird bei jedem Release erhöht.
import * as data from "./data.js?v=2026-09-04k";
import { calculateAntonyMonthForecast, calculateAntonyPlan } from "./antony-planner.mjs?v=2026-09-04k";
import {
  aggregateCallTimeRows,
  calculateCallTimeQuality,
  callTimeMetric,
} from "./call-time-score.mjs?v=2026-09-04k";

// Sobald die finalen Profilbilder vorliegen, muss nur hier der jeweilige Pfad
// (zum Beispiel "./assets/profiles/michael.webp") eingetragen werden. Bei null
// oder einem nicht ladbaren Bild bleibt automatisch der Initialen-Platzhalter.
const PROFILE_IMAGES = Object.freeze({
  michael: null,
  felix: null,
  antony: null,
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
  { key: "gatekeeper", label: "Vorzimmer", detail: "Gatekeeper erreicht", format: number, target: "gatekeeper_contacts" },
  { key: "connected", label: "Durchstellungen", detail: "Vom Vorzimmer durchgestellt", format: number, target: "connected_calls" },
  { key: "connectionRate", label: "Durchstellquote", detail: "Durchstellungen ÷ Vorzimmer", format: percent, rateTarget: "transfer_rate_target", ratio: ["connected", "gatekeeper"] },
  { key: "directDecisionMakers", label: "Entscheider direkt", detail: "Ohne Vorzimmer erreicht", format: number, noTarget: true },
  { key: "decisionMakers", label: "Entscheider gesamt", detail: "Direkt und durchgestellt", format: number, target: "decision_maker_contacts" },
  { key: "appointments", label: "Termine", detail: "Termin vereinbart", format: number, target: "appointments" },
  { key: "appointmentRate", label: "Terminquote", detail: "Termine ÷ Entscheider", format: percent, rateTarget: "appointment_rate_target", ratio: ["appointments", "decisionMakers"] },
  { key: "mailbox", label: "Mailbox", detail: "Close-Outcome 📮 Mailbox", format: number, noTarget: true },
  { key: "outsideBusinessHours", label: "Außerhalb Geschäftszeit", detail: "Close-Outcome außerhalb der Geschäftszeiten", format: number, noTarget: true },
  { key: "newsletters", label: "Newsletter-Abschlüsse", detail: "Close-Workflow: Ziel erreicht oder beendet", format: count, noTarget: true },
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
  antony: ["Closer-Strecke", "Antony im Fokus", "Termine von Michael und Felix bis zum Neukunden kompakt nachverfolgt."],
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
  antonyPerformance: [],
  antonyGoal: null,
  antonyCustomerValueCents: 0,
  plannerOpen: false,
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
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(`${isoDate}T12:00:00Z`));
}

function monthLabel(isoDate) {
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character]);
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

function canViewWeeklyReview() {
  // Vorlaeufig fuer alle vollstaendig angemeldeten Dashboard-Nutzer sichtbar.
  // Die spaetere Rigone-Sperre muss wieder hier UND im Datenbank-RPC erfolgen.
  return state.status === "preview" || Boolean(state.profile.email);
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
    connectionRate: Number(row.connection_rate),
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

async function loadAll() {
  // Erst die Kennzahlen laden: Sie sind die einzige verbindliche Quelle für
  // den Zeitraum. Die Tagesreihen dürfen nicht noch den Bereich der vorher
  // geöffneten Ansicht verwenden, wenn man Tag, Woche oder Monat umschaltet.
  const weeklyReviewRequest = canViewWeeklyReview()
    ? data.loadLatestWeeklyReview().catch(() => null)
    : Promise.resolve(null);
  // Der Dreimonatsrueckblick ist nur in der Monatsansicht relevant. Bei Tag
  // und Woche wird er weder angezeigt noch unnoetig im Hintergrund geladen.
  const trendsRequest = state.period === "month" ? data.loadTrends() : Promise.resolve([]);
  const trendHoursRequest = state.period === "month"
    ? data.loadHourPerformance("trend", state.referenceDate)
    : Promise.resolve([]);
  const [people, metricRows, hourRows, trends, trendHours, weeklyReview] = await Promise.all([
    data.loadPeople(),
    data.loadMetrics(state.period, state.referenceDate),
    data.loadHourPerformance(state.period, state.referenceDate),
    trendsRequest,
    trendHoursRequest,
    // Der Review ist eine optionale Zusatzanalyse fuer alle freigeschalteten
    // Dashboard-Konten; der RPC prueft den Zugang erneut serverseitig.
    weeklyReviewRequest,
  ]);

  state.people = people;
  state.hours = hourRows;
  state.trends = trends;
  state.trendHours = trendHours;
  state.weeklyReview = weeklyReview;
  state.metrics = {};
  metricRows.forEach((row) => { state.metrics[row.slug] = toPerson(row); });
  // Die Outcome-Zahlen gehören bewusst nur in die Detail- und Stundenebene.
  // Sie stammen aus demselben Stunden-RPC und verändern keine Kernkennzahl.
  for (const person of people) {
    const metrics = state.metrics[person.slug];
    if (!metrics) continue;
    const ownHours = hourRows.filter((row) => row.slug === person.slug);
    metrics.mailbox = ownHours.reduce((sum, row) => sum + Number(row.mailbox_calls ?? 0), 0);
    metrics.outsideBusinessHours = ownHours.reduce(
      (sum, row) => sum + Number(row.outside_business_hours_calls ?? 0),
      0,
    );
  }

  const first = metricRows[0];
  state.periodRange = first
    ? { start: first.period_start, end: first.period_end }
    : { start: state.referenceDate, end: state.referenceDate };

  const plannerPeriodRange = calendarMonthRange(state.referenceDate);
  const selectedClosingRequest = data.loadAntonyClosingMetrics(state.period, state.referenceDate);
  const plannerMetricsRequest = state.period === "month"
    ? Promise.resolve(metricRows)
    : data.loadMetrics("month", state.referenceDate);
  const plannerClosingRequest = state.period === "month"
    ? selectedClosingRequest
    : data.loadAntonyClosingMetrics("month", state.referenceDate);
  const [
    series, targets, antonyGoal, plannerMetricRows, closing, plannerClosing,
    antonyPipeline, antonyPerformance,
  ] = await Promise.all([
    // Tag bleibt ein einzelner Tag. Woche und Monat verwenden die gerade von
    // der Datenbank bestätigten Grenzen, nicht einen 14-Tage-Ersatzbereich.
    data.loadDailySeries(state.periodRange.start, state.periodRange.end),
    data.loadTargets(state.periodRange.start, state.periodRange.end),
    // Der Zielplan ist optional und darf das bestehende Tracking auch dann
    // nicht blockieren, wenn die neue Tabelle noch nicht ausgerollt wurde.
    data.loadAntonyGoal("month", plannerPeriodRange.start).catch(() => null),
    plannerMetricsRequest,
    selectedClosingRequest,
    plannerClosingRequest,
    // Beide neuen Antony-Auswertungen sind Zusatzmodule. Ein noch nicht
    // migrierter RPC darf die bestehenden Team-KPIs nicht blockieren.
    data.loadAntonyOpenPipeline(state.referenceDate).catch(() => null),
    data.loadAntonyPerformanceSeries(state.period, state.referenceDate).catch(() => []),
  ]);
  state.series = series;
  state.targets = targets;
  state.antonyGoal = antonyGoal;
  state.antonyCustomerValueCents = Number(antonyGoal?.customer_value_cents ?? 0);
  state.antonyRateMode = antonyGoal && [
    antonyGoal.appointment_to_closer_rate_override,
    antonyGoal.show_rate_override,
    antonyGoal.closing_rate_override,
  ].some((value) => value !== null) ? "custom" : "current";
  state.closing = closing;
  state.antonyPipeline = antonyPipeline;
  state.antonyPerformance = antonyPerformance;
  state.antonyPlannerMetrics = {};
  plannerMetricRows.forEach((row) => { state.antonyPlannerMetrics[row.slug] = toPerson(row); });
  state.antonyPlannerClosing = plannerClosing;
  state.antonyPlannerPeriodRange = plannerPeriodRange;
  // Wann die Kennzahlen zuletzt gerechnet wurden, steht in den Daten selbst.
  // Der Sync-Lauf wäre die genauere Quelle, ist aber der Betriebsrolle
  // vorbehalten — diese Angabe sieht jeder.
  const zeitstempel = series.map((row) => row.calculated_at).filter(Boolean).sort();
  state.lastCalculated = zeitstempel.length > 0 ? zeitstempel[zeitstempel.length - 1] : null;
  state.syncRun = state.profile.role === "operator" ? await data.loadLatestSyncRun() : null;
}

// --- Ziele -------------------------------------------------------------------

function workdaysBetween(startIso, endIso) {
  let count = 0;
  const cursor = new Date(`${startIso}T12:00:00Z`);
  const end = Date.parse(`${endIso}T12:00:00Z`);
  while (cursor.getTime() <= end) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

// Ein Ziel gilt für seinen eigenen Zeitraum. Deckt die Ansicht nur einen Teil
// davon ab, wird ein Zählwert anteilig verkleinert: Ein Monatsziel von 600
// Anrufen entspricht an einem Tag rund 20. Quotenziele werden nicht skaliert,
// eine Quote ist von der Dauer unabhängig.
function targetFor(personId, column) {
  // Eine Kennzahl ohne Ziel hat keine Zielspalte. Ohne diese Prüfung reicht
  // eine einzige zielfreie Kennzahl in den Kernwerten, um das gesamte Laden
  // abzubrechen — genau das ist am 2026-09-03 mit der Nettoquote passiert.
  if (!column) return null;
  const ids = Array.isArray(personId) ? personId : [personId];
  const isRate = column.endsWith("_target");
  const rates = [];
  let total = 0;
  let found = false;

  for (const target of state.targets) {
    if (!ids.includes(target.sales_person_id)) continue;
    const value = target[column];
    if (value === null || value === undefined) continue;

    if (isRate) {
      rates.push(Number(value));
      continue;
    }

    const overlapStart = target.period_start > state.periodRange.start ? target.period_start : state.periodRange.start;
    const overlapEnd = target.period_end < state.periodRange.end ? target.period_end : state.periodRange.end;
    if (overlapEnd < overlapStart) continue;

    const zielTage = workdaysBetween(target.period_start, target.period_end);
    if (zielTage === 0) continue;
    total += Number(value) * (workdaysBetween(overlapStart, overlapEnd) / zielTage);
    found = true;
  }

  if (isRate) return rates.length === 0 ? null : rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  // Ein Wochenende enthält keine Arbeitstage. Dann gibt es kein Ziel, statt
  // eines von null, an dem jede Zahl scheitern würde.
  if (!found) return null;
  const skaliert = Math.round(total);
  return skaliert === 0 ? null : skaliert;
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
  const antonyAvatar = renderPersonAvatar({
    slug: "antony",
    name: "Antony Rigone",
    initials: PROFILE_INITIALS.antony,
    image: PROFILE_IMAGES.antony,
  });
  buttons.push(`<button class="nav-button nav-button--person" data-view="antony">${antonyAvatar}<span>Antony</span></button>`);

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
  document.querySelector("#manager-section").hidden = state.view !== "chef" || !leads;
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
  metrics.connectionRate = safeRate(metrics.connected, metrics.gatekeeper);
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
    const score = entry.slug === "team" ? null : weightedScore(entry.metrics, entry.targetId);
    const values = coreMetrics().map((metric) => {
      const value = entry.metrics[metric.key];
      // metricTarget behandelt zielfreie Kennzahlen bereits richtig. Die
      // Detailansicht nutzt es, die Kernwerte taten es nicht — deshalb brach
      // hier alles ab, sobald eine Kennzahl ohne Ziel nach oben rückte.
      const target = metricTarget(metric, entry.targetId);
      const rating = value === null || target === null ? null : attainment(value, target);
      return `
        <div class="core-value ${performanceClass(rating)}">
          <span class="core-label">${metric.label}</span>
          <strong>${metric.format(value)}</strong>
          <small>${target === null ? "kein Ziel" : `Ziel ${metric.format(target)}`}</small>
        </div>`;
    }).join("");

    return `
      <article class="core-card" style="--person-color:${entry.color}">
        <header>
          <span class="core-identity">
            ${renderDashboardAvatar(entry.slug, entry.label)}
            <span class="core-name">${entry.label}</span>
          </span>
          <span class="core-score ${performanceClass(score)}">${score === null ? "" : `${score}%`}</span>
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
    appointmentToCloserRateOverride: plannerNumber(form, "appointment_to_closer_rate_override"),
    showRateOverride: plannerNumber(form, "show_rate_override"),
    closingRateOverride: plannerNumber(form, "closing_rate_override"),
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
  return antonyActuals(state.antonyPlannerMetrics, state.antonyPlannerClosing);
}

function plannerPeriodEnd() {
  return state.antonyPlannerPeriodRange.end;
}

function antonyMonthProgress() {
  const start = state.antonyPlannerPeriodRange.start;
  const end = state.antonyPlannerPeriodRange.end;
  if (!start || !end) return { elapsed: 0, remaining: 0, total: 0 };
  const progressDate = state.referenceDate < start
    ? null
    : (state.referenceDate > end ? end : state.referenceDate);
  const total = workdaysBetween(start, end);
  const elapsed = progressDate ? workdaysBetween(start, progressDate) : 0;
  return { elapsed, remaining: Math.max(0, total - elapsed), total };
}

function remainingPlannerWorkdays() {
  return antonyMonthProgress().remaining;
}

function canSaveAntonyGoal() {
  const email = String(state.profile.email ?? "").toLowerCase();
  return email === "rigone@socialprofit.de"
    || state.profile.role === "manager"
    || state.profile.role === "operator";
}

function renderAntonyPotential() {
  const container = document.querySelector("#antony-potential-values");
  const period = document.querySelector("#antony-potential-period");
  const basis = document.querySelector("#antony-potential-basis");
  const input = document.querySelector("#antony-ist-customer-value");
  const actual = antonyPlannerActuals();
  const progress = antonyMonthProgress();
  const forecast = calculateAntonyMonthForecast({
    actual,
    customerValueCents: state.antonyCustomerValueCents,
    elapsedWorkdays: progress.elapsed,
    totalWorkdays: progress.total,
  });
  const customerValueAvailable = state.antonyCustomerValueCents > 0;
  const projected = (value) => value === null ? "—" : number(value);

  if (document.activeElement !== input) {
    input.value = customerValueAvailable ? state.antonyCustomerValueCents / 100 : "";
  }

  const potential = [
    ["Michael", number(actual.michaelAppointments), `${projected(forecast.projectedMichaelAppointments)} Termine im Monatskurs`],
    ["Felix", number(actual.felixAppointments), `${projected(forecast.projectedFelixAppointments)} Termine im Monatskurs`],
    ["Gesamttermine", number(actual.appointments), `${projected(forecast.projectedAppointments)} bis Monatsende erwartet`],
    ["Closer-Termine", number(actual.closerAppointments), `${projected(forecast.projectedCloserAppointments)} bis Monatsende erwartet`],
    ["Shows", number(actual.closerCalls), `${projected(forecast.projectedCloserCalls)} bis Monatsende erwartet`],
    ["Neukunden gesamt", number(actual.newCustomers), `${projected(forecast.projectedCustomers)} bis Monatsende erwartet`],
    ["IST-Umsatz", customerValueAvailable ? euros(forecast.actualRevenueCents) : "—", customerValueAvailable ? "Neukunden bisher × Kundenwert" : "Oben nur den Kundenwert eintragen"],
    ["Monatsprognose", customerValueAvailable ? euros(forecast.projectedRevenueCents) : "—", customerValueAvailable && forecast.projectedRevenueCents !== null ? `${projected(forecast.additionalCustomers)} weitere Neukunden im Kurs` : "Sobald alle Ist-Raten belastbar sind"],
  ];

  period.textContent = monthLabel(state.antonyPlannerPeriodRange.start);
  basis.textContent = `${forecast.elapsedWorkdays} von ${forecast.totalWorkdays} Arbeitstagen · ${forecast.remainingWorkdays} offen`;
  container.innerHTML = potential.map(([label, value, detail], index) => `
    <article class="antony-potential-item ${index === 2 ? "is-total" : ""} ${label === "Monatsprognose" ? "is-forecast" : ""}">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${detail}</small>
    </article>`).join("");
}

function renderAntonyPlannerResults(goal) {
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
    ["Showrate", plan.effectiveRates.show],
    ["Closingrate", plan.effectiveRates.closing],
  ].filter(([, value]) => value === null || value <= 0).map(([label, value]) => value === 0 ? `${label} (aktuell 0 %)` : label);

  const targetParts = [`${number(plan.requiredCustomers)} Neukunden`, euros(goal.targetRevenueCents)];

  if (blockingRates.length > 0) {
    container.innerHTML = `
      <div class="antony-plan-lead">
        <span>Monatsziel · ${plannerMonth}</span>
        <strong>${targetParts.join(" · ")}</strong>
        <small>Für die Rückwärtsrechnung fehlt eine positive Basis: ${blockingRates.join(", ")}. Für ein Szenario auf „Eigene Raten“ umschalten.</small>
      </div>`;
    return;
  }

  const pipeline = [
    ["Termine von Michael + Felix", plan.requiredAppointments, actual.appointments],
    ["Closer-Termine", plan.requiredCloserAppointments, actual.closerAppointments],
    ["Entschiedene Closer Calls", plan.requiredDecidedCloserCalls, actual.decidedCloserCalls],
    ["Neukunden gesamt", plan.requiredCustomers, actual.newCustomers],
  ];
  const pipelineMarkup = pipeline.map(([label, required, achieved]) => {
    const progress = required > 0 ? Math.min(100, (achieved / required) * 100) : 0;
    const gap = Math.max(0, required - achieved);
    return `
      <article class="antony-plan-step">
        <span>${label}</span>
        <strong>${number(required)}</strong>
        <small>${number(achieved)} da · ${gap > 0 ? `noch ${number(gap)}` : "Zielmenge erreicht"}</small>
        <span class="antony-plan-track"><i style="width:${progress}%"></i></span>
      </article>`;
  }).join("");

  const rates = [
    ["Termin → Closer", plan.effectiveRates.appointmentToCloser, goal.appointmentToCloserRateOverride],
    ["Showrate", plan.effectiveRates.show, goal.showRateOverride],
    ["Closingrate", plan.effectiveRates.closing, goal.closingRateOverride],
  ].map(([label, value, override]) => `
    <span><b>${decimal(value)} %</b> ${label}<small>${override === null ? "aktuell" : "gesetzt"}</small></span>`).join("");

  const workdays = remainingPlannerWorkdays();
  const anchor = state.referenceDate === berlinToday() ? "Ab dem nächsten Arbeitstag" : `Nach dem ${germanDate(state.referenceDate)}`;
  const pace = workdays > 0
    ? `${anchor} bleiben ${number(workdays)} Arbeitstage: Ø ${decimal(plan.gaps.appointments / workdays)} Termine von Michael/Felix und Ø ${decimal(plan.gaps.closerAppointments / workdays)} Closer-Termine pro Arbeitstag.`
    : `Der gewählte Zeitraum enthält ab dem Stichtag keine weiteren Arbeitstage. Offen bleiben ${number(plan.gaps.appointments)} Termine und ${number(plan.gaps.customers)} Neukunden.`;

  container.innerHTML = `
    <div class="antony-plan-lead">
      <span>Monatsziel · ${plannerMonth}</span>
      <strong>${targetParts.join(" · ")}</strong>
      <small>${number(plan.requiredCustomers)} Neukunden ergeben sich automatisch aus Wunschumsatz ÷ Kundenwert.</small>
    </div>
    <div class="antony-plan-chain">${pipelineMarkup}</div>
    <div class="antony-plan-rates">${rates}</div>
    <p class="antony-plan-pace">${pace}</p>`;
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
  setValue("appointment_to_closer_rate_override", storedGoal.appointmentToCloserRateOverride ?? actualPlan.currentRates.appointmentToCloser ?? 60);
  setValue("show_rate_override", storedGoal.showRateOverride ?? actualPlan.currentRates.show ?? 80);
  setValue("closing_rate_override", storedGoal.closingRateOverride ?? actualPlan.currentRates.closing ?? 30);

  document.querySelector("#current-appointment-to-closer-rate").textContent = actualPlan.currentRates.appointmentToCloser === null
    ? "Aktuell noch keine belastbare Basis"
    : `Aktuell ${decimal(actualPlan.currentRates.appointmentToCloser)} %`;
  document.querySelector("#current-show-rate").textContent = actualPlan.currentRates.show === null
    ? "Aktuell noch keine belastbare Basis"
    : `Aktuell ${decimal(actualPlan.currentRates.show)} %`;
  document.querySelector("#current-closing-rate").textContent = actualPlan.currentRates.closing === null
    ? "Aktuell noch keine belastbare Basis"
    : `Aktuell ${decimal(actualPlan.currentRates.closing)} %`;

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

function renderAntonyRangeOutputs(goal) {
  const form = document.querySelector("#antony-plan-form");
  document.querySelector("#antony-target-revenue-output").textContent = euros(goal.targetRevenueCents);
  document.querySelector("#antony-derived-customer-target").textContent = state.antonyCustomerValueCents > 0
    ? `entspricht ${number(goal.targetNewCustomers)} Neukunden bei ${euros(state.antonyCustomerValueCents)} Kundenwert`
    : "Für die Neukundenberechnung zuerst oben den Kundenwert eintragen.";
  document.querySelector("#antony-appointment-rate-output").textContent = `${number(form.elements.appointment_to_closer_rate_override.value)} %`;
  document.querySelector("#antony-show-rate-output").textContent = `${number(form.elements.show_rate_override.value)} %`;
  document.querySelector("#antony-closing-rate-output").textContent = `${number(form.elements.closing_rate_override.value)} %`;
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
    ? "Die drei Regler bilden sofort eine neue, vollständig abhängige Leistungskette."
    : "Rückwärtsrechnung mit den aktuellen Ist-Raten des Monats.";
}

// Antony ist eine eigene Arbeitsansicht. Die Mengen stammen vollständig aus
// der geschützten Datenbankfunktion; die Kreise setzen nur die zugehörigen
// Zähler und Nenner ins Verhältnis und zeigen die Basis direkt daneben.
function renderAntony() {
  const container = document.querySelector("#antony-donuts");
  const note = document.querySelector("#antony-note");
  const profile = document.querySelector("#antony-profile-avatar");
  profile.innerHTML = renderDashboardAvatar("antony", "Antony Rigone");
  enableProfileImageFallbacks(profile);
  if (!state.closing) {
    container.innerHTML = `<p class="antony-empty">Für diesen Zeitraum liegen noch keine Closer-Daten vor.</p>`;
    note.textContent = "";
    renderAntonyPerformance();
    renderAntonyPipeline();
    renderAntonyPotential();
    renderAntonyPlanner();
    renderWeeklyReview();
    return;
  }

  const closing = state.closing;
  const ratio = (numerator, denominator) => denominator > 0 ? safeRate(numerator, denominator) : null;
  const charts = [
    {
      label: "Termine", value: closing.appointments,
      rate: ratio(closing.setter_calls, closing.appointments),
      detail: "Termine → Setter Call",
    },
    {
      label: "Setter Calls", value: closing.setter_calls,
      rate: ratio(closing.setter_successes, closing.setter_calls),
      detail: "Closer terminiert ÷ Setter Calls",
    },
    {
      label: "Closer-Termine", value: closing.setter_successes,
      rate: ratio(closing.closer_calls, closing.setter_successes),
      detail: `${number(closing.closer_calls)} durchgeführt`,
    },
    {
      label: "CC2 vereinbart", value: closing.closer_second_calls,
      rate: ratio(closing.closer_second_calls, closing.closer_calls),
      detail: "Anteil an durchgeführten Closer Calls",
    },
    {
      label: "Abschlüsse im Gespräch", value: closing.closer_sales,
      rate: ratio(closing.closer_sales, closing.decided_closer_calls),
      detail: "Verkauft-Ergebnis ÷ entschiedene Closer Calls",
    },
    {
      label: "Neukunden gesamt", value: closing.new_customers,
      rate: ratio(closing.new_customers, closing.appointments),
      detail: "Gesamtkonversion aus allen Terminen",
    },
  ];

  container.innerHTML = charts.map((chart) => {
    const rate = chart.rate === null ? null : Math.max(0, Math.min(100, chart.rate));
    const displayedRate = rate === null ? "—" : percent(rate);
    const displayedValue = number(chart.value);
    const aria = `${chart.label}: ${displayedValue}; Quote ${displayedRate}`;
    return `
      <article class="antony-metric">
        <div class="donut ${rate === null ? "is-empty" : ""}"
             style="--donut-value:${rate ?? 0}"
             role="img" aria-label="${aria}">
          <span>${displayedRate}</span>
        </div>
        <div class="antony-metric-copy">
          <span>${chart.label}</span>
          <strong>${displayedValue}</strong>
          <small>${chart.detail}</small>
        </div>
      </article>`;
  }).join("");

  note.textContent = "Termine und Setter stammen von Michael und Felix. Closer-Termine sind erfolgreiche Setter Calls. Closer Calls, CC2 und Abschlüsse im Gespräch zählen am tatsächlichen Gesprächstermin in Europe/Berlin. Neukunden gesamt zählen im Monat des Won-Datums – also wenn der Kunde zugesagt hat – und werden über das Close-Feld 3.03 Closer Antony zugeordnet.";
  renderAntonyPerformance();
  renderAntonyPipeline();
  renderAntonyPotential();
  renderAntonyPlanner();
  renderWeeklyReview();
}

const antonyPerformanceSeries = Object.freeze([
  { key: "appointments_cumulative", label: "Termine", color: "#3b9dff" },
  { key: "closer_appointments_cumulative", label: "Closer terminiert", color: "#9b8cff" },
  { key: "closer_calls_cumulative", label: "Closer durchgeführt", color: "#36d399" },
  { key: "new_customers_cumulative", label: "Neukunden", color: "#f5a524" },
]);

function renderAntonyPerformance() {
  const summary = document.querySelector("#antony-performance-summary");
  const chart = document.querySelector("#antony-performance-chart");
  const note = document.querySelector("#antony-performance-note");
  const period = document.querySelector("#antony-performance-period");
  const rows = Array.isArray(state.antonyPerformance) ? state.antonyPerformance : [];
  const closing = state.closing ?? {};
  const summaryValues = [
    ["Termine", closing.appointments ?? 0, "Michael + Felix"],
    ["Closer terminiert", closing.setter_successes ?? 0, "aus Setter Calls"],
    ["Closer durchgeführt", closing.closer_calls ?? 0, "Antony"],
    ["Neukunden", closing.new_customers ?? 0, "Won-Datum"],
  ];

  period.textContent = periodCaption();
  summary.innerHTML = summaryValues.map(([label, value, detail]) => `
    <article><span>${label}</span><strong>${number(value)}</strong><small>${detail}</small></article>`).join("");

  if (rows.length < 2) {
    chart.innerHTML = `<p class="antony-analysis-empty">Für diesen Zeitraum liegen noch nicht genug Zeitpunkte für einen Verlauf vor.</p>`;
    note.textContent = "Die Summen darüber bleiben vollständig; der Graph erscheint ab zwei Zeitpunkten.";
    return;
  }

  const visibleSeries = antonyPerformanceSeries.filter((series) =>
    state.period !== "day" || series.key !== "new_customers_cumulative");
  const width = 960;
  const height = 300;
  const pad = { left: 42, right: 20, top: 20, bottom: 28 };
  const values = visibleSeries.flatMap((series) => rows.map((row) => Number(row[series.key] ?? 0)));
  const maxValue = Math.max(1, ...values);
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
      <circle cx="${x(rows.length - 1).toFixed(1)}" cy="${y(last[series.key]).toFixed(1)}" r="4" style="fill:${series.color}" />`;
  }).join("");
  const labels = rows.map((row, index) => ({
    label: row.bucket_label,
    index,
  })).filter(({ index }) => {
    const interval = Math.max(1, Math.ceil((rows.length - 1) / 5));
    return index === 0 || index === rows.length - 1 || index % interval === 0;
  });

  chart.innerHTML = `
    <div class="antony-performance-legend">${visibleSeries.map((series) => {
      const last = rows[rows.length - 1];
      return `<span><i style="background:${series.color}"></i>${series.label}<b>${number(last[series.key])}</b></span>`;
    }).join("")}</div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Kumulierter Antony-Funnel im gewählten Zeitraum">
      <g class="antony-performance-grid">${grid}</g>
      <g class="antony-performance-lines">${paths}</g>
    </svg>
    <div class="antony-performance-axis">${labels.map(({ label, index }) =>
      `<span style="left:${(index / (rows.length - 1)) * 100}%">${escapeHtml(label)}</span>`).join("")}</div>`;

  note.textContent = state.period === "day"
    ? "Kumuliert von 08:00 bis 17:00 Uhr in Europe/Berlin. Neukunden werden am Tag nur als Summe gezeigt, weil das Won-Datum keine belastbare Uhrzeit enthält."
    : "Kumulierte Funnel-Mengen je Kalendertag. Jeder Punkt baut ausschließlich auf den bis dahin erfassten, gemappten Close-Fakten auf.";
}

function renderAntonyPipeline() {
  const grid = document.querySelector("#antony-pipeline-grid");
  const note = document.querySelector("#antony-pipeline-note");
  const period = document.querySelector("#antony-pipeline-period");
  const pipeline = state.antonyPipeline;

  if (!pipeline?.counts) {
    period.textContent = "Rollierende 3 Monate";
    grid.innerHTML = `<p class="antony-analysis-empty">Die aggregierte offene Pipeline ist noch nicht verfügbar.</p>`;
    note.textContent = "Bestehende KPI- und Close-Mappings laufen davon unabhängig weiter.";
    return;
  }

  const counts = pipeline.counts;
  const cards = [
    ["Offen gesamt", counts.total_open, "eindeutige Leads", "total"],
    ["Termin ohne Setter Call", counts.setter_pending, "nächster Funnel-Schritt fehlt", "normal"],
    ["Closer terminiert", counts.closer_scheduled, "noch ohne Closer-Durchführung", "normal"],
    ["Closer verschoben", counts.rescheduled_closer, "noch ohne neuen Closer Call", "attention"],
    ["CC2 / Entscheidung offen", counts.pending_decision_cc2, "kein späterer Closer-Abschluss", "attention"],
    ["Aus Vormonaten offen", counts.from_previous_months, "über Monatsgrenze hinweg", "attention"],
    ["Älter als 14 Tage", counts.older_than_14_days, "Priorität zur Nachverfolgung", "critical"],
  ];
  period.textContent = `${germanDate(pipeline.window_start)} – ${germanDate(pipeline.as_of)}`;
  grid.innerHTML = cards.map(([label, value, detail, tone]) => `
    <article class="antony-pipeline-card" data-tone="${tone}">
      <span>${label}</span><strong>${number(value)}</strong><small>${detail}</small>
    </article>`).join("");
  note.textContent = pipeline.oldest_open_date
    ? `Ältester logisch offener Stand: ${germanDate(pipeline.oldest_open_date)}. Die Einordnung nutzt nur letzte gemappte Funnel-Ereignisse und keine frei interpretierten Close-Notizen.`
    : "Aktuell wurde im verfügbaren Drei-Monats-Fenster kein logisch offener Funnel-Stand erkannt.";
}

function renderWeeklyReview() {
  const section = document.querySelector("#weekly-review");
  const content = document.querySelector("#weekly-review-content");
  const period = document.querySelector("#weekly-review-period");
  const permitted = canViewWeeklyReview();
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
    renderKpiAssistant();
    return;
  }

  period.textContent = `${germanDate(review.week_start)} – ${germanDate(review.week_end)}`;
  const sentences = String(review.content).split("\n").map((sentence) => sentence.trim()).filter(Boolean);
  content.innerHTML = `<ol>${sentences.map((sentence) => `<li>${escapeHtml(sentence)}</li>`).join("")}</ol>`;
  renderKpiAssistant();
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
      const anteil = attainment(ist, ziel);
      return [`
        <div class="goal-item ${performanceClass(anteil)}">
          <span class="goal-head"><b>${entry.label}</b> · ${label}</span>
          <span class="goal-track"><i style="width:${Math.min(100, anteil)}%;background:${entry.color}"></i></span>
          <span class="goal-figure">${format(ist)} <small>von ${format(ziel)} · ${Math.round(anteil)} %</small></span>
        </div>`];
    }));

  document.querySelector("#goal-strip").innerHTML = zeilen.length === 0
    ? `<p class="empty-note">Noch keine Ziele hinterlegt. Ohne Ziel bleibt eine Kennzahl farblos — das ist beabsichtigt, eine Farbe ohne Vorgabe wäre geraten.</p>`
    : zeilen.join("");
}

// --- Diagramme ---------------------------------------------------------------

// Ein Liniendiagramm ohne Bibliothek. Das ist Voraussetzung dafür, dass ein
// Abschnitt später als eigenständiges Widget in einer fremden Seite läuft.
function lineChart(points, seriesByPerson, format, pointLabel = "Tage") {
  if (points.length < 2) {
    return `<p class="empty-note">Zu wenig Werte für einen Verlauf.</p>`;
  }

  const width = 320;
  const height = 96;
  const padX = 6;
  const padY = 10;
  const values = Object.values(seriesByPerson).flat().filter((value) => Number.isFinite(value));
  const max = Math.max(1, ...values);
  const stepX = (width - padX * 2) / (points.length - 1);
  const y = (value) => height - padY - ((value || 0) / max) * (height - padY * 2);

  const lines = Object.entries(seriesByPerson).map(([slug, points]) => {
    const person = state.people.find((entry) => entry.slug === slug);
    const d = points.map((value, index) => `${index === 0 ? "M" : "L"}${(padX + index * stepX).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
    const last = points[points.length - 1];
    return `<path class="series-line" d="${d}" style="stroke:${person?.color ?? "#8fa3bf"}" />
            <circle cx="${(padX + (points.length - 1) * stepX).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3" style="fill:${person?.color ?? "#8fa3bf"}" />`;
  }).join("");

  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img"
            aria-label="Verlauf über ${points.length} ${pointLabel}, Höchstwert ${format(max)}">${lines}</svg>`;
}

function renderSeries() {
  const title = document.querySelector("#series-title");
  const legend = orderedPeople().map((person) => `
    <span><i class="legend-dot" style="background:${person.color}"></i>${firstName(person.display_name)}</span>`).join("");
  document.querySelector("#series-legend").innerHTML = legend;

  // Ein Tag ist kein 14-Tage-Rückblick. Die großen Diagramme zeigen deshalb
  // die Anrufaktivität dieses einen Tages stündlich und getrennt je Person.
  if (state.period === "day") {
    title.textContent = "Aktivität am Tag";
    const hours = Array.from({ length: 10 }, (_, index) => index + 8);
    document.querySelector("#series-note").textContent =
      `Erfasste Aktivität am ${germanDate(state.periodRange.start)} nach Uhrzeit (08:00–17:00).`;
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
          <div class="chart-body">${lineChart(hours, seriesByPerson, number, "Stunden")}</div>
          <div class="hour-axis" aria-hidden="true">${hours.map((hour) => `<span>${hour}</span>`).join("")}</div>
          <small>08–17 Uhr · je Linie eine Person</small>
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
        <div class="chart-body">${lineChart(days, seriesByPerson, metric.format)}</div>
        <small>${days.length > 1 ? `${germanDate(days[0])} – ${germanDate(days[days.length - 1])}` : ""}</small>
      </article>`;
  }).join("");
}

// Querliegender Trichter: eine Zeile je Stufe, Anteile als Balken.
function renderFunnel() {
  const steps = [
    ["Netto-Anrufe", "callsNet"],
    ["Vorzimmer", "gatekeeper"],
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
    return `
      <article class="transfer-donut-card" style="--donut-color:${entry.color}">
        <span class="transfer-donut" style="--donut-rate:${safeRateValue}" role="img" aria-label="${aria}">
          <strong>${rate === null ? "–" : `${Math.round(rate)} %`}</strong>
        </span>
        <span class="transfer-donut-copy">
          <b>${entry.label}</b>
          <small>${successes} von ${base} Vorzimmern durchgestellt</small>
        </span>
      </article>`;
  }).join("");

  document.querySelector("#funnel").innerHTML = steps.map(([label, key], index) => {
    const bars = people.map((person) => {
      const value = state.metrics[person.slug][key];
      return `<i style="width:${(value / widest) * 100}%;background:${person.color}" title="${firstName(person.display_name)}: ${number(value)}"></i>`;
    }).join("");
    return `
      <div class="funnel-row">
        <span class="funnel-label">${label}</span>
        <span class="funnel-bar">${bars}</span>
        <span class="funnel-total">${number(totals[index])}</span>
    </div>`;
  }).join("");
  document.querySelector("#funnel-note").textContent =
    "Die Donuts zeigen Durchstellungen ÷ Vorzimmer-Kontakte. Der Teamwert wird aus den Summen berechnet. Direkte Entscheider umgehen das Vorzimmer und bleiben deshalb außerhalb dieser Quote.";
}

// Das Stundenprofil bleibt dicht: eine Zeile je Uhrzeit, Michael und Felix in
// der Teamansicht nebeneinander. Die Gesamtqualität verbindet die vier
// Stufenraten. Close-Outcomes Mailbox und außerhalb der Geschäftszeiten werden
// dabei aus den nur technisch "answered" gemeldeten Calls herausgerechnet.
const HOUR_MIN_BASE = 3;

function renderHours() {
  const rateSwitch = document.querySelector("#hours-rate-switch");
  document.querySelector("#hours-title").textContent = state.period === "day"
    ? "Anrufzeiten heute"
    : "Beste Anrufzeiten";
  rateSwitch.hidden = false;
  zeichneStunden("#hours-chart", state.hours, state.heatmapRate);
}

// Dieselbe Darstellung über den Dreimonatszeitraum. Dort trägt sie mehr: Über
// einen Tag beruht jede Stundenquote auf wenigen Fällen, über drei Monate auf
// genug, um daraus eine Anrufzeit abzuleiten.
function renderTrendHours() {
  zeichneStunden("#trend-hours", state.trendHours, state.trendRate);
}

function hourRateText(value) {
  return value === null || value === undefined ? "–" : `${Math.round(value)} %`;
}

function zeichneStunden(selektor, quelle, mode) {
  const container = document.querySelector(selektor);
  const hours = Array.from({ length: 10 }, (_, index) => index + 8);
  const people = orderedPeople();
  const baselines = Object.fromEntries(people.map((person) => [
    person.slug,
    aggregateCallTimeRows(quelle.filter(
      (row) => row.slug === person.slug && hours.includes(Number(row.metric_hour)),
    )),
  ]));
  const evaluated = new Map();

  for (const person of people) {
    for (const hour of hours) {
      const row = quelle.find((entry) => entry.slug === person.slug && Number(entry.metric_hour) === hour) ?? {};
      const quality = calculateCallTimeQuality(row, baselines[person.slug]);
      evaluated.set(`${person.slug}:${hour}`, { quality, metric: callTimeMetric(quality, mode) });
    }
  }

  const bestByPerson = Object.fromEntries(people.map((person) => {
    const candidates = hours
      .map((hour) => ({ hour, ...evaluated.get(`${person.slug}:${hour}`) }))
      .filter(({ metric }) => metric.value !== null && metric.base >= HOUR_MIN_BASE)
      .sort((a, b) => b.metric.value - a.metric.value || b.metric.base - a.metric.base || a.hour - b.hour);
    return [person.slug, candidates[0]?.hour ?? null];
  }));

  const head = `<div class="hour-matrix-head" aria-hidden="true">
    <span></span>
    <span class="hour-bars">${people.map((person) => `<b style="--person-color:${person.color}">${firstName(person.display_name)}</b>`).join("")}</span>
  </div>`;

  const rows = hours.map((hour) => {
    const bars = people.map((person) => {
      const { quality, metric } = evaluated.get(`${person.slug}:${hour}`);
      const missing = metric.value === null || metric.base === 0;
      const thin = !missing && metric.base < HOUR_MIN_BASE;
      const best = !missing && bestByPerson[person.slug] === hour;
      const value = missing ? 0 : Math.min(100, Math.max(0, metric.value));
      const visibleValue = mode === "quality" ? `${Math.round(value)} / 100` : `${Math.round(value)} %`;
      const title = missing
        ? `${firstName(person.display_name)}, ${hour}:00 Uhr: keine belastbare Grundgesamtheit`
        : `${firstName(person.display_name)}, ${hour}:00 Uhr · Qualität ${Math.round(quality.quality)} von 100 · erreichbar ${hourRateText(quality.rates.productive)} · durchgestellt ${hourRateText(quality.rates.connection)} · Entscheider ${hourRateText(quality.rates.decision)} · Termine ${hourRateText(quality.rates.appointment)} · Mailbox ${quality.mailbox_calls} · außerhalb Geschäftszeit ${quality.outside_business_hours_calls}`;

      return `<span class="hour-bar ${missing ? "is-missing" : ""} ${thin ? "is-thin" : ""} ${best ? "is-best" : ""}"
                style="--person-color:${person.color}" title="${title}">
                <span class="hour-bar-top">
                  <span class="hour-person">${firstName(person.display_name)}</span>
                  <b>${missing ? "–" : visibleValue}</b>
                  ${best ? "<em>Beste</em>" : ""}
                </span>
                <span class="hour-track"><i style="width:${missing ? 0 : Math.max(1, value)}%"></i></span>
                <small class="hour-meta">${quality.calls_gross} Anrufe · ${quality.productive_calls} produktiv · MB ${quality.mailbox_calls} · AG ${quality.outside_business_hours_calls}</small>
              </span>`;
    }).join("");
    return `<div class="hour-row"><span class="hour-label">${String(hour).padStart(2, "0")}:00</span><span class="hour-bars">${bars}</span></div>`;
  }).join("");

  const modeCopy = mode === "quality"
    ? "Gesamtqualität: 35 % produktive Erreichbarkeit, 25 % Durchstellung, je 20 % Entscheider- und Terminquote. Kleine Stichproben werden zum persönlichen Periodenmittel geglättet."
    : `${callTimeMetric(calculateCallTimeQuality({}, {}), mode).label}: sichtbare Treffer geteilt durch ihre jeweilige Grundgesamtheit.`;
  container.innerHTML = head + rows +
    `<p class="chart-legend">${modeCopy} MB = Mailbox, AG = außerhalb der Geschäftszeiten; beide mindern nur hier die produktive Erreichbarkeit. „Beste“ benötigt mindestens ${HOUR_MIN_BASE} Fälle. Grundlage ist die tatsächliche Close-Stunde in Europe/Berlin.</p>`;
}

// --- Details -----------------------------------------------------------------

function renderDetails() {
  document.querySelector("#details-row").innerHTML = boardEntries().map((entry) => {
    const rows = detailMetrics().map((metric) => {
      const value = entry.metrics[metric.key];
      const target = metric.noTarget ? null : (metric.rateTarget ? targetFor(entry.targetId, metric.rateTarget) : targetFor(entry.targetId, metric.target));
      const rating = value === null || target === null ? null : attainment(value, target);
      return `
        <div class="detail-line ${performanceClass(rating)}">
          <span>${metric.label}</span>
          <strong>${metric.format(value)}</strong>
          <small>${target === null ? "—" : `Ziel ${metric.format(target)}`}</small>
        </div>`;
    }).join("");
    return `
      <details class="detail-block" style="--person-color:${entry.color}">
        <summary>${entry.label}</summary>
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
    const cells = columns.map(([key, , format]) => `<td>${format(Number(row[key]))}</td>`).join("");
    return `<tr><td>${monthLabel(month)}</td><td><span class="status-chip" style="color:${person.color}">${firstName(person.display_name)}</span></td>${cells}</tr>`;
  })).join("");

  document.querySelector("#trend-head").innerHTML =
    `<tr><th>Monat</th><th>Person</th>${columns.map(([, label]) => `<th>${label}</th>`).join("")}</tr>`;
  document.querySelector("#trend-rows").innerHTML = rows || `<tr><td colspan="7">Noch keine Monatsdaten vorhanden.</td></tr>`;
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
      return `<input id="goal-${person.slug}-${column}" name="${person.id}--${column}" type="number" min="0" step="any" value="${value}" placeholder="${firstName(person.display_name)}" aria-label="${label}, Ziel für ${person.display_name}" />`;
    }).join("");
    return `<div class="goal-field"><label for="goal-${state.people[0]?.slug}-${column}">${label}</label>${inputs}</div>`;
  }).join("");

  if (state.profile.role !== "operator") return;
  const sync = state.syncRun;
  document.querySelector("#sync-detail").innerHTML = sync
    ? `<span>Status: <strong>${sync.status}</strong></span><span>${sync.completed_at ? germanDate(sync.completed_at.slice(0, 10)) : "läuft"}</span><span>${number(sync.fetched_records ?? 0)} gelesen</span><span>${number(sync.upserted_records ?? 0)} gespeichert</span>`
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
     <span title="${titel}"><strong>${label}</strong><small>${note}</small></span>`;
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
    renderTrends();
  }
  renderManager();
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
  try {
    document.querySelector("#load-error").hidden = true;
    state.status = "loading";
    renderSyncBadge();
    await loadAll();
    state.status = "live";
    state.error = null;
    render();
  } catch (error) {
    showError(error.message);
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

async function startSession() {
  const [profile, session] = await Promise.all([data.loadProfile(), data.currentSession()]);
  state.profile = { ...profile, email: session?.user?.email ?? null };
  if (state.forcePasswordSetup || state.profile.mustChangePassword) {
    state.status = "password-setup";
    showPasswordSetup();
    return;
  }

  showApp(true);
  await refresh();

  // Wer einer Person zugeordnet ist, startet in der eigenen Ansicht.
  const own = state.people.find((person) => person.id === state.profile.salesPersonId);
  if (own && state.view === "team") {
    state.view = own.slug;
    render();
  }

  state.unsubscribe?.();
  state.unsubscribe = data.subscribeToUpdates(() => refresh());
}

function endSession() {
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.profile = { displayName: null, role: "sales", salesPersonId: null, mustChangePassword: false, email: null };
  state.closing = null;
  state.antonyPipeline = null;
  state.antonyPerformance = [];
  state.antonyGoal = null;
  state.antonyCustomerValueCents = 0;
  state.plannerOpen = false;
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
    state.view = viewButton.dataset.view;
    render();
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
    : "für Umsatz und Monatsprognose erforderlich";
  renderAntonyPotential();
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
    goal.closingRateOverride,
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
      "Closer-Showrate und Terminquote lagen unter der Vorwoche; wegen nur vier Closer Calls ist diese Tendenz noch nicht belastbar.",
      "Antony sollte nächste Woche die Durchführung bereits terminierter Closer Calls priorisieren.",
      "Prüfe jeden offenen Closer-Termin am Vortag und bestätige ihn verbindlich.",
    ].join("\n"),
  };
  state.antonyPipeline = {
    as_of: "2026-09-04",
    window_start: "2026-07-01",
    retention_months: 3,
    counts: {
      total_open: 14,
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
  state.antonyPerformance = previewPerformancePoints;
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
    if (!state.passwordChangeInProgress) startSession().catch(reportStartupFailure);
  });

  data.currentSession()
    .then((session) => { if (session) return startSession(); showApp(false); })
    .catch(reportStartupFailure);
}

boot();
