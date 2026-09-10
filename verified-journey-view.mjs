import {escapeHtml as esc} from './render-security.mjs';
import {METRICS,DEFAULT_METRICS,metricFacts,metricEntries,monthlyBounds,personLabel} from './verified-journey.mjs?v=2026-09-10-verified-journey-2';
const fmt=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'});
const date=v=>Number.isFinite(typeof v==='number'?v:Date.parse(v))?fmt.format(new Date(v))+' Uhr':'—';
const pct=(n,d)=>d?new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(n/d*100)+' %':'—';
export const journeyDimensions={lead_source:'Herkunft / Leadquelle',industry:'Branche',owner:'Lead-Owner',opener:'Opener',setter:'Setter',closer:'Closer',backoffice:'Kanal / Backoffice'};
function dimensionName(lead,key) {
 const d=lead.dimensions||{};
 if(key==='backoffice')return d.backoffice_id==='linkedin'&&d.backoffice_basis?'LinkedIn':'Nicht belegt';
 if(['owner','opener','setter','closer'].includes(key))return personLabel(d[key+'_id'],d[key]);
 return d[key]||'Nicht gepflegt';
}
function buckets(leads,key) {
 const groups=new Map();
 for(const l of leads) {const label=dimensionName(l,key);if(!groups.has(label))groups.set(label,[]);groups.get(label).push(l);}
 return [...groups].map(([label,leads])=>({label,leads})).sort((a,b)=>b.leads.length-a.leads.length||a.label.localeCompare(b.label,'de'));
}
function statusBuckets(leads) {
 const groups=new Map();
 for(const l of leads){const key=l.status_id||'__missing__';if(!groups.has(key))groups.set(key,{key,label:l.status_label||'Nicht gepflegt',leads:[]});groups.get(key).leads.push(l);}
 return [...groups.values()].sort((a,b)=>b.leads.length-a.leads.length);
}
function pointAttrs(point){return ' data-chart-point="'+esc(JSON.stringify(point))+'"';}
function rateButton(report,rate) {
 const quote=rate.value===null?'—':pct(rate.numerator.length,rate.denominator.length);
 const ids=new Set(rate.numerator.map(n=>n.lead_id)),names=report.leads.filter(l=>ids.has(l.lead_id)).map(l=>l.lead_name);
 return '<button type="button" class="selection-status"'+pointAttrs({title:rate.label,time:date(report.activity_start)+' – '+date(report.activity_end),rows:[{label:'Zähler',value:rate.numerator.length},{label:'Nenner',value:rate.denominator.length},{label:'Quote',value:quote},...(names.length?[{label:'Leads im Zähler',value:names.join(', ')}]:[])],note:rate.basis})+'><span>'+esc(rate.label)+'</span><strong>'+quote+'</strong><small>'+rate.numerator.length+' / '+rate.denominator.length+'</small></button>';
}
export function renderJourneyChart(report,enabled=DEFAULT_METRICS) {
 const keys=Object.keys(METRICS).filter(k=>enabled.includes(k)),trend=report.period.type==='trend';
 const points=trend?monthlyBounds(report):[...new Set([Date.parse(report.activity_start),...report.facts.filter(f=>Date.parse(f.at)>=Date.parse(report.activity_start)).map(f=>Date.parse(f.at)),...(report.activity_history||[]).filter(e=>Date.parse(e.recorded_at)>=Date.parse(report.activity_start)&&Date.parse(e.recorded_at)<Date.parse(report.activity_end)).map(e=>Date.parse(e.recorded_at)),Date.parse(report.activity_end)])].sort((a,b)=>a-b).map(at=>({start:report.activity_start,end:new Date(at===Date.parse(report.activity_end)?at:at+1).toISOString(),at,label:date(at)}));
 for(const p of points)p.values=Object.fromEntries(keys.map(k=>[k,metricEntries(report,k,p.start,p.end).length]));
 const peak=Math.max(1,...points.flatMap(p=>Object.values(p.values))),left=48,top=28,height=204,width=920;
 const y=v=>top+height-v/peak*height;
 const grid=[...new Set(Array.from({length:5},(_,i)=>Math.round(peak*i/4)))].map(v=>'<line x1="48" x2="980" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#304156"/><text x="38" y="'+(y(v)+4)+'" text-anchor="end">'+v+'</text>').join('');
 let shapes='';
 if(trend) {
  shapes=points.map((p,i)=>{
   const slot=width/3,bw=Math.min(38,230/Math.max(1,keys.length)),origin=left+i*slot+(slot-bw*keys.length)/2;
   return keys.map((k,j)=>'<rect x="'+(origin+j*bw)+'" y="'+y(p.values[k])+'" width="'+(bw-5)+'" height="'+(p.values[k]/peak*height)+'" fill="'+METRICS[k].color+'" rx="3"/><text x="'+(origin+j*bw+(bw-5)/2)+'" y="'+(y(p.values[k])-7)+'" text-anchor="middle">'+p.values[k]+'</text>').join('')+'<text x="'+(left+(i+.5)*slot)+'" y="260" text-anchor="middle">'+esc(p.label)+'</text>'+(p.partial?'<text x="'+(left+(i+.5)*slot)+'" y="281" text-anchor="middle">laufend · unvollständig</text>':'');
  }).join('');
 } else {
  const min=Date.parse(report.activity_start),max=Date.parse(report.activity_end),x=at=>left+(at-min)/(max-min||1)*width;
  shapes=keys.map(k=>'<path d="'+points.map((p,i)=>i?'H'+x(p.at)+'V'+y(p.values[k]):'M'+x(p.at)+','+y(p.values[k])).join(' ')+'" fill="none" stroke="'+METRICS[k].color+'" stroke-width="2.5"/>').join('');
  shapes+=Array.from({length:5},(_,i)=>{const at=min+(max-min)*i/4;return '<text x="'+x(at)+'" y="260" text-anchor="'+(i===0?'start':i===4?'end':'middle')+'">'+esc(new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit'}).format(new Date(at)))+'</text>';}).join('');
 }
 const hits=points.map((p,i)=>{
  const point={title:trend?p.label:'KPI-Verlauf',time:date(p.start)+' – '+date(p.end),rows:keys.map(k=>({label:METRICS[k].label,value:p.values[k]+' '+METRICS[k].unit})),note:'Setting/CC1: rückblickende Old-Status-Auswahl, verbleibende Leads ohne No-Show-Status am jeweiligen Ende. Setting-Auswahl UTC, Closing Berlin; Neukunden beim ersten passenden Statuswechsel, unabhängig vom Monat früherer Phasen. Berlin. '+(trend?'Jeder Monat separat.':'Kumuliert innerhalb des ausgewählten Zeitraums.')};
  const scale=at=>left+(at-Date.parse(report.activity_start))/(Date.parse(report.activity_end)-Date.parse(report.activity_start)||1)*width;
  const origin=trend?left+i*width/3:i===0?left:(scale(points[i-1].at)+scale(p.at))/2;
  const right=trend?origin+width/3:i===points.length-1?left+width:(scale(p.at)+scale(points[i+1].at))/2;
  const step=right-origin;
  return '<rect class="lead-history-hit" x="'+origin+'" y="'+top+'" width="'+step+'" height="'+height+'" fill="transparent" tabindex="0" role="button" aria-label="'+esc(p.label+': KPI-Werte ansehen')+'"'+pointAttrs(point)+'/>';
 }).join('');
 return '<div class="lead-history-legend">'+Object.entries(METRICS).map(([k,m])=>'<label style="--series-color:'+m.color+'"><input type="checkbox" data-lead-chart-series="'+k+'" '+(enabled.includes(k)?'checked':'')+'>'+esc(m.label)+'</label>').join('')+'</div><div class="lead-history-scroll"><svg class="lead-history-svg" viewBox="0 0 1000 300" role="group" aria-label="Gemeinsamer KPI-Verlauf"><text x="48" y="15">Anzahl Leads</text>'+grid+shapes+hits+'</svg></div><p class="selection-basis">'+(trend?'Jeder Monat separat; laufender Monat unvollständig.':'Verlauf innerhalb des Zeitraums bis zum Datenstand.')+' Ergebnisbestand der rückblickenden Gruppe · Gespräche und Neukunden separat · Klick zeigt Zeitraum und Berechnungsbasis.</p>';
}
export function renderJourneyReport(report,key='setting',dimension='lead_source',series=DEFAULT_METRICS) {
 const group=report.groups.find(g=>g.key===key)||report.groups[0],leads=group.leads;
 if(!Object.hasOwn(journeyDimensions,dimension))dimension='lead_source';
 const transitions=report.rates.filter(r=>['setting_cc1','cc1_cc2','cc1_customer','cc2_customer','cc1_direct'].includes(r.key));
 const otherRates=report.rates.filter(r=>!transitions.includes(r));
 const unresolved=report.calendar.filter(m=>m.stage==='unassigned').length;
 const sub={setting:'Ergebnisbestand ohne No-Show-Status',closing:'Ergebnisbestand ohne No-Show-Status',cc2:'Leads mit dokumentiertem CC2',customer:'erster Neukunden-Statuswechsel'};
 const reference=report.references.find(g=>g.key==='setting'),closingReference=report.references.find(g=>g.key==='closing');
 return '<div class="selection-sources journey-pipeline" aria-label="Pipeline">'+report.groups.map(g=>'<button type="button" class="selection-source '+(g.key===group.key?'is-active':'')+'" data-lead-source="'+g.key+'" aria-pressed="'+(g.key===group.key)+'"><span>'+g.label+(g.key==='cc2'?' · optional':'')+'</span><strong>'+g.total+'</strong><small>'+esc(['setting','closing'].includes(g.key)?g.total+' aus '+g.source_total+' ausgewerteten Leads · '+g.no_show_count+' im No-Show-Status':sub[g.key])+'</small></button>').join('')+'</div>'+
 '<p class="selection-basis">Setting → Closer Call 1 → Closer Call 2 (optional) → Neukunde · Ein Abschluss ist auch direkt nach CC1 möglich.</p>'+
 '<section class="selection-outcomes"><div class="selection-heading"><h3>Konversion derselben Leads</h3></div><div class="selection-statuses journey-transitions">'+transitions.map(r=>rateButton(report,r)).join('')+'</div><p class="selection-basis">Zähler und Nenner verfolgen dieselben rückblickend ausgewerteten Leads bis zum Datenstand. Neue Buchungen („Entered“) sind keine abgeschlossenen Setter. Offene Follow-ups bleiben offen.</p><details class="selection-method"><summary>Show-, No-Show- und Verlustquoten</summary><div class="selection-statuses">'+otherRates.map(r=>rateButton(report,r)).join('')+'</div><p>Gesprächsnachweise stammen aus veröffentlichten Aktivitäten. No Shows sind durch Aktivitäten oder ausdrückliche Statuswechsel derselben Leads belegt. „Ohne No Show“ allein ist kein Gesprächsnachweis.</p></details></section>'+
 '<section class="selection-history"><div class="selection-heading"><h3>Alle KPIs im Vergleich</h3></div><div id="lead-history-chart">'+renderJourneyChart(report,series)+'</div></section>'+
 '<section class="selection-analysis"><div class="selection-heading"><h3>Leads nach Herkunft & Verantwortung</h3><label>Aufschlüsseln nach <select id="lead-dimension">'+Object.entries(journeyDimensions).map(([k,v])=>'<option value="'+k+'" '+(dimension===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label></div><div id="lead-filter-controls"></div>'+
 '<div class="selection-heading"><p>'+esc(group.label)+' · '+leads.length+' Leads · heutige CRM-Zuordnung</p><button type="button" class="selection-detail" data-lead-evidence="all">Alle '+leads.length+' Leads ↗</button>'+(['setting','closing'].includes(group.key)?'<button type="button" class="selection-detail" data-lead-evidence="cohort">Ausgangsgruppe: '+group.source_total+' inkl. No Shows ↗</button>':'')+'</div>'+
 '<div class="selection-table-wrap"><table class="selection-table"><thead><tr><th>'+journeyDimensions[dimension]+'</th><th>Leads</th><th>Anteil</th><th>Aktueller Status · Anteil je Gruppe</th></tr></thead><tbody>'+buckets(leads,dimension).map(b=>'<tr><th><button class="selection-detail" type="button" data-lead-evidence="dimension" data-lead-value="'+esc(b.label)+'">'+esc(b.label)+' ↗</button></th><td>'+b.leads.length+'</td><td>'+pct(b.leads.length,leads.length)+'</td><td><div class="selection-status-tags">'+statusBuckets(b.leads).map(s=>'<span>'+esc(s.label)+' <b>'+s.leads.length+' · '+pct(s.leads.length,b.leads.length)+'</b></span>').join('')+'</div></td></tr>').join('')+(leads.length?'':'<tr><td colspan="4">Keine belegten Ereignisse für diese Filter.</td></tr>')+'</tbody></table></div></section>'+
 '<details class="selection-method"><summary>Auswahl, Close-Abgleich und Datenlücken</summary><p>'+date(report.activity_start)+' bis '+date(report.activity_end)+' (Ende exklusiv). Nur dokumentierte Ereignisse; keine künftigen Termine. Aktuelle CRM-Felder filtern alle Auswertungen gemeinsam, historische Kennzahlen bleiben ereignisbasiert.</p>'+
 '<p>Close-Referenzen: '+(reference?.leads.length||0)+' eindeutige Leads mit Old Status „Setting“, '+(closingReference?.leads.length||0)+' mit Old Status „Closing“. Das sind Statuswechsel-Auswahlen, keine Anzahl neuer Leads oder fester Termine. Setting-Referenz: UTC; Closing-Referenz: Europe/Berlin; jeweils Date created. Gesprächsaktivitäten und Neukunden werden nach Europe/Berlin ausgewertet. Die Close-Spalte Ended zeigt den Statusbestand und belegt keine durchgeführten Gespräche.</p>'+
 '<p>'+unresolved+' Kalendertermine ohne eindeutige Stufe; '+metricFacts(report.facts,'closer_unstaged',report.activity_start,report.activity_end).length+' Leads mit Closer-Aktivität ohne gesicherte CC1/CC2-Stufe. Nicht als bestätigte Stufe gerechnet.</p>'+
 '<p>LinkedIn ist Kanal / Backoffice. Ein verbindlicher CRM-Nachweis für die Backoffice-Zuordnung liegt noch nicht vor. Leadquelle und ehemalige Mitarbeiter werden deshalb nicht automatisch zu LinkedIn umgebucht. Historische Verantwortliche bleiben in den Detaildaten erhalten.</p>'+
 '<p>Ein Neukunde zählt einmal beim ersten dokumentierten Wechsel zu „Verkauft – Neukunde“, unabhängig von früheren Setting-/Closing-Monaten. Fehlt der Nachweis des Abschlusswegs, bleibt dieser ungeklärt; der belegte Neukunde bleibt enthalten.</p></details>';
}
export function renderJourneyEvidence(report,key,dimension,type,value) {
 const g=report.groups.find(g=>g.key===key)||report.groups[0];
 const all=type==='cohort'?g.cohort.map(c=>({...report.leads.find(l=>l.lead_id===c.lead_id),evidence:c.evidence||[c]})):g.leads;
 const leads=type==='dimension'?all.filter(l=>dimensionName(l,dimension)===value):all;
 const fields=['lead_source','industry','owner','opener','setter','closer','backoffice'];
 return '<div class="selection-heading"><div><p class="eyebrow">'+g.label+'</p><h3 id="lead-evidence-title">'+esc(type==='dimension'?value:'Dokumentierte Leads und Verlauf')+'</h3></div><button type="button" data-close-lead-dialog aria-label="Details schließen">Schließen ×</button></div><p>'+leads.length+' von '+all.length+' Leads · '+date(g.selection_start)+' – '+date(g.selection_end)+'</p><div class="selection-table-wrap"><table class="selection-table"><thead><tr><th>Lead / aktueller Status</th>'+fields.map(k=>'<th>'+journeyDimensions[k]+'</th>').join('')+'<th>Nachweis</th></tr></thead><tbody>'+leads.map(l=>'<tr><th>'+(/^lead_[A-Za-z0-9]+$/.test(l.lead_id)?'<a target="_blank" rel="noopener noreferrer" href="https://app.close.com/lead/'+esc(l.lead_id)+'/">'+esc(l.lead_name)+' ↗</a>':esc(l.lead_name))+'<small>'+esc(l.status_label)+'</small></th>'+fields.map(k=>'<td>'+esc(dimensionName(l,k))+(['owner','opener','setter','closer'].includes(k)&&dimensionName(l,k)==='Ehemalig / nicht zugeordnet'?'<small>CRM: '+esc(l.dimensions?.[k]||l.dimensions?.[k+'_id'])+'</small>':'')+'</td>').join('')+'<td>'+(l.evidence||[]).map(e=>esc(date(e.at))+'<small>'+esc(e.kind+' · '+e.id)+'</small>').join('')+'</td></tr>').join('')+'</tbody></table></div>';
}
