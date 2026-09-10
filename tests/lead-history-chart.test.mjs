import test from 'node:test';import assert from 'node:assert/strict';
import {buildHistorySeries,renderHistoryChart} from '../lead-history-chart.mjs';
import {NO_SHOW_STATUS_IDS} from '../lead-selection-model.mjs';
const noShow=[...NO_SHOW_STATUS_IDS][0];
const group={key:'setting',label:'Setting',selection_start:'2026-09-01T00:00Z',selection_end:'2026-09-03T12:00Z',leads:[{lead_id:'lead_A',first_recorded_at:'2026-09-01T10:00Z',status_id:'followup'}]};
const report={period:{type:'month'},history:[{lead_id:'lead_A',source_event_id:'a',recorded_at:'2026-09-01T10:00Z',status_id:noShow},{lead_id:'lead_A',source_event_id:'b',recorded_at:'2026-09-02T10:00Z',status_id:'followup'},{lead_id:'lead_A',source_event_id:'future',recorded_at:'2026-09-04T10:00Z',status_id:noShow}]};
test('a later follow-up never repaints the earlier No Show; no future point is rendered',()=>{
 const points=buildHistorySeries(report,group);assert.equal(points[0].total,0);
 assert.equal(points[1].no_show,1);assert.equal(points[1].relevant,0);
 assert.equal(points.at(-1).no_show,0);assert.equal(points.at(-1).relevant,1);
 assert(points.every(p=>p.at<=Date.parse(group.selection_end)));
});
test('filtering a lead removes it from every historical KPI as well',()=>assert(buildHistorySeries(report,{...group,leads:[]}).every(p=>p.total===0)));
test('graph uses discrete steps, units, exact timestamp popups and a source-cohort No Show rate',()=>{
 const html=renderHistoryChart(report,group);assert.match(html,/Anzahl Leads/);assert.match(html,/data-chart-point/);assert.match(html,/No-Show-Quote/);assert.match(html,/1 \/ 1 · 100 %/);assert.match(html,/H[0-9.]+V/);
});
