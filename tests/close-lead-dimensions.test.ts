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
