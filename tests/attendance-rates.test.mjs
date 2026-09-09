import test from 'node:test';
import assert from 'node:assert/strict';
import {attendanceStats,attendanceEvents,renderAttendanceRates,renderAttendanceEvidence} from '../attendance-rates.mjs';
import {statusPreview,handoffRate,HANDOFF_RATES,renderStatusCards} from '../status-history-view.mjs';
const make=()=>({...statusPreview('2026-09-09','month'),attendance_events:[]});
const event=(id,outcome,stage='setter',at='2026-09-09T10:00Z')=>({source_event_id:id,lead_id:'lead_A',stage,outcome,occurred_at:at,result:outcome,lead_name:'Testfirma'});

test('show rate uses explicit show + no show, excludes cancellations, rescheduling and unknown outcomes',()=>{
 const r=make();r.attendance_events=[event('s1','show'),event('s2','show'),event('n','no_show'),event('c','cancelled'),event('r','rescheduled'),event('u','unknown')];
 const c=attendanceStats(r,'setter');assert.equal(c.denominator,3);assert.equal(c.rate,200/3);assert.equal(c.total,6);
 assert.match(renderAttendanceRates(r),/66,7 %/);assert.match(renderAttendanceRates(r),/1 abgesagt · 1 verschoben · 1 unklar/);
});
test('same activity is deduplicated, genuine repeat calls of a lead count separately, stages stay separate',()=>{
 const r=make(),e=event('s','show');r.attendance_events=[e,{...e},event('repeat','show'),event('c','no_show','closer')];
 assert.equal(attendanceStats(r,'setter').show,2);assert.equal(attendanceStats(r,'closer').rate,0);
});
test('same cutoff and Berlin date boundary for attendance; no future or prior-period results',()=>{
 const r=make();r.attendance_events=[event('prior','show','setter','2026-08-31T21:59Z'),event('start','no_show','setter','2026-08-31T22:00Z'),event('future','show','setter','2026-09-09T12:01Z')];
 assert.deepEqual(attendanceEvents(r).map(e=>e.source_event_id),['start']);assert.equal(attendanceStats(r,'setter').rate,0);
 r.period.start='2026-10-01';assert.equal(attendanceStats(r,'setter').rate,null);
});
test('zero denominator is unavailable, not perfect or failed; no-show statuses never become attendance',()=>{
 const r=make();r.attendance_events=[event('c','cancelled')];assert.equal(attendanceStats(r,'setter').rate,null);
 assert.match(renderAttendanceRates(r),/<strong>—<\/strong>/);assert.equal(attendanceStats(make(),'setter').show,0);
});
test('attendance evidence escapes CRM content and rejects unsafe lead links',()=>{
 const r=make();r.attendance_events=[{...event('s','show'),lead_id:'javascript:alert(1)',lead_name:'<img src=x>',result:'<script>bad</script>'}];
 const h=renderAttendanceEvidence(r,'setter');assert.match(h,/&lt;img/);assert.doesNotMatch(h,/<img|<script|href="javascript/);
});
test('grouped handoff counts each lead once across skip paths and never divides period entry totals',()=>{
 const r=make(),from=r.statuses.find(s=>s.metric_key==='setting'),offer=r.statuses.find(s=>s.metric_key==='offer');
 r.events.push({...r.events[0],source_event_id:'skip',new_status:offer.status_id,new_label:offer.label});
 from.entered_leads=999;
 const rate=handoffRate(r,HANDOFF_RATES[0]);assert.equal(rate.numerator,1);assert.equal(rate.denominator,3);assert.equal(rate.rate,100/3);
 assert.match(renderStatusCards(r),/Leads hineingewechselt/);assert.match(renderStatusCards(r),/hinausgewechselt/);
});
