import {escapeHtml as esc} from './render-security.mjs?v=2026-09-10-lead-quality';
export const openingMonthMetrics=[
 {key:'calls_gross',label:'Brutto-Anrufe',unit:'Anrufe'},
 {key:'calls_net',label:'Netto-Anrufe',unit:'Anrufe'},
 {key:'net_rate',label:'Nettoquote',unit:'%',numerator:'calls_net',denominator:'calls_gross'},
 {key:'connection_rate',label:'Durchstellquote',unit:'%',numerator:'connected_calls',denominator:'gatekeeper_contacts'},
 {key:'decision_maker_contacts',label:'Entscheiderkontakte',unit:'Kontakte'},
 {key:'appointments',label:'Termine',unit:'Termine'},
 {key:'appointment_rate',label:'Terminquote',unit:'%',numerator:'appointments',denominator:'decision_maker_contacts'},
];
const callMetrics=new Set(['calls_gross','calls_net','net_rate']);
const incompleteCalls=(row,metric)=>callMetrics.has(metric.key)&&row?.calls_coverage_complete===false;
const fmt=new Intl.NumberFormat('de-DE',{maximumFractionDigits:1});
export function openingMetricValue(row,metric){if(!row||incompleteCalls(row,metric)&&Number(row.calls_coverage_days)===0||row[metric.key]===null||row[metric.key]===undefined||metric.denominator&&Number(row[metric.denominator])===0)return null;return Number(row[metric.key]);}
export function openingDelta(previous,current,metric){const a=openingMetricValue(previous,metric),b=openingMetricValue(current,metric);
 if(a===null||b===null||previous?.partial||current?.partial||incompleteCalls(previous,metric)||incompleteCalls(current,metric))return '—';
 const delta=b-a,sign=delta>0?'+':'';
 if(metric.unit==='%')return `${sign}${fmt.format(delta)} Pp.`;
 if(a===0)return delta===0?'±0':`${sign}${fmt.format(delta)} ${metric.unit}`;
 return `${sign}${fmt.format(delta/a*100)} %`;
}
const monthLabel=d=>new Intl.DateTimeFormat('de-DE',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${d}T12:00Z`));
export function openingComparison(previous,current,metric){
 let before=previous,after=current,basis='zum Vormonat';
 if(current?.partial){
  const c=current.comparison;
  if(!c?.previous||!c.current)return {label:'—',tone:'neutral',basis:'Monat läuft'};
  before={...c.previous,partial:false};after={...c.current,partial:false};
  basis=`1.–${c.days}. jeweils · ${monthLabel(before.month_start)}`;
 }
 const label=openingDelta(before,after,metric);
 const a=openingMetricValue(before,metric),b=openingMetricValue(after,metric);
 return {label,tone:label==='—'||a===b?'neutral':b>a?'up':'down',basis:label==='—'?'Keine vergleichbare Basis':basis};
}
function deltaMarkup(comparison){return `<small class="opening-change is-${comparison.tone}" title="${esc(comparison.basis)}">${comparison.tone==='up'?'↑ ':comparison.tone==='down'?'↓ ':''}${esc(comparison.label)}<span>${esc(comparison.basis)}</span></small>`;}
function pointFor(person,row,month,metric,previous){
 const value=openingMetricValue(row,metric),comparison=openingComparison(previous,row,metric);
 const before=row?.partial?row.comparison?.previous:previous;
 const after=row?.partial?row.comparison?.current:row;
 const details=[{label:metric.label,value:value===null?'Keine berechenbare Basis':`${fmt.format(value)} ${metric.unit}`}];
 if(metric.denominator&&row)details.push({label:'Zähler / Nenner',value:`${row[metric.numerator]??'—'} / ${row[metric.denominator]??'—'}`});
 if(comparison.label!=='—'){
  details.push({label:'Vergleichszeitraum',value:`${after.month_start} bis ${after.month_end}`},{label:'Vormonatszeitraum',value:`${before.month_start} bis ${before.month_end}`},{label:'Vergleichswerte',value:`${fmt.format(openingMetricValue(after,metric))} / ${fmt.format(openingMetricValue(before,metric))} ${metric.unit}`});
 }
 details.push({label:comparison.basis,value:comparison.label});
 return {title:`${person.display_name} · ${metric.label}`,time:monthLabel(month),rows:details,note:incompleteCalls(row,metric)?`Anrufimporte decken ${row.calls_coverage_days} von ${row.calendar_days} Kalendertagen ab. Erfasster Teilbestand; keine Wachstumsquote.`:row?.partial?`Unvollständiger Monat bis ${row.month_end}. Vergleich, falls belegt: gleicher Kalendertagbereich in beiden Monaten; keine Hochrechnung.`:'Abgeschlossener Monatszeitraum.'};
}
function valueLabel(row,metric){const value=openingMetricValue(row,metric);return value===null?'—':`${fmt.format(value)}${metric.unit==='%'?' %':''}${incompleteCalls(row,metric)?' *':''}`;}
function developmentCharts(rows,shown,months){
 return `<div class="opening-development">${openingMonthMetrics.map(metric=>{
  const series=shown.map(person=>({person,data:months.map(m=>rows.find(r=>r.month_start===m&&r.slug===person.slug))}));
  const max=Math.max(1,...series.flatMap(s=>s.data.map(r=>openingMetricValue(r,metric)??0)));
  const x=i=>48+i*(months.length>1?264/(months.length-1):0),y=value=>142-value/max*112;
  return `<section class="opening-development-card"><h4>${metric.label}</h4><svg viewBox="0 0 360 182" role="img" aria-label="${esc(metric.label)} je Monat"><text x="8" y="33" class="opening-chart-label">${fmt.format(max)}</text><text x="20" y="145" class="opening-chart-label">0</text><path d="M48 30H312 M48 86H312 M48 142H312" class="opening-chart-grid"/>${series.map(({person,data})=>data.map((row,i)=>{
   const v=openingMetricValue(row,metric);if(v===null)return '';
   const previous=i?openingMetricValue(data[i-1],metric):null;
   return `${previous===null?'':`<path d="M${x(i-1)} ${y(previous)}L${x(i)} ${y(v)}" class="opening-chart-line ${row?.partial||incompleteCalls(row,metric)||incompleteCalls(data[i-1],metric)?'is-partial':''} person-${person.slug}"/>`}<circle cx="${x(i)}" cy="${y(v)}" r="4" class="opening-chart-dot person-${person.slug}"><title>${esc(person.display_name)} · ${esc(monthLabel(months[i]))} · ${esc(valueLabel(row,metric))}</title></circle>`;
  }).join('')).join('')}${months.map((m,i)=>`<text x="${x(i)}" y="170" text-anchor="middle" class="opening-chart-label">${esc(monthLabel(m))}</text>`).join('')}</svg><div class="opening-chart-values">${series.map(({person,data})=>`<div><strong class="person-${person.slug}">${esc(person.display_name)}</strong><div class="opening-chart-months">${data.map((row,i)=>`<button type="button" class="opening-month-value" data-chart-point="${esc(JSON.stringify(pointFor(person,row,months[i],metric,data[i-1])))}"><span>${esc(monthLabel(months[i]))}${row?.partial?' · läuft':''}</span><b>${esc(valueLabel(row,metric))}</b>${deltaMarkup(openingComparison(data[i-1],row,metric))}</button>`).join('')}</div></div>`).join('')}</div></section>`;
 }).join('')}</div>`;
}
export function renderOpeningMonthly(rows,people,view,referenceDate,mode='months') {
 const months=[...new Set(rows.map(r=>r.month_start))].sort();
 const shown=people.filter(p=>['michael','felix'].includes(p.slug)&&(view==='team'||view===p.slug));
 const heading=`<div class="selection-heading opening-month-heading"><div><p class="eyebrow">Dreimonatsrückblick</p><h3>Entwicklung der Vertriebler</h3></div><div class="rate-switch opening-view-switch" role="group" aria-label="Entwicklungsansicht">${[['months','Monatswerte'],['development','Gesamtentwicklung']].map(([key,label])=>`<button type="button" data-opening-view="${key}" aria-pressed="${mode===key}" class="${mode===key?'active':''}">${label}</button>`).join('')}</div></div><p class="selection-basis">Δ zum Vormonat: Grün = Anstieg, Rot = Rückgang. Laufende Monate vergleichen denselben Kalendertagbereich. Fehlende Anrufhistorie ergibt keine Quote.${mode==='development'?' Jede Linie zeigt separate Monatswerte; gestrichelt = unvollständig.':''}</p>`;
 if(!months.length)return heading+'<p>Für diesen Zeitraum sind noch keine Monatswerte verfügbar.</p>';
 if(mode==='development')return heading+developmentCharts(rows,shown,months);
 return heading+`<div class="opening-month-people">${shown.map(person=>{
  const data=months.map(month=>rows.find(r=>r.month_start===month&&r.slug===person.slug));
  const complete=data.filter(r=>r&&!r.partial);const previous=complete.at(-2),current=complete.at(-1);
  return `<section class="opening-month-person"><h4>${esc(person.display_name)}</h4><div class="selection-table-wrap"><table class="selection-table"><thead><tr><th>KPI</th>${months.map((m,i)=>`<th>${esc(monthLabel(m))}${data[i]?.partial?`<small>bis ${esc(data[i].month_end.split('-').reverse().join('.'))} · unvollständig</small>`:''}</th>`).join('')}<th>Δ ${current?esc(monthLabel(current.month_start)):'Vormonat'}</th></tr></thead><tbody>${openingMonthMetrics.map(metric=>`<tr><th>${metric.label}</th>${data.map((row,i)=>`<td class="opening-period-cell" data-month="${esc(monthLabel(months[i]))}${row?.partial?' · läuft':''}"><button type="button" class="opening-month-value" data-chart-point="${esc(JSON.stringify(pointFor(person,row,months[i],metric,data[i-1])))}">${esc(valueLabel(row,metric))}</button>${i?deltaMarkup(openingComparison(data[i-1],row,metric)):''}</td>`).join('')}<td class="opening-month-delta">${deltaMarkup(openingComparison(previous,current,metric))}</td></tr>`).join('')}</tbody></table></div>${data.some(r=>r?.calls_coverage_complete===false)?'<p class="selection-basis">* Anruf-Teilbestand · — bei fehlender Anrufhistorie. Dafür wird kein Monatsvergleich berechnet.</p>':''}</section>`;
 }).join('')}</div>`;
}
