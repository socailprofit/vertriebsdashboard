import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {renderOpeningMonthly} from '../opening-monthly-view.mjs';
import {PEOPLE,assignment,personLabel} from '../verified-journey.mjs';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const former='user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4';
test('active caller views are driven by the roster; Anthony has all opening features',()=>{
 const context=vm.createContext({state:{view:'anthony',period:'month',people:[{slug:'michael'},{slug:'anthony'}]}});
 vm.runInContext(app.slice(app.indexOf('function isOpeningView()'),app.indexOf('// --- Daten laden'))+';this.check=canViewThreeMonthReview;',context);
 assert.equal(context.check(),true);
 context.state.view='felix';assert.equal(context.check(),false);
 context.state.view='antony';assert.equal(context.check(),false);
 context.state.view='team';assert.equal(context.check(),true);
});
test('monthly table and graph show Anthony and exclude retired people',()=>{
 const people=[{slug:'michael',display_name:'Michael'},{slug:'anthony',display_name:'Anthony'},{slug:'felix',display_name:'Felix',active:false}];
 const rows=people.map(p=>({slug:p.slug,month_start:'2026-10-01',month_end:'2026-10-09',calls_gross:40,appointments:1}));
 for(const mode of ['monthly','development']){
  const html=renderOpeningMonthly(rows,people,'team','2026-10-09',mode);
  assert.match(html,/Anthony/);assert.match(html,/Michael/);assert.doesNotMatch(html,/Felix/);
 }
 const html=renderOpeningMonthly(rows,people,'anthony','2026-10-09');
 assert.match(html,/Anthony/);assert.doesNotMatch(html,/Michael|Felix/);
});
test('former ownership never becomes Anthony or LinkedIn; only active employees are selectable',()=>{
 assert.deepEqual(PEOPLE.map(p=>p.label),['Michael','Anthony','LinkedIn']);
 const dimensions={owner_id:former,lead_source:'LinkedIn'};
 assert.equal(assignment(dimensions,'assignment'),null);
 assert.equal(dimensions.owner_id,former);
 assert.equal(personLabel(former,'Felix'),'Ehemalig / nicht zugeordnet');
});
