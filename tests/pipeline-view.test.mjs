import test from 'node:test';
import assert from 'node:assert/strict';
import {renderOriginPipelines} from '../pipeline-view.mjs';

test('two calendar-origin lanes retain unknown activity and distinguish missing calendar evidence from zero', () => {
  const groups = ['current','prior','unknown'].map(origin => ({origin,setter_calls:origin==='current'?5:1,setter_meetings:0,closer_calls:0,closer_meetings:null,cc2_agreed:0,new_customers:0,future_setter_meetings:0,future_closer_meetings:null}));
  const html=renderOriginPipelines({groups,period_start:'2026-09-01',period_end:'2026-09-09'});
  assert.equal((html.match(/class="origin-pipeline"/g)||[]).length,2);
  assert.match(html,/Ersttermin nicht sicher zugeordnet/);
  assert.match(html,/1 Setter-Gespräche/);
  assert.match(html,/Kalenderzuordnung noch nicht belegt/);
  assert.doesNotMatch(html,/Noch geplant/);
  assert.match(html,/01\.09\.2026 bis 09\.09\.2026/);
});

test('future calendar planning is not rendered as a performed conversation', () => {
  const html=renderOriginPipelines({groups:[{origin:'current',setter_calls:0,setter_meetings:0,closer_calls:0,cc2_agreed:0,new_customers:0,future_setter_meetings:2}],period_start:'2026-10-01',period_end:'2026-10-08',planning_end:'2026-10-31'});
  assert.match(html,/0 <span>durchgeführte Gespräche/);
  assert.match(html,/Noch geplant bis 31\.10\.2026: 2 Setter/);
  assert.doesNotMatch(html,/2 <span>durchgeführte Gespräche/);
  assert.doesNotMatch(html,/Ersttermin nicht sicher zugeordnet/);
});
