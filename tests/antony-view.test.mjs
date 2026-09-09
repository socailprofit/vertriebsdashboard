import test from 'node:test';
import assert from 'node:assert/strict';
import {activityCards, filterTrackingSource, originQualityPie} from '../antony-view.mjs';

test('five activity KPIs use performed CC2 and count unknown customer origin only once',()=>{
 const cards=activityCards({appointments:10,setter_calls:8,closer_calls:3,closer_second_calls:3,new_customers:1},
 {period_bridge:{cc2_calls:1,customers_without_booking:1},activity_by_origin:[{booked_date:null,new_customers:1}]});
 assert.deepEqual(cards.map(c=>[c.label,c.value]),[['Termine',10],['Setter Calls',8],['Closer Calls',3],['CC2',1],['Neukunden',1]]);
 assert.equal(cards[4].details.filter(d=>d.label.includes('Ursprung')).length,1);
 assert.ok(cards[3].details.some(d=>d.label==='CC2 vereinbart im Zeitraum'&&d.value==='3'));
});

test('missing CC2 evidence stays unknown instead of using agreement count',()=>{
 assert.equal(activityCards({closer_second_calls:3},null)[3].value,undefined);
});

test('source filtering keeps exact Close choices and applies to every table population without mutating the report',()=>{
 const report={lead_quality_rows:[{source:'DMC',owner:'michael'},{source:'LinkedIn',owner:'linkedin'}],calendar_rows:[{source:'DMC',stage:'setter',showrate_due:true},{source:'North Data'},{source:'LinkedIn Cold Calls'}],funnel_by_source:[{source:'DMC',setter_arrived:2},{source:'LinkedIn',setter_arrived:3}]};
 const dmc=filterTrackingSource(report,'DMC');
 assert.equal(dmc.lead_quality_rows.length,1);assert.equal(dmc.calendar_rows.length,1);assert.equal(dmc.funnel_by_source[0].setter_arrived,2);
 assert.equal(filterTrackingSource(report,'LinkedIn').calendar_rows.length,0);
 assert.equal(report.calendar_rows.length,3);assert.equal(filterTrackingSource(report,'all'),report);
});

test('origin pies preserve numerator and denominator and refuse a partial Closer showrate',()=>{
 const rows=[{closer_attended:1,closer_due:2,closer_unclassified:0,customers:2,processes:10}];
 assert.match(originQualityPie(rows,'closer'),/50 %/);assert.match(originQualityPie(rows,'customer'),/20 %/);
 assert.match(originQualityPie([{...rows[0],closer_unclassified:1}],'closer'),/Basis offen/);
 assert.doesNotMatch(originQualityPie([{...rows[0],closer_unclassified:1}],'closer'),/50 %/);
});
