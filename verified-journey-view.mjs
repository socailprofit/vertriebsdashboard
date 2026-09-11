import {escapeHtml as esc} from './render-security.mjs';
import {METRICS,DEFAULT_METRICS,metricFacts,metricEntries,monthlyBounds,personLabel} from './verified-journey.mjs?v=2026-09-11-dual-setting';
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
 const peak=Math.max(1,...points.flatMap(p=>Object.values(p.values))),left=48,top=44,height=244,width=trend?920:660;
 const y=v=>top+height-v/peak*height;
 const activityMetric=k=>k==='setter_show'||k==='cc1_show';
 const shortLabel=k=>({setting:'Setting · Gespräch belegt',closing:'CC1 · Gespräch belegt'})[k]||METRICS[k].label;
 const pointDetail=(p,onlyKeys=keys)=>({title:trend?p.label:'KPI-Verlauf',time:date(p.start)+' – '+date(p.end),rows:onlyKeys.map(k=>({label:METRICS[k].label,value:p.values[k]+' '+METRICS[k].unit})),note:'CRM-Auswahl: eindeutige Leads mit Statuswechsel aus Setting bzw. Closing. Davon Gespräch belegt: Nachweis seit dem damaligen Phaseneintritt, auch früher. Gespräche im Zeitraum: ausschließlich im angezeigten Zeitraum stattgefunden. Setting-Auswahl UTC, Closing Berlin; Neukunden beim ersten passenden Statuswechsel, unabhängig vom Monat früherer Phasen. Berlin. '+(trend?'Jeder Monat separat.':'Kumuliert innerhalb des ausgewählten Zeitraums.')});
 const grid=[...new Set(Array.from({length:5},(_,i)=>Math.round(peak*i/4)))].map(v=>'<line class="journey-grid" x1="48" x2="'+(left+width)+'" y1="'+y(v)+'" y2="'+y(v)+'"/><text x="38" y="'+(y(v)+4)+'" text-anchor="end">'+v+'</text>').join('');
 let shapes='',endLabels='';
 if(trend) {
  shapes=points.map((p,i)=>{
   const slot=width/3,bw=Math.min(38,230/Math.max(1,keys.length)),origin=left+i*slot+(slot-bw*keys.length)/2;
   return keys.map((k,j)=>'<rect x="'+(origin+j*bw)+'" y="'+y(p.values[k])+'" width="'+(bw-5)+'" height="'+(p.values[k]/peak*height)+'" fill="'+METRICS[k].color+'" rx="3"/><text x="'+(origin+j*bw+(bw-5)/2)+'" y="'+(y(p.values[k])-7)+'" text-anchor="middle">'+p.values[k]+'</text>').join('')+'<text x="'+(left+(i+.5)*slot)+'" y="318" text-anchor="middle">'+esc(p.label)+'</text>'+(p.partial?'<text x="'+(left+(i+.5)*slot)+'" y="340" text-anchor="middle">laufend · unvollständig</text>':'');
  }).join('');
 } else {
  const min=Date.parse(report.activity_start),max=Date.parse(report.activity_end),x=at=>left+(at-min)/(max-min||1)*width;
  shapes=keys.map(k=>{
   const changes=points.filter((p,i)=>i&&p.values[k]!==points[i-1].values[k]);
   return '<g style="--series-color:'+METRICS[k].color+'"><path class="journey-line" d="'+points.map((p,i)=>i?'H'+x(p.at)+'V'+y(p.values[k]):'M'+x(p.at)+','+y(p.values[k])).join(' ')+'" stroke-dasharray="'+(activityMetric(k)?'7 5':'')+'"/>'+changes.map(p=>'<circle class="journey-event-dot" cx="'+x(p.at)+'" cy="'+y(p.values[k])+'" r="3.2"/>').join('')+'<circle class="journey-end-dot" cx="'+(left+width)+'" cy="'+y(points.at(-1).values[k])+'" r="4"/></g>';
  }).join('');
  shapes+=Array.from({length:5},(_,i)=>{const at=min+(max-min)*i/4;return '<text x="'+x(at)+'" y="318" text-anchor="'+(i===0?'start':i===4?'end':'middle')+'">'+esc(new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',...(report.period.type==='day'?{hour:'2-digit',minute:'2-digit'}:{day:'2-digit',month:'2-digit'})}).format(new Date(at)))+'</text>';}).join('');
  // Move only label positions to prevent collisions; every data point stays exact.
  const last=points.at(-1),labels=keys.map(k=>({key:k,actual:y(last.values[k])})).sort((a,b)=>a.actual-b.actual);
  labels.forEach((label,i)=>label.at=Math.max(top+8,label.actual,i?labels[i-1].at+26:top+8));
  if(labels.length&&labels.at(-1).at>top+height){labels.at(-1).at=top+height;for(let i=labels.length-2;i>=0;i--)labels[i].at=Math.min(labels[i].at,labels[i+1].at-26);}
  endLabels=labels.map(({key:k,actual,at})=>'<g class="journey-end-label" style="--series-color:'+METRICS[k].color+'" tabindex="0" role="button" aria-label="'+esc(METRICS[k].label+': '+last.values[k]+' Leads, Details anzeigen')+'"'+pointAttrs({...pointDetail(last,[k]),title:METRICS[k].label})+'><path class="journey-label-connector" d="M'+(left+width+7)+' '+actual+'L'+(left+width+24)+' '+at+'H'+(left+width+32)+'"/><rect x="'+(left+width+34)+'" y="'+(at-12)+'" width="244" height="24" rx="5"/><text x="'+(left+width+40)+'" y="'+(at+4)+'">'+esc(shortLabel(k))+'</text><text class="journey-end-value" x="978" y="'+(at+4)+'" text-anchor="end">'+last.values[k]+'</text></g>').join('');
 }
 const hits=points.map((p,i)=>{
  const point=pointDetail(p);
  const scale=at=>left+(at-Date.parse(report.activity_start))/(Date.parse(report.activity_end)-Date.parse(report.activity_start)||1)*width;
  const origin=trend?left+i*width/3:i===0?left:(scale(points[i-1].at)+scale(p.at))/2;
  const right=trend?origin+width/3:i===points.length-1?left+width:(scale(p.at)+scale(points[i+1].at))/2;
  return '<g class="journey-hit"><rect class="lead-history-hit" x="'+origin+'" y="'+top+'" width="'+(right-origin)+'" height="'+height+'" fill="transparent" tabindex="0" role="button" aria-label="'+esc(p.label+': KPI-Werte ansehen')+'"'+pointAttrs(point)+'/>'+(!trend?'<line class="journey-guide" x1="'+scale(p.at)+'" x2="'+scale(p.at)+'" y1="'+top+'" y2="'+(top+height)+'"/><text class="journey-hover-date" x="'+(left+width)+'" y="22" text-anchor="end">'+esc(date(p.at))+'</text>':'')+'</g>';
 }).join('');
 const legend='<div class="lead-history-legend journey-legend">'+Object.entries(METRICS).map(([k,m])=>'<label class="'+(enabled.includes(k)?'is-active':'')+'" style="--series-color:'+m.color+'"><input type="checkbox" data-lead-chart-series="'+k+'" '+(enabled.includes(k)?'checked':'')+'><svg viewBox="0 0 24 8" aria-hidden="true"><path d="M1 4H23" stroke-dasharray="'+(activityMetric(k)?'5 3':'')+'"/></svg><span>'+esc(m.label)+'</span></label>').join('')+'</div>';
 return '<div class="journey-chart">'+legend+'<p class="journey-chart-help">'+(trend?'Leads je Monat · jeder Monat separat':'Leads im Zeitraum · Punkt = geänderter KPI-Stand · gestrichelte Linie = Gespräche im Zeitraum')+'</p><p class="journey-scroll-hint">Graph nach rechts wischen →</p><div class="lead-history-scroll"><svg class="lead-history-svg journey-history-svg" viewBox="0 0 1000 360" role="group" aria-label="Gemeinsamer KPI-Verlauf"><text x="48" y="22">Anzahl Leads</text>'+grid+shapes+hits+endLabels+(!keys.length?'<text x="500" y="170" text-anchor="middle">Kennzahl oben auswählen</text>':'')+'</svg></div><p class="selection-basis">'+(trend?'Jeder Monat separat; laufender Monat unvollständig.':'Verlauf innerhalb des Zeitraums bis zum Datenstand.')+' Belegte Gespräche der rückblickenden Gruppe · CRM-Auswahl, Gespräche im Zeitraum und Neukunden separat · Klick auf Verlauf oder Endwert zeigt Zeitraum und Berechnungsbasis.</p></div>';
}

export function renderJourneyReport(report,key='setting',dimension='lead_source',series=DEFAULT_METRICS) {
 const group=report.groups.find(g=>g.key===key)||report.groups[0],leads=group.leads;
 if(!Object.hasOwn(journeyDimensions,dimension))dimension='lead_source';
 const prefix=group.key==='setting'?'setter_':group.key==='closing'?'closer_':null;
 const ownRates=prefix?report.rates.filter(r=>r.key.startsWith(prefix)):[];
 const unresolved=report.calendar.filter(m=>m.stage==='unassigned').length;
 const sub={setting:'Ergebnisbestand ohne No-Show-Status',closing:'Ergebnisbestand ohne No-Show-Status',cc2:'Leads mit dokumentiertem CC2',customer:'erster Neukunden-Statuswechsel'};
 const reference=report.references.find(g=>g.key==='setting'),closingReference=report.references.find(g=>g.key==='closing');
 return '<div class="selection-sources journey-pipeline" aria-label="Pipeline">'+report.groups.map(g=>'<button type="button" class="selection-source '+(g.key===group.key?'is-active':'')+'" data-lead-source="'+g.key+'" aria-pressed="'+(g.key===group.key)+'"><span>'+g.label+(g.key==='cc2'?' · optional':'')+'</span>'+(['setting','closing'].includes(g.key)?'<div class="journey-dual-values"><div><strong>'+g.source_total+'</strong><small>CRM-Auswahl</small></div><div><strong>'+g.total+'</strong><small>davon Gespräch belegt</small></div></div>':'<strong>'+g.total+'</strong><small>'+esc(sub[g.key])+'</small>')+'</button>').join('')+'</div>'+
 '<p class="selection-basis">CRM-Auswahl = Leads mit Statuswechsel aus der Phase. Gespräch belegt = davon mit dokumentierter Teilnahme, auch vor dem Zeitraum. Zukünftige Termine zählen nicht. Jede Phase hat ihre eigene Auswahl.</p>'+
 (prefix?'<div class="selection-attendance journey-period-measures"><button type="button" data-lead-evidence="monthly"><span>'+esc(group.key==='setting'?'Setter-Gespräche im Zeitraum':'CC1-Gespräche im Zeitraum')+'</span><strong>'+group.monthly_entries.length+' Leads ↗</strong></button><button type="button" data-lead-evidence="unknown"><span>CRM-Auswahl · Teilnahme ungeklärt</span><strong>'+group.audit.unknown.length+' Leads ↗</strong></button></div>':'')+
 (ownRates.length?'<section class="selection-outcomes"><div class="selection-heading"><h3>Quoten innerhalb der '+esc(group.label)+'-Auswahl</h3></div><div class="selection-statuses">'+ownRates.map(r=>rateButton(report,r)).join('')+'</div><p class="selection-basis">Zähler und Nenner gehören ausschließlich zur ausgewählten Close-Gruppe. Gespräche aus ihrem früheren Verlauf bleiben berücksichtigt. Offene Follow-ups sind keine Verluste. '+(prefix&&group.audit.overlap.length?group.audit.overlap.length+' Leads haben sowohl Gesprächs- als auch No-Show-Nachweise; die Quoten sind deshalb keine Gegenanteile.':'Zukünftige Termine sind aus Zähler und Nenner ausgeschlossen.')+'</p></section>':'')+
 '<section class="selection-history"><div class="selection-heading"><h3>Alle KPIs im Vergleich</h3></div><div id="lead-history-chart">'+renderJourneyChart(report,series)+'</div></section>'+
 '<section class="selection-analysis"><div class="selection-heading"><h3>Leads nach Herkunft & Verantwortung</h3><label>Aufschlüsseln nach <select id="lead-dimension">'+Object.entries(journeyDimensions).map(([k,v])=>'<option value="'+k+'" '+(dimension===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label></div><div id="lead-filter-controls"></div>'+
 '<div class="selection-heading"><p>'+esc(group.label)+' · '+leads.length+' Leads · belegter Verlauf · heutige CRM-Zuordnung</p><button type="button" class="selection-detail" data-lead-evidence="all">Alle '+leads.length+' Leads ↗</button>'+(['setting','closing'].includes(group.key)?'<button type="button" class="selection-detail" data-lead-evidence="cohort">Ausgangsgruppe: '+group.source_total+' inkl. No Shows ↗</button>':'')+'</div>'+
 '<div class="selection-table-wrap"><table class="selection-table"><thead><tr><th>'+journeyDimensions[dimension]+'</th><th>Leads</th><th>Anteil</th><th>Aktueller Status · Anteil je Gruppe</th></tr></thead><tbody>'+buckets(leads,dimension).map(b=>'<tr><th><button class="selection-detail" type="button" data-lead-evidence="dimension" data-lead-value="'+esc(b.label)+'">'+esc(b.label)+' ↗</button></th><td>'+b.leads.length+'</td><td>'+pct(b.leads.length,leads.length)+'</td><td><div class="selection-status-tags">'+statusBuckets(b.leads).map(s=>'<span>'+esc(s.label)+' <b>'+s.leads.length+' · '+pct(s.leads.length,b.leads.length)+'</b></span>').join('')+'</div></td></tr>').join('')+(leads.length?'':'<tr><td colspan="4">Keine belegten Ereignisse für diese Filter.</td></tr>')+'</tbody></table></div></section>'+
 '<details class="selection-method"><summary>Auswahl, Close-Abgleich und Datenlücken</summary><p>'+date(report.activity_start)+' bis '+date(report.activity_end)+' (Ende exklusiv). Nur dokumentierte Ereignisse; keine künftigen Termine. Aktuelle CRM-Felder filtern alle Auswertungen gemeinsam, historische Kennzahlen bleiben ereignisbasiert.</p>'+
 '<p>Close-Referenzen: '+(reference?.leads.length||0)+' eindeutige Leads mit Old Status „Setting“, '+(closingReference?.leads.length||0)+' mit Old Status „Closing“. Das sind Statuswechsel-Auswahlen, keine Anzahl neuer Leads oder fester Termine. Setting-Referenz: UTC; Closing-Referenz: Europe/Berlin; jeweils Date created. Gesprächsaktivitäten und Neukunden werden nach Europe/Berlin ausgewertet. Die Close-Spalte Ended zeigt den Statusbestand und belegt keine durchgeführten Gespräche.</p>'+
 '<p>'+unresolved+' Kalendertermine ohne eindeutige Stufe; '+metricFacts(report.facts,'closer_unstaged',report.activity_start,report.activity_end).length+' Leads mit Closer-Aktivität ohne gesicherte CC1/CC2-Stufe. Nicht als bestätigte Stufe gerechnet.</p>'+
 '<p>LinkedIn ist Kanal / Backoffice. Ein verbindlicher CRM-Nachweis für die Backoffice-Zuordnung liegt noch nicht vor. Leadquelle und ehemalige Mitarbeiter werden deshalb nicht automatisch zu LinkedIn umgebucht. Historische Verantwortliche bleiben in den Detaildaten erhalten.</p>'+
 '<p>Ein Neukunde zählt einmal beim ersten dokumentierten Wechsel zu „Verkauft – Neukunde“, unabhängig von früheren Setting-/Closing-Monaten. Fehlt der Nachweis des Abschlusswegs, bleibt dieser ungeklärt; der belegte Neukunde bleibt enthalten.</p></details>';
}
export function renderJourneyEvidence(report,key,dimension,type,value) {
 const g=report.groups.find(g=>g.key===key)||report.groups[0];
 const entries=type==='cohort'?g.cohort:type==='unknown'?g.audit.unknown:type==='monthly'?g.monthly_entries:null;
 const all=entries?entries.map(c=>({...report.leads.find(l=>l.lead_id===c.lead_id),evidence:c.evidence||[c]})):g.leads;
 const title=type==='cohort'?'CRM-Auswahl · Statuswechsel':type==='unknown'?'Teilnahme ungeklärt':type==='monthly'?'Belegte Gespräche im Zeitraum':'Dokumentierte Leads und Verlauf';
 const leads=type==='dimension'?all.filter(l=>dimensionName(l,dimension)===value):all;
 const fields=['lead_source','industry','owner','opener','setter','closer','backoffice'];
 return '<div class="selection-heading"><div><p class="eyebrow">'+g.label+'</p><h3 id="lead-evidence-title">'+esc(type==='dimension'?value:title)+'</h3></div><button type="button" data-close-lead-dialog aria-label="Details schließen">Schließen ×</button></div><p>'+leads.length+' von '+all.length+' Leads · '+date(g.selection_start)+' – '+date(g.selection_end)+'</p><div class="selection-table-wrap"><table class="selection-table"><thead><tr><th>Lead / aktueller Status</th>'+fields.map(k=>'<th>'+journeyDimensions[k]+'</th>').join('')+'<th>Nachweis</th></tr></thead><tbody>'+leads.map(l=>'<tr><th>'+(/^lead_[A-Za-z0-9]+$/.test(l.lead_id)?'<a target="_blank" rel="noopener noreferrer" href="https://app.close.com/lead/'+esc(l.lead_id)+'/">'+esc(l.lead_name)+' ↗</a>':esc(l.lead_name))+'<small>'+esc(l.status_label)+'</small></th>'+fields.map(k=>'<td>'+esc(dimensionName(l,k))+(['owner','opener','setter','closer'].includes(k)&&dimensionName(l,k)==='Ehemalig / nicht zugeordnet'?'<small>CRM: '+esc(l.dimensions?.[k]||l.dimensions?.[k+'_id'])+'</small>':'')+'</td>').join('')+'<td>'+(l.evidence||[]).map(e=>esc(date(e.at))+'<small>'+esc(e.kind+' · '+e.id)+'</small>').join('')+'</td></tr>').join('')+'</tbody></table></div>';
}
