import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateCallTimeRows,
  calculateCallTimeQuality,
  callTimeMetric,
  analyzeCallTimeWindows,
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

const hour = (metric_hour, overrides = {}) => ({ metric_hour, calls_gross: 30, calls_net: 20,
  productive_calls: 20, gatekeeper_contacts: 10, connected_calls: 5,
  decision_maker_contacts: 10, appointments: 2, ...overrides });

test('zwei verschiedene Stunden werden pro Kennzahl geordnet, auch nach 18 Uhr', () => {
  const rows = [hour(9), hour(10, { appointments: 4 }), hour(20, { appointments: 6 })];
  const report = analyzeCallTimeWindows(rows, 'appointment');
  assert.deepEqual(report.ranked.map(entry => entry.hour), [20, 10]);
  assert.equal(report.windows[0].metric.value, 20);
  assert.notEqual(report.windows[0].rankingValue, 20); // Nur die Rangfolge wird geglättet.
});

test('ein einzelner Treffer und geringe Anrufbasis werden nicht empfohlen', () => {
  const single = hour(8, { calls_gross: 1, calls_net: 1, productive_calls: 1,
    gatekeeper_contacts: 1, connected_calls: 1, decision_maker_contacts: 1, appointments: 1 });
  for (const mode of ['quality','productive','connection','decision','appointment']) {
    assert.deepEqual(analyzeCallTimeWindows([single, hour(9), hour(10)], mode).ranked.map(entry => entry.hour), [9, 10]);
  }
  assert.equal(analyzeCallTimeWindows([hour(9, { decision_maker_contacts: 4, appointments: 4 })], 'appointment').ranked.length, 0);
});

test('kein erfundener zweiter Platz ohne weiteren Erfolg oder Daten', () => {
  assert.deepEqual(analyzeCallTimeWindows([hour(9), hour(10, { appointments: 0 })], 'appointment').ranked.map(entry => entry.hour), [9]);
  assert.equal(analyzeCallTimeWindows([hour(9, { appointments: 0 })], 'appointment').ranked.length, 0);
  assert.equal(analyzeCallTimeWindows([]).ranked.length, 0);
});

test('Stundenzeilen werden aus absoluten Werten addiert, nicht aus Prozentmitteln', () => {
  const rows = [hour(9, { decision_maker_contacts: 5, appointments: 5 }), hour(9, { decision_maker_contacts: 20, appointments: 0 })];
  const report = analyzeCallTimeWindows(rows, 'appointment');
  assert.equal(report.windows.length, 1);
  assert.equal(report.windows[0].metric.value, 20); // 5/25, nicht (100% + 0%)/2.
  assert.equal(report.ranked.length, 1);
});

test('GF nicht erreichbar bleibt separat und aendert keine Durchstellquote', () => {
  const a = analyzeCallTimeWindows([hour(9)], 'connection');
  const b = analyzeCallTimeWindows([hour(9, { gf_unavailable_calls: 50, gatekeeper_unavailable_calls: 40 })], 'connection');
  assert.equal(a.windows[0].metric.value, b.windows[0].metric.value);
  assert.equal(b.windows[0].quality.gf_unavailable_calls, 50);
});

test('widerspruechliche Werte werden nicht als 100 Prozent kaschiert oder empfohlen', () => {
  const report = analyzeCallTimeWindows([hour(9, { appointments: 11 })], 'appointment');
  assert.equal(report.windows[0].metric.value, null);
  assert.equal(report.windows[0].quality.quality, null);
  assert.equal(report.ranked.length, 0);
});

test('Gleichstand nutzt zuerst die groessere Basis, danach die fruehere Stunde', () => {
  const rows = [hour(10), hour(9), hour(11, { calls_gross: 60, calls_net: 40, productive_calls: 40,
    gatekeeper_contacts: 20, connected_calls: 10, decision_maker_contacts: 20, appointments: 4 })];
  assert.deepEqual(analyzeCallTimeWindows(rows, 'appointment').ranked.map(entry => entry.hour), [11, 9]);
});

test('fehlende Stufen werden nicht aus fremden Stunden ergaenzt', () => {
  const row = hour(9, { gatekeeper_contacts: 0, connected_calls: 0, decision_maker_contacts: 0, appointments: 0 });
  const q = calculateCallTimeQuality(row, aggregateCallTimeRows([row, hour(10)]));
  assert.equal(q.rates.connection, null);
  assert.equal(q.smoothedRates.connection, null);
  assert.equal(q.smoothedRates.appointment, null);
});
