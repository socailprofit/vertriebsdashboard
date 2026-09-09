import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const gate=source.slice(source.indexOf('let sessionGeneration = 0;'),source.indexOf('async function initializeSession('));
test('boot and simultaneous auth events share one session initialization; failures allow retry',async()=>{
 let calls=0,resolve,reject;
 const context=vm.createContext({initializeSession:()=>{calls++;return new Promise((r,j)=>{resolve=r;reject=j;});}});
 vm.runInContext(gate+';this.start=startSession;this.logout=()=>sessionGeneration++;',context);
 const first=context.start();assert.equal(context.start(),first);assert.equal(calls,1);
 resolve();await first;
 const failed=context.start();assert.equal(calls,2);reject(new Error('offline'));await assert.rejects(failed,/offline/);
 const retry=context.start();assert.equal(calls,3);resolve();await retry;
 const old=context.start();const resolveOld=resolve;context.logout();const next=context.start();
 assert.notEqual(old,next);resolveOld();await old;assert.equal(context.start(),next);resolve();await next;
});
