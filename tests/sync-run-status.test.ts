import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {ABANDONED_SYNC_AFTER_MS,writeSyncStatus} from '../supabase/functions/_shared/sync-run-status.ts';

test('operational status retries a transient write once and stops for permission errors',async()=>{
 for(const code of ['57014','42501']) {
  let calls=0; const delays:number[]=[];
  const result=await writeSyncStatus(async()=>({error:++calls===1?{code}:null}),{sleep:async ms=>{delays.push(ms);}});
  assert.equal(calls,code==='57014'?2:1);assert.equal(result.error?.code,code==='42501'?'42501':undefined);
  assert.equal(delays.length,code==='57014'?1:0);
 }
});
test('status write network errors and aborts remain bounded',async()=>{
 for(const kind of ['network','timeout']) {
  let calls=0;const keepAlive=setTimeout(()=>{},200);
  try {
   await assert.rejects(()=>writeSyncStatus(async signal=>{
    calls++;
    if(kind==='network')throw new TypeError('fetch failed');
    await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    return {error:null};
   },{timeoutMs:5,sleep:async()=>{}}));
   assert.equal(calls,2);
  }finally{clearTimeout(keepAlive);}
 }
});
test('production expiry query changes only abandoned unfinished runs, never recent or successful records',async()=>{
 const now=Date.now();
 const rows=[
  {status:'running',started_at:new Date(now-601000).toISOString(),completed_at:null},
  {status:'running',started_at:new Date(now-100000).toISOString(),completed_at:null},
  {status:'success',started_at:new Date(now-601000).toISOString(),completed_at:new Date(now-500000).toISOString()},
  {status:'failed',started_at:new Date(now-601000).toISOString(),completed_at:new Date(now-500000).toISOString()},
 ];
 const original=structuredClone(rows);
 const supabase={from(table:string){assert.equal(table,'sync_runs');let patch:any;const predicates:((row:any)=>boolean)[]=[];
  const query={update(value:any){patch=value;return query;},eq(k:string,v:any){predicates.push(r=>r[k]===v);return query;},is(k:string,v:any){predicates.push(r=>r[k]===v);return query;},lt(k:string,v:any){predicates.push(r=>r[k]<v);return query;},abortSignal(){for(const r of rows)if(predicates.every(p=>p(r)))Object.assign(r,patch);return Promise.resolve({error:null});}};return query;}};
 const source=fs.readFileSync(new URL('../supabase/functions/close-sync/index.ts',import.meta.url),'utf8');
 const start=source.indexOf('const expired = await writeSyncStatus');
 const end=source.indexOf('if (expired.error)',start);
 const code=stripTypeScriptTypes(source.slice(start,end));
 await vm.runInNewContext('(async()=>{'+code+'})()',{supabase,writeSyncStatus,ABANDONED_SYNC_AFTER_MS,Date});
 assert.equal(rows[0].status,'failed');assert(rows[0].completed_at);
 assert.deepEqual(rows.slice(1),original.slice(1));
 // Success followed by a lost HTTP response cannot be downgraded by the catch path.
 const catchPath=source.slice(source.indexOf('const failed = await writeSyncStatus'));
 assert.match(catchPath,/\.eq\("status", "running"\)/);
});
