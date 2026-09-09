import {leadLink} from './antony-view.mjs';
import {escapeHtml} from './render-security.mjs';
const month=v=>v?new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit'}).format(new Date(v)):null;
const monthName=v=>new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',month:'long',year:'numeric'}).format(new Date(v));
export function meetingShowrate(rows){const due=rows.filter(r=>r.stage==='setter'&&r.showrate_due);const shown=due.filter(r=>r.outcome==='attended').length;return due.length?`${shown} von ${due.length} fälligen Terminen · ${Math.round(100*shown/due.length)} %`:'—';}
export function calendarDetails(rows){
 const labels={attended:'Durchgeführt',no_show:'Nicht erschienen',cancelled:'Abgesagt',cancelled_plan:'Abgesagt · nicht bewertet',rescheduled:'Verschoben',planned:'Geplant',future:'Geplant',unknown:'Ergebnis offen · kein No-Show-Beleg'};
 return `<ul class="meeting-audit">${rows.map(r=>{
 const date=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(r.starts_at));
 const carry=r.first_meeting_at&&month(r.first_meeting_at)<month(r.starts_at)?`Übertrag aus ${monthName(r.first_meeting_at)}`:'';
 const lead=leadLink(r);
 return `<li><span>${lead}<small>${escapeHtml(r.performed_by||r.scheduled_with||"Ausführende Person nicht belegt")}</small></span><span>${({setter:'Setter',closer:'Closer',cc2:'CC2'})[r.stage]||'Terminart ungeklärt'}</span><time>${escapeHtml(date)} Uhr${r.rescheduled?' · aktueller Ersatztermin':''}</time><span>${labels[r.outcome]||'Ergebnis nicht belegt'}${carry?`<small>${escapeHtml(carry)}</small>`:''}</span></li>`;
 }).join('')}</ul>`;
}

export function meetingShowratePie(rows) {
 const due=rows.filter(r=>r.stage==='setter'&&r.showrate_due), shown=due.filter(r=>r.outcome==='attended').length;
 if(!due.length) return '<span class="showrate-empty" title="Keine fälligen Setter-Termine">—</span>';
 const percentage=100*shown/due.length, label=meetingShowrate(rows);
 return `<span class="showrate-mini" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><i aria-hidden="true" style="background:conic-gradient(var(--success, #41cfa3) ${percentage}%, var(--line, #314057) 0)"></i><span><b>${Math.round(percentage)} %</b><small>${shown} von ${due.length}</small></span></span>`;
}
