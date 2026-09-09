import test from 'node:test';
import assert from 'node:assert/strict';
import {statusPreview,statusExits,statusEvents,buildStatusTimeline,renderStatusTransitions,renderStatusEvidence,renderStatusCards} from '../status-history-view.mjs';

test('step rates use the actual leads leaving that step and disclose repeat paths',()=>{
 const r=statusPreview('2026-09-09','month');
 const setting=r.statuses.find(s=>s.metric_key==='setting'),closing=r.statuses.find(s=>s.metric_key==='closing');
 const noShow=r.events.find(e=>e.new_label==='No Show - Setting');
 r.events.push({...noShow,source_event_id:'repeat',lead_id:'lead_previewA'});
 const exits=statusExits(r,'setting');assert.equal(exits.denominator,3);assert.equal(exits.overlap,true);
 assert.equal(exits.rows.find(x=>x.id===closing.status_id).rate,100/3);
 assert.equal(exits.rows.find(x=>x.label==='No Show - Setting').rate,200/3);
 assert.match(renderStatusTransitions(r),/Mehrfachwege/);
 assert.equal(statusEvents(r,'setting','left',closing.status_id).length,1);
});

test('re-entering a status increases events but not the cumulative unique-lead curve',()=>{
 const r=statusPreview('2026-09-09','month'),event=r.events.find(e=>e.new_label==='CC2 Nachgespräch');
 r.events.push({...event,source_event_id:'repeat',occurred_at:'2026-09-09T11:30Z'});
 assert.equal(buildStatusTimeline(r).at(-1).cc2,1);
 assert.equal(statusEvents(r,'cc2').length,2);
});

test('the daily curve and all detail paths exclude future events, including later today',()=>{
 const r=statusPreview('2026-09-09','day');
 r.events.push({...r.events[0],source_event_id:'future',lead_id:'lead_future',occurred_at:'2026-09-09T16:00Z'});
 assert.equal(buildStatusTimeline(r).length,15); // through 14:00 Berlin, source cutoff is 14:00
 assert(!statusEvents(r).some(e=>e.source_event_id==='future'));
 assert.doesNotMatch(renderStatusEvidence(r),/lead_future/);
});

test('Close status labels and lead names are escaped and unsafe links cannot render',()=>{
 const r=statusPreview('2026-09-09','month');r.events[0].lead_name='<img src=x onerror=alert(1)>';r.events[0].lead_id='javascript:alert(1)';
 r.events[0].new_label='<script>alert(1)</script>';
 const html=renderStatusEvidence(r);
 assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script|<img|href="javascript/);
});

test('zero outputs have no made-up loss rate and cards are named as statuses, not calls',()=>{
 const r=statusPreview('2026-09-09','month');r.events=[];
 assert.deepEqual(statusExits(r,'setting').rows,[]);
 assert.match(renderStatusTransitions(r),/Keine belegten Ausgänge/);
 assert.doesNotMatch(renderStatusCards(r),/Setter Call|Neuer Termin|Prognose/);
});
