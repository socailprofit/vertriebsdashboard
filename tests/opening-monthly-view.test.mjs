import test from 'node:test';import assert from 'node:assert/strict';
import {openingMonthMetrics,openingMetricValue,openingDelta,renderOpeningMonthly} from '../opening-monthly-view.mjs';
test('rate deltas are percentage points; incomplete month and zero denominators never create a misleading comparison',()=>{
 const rate=openingMonthMetrics.find(m=>m.key==='connection_rate');
 assert.equal(openingDelta({connection_rate:20,gatekeeper_contacts:10},{connection_rate:30,gatekeeper_contacts:10},rate),'+10 Pp.');
 assert.equal(openingMetricValue({connection_rate:0,gatekeeper_contacts:0},rate),null);
 assert.equal(openingDelta({calls_gross:100},{calls_gross:200,partial:true},openingMonthMetrics[0]),'—');
});
test('individual views show only that employee and expose exact monthly values',()=>{
 const rows=[{slug:'felix',month_start:'2026-09-01',month_end:'2026-09-10',partial:true,calls_gross:150}];
 const html=renderOpeningMonthly(rows,[{slug:'felix',display_name:'Felix'},{slug:'michael',display_name:'Michael'}],'felix','2026-09-10');
 assert.match(html,/Felix/);assert.doesNotMatch(html,/Michael/);assert.match(html,/unvollständig/);assert.match(html,/data-chart-point/);
});

test('unimported call history is missing, not zero, and partial coverage cannot create a growth claim',()=>{
 const metric=openingMonthMetrics[0];
 assert.equal(openingMetricValue({calls_gross:0,calls_coverage_complete:false,calls_coverage_days:0},metric),null);
 assert.equal(openingMetricValue({calls_gross:200,calls_coverage_complete:false,calls_coverage_days:11},metric),200);
 assert.equal(openingDelta({calls_gross:0,calls_coverage_complete:false,calls_coverage_days:0},{calls_gross:200,calls_coverage_complete:false,calls_coverage_days:11},metric),'—');
});
