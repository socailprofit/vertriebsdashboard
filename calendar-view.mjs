import {escapeHtml} from './render-security.mjs';
const month=v=>v?new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit'}).format(new Date(v)):null;
const monthName=v=>new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',month:'long',year:'numeric'}).format(new Date(v));
export function meetingShowrate(rows){const due=rows.filter(r=>r.stage==='setter'&&r.showrate_due);const shown=due.filter(r=>r.outcome==='attended').length;return due.length?`${shown} von ${due.length} fälligen Terminen · ${Math.round(100*shown/due.length)} %`:'—';}
export function calendarDetails(rows){
 const labels={attended:'Durchgeführt',no_show:'Nicht erschienen',cancelled:'Abgesagt',cancelled_plan:'Abgesagt · nicht bewertet',rescheduled:'Verschoben',planned:'Geplant',future:'Geplant',unknown:'Ergebnis nicht belegt'};
 return `<ul class="meeting-audit">${rows.map(r=>{
 const date=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(r.starts_at));
 const carry=r.first_meeting_at&&month(r.first_meeting_at)<month(r.starts_at)?`Übertrag aus ${monthName(r.first_meeting_at)}`:'';
 const lead=/^lead_[A-Za-z0-9]+$/.test(r.lead_id)?`<a href="https://app.close.com/lead/${encodeURIComponent(r.lead_id)}/" target="_blank" rel="noopener noreferrer">Lead ${escapeHtml(r.lead_id.slice(-10))} ↗</a>`:'Lead nicht zugeordnet';
 return `<li><span>${lead}<small>Meeting-ID: ${escapeHtml(r.meeting_id)}</small></span><span>${({setter:'Setter',closer:'Closer',cc2:'CC2'})[r.stage]||'Terminart ungeklärt'}</span><time>${escapeHtml(date)} Uhr${r.rescheduled?' · aktueller Ersatztermin':''}</time><span>${labels[r.outcome]||'Ergebnis nicht belegt'}${carry?`<small>${escapeHtml(carry)}</small>`:''}</span></li>`;
 }).join('')}</ul>`;
}
export function monthCohort(source){
 if(!Array.isArray(source?.booking_cohort))return '';
 const totals=source.booking_cohort.reduce((a,r)=>{for(const k of ['booked_leads','setter_arrived','closer_qualified','closer_arrived','cc2_agreed','new_customers'])a[k]=(a[k]||0)+Number(r[k]||0);return a;},{});
 const base=totals.booked_leads||0;
 const steps=[['Setter-Termin',base,null],['Setter durchgeführt',totals.setter_arrived,base],['Closer terminiert',totals.closer_qualified,totals.setter_arrived],['Closer durchgeführt',totals.closer_arrived,totals.closer_qualified],['CC2 · optional',totals.cc2_agreed,totals.closer_arrived],['Neukunde',totals.new_customers,totals.closer_arrived]];
 return `<h3>Monats-Pipeline · Ersttermine ${escapeHtml(monthName(source.period.start+'T12:00Z'))}</h3><ol class="month-cohort">${steps.map(([title,n,d])=>`<li><span>${title}</span><strong>${n||0}</strong>${d===null?'':`<small>Übergang: ${n||0} / ${d||0} · ${d?Math.round(100*(n||0)/d)+' %':'—'}${title==='Neukunde'?' der Closer-Vorgänge':''}</small>`}</li>`).join('')}</ol>`;
}
