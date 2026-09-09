const labels={attended:'Durchgeführt (bisher)',planned:'Noch anstehend',cancelled:'Aktuell abgesagt',cancelled_plan:'Aktuell abgesagt',rescheduled:'Verschoben',no_show:'Nicht erschienen',rejected:'Abgelehnt',disqualified:'Disqualifiziert',followup:'Davon Follow-up offen',sold:'Verkauft',won:'Neukunden',qualified:'Closer terminiert',cc2:'CC2 vereinbart',unknown:'Ergebnis offen',missing_agreement:'CC2-Vereinbarung nicht belegt'};
// Supabase owns membership, current status and historical performance evidence.
export function stageRows(rows,key){
 return (rows||[]).flatMap(r=>{
  const tags=r.stages?.[key];
  return Array.isArray(tags)&&tags.length?[{status:tags[0],tags:[...new Set(tags.filter(Boolean))]}]:[];
 });
}
export function stageSummary(rows,key) {
 if(!Array.isArray(rows))return [{label:'Statusdaten',value:'Noch nicht verfügbar'}];
 const entries=stageRows(rows,key),order=['attended','planned','cancelled','rescheduled','no_show','rejected','disqualified','followup','qualified','cc2','sold','won','unknown','missing_agreement'];
 const core=key==='won'?['won']:['attended','planned','cancelled'];
 return [{label:['first','setter'].includes(key)?'Ersttermine im gewählten Monat':'Vorgänge in dieser Stufe',value:String(entries.length)},...order.flatMap(k=>{
  const n=entries.filter(r=>r.tags.includes(k)).length;
  return n||core.includes(k)?[{label:labels[k],value:String(n)}]:[];
 })];
}

export function bookingScopeReport(report,scope) {
 const rows=(report.month_pipeline_rows||[]).filter(r=>r.booking_scope===scope);
 const count=fn=>rows.filter(fn).length,has=(r,k,t)=>r.stages?.[k]?.includes(t);
 return {...report,month_pipeline_rows:rows,funnel_by_source:[{
  booked_leads:count(r=>!r.future_first),setter_arrived:count(r=>has(r,'setter','attended')),
  closer_qualified:count(r=>!!r.qualified_at),closer_arrived:count(r=>has(r,'closer1','attended')),
  observed_closer:count(r=>has(r,'closer1','attended')),cc2_agreed:count(r=>!!r.cc2_at),
  observed_customers:count(r=>has(r,'won','won'))
 }]};
}
