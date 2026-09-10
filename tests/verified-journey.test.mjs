import test from 'node:test';
import assert from 'node:assert/strict';
import {STATUS,PEOPLE,buildJourneyReport,metricEntries,monthlyBounds,statusAt} from '../verified-journey.mjs';
import {renderJourneyReport,renderJourneyEvidence} from '../verified-journey-view.mjs';
import {filterOptions} from '../lead-selection-filters.mjs';
const noShow='stat_9z5zqirMleW4DbhYjsmZnV96jexVlXiYXU3yqIR8KzZ';
let n=0;
const status=(lead,old,next,at)=>({lead_id:lead,source_event_id:'s'+(++n),source_kind:'lead_status_change',previous_status:old,status_id:next,occurred_at:at,recorded_at:at});
const activity=(lead,type,result,at)=>({lead_id:lead,source_event_id:'a'+(++n),source_kind:'custom_activity',event_type:type,publication_status:'published',closer_result:result,setter_result:result,occurred_at:at,recorded_at:at});
function raw(){return {period:{type:'trend',start:'2026-07-01',end:'2026-09-10'},activity_start:'2026-06-30T22:00:00Z',activity_end:'2026-09-10T08:00:00Z',data_as_of:'2026-09-10T08:00:00Z',calendar:[],leads:['A','B','C','D'].map((id,i)=>({lead_id:id,lead_name:id,status_id:'today',dimensions:{owner_id:i<2?PEOPLE[0].value:'former',owner:i<2?'Felix':'Former',lead_source:i<2?'LinkedIn':'Other',industry:'Factory'}})),groups:['setting','closing','customer'].map(key=>({key,leads:[],selection_start:'2026-07-01T00:00:00Z',selection_end:'2026-09-10T08:00:00Z',time_zone:'UTC'})),activity_history:[
 status('A','opening',STATUS.setting,'2026-06-01T10:00:00Z'),status('A',STATUS.setting,'followup','2026-07-10T10:00:00Z'),activity('A','setter_activity','🔎 Setter Follow Up','2026-07-10T10:01:00Z'),
 status('B','opening',STATUS.setting,'2026-06-01T10:00:00Z'),status('B',STATUS.setting,noShow,'2026-07-10T10:00:00Z'),
 status('C','opening',STATUS.closing,'2026-06-01T10:00:00Z'),activity('C','closer_activity','2. 🔥 CC2 vereinbart','2026-07-01T10:00:00Z'),status('C',STATUS.closing,STATUS.cc2,'2026-07-01T10:01:00Z'),activity('C','closer_activity','3. ✅ Verkauft - in CC2 🔥','2026-09-04T10:00:00Z'),status('C',STATUS.cc2,STATUS.customer,'2026-09-04T10:01:00Z'),
 status('D','opening',STATUS.closing,'2026-08-01T10:00:00Z'),activity('D','closer_activity','1. ✅ Verkauft - in CC1','2026-08-10T10:00:00Z'),status('D',STATUS.closing,STATUS.customer,'2026-08-10T10:01:00Z'),status('D','followup',STATUS.customer,'2026-09-01T10:00:00Z')
 ]};}
test('retrospective group excludes new bookings, no-show absence is not proof, attribution uses identical group',()=>{
 const r=raw();r.activity_history.push(status('D','opening',STATUS.setting,'2026-09-09T10:00:00Z'));
 const report=buildJourneyReport(r);assert.equal(report.groups[0].source_total,4);assert.equal(report.groups[0].total,1);assert.equal(report.groups[0].leads[0].lead_id,'A');
 assert.equal(report.rates.find(r=>r.key==='setter_show').numerator.length,1);assert.equal(report.rates.find(r=>r.key==='setter_lost').numerator.length,0);
 const filtered=buildJourneyReport(r,{employee:PEOPLE[0].value,source:'LinkedIn',industry:'Factory',status:'today'});assert.equal(filtered.groups[0].total,1);assert.equal(filtered.groups[3].total,0);assert.equal(filtered.rates.find(r=>r.key==='closer_show').denominator.length,0);
 assert.deepEqual(filterOptions(r,'employee').map(p=>p.label),['Felix','Michael','Anthony','LinkedIn']);assert.equal(buildJourneyReport(r,{employee:'linkedin'}).leads.length,0);
});
test('first exact customer event survives prior-month phases and repetitions; monthly graph is not cumulative',()=>{
 const report=buildJourneyReport(raw());assert.equal(report.groups[3].total,2);
 assert.deepEqual(monthlyBounds(report).map(m=>metricEntries(report,'customer',m.start,m.end).length),[0,1,1]);
 assert.deepEqual(monthlyBounds(report).map(m=>m.partial),[false,false,true]);
 assert.equal(report.rates.find(r=>r.key==='cc1_direct').numerator.length,1);assert.equal(report.rates.find(r=>r.key==='cc2_customer').numerator.length,1);
});
test('historical status is reconstructed, repeated exits deduplicate but preserve evidence',()=>{
 const r=raw();r.activity_history.push(status('A','followup',STATUS.setting,'2026-07-11T10:00:00Z'),status('A',STATUS.setting,'followup','2026-07-12T10:00:00Z'),status('A','followup',noShow,'2026-08-10T10:00:00Z'));
 const report=buildJourneyReport(r);const july=monthlyBounds(report)[0];const entries=metricEntries(report,'setting',july.start,july.end);
 assert.equal(entries.length,1);assert.equal(entries[0].evidence.filter(e=>e.kind==='lead_status_change').length,2);assert.equal(statusAt(report,'A',july.end),'followup');assert.equal(report.groups[0].total,1);
});
test('missing entry yields no fabricated rate, forecasts excluded, follow-up is not loss',()=>{
 const r=raw();r.activity_history=r.activity_history.filter(e=>!(e.lead_id==='A'&&e.status_id===STATUS.setting));r.activity_history.push(activity('A','closer_activity','4. ❌ Nicht verkauft','2026-09-09T10:00:00Z'),status('A','followup',STATUS.customer,'2026-10-01T10:00:00Z'));
 const report=buildJourneyReport(r);assert.equal(report.rates.find(r=>r.key==='setter_show').value,null);assert.equal(report.groups[3].total,2);assert.equal(report.facts.filter(f=>f.key==='lost').length,0);
});
test('render includes all stages, cohort evidence, only verified assignment and escape-safe names',()=>{
 const r=raw();r.leads[0].lead_name='<img onerror=bad>';const report=buildJourneyReport(r);const html=renderJourneyReport(report);assert.match(html,/CC1 → Neukunde/);assert.match(html,/data-lead-evidence="cohort"/);assert.match(html,/data-lead-chart-series="cc2_show"/);
 const details=renderJourneyEvidence(report,'setting','lead_source','cohort');assert.match(details,/&lt;img/);assert.match(details,/4 von 4 Leads/);
});
test('explicit No Show status is evidence and historical UTC month end includes its last two hours',()=>{
 const r=raw();r.activity_history.push(status('A','followup',STATUS.setting,'2026-07-31T21:00:00Z'),status('A',STATUS.setting,'followup','2026-07-31T23:00:00Z'));
 const report=buildJourneyReport(r);assert.equal(report.rates.find(r=>r.key==='setter_no_show').numerator.length,1);
 const july=monthlyBounds(report)[0];assert.equal(metricEntries(report,'setting',july.start,july.end)[0].evidence.filter(e=>e.kind==='lead_status_change').length,2);
});

test('cohort conversation from previous month counts in its retrospective outcome, not monthly activity',()=>{
 const r=raw();r.period.start='2026-09-01';r.period.type='month';r.activity_start='2026-08-31T22:00:00Z';for(const g of r.groups)g.selection_start='2026-09-01T00:00:00Z';
 r.activity_history=[status('A','opening',STATUS.setting,'2026-08-25T10:00:00Z'),activity('A','setter_activity','🔎 Setter Follow Up','2026-08-31T10:00:00Z'),status('A',STATUS.setting,'followup','2026-09-01T10:00:00Z')];
 const report=buildJourneyReport(r);assert.equal(report.groups[0].total,1);assert.equal(metricEntries(report,'setter_show',r.activity_start,r.activity_end).length,0);assert.equal(report.rates.find(r=>r.key==='setter_show').numerator.length,1);
});
test('one cohort carries older Setting and Closing phases into all cards, rates, chart and attribution',()=>{
 const r=raw();r.period={type:'month',start:'2026-09-01',end:'2026-09-10'};r.activity_start='2026-08-31T22:00:00Z';for(const g of r.groups)g.selection_start='2026-09-01T00:00:00Z';
 r.activity_history=[
  status('A','opening',STATUS.setting,'2026-08-20T10:00:00Z'),activity('A','setter_activity','🔎 Setter Follow Up','2026-09-02T10:00:00Z'),status('A',STATUS.setting,'followup','2026-09-02T10:01:00Z'),
  status('B','opening',STATUS.setting,'2026-07-01T10:00:00Z'),activity('B','setter_activity','✅ Closer terminiert','2026-07-02T10:00:00Z'),status('B',STATUS.setting,STATUS.closing,'2026-07-02T10:01:00Z'),activity('B','closer_activity','2. 🔥 CC2 vereinbart','2026-09-03T10:00:00Z'),status('B',STATUS.closing,STATUS.cc2,'2026-09-03T10:01:00Z'),
  status('C','opening',STATUS.setting,'2025-11-01T10:00:00Z'),activity('C','setter_activity','✅ Closer terminiert','2025-11-02T10:00:00Z'),status('C',STATUS.setting,STATUS.closing,'2025-11-02T10:01:00Z'),activity('C','closer_activity','2. 🔥 CC2 vereinbart','2025-12-03T10:00:00Z'),status('C',STATUS.closing,STATUS.cc2,'2025-12-03T10:01:00Z'),status('C',STATUS.cc2,STATUS.customer,'2026-09-04T10:00:00Z'),
  status('D','opening',STATUS.setting,'2026-09-05T10:00:00Z') // booking alone never joins
 ];
 const report=buildJourneyReport(r);assert.deepEqual(report.groups.map(g=>g.total),[3,2,0,1]);assert(report.groups.every(g=>g.source_total===3));
 const rate=report.rates.find(r=>r.key==='setting_cc1');assert.equal(rate.numerator.length,2);assert.equal(rate.denominator.length,report.groups[0].total);assert.equal(rate.value,2/3);
 assert.equal(report.rates.find(r=>r.key==='cc1_customer').value,1/2);assert.equal(report.rates.find(r=>r.key==='cc2_customer').value,null);
 assert.deepEqual(metricEntries(report,'closing',r.activity_start,r.activity_end).map(x=>x.lead_id).sort(),report.groups[1].leads.map(x=>x.lead_id).sort());
 const filtered=buildJourneyReport(r,{employee:PEOPLE[0].value,source:'LinkedIn'});assert.deepEqual(filtered.groups.map(g=>g.total),[2,1,0,0]);assert.equal(filtered.rates.find(r=>r.key==='setting_cc1').value,1/2);
 assert.match(renderJourneyReport(report),/3 aus 3 gemeinsam ausgewerteten Leads/);
});
