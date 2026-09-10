import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {isTransientReadError,isAccessError} from '../read-recovery.mjs';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const flow=app.slice(app.indexOf('async function refresh('),app.indexOf('// Scheitert der Start'));
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};};
function setup(complete=true){
 const state={status:'live'},nodes=new Map(),requests=[],queued=[];let renders=0;
 const element=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,dataset:{},attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},close(){}});return nodes.get(id);};
 const c=vm.createContext({state,isTransientReadError,isAccessError,readContext:()=>"current",renderNav(){},renderHeader(){},updateUrl(){},recovery:{success(){},failed(){},signal(){queued.push(()=>c.refresh({background:true}));}},console:{warn(){}},URLSearchParams,location:{search:''},Event,document:{querySelector:element,dispatchEvent(){}},renderSyncBadge(){},render(){renders++;},queueMicrotask:fn=>queued.push(fn),showError(){state.status='error';},loadAll:()=>{const d=deferred();requests.push(d);return d.promise;}});
 vm.runInContext('let refreshRevision=0;let backgroundRefreshPending=false;let refreshInFlight=false;let lastCompleteContext='+JSON.stringify(complete?'current':null)+';'+flow+';this.refresh=refresh;',c);
 return{state,nodes,requests,queued,refresh:c.refresh,element,renders:()=>renders};
}
test('background refresh leaves the last complete view interactive and does not enter foreground loading',async()=>{
 const t=setup(),p=t.refresh({background:true});assert.equal(t.state.status,'live');assert.equal(t.element('.app-shell').attributes['aria-busy'],undefined);
 t.requests[0].resolve(true);await p;assert.equal(t.renders(),1);
});
test('a realtime event cannot invalidate an in-flight foreground selection; exactly one refresh follows',async()=>{
 const t=setup(false),p=t.refresh();assert.equal(t.state.status,'loading');
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
 const t=setup(false),p=t.refresh();t.requests[0].reject(new Error('timeout'));await p;
 assert.equal(t.state.status,'error');assert.equal(t.element('#retry-load').hidden,false);assert.equal(t.element('.app-shell').attributes['aria-busy'],undefined);
});
test('only completed imports and target edits are subscribed; KPI row bursts never reach the browser',()=>{
 const source=fs.readFileSync(new URL('../data.js',import.meta.url),'utf8');const handlers=new Map(),filters=new Map();let signals=0;
 const chain={channel(){return this;},on(_,filter,cb){handlers.set(filter.table,cb);filters.set(filter.table,filter);return this;},subscribe(){return this;}};
 const c=vm.createContext({createUpdateScheduler:()=>({signal:()=>signals++,dispose(){}}),requireClient:()=>chain});
 vm.runInContext(source.slice(source.indexOf('export function subscribeToUpdates')).replace('export function','function')+';subscribeToUpdates(()=>{});',c);
 for(let i=0;i<25;i++)handlers.get('sync_runs')({new:{status:'running'}});
 handlers.get('sync_runs')({new:{status:'failed'}});assert.equal(signals,0);
 assert.equal(handlers.has('daily_sales_metrics'),false);
 assert.equal(filters.get('sync_runs').event,'UPDATE');assert.equal(filters.get('sync_runs').filter,'status=eq.success');
 handlers.get('sync_runs')({new:{status:'success'}});handlers.get('sales_targets')({});assert.equal(signals,2);
});

test('permission failure clears even the last good private snapshot',async()=>{
 const t=setup(),p=t.refresh({background:true});t.requests[0].reject({status:403});await p;
 assert.equal(t.state.status,'error');assert.equal(t.state.antonyLeadReport,null);assert.equal(t.element('.app-shell').dataset.stale,'true');
});
