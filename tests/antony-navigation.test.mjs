import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { renderSelectionReport } from '../lead-selection-view.mjs';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const renderer=source.slice(source.indexOf('function renderAntony()'),source.indexOf('// Zielerreichung getrennt'));
const navigation=source.slice(source.indexOf('  const viewButton = event.target.closest("[data-view]");'),source.indexOf('  const periodButton = event.target.closest("[data-period]");'));
function setup(){
 const reportElement={innerHTML:''},filters={innerHTML:''},time={textContent:''};
 const elements={'#lead-evidence-dialog':{close(){},innerHTML:''},'#antony-profile-avatar':{innerHTML:''},'#antony-lead-report':reportElement,'#antony-data-time':time};
 const state={view:'team',period:'month',referenceDate:'2026-09-10',antonyLeadReport:null,leadFilters:{}};
 let refreshes=0,urlView='team';
 const context=vm.createContext({state,Event,Intl,Date,document:{dispatchEvent(){},querySelector(selector){return selector==='#lead-filter-controls'?(reportElement.innerHTML.includes('id="lead-filter-controls"')?filters:null):elements[selector];}},filterLeadReport:r=>r,renderSelectionReport,renderDashboardAvatar:()=>'',enableProfileImageFallbacks(){},renderLeadFilters:()=>'<select>Zuordnung</select>',canViewAntony:()=>true,berlinToday:()=> '2026-09-10',refresh(){refreshes++;urlView=state.view;},window:{scrollTo(){}}});
 vm.runInContext(renderer+'\nfunction click(event){'+navigation+'}\nthis.click=click;',context);
 context.render=()=>{if(state.view==='antony')context.renderAntony();urlView=state.view;};
 return{context,state,reportElement,filters,time,refreshes:()=>refreshes,url:()=>urlView,click(view){context.click({target:{closest:s=>s==='[data-view]'?{dataset:{view}}:null}});}};
}
test('Team to Anthony renders the empty loading state and still starts the report request',()=>{
 const t=setup();t.click('antony');
 t.context.renderAntony();assert.match(t.reportElement.innerHTML,/Leadauswertung wird geladen/);
 assert.equal(t.time.textContent,'Leaddaten werden geladen …');
 assert.equal(t.refreshes(),1);assert.equal(t.url(),'antony');
 t.click('team');t.click('antony');assert.equal(t.refreshes(),3);
});
test('loaded Anthony report still receives its attribution filters',()=>{
 const t=setup();t.state.antonyLeadReport={data_as_of:'2026-09-10T09:07:00Z',groups:[{key:'setting',label:'Setting',leads:[]}]};
 t.click('antony');t.context.renderAntony();assert.match(t.filters.innerHTML,/Zuordnung/);assert.match(t.time.textContent,/11:07/);
});
