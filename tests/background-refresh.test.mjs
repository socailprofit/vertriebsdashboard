import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const flow=app.slice(app.indexOf('async function refresh('),app.indexOf('// Scheitert der Start'));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};};
function setup(){
 const state={status:'live'},nodes=new Map(),requests=[],queued=[];let renders=0;
 const element=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,dataset:{},attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},close(){}});return nodes.get(id);};
 const c=vm.createContext({state,URLSearchParams,location:{search:''},Event,document:{querySelector:element,dispatchEvent(){}},renderSyncBadge(){},render(){renders++;},queueMicrotask:fn=>queued.push(fn),showError(){state.status='error';},loadAll:()=>{const d=deferred();requests.push(d);return d.promise;}});
 vm.runInContext('let refreshRevision=0;let backgroundRefreshPending=false;'+flow+';this.refresh=refresh;',c);
 return{state,nodes,requests,queued,refresh:c.refresh,element,renders:()=>renders};
}
test('background refresh leaves the last complete view interactive and does not enter foreground loading',async()=>{
 const t=setup(),p=t.refresh({background:true});assert.equal(t.state.status,'live');assert.equal(t.element('.app-shell').attributes['aria-busy'],undefined);
 t.requests[0].resolve(true);await p;assert.equal(t.renders(),1);
});
test('a realtime event cannot invalidate an in-flight foreground selection; exactly one refresh follows',async()=>{
 const t=setup(),p=t.refresh();assert.equal(t.state.status,'loading');
 await t.refresh({background:true});await t.refresh({background:true});assert.equal(t.requests.length,1);
 t.requests[0].resolve(true);await p;assert.equal(t.queued.length,1);
 const q=t.queued.shift()();assert.equal(t.requests.length,2);t.requests[1].resolve(true);await q;
 assert.equal(t.state.status,'live');assert.equal(t.renders(),2);
});
test('failed background update keeps the complete snapshot visible and marks the failure',async()=>{
 const t=setup(),p=t.refresh({background:true});t.requests[0].reject(new Error('timeout'));await p;
 assert.equal(t.state.status,'live');assert.equal(t.state.backgroundError,true);assert.equal(t.element('.app-shell').dataset.stale,undefined);assert.equal(t.renders(),0);
});
test('foreground failure releases the busy state and exposes retry',async()=>{
 const t=setup(),p=t.refresh();t.requests[0].reject(new Error('timeout'));await p;
 assert.equal(t.state.status,'error');assert.equal(t.element('#retry-load').hidden,false);assert.equal(t.element('.app-shell').attributes['aria-busy'],undefined);
});
test('import checkpoints do not cause reloads; completed snapshots and normal table edits do',()=>{
 const source=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');const handlers=new Map();let signals=0;
 const chain={channel(){return this;},on(_,filter,cb){handlers.set(filter.table,cb);return this;},subscribe(){return this;}};
 const c=vm.createContext({createUpdateScheduler:()=>({signal:()=>signals++,dispose(){}}),requireClient:()=>chain});
 vm.runInContext(source.slice(source.indexOf('export function subscribeToUpdates')).replace('export function','function')+';subscribeToUpdates(()=>{});',c);
 for(let i=0;i<25;i++)handlers.get('sync_runs')({new:{status:'running'}});
 handlers.get('sync_runs')({new:{status:'failed'}});assert.equal(signals,0);
 handlers.get('sync_runs')({new:{status:'success'}});handlers.get('sales_targets')({});handlers.get('daily_sales_metrics')({});assert.equal(signals,3);
});
