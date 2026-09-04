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
  return attempts > 0 ? clampRate((successes / attempts) * 100) : null;
}

// Kleine Stundenstichproben werden zum persönlichen Periodenmittel geglättet.
// Das verhindert, dass ein einzelner Treffer als beste Anrufzeit erscheint,
// ohne die tatsächlich beobachteten Raten zu verstecken.
function smoothedRate(successes, attempts, baselineSuccesses, baselineAttempts) {
  if (attempts <= 0 && baselineAttempts <= 0) return null;
  const baselineRate = baselineAttempts > 0
    ? clampRate((baselineSuccesses / baselineAttempts) * 100)
    : rawRate(successes, attempts);
  const priorWeight = Math.min(5, baselineAttempts);
  if (attempts <= 0) return baselineRate;
  return clampRate(
    ((successes * 100) + (baselineRate * priorWeight)) / (attempts + priorWeight),
  );
}

export function calculateCallTimeQuality(row = {}, baseline = {}) {
  const current = rowNumbers(row);
  const comparison = rowNumbers(baseline);
  const rates = {};
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
    if (smoothed === null) continue;
    weightedTotal += smoothed * factor.weight;
    weightUsed += factor.weight;
  }

  const hasActivity = FACTORS.some((factor) => current[factor.attempts] > 0);
  return {
    ...current,
    rates,
    quality: hasActivity && weightUsed > 0 ? clampRate(weightedTotal / weightUsed) : null,
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
