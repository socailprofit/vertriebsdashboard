import {PEOPLE} from './verified-journey.mjs?v=2026-09-10-separate-groups';
import { escapeHtml as esc } from './render-security.mjs?v=2026-09-10-separate-groups';
import {uniqueLeads} from './lead-selection-model.mjs?v=2026-09-10-separate-groups';
export const filterRoles={owner:'Lead-Owner',opener:'Opener',setter:'Setter',closer:'Closer'};
export function filterOptions(report,key,role='owner') {
 if(key==='employee')return PEOPLE;
 const values=new Map();
 for(const g of report?.leads?[{leads:report.leads}]:report?.groups||[])for(const lead of uniqueLeads(g)){
  const d=lead.dimensions||{};
  let id,label;
  if(key==='employee'){id=d[`${role}_id`];label=d[role];}
  else if(key==='status'){id=lead.status_id;label=lead.status_label;}
  else {id=d[key==='source'?'lead_source':'industry'];label=id;}
  values.set(id||'__missing__',label||'Nicht gepflegt');
 }
 return [...values].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label,'de'));
}
export function renderLeadFilters(report,filters={}) {
 const count=['employee','source','industry','status'].filter(key=>filters[key]).length;
 const select=(key,label)=>`<label>${label}<select id="lead-filter-${key}" data-lead-filter="${key}"><option value="">Alle</option>${filterOptions(report,key,filters.role).map(o=>`<option value="${esc(o.value)}" ${filters[key]===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>`;
 return `<div class="lead-filter-heading"><strong>Leadqualität eingrenzen${count?` · ${count} Filter aktiv`:''}</strong><button type="button" class="selection-detail" data-reset-lead-filters>Filter zurücksetzen</button></div><div class="lead-filters"><label>Mitarbeiterrolle<select id="lead-filter-role" data-lead-filter="role">${Object.entries(filterRoles).map(([value,label])=>`<option value="${value}" ${(filters.role||'owner')===value?'selected':''}>${label}</option>`).join('')}</select></label>${select('employee','Mitarbeiter / Backoffice')}${select('source','Leadquelle')}${select('industry','Branche')}${select('status','Aktueller Status')}</div>${count?'<p class="selection-basis">Alle Zahlen und Raten beziehen sich auf diese Filter. Die Filter verwenden die aktuellen CRM-Felder.</p>':''}`;
}
