import test from 'node:test';
import assert from 'node:assert/strict';
import {originTotals,memberResults} from '../tracking-view.mjs';
test('actual calls reconcile across origin months and unknown origin',()=>{
 const rows=[{booked_date:'2026-09-03',setter_calls:5,closer_calls:0},{booked_date:'2026-06-03',setter_calls:1,closer_calls:1},{booked_date:null,setter_calls:2,closer_calls:2}];
 assert.equal(originTotals(rows,'setter_calls').reduce((n,[,c])=>n+c,0),8);
 assert.deepEqual(originTotals(rows,'closer_calls'),[['2026-06',1],['unknown',2]]);
});
test('all current members and LinkedIn remain visible even without leads; months use Berlin',()=>{
 const rows=[{owner:'linkedin',first_meeting_at:'2026-08-31T22:30:00Z',setter_at:'2026-09-01T09:00:00Z',closer_at:'2026-10-01T09:00Z',setter_result:'setter_follow_up'}];
 const result=memberResults(rows);
 assert.deepEqual(result.map(r=>r.owner),['michael','felix','antony','linkedin']);
 assert.equal(result[0].leads,0);assert.equal(result[3].laterSetter,0);assert.equal(result[3].laterCloser,1);
});
