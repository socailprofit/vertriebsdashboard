import test from 'node:test';import assert from 'node:assert/strict';
import {calendarDetails,meetingShowrate} from '../calendar-view.mjs';
test('future and superseded slots cannot lower showrate; individual meetings have statuses only',()=>{
 const rows=[{meeting_id:'m1',lead_id:'lead_abc',starts_at:'2026-10-01T08:00Z',first_meeting_at:'2026-09-01T08:00Z',stage:'setter',outcome:'planned',showrate_due:false},{stage:'setter',outcome:'attended',showrate_due:true}];
 assert.equal(meetingShowrate(rows),'1 von 1 fälligen Terminen · 100 %');
 const html=calendarDetails(rows.slice(0,1));assert.match(html,/Übertrag aus September 2026/);assert.match(html,/10:00/);assert(!html.includes('%'));
});
test('names are escaped, links stay in Close, and unknown is never a no-show',()=>{
 const html=calendarDetails([{lead_id:'lead_abc',display_name:'Firma <script>',meeting_id:'m',starts_at:'2026-09-01T08:00Z',stage:'closer',outcome:'unknown'}]);
 assert.match(html,/Firma &lt;script&gt;/);assert.match(html,/kein No-Show-Beleg/);assert.doesNotMatch(html,/<script>|%/);
});

import {meetingShowratePie} from '../calendar-view.mjs';

test('mini pie uses only due setter appointments and leaves future-only rates unavailable',()=>{
 const html=meetingShowratePie([{stage:'setter',showrate_due:true,outcome:'attended'},{stage:'setter',showrate_due:true,outcome:'unknown'},{stage:'setter',showrate_due:false,outcome:'planned'},{stage:'closer',showrate_due:true,outcome:'attended'}]);
 assert.match(html,/50 %/);assert.match(html,/1 von 2/);assert.match(html,/role="img"/);
 assert.doesNotMatch(meetingShowratePie([{stage:'setter',showrate_due:false,outcome:'planned'}]),/conic-gradient/);
});
