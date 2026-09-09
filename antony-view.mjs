import {escapeHtml} from './render-security.mjs';
import {originTotals} from './tracking-view.mjs';
import {transition} from './pipeline-metrics.mjs';

const fmt = v => v == null ? '—' : new Intl.NumberFormat('de-DE').format(v);
const date = v => v ? new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(v)) : 'nicht belegt';
export function leadLink(row) {
  const name = row.display_name?.trim() || `Lead ${String(row.lead_id || '').slice(-10)}`;
  return /^lead_[A-Za-z0-9]+$/.test(row.lead_id) ? `<a href="https://app.close.com/lead/${encodeURIComponent(row.lead_id)}/" target="_blank" rel="noopener noreferrer">${escapeHtml(name)} ↗</a>` : escapeHtml(name);
}

export function activityCards(closing, process) {
  if (!closing) return [];
  const b=process?.period_bridge;
  const rows=[
    ['Termine',closing.appointments,'appointments','Fällige Setter-Kalendertermine am gültigen Termindatum in Europe/Berlin. Ersatztermine zählen nicht doppelt. Zukunftstermine stehen separat in der Planung.'],
    ['Setter Calls',closing.setter_calls,'setter_calls','Belegte Setter-Gespräche am Gesprächsdatum, einschließlich älterer Vorgänge. Gespräche sind nicht mit Kalenderteilnahmen gleichzusetzen.'],
    ['Closer Calls',closing.closer_calls,'closer_calls','Belegte Closer-Gespräche am Gesprächsdatum, einschließlich CC2 und älterer Vorgänge.'],
    ['CC2',b?.cc2_calls,'cc2_calls','Tatsächlich geführte Folgegespräche nach belegter CC2-Vereinbarung oder mit Ergebnis „Verkauft in CC2“. Vereinbarungen sind keine durchgeführten CC2.'],
    ['Neukunden',closing.new_customers,'new_customers','Erster belegter Neukundenabschluss je Lead am Won-Datum in Close. Die Gesamtzahl benötigt keinen lückenlosen Setter-/Closer-Verlauf.'],
  ];
  return rows.map(([label,value,key,note])=>{
    const details=[{label:'Im Zeitraum',value:fmt(value)}];
    if(key==='appointments') details.push({label:'Neue Vorgänge mit Ersttermin',value:fmt(process?.flow?.new_processes)});
    for(const [month,n] of originTotals(process?.activity_by_origin,key)||[]) details.push({label:month==='unknown'?'Ersttermin-Ursprung nicht belegt':`Ersttermin aus ${month}`,value:fmt(n)});
    if(key==='setter_calls') for(const row of process?.setter_by_day||[]) details.push({label:`${date(row.date+'T12:00Z')} · ${({michael:'Michael',felix:'Felix',antony:'Antony'})[row.owner]||'Ausführende Person unbekannt'}`,value:`${fmt(row.calls)} Calls`});
    if(key==='cc2_calls') details.push({label:'CC2 vereinbart im Zeitraum',value:fmt(closing.closer_second_calls)});
    if(key==='new_customers' && !(originTotals(process?.activity_by_origin,key)||[]).some(([month])=>month==='unknown')) details.push({label:'Ohne belegten Ersttermin-Ursprung',value:fmt(b?.customers_without_booking)});
    return {label,value,details,note};
  });
}

export function processDetails(rows) {
  if(!rows.length) return '<p>Keine neuen Vorgänge in dieser Ersttermin-Gruppe.</p>';
  return `<ul class="process-audit">${rows.map(r=>`<li><div>${leadLink(r)}<small>Quelle: ${escapeHtml(r.source||'Nicht zugeordnet')}</small><small>Erster gültiger Setter: ${date(r.first_meeting_at)}</small></div><div><span>Setter: ${date(r.setter_at)}</span>${r.setter_performed_by?`<small>Geführt von ${escapeHtml(r.setter_performed_by)}</small>`:""}<small>${escapeHtml(({setter_qualified:'Closer terminiert',setter_follow_up:'Setter Follow Up',setter_disqualified:'Disqualifiziert'})[r.setter_result]||'Ergebnis nicht belegt')}</small></div><div>Closer: ${date(r.closer_at)}<small>CC2 vereinbart: ${date(r.cc2_at)}</small></div><div>Neukunde: ${date(r.won_at)}${r.won_at&&!r.closer_at?'<small>Abschluss belegt · Closer-Beleg fehlt</small>':''}</div></li>`).join('')}</ul>`;
}

export function quota(n,d,label) {
  const r=transition(n,d);
  return `${fmt(n)} von ${fmt(d)} ${label} · ${r.rate===null?'—':`${fmt(Math.round(r.rate))} %`}`;
}

// Close field 1.02 Leadquelle; verified against its choices on 2026-09-09.
export const LEAD_SOURCE_OPTIONS = ['Cold Calling','Cold E-Mail','DMC','E-Mail','Empfehlung','Inbound LinkedIn Ads','LinkedIn','LinkedIn Cold Calls','LinkedIn Follow Up','Messe','North Data','Website','Willi Liste','Xing','Nicht zugeordnet'];
export function filterTrackingSource(report, selected='all') {
 if(!report || selected==='all') return report;
 const matching=rows=>(rows||[]).filter(r=>(r.source||'Nicht zugeordnet')===selected);
 return {...report,lead_quality_rows:matching(report.lead_quality_rows),calendar_rows:matching(report.calendar_rows),funnel_by_source:matching(report.funnel_by_source),quality_by_origin:matching(report.quality_by_origin)};
}

export function originQualityPie(rows,kind) {
 if(!Array.isArray(rows))return '<span title="Qualitätsbasis wird geladen">—</span>';
 const keys={setter:['setter_attended','setter_due'],closer:['closer_attended','closer_due'],customer:['customers','processes']};
 const [nKey,dKey]=keys[kind],sum=k=>rows.reduce((n,r)=>n+Number(r[k]||0),0),n=sum(nKey),d=sum(dKey),unknown=kind==='closer'?sum('closer_unclassified'):0;
 const pct=d>0&&!unknown?Math.round(100*n/d):null;
 const label=unknown?`${unknown} fällige Termine mit ungeklärter Gesprächsstufe; ${n} von ${d} zugeordneten Closer-Terminen durchgeführt. Gesamtrate offen.`:kind==='customer'?`${n} Neukunden von ${d} Vorgängen derselben Ersttermin-Gruppe`:`${n} von ${d} fälligen ${kind==='setter'?'Setter':'Closer-/CC2'}-Terminen durchgeführt`;
 return `<span class="showrate-mini" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><i aria-hidden="true" style="background:${pct===null?'var(--line, #314057)':`conic-gradient(var(--success, #41cfa3) ${pct}%, var(--line, #314057) 0)`}"></i><span><b>${pct===null?'—':pct+' %'}</b><small>${unknown?'Basis offen':n+' von '+d}</small></span></span>`;
}
