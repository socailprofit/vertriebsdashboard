import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateCallTimeRows,
  calculateCallTimeQuality,
  callTimeMetric,
} from "../call-time-score.mjs";

test("Mailbox und ausserhalb der Geschaeftszeiten mindern nur die produktive Erreichbarkeit", () => {
  const row = {
    calls_gross: 10,
    calls_net: 8,
    mailbox_calls: 2,
    outside_business_hours_calls: 1,
    gatekeeper_contacts: 4,
    connected_calls: 2,
    decision_maker_contacts: 3,
    appointments: 1,
  };
  const quality = calculateCallTimeQuality(row, row);

  assert.equal(quality.productive_calls, 5);
  assert.equal(quality.rates.productive, 50);
  assert.equal(quality.rates.connection, 50);
  assert.ok(Math.abs(callTimeMetric(quality, "appointment").value - (100 / 3)) < 0.000001);
});

test("kleine Stundenbasis wird zum Periodenmittel geglaettet", () => {
  const baseline = aggregateCallTimeRows([
    { calls_gross: 50, calls_net: 25, productive_calls: 25, gatekeeper_contacts: 20, connected_calls: 10, decision_maker_contacts: 12, appointments: 6 },
    { calls_gross: 50, calls_net: 25, productive_calls: 25, gatekeeper_contacts: 20, connected_calls: 10, decision_maker_contacts: 12, appointments: 6 },
  ]);
  const singleHit = calculateCallTimeQuality(
    { calls_gross: 1, calls_net: 1, productive_calls: 1, gatekeeper_contacts: 1, connected_calls: 1, decision_maker_contacts: 1, appointments: 1 },
    baseline,
  );

  assert.ok(singleHit.quality > 50);
  assert.ok(singleHit.quality < 100);
});

test("eine leere Stunde erhaelt keine erfundene Qualitaet", () => {
  const baseline = aggregateCallTimeRows([{ calls_gross: 20, calls_net: 10, productive_calls: 10 }]);
  const empty = calculateCallTimeQuality({}, baseline);

  assert.equal(empty.quality, null);
  assert.equal(callTimeMetric(empty, "quality").value, null);
});
