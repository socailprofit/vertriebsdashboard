import { journeyRates } from './pipeline-metrics.mjs?v=2026-09-09-month-cohort-final';
function nonNegative(v) { const n=Number(v);return Number.isFinite(n)?Math.max(0,n):0; }
function positiveRate(v) { if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)&&n>0&&n<=100?n:null; }
export function rate(n,d) { return nonNegative(d)>0?nonNegative(n)/nonNegative(d)*100:null; }

// Forward and reverse paths contain every probability. Period totals alone
// cannot establish transitions between the same leads.
export function calculateAntonyPlan({actual={},goal={}}={}) {
 const currentRates=journeyRates(actual.journey);
 const cohortActuals=Object.fromEntries(Object.entries({appointments:'booked_leads',closerAppointments:'closer_qualified',closerCalls:'closer_arrived',decidedCloserCalls:'decided_leads',sales:'sold_leads',newCustomers:'new_customers'}).map(([key,source])=>{
  const value=actual.journey?.[source];return [key,value===null||value===undefined?null:nonNegative(value)];
 }));
 const effectiveRates=Object.fromEntries(['appointmentToCloser','show','decision','closing','confirmation'].map(k=>[k,goal.rateMode==='custom'?positiveRate(goal[k+'RateOverride']):(positiveRate(goal[k+'RateOverride'])??currentRates[k])]));
 const customerValueCents=nonNegative(goal.customerValueCents),targetRevenueCents=nonNegative(goal.targetRevenueCents);
 const customersForRevenue=customerValueCents>0?Math.ceil(targetRevenueCents/customerValueCents):0;
 const requiredCustomers=Math.max(Math.ceil(nonNegative(goal.targetNewCustomers)),customersForRevenue);
 const divide=(n,r)=>n!==null&&positiveRate(r)!==null?Math.ceil(n/(r/100)):null;
 const requiredSales=requiredCustomers>0?divide(requiredCustomers,effectiveRates.confirmation):null;
 const requiredDecidedCloserCalls=divide(requiredSales,effectiveRates.closing);
 const requiredCloserCalls=divide(requiredDecidedCloserCalls,effectiveRates.decision);
 const requiredCloserAppointments=divide(requiredCloserCalls,effectiveRates.show);
 const requiredAppointments=divide(requiredCloserAppointments,effectiveRates.appointmentToCloser);
 const multiply=(n,r)=>n!==null&&r!==null?n*r/100:null;
 const potentialCloserAppointments=multiply(cohortActuals.appointments,effectiveRates.appointmentToCloser);
 const potentialCloserCalls=multiply(potentialCloserAppointments,effectiveRates.show);
 const potentialDecisions=multiply(potentialCloserCalls,effectiveRates.decision);
 const potentialSales=multiply(potentialDecisions,effectiveRates.closing);
 const potentialCustomers=multiply(potentialSales,effectiveRates.confirmation);
 const gap=(required,achieved)=>required===null||achieved===null?null:Math.max(0,required-achieved);
 return {currentRates,effectiveRates,cohortActuals,requiredCustomers,customersForRevenue,requiredSales,requiredDecidedCloserCalls,requiredCloserCalls,requiredCloserAppointments,requiredAppointments,
 potentialCloserAppointments,potentialCloserCalls,potentialCustomers,potentialRevenueCents:customerValueCents>0&&potentialCustomers!==null?potentialCustomers*customerValueCents:null,
 achievedRevenueCents:customerValueCents>0&&cohortActuals.newCustomers!==null?cohortActuals.newCustomers*customerValueCents:null,
 gaps:{appointments:gap(requiredAppointments,cohortActuals.appointments),closerAppointments:gap(requiredCloserAppointments,cohortActuals.closerAppointments),decidedCloserCalls:gap(requiredDecidedCloserCalls,cohortActuals.decidedCloserCalls),customers:gap(requiredCustomers,cohortActuals.newCustomers)}};
}

// Forecast only the selected first-meeting cohort. Period activity and workday
// pace are intentionally not inputs; calls on older leads cannot change it.
export function calculateAntonyMonthForecast({journey,plannedFirstMeetings=null,customerValueCents=0}={}) {
 const currentRates=journeyRates(journey);
 const elapsed=journey?.booked_leads==null?null:nonNegative(journey.booked_leads);
 const planned=plannedFirstMeetings==null?null:nonNegative(plannedFirstMeetings);
 const appointments=elapsed===null||planned===null?null:elapsed+planned;
 const complete=Object.values(currentRates).every(r=>r!==null);
 const conversion=complete?Object.values(currentRates).reduce((n,r)=>n*r/100,1):null;
 const projectedCustomers=appointments!==null&&conversion!==null?appointments*conversion:null;
 const projectedCloserCalls=appointments!==null&&currentRates.appointmentToCloser!==null&&currentRates.show!==null?appointments*currentRates.appointmentToCloser/100*currentRates.show/100:null;
 const value=nonNegative(customerValueCents);
 return {currentRates,elapsedAppointments:elapsed,plannedFirstMeetings:planned,projectedAppointments:appointments,projectedCloserCalls,projectedCustomers,
 projectedRevenueCents:value>0&&projectedCustomers!==null?Math.round(projectedCustomers*value):null};
}
