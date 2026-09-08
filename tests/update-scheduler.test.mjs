import test from 'node:test';
import assert from 'node:assert/strict';
import {createUpdateScheduler} from '../update-scheduler.mjs';
function clock() {
 let seq=0;const pending=new Map();
 return {setTimer:fn=>{pending.set(++seq,fn);return seq;},clearTimer:id=>pending.delete(id),
  fire:async()=>{const callbacks=[...pending.values()];pending.clear();return Promise.all(callbacks.map(f=>f()));},size:()=>pending.size};
}
test('300 row notifications produce one refresh after the burst',async()=>{
 const c=clock();let calls=0;const s=createUpdateScheduler(async()=>{calls++;},c);
 for(let i=0;i<300;i++)s.signal();
 assert.equal(c.size(),1);assert.equal(calls,0);await c.fire();assert.equal(calls,1);assert.equal(c.size(),0);
});
test('changes during a request are retained without concurrent refreshes',async()=>{
 const c=clock();let calls=0,finish;const s=createUpdateScheduler(()=>{calls++;return calls===1?new Promise(r=>finish=r):Promise.resolve();},c);
 s.signal();const first=c.fire();assert.equal(calls,1);
 for(let i=0;i<200;i++)s.signal();assert.equal(c.size(),0);assert.equal(calls,1);
 finish();await first;assert.equal(c.size(),1);await c.fire();assert.equal(calls,2);
});
test('unsubscribe cancels pending and trailing reloads',async()=>{
 const c=clock();let calls=0,finish;const s=createUpdateScheduler(()=>{calls++;return new Promise(r=>finish=r);},c);
 s.signal();const first=c.fire();s.signal();s.dispose();finish();await first;assert.equal(c.size(),0);s.signal();assert.equal(c.size(),0);
 const queued=createUpdateScheduler(()=>calls++,c);queued.signal();queued.dispose();await c.fire();assert.equal(calls,1);
});
