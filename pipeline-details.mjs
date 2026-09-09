import {leadLink} from './antony-view.mjs';
import {escapeHtml} from './render-security.mjs';
const labels={attended:'Durchgeführt',planned:'Noch anstehend',cancelled:'Abgesagt',cancelled_plan:'Abgesagt',rescheduled:'Verschoben',no_show:'Nicht erschienen',rejected:'Abgelehnt',disqualified:'Disqualifiziert',followup:'Follow-up offen',sold:'Verkauft',won:'Neukunde',qualified:'Closer terminiert',cc2:'CC2 vereinbart',unknown:'Ergebnis offen'};
// Supabase owns stage membership and statuses; the UI only filters its result.
export function stageRows(rows,key){
 return (rows||[]).flatMap(r=>{
  const tags=r.stages?.[key];
  return Array.isArray(tags)&&tags.length?[{...r,status:tags[0],tags:[...new Set(tags.filter(Boolean))]}]:[];
 });
}
export function stageDetails(rows,key){
 const entries=stageRows(rows,key),keys=[...new Set(entries.flatMap(r=>r.tags))];
 const fmt=v=>v?new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(v)):'—';
 return `<div class="pipeline-status-controls"><label>Status<select data-stage-filter><option value="all">Alle · ${entries.length}</option>${keys.map(k=>`<option value="${escapeHtml(k)}">${labels[k]||'Ergebnis offen'} · ${entries.filter(r=>r.tags.includes(k)).length}</option>`).join('')}</select></label></div>
 <div class="pipeline-status-counts">${keys.map(k=>`<span><b>${entries.filter(r=>r.tags.includes(k)).length}</b> ${labels[k]||'Ergebnis offen'}</span>`).join('')}</div>
 <ul class="pipeline-status-list">${entries.map(r=>`<li data-stage-status="${escapeHtml(r.tags.join(' '))}">${leadLink(r)}<small>${labels[r.status]||'Ergebnis offen'}${key==='closer1'&&r.status==='planned'&&r.next_stage!=='closer'?' · Kalendertermin nicht belegt':''}${key==='cc2'&&r.status==='planned'&&r.next_stage!=='cc2'?' · Kalendertermin nicht belegt':''}</small><small>Ersttermin ${fmt(r.first_meeting_at)} · ${escapeHtml(r.source||'Nicht zugeordnet')}</small></li>`).join('')}</ul>${entries.length?'':'<p>Keine Vorgänge in dieser Stufe.</p>'}`;
}
