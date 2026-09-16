import {escapeHtml as esc} from './render-security.mjs';
import {personLabel,STATUS} from './verified-journey.mjs?v=2026-09-11-dual-setting';
const number = new Intl.NumberFormat('de-DE',{maximumFractionDigits:2});
const euro = new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
export function workingCapital(value) {
 if(typeof value!=='string'||!value.trim())return null;
 const s=value.trim().replace(/\s*€$/,'').replace(/[\s\u00a0]/g,'');
 // CRM text uses German decimal/thousands separators. Reject uncertain formats.
 if(!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(s))return null;
 const n=Number(s.replaceAll('.','').replace(',','.'));return Number.isFinite(n)?n:null;
}
export function liquidity(lead) {
 const d=lead.dimensions||{},capital=workingCapital(d.working_capital);
 const price=typeof d.offer_price_eur==='string'&&/^\d+(?:\.\d{1,2})?$/.test(d.offer_price_eur)?Number(d.offer_price_eur):null;
 if(capital===null)return {value:null,label:'—',note:'Working Capital fehlt oder unklar'};
 if(!price||!Number.isFinite(price))return {value:null,label:'—',note:d.offer_note||'Angebotspreis fehlt'};
 const value=capital/price;return {value,label:number.format(value)+'×',note:euro.format(capital)+' ÷ '+euro.format(price)};
}
export function overviewLeads(report, includeCohorts=false) {
 const ids=new Set(report.groups.flatMap(g=>[...(includeCohorts?g.cohort||[]:[]),...(g.monthly_entries||[]),...g.leads].map(l=>l.lead_id)));
 const excluded=new Set([STATUS.disqualified,'stat_9z5zqirMleW4DbhYjsmZnV96jexVlXiYXU3yqIR8KzZ','stat_13rPYib4kw9kmCqcrcVNysFD028WcuKwxQjH6syd0w6']);
 return report.leads.filter(l=>ids.has(l.lead_id)&&(includeCohorts||!excluded.has(l.status_id))).sort((a,b)=>(a.lead_name||'').localeCompare(b.lead_name||'','de'));
}
const owner=l=>{const d=l.dimensions||{};return d.backoffice_id==='linkedin'&&d.backoffice_basis?'LinkedIn':personLabel(d.opener_id,d.opener);};
const metrics=(report,ids)=>report.groups.map(g=>(g.monthly_entries||[]).filter(l=>ids.has(l.lead_id)).length);
function rates(report,ids,prefix) {
 return ['show','no_show','lost'].map((type,i)=>{
 const r=report.rates.find(r=>r.key===prefix+'_'+type);if(!r)return '';
 const d=r.denominator.filter(l=>ids.has(l.lead_id)),n=r.numerator.filter(l=>ids.has(l.lead_id));
 const value=!d.length||d.some(l=>l.entry_known===false)?'—':new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(n.length/d.length*100)+' %';
 return '<span>'+['Show','No Show','Verlust'][i]+': <b>'+value+'</b> <small class="quality-fraction">('+n.length+'/'+d.length+')</small></span>';
 }).join('');
}
export function renderQualityPeople(report,leads) {
 const groups=new Map();for(const l of leads){const name=owner(l);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(l);}
 const rows=[['Gesamt',leads],...[...groups].sort((a,b)=>a[0].localeCompare(b[0],'de'))];
 return '<h4>Leadqualität nach Opener / Backoffice</h4><p class="selection-basis">Gespräche und Neukunden im Zeitraum. Quoten: dieselben Leads der jeweiligen CRM-Auswahl. Zuordnung nach dem aktuellen Opener-Feld; kein Nachweis des Gesprächsführers.</p><div class="selection-table-wrap"><table class="selection-table quality-summary"><thead><tr><th>Zuordnung</th><th>Unternehmen</th><th>Setting</th><th>CC1</th><th>CC2</th><th>Neukunden</th><th>Setting-Quoten</th><th>Closing-Quoten</th></tr></thead><tbody>'+rows.map(([label,ls])=>{const ids=new Set(ls.map(l=>l.lead_id));return '<tr><th>'+esc(label)+'</th><td>'+ls.length+'</td>'+metrics(report,ids).map(v=>'<td>'+v+'</td>').join('')+'<td class="quality-rates">'+rates(report,ids,'setter')+'</td><td class="quality-rates">'+rates(report,ids,'closer')+'</td></tr>';}).join('')+'</tbody></table></div>';
}
export function renderQualityCompanies(report,leads,sort='overview') {
 const sorted=[...leads];if(['working_capital','liquidity_factor'].includes(sort))sorted.sort((a,b)=>{
 const value=l=>sort==='working_capital'?workingCapital(l.dimensions?.working_capital):liquidity(l).value;
 const av=value(a),bv=value(b);return av===null?bv===null?0:1:bv===null?-1:bv-av;
 });
 return '<div class="selection-table-wrap quality-company-scroll"><table class="selection-table quality-companies"><thead><tr><th>Unternehmen / Opener</th><th>Quelle / Branche (WZ)</th><th>Working Capital</th><th>Liquiditätsfaktor</th><th>Setting</th><th>CC1</th><th>CC2</th><th>Neukunde</th></tr></thead><tbody>'+sorted.map(l=>{
 const d=l.dimensions||{},wc=workingCapital(d.working_capital),factor=liquidity(l),ids=new Set([l.lead_id]);
 return '<tr><th><button class="selection-detail" type="button" data-lead-evidence="company" data-lead-value="'+esc(l.lead_id)+'">'+esc(l.lead_name||'Unternehmen ohne Namen')+' ↗</button><small>'+esc(owner(l))+'</small></th><td>'+esc(d.lead_source||'Quelle nicht gepflegt')+'<small>'+esc(d.industry_wz||'Branche (WZ) nicht gepflegt')+'</small></td><td>'+(wc===null?'Nicht gepflegt / unklar':euro.format(wc))+(d.financials_date?'<small>Stand: '+esc(d.financials_date)+'</small>':'')+'</td><td><strong>'+factor.label+'</strong><small>'+esc(factor.note)+'</small></td>'+metrics(report,ids).map((n,i)=>'<td>'+(n?'✓':report.groups[i].leads.some(x=>x.lead_id===l.lead_id)?'früher':'—')+'</td>').join('')+'</tr>';
 }).join('')+(sorted.length?'':'<tr><td colspan="8">Keine dokumentierten Leads für diese Filter.</td></tr>')+'</tbody></table></div><p class="selection-basis">✓ = im Zeitraum belegt · früher = Gespräch bereits vorher belegt · — = kein Nachweis. Liquiditätsfaktor = Working Capital ÷ eindeutiger einmaliger Angebotspreis aus Close. Fehlende oder mehrdeutige Preise ergeben keinen Faktor.</p>';
}
export function renderQualityOverview(report) {
 const leads=overviewLeads(report);
 return '<p class="selection-basis">'+leads.length+' relevante Unternehmen · belegte Gespräche oder Neukunde · ohne aktuelle Disqualifizierungen und No Shows</p>'+renderQualityCompanies(report,leads);
}
