// Die Versionskennung an allen Datei-Verweisen sorgt dafür, dass ein Browser
// nach einer Veröffentlichung nicht die alte Datei weiterbenutzt. Sie steht in
// index.html, hier und in data.js und wird bei jedem Release erhöht.
import * as data from "./data.js?v=2026-09-03q";

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
  periodRange: { start: null, end: null },
  profile: { displayName: null, role: "sales", salesPersonId: null },
  syncRun: null,
  heatmapRate: "connection",
  series: [],
  trendHours: [],
  trendRate: "connection",
  widget: null,
  lastCalculated: null,
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
    netRate: Number(row.net_rate),
    talkMinutes: Number(row.talk_seconds) / 60,
    gatekeeper: Number(row.gatekeeper_contacts),
    connected: Number(row.connected_calls),
    connectionRate: Number(row.connection_rate),
    directDecisionMakers: Number(row.direct_decision_maker_calls),
    decisionMakers: Number(row.decision_maker_contacts),
    appointments: Number(row.appointments),
    appointmentRate: Number(row.appointment_rate),
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
  const [people, metricRows, hourRows, trends, trendHours] = await Promise.all([
    data.loadPeople(),
    data.loadMetrics(state.period, state.referenceDate),
    data.loadHourPerformance(state.period, state.referenceDate),
    data.loadTrends(),
    data.loadHourPerformance("trend", state.referenceDate),
  ]);

  state.people = people;
  state.hours = hourRows;
  state.trends = trends;
  state.trendHours = trendHours;
  state.metrics = {};
  metricRows.forEach((row) => { state.metrics[row.slug] = toPerson(row); });

  const first = metricRows[0];
  state.periodRange = first
    ? { start: first.period_start, end: first.period_end }
    : { start: state.referenceDate, end: state.referenceDate };

  const [series, targets] = await Promise.all([
    // Tag bleibt ein einzelner Tag. Woche und Monat verwenden die gerade von
    // der Datenbank bestätigten Grenzen, nicht einen 14-Tage-Ersatzbereich.
    data.loadDailySeries(state.periodRange.start, state.periodRange.end),
    data.loadTargets(state.periodRange.start, state.periodRange.end),
  ]);
  state.series = series;
  state.targets = targets;
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
  "gatekeeper", "connected", "connectionRate", "directDecisionMakers",
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
  const buttons = [`<button class="nav-button" data-view="team">Team</button>`];
  state.people.forEach((person) => {
    buttons.push(`<button class="nav-button" data-view="${person.slug}">${firstName(person.display_name)}</button>`);
  });
  const role = state.profile.role;
  if (role === "manager" || role === "operator") {
    buttons.push(`<button class="nav-button" data-view="chef">Ziele</button>`);
  }
  if (role === "operator") {
    buttons.push(`<button class="nav-button" data-view="betrieb">Betrieb</button>`);
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
  document.querySelector("#core-note").textContent = periodCaption();
  document.querySelector("#footer-context").textContent = `Zeitraum: ${periodLabels[state.period]} · ${periodCaption()}`;

  if (state.widget) return;
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
    appointments: sum("appointments"),
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
  document.querySelector("#core-grid").innerHTML = boardEntries().map((entry) => {
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
          <span class="core-name">${entry.label}</span>
          <span class="core-score ${performanceClass(score)}">${score === null ? "" : `${score}%`}</span>
        </header>
        <div class="core-values">${values}</div>
      </article>`;
  }).join("");
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
    "Kontaktstufen sind keine starre 1:1-Kette: Direkte Entscheider umgehen das Vorzimmer. Die Balken zeigen Mengen, keine erfundenen Konversionsraten.";
}

// Stundenprofil. Drei Dinge, die eine reine Datenübertragung falsch machen
// würde:
//
// Eine Quote von 0 % behauptet, dass niemand durchgestellt hat. Lagen in der
// Stunde gar keine Kontakte vor, ist das keine Null, sondern keine Aussage —
// dafür steht ein Strich.
//
// 100 % aus einem einzigen Kontakt sieht aus wie die beste Anrufzeit des Tages.
// Deshalb steht die Grundgesamtheit neben jeder Quote, und alles unter drei
// Kontakten wird gedämpft: erkennbar, aber nicht als Empfehlung lesbar.
//
// Die Zahl steht außerhalb des Balkens, sonst verschwindet sie bei schmalen
// Balken genau dort, wo man sie am ehesten nachliest.
const HOUR_MIN_BASE = 3;

function renderHours() {
  const rateSwitch = document.querySelector("#hours-rate-switch");
  if (state.period === "day") {
    document.querySelector("#hours-title").textContent = "Tagesverlauf nach Uhrzeit";
    rateSwitch.hidden = true;
    zeichneTagesvolumen();
    return;
  }
  document.querySelector("#hours-title").textContent = "Beste Anrufzeiten";
  rateSwitch.hidden = false;
  zeichneStunden("#hours-chart", state.hours, state.heatmapRate);
}

// Dieselbe Darstellung über den Dreimonatszeitraum. Dort trägt sie mehr: Über
// einen Tag beruht jede Stundenquote auf wenigen Fällen, über drei Monate auf
// genug, um daraus eine Anrufzeit abzuleiten.
function renderTrendHours() {
  zeichneStunden("#trend-hours", state.trendHours, state.trendRate);
}

function zeichneStunden(selektor, quelle, quote) {
  const container = document.querySelector(selektor);
  const useConnection = quote === "connection";
  const valueKey = useConnection ? "transfer_rate" : "net_rate";
  const baseKey = useConnection ? "gatekeeper_contacts" : "calls_gross";
  const baseLabel = useConnection ? "Vorzimmer-Kontakte" : "Anrufe";

  // 08:00–17:00 ist die operative Anrufzeit. Auch leere Stunden bleiben
  // sichtbar, damit ein später Nachmittag nicht fälschlich verschwindet.
  const hours = Array.from({ length: 10 }, (_, index) => index + 8);

  const people = orderedPeople();
  const rows = hours.map((hour) => {
    const bars = people.map((person) => {
      const row = quelle.find((entry) => entry.slug === person.slug && entry.metric_hour === hour);
      const base = row ? Number(row[baseKey]) : 0;
      const value = row ? Number(row[valueKey]) : 0;

      if (base === 0) {
        return `<span class="hour-bar is-missing" title="${firstName(person.display_name)}, ${hour}:00 Uhr: keine ${baseLabel}">
                  <span class="hour-track"></span>
                  <span class="hour-figure">–</span>
                </span>`;
      }

      const duenn = base < HOUR_MIN_BASE;
      return `<span class="hour-bar ${duenn ? "is-thin" : ""}"
                title="${firstName(person.display_name)}, ${hour}:00 Uhr: ${Math.round(value)} % aus ${base} ${baseLabel}${duenn ? " — zu wenig für eine Aussage" : ""}">
                <span class="hour-track"><i style="width:${Math.max(1, value)}%;background:${person.color}"></i></span>
                <span class="hour-figure"><b>${Math.round(value)} %</b><small>aus ${base}</small></span>
              </span>`;
    }).join("");
    return `<div class="hour-row"><span class="hour-label">${String(hour).padStart(2, "0")}:00</span><span class="hour-bars">${bars}</span></div>`;
  }).join("");

  const legende = `<p class="chart-legend">Quote je Stunde, daneben die Grundgesamtheit. Gedämpfte Zeilen beruhen auf weniger als ${HOUR_MIN_BASE} ${baseLabel} und taugen nicht als Empfehlung.</p>`;
  container.innerHTML = rows + legende;
}

function zeichneTagesvolumen() {
  const container = document.querySelector("#hours-chart");
  const people = orderedPeople();
  const hours = Array.from({ length: 10 }, (_, index) => index + 8);
  const totals = hours.map((hour) => people.reduce((sum, person) => {
    const row = state.hours.find((entry) => entry.slug === person.slug && entry.metric_hour === hour);
    return {
      callsGross: sum.callsGross + Number(row?.calls_gross ?? 0),
      callsNet: sum.callsNet + Number(row?.calls_net ?? 0),
    };
  }, { callsGross: 0, callsNet: 0 }));
  const maxGross = Math.max(1, ...totals.map((total) => total.callsGross));

  const rows = hours.map((hour, index) => {
    const total = totals[index];
    const rate = total.callsGross === 0 ? null : safeRate(total.callsNet, total.callsGross);
    return `<div class="volume-hour-row">
      <span class="hour-label">${String(hour).padStart(2, "0")}:00</span>
      <span class="volume-track" title="${hour}:00 Uhr: ${number(total.callsGross)} Brutto, ${number(total.callsNet)} Netto">
        <i class="volume-gross" style="width:${(total.callsGross / maxGross) * 100}%"></i>
        <i class="volume-net" style="width:${(total.callsNet / maxGross) * 100}%"></i>
      </span>
      <span class="hour-figure"><b>${number(total.callsGross)}</b><small>brutto · ${number(total.callsNet)} netto · ${rate === null ? "–" : percent(rate)}</small></span>
    </div>`;
  }).join("");
  container.innerHTML = rows +
    `<p class="chart-legend">Je Stunde: helle Fläche = Brutto-Anrufe, farbige Fläche = angenommene Netto-Anrufe. Leere Stunden von 08:00 bis 17:00 bleiben sichtbar.</p>`;
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
  renderCore();
  renderGoals();
  renderSeries();
  renderFunnel();
  renderHours();
  renderTrendHours();
  renderDetails();
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
  if (date && params.get("historisch") === "1" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    state.referenceDate = date;
    state.datePinned = true;
  }
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
    michael: { slug: "michael", displayName: "Michael Giesbrecht", color: "#3b9dff", callsGross: 479, callsNet: 312, netRate: 65.1, talkMinutes: 642, gatekeeper: 186, connected: 121, connectionRate: 65.1, directDecisionMakers: 44, decisionMakers: 165, appointments: 58, appointmentRate: 35.2, dealsWon: 7, winRate: 12.1, revenue: 4200000, newsletters: null },
    felix: { slug: "felix", displayName: "Felix Wenk", color: "#f5a524", callsGross: 408, callsNet: 233, netRate: 57.1, talkMinutes: 401, gatekeeper: 152, connected: 68, connectionRate: 44.7, directDecisionMakers: 27, decisionMakers: 95, appointments: 21, appointmentRate: 22.1, dealsWon: 3, winRate: 14.3, revenue: 1600000, newsletters: null },
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
      state.hours.push({
        slug: person.slug, metric_hour: hour,
        calls_gross: 40 - index * 12, calls_net: 24 - index * 8,
        net_rate: shape - 6 + index * 3,
        gatekeeper_contacts: 18 - index * 5, connected_calls: 10 - index * 3,
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
  state.profile = { displayName: "Vorschau", role: "operator", salesPersonId: null };
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

  data.onAuthChange((session) => {
    if (session) startSession().catch(reportStartupFailure); else endSession();
  });

  data.currentSession()
    .then((session) => { if (session) return startSession(); showApp(false); })
    .catch(reportStartupFailure);
}

boot();
