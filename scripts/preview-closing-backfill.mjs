// Read-only local comparison; never connects to or writes a database.
import fs from 'node:fs';
import { prepareCustomReconciliation, closingReconciliationTotals } from '../supabase/functions/_shared/close-reconciliation.ts';
import { CLOSE_USERS } from '../supabase/functions/_shared/close-mapping.ts';
const [snapshotPath,beforePath,endDate='2026-09-07']=process.argv.slice(2);
if(!snapshotPath||!beforePath)throw new Error('Usage: node scripts/preview-closing-backfill.mjs CRM_JSON BEFORE_JSON [endDate]');
const snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8'));
const before=JSON.parse(fs.readFileSync(beforePath,'utf8'));
const facts=prepareCustomReconciliation(snapshot,'2026-07-01',endDate).facts;
const ranges=[['Tag','2026-09-04','2026-09-04'],['Woche','2026-08-31','2026-09-04'],['Juli','2026-07-01','2026-07-31'],['August','2026-08-01','2026-08-31'],['September','2026-09-01',endDate]];
const result=ranges.map(([label,start,end])=>{
 const rows=before.filter(r=>r.metric_date>=start&&r.metric_date<=end);
 const sum=(key,user)=>rows.filter(r=>user?r.close_user_id===user:r.close_user_id!==CLOSE_USERS.antony).reduce((s,r)=>s+Number(r[key]||0),0);
 const {appointments: _outsideSnapshotScope, ...after} = closingReconciliationTotals(facts,start,end);
 return {label,start,end,before:{setterCalls:sum('setter_calls'),setterSuccesses:sum('setter_successes'),closerCalls:sum('closer_calls',CLOSE_USERS.antony),cc2Agreed:sum('closer_second_calls',CLOSE_USERS.antony)},after};
});
console.log(JSON.stringify({scope:'Validated Setter/Closer/No-Show records only; not a full Opening or Call backfill payload.',wroteData:false,sourceRecords:snapshot.length,publishedFacts:facts.length,comparisons:result},null,2));
