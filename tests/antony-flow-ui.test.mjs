import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const code=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const antony=html.slice(html.indexOf('id="antony-section"'),html.indexOf('id="dashboard-analysis-row"'));
test('Antony uses lead selections and removes superseded incoming/activity KPI surfaces',()=>{
 assert.match(antony,/Setting bis Neukunde/);assert.match(antony,/antony-lead-report/);
 assert.doesNotMatch(antony,/antony-attendance-rates|antony-handoff-rates|upcoming-meetings|antony-planner|Prognose|kpi-assistant|weekly-review/);
 assert.doesNotMatch(code,/renderAttendanceRates|renderStatusCards|renderUpcomingMeetings|renderAntonyPlanner|loadAntonyReport\(/);
});
test('source and current-status evidence clicks are scoped to authorized Antony users',()=>{
 assert.match(code,/canViewAntony\(\) && state.view==="antony"/);assert.match(code,/renderLeadEvidence/);assert.match(code,/data-lead-evidence/);
});
