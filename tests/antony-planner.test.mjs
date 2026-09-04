import test from "node:test";
import assert from "node:assert/strict";
import { calculateAntonyMonthForecast, calculateAntonyPlan } from "../antony-planner.mjs";

test("rechnet das Umsatzbeispiel rueckwaerts auf neun Closer-Termine", () => {
  const result = calculateAntonyPlan({
    actual: {},
    goal: {
      customerValueCents: 1_000_000,
      targetRevenueCents: 2_000_000,
      targetNewCustomers: 0,
      appointmentToCloserRateOverride: 60,
      showRateOverride: 80,
      closingRateOverride: 30,
    },
  });

  assert.equal(result.requiredCustomers, 2);
  assert.equal(result.requiredDecidedCloserCalls, 7);
  assert.equal(result.requiredCloserAppointments, 9);
  assert.equal(result.requiredAppointments, 15);
});

test("das strengere Kunden- oder Umsatzziel bestimmt den Bedarf", () => {
  const result = calculateAntonyPlan({
    actual: {},
    goal: {
      customerValueCents: 1_000_000,
      targetRevenueCents: 2_000_000,
      targetNewCustomers: 4,
      appointmentToCloserRateOverride: 50,
      showRateOverride: 80,
      closingRateOverride: 25,
    },
  });

  assert.equal(result.customersForRevenue, 2);
  assert.equal(result.requiredCustomers, 4);
  assert.equal(result.requiredDecidedCloserCalls, 16);
  assert.equal(result.requiredCloserAppointments, 20);
  assert.equal(result.requiredAppointments, 40);
});

test("ohne belastbare Quote bleibt die betroffene Planung offen", () => {
  const result = calculateAntonyPlan({
    actual: { appointments: 8, closerAppointments: 0, closerCalls: 0, decidedCloserCalls: 0 },
    goal: { customerValueCents: 1_000_000, targetRevenueCents: 4_000_000 },
  });

  assert.equal(result.requiredCustomers, 4);
  assert.equal(result.requiredDecidedCloserCalls, null);
  assert.equal(result.requiredCloserAppointments, null);
  assert.equal(result.requiredAppointments, null);
  assert.equal(result.potentialCustomers, null);
});

test("zeigt Terminpotenzial auch ohne eingetragenen Kundenwert", () => {
  const result = calculateAntonyPlan({
    actual: { appointments: 20, closerAppointments: 10, closerCalls: 8, decidedCloserCalls: 8, sales: 2 },
    goal: {},
  });

  assert.equal(result.potentialCloserAppointments, 10);
  assert.equal(result.potentialCloserCalls, 8);
  assert.equal(result.potentialCustomers, 2);
  assert.equal(result.potentialRevenueCents, null);
});

test("prognostiziert den Monatsendstand aus aktuellem Arbeitstagstempo und Ist-Raten", () => {
  const result = calculateAntonyMonthForecast({
    actual: {
      michaelAppointments: 12,
      felixAppointments: 8,
      appointments: 20,
      closerAppointments: 12,
      closerCalls: 8,
      decidedCloserCalls: 8,
      sales: 2,
      newCustomers: 2,
    },
    customerValueCents: 1_000_000,
    elapsedWorkdays: 5,
    totalWorkdays: 20,
  });

  assert.equal(result.projectedMichaelAppointments, 48);
  assert.equal(result.projectedFelixAppointments, 32);
  assert.equal(result.projectedAppointments, 80);
  assert.equal(result.projectedCloserAppointments, 48);
  assert.ok(Math.abs(result.projectedCloserCalls - 32) < 1e-9);
  assert.ok(Math.abs(result.projectedCustomers - 8) < 1e-9);
  assert.ok(Math.abs(result.additionalCustomers - 6) < 1e-9);
  assert.equal(result.actualRevenueCents, 2_000_000);
  assert.equal(result.projectedRevenueCents, 8_000_000);
  assert.equal(result.remainingWorkdays, 15);
});

test("eine Monatsprognose faellt nie unter bereits realisierte Neukunden", () => {
  const result = calculateAntonyMonthForecast({
    actual: {
      appointments: 10,
      closerAppointments: 2,
      closerCalls: 1,
      decidedCloserCalls: 1,
      sales: 1,
      newCustomers: 4,
    },
    customerValueCents: 1_000_000,
    elapsedWorkdays: 10,
    totalWorkdays: 20,
  });

  assert.equal(result.projectedCustomers, 4);
  assert.equal(result.additionalCustomers, 0);
  assert.equal(result.projectedRevenueCents, 4_000_000);
});

test("ohne verstrichenen Arbeitstag wird kein kuenstliches Monatsvolumen erfunden", () => {
  const result = calculateAntonyMonthForecast({
    actual: { appointments: 3, closerAppointments: 1, closerCalls: 1, decidedCloserCalls: 1, sales: 1 },
    customerValueCents: 1_000_000,
    elapsedWorkdays: 0,
    totalWorkdays: 20,
  });

  assert.equal(result.projectedAppointments, null);
  assert.equal(result.projectedRevenueCents, null);
  assert.equal(result.remainingWorkdays, 20);
});

test("eine beobachtete Nullquote bleibt ein ehrliches Nullpotenzial", () => {
  const result = calculateAntonyMonthForecast({
    actual: {
      appointments: 10,
      closerAppointments: 2,
      closerCalls: 0,
      decidedCloserCalls: 1,
      sales: 1,
      newCustomers: 0,
    },
    customerValueCents: 1_000_000,
    elapsedWorkdays: 5,
    totalWorkdays: 20,
  });

  assert.equal(result.currentRates.show, 0);
  assert.equal(result.projectedCloserCalls, 0);
  assert.equal(result.projectedCustomers, 0);
  assert.equal(result.projectedRevenueCents, 0);
});
