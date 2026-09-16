import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {LEAD_DIMENSION_FIELDS as F,SELECTION_STATUSES as S,isSelectedStatusEvent,leadDimensions} from '../supabase/functions/_shared/close-lead-dimensions.ts';
test('source selection uses old Setting/Closing and new Sold, never an incoming appointment',()=>{
 assert(isSelectedStatusEvent({old_status_id:S.setting}));assert(isSelectedStatusEvent({old_status_id:S.closing}));assert(isSelectedStatusEvent({new_status_id:S.customer}));assert(!isSelectedStatusEvent({new_status_id:S.setting}));
});
test('metadata retains actual source values and missing fields without attribution guesses',()=>{
 const d=leadDimensions({[`custom.${F.owner}`]:'u1',[`custom.${F.setter}`]:'u2',[`custom.${F.lead_source}`]:'New CRM Source',status_label:'New status'},new Map([['u1','Owner Name']]),true);
 assert.equal(d.owner,'Owner Name');assert.equal(d.owner_id,'u1');assert.equal(d.setter,'Nicht aufgelöst (u2)');assert.equal(d.closer,null);assert.equal(d.industry,null);assert.equal(d.lead_source,'New CRM Source');assert.equal(d.selection_tracked,true);
});
test('the automatic sync refreshes status-only and retained source leads with matching DB source ids',()=>{
 const sql=fs.readFileSync(new URL('../supabase/migrations/20260910062444_authoritative_lead_selections.sql',import.meta.url),'utf8');
 for(const id of Object.values(S))assert(sql.includes(id));
 const sync=fs.readFileSync(new URL('../supabase/functions/close-sync/index.ts',import.meta.url),'utf8');
 assert.match(sync,/statusResult.value.filter\(isSelectedStatusEvent\)/);assert.match(sync,/report_dimensions\?\.selection_tracked === true/);assert.match(sync,/leadDimensions\(lead, reportUserNames/);
});
test('financial metadata is copied from the verified Close fields without deriving a rating',()=>{
 const d=leadDimensions({[`custom.${F.working_capital}`]:'47.579,71',[`custom.${F.liquidity_statement}`]:['liquide'],
  [`custom.${F.financials_date}`]:'31.12.2024',[`custom.${F.industry}`]:'Industrie',[`custom.${F.industry_wz}`]:'25.61 Herstellung von Schneidwaren und Bestecken aus unedlen Metallen'},new Map(),true);
 assert.equal(d.working_capital,'47.579,71');assert.equal(d.liquidity_statement,'liquide');assert.equal(d.financials_date,'31.12.2024');
 assert.equal(d.industry,'Industrie');assert.match(String(d.industry_wz),/^25.61/);
 assert.equal(d.owner_id,null);assert.equal(d.setter_id,null);assert.equal(d.closer_id,null);
});
test('missing, zero, negative and revised financial values remain distinct',()=>{
 for(const value of ['0','-1.250,50','ZU WENIG DATEN']){
  const d=leadDimensions({[`custom.${F.working_capital}`]:value},new Map(),false);
  assert.equal(d.working_capital,value);assert.equal(d.liquidity_statement,null);
 }
 const d=leadDimensions({[`custom.${F.liquidity_statement}`]:['gross aber angespannt','ZU WENIG DATEN']},new Map(),false);
 assert.equal(d.liquidity_statement,'gross aber angespannt · ZU WENIG DATEN');
 const cleared=leadDimensions({},new Map(),false);
 assert.equal(cleared.working_capital,null);assert.equal(cleared.liquidity_statement,null);assert.equal(cleared.industry_wz,null);
});
