import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAntonyPlan,calculateAntonyMonthForecast} from '../antony-planner.mjs';
import {transition,totalCounts,JOURNEY_KEYS} from '../pipeline-metrics.mjs';
const journey={booked_leads:100,setter_arrived:75,closer_qualified:50,closer_arrived:40,decided_leads:20,sold_leads:10,new_customers:8};
const goal={customerValueCents:1000000,targetRevenueCents:2000000,appointmentToCloserRateOverride:60,showRateOverride:80,decisionRateOverride:100,closingRateOverride:30,confirmationRateOverride:100};
test('complete backwards chain preserves the 15 bookings example',()=>{const p=calculateAntonyPlan({goal});assert.equal(p.requiredCustomers,2);assert.equal(p.requiredSales,2);assert.equal(p.requiredDecidedCloserCalls,7);assert.equal(p.requiredCloserCalls,7);assert.equal(p.requiredCloserAppointments,9);assert.equal(p.requiredAppointments,15);});
test('undecided Closer calls are not silently treated as decisions',()=>{const p=calculateAntonyPlan({goal:{...goal,decisionRateOverride:50}});assert.equal(p.requiredDecidedCloserCalls,7);assert.equal(p.requiredCloserCalls,14);assert.equal(p.requiredCloserAppointments,18);assert.equal(p.requiredAppointments,30);});
test('a missing Won confirmation is not an acquired customer',()=>{const p=calculateAntonyPlan({goal:{...goal,confirmationRateOverride:50}});assert.equal(p.requiredSales,4);assert.equal(p.requiredDecidedCloserCalls,14);});
test('current forward rates multiply to the actual linked customers',()=>{const p=calculateAntonyPlan({actual:{appointments:100,journey}});assert.equal(p.potentialCloserAppointments,50);assert.equal(p.potentialCloserCalls,40);assert.equal(p.potentialCustomers,8);assert.equal(p.currentRates.closing,50);assert.equal(p.currentRates.decision,50);});
test('repeat calendar visits and work on older leads cannot complete the current cohort plan',()=>{
 const p=calculateAntonyPlan({actual:{appointments:200,closerAppointments:150,closerCalls:100,decidedCloserCalls:50,newCustomers:20,journey},goal:{customerValueCents:10000,targetNewCustomers:16}});
 assert.equal(p.potentialCustomers,8);assert.equal(p.cohortActuals.appointments,100);
 assert.equal(p.gaps.appointments,100);assert.equal(p.gaps.closerAppointments,50);assert.equal(p.gaps.customers,8);assert.equal(p.achievedRevenueCents,80000);
});
test('period totals cannot impersonate a same-lead conversion',()=>{const p=calculateAntonyPlan({actual:{appointments:2,closerAppointments:1,closerCalls:1,sales:1,decidedCloserCalls:1},goal:{customerValueCents:1000000,targetRevenueCents:2000000}});assert.equal(p.currentRates.appointmentToCloser,null);assert.equal(p.requiredAppointments,null);});
test('missing or invalid populations never display as zero or over 100 percent',()=>{for(const [n,d] of [[null,2],[2,null],[3,2],[0,0],[NaN,2]])assert.equal(transition(n,d).rate,null);assert.equal(transition(0,2).rate,0);assert.equal(transition(1,2).rate,50);});
test('empty known cohorts are zero, unavailable cohorts remain missing',()=>{assert.equal(totalCounts([],JOURNEY_KEYS).booked_leads,0);assert.equal(totalCounts(null,JOURNEY_KEYS).booked_leads,null);assert.equal(totalCounts([{booked_leads:null}],['booked_leads']).booked_leads,null);});

test('an explicit simulation never borrows missing assumptions from actual rates',()=>{
 const p=calculateAntonyPlan({actual:{journey},goal:{rateMode:'custom',targetNewCustomers:2,appointmentToCloserRateOverride:50}});
 assert.equal(p.effectiveRates.show,null);assert.equal(p.requiredAppointments,null);
});
test('complete reference and September without later evidence keep distinct results',()=>{
 const keys=['booked_leads','setter_arrived','closer_qualified','closer_arrived','decided_leads','sold_leads','new_customers'];
 const run=v=>calculateAntonyPlan({actual:{journey:Object.fromEntries(keys.map((k,i)=>[k,v[i]]))},goal:{targetNewCustomers:5}});
 const p=run([40,30,20,14,10,6,5]);assert.equal(p.requiredAppointments,40);assert.equal(p.requiredCloserCalls,14);assert.equal(p.requiredSales,6);
 const empty=run([9,5,0,0,0,0,0]);assert.equal(empty.currentRates.appointmentToCloser,0);assert.equal(empty.requiredAppointments,null);
});


test('month forecast uses only current cohort rates and its future first meetings',()=>{
 const f=calculateAntonyMonthForecast({journey,plannedFirstMeetings:25,customerValueCents:1000000,actual:{closerCalls:999,newCustomers:900}});
 assert.equal(f.projectedAppointments,125);assert.equal(f.projectedCloserCalls,50);assert.equal(f.projectedCustomers,10);assert.equal(f.projectedRevenueCents,10000000);
});
test('incomplete September rates and an empty October cohort do not fabricate a forecast',()=>{
 const september={booked_leads:9,closer_qualified:0,closer_arrived:0,decided_leads:0,sold_leads:0,new_customers:0};
 const f=calculateAntonyMonthForecast({journey:september,plannedFirstMeetings:4});assert.equal(f.projectedAppointments,13);assert.equal(f.projectedCustomers,null);
 const october=calculateAntonyMonthForecast({journey:{...september,booked_leads:0},plannedFirstMeetings:2});assert.equal(october.projectedAppointments,2);assert.equal(october.projectedCustomers,null);
 assert.equal(calculateAntonyMonthForecast({journey}).projectedCustomers,null);
});
