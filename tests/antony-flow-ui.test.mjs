import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const code=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const antony=html.slice(html.indexOf('id="antony-section"'),html.indexOf('id="dashboard-analysis-row"'));
test('Antony only renders historical status information and removes future, origin, planner and old AI surfaces',()=>{
 assert.match(antony,/Setting bis Verkauft/);assert.match(antony,/Übergänge und Absprünge/);
 assert.doesNotMatch(antony,/upcoming-meetings|antony-planner|Herkunft|Prognose|kpi-assistant|weekly-review|tracking-/);
 assert.doesNotMatch(code,/renderUpcomingMeetings|renderAntonyPlanner|loadAntonyReport\(/);
});
test('historical evidence clicks carry an exact status direction and destination',()=>{
 assert.match(code,/statusDetail.dataset.statusDestination/);
 assert.match(code,/renderStatusEvidence/);
});
