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
 const report=buildJourneyReport(r);assert.equal(report.groups[0].source_total,2);assert.equal(report.groups[0].total,1);assert.equal(report.groups[0].leads[0].lead_id,'A');
 assert.equal(report.rates.find(r=>r.key==='setter_show').numerator.length,1);assert.equal(report.rates.find(r=>r.key==='setter_lost').numerator.length,0);
 const filtered=buildJourneyReport(r,{employee:PEOPLE[0].value,source:'LinkedIn',industry:'Factory',status:'today'});assert.equal(filtered.groups[0].total,1);assert.equal(filtered.groups[3].total,0);assert.equal(filtered.rates.find(r=>r.key==='closer_show').denominator.length,0);
 assert.deepEqual(filterOptions(r,'employee').map(p=>p.label),['Felix','Michael','Antony','LinkedIn']);assert.equal(buildJourneyReport(r,{employee:'linkedin'}).leads.length,0);
});
test('first exact customer event survives prior-month phases and repetitions; monthly graph is not cumulative',()=>{
 const report=buildJourneyReport(raw());assert.equal(report.groups[3].total,2);
 assert.deepEqual(monthlyBounds(report).map(m=>metricEntries(report,'customer',m.start,m.end).length),[0,1,1]);
 assert.deepEqual(monthlyBounds(report).map(m=>m.partial),[false,false,true]);
 assert.equal(report.facts.filter(f=>f.key==='sold_cc1_evidence').length,1);assert.equal(report.facts.filter(f=>f.key==='sold_cc2_evidence').length,1);
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
 const r=raw();r.leads[0].lead_name='<img onerror=bad>';const report=buildJourneyReport(r);const html=renderJourneyReport(report);assert.match(html,/Quoten innerhalb der Setting-Auswahl/);assert.match(html,/data-lead-evidence="cohort"/);assert.match(html,/data-lead-chart-series="cc2_show"/);
 const details=renderJourneyEvidence(report,'setting','lead_source','cohort');assert.match(details,/&lt;img/);assert.match(details,/2 von 2 Leads/);
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

test('Setting and Closing populations remain separate even when later stages belong to prior months',()=>{
 const r=raw();const report=buildJourneyReport(r);
 assert.equal(report.groups[0].source_total,2);assert.equal(report.groups[1].source_total,2);
 assert.deepEqual(report.groups[0].leads.map(l=>l.lead_id),['A']);
 assert(report.groups[1].leads.every(l=>['C','D'].includes(l.lead_id)));
 assert.equal(report.groups[3].total,2);assert.equal(report.groups[3].source_total,2);
 assert(!report.rates.some(r=>['setting_cc1','cc1_customer','cc2_customer'].includes(r.key)));
 const settingView=renderJourneyReport(report,'setting');assert.match(settingView,/Setting · belegte Showrate/);assert.doesNotMatch(settingView,/CC1 · belegte Showrate/);
 const closingView=renderJourneyReport(report,'closing');assert.match(closingView,/CC1 · belegte Showrate/);assert.doesNotMatch(closingView,/Setting · belegte Showrate/);
 assert.equal(report.rates.find(r=>r.key==='setter_show').denominator.length,2);
});


test('future-only Setting bookings and future activity never enter retrospective counts or rates',()=>{
 const r=raw();r.leads.push({lead_id:'F',lead_name:'Future booking',status_id:STATUS.setting,dimensions:{}});
 r.activity_history.push(status('F','opening',STATUS.setting,'2026-09-09T08:00:00Z'),activity('F','setter_activity','🔎 Setter Follow Up','2026-09-20T08:00:00Z'));
 r.calendar.push({lead_id:'F',meeting_id:'future',stage:'setter',outcome:'attended',starts_at:'2026-09-20T08:00:00Z'});
 // Even an over-wide response or future reference date cannot exceed the snapshot.
 r.activity_end='2026-10-01T00:00:00Z';
 const report=buildJourneyReport(r);
 assert.equal(report.calendar.length,0);assert(!report.facts.some(f=>f.lead_id==='F'));
 assert.equal(report.groups[0].source_total,2);assert.equal(report.groups[0].total,1);
 assert(report.rates.every(rate=>!rate.denominator.some(l=>l.lead_id==='F')));
 assert(!metricEntries(report,'setting_source',r.activity_start,r.activity_end).some(l=>l.lead_id==='F'));
});
test('a future rebooking preserves an earlier real conversation but does not create another one',()=>{
 const r=raw();r.activity_history.push(status('A','followup',STATUS.setting,'2026-09-09T08:00:00Z'));
 r.calendar.push({lead_id:'A',meeting_id:'future',stage:'setter',outcome:'unknown',starts_at:'2026-09-20T08:00:00Z'});
 const report=buildJourneyReport(r);assert.equal(report.groups[0].source_total,2);assert.equal(report.groups[0].total,1);
 assert.equal(report.groups[0].monthly_entries.length,1);assert.equal(report.calendar.length,0);
});
test('CRM selection, proven subset and actual period conversations stay separate, with unknowns visible',()=>{
 const r=raw();r.period.type='month';r.period.start='2026-09-01';r.activity_start='2026-08-31T22:00:00Z';for(const g of r.groups)g.selection_start='2026-09-01T00:00:00Z';
 r.activity_history=[status('A','opening',STATUS.setting,'2026-08-01T08:00:00Z'),activity('A','setter_activity','🔎 Setter Follow Up','2026-08-10T08:00:00Z'),status('A',STATUS.setting,'followup','2026-09-01T08:00:00Z'),status('B','opening',STATUS.setting,'2026-08-01T08:00:00Z'),status('B',STATUS.setting,'followup','2026-09-02T08:00:00Z'),activity('B','setter_activity',null,'2026-09-02T08:01:00Z')];
 const report=buildJourneyReport(r),g=report.groups[0];assert.equal(g.source_total,2);assert.equal(g.total,1);assert.equal(g.monthly_entries.length,0);assert.equal(g.audit.unknown.length,1);
 const html=renderJourneyReport(report);assert.match(html,/CRM-Auswahl/);assert.match(html,/davon Gespräch belegt/);assert.match(html,/Teilnahme ungeklärt/);
 assert.equal(metricEntries(report,'setting_source',r.activity_start,r.activity_end).length,2);
 assert.match(renderJourneyEvidence(report,'setting','lead_source','unknown'),/Teilnahme ungeklärt/);
});
test('show and no-show overlap is disclosed rather than silently treated as complements',()=>{
 const r=raw();r.activity_history.push(status('A','followup',noShow,'2026-07-12T08:00:00Z'));
 const report=buildJourneyReport(r);assert.equal(report.groups[0].audit.overlap.length,1);assert.match(renderJourneyReport(report),/keine Gegenanteile/);
});
