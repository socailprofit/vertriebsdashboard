import test from 'node:test';
import assert from 'node:assert/strict';
import {syncImportState,nextSyncAt,nextSyncLabel} from '../sync-status.mjs';
const now=Date.parse('2026-09-14T13:00:00Z');
test('successful browser reads cannot conceal failed CRM imports',()=>{
 assert.equal(syncImportState({status:'failed'},'2026-09-14T12:58:00Z',now).delayed,true);
 assert.equal(syncImportState({status:'success'},'2026-09-14T12:58:00Z',now).delayed,false);
});
test('stale or unknown data and stuck imports are labelled honestly',()=>{
 assert.equal(syncImportState(null,'2026-09-14T12:22:00Z',now).delayed,true);
 assert.equal(syncImportState(null,null,now).delayed,true);
 assert.equal(syncImportState({status:'running',started_at:'2026-09-14T12:59:00Z'},'2026-09-14T12:45:00Z',now).note,'Neue Daten werden eingelesen');
 assert.equal(syncImportState({status:'running',started_at:'2026-09-14T12:37:00Z'},'2026-09-14T12:22:00Z',now).delayed,true);
});

test('five-minute schedule flags two missed imports rather than waiting thirty minutes',()=>{
 assert.equal(syncImportState({status:'success'},'2026-09-14T12:48:00Z',now).delayed,true);
 assert.equal(syncImportState({status:'success'},'2026-09-14T12:52:00Z',now).delayed,false);
});

test('visible countdown matches Berlin business cron including weekends and DST',()=>{
 for(const [now,next] of [
  ['2026-09-18T12:00:02Z','2026-09-18T12:05:00Z'],
  ['2026-09-18T05:29:59Z','2026-09-18T05:30:00Z'],
  ['2026-09-18T14:59:59Z','2026-09-18T15:00:00Z'],
  ['2026-09-18T15:00:01Z','2026-09-21T05:30:00Z'],
  ['2026-10-23T15:00:01Z','2026-10-26T06:30:00Z'],
  ['2026-03-27T16:00:01Z','2026-03-30T05:30:00Z'],
 ])assert.equal(nextSyncAt(Date.parse(now)),Date.parse(next));
 assert.match(nextSyncLabel(Date.parse('2026-09-18T15:01:00Z')),/Mo.*07:30/);
});
test('planned night pause is distinct from a failed or missing last import',()=>{
 const night=Date.parse('2026-09-18T20:00:00Z');
 assert.equal(syncImportState({status:'success'},'2026-09-18T15:01:00Z',night).note,'Abrufpause');
 assert.equal(syncImportState({status:'failed'},'2026-09-18T15:01:00Z',night).delayed,true);
 assert.equal(syncImportState({status:'success'},'2026-09-18T13:01:00Z',night).delayed,true);
});
