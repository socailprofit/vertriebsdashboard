import { escapeHtml as esc } from './render-security.mjs?v=2026-09-09-cc2-evidence-fix';

const decimal=new Intl.NumberFormat('de-DE',{maximumFractionDigits:1});
const dateTime=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'});
const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'});
const labels={show:'Teilgenommen',no_show:'Nicht erschienen',cancelled:'Abgesagt',rescheduled:'Verschoben',unknown:'Ergebnis unklar'};
const stages={setter:'Setter',closer:'Closer · CC1 und CC2',unassigned:'Ohne Stufenzuordnung'};
const rate=(n,d)=>d?`${decimal.format(100*n/d)} %`:'—';

export function attendanceEvents(report,stage){
 const cutoff=Date.parse(report?.cutoff),seen=new Set();
 return (report?.attendance_events||[]).filter(e=>{
  const at=Date.parse(e.occurred_at),key=`${e.source_event_id}:${e.stage}`;
  if(!Number.isFinite(at)||!Number.isFinite(cutoff)||at>cutoff||day.format(new Date(at))<report.period.start||seen.has(key))return false;
  seen.add(key);return !stage||e.stage===stage;
 });
}

export function attendanceStats(report,stage){
 const events=attendanceEvents(report,stage),counts={show:0,no_show:0,cancelled:0,rescheduled:0,unknown:0};
 for(const e of events)counts[Object.hasOwn(counts,e.outcome)?e.outcome:'unknown']++;
 const denominator=counts.show+counts.no_show;
 return {...counts,denominator,total:events.length,rate:denominator?100*counts.show/denominator:null};
}

export function renderAttendanceRates(report){
 if(!report)return '<p class="antony-analysis-empty">Teilnahmedaten werden geladen …</p>';
 if(!Array.isArray(report.attendance_events))return '<p>Teilnahmenachweise noch nicht verfügbar.</p>';
 const cards=['setter','closer'].map(stage=>{
  const c=attendanceStats(report,stage),value=rate(c.show,c.denominator);
  const payload={title:`Show-Rate · ${stages[stage]}`,time:`${report.period.start.split('-').reverse().join('.')} – ${report.period.end.split('-').reverse().join('.')}`,rows:[{label:'Teilgenommen',value:String(c.show)},{label:'Nicht erschienen',value:String(c.no_show)},{label:'Basis: Teilnahme + Nicht erschienen',value:String(c.denominator)},{label:'Show-Rate',value},{label:'Abgesagt · ausgeschlossen',value:String(c.cancelled)},{label:'Verschoben · ausgeschlossen',value:String(c.rescheduled)},{label:'Unklar · ausgeschlossen',value:String(c.unknown)}],note:'Nur veröffentlichte Aktivitäten mit ausdrücklichem Ergebnis im Zeitraum. Eine Aktivität zählt einmal; mehrere Gespräche desselben Leads zählen einzeln. Keine Quote aller gebuchten Termine.'+(stage==='closer'?' Closer umfasst CC1 und CC2; keine verlässliche getrennte No-Show-Zuordnung vorhanden.':'')};
  return `<article class="attendance-rate"><button type="button" class="attendance-rate-value" data-chart-point="${esc(JSON.stringify(payload))}"><span>${stages[stage]} · Show-Rate</span><strong>${value}</strong><small>${c.show} von ${c.denominator} Teilnahme-Ergebnissen</small></button><div class="attendance-breakdown"><span>${c.show} teilgenommen</span><span>${c.no_show} nicht erschienen · ${rate(c.no_show,c.denominator)}</span></div><p class="attendance-excluded">Außerhalb der Quote: ${c.cancelled} abgesagt · ${c.rescheduled} verschoben${c.unknown?` · ${c.unknown} unklar`:''}</p><button type="button" class="process-detail-toggle" data-attendance-stage="${stage}">Ergebnisse prüfen ↗</button></article>`;
 }).join('');
 const unassigned=attendanceStats(report,'unassigned').total;
 return `<div class="attendance-rate-grid">${cards}</div>${unassigned?`<p class="attendance-excluded">${unassigned} No-Show-Aktivitäten ohne Stufenzuordnung bleiben außerhalb der Quoten.</p>`:''}<p class="attendance-basis">Show-Rate = teilgenommen ÷ (teilgenommen + nicht erschienen). Basis: dokumentierte Aktivitäten, nicht alle gebuchten Termine.</p>`;
}

export function renderAttendanceEvidence(report,stage){
 const rows=attendanceEvents(report,stage).sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at));
 return `<p class="status-evidence-heading">${esc(stages[stage]||'Teilnahme')} · ${rows.length} dokumentierte Ergebnisse</p>${rows.length?`<div class="chart-table-scroll"><table class="status-history-table"><thead><tr><th>Datum · Uhrzeit (Berlin)</th><th>Lead</th><th>Teilnahme</th><th>Close-Ergebnis</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${esc(dateTime.format(new Date(e.occurred_at)))} Uhr</td><td>${/^lead_[A-Za-z0-9]+$/.test(e.lead_id)?`<a href="https://app.close.com/lead/${encodeURIComponent(e.lead_id)}/" target="_blank" rel="noopener noreferrer">${esc(e.lead_name||e.lead_id)} ↗</a>`:esc(e.lead_name||e.lead_id)}</td><td>${esc(labels[e.outcome]||labels.unknown)}</td><td>${esc(e.result||'Kein eindeutiges Ergebnis')}</td></tr>`).join('')}</tbody></table></div>`:'<p>Keine dokumentierten Ergebnisse in diesem Zeitraum.</p>'}`;
}
