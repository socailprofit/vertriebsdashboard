function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function validRate(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 100 ? number : null;
}

function observedRate(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

export function rate(numerator, denominator) {
  const base = nonNegative(denominator);
  if (base <= 0) return null;
  return (nonNegative(numerator) / base) * 100;
}

export function calculateAntonyPlan({ actual = {}, goal = {} } = {}) {
  const appointments = nonNegative(actual.appointments);
  const closerAppointments = nonNegative(actual.closerAppointments);
  const closerCalls = nonNegative(actual.closerCalls);
  const decidedCloserCalls = nonNegative(actual.decidedCloserCalls);
  const sales = nonNegative(actual.sales);
  const newCustomers = nonNegative(actual.newCustomers);

  const currentRates = {
    appointmentToCloser: observedRate(rate(closerAppointments, appointments)),
    show: observedRate(rate(closerCalls, closerAppointments)),
    closing: observedRate(rate(sales, decidedCloserCalls)),
  };
  const effectiveRates = {
    appointmentToCloser: validRate(goal.appointmentToCloserRateOverride) ?? currentRates.appointmentToCloser,
    show: validRate(goal.showRateOverride) ?? currentRates.show,
    closing: validRate(goal.closingRateOverride) ?? currentRates.closing,
  };

  const customerValueCents = nonNegative(goal.customerValueCents);
  const targetRevenueCents = nonNegative(goal.targetRevenueCents);
  const targetNewCustomers = Math.ceil(nonNegative(goal.targetNewCustomers));
  const customersForRevenue = customerValueCents > 0
    ? Math.ceil(targetRevenueCents / customerValueCents)
    : 0;
  const requiredCustomers = Math.max(targetNewCustomers, customersForRevenue);
  const hasGoal = customerValueCents > 0 && requiredCustomers > 0;

  const requiredDecidedCloserCalls = hasGoal && effectiveRates.closing
    ? Math.ceil(requiredCustomers / (effectiveRates.closing / 100))
    : null;
  const requiredCloserAppointments = requiredDecidedCloserCalls !== null && effectiveRates.show
    ? Math.ceil(requiredDecidedCloserCalls / (effectiveRates.show / 100))
    : null;
  const requiredAppointments = requiredCloserAppointments !== null && effectiveRates.appointmentToCloser
    ? Math.ceil(requiredCloserAppointments / (effectiveRates.appointmentToCloser / 100))
    : null;

  const potentialCloserAppointments = effectiveRates.appointmentToCloser !== null
    ? appointments * (effectiveRates.appointmentToCloser / 100)
    : null;
  const potentialCloserCalls = potentialCloserAppointments !== null && effectiveRates.show !== null
    ? potentialCloserAppointments * (effectiveRates.show / 100)
    : null;
  const potentialCustomers = potentialCloserCalls !== null
    && effectiveRates.closing !== null
    ? potentialCloserCalls * (effectiveRates.closing / 100)
    : null;

  return {
    currentRates,
    effectiveRates,
    requiredCustomers,
    customersForRevenue,
    requiredDecidedCloserCalls,
    requiredCloserAppointments,
    requiredAppointments,
    potentialCloserAppointments,
    potentialCloserCalls,
    potentialCustomers,
    potentialRevenueCents: potentialCustomers === null || customerValueCents <= 0
      ? null
      : potentialCustomers * customerValueCents,
    achievedRevenueCents: customerValueCents > 0 ? newCustomers * customerValueCents : null,
    gaps: {
      appointments: requiredAppointments === null ? null : Math.max(0, requiredAppointments - appointments),
      closerAppointments: requiredCloserAppointments === null
        ? null
        : Math.max(0, requiredCloserAppointments - closerAppointments),
      decidedCloserCalls: requiredDecidedCloserCalls === null
        ? null
        : Math.max(0, requiredDecidedCloserCalls - decidedCloserCalls),
      customers: hasGoal ? Math.max(0, requiredCustomers - newCustomers) : null,
    },
  };
}

export function calculateAntonyMonthForecast({
  actual = {},
  customerValueCents = 0,
  elapsedWorkdays = 0,
  totalWorkdays = 0,
} = {}) {
  const monthlyActual = {
    michaelAppointments: nonNegative(actual.michaelAppointments),
    felixAppointments: nonNegative(actual.felixAppointments),
    appointments: nonNegative(actual.appointments),
    closerAppointments: nonNegative(actual.closerAppointments),
    closerCalls: nonNegative(actual.closerCalls),
    decidedCloserCalls: nonNegative(actual.decidedCloserCalls),
    sales: nonNegative(actual.sales),
    newCustomers: nonNegative(actual.newCustomers),
  };
  const elapsed = Math.min(Math.floor(nonNegative(elapsedWorkdays)), Math.floor(nonNegative(totalWorkdays)));
  const total = Math.floor(nonNegative(totalWorkdays));
  const paceFactor = elapsed > 0 && total > 0 ? total / elapsed : null;
  const plan = calculateAntonyPlan({ actual: monthlyActual, goal: {} });

  const projectedMichaelAppointments = paceFactor === null
    ? null
    : monthlyActual.michaelAppointments * paceFactor;
  const projectedFelixAppointments = paceFactor === null
    ? null
    : monthlyActual.felixAppointments * paceFactor;
  const projectedAppointments = paceFactor === null
    ? null
    : monthlyActual.appointments * paceFactor;
  const projectedCloserAppointments = projectedAppointments !== null && plan.currentRates.appointmentToCloser !== null
    ? projectedAppointments * (plan.currentRates.appointmentToCloser / 100)
    : null;
  const projectedCloserCalls = projectedCloserAppointments !== null && plan.currentRates.show !== null
    ? projectedCloserAppointments * (plan.currentRates.show / 100)
    : null;
  const modeledCustomers = projectedCloserCalls !== null && plan.currentRates.closing !== null
    ? projectedCloserCalls * (plan.currentRates.closing / 100)
    : null;
  // Eine Prognose darf nie unter bereits realisierten Neukunden liegen. Das
  // kann bei periodenuebergreifenden Deals sonst trotz korrekter Ist-Zahl
  // passieren, weil Termine und Abschluss nicht zwingend im selben Monat sind.
  const projectedCustomers = modeledCustomers === null
    ? null
    : Math.max(monthlyActual.newCustomers, modeledCustomers);
  const value = nonNegative(customerValueCents);

  return {
    currentRates: plan.currentRates,
    elapsedWorkdays: elapsed,
    remainingWorkdays: Math.max(0, total - elapsed),
    totalWorkdays: total,
    projectedMichaelAppointments,
    projectedFelixAppointments,
    projectedAppointments,
    projectedCloserAppointments,
    projectedCloserCalls,
    projectedCustomers,
    additionalAppointments: projectedAppointments === null
      ? null
      : Math.max(0, projectedAppointments - monthlyActual.appointments),
    additionalCustomers: projectedCustomers === null
      ? null
      : Math.max(0, projectedCustomers - monthlyActual.newCustomers),
    actualRevenueCents: value > 0 ? monthlyActual.newCustomers * value : null,
    projectedRevenueCents: value > 0 && projectedCustomers !== null
      ? Math.round(projectedCustomers * value)
      : null,
  };
}
