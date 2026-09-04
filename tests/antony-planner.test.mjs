import test from "node:test";
import assert from "node:assert/strict";
import { calculateAntonyPlan } from "../antony-planner.mjs";

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
