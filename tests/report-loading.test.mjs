import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const loader=source.slice(source.indexOf('let refreshRevision = 0;'),source.indexOf('// --- Ziele'));
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject};}
function setup(antonyAccess=false,view='team'){
 const pending=[],queries=[];
 const state={view,period:'day',referenceDate:'2026-09-08',profile:{role:'sales'},metrics:{old:true}};
 const data={loadMetrics:(p,d)=>{queries.push([p,d]);const q=deferred();pending.push(q);return q.promise;},loadPeople:async()=>[],loadHourPerformance:async()=>[],loadTrends:async()=>[],loadTransferBreakdown:async()=>[],loadDailySeries:async()=>[],loadTargets:async(a,b)=>{queries.push(['goals',a,b]);return[];}};
 const context=vm.createContext({state,data,canViewAntony:()=>antonyAccess,canViewWeeklyReview:()=>antonyAccess,calendarMonthRange:()=>({start:'2026-09-01',end:'2026-09-30'}),goalPeriodRange:p=>({start:'2026-09-01',end:p==='month'?'2026-09-30':'2026-09-08'}),toPerson:r=>r});
 vm.runInContext(loader+';this.load=loadAll;this.advance=()=>++refreshRevision;',context);
 return{context,state,pending,queries};
}
test('a slow old period never overwrites the newer selection',async()=>{
 const t=setup();t.context.advance();const old=t.context.load(1);t.state.period='month';t.context.advance();const current=t.context.load(2);
 t.pending[1].resolve([{slug:'michael',period_start:'2026-09-01',period_end:'2026-09-08',appointments:8}]);assert.equal(await current,true);
 t.pending[0].resolve([{slug:'michael',period_start:'2026-09-08',period_end:'2026-09-08',appointments:0}]);assert.equal(await old,false);assert.equal(t.state.metrics.michael.appointments,8);
 assert(t.queries.some(x=>x[0]==='goals'&&x[2]==='2026-09-30'));
});
test('a failed required request leaves no partial new snapshot',async()=>{
 const t=setup();t.context.advance();const p=t.context.load(1);t.pending[0].reject(new Error('network unavailable'));await assert.rejects(p,/network/);assert.equal(t.state.metrics.old,true);
});
test('logout invalidates requests that are still in flight',async()=>{
 const t=setup();t.context.advance();const p=t.context.load(1);t.context.advance();t.pending[0].resolve([]);assert.equal(await p,false);assert.equal(t.state.metrics.old,true);
});
test('a leadership account opens Team without depending on Antony or AI report requests',async()=>{
 const t=setup(true); const p=t.context.load(); t.pending[0].resolve([]);
 assert.equal(await p,true); assert.equal(t.state.antonyProcess,null);
});
test('a view change prevents an older snapshot from replacing the newly selected view',async()=>{
 const t=setup(); const p=t.context.load(); t.state.view='antony';t.pending[0].resolve([]);
 assert.equal(await p,false);assert.equal(t.state.metrics.old,true);
});
