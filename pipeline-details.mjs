const labels={attended:'Durchgeführt (bisher)',planned:'Noch anstehend',cancelled:'Aktuell abgesagt',cancelled_plan:'Aktuell abgesagt',rescheduled:'Verschoben',no_show:'Nicht erschienen',rejected:'Abgelehnt',disqualified:'Disqualifiziert',followup:'Follow-up offen',sold:'Verkauft',won:'Neukunden',qualified:'Closer terminiert',cc2:'CC2 vereinbart',unknown:'Ergebnis offen',missing_agreement:'CC2-Vereinbarung nicht belegt'};
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
 return [{label:'Vorgänge in dieser Stufe',value:String(entries.length)},...order.flatMap(k=>{
  const n=entries.filter(r=>r.tags.includes(k)).length;
  return n||core.includes(k)?[{label:labels[k],value:String(n)}]:[];
 })];
}
