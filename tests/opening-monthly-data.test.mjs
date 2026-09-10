import test from 'node:test';import assert from 'node:assert/strict';
import {monthlyComparisonDates,loadOpeningMonthly} from '../opening-monthly-data.mjs';
import {openingComparison,openingMonthMetrics,renderOpeningMonthly} from '../opening-monthly-view.mjs';
test('partial comparisons use equal calendar-day spans, including short months and year boundaries',()=>{
 assert.deepEqual(monthlyComparisonDates('2026-09-10'),{current:'2026-09-10',previous:'2026-08-10',days:10});
 assert.deepEqual(monthlyComparisonDates('2026-03-30'),{current:'2026-03-28',previous:'2026-02-28',days:28});
 assert.deepEqual(monthlyComparisonDates('2024-03-30'),{current:'2024-03-29',previous:'2024-02-29',days:29});
 assert.deepEqual(monthlyComparisonDates('2026-01-10'),{current:'2026-01-10',previous:'2025-12-10',days:10});
 assert.equal(monthlyComparisonDates('2026-09-30'),null);
});
test('same-period CRM metrics are attached without overwriting the visible monthly totals',async()=>{
 const queries=[];
 const rows=await loadOpeningMonthly(async date=>{
  queries.push(date);return [{slug:'michael',month_start:date.slice(0,7)+'-01',month_end:date,partial:date!=='2026-02-28',appointments:date==='2026-03-30'?20:10}];
 },'2026-03-30','2026-09-10');
 assert.deepEqual(queries,['2026-03-30','2026-02-28','2026-03-28']);
 assert.equal(rows[0].appointments,20);assert.equal(rows[0].comparison.current.appointments,10);
 assert.equal(rows[0].comparison.previous.appointments,10);assert.equal(rows[0].comparison.days,28);
});
test('future dates are capped and incomplete coverage remains uncomparable',async()=>{
 const queries=[];await loadOpeningMonthly(async date=>{queries.push(date);return[];},'2026-12-31','2026-09-10');
 assert.deepEqual(queries,['2026-09-10','2026-08-10']);
 const metric=openingMonthMetrics[0],previous={month_start:'2026-08-01',calls_gross:100,calls_coverage_complete:false,calls_coverage_days:2};
 const current={month_start:'2026-09-01',calls_gross:200,partial:true,comparison:{days:10,previous,current:{calls_gross:200}}};
 assert.equal(openingComparison(null,current,metric).label,'—');
 previous.calls_coverage_complete=true;
 assert.deepEqual(openingComparison(null,current,metric),{label:'+100 %',tone:'up',basis:'1.–10. jeweils · Aug. 2026'});
});
test('negative rate changes use red and percentage points, never relative percent',()=>{
 const metric=openingMonthMetrics.find(m=>m.key==='appointment_rate');
 const result=openingComparison({appointment_rate:25,decision_maker_contacts:20},{appointment_rate:20,decision_maker_contacts:20},metric);
 assert.equal(result.tone,'down');assert.equal(result.label,'-5 Pp.');
});
test('development mode shows all seven KPIs with separate employee series and clickable data',()=>{
 const people=[{slug:'michael',display_name:'Michael'},{slug:'felix',display_name:'Felix'}];
 const rows=people.flatMap(p=>['2026-07-01','2026-08-01','2026-09-01'].map((m,i)=>({slug:p.slug,month_start:m,month_end:m,calls_gross:100+i*20,calls_net:70,net_rate:70,gatekeeper_contacts:20,connection_rate:50,decision_maker_contacts:10,appointments:3,appointment_rate:30})));
 const html=renderOpeningMonthly(rows,people,'team','2026-09-10','development');
 assert.equal((html.match(/class="opening-development-card"/g)||[]).length,7);
 assert.match(html,/person-michael/);assert.match(html,/person-felix/);assert.match(html,/data-chart-point/);
 assert.doesNotMatch(renderOpeningMonthly(rows,people,'felix','2026-09-10','development'),/person-michael/);
});
