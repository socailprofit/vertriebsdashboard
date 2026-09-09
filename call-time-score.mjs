const NUMBER_FIELDS = [
  "calls_gross",
  "calls_net",
  "productive_calls",
  "gatekeeper_contacts",
  "connected_calls",
  "decision_maker_contacts",
  "appointments",
  "mailbox_calls",
  "outside_business_hours_calls",
  "gf_unavailable_calls",
  "direct_decision_maker_calls",
  "gatekeeper_unavailable_calls",
  "gatekeeper_rejected",
  "gatekeeper_email_requested",
  "gatekeeper_no_interest",
];

const FACTORS = [
  { key: "productive", weight: 0.35, successes: "productive_calls", attempts: "calls_gross" },
  { key: "connection", weight: 0.25, successes: "connected_calls", attempts: "gatekeeper_contacts" },
  { key: "decision", weight: 0.2, successes: "decision_maker_contacts", attempts: "productive_calls" },
  { key: "appointment", weight: 0.2, successes: "appointments", attempts: "decision_maker_contacts" },
];

function finiteNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function clampRate(value) {
  return Math.min(100, Math.max(0, value));
}

function rowNumbers(row = {}) {
  const numbers = Object.fromEntries(NUMBER_FIELDS.map((field) => [field, finiteNumber(row[field])]));
  if (!("productive_calls" in row)) {
    numbers.productive_calls = Math.max(
      0,
      numbers.calls_net - numbers.mailbox_calls - numbers.outside_business_hours_calls,
    );
  }
  return numbers;
}

export function aggregateCallTimeRows(rows = []) {
  return rows.reduce((total, row) => {
    const numbers = rowNumbers(row);
    NUMBER_FIELDS.forEach((field) => { total[field] += numbers[field]; });
    return total;
  }, Object.fromEntries(NUMBER_FIELDS.map((field) => [field, 0])));
}

function rawRate(successes, attempts) {
  return attempts > 0 && successes <= attempts ? (successes / attempts) * 100 : null;
}

// Kleine Stundenstichproben werden zum persönlichen Periodenmittel geglättet.
// Das verhindert, dass ein einzelner Treffer als beste Anrufzeit erscheint,
// ohne die tatsächlich beobachteten Raten zu verstecken.
function smoothedRate(successes, attempts, baselineSuccesses, baselineAttempts) {
  const observed = rawRate(successes, attempts);
  if (observed === null) return null;
  const baselineRate = rawRate(baselineSuccesses, baselineAttempts);
  if (baselineRate === null) return observed;
  const priorWeight = Math.min(5, baselineAttempts);
  return clampRate(
    ((successes * 100) + (baselineRate * priorWeight)) / (attempts + priorWeight),
  );
}

export function calculateCallTimeQuality(row = {}, baseline = {}) {
  const current = rowNumbers(row);
  const comparison = rowNumbers(baseline);
  const rates = {};
  const smoothedRates = {};
  const inconsistent = FACTORS.filter((factor) => current[factor.successes] > current[factor.attempts])
    .map((factor) => factor.key);
  if (current.calls_net > current.calls_gross || current.productive_calls > current.calls_net) {
    inconsistent.push("calls");
  }
  let weightedTotal = 0;
  let weightUsed = 0;

  for (const factor of FACTORS) {
    rates[factor.key] = rawRate(current[factor.successes], current[factor.attempts]);
    const smoothed = smoothedRate(
      current[factor.successes],
      current[factor.attempts],
      comparison[factor.successes],
      comparison[factor.attempts],
    );
    smoothedRates[factor.key] = smoothed;
    if (smoothed === null) continue;
    weightedTotal += smoothed * factor.weight;
    weightUsed += factor.weight;
  }

  const hasActivity = FACTORS.some((factor) => current[factor.attempts] > 0);
  return {
    ...current,
    rates,
    smoothedRates,
    inconsistent,
    quality: hasActivity && weightUsed > 0 && inconsistent.length === 0
      ? clampRate(weightedTotal / weightUsed) : null,
  };
}

export function callTimeMetric(quality, mode = "quality") {
  const definitions = {
    quality: { label: "Gesamtqualität", value: quality.quality, base: quality.calls_gross, success: null },
    productive: { label: "Erreichbarkeit", value: quality.rates.productive, base: quality.calls_gross, success: quality.productive_calls },
    connection: { label: "Durchstellquote", value: quality.rates.connection, base: quality.gatekeeper_contacts, success: quality.connected_calls },
    decision: { label: "Entscheiderquote", value: quality.rates.decision, base: quality.productive_calls, success: quality.decision_maker_contacts },
    appointment: { label: "Terminquote", value: quality.rates.appointment, base: quality.decision_maker_contacts, success: quality.appointments },
  };
  return definitions[mode] ?? definitions.quality;
}

// Einheitliche Mindestbasis für Tag, Woche, Monat und Dreimonatsrückblick.
// Die Grenzen sind eine betriebliche Empfehlungsregel, kein Signifikanztest.
export const CALL_TIME_MIN_CALLS = 10;
export const CALL_TIME_MIN_CONTACTS = 5;

export function analyzeCallTimeWindows(rows = [], mode = "quality") {
  const grouped = new Map();
  for (const row of rows) {
    if (row.metric_hour === null || row.metric_hour === undefined) continue;
    const hour = Number(row.metric_hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    grouped.set(hour, [...(grouped.get(hour) ?? []), row]);
  }
  const totals = [...grouped].map(([hour, entries]) => ({ hour, ...aggregateCallTimeRows(entries) }));
  const baseline = aggregateCallTimeRows(totals);
  const windows = totals.map((row) => {
    const quality = calculateCallTimeQuality(row, baseline);
    const metric = callTimeMetric(quality, mode);
    const rankingValue = mode === "quality" ? quality.quality : quality.smoothedRates[mode];
    const enoughData = quality.calls_gross >= CALL_TIME_MIN_CALLS && (
      mode === "quality" ? quality.productive_calls >= CALL_TIME_MIN_CONTACTS
        : metric.base >= (mode === "productive" ? CALL_TIME_MIN_CALLS : CALL_TIME_MIN_CONTACTS)
    );
    const eligible = enoughData && quality.inconsistent.length === 0 && metric.value > 0
      && rankingValue !== null && rankingValue !== undefined;
    return { hour: row.hour, quality, metric, rankingValue, enoughData, eligible };
  }).sort((a, b) => a.hour - b.hour);
  const ranked = windows.filter((entry) => entry.eligible)
    .sort((a, b) => b.rankingValue - a.rankingValue || b.metric.base - a.metric.base
      || b.quality.calls_gross - a.quality.calls_gross || a.hour - b.hour)
    .slice(0, 2);
  return { windows, ranked };
}
