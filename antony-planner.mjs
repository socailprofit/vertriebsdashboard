function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function validRate(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 100 ? number : null;
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
    appointmentToCloser: validRate(rate(closerAppointments, appointments)),
    show: validRate(rate(closerCalls, closerAppointments)),
    closing: validRate(rate(sales, decidedCloserCalls)),
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

  const potentialCloserAppointments = effectiveRates.appointmentToCloser
    ? appointments * (effectiveRates.appointmentToCloser / 100)
    : null;
  const potentialCloserCalls = potentialCloserAppointments !== null && effectiveRates.show
    ? potentialCloserAppointments * (effectiveRates.show / 100)
    : null;
  const potentialCustomers = potentialCloserCalls !== null
    && effectiveRates.show
    && effectiveRates.closing
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
