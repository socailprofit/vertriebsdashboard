// Die Versionskennung an allen Datei-Verweisen sorgt dafür, dass ein Browser
// nach einer Veröffentlichung nicht die alte Datei weiterbenutzt. Sie steht in
// index.html, hier und in data.js und wird bei jedem Release erhöht.
import * as data from "./data.js?v=2026-09-03a";

// Sichtbarer Kennzahlenumfang, am 2026-09-02 festgelegt. Gesprächszeit läuft als
// Nebenangabe in der Rangliste mit. Setter, Closer, No Shows, Deals und Umsatz
// werden weiter importiert, aber nicht angezeigt.
const metricDefinitions = [
  { key: "callsGross", label: "Anrufe brutto", detail: "Ausgehend, endgültiger Status", format: number, target: "calls_gross" },
  { key: "callsNet", label: "Anrufe netto", detail: "Abgeschlossen und angenommen", format: number, target: "calls_net" },
  { key: "gatekeeper", label: "Vorzimmer", detail: "Gatekeeper erreicht", format: number, target: "gatekeeper_contacts" },
  { key: "connected", label: "Durchstellungen", detail: "Vom Vorzimmer durchgestellt", format: number, target: "connected_calls" },
  { key: "connectionRate", label: "Durchstellquote", detail: "Durchstellungen ÷ Vorzimmer", format: percent, rateTarget: "transfer_rate_target", ratio: ["connected", "gatekeeper"] },
  { key: "directDecisionMakers", label: "Entscheider direkt", detail: "Ohne Vorzimmer erreicht", format: number, noTarget: true },
  { key: "decisionMakers", label: "Entscheider gesamt", detail: "Direkt und durchgestellt", format: number, target: "decision_maker_contacts" },
  { key: "appointments", label: "Termine", detail: "Termin vereinbart", format: number, target: "appointments" },
  { key: "appointmentRate", label: "Terminquote", detail: "Termine ÷ Entscheider", format: percent, rateTarget: "appointment_rate_target", ratio: ["appointments", "decisionMakers"] },
  { key: "newsletters", label: "Newsletter", detail: "Quelle in Close noch offen", format: count, noTarget: true },
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
  chef: ["Chefansicht", "Vertrieb steuern", "Einzelwerte, Teamleistung, Ziele und Sync-Status."],
};

const state = {
  view: "team",
  period: "month",
  referenceDate: berlinToday(),
  people: [],
  metrics: {},
  hours: [],
  trends: [],
  targets: [],
  periodRange: { start: null, end: null },
  profile: { displayName: null, role: "sales", salesPersonId: null },
  syncRun: null,
  heatmapRate: "connection",
  status: "start",
  error: null,
  unsubscribe: null,
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

// Newsletter hat bewusst keinen Wert, solange die Close-Quelle offen ist. Eine
// Null würde behaupten, es habe keine gegeben.
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

function germanDate(isoDate) {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(`${isoDate}T12:00:00Z`));
}

function monthLabel(isoDate) {
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" })
    .format(new Date(`${isoDate}T12:00:00Z`));
}

function initials(displayName) {
  return displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function firstName(displayName) {
  return displayName.split(/\s+/)[0];
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
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
    talkMinutes: Number(row.talk_seconds) / 60,
    gatekeeper: Number(row.gatekeeper_contacts),
    connected: Number(row.connected_calls),
    connectionRate: Number(row.connection_rate),
    directDecisionMakers: Number(row.direct_decision_maker_calls),
    decisionMakers: Number(row.decision_maker_contacts),
    appointments: Number(row.appointments),
    appointmentRate: Number(row.appointment_rate),
    newsletters: row.newsletters === null ? null : Number(row.newsletters),
  };
}

async function loadAll() {
  const [people, metricRows, hourRows, trends] = await Promise.all([
    data.loadPeople(),
    data.loadMetrics(state.period, state.referenceDate),
    data.loadHourPerformance(state.period, state.referenceDate),
    data.loadTrends(),
  ]);

  state.people = people;
  state.hours = hourRows;
  state.trends = trends;
  state.metrics = {};
  metricRows.forEach((row) => { state.metrics[row.slug] = toPerson(row); });

  const first = metricRows[0];
  state.periodRange = first
    ? { start: first.period_start, end: first.period_end }
    : { start: state.referenceDate, end: state.referenceDate };

  state.targets = await data.loadTargets(state.periodRange.start, state.periodRange.end);
  state.syncRun = state.profile.role === "manager" ? await data.loadLatestSyncRun() : null;
}

// --- Ziele -------------------------------------------------------------------

function daysBetween(startIso, endIso) {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  return Math.round((end - start) / 86400000) + 1;
}

// Ein Ziel gilt für seinen eigenen Zeitraum. Deckt die Ansicht nur einen Teil
// davon ab, wird ein Zählwert anteilig verkleinert: Ein Monatsziel von 600
// Anrufen entspricht an einem Tag rund 20. Quotenziele werden nicht skaliert,
// eine Quote ist von der Dauer unabhängig.
function targetFor(personId, column) {
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

    total += Number(value) * (daysBetween(overlapStart, overlapEnd) / daysBetween(target.period_start, target.period_end));
    found = true;
  }

  if (isRate) return rates.length === 0 ? null : rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  return found ? Math.max(1, Math.round(total)) : null;
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

function orderedPeople() {
  return state.people.filter((person) => state.metrics[person.slug]);
}

function focusClass(slug) {
  if (state.view === "team" || state.view === "chef") return "";
  return state.view === slug ? "is-focused" : "is-dimmed";
}

function periodCaption() {
  const { start, end } = state.periodRange;
  if (!start) return "";
  if (state.period === "day") return germanDate(start);
  if (state.period === "month") return monthLabel(start);
  return `${germanDate(start)} – ${germanDate(end)}`;
}

function renderNav() {
  const buttons = [`<button class="nav-button" data-view="team">Team</button>`];
  state.people.forEach((person) => {
    buttons.push(`<button class="nav-button" data-view="${person.slug}">${firstName(person.display_name)}</button>`);
  });
  if (state.profile.role === "manager") {
    buttons.push(`<button class="nav-button" data-view="chef">Chef</button>`);
  }
  document.querySelector(".view-nav").innerHTML = buttons.join("");
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
  document.querySelector("#manager-section").hidden = state.view !== "chef" || state.profile.role !== "manager";
  document.querySelector("#footer-context").textContent = `Zeitraum: ${periodLabels[state.period]} · ${periodCaption()}`;
}

// Gewichtet aus den sichtbaren Kennzahlen. Umsatz fließt nicht ein, solange er
// nicht angezeigt wird — eine Zahl, die niemand sieht, soll die Rangfolge nicht
// bestimmen. Ohne Ziele gibt es keine Zielerreichung.
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

// Hufeisen über 270 Grad, Radius 45 um den Mittelpunkt (60|60). Die Bogenlänge
// ist die Grundlage für stroke-dasharray, damit sich der Bogen anteilig füllt.
const GAUGE_PATH = "M28.18 91.82 A45 45 0 1 1 91.82 91.82";
const GAUGE_LENGTH = 212.06;

function gaugeMarkup(fraction, color, valueText, targetText) {
  const filled = Math.max(0, Math.min(1, fraction));
  return `
    <div class="gauge">
      <svg viewBox="0 0 120 104" role="img" aria-label="${valueText} von ${targetText}" style="--gauge-color:${color}">
        <path class="track" d="${GAUGE_PATH}" />
        <path class="fill" d="${GAUGE_PATH}" stroke-dasharray="${GAUGE_LENGTH}" stroke-dashoffset="${GAUGE_LENGTH * (1 - filled)}" />
        <text class="value-text" x="60" y="64" text-anchor="middle">${valueText}</text>
        <text class="target-text" x="60" y="84" text-anchor="middle">${targetText}</text>
      </svg>
    </div>`;
}

// Kachel mit Ziel wird zur Anzeige mit Bogen, Kachel ohne Ziel zur großen Zahl.
// So ist auf einen Blick erkennbar, wo überhaupt ein Ziel gepflegt ist.
function metricCard(metric, entry) {
  const value = entry.metrics[metric.key];
  const target = metric.noTarget ? null : metricTarget(metric, entry.targetId);
  const score = value === null || target === null ? null : attainment(value, target);
  const caption = periodCaption();

  if (target !== null && value !== null) {
    return `
      <article class="metric-card ${performanceClass(score)}">
        <h3>${metric.label}</h3>
        <span class="card-period">${caption}</span>
        ${gaugeMarkup(value / target, entry.color, metric.format(value), metric.format(target))}
      </article>`;
  }

  return `
    <article class="metric-card ${performanceClass(null)}">
      <h3>${metric.label}</h3>
      <span class="card-period">${caption}</span>
      <div class="big-value">${metric.format(value)}</div>
      <span class="card-hint">${metric.noTarget ? metric.detail : "kein Ziel hinterlegt"}</span>
    </article>`;
}

// Michael, Felix und die Summe als eigener Block. Die Quoten des Teams werden
// aus den Summen gebildet, nicht aus dem Mittel der Einzelquoten — sonst zählte
// ein Vertriebler mit wenigen Gesprächen genauso schwer wie einer mit vielen.
function boardEntries() {
  const people = orderedPeople();
  const entries = people.map((person) => ({
    slug: person.slug,
    label: firstName(person.display_name),
    color: person.color,
    targetId: person.id,
    metrics: state.metrics[person.slug],
    score: weightedScore(state.metrics[person.slug], person.id),
  }));

  if (people.length < 2) return entries;

  const sum = (key) => people.reduce((total, person) => total + (state.metrics[person.slug][key] ?? 0), 0);
  const teamMetrics = {
    callsGross: sum("callsGross"),
    callsNet: sum("callsNet"),
    talkMinutes: sum("talkMinutes"),
    gatekeeper: sum("gatekeeper"),
    connected: sum("connected"),
    directDecisionMakers: sum("directDecisionMakers"),
    decisionMakers: sum("decisionMakers"),
    appointments: sum("appointments"),
    newsletters: people.every((person) => state.metrics[person.slug].newsletters === null) ? null : sum("newsletters"),
  };
  teamMetrics.connectionRate = safeRate(teamMetrics.connected, teamMetrics.gatekeeper);
  teamMetrics.appointmentRate = safeRate(teamMetrics.appointments, teamMetrics.decisionMakers);

  entries.push({
    slug: "team",
    label: "Team",
    color: "#9fb4d0",
    targetId: people.map((person) => person.id),
    metrics: teamMetrics,
    score: null,
  });
  return entries;
}

function renderBoard() {
  document.querySelector("#board").innerHTML = boardEntries().map((entry) => {
    const attainmentCard = entry.score === null
      ? `<article class="metric-card is-neutral">
           <h3>Zielerreichung</h3>
           <span class="card-period">${periodCaption()}</span>
           <div class="big-value">—</div>
           <span class="card-hint">kein Ziel hinterlegt</span>
         </article>`
      : `<article class="metric-card ${performanceClass(entry.score)}">
           <h3>Zielerreichung</h3>
           <span class="card-period">gewichtet</span>
           ${gaugeMarkup(entry.score / 100, entry.color, `${entry.score}%`, "100%")}
         </article>`;

    const cards = metricDefinitions.map((metric) => metricCard(metric, entry)).join("");
    return `
      <div class="person-block ${focusClass(entry.slug)}">
        <h2 class="banner" style="--banner-color:${entry.color}">${entry.label}</h2>
        <div class="metric-grid">${attainmentCard}${cards}</div>
      </div>`;
  }).join("");
}

const RANK_COLORS = ["#f7c948", "#c9d6e6", "#d08a52"];

function renderLeaderboard() {
  const ranked = [...orderedPeople()].sort((a, b) => state.metrics[b.slug].callsNet - state.metrics[a.slug].callsNet);
  document.querySelector("#leaderboard").innerHTML = ranked.map((person, index) => {
    const metrics = state.metrics[person.slug];
    return `
      <div class="leader">
        <span class="leader-avatar" style="--leader-color:${person.color}">
          ${initials(person.display_name)}
          <span class="leader-rank" style="--rank-color:${RANK_COLORS[index] ?? RANK_COLORS[2]}">${index + 1}</span>
        </span>
        <span class="leader-name">${person.display_name}</span>
        <span class="leader-value">${number(metrics.callsNet)}</span>
        <span class="leader-note">${minutes(metrics.talkMinutes)} Gespräch</span>
      </div>`;
  }).join("");
}

function renderFunnel() {
  const steps = [
    ["Netto-Anrufe", "callsNet"],
    ["Vorzimmer", "gatekeeper"],
    ["Durchgestellt", "connected"],
    ["Entscheider", "decisionMakers"],
    ["Termine", "appointments"],
  ];
  const people = orderedPeople();

  document.querySelector("#funnel").innerHTML = steps.map(([label, key]) => {
    const total = Math.max(1, people.reduce((sum, person) => sum + state.metrics[person.slug][key], 0));
    const values = people.map((person) => `
      <div class="funnel-person ${focusClass(person.slug)}">
        <strong style="color:${person.color}">${number(state.metrics[person.slug][key])}</strong>
        <span>${firstName(person.display_name)}</span>
      </div>`).join("");
    const bars = people.map((person) => {
      const share = (state.metrics[person.slug][key] / total) * 100;
      return `<i style="width:${share}%;background:${person.color}"></i>`;
    }).join("");
    return `
      <div class="funnel-step">
        <small>${label}</small>
        <div class="funnel-values">${values}</div>
        <div class="funnel-line">${bars}</div>
      </div>`;
  }).join("");
}

// Beide Stundenquoten liegen vor. Angezeigt wird die gewählte, damit die
// Tabelle lesbar bleibt. Stunden ohne Grundlage entfallen ganz.
function renderHeatmap() {
  const container = document.querySelector("#heatmap");
  const useConnection = state.heatmapRate === "connection";
  const valueKey = useConnection ? "transfer_rate" : "reach_rate";
  const baseKey = useConnection ? "gatekeeper_contacts" : "calls_gross";

  const activeHours = [...new Set(state.hours.filter((row) => Number(row[baseKey]) > 0).map((row) => row.metric_hour))]
    .sort((a, b) => a - b);

  if (activeHours.length === 0) {
    container.innerHTML = `<p class="empty-note">Für diesen Zeitraum liegen keine ${useConnection ? "Vorzimmer-Kontakte" : "Anrufe"} vor.</p>`;
    return;
  }

  container.style.setProperty("--hours", activeHours.length);
  const header = `<div class="heat-row header"><span>Person</span>${activeHours.map((hour) => `<span>${String(hour).padStart(2, "0")}:00</span>`).join("")}</div>`;
  const rows = orderedPeople().map((person) => {
    const cells = activeHours.map((hour) => {
      const row = state.hours.find((entry) => entry.slug === person.slug && entry.metric_hour === hour);
      const base = row ? Number(row[baseKey]) : 0;
      const value = row ? Number(row[valueKey]) : 0;
      if (base === 0) return `<span class="heat-cell is-empty" title="${firstName(person.display_name)}, ${hour}:00 Uhr: keine Daten">–</span>`;
      return `<span class="heat-cell" style="--heat-color:${person.color};--heat-strength:${Math.max(12, value)}%" title="${firstName(person.display_name)}, ${hour}:00 Uhr: ${Math.round(value)} % aus ${base}">${Math.round(value)}%</span>`;
    }).join("");
    return `<div class="heat-row"><span class="heat-person" style="color:${person.color}">${firstName(person.display_name)}</span>${cells}</div>`;
  }).join("");

  container.innerHTML = header + rows;
}

// Aktueller Monat und die zwei Vormonate, in den Kennzahlen, die sichtbar sind.
function renderTrends() {
  const columns = [
    ["calls_net", "Netto-Anrufe", number],
    ["gatekeeper_contacts", "Vorzimmer", number],
    ["connected_calls", "Durchstellungen", number],
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
  document.querySelector("#trend-rows").innerHTML = rows || `<tr><td colspan="9">Noch keine Monatsdaten vorhanden.</td></tr>`;
}

function renderManager() {
  if (state.profile.role !== "manager") return;

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

  const sync = state.syncRun;
  document.querySelector("#sync-detail").innerHTML = sync
    ? `<span>Status: <strong>${sync.status}</strong></span><span>${sync.completed_at ? germanDate(sync.completed_at.slice(0, 10)) : "läuft"}</span><span>${number(sync.fetched_records ?? 0)} gelesen</span><span>${number(sync.upserted_records ?? 0)} gespeichert</span>`
    : `<span>Noch kein Sync-Lauf erfasst.</span>`;
}

function renderSyncBadge() {
  const label = state.status === "live" ? "Live-Daten"
    : state.status === "preview" ? "Designvorschau"
    : state.status === "loading" ? "Lädt" : "Getrennt";
  const note = state.status === "live" ? "Supabase, aktualisiert automatisch"
    : state.status === "preview" ? "Beispielzahlen, nicht aus Close"
    : state.error ?? "Verbindung wird aufgebaut";
  document.querySelector(".sync-status").innerHTML =
    `<span class="sync-dot ${state.status === "live" ? "is-live" : ""}" aria-hidden="true"></span><span><strong>${label}</strong><small>${note}</small></span>`;
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("view", state.view);
  url.searchParams.set("period", state.period);
  url.searchParams.set("date", state.referenceDate);
  window.history.replaceState({}, "", url);
}

function render() {
  renderNav();
  renderHeader();
  renderLeaderboard();
  renderBoard();
  renderFunnel();
  renderHeatmap();
  renderTrends();
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

function showApp(visible) {
  document.querySelector(".app-shell").hidden = !visible;
  document.querySelector("#login-screen").hidden = visible;
}

async function startSession() {
  state.profile = await data.loadProfile();
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
  state.profile = { displayName: null, role: "sales", salesPersonId: null };
  showApp(false);
}

function readInitialState() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const period = params.get("period");
  const date = params.get("date");
  if (view) state.view = view;
  if (period && periodLabels[period]) state.period = period;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) state.referenceDate = date;
}

document.addEventListener("click", (event) => {
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
    refresh();
    return;
  }
  const rateButton = event.target.closest("[data-rate]");
  if (rateButton) {
    state.heatmapRate = rateButton.dataset.rate;
    document.querySelectorAll("[data-rate]").forEach((button) => {
      button.classList.toggle("active", button.dataset.rate === state.heatmapRate);
    });
    renderHeatmap();
  }
});

document.querySelector("#reference-date").addEventListener("change", (event) => {
  state.referenceDate = event.target.value || berlinToday();
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
    michael: { slug: "michael", displayName: "Michael Giesbrecht", color: "#3b9dff", callsGross: 479, callsNet: 312, talkMinutes: 642, gatekeeper: 186, connected: 121, connectionRate: 65.1, directDecisionMakers: 44, decisionMakers: 165, appointments: 58, appointmentRate: 35.2, newsletters: null },
    felix: { slug: "felix", displayName: "Felix Wenk", color: "#f5a524", callsGross: 408, callsNet: 233, talkMinutes: 401, gatekeeper: 152, connected: 68, connectionRate: 44.7, directDecisionMakers: 27, decisionMakers: 95, appointments: 21, appointmentRate: 22.1, newsletters: null },
  };
  state.periodRange = { start: "2026-09-01", end: "2026-09-30" };
  state.targets = [
    { sales_person_id: "p1", period_start: "2026-09-01", period_end: "2026-09-30", calls_gross: 500, calls_net: 300, gatekeeper_contacts: 180, connected_calls: 110, decision_maker_contacts: 150, appointments: 50, transfer_rate_target: 60, appointment_rate_target: 33 },
    { sales_person_id: "p2", period_start: "2026-09-01", period_end: "2026-09-30", calls_gross: 500, calls_net: 300, gatekeeper_contacts: 180, connected_calls: 110, decision_maker_contacts: 150, appointments: 50, transfer_rate_target: 60, appointment_rate_target: 33 },
  ];
  state.hours = [];
  for (let hour = 8; hour <= 17; hour += 1) {
    const shape = [38, 52, 61, 57, 34, 41, 66, 72, 59, 44][hour - 8];
    people.forEach((person, index) => {
      state.hours.push({
        slug: person.slug, metric_hour: hour,
        calls_gross: 40 - index * 12, calls_net: 24 - index * 8,
        reach_rate: shape - 6 + index * 3,
        gatekeeper_contacts: 18 - index * 5, connected_calls: 10 - index * 3,
        transfer_rate: shape - index * 11,
      });
    });
  }
  state.trends = ["2026-09-01", "2026-08-01", "2026-07-01"].flatMap((month, monthIndex) =>
    people.map((person, index) => ({
      month_start: month, slug: person.slug, display_name: person.display_name, color: person.color,
      calls_gross: 479 - index * 71 - monthIndex * 40,
      calls_net: 312 - index * 79 - monthIndex * 25,
      gatekeeper_contacts: 186 - index * 34 - monthIndex * 15,
      connected_calls: 121 - index * 53 - monthIndex * 9,
      connection_rate: 65.1 - index * 20.4 - monthIndex * 2,
      decision_maker_contacts: 165 - index * 70 - monthIndex * 12,
      appointments: 58 - index * 37 - monthIndex * 4,
      appointment_rate: 35.2 - index * 13.1 - monthIndex,
    })));
  state.profile = { displayName: "Vorschau", role: "manager", salesPersonId: null };
  state.view = "team";
  state.status = "preview";
}

function boot() {
  readInitialState();
  document.querySelector("#reference-date").value = state.referenceDate;

  if (new URLSearchParams(window.location.search).get("preview") === "1") {
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

  data.onAuthChange((session) => {
    if (session) startSession(); else endSession();
  });

  data.currentSession()
    .then((session) => { if (session) startSession(); else showApp(false); })
    .catch((error) => showError(error.message));
}

boot();
