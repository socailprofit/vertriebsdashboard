import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBusinessContext,
  buildModelInput,
  buildWeeklyComparison,
  businessContextIsConfigured,
  extractResponseText,
  parseReviewSentences,
  previousCompletedSalesWeek,
} from "../supabase/functions/_shared/weekly-review.ts";

test("Monday run reviews the previous completed Monday-Friday sales week", () => {
  assert.deepEqual(previousCompletedSalesWeek("2026-09-07"), {
    start: "2026-08-31",
    end: "2026-09-04",
    isoYear: 2026,
    isoWeek: 36,
  });
});

test("calendar week stays correct across the ISO year boundary", () => {
  assert.deepEqual(previousCompletedSalesWeek("2027-01-04"), {
    start: "2026-12-28",
    end: "2027-01-01",
    isoYear: 2026,
    isoWeek: 53,
  });
});

test("model input whitelists aggregated metrics and drops raw or personal fields", () => {
  const input = buildModelInput({
    period: { start: "2026-08-31", end: "2026-09-04", timezone: "Europe/Berlin" },
    funnel: {
      calls_gross: 100,
      calls_net: 70,
      net_rate: 70,
      gatekeeper_contacts: 40,
      connected_calls: 20,
      transfer_rate: 50,
      decision_maker_contacts: 35,
      appointments: 8,
      appointment_rate: 22.86,
      close_note: "must never leave Supabase",
    },
    closing: {
      setter_calls: 8,
      setter_successes: 6,
      setter_show_rate: 75,
      closer_calls: 5,
      closer_show_rate: 83.33,
      cc2_agreed: 1,
      cc2_rate: 20,
      decided_closer_calls: 4,
      closer_sales: 1,
      closer_close_rate: 25,
      new_customers: 1,
      appointment_to_closer_rate: 62.5,
      lead_id: "lead_secret",
    },
    data_basis: { too_small: false },
    email: "person@example.test",
    payload: { raw: true },
  });

  const serialised = JSON.stringify(input);
  assert.equal(serialised.includes("close_note"), false);
  assert.equal(serialised.includes("lead_secret"), false);
  assert.equal(serialised.includes("person@example.test"), false);
  assert.equal(serialised.includes("payload"), false);
  assert.equal(input.closing.new_customers, 1);
});

test("business context is bounded, whitelisted and needs the four core fields", () => {
  const context = buildBusinessContext({
    company: { name: "Social Profit", offer: "Angebot", business_model: "Modell", api_key: "secret" },
    icp: { summary: "ICP", buyer_roles: ["Geschäftsführung"], company_profile: "Profil", email: "hidden" },
    sales: { motion: "Outbound", kpi_definitions: ["Terminquote"], priority_rules: [], benchmarks: [] },
    close_notes: "never include",
  });
  const serialised = JSON.stringify(context);
  assert.equal(businessContextIsConfigured(context), true);
  assert.equal(serialised.includes("api_key"), false);
  assert.equal(serialised.includes("hidden"), false);
  assert.equal(serialised.includes("close_notes"), false);
  assert.equal(businessContextIsConfigured(buildBusinessContext({})), false);
});

test("weekly comparison covers every aggregate KPI with stable deltas", () => {
  const current = buildModelInput({
    funnel: {
      calls_gross: 120, calls_net: 90, net_rate: 75,
      gatekeeper_contacts: 40, connected_calls: 20, transfer_rate: 50,
      decision_maker_contacts: 30, appointments: 8, appointment_rate: 26.67,
    },
    closing: {
      setter_calls: 8, setter_successes: 6, setter_show_rate: 75,
      closer_calls: 5, closer_show_rate: 83.33, cc2_agreed: 1, cc2_rate: 20,
      decided_closer_calls: 4, closer_sales: 1, closer_close_rate: 25,
      new_customers: 1, appointment_to_closer_rate: 62.5,
    },
    data_basis: { too_small: false },
  });
  const previous = buildModelInput({
    funnel: {
      calls_gross: 100, calls_net: 65, net_rate: 65,
      gatekeeper_contacts: 35, connected_calls: 14, transfer_rate: 40,
      decision_maker_contacts: 25, appointments: 4, appointment_rate: 16,
    },
    closing: {
      setter_calls: 6, setter_successes: 3, setter_show_rate: 50,
      closer_calls: 3, closer_show_rate: 100, cc2_agreed: 0, cc2_rate: 0,
      decided_closer_calls: 3, closer_sales: 0, closer_close_rate: 0,
      new_customers: 0, appointment_to_closer_rate: 75,
    },
    data_basis: { too_small: true },
  });

  const comparison = buildWeeklyComparison(current, previous);
  assert.deepEqual(comparison.funnel.calls_gross, { absolute_change: 20 });
  assert.deepEqual(comparison.funnel.net_rate, { percentage_point_change: 10 });
  assert.deepEqual(comparison.closing.setter_successes, { absolute_change: 3 });
  assert.deepEqual(comparison.closing.closer_show_rate, { percentage_point_change: -16.67 });
  assert.equal(Object.keys(comparison.funnel).length, 9);
  assert.equal(Object.keys(comparison.closing).length, 12);
  assert.deepEqual(comparison.data_basis, {
    current_too_small: false,
    previous_too_small: true,
    trend_reliable: false,
  });
});

test("structured model output covers every required review topic", () => {
  const json = JSON.stringify({
    strength: "Eins.",
    bottleneck: "Zwei.",
    trend_and_conversion: "Drei.",
    priority: "Vier.",
    action: "Fünf.",
  });
  const text = extractResponseText({
    output: [{ type: "message", content: [{ type: "output_text", text: json }] }],
  });
  assert.deepEqual(parseReviewSentences(text), ["Eins.", "Zwei.", "Drei.", "Vier.", "Fünf."]);
  assert.throws(() => parseReviewSentences(JSON.stringify({ strength: "Nur einer." })));
  assert.throws(() => parseReviewSentences(JSON.stringify({ ...JSON.parse(json), action: "" })));
});
