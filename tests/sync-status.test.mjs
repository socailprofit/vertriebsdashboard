import test from 'node:test';
import assert from 'node:assert/strict';
import {syncImportState} from '../sync-status.mjs';
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
