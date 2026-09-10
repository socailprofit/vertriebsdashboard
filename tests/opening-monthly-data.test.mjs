import test from 'node:test';import assert from 'node:assert/strict';
import {monthlyComparisonDates,loadOpeningMonthly} from '../opening-monthly-data.mjs';
import {openingComparison,openingMonthMetrics,renderOpeningMonthly,openingDevelopmentSeries} from '../opening-monthly-view.mjs';
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
 assert.deepEqual(openingComparison(null,current,metric),{label:'+100 %',tone:'up',basis:'Jeweils Tag 1–10 · gegenüber Aug. 2026'});
});
test('negative rate changes use red and percentage points, never relative percent',()=>{
 const metric=openingMonthMetrics.find(m=>m.key==='appointment_rate');
 const result=openingComparison({appointment_rate:25,decision_maker_contacts:20},{appointment_rate:20,decision_maker_contacts:20},metric);
 assert.equal(result.tone,'down');assert.equal(result.label,'-5 Pp.');
});
test('development mode uses one plot with separate employee series and unit-consistent metrics',()=>{
 const people=[{slug:'michael',display_name:'Michael'},{slug:'felix',display_name:'Felix'}];
 const rows=people.flatMap(p=>['2026-07-01','2026-08-01','2026-09-01'].map((m,i)=>({slug:p.slug,month_start:m,month_end:m,calls_gross:100+i*20,calls_net:70,net_rate:70,gatekeeper_contacts:20,connection_rate:50,decision_maker_contacts:10,appointments:3,appointment_rate:30})));
 const html=renderOpeningMonthly(rows,people,'team','2026-09-10','development');
 assert.equal((html.match(/class="opening-development-card"/g)||[]).length,1);
 assert.equal((html.match(/class="opening-combined-svg"/g)||[]).length,1);
 assert.equal((html.match(/data-opening-metric=/g)||[]).length,4);
 assert.equal((html.match(/class="opening-combined-point /g)||[]).length,6);
 assert.equal((html.match(/type="radio"/g)||[]).length,4);
 assert.match(html,/opening-point-value/);
 const rates=renderOpeningMonthly(rows,people,'team','2026-09-10','development',{unit:'rates'});
 assert.equal((rates.match(/class="opening-combined-svg"/g)||[]).length,1);
 assert.equal((rates.match(/data-opening-metric=/g)||[]).length,3);
 assert.doesNotMatch(rates,/data-opening-metric="calls_gross"/);
 assert.match(html,/person-michael/);assert.match(html,/person-felix/);assert.match(html,/data-chart-point/);
 assert.doesNotMatch(renderOpeningMonthly(rows,people,'felix','2026-09-10','development'),/person-michael/);
});


test('shared chart keeps raw monthly values, missing history and unit-specific scales',()=>{
 const people=[{slug:'michael',display_name:'Michael'}],months=['2026-07-01','2026-08-01','2026-09-01'];
 const rows=[{slug:'michael',month_start:months[0],calls_gross:0,calls_coverage_complete:false,calls_coverage_days:0},{slug:'michael',month_start:months[1],calls_gross:100},{slug:'michael',month_start:months[2],calls_gross:50,partial:true}];
 const model=openingDevelopmentSeries(rows,people,months,{unit:'counts',metrics:['calls_gross','appointment_rate']});
 assert.equal(model.series.length,1);assert.deepEqual(model.series[0].data.map(p=>p.value),[null,100,50]);
 assert.equal(model.series[0].data[2].partial,true);assert.equal(model.max,100);
 const html=renderOpeningMonthly(rows,people,'michael','2026-09-10','development',{unit:'counts',metrics:['calls_gross']});
 assert.equal((html.match(/class="opening-chart-line /g)||[]).length,1);
 assert.match(html,/unvollständig/);assert.match(html,/is-incomplete/);
 assert.equal(openingDevelopmentSeries(rows,people,months,{unit:'rates'}).max,100);
});

test('unselected metrics and other employees never affect the shared chart scale',()=>{
 const people=[{slug:'felix',display_name:'Felix'}],months=['2026-09-01'];
 const rows=[{slug:'felix',month_start:months[0],calls_gross:1000,appointments:5},{slug:'michael',month_start:months[0],appointments:500}];
 const model=openingDevelopmentSeries(rows,people,months,{unit:'counts',metrics:['appointments']});
 assert.equal(model.series.length,1);assert.equal(model.max,8);
 const empty=renderOpeningMonthly(rows,people,'felix','2026-09-10','development',{unit:'counts',metrics:[]});
 assert.match(empty,/data-opening-metric="calls_gross" checked/);assert.equal((empty.match(/class="opening-combined-point /g)||[]).length,1);
});


test('rightmost comparison is the latest month versus its predecessor, including a running month',()=>{
 const people=[{slug:'michael',display_name:'Michael'}];
 const previous={slug:'michael',month_start:'2026-08-01',month_end:'2026-08-31',appointments:15};
 const current={slug:'michael',month_start:'2026-09-01',month_end:'2026-09-10',partial:true,appointments:6,
  comparison:{days:10,previous:{...previous,month_end:'2026-08-10',appointments:2},current:{month_start:'2026-09-01',month_end:'2026-09-10',appointments:6}}};
 const rows=[{...previous,month_start:'2026-07-01',month_end:'2026-07-31',appointments:14},previous,current];
 const html=renderOpeningMonthly(rows,people,'team','2026-09-10');
 assert.match(html,/<th>Sept\. 2026<small>gegenüber Aug\. 2026<\/small><\/th>/);
 const finalCells=[...html.matchAll(/<td class="opening-month-delta">(.*?)<\/td>/g)];
 const appointmentCell=finalCells[openingMonthMetrics.findIndex(m=>m.key==='appointments')][1];
 assert.match(appointmentCell,/\+200 %/);assert.doesNotMatch(appointmentCell,/7,1/);
 const chart=renderOpeningMonthly(rows,people,'team','2026-09-10','development',{unit:'counts',metrics:['appointments']});
 assert.match(chart,/6 Termine gegenüber 2 Termine im Vormonat/);
 assert.match(chart,/01\.09\.2026–10\.09\.2026 gegenüber 01\.08\.2026–10\.08\.2026/);
 assert.match(chart,/Das Gespräch muss dafür noch nicht stattgefunden haben/);
 current.partial=false;current.month_end='2026-09-30';
 const closed=renderOpeningMonthly(rows,people,'team','2026-09-30');
 const closedCells=[...closed.matchAll(/<td class="opening-month-delta">(.*?)<\/td>/g)];
 assert.match(closedCells[5][1],/-60 %/);
});
