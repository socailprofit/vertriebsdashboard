// A percentage always names an observed numerator and its actual population.
export function count(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function transition(numerator, denominator) {
  const n = count(numerator), d = count(denominator);
  return { numerator: n, denominator: d,
    rate: n !== null && d !== null && d > 0 && n <= d ? n / d * 100 : null };
}

export function totalCounts(rows, keys) {
  return Object.fromEntries(keys.map(key => [key, !Array.isArray(rows)
    || rows.some(row => count(row[key]) === null) ? null
    : rows.reduce((n, row) => n + count(row[key]), 0)]));
}

export const JOURNEY_KEYS = [
  "booked_leads", "setter_arrived", "closer_qualified", "closer_arrived", "decided_leads",
  "sold_leads", "new_customers", "observed_customers", "unlinked_closer", "unlinked_customer",
  "cc2_agreed", "cc2_held", "cc2_decided", "cc2_sold", "cc2_lost", "cc2_waiting", "cc2_open",
  "cc2_cancelled", "cc2_no_show", "cc2_rescheduled", "cc2_missing_agreement", "cc1_sold", "cc1_lost",
];

export function journeyRates(journey = {}) {
  const rate = (n, d) => transition(journey[n], journey[d]).rate;
  return {
    appointmentToCloser: rate("closer_qualified", "booked_leads"),
    show: rate("closer_arrived", "closer_qualified"),
    decision: rate("decided_leads", "closer_arrived"),
    closing: rate("sold_leads", "decided_leads"),
    confirmation: rate("new_customers", "sold_leads"),
  };
}
