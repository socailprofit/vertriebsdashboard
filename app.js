const people = {
  michael: {
    name: "Michael",
    fullName: "Michael Giesbrecht",
    initials: "MG",
    color: "var(--michael)",
    soft: "var(--michael-soft)",
  },
  felix: {
    name: "Felix",
    fullName: "Felix Wenk",
    initials: "FW",
    color: "var(--felix)",
    soft: "var(--felix-soft)",
  },
};

const demoData = {
  day: {
    michael: { callsGross: 78, callsNet: 55, talkMinutes: 164, gatekeeper: 29, connected: 20, decisionMakers: 13, appointments: 5, setterCalls: 2, closerCalls: 1, noShows: 1, deals: 1, revenue: 6000, newsletters: 12 },
    felix: { callsGross: 31, callsNet: 22, talkMinutes: 68, gatekeeper: 12, connected: 7, decisionMakers: 4, appointments: 2, setterCalls: 1, closerCalls: 0, noShows: 0, deals: 0, revenue: 0, newsletters: 4 },
  },
  week: {
    michael: { callsGross: 316, callsNet: 224, talkMinutes: 712, gatekeeper: 116, connected: 78, decisionMakers: 49, appointments: 18, setterCalls: 8, closerCalls: 4, noShows: 3, deals: 2, revenue: 12000, newsletters: 49 },
    felix: { callsGross: 66, callsNet: 47, talkMinutes: 151, gatekeeper: 25, connected: 15, decisionMakers: 9, appointments: 4, setterCalls: 2, closerCalls: 1, noShows: 1, deals: 0, revenue: 0, newsletters: 9 },
  },
  month: {
    michael: { callsGross: 818, callsNet: 554, talkMinutes: 2014, gatekeeper: 241, connected: 154, decisionMakers: 92, appointments: 31, setterCalls: 14, closerCalls: 7, noShows: 5, deals: 4, revenue: 24000, newsletters: 126 },
    felix: { callsGross: 72, callsNet: 51, talkMinutes: 166, gatekeeper: 28, connected: 17, decisionMakers: 10, appointments: 4, setterCalls: 2, closerCalls: 1, noShows: 1, deals: 0, revenue: 0, newsletters: 10 },
  },
};

const periodLabels = { day: "Heute", week: "Woche", month: "Monat" };
const viewCopy = {
  team: ["Gemeinsamer Wettbewerb", "Michael gegen Felix", "Alle Kernkennzahlen getrennt, vergleichbar und als Team zusammengeführt."],
  michael: ["Persönliche Ansicht", "Michael im Fokus", "Michaels Fortschritt prominent – Felix und das Team bleiben als Vergleich sichtbar."],
  felix: ["Persönliche Ansicht", "Felix im Fokus", "Felix' Fortschritt prominent – Michael und das Team bleiben als Vergleich sichtbar."],
  chef: ["Chefansicht", "Vertrieb steuern", "Einzelwerte, Teamleistung, Ziele und tägliche Management-Zusammenfassung."],
};

const state = {
  view: "team",
  period: "month",
  goals: {
    michael: { callsNet: 700, connected: 190, decisionMakers: 115, appointments: 38, deals: 5, revenue: 30000 },
    felix: { callsNet: 350, connected: 95, decisionMakers: 58, appointments: 19, deals: 3, revenue: 16000 },
  },
};

const metricDefinitions = [
  { key: "callsGross", label: "Anrufe brutto", detail: "Alle ausgehenden Versuche", format: number, goalKey: "callsNet" },
  { key: "callsNet", label: "Anrufe netto", detail: "Definition wird final bestätigt", format: number, goalKey: "callsNet" },
  { key: "talkMinutes", label: "Gesprächszeit", detail: "Summierte Anrufdauer", format: minutes, goal: { michael: 2400, felix: 1200 } },
  { key: "connected", label: "Durchstellungen", detail: "Gatekeeper: durchgestellt", format: number, goalKey: "connected" },
  { key: "decisionMakers", label: "Entscheider erreicht", detail: "Entscheider-Ergebnis vorhanden", format: number, goalKey: "decisionMakers" },
  { key: "appointments", label: "Termine", detail: "Vom Vertriebler vereinbart", format: number, goalKey: "appointments" },
  { key: "appointmentRate", label: "Terminquote", detail: "Termine ÷ Entscheider", format: percent, goal: { michael: 35, felix: 33 }, aggregate: aggregateRate("appointments", "decisionMakers") },
  { key: "setterCalls", label: "Setter Calls", detail: "Qualifizierungsgespräche", format: number, goal: { michael: 18, felix: 9 } },
  { key: "noShows", label: "No Shows", detail: "Nicht erschienen / abgesagt", format: number, lowerIsBetter: true, goal: { michael: 4, felix: 2 } },
  { key: "deals", label: "Deals", detail: "Verkaufte Closer-Ergebnisse", format: number, goalKey: "deals" },
  { key: "conversionRate", label: "Erfolgsquote", detail: "Deals ÷ Closer Calls", format: percent, goal: { michael: 55, felix: 50 }, aggregate: aggregateRate("deals", "closerCalls") },
  { key: "revenue", label: "Umsatz", detail: "Gewonnene Opportunities", format: currency, goalKey: "revenue" },
  { key: "newsletters", label: "Newsletter", detail: "Quelle wird noch festgelegt", format: number, goal: { michael: 150, felix: 75 } },
];

const heatmapValues = {
  michael: [24, 31, 42, 38, 29, 35, 47, 40, 27],
  felix: [18, 26, 33, 29, 24, 31, 37, 35, 22],
};

const projects = [
  { name: "LinkedIn Neukundengewinnung", status: "Aktiv", michael: 468, felix: 42, calls: 510, minutes: 1284, range: "September" },
  { name: "Mitarbeitergewinnung", status: "Aktiv", michael: 266, felix: 30, calls: 296, minutes: 731, range: "September" },
  { name: "Follow-up Bestand", status: "Aktiv", michael: 84, felix: 0, calls: 84, minutes: 165, range: "laufend" },
];

function number(value) {
  return new Intl.NumberFormat("de-DE").format(Math.round(value || 0));
}

function currency(value) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value || 0);
}

function minutes(value) {
  const hours = Math.floor((value || 0) / 60);
  const rest = Math.round((value || 0) % 60);
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

function percent(value) {
  return `${Math.round(value || 0)} %`;
}

function safeRate(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function aggregateRate(numeratorKey, denominatorKey) {
  return (data) => safeRate(data.michael[numeratorKey] + data.felix[numeratorKey], data.michael[denominatorKey] + data.felix[denominatorKey]);
}

function enrich(personData) {
  return {
    ...personData,
    appointmentRate: safeRate(personData.appointments, personData.decisionMakers),
    conversionRate: safeRate(personData.deals, personData.closerCalls),
  };
}

function getPeriodData() {
  const period = demoData[state.period];
  return { michael: enrich(period.michael), felix: enrich(period.felix) };
}

function getGoal(metric, personKey) {
  if (metric.goalKey) return state.goals[personKey][metric.goalKey] || 1;
  return metric.goal?.[personKey] || 1;
}

function scaledGoal(value) {
  if (state.period === "day") return Math.max(1, Math.round(value / 20));
  if (state.period === "week") return Math.max(1, Math.round(value / 4));
  return value;
}

function attainment(metric, personKey, value) {
  const goal = scaledGoal(getGoal(metric, personKey));
  if (metric.lowerIsBetter) return value <= goal ? 100 : Math.max(0, (goal / value) * 100);
  return Math.min(130, (value / goal) * 100);
}

function focusClass(personKey) {
  if (state.view === "team" || state.view === "chef") return "";
  return state.view === personKey ? "is-focused" : "is-dimmed";
}

function renderHeader() {
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  document.querySelectorAll("[data-period]").forEach((button) => button.classList.toggle("active", button.dataset.period === state.period));
  const [kicker, title, description] = viewCopy[state.view];
  document.querySelector("#view-kicker").textContent = kicker;
  document.querySelector("#page-title").textContent = title;
  document.querySelector("#view-description").textContent = description;
  document.querySelector("#footer-context").textContent = `Ansicht: ${state.view === "chef" ? "Chef" : state.view === "team" ? "Team" : people[state.view].name} · Zeitraum: ${periodLabels[state.period]}`;
  document.querySelector("#manager-section").hidden = state.view !== "chef";
}

function weightedScore(personKey, data) {
  const d = data[personKey];
  const goals = state.goals[personKey];
  const activity = Math.min(1.2, d.callsNet / scaledGoal(goals.callsNet));
  const appointments = Math.min(1.2, d.appointments / scaledGoal(goals.appointments));
  const revenue = Math.min(1.2, d.revenue / scaledGoal(goals.revenue));
  return Math.round(((activity * 0.35 + appointments * 0.35 + revenue * 0.3) / 1.2) * 100);
}

function renderRace(data) {
  const scores = Object.keys(people).map((key) => ({ key, score: weightedScore(key, data) })).sort((a, b) => b.score - a.score);
  document.querySelector("#race-board").innerHTML = scores.map(({ key, score }, index) => {
    const person = people[key];
    const d = data[key];
    return `
      <article class="racer ${focusClass(key)}" style="--racer-color:${person.color};--racer-soft:${person.soft}">
        <div class="racer-topline">
          <div class="person-id"><span class="avatar">${person.initials}</span><span><strong>${person.name}</strong><small>${index === 0 ? "Aktuell auf Platz 1" : "Aktuell auf Platz 2"}</small></span></div>
          <small>${periodLabels[state.period]}</small>
        </div>
        <div class="racer-result"><strong>${score}%</strong><span>${score >= 80 ? "auf Kurs" : score >= 55 ? "im Rennen" : "Potenzial"}</span></div>
        <div class="progress-track"><div class="progress-fill" data-width="${Math.min(score, 100)}" style="--progress-color:${person.color}"></div></div>
        <div class="racer-stats"><span><b>${number(d.callsNet)}</b> Netto-Calls</span><span><b>${number(d.appointments)}</b> Termine</span><span><b>${currency(d.revenue)}</b> Umsatz</span></div>
      </article>`;
  }).join("");
}

function renderMetrics(data) {
  const container = document.querySelector("#metric-table");
  container.innerHTML = metricDefinitions.map((metric) => {
    const michaelValue = data.michael[metric.key] ?? 0;
    const felixValue = data.felix[metric.key] ?? 0;
    const aggregate = metric.aggregate ? metric.aggregate(data) : michaelValue + felixValue;
    return `
      <div class="metric-line">
        <div class="metric-name"><strong>${metric.label}</strong><small>${metric.detail}</small></div>
        ${personMetric(metric, "michael", michaelValue)}
        ${personMetric(metric, "felix", felixValue)}
        <div class="metric-team"><small>Team</small><strong>${metric.format(aggregate)}</strong></div>
      </div>`;
  }).join("");
}

function personMetric(metric, personKey, value) {
  const person = people[personKey];
  const score = attainment(metric, personKey, value);
  const goal = scaledGoal(getGoal(metric, personKey));
  return `
    <div class="metric-person ${focusClass(personKey)}">
      <span class="metric-value" style="color:${person.color}">${metric.format(value)}</span>
      <div class="metric-progress">
        <div class="progress-track"><div class="progress-fill" data-width="${Math.min(score, 100)}" style="--progress-color:${person.color}"></div></div>
        <small>${Math.round(score)}% vom Ziel ${metric.format(goal)}</small>
      </div>
    </div>`;
}

function renderFunnel(data) {
  const steps = [
    ["Netto-Anrufe", "callsNet"],
    ["Durchgestellt", "connected"],
    ["Entscheider", "decisionMakers"],
    ["Termine", "appointments"],
    ["Deals", "deals"],
  ];
  document.querySelector("#funnel").innerHTML = steps.map(([label, key]) => {
    const total = Math.max(1, data.michael[key] + data.felix[key]);
    const mShare = (data.michael[key] / total) * 100;
    const fShare = 100 - mShare;
    return `
      <div class="funnel-step">
        <small>${label}</small>
        <div class="funnel-values">
          <div class="funnel-person ${focusClass("michael")}"><strong style="color:var(--michael)">${number(data.michael[key])}</strong><span>Michael</span></div>
          <div class="funnel-person ${focusClass("felix")}"><strong style="color:var(--felix)">${number(data.felix[key])}</strong><span>Felix</span></div>
        </div>
        <div class="funnel-line"><i style="width:${mShare}%;background:var(--michael)"></i><i style="width:${fShare}%;background:var(--felix)"></i></div>
      </div>`;
  }).join("");
}

function renderHeatmap() {
  const hours = Array.from({ length: 9 }, (_, index) => `${index + 8}:00`);
  const rows = Object.entries(people).map(([key, person]) => {
    const cells = heatmapValues[key].map((value) => `<span class="heat-cell" style="--heat-color:${person.color};--heat-strength:${Math.max(12, value * 1.55)}%" title="${person.name}: ${value}%">${value}%</span>`).join("");
    return `<div class="heat-row"><span class="heat-person" style="color:${person.color}">${person.name}</span>${cells}</div>`;
  }).join("");
  document.querySelector("#heatmap").innerHTML = `<div class="heat-row header"><span>Person</span>${hours.map((hour) => `<span>${hour}</span>`).join("")}</div>${rows}`;
}

function renderRanking(data) {
  const ranking = Object.keys(people).sort((a, b) => data[b].callsNet - data[a].callsNet);
  document.querySelector("#caller-ranking").innerHTML = ranking.map((key, index) => {
    const person = people[key];
    return `
      <div class="ranking-person" style="--rank-color:${person.color};--rank-soft:${person.soft}">
        <span class="rank-number">0${index + 1}</span>
        <span class="rank-avatar">${person.initials}</span>
        <span class="rank-copy"><strong>${person.fullName}</strong><small>${minutes(data[key].talkMinutes)} Gespräch</small></span>
        <span class="rank-value">${number(data[key].callsNet)}</span>
      </div>`;
  }).join("");
}

function renderProjects() {
  const factor = state.period === "day" ? 0.05 : state.period === "week" ? 0.24 : 1;
  document.querySelector("#project-rows").innerHTML = projects.map((project) => {
    const michael = Math.round(project.michael * factor);
    const felix = Math.round(project.felix * factor);
    return `<tr><td>${project.name}</td><td><span class="status-chip">${project.status}</span></td><td>${number(michael)}</td><td>${number(felix)}</td><td>${number(michael + felix)}</td><td>${minutes(project.minutes * factor)}</td><td>${state.period === "day" ? "heute" : state.period === "week" ? "diese Woche" : project.range}</td></tr>`;
  }).join("");
}

function renderGoalEditor() {
  const goalLabels = { callsNet: "Netto-Anrufe", connected: "Durchstellungen", decisionMakers: "Entscheider", appointments: "Termine", deals: "Deals", revenue: "Umsatz (€)" };
  document.querySelector("#goal-fields").innerHTML = Object.entries(goalLabels).map(([key, label]) => `
    <div class="goal-field">
      <label for="goal-michael-${key}">${label}</label>
      <input id="goal-michael-${key}" name="michael-${key}" type="number" min="0" value="${state.goals.michael[key]}" aria-label="${label} Ziel Michael" />
      <input id="goal-felix-${key}" name="felix-${key}" type="number" min="0" value="${state.goals.felix[key]}" aria-label="${label} Ziel Felix" />
    </div>`).join("");
}

function renderSummary(data) {
  const leader = weightedScore("michael", data) >= weightedScore("felix", data) ? "Michael" : "Felix";
  const totalAppointments = data.michael.appointments + data.felix.appointments;
  const totalRevenue = data.michael.revenue + data.felix.revenue;
  document.querySelector("#ai-summary-text").textContent = `${leader} führt aktuell in der gewichteten Zielerreichung. Das Team hat im gewählten Zeitraum ${number(totalAppointments)} Termine vereinbart und ${currency(totalRevenue)} Umsatz erfasst. Die stärkste gemeinsame Anrufzeit liegt zwischen 14 und 16 Uhr.`;
  document.querySelector("#summary-facts").innerHTML = [
    `${number(data.michael.callsNet + data.felix.callsNet)} Netto-Anrufe`,
    `${number(data.michael.decisionMakers + data.felix.decisionMakers)} Entscheider`,
    `${percent(safeRate(totalAppointments, data.michael.decisionMakers + data.felix.decisionMakers))} Team-Terminquote`,
  ].map((fact) => `<span>${fact}</span>`).join("");
}

function animateProgress() {
  requestAnimationFrame(() => document.querySelectorAll(".progress-fill[data-width]").forEach((bar) => { bar.style.width = `${bar.dataset.width}%`; }));
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("view", state.view);
  url.searchParams.set("period", state.period);
  window.history.replaceState({}, "", url);
}

function render() {
  const data = getPeriodData();
  renderHeader();
  renderRace(data);
  renderMetrics(data);
  renderFunnel(data);
  renderHeatmap();
  renderRanking(data);
  renderProjects();
  renderGoalEditor();
  renderSummary(data);
  animateProgress();
  updateUrl();
}

function readInitialState() {
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get("view");
  const requestedPeriod = params.get("period");
  if (requestedView && viewCopy[requestedView]) state.view = requestedView;
  if (requestedPeriod && demoData[requestedPeriod]) state.period = requestedPeriod;
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
    render();
  }
});

document.querySelector("#goal-editor").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  Object.keys(state.goals.michael).forEach((key) => {
    state.goals.michael[key] = Number(form.get(`michael-${key}`)) || 0;
    state.goals.felix[key] = Number(form.get(`felix-${key}`)) || 0;
  });
  render();
  const status = document.querySelector("#goal-status");
  status.textContent = "Ziele für diese Demo-Sitzung angewendet.";
  setTimeout(() => { status.textContent = ""; }, 2800);
});

readInitialState();
render();
