import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssistantInput,
  buildAssistantMetrics,
  normalizeAssistantQuestion,
  parseAssistantAnswer,
  previousReferenceDate,
} from "../supabase/functions/_shared/kpi-assistant.ts";

const context = {
  company: {
    name: "Social Profit GmbH",
    offer: "LinkedIn-Dienstleistung fuer Sichtbarkeit und Kundengewinnung",
    business_model: "B2B-Dienstleistung",
  },
  icp: {
    summary: "KMU aus Industrie und Technik",
    buyer_roles: ["Geschaeftsfuehrung"],
    company_profile: "Industrie und Technik",
    core_problems: ["Neukundengewinnung"],
  },
  sales: {
    motion: "Telefonische Kaltakquise bis zum Closer-Gespraech",
    kpi_definitions: ["Terminquote = Termine geteilt durch Entscheider"],
    priority_rules: ["Engpass anhand des groessten rechnerischen Funnelverlusts"],
    benchmarks: ["Nettoquote 70 bis 80 Prozent ist Standard"],
  },
};

const metrics = [{
  slug: "michael",
  period_start: "2026-09-01",
  period_end: "2026-09-04",
  calls_gross: 100,
  calls_net: 75,
  net_rate: 75,
  gatekeeper_contacts: 30,
  connected_calls: 15,
  connection_rate: 50,
  direct_decision_maker_calls: 10,
  decision_maker_contacts: 25,
  appointments: 8,
  appointment_rate: 32,
  newsletters: 2,
  email: "never@example.test",
  raw_payload: { secret: true },
}];

const closing = [{
  period_start: "2026-09-01",
  period_end: "2026-09-04",
  appointments: 8,
  setter_calls: 7,
  setter_successes: 4,
  setter_success_rate: 57.14,
  closer_calls: 3,
  closer_second_calls: 1,
  decided_closer_calls: 2,
  closer_sales: 1,
  closer_success_rate: 50,
  new_customers: 1,
  close_note: "must stay private",
}];

test("assistant comparisons use the matching preceding period", () => {
  assert.equal(previousReferenceDate("day", "2026-09-07"), "2026-09-04");
  assert.equal(previousReferenceDate("week", "2026-09-04"), "2026-08-28");
  assert.equal(previousReferenceDate("month", "2026-03-31"), "2026-02-28");
});

test("assistant question is bounded and whitespace-normalized", () => {
  assert.equal(normalizeAssistantQuestion("  Wo   liegt der Engpass?  "), "Wo liegt der Engpass?");
  assert.throws(() => normalizeAssistantQuestion("x"));
  assert.throws(() => normalizeAssistantQuestion("x".repeat(501)));
});

test("assistant metrics calculate weighted team rates", () => {
  const result = buildAssistantMetrics([
    metrics[0],
    { ...metrics[0], slug: "felix", calls_gross: 50, calls_net: 25, gatekeeper_contacts: 10, connected_calls: 2, decision_maker_contacts: 5, appointments: 1 },
  ]);
  assert.equal(result.team.calls_gross, 150);
  assert.equal(result.team.calls_net, 100);
  assert.equal(result.team.net_rate, 66.67);
  assert.equal(result.team.transfer_rate, 42.5);
  assert.equal(result.team.appointment_rate, 30);
});

test("model input contains only whitelisted aggregates and curated context", () => {
  const result = buildAssistantInput({
    question: "Was sollen wir priorisieren?",
    period: "week",
    referenceDate: "2026-09-04",
    currentMetrics: metrics,
    previousMetrics: metrics,
    currentClosing: closing,
    previousClosing: closing,
    pipeline: {
      as_of: "2026-09-04",
      window_start: "2026-07-01",
      retention_months: 3,
      counts: { total_open: 4, setter_pending: 1, closer_scheduled: 2, rescheduled_closer: 0, pending_decision_cc2: 1, from_previous_months: 1, older_than_14_days: 0 },
      oldest_open_date: "2026-08-20",
      lead_ids: ["lead_secret"],
    },
    context: { ...context, api_key: "never-send" },
  });

  const serialised = JSON.stringify(result);
  assert.equal(result.current.dashboard.team.net_rate, 75);
  assert.equal(result.comparison_reference_date, "2026-08-28");
  assert.equal(serialised.includes("never@example.test"), false);
  assert.equal(serialised.includes("raw_payload"), false);
  assert.equal(serialised.includes("must stay private"), false);
  assert.equal(serialised.includes("lead_secret"), false);
  assert.equal(serialised.includes("never-send"), false);
});

test("assistant output accepts only the strict answer field", () => {
  const response = {
    output: [{ content: [{ type: "output_text", text: JSON.stringify({ answer: "Die Terminquote ist stabil." }) }] }],
  };
  assert.equal(parseAssistantAnswer(response), "Die Terminquote ist stabil.");
  assert.throws(() => parseAssistantAnswer({ output: [] }));
});
