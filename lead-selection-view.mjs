import { renderHistoryChart } from './lead-history-chart.mjs?v=2026-09-10-month-comparison';
import { uniqueLeads, selectionPopulation } from './lead-selection-model.mjs?v=2026-09-10-month-comparison';
export { uniqueLeads, selectionPopulation, NO_SHOW_STATUS_IDS } from './lead-selection-model.mjs?v=2026-09-10-month-comparison';
import { escapeHtml as esc } from './render-security.mjs?v=2026-09-10-month-comparison';
export const dimensions = Object.freeze({lead_source:'Herkunft / Leadquelle',industry:'Branche',owner:'Lead-Owner',opener:'Opener',setter:'Setter',closer:'Closer',industry_wz:'Branche (WZ)',employees:'Mitarbeiterzahl'});
const pct = (n,d) => d ? `${new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(n/d*100)} %` : '—';
const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'}).format(new Date(value))+' Uhr' : '—';
const name = (lead,key) => typeof lead.dimensions?.[key]==='string' && lead.dimensions[key].trim() ? lead.dimensions[key].trim() : 'Nicht gepflegt';
const statusKey = lead => lead.status_id || '__unknown__';
export function statusBuckets(leads) {
 const buckets=new Map();
 for(const lead of leads){const key=statusKey(lead);if(!buckets.has(key))buckets.set(key,{key,label:lead.status_label||'Status nicht verfügbar',leads:[]});buckets.get(key).leads.push(lead);}
 return [...buckets.values()].sort((a,b)=>b.leads.length-a.leads.length||a.label.localeCompare(b.label,'de'));
}
export function dimensionBuckets(leads,key) {
 const buckets=new Map();
 for(const lead of leads){const label=name(lead,key);const id=lead.dimensions?.[`${key}_id`]||label;
 if(!buckets.has(id))buckets.set(id,{key:id,label,leads:[]});buckets.get(id).leads.push(lead);}
 return [...buckets.values()].sort((a,b)=>b.leads.length-a.leads.length||a.label.localeCompare(b.label,'de'));
}
function sourceRule(group){return group.status_side==='new'?'Wechsel zu „Verkauft – Neukunde“':'Statuswechsel aus „'+group.label+'“';}
function sourceLink(group){return /^https:\/\/app\.close\.com\/leads\/share\/share_[A-Za-z0-9]+\/$/.test(group.share_url||'')?`<a href="${esc(group.share_url)}" target="_blank" rel="noopener noreferrer">Close-Filtervorlage ↗</a>`:'';}
export function renderSelectionReport(report,key='setting',dimension='lead_source',chartSeries) {
 if(!report?.groups)return '<p>Leadauswertung wird geladen …</p>';
 const group=report.groups.find(g=>g.key===key)||report.groups[0];if(!group)return '<p>Keine Auswertungsquelle eingerichtet.</p>';
 if(!Object.hasOwn(dimensions,dimension))dimension='lead_source';
 const population=selectionPopulation(group),leads=population.relevant,statuses=statusBuckets(leads),segments=dimensionBuckets(leads,dimension);
 return `<div class="selection-sources" aria-label="Leadauswahl">${report.groups.map(g=>`<button type="button" class="selection-source ${g.key===group.key?'is-active':''}" data-lead-source="${esc(g.key)}" aria-pressed="${g.key===group.key}"><span>${esc(g.label)}</span><strong>${selectionPopulation(g).relevant.length}</strong><small>${g.key==='customer'?'Leads mit Neukunden-Statuswechsel':`relevant · ${uniqueLeads(g).length} insgesamt · ${selectionPopulation(g).noShows.length} No Shows`}</small></button>`).join('')}</div>
 <p class="selection-basis">Auswahl über Statuswechsel im Zeitraum. Aktuelle No-Show-Status zählen separat; die weiteren Raten beziehen sich auf die relevanten Leads ohne No Shows.</p>
 <section class="selection-outcomes"><div class="selection-heading"><div><p class="eyebrow">${esc(group.label)} · ${leads.length} relevante Leads als Basis</p><h3>Wo stehen die relevanten Leads?</h3></div><button type="button" class="selection-detail" data-lead-evidence="all">Alle ${population.all.length} Leads inkl. No Shows ↗</button></div>
 ${group.metadata_pending?'<p role="status">Einige Profildaten warten noch auf den nächsten vollständigen Import.</p>':''}
 ${group.key==='customer'?'':`<div class="selection-attendance"><button type="button" data-lead-evidence="relevant"><span>Ohne No Show</span><strong>${leads.length} / ${population.all.length} · ${pct(leads.length,population.all.length)}</strong></button><button type="button" data-lead-evidence="no-show"><span>No-Show-Quote</span><strong>${population.noShows.length} / ${population.all.length} · ${pct(population.noShows.length,population.all.length)}</strong></button>${population.unknown.length?`<span>${population.unknown.length} ohne bestätigten Status · nicht in den weiteren Raten</span>`:''}</div>`}
 <div class="selection-statuses">${statuses.map(b=>`<button type="button" class="selection-status" data-lead-evidence="status" data-lead-value="${esc(b.key)}" aria-label="${esc(b.label)}: ${b.leads.length} von ${leads.length} Leads, ${pct(b.leads.length,leads.length)}. Leads ansehen"><span>${esc(b.label)}</span><strong>${pct(b.leads.length,leads.length)}</strong><small>${b.leads.length} von ${leads.length} Leads</small><span class="selection-track" aria-hidden="true"><i style="width:${leads.length?b.leads.length/leads.length*100:0}%"></i></span></button>`).join('')||'<p>Keine relevanten Leads ohne No Shows in dieser Auswahl.</p>'}</div></section>
 <section class="selection-history"><div class="selection-heading"><h3>Verlauf der Kennzahlen · ${esc(group.label)}</h3></div><div id="lead-history-chart">${renderHistoryChart(report,group,chartSeries)}</div></section>
 <section class="selection-analysis"><div class="selection-heading"><h3>Leads nach Herkunft & Verantwortung</h3><label>Aufschlüsseln nach <select id="lead-dimension">${Object.entries(dimensions).map(([k,v])=>`<option value="${k}" ${k===dimension?'selected':''}>${v}</option>`).join('')}</select></label></div>
 <div id="lead-filter-controls"></div><p class="selection-basis">Statusanteile je Zeile beziehen sich auf die Leads dieser Zeile.</p>
 <div class="selection-table-wrap"><table class="selection-table"><thead><tr><th>${esc(dimensions[dimension])}</th><th>Leads</th><th>Anteil an ${leads.length}</th><th>Aktueller Status · Anteil je Gruppe</th></tr></thead><tbody>${segments.map(b=>`<tr><th><button type="button" class="selection-detail" data-lead-evidence="dimension" data-lead-value="${esc(b.key)}">${esc(b.label)} ↗</button></th><td>${b.leads.length}</td><td>${pct(b.leads.length,leads.length)}</td><td><div class="selection-status-tags">${statusBuckets(b.leads).map(s=>`<span>${esc(s.label)} <b>${s.leads.length} · ${pct(s.leads.length,b.leads.length)}</b></span>`).join('')}</div></td></tr>`).join('')||'<tr><td colspan="4">Keine Leads in der Auswahl.</td></tr>'}</tbody></table></div></section>
 <details class="selection-method"><summary>Auswahl und Berechnung</summary><p>${esc(sourceRule(group))} · Erstellungszeit des Statuswechsels („Date created“). ${esc(date(group.selection_start))} bis ${esc(date(group.selection_end))} (Ende exklusiv, begrenzt durch den Datenstand). Filter-Zeitzone: ${esc(group.time_zone)}.</p><p>Statusanteil = eindeutige Leads im aktuellen Status ÷ relevante Leads ohne No Shows. No-Show-Quote = No Shows ÷ gesamte Auswahl. Maßgeblich ist der aktuelle Close-Status; „ohne No Show“ ist kein zusätzlicher Nachweis einer Gesprächsaktivität. Follow-ups bleiben eigene Status. Es wird keine Abschlussquote zwischen unabhängigen Auswahlen gebildet.</p><p>${sourceLink(group)} · Referenzfilter mit festem Zeitraum; die Dashboard-Zeitraumauswahl wird separat angewendet.</p></details>`;
}
export function renderLeadEvidence(report,key,dimension,type,value) {
 const group=report?.groups?.find(g=>g.key===key)||report?.groups?.[0];if(!group)return '';
 const population=selectionPopulation(group);let all=population.relevant,leads=all,label='Relevante Leads';
 if(type==='all'){all=population.all;leads=all;label='Alle Leads inklusive No Shows';}
 if(type==='relevant'){all=population.all;leads=population.relevant;label='Ohne No Show';}
 if(type==='no-show'){all=population.all;leads=population.noShows;label='No Shows';}
 if(type==='status'){const bucket=statusBuckets(all).find(b=>b.key===value);leads=bucket?.leads||[];label=bucket?.label||'Status';}
 if(type==='dimension'){const bucket=dimensionBuckets(all,dimension).find(b=>b.key===value);leads=bucket?.leads||[];label=bucket?.label||'Gruppe';}
 const fields=['lead_source','industry','owner','opener','setter','closer'];
 return `<div class="selection-heading"><div><p class="eyebrow">${esc(group.label)}</p><h3 id="lead-evidence-title">${esc(label)}</h3></div><button type="button" data-close-lead-dialog aria-label="Details schließen">Schließen ×</button></div><p>${leads.length} von ${all.length} Leads · ${pct(leads.length,all.length)} ${['all','relevant','no-show'].includes(type)?'der gesamten Auswahl':'der relevanten Leads ohne No Shows'}</p>
 <div class="selection-table-wrap"><table class="selection-table"><thead><tr><th>Lead / aktueller Status</th>${fields.map(k=>`<th>${esc(dimensions[k])}</th>`).join('')}<th>Statuswechsel erfasst</th></tr></thead><tbody>${leads.map(l=>`<tr><th>${/^lead_[A-Za-z0-9]+$/.test(l.lead_id)?`<a href="https://app.close.com/lead/${esc(l.lead_id)}/" target="_blank" rel="noopener noreferrer">${esc(l.lead_name)} ↗</a>`:esc(l.lead_name)}<small>${esc(l.status_label)}</small></th>${fields.map(k=>`<td>${esc(name(l,k))}</td>`).join('')}<td>${esc(date(l.first_recorded_at))}${Number(l.matching_events)>1?`<small>${Number(l.matching_events)} passende Wechsel · zuletzt ${esc(date(l.last_recorded_at))}</small>`:''}</td></tr>`).join('')||'<tr><td colspan="8">Keine Leads.</td></tr>'}</tbody></table></div>`;
}
export function selectionPreview(referenceDate,period){return {period:{type:period,start:referenceDate,end:referenceDate},data_as_of:null,groups:[{key:'setting',label:'Setting',status_side:'old',time_zone:'UTC',total:0,leads:[]},{key:'closing',label:'Closing',status_side:'old',time_zone:'Europe/Berlin',total:0,leads:[]},{key:'customer',label:'Neukunden',status_side:'new',time_zone:'UTC',total:0,leads:[]}]};}
