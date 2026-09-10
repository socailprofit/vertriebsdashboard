import test from 'node:test';import assert from 'node:assert/strict';
import {isTransientReadError,isAccessError,readWithRetry,withRequestTimeout,createReadRecovery} from '../read-recovery.mjs';
test('only transient reads retry; authorization and bad queries fail immediately',async()=>{
 for(const error of [{code:'57014'},{status:503},{name:'TimeoutError'},{message:'Failed to fetch'}]){
  let calls=0;assert.equal(await readWithRetry(()=>{if(++calls===1)throw error;return 42;},{delay:async()=>{}}),42);assert.equal(calls,2);
 }
 for(const error of [{status:403},{code:'42501'},{code:'22023'},{status:400}]){
  let calls=0;await assert.rejects(readWithRetry(()=>{calls++;throw error;},{delay:async()=>{}}));assert.equal(calls,1);assert.equal(isTransientReadError(error),false);
 }
 assert(isAccessError({code:'PGRST301'}));
 let calls=0;await assert.rejects(readWithRetry(()=>{calls++;throw {status:503};},{attempts:1}));assert.equal(calls,1);
});
test('a stuck request settles at its deadline even before fetch observes abort',async()=>{
 let signal;await assert.rejects(withRequestTimeout(s=>{signal=s;return new Promise(()=>{});},10),{name:'TimeoutError'});assert(signal.aborted);
});
function setup(){let visible=true,enabled=true,clock=100000;const jobs=new Map();let id=0,calls=0,action=async()=>{};
 const loop=createReadRecovery(async()=>{calls++;await action();},{enabled:()=>enabled,visible:()=>visible,now:()=>clock,setTimer(fn,ms){jobs.set(++id,{fn,ms});return id;},clearTimer:id=>jobs.delete(id)});
 return {loop,jobs,get calls(){return calls;},set action(fn){action=fn;},async flush(){const [id,job]=jobs.entries().next().value;jobs.delete(id);await job.fn();},visible(value){visible=value;loop.visibilityChanged();},disable(){enabled=false;loop.stop();},tick(ms){clock+=ms;}};
}
test('automatic retry backs off, recovers and resumes polling',async()=>{
 const t=setup();t.loop.failed({code:'57014'});assert.equal([...t.jobs.values()][0].ms,3000);
 t.action=()=>t.loop.failed({status:503});await t.flush();assert.equal([...t.jobs.values()][0].ms,10000);
 await t.flush();assert.equal([...t.jobs.values()][0].ms,30000);
 t.action=()=>t.loop.success();await t.flush();assert.equal([...t.jobs.values()][0].ms,90000);
});
test('hidden tabs defer updates, bursts coalesce and logout stops every timer',async()=>{
 const t=setup();t.visible(false);t.loop.signal();t.loop.failed({status:503});assert.equal(t.jobs.size,0);
 t.visible(true);assert.equal(t.jobs.size,1);t.loop.signal();t.loop.signal();assert.equal(t.jobs.size,1);
 t.action=()=>t.loop.success();await t.flush();assert.equal(t.calls,1);t.disable();assert.equal(t.jobs.size,0);
});
test('permission denial cancels scheduled recovery',()=>{
 const t=setup();t.loop.failed({status:503});t.loop.failed({status:403});t.loop.signal();assert.equal(t.jobs.size,0);t.loop.resume();assert.equal(t.jobs.size,1);
});
