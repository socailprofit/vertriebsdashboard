import test from 'node:test';import assert from 'node:assert/strict';
import {calendarDetails,meetingShowrate,monthCohort} from '../calendar-view.mjs';
test('future and superseded slots cannot lower showrate; individual meetings have statuses only',()=>{
 const rows=[{meeting_id:'m1',lead_id:'lead_abc',starts_at:'2026-10-01T08:00Z',first_meeting_at:'2026-09-01T08:00Z',stage:'setter',outcome:'planned',showrate_due:false},{stage:'setter',outcome:'attended',showrate_due:true}];
 assert.equal(meetingShowrate(rows),'1 von 1 fälligen Terminen · 100 %');
 const html=calendarDetails(rows.slice(0,1));assert.match(html,/Übertrag aus September 2026/);assert.match(html,/10:00/);assert(!html.includes('%'));
});
test('cohort transitions use matching stages and a direct CC1 customer bypasses optional CC2',()=>{
 const html=monthCohort({period:{start:'2026-09-01'},booking_cohort:[{booked_leads:4,setter_arrived:3,closer_qualified:2,closer_arrived:2,cc2_agreed:0,new_customers:1}]});
 assert.match(html,/3 \/ 4 · 75 %/);assert.match(html,/1 \/ 2 · 50 % der Closer-Vorgänge/);assert.match(html,/CC2 · optional/);
});
