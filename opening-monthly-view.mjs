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
const metricDashes=['','12 5','2 5','10 4 2 4'];
export function openingDevelopmentSeries(rows,shown,months,{unit='counts',metrics=openingMonthMetrics.map(m=>m.key)}={}) {
 const available=openingMonthMetrics.filter(m=>(m.unit==='%')===(unit==='rates'));
 const selected=available.filter(m=>metrics.includes(m.key));
 const series=shown.flatMap(person=>selected.map(metric=>({person,metric,dash:metricDashes[available.indexOf(metric)],data:months.map(month=>{
  const row=rows.find(r=>r.month_start===month&&r.slug===person.slug);
  return {row,value:openingMetricValue(row,metric),partial:!!row?.partial||incompleteCalls(row,metric)};
 })})));
 const largest=Math.max(1,...series.flatMap(s=>s.data.map(p=>p.value??0)));
 const magnitude=10**Math.floor(Math.log10(largest/4));
 const tickStep=Math.max(1,[1,2,2.5,5,10].find(n=>n*magnitude>=largest/4)*magnitude);
 const max=unit==='rates'?Math.max(100,Math.ceil(largest/25)*25):tickStep*4;
 return {available,series,max,unit:unit==='rates'?'rates':'counts'};
}
function developmentChart(rows,shown,months,options){
 const choices=openingMonthMetrics.filter(m=>(m.unit==='%')===(options.unit==='rates'));
 const active=choices.find(m=>options.metrics?.includes(m.key))||choices[0];
 const model=openingDevelopmentSeries(rows,shown,months,{...options,metrics:[active.key]}),{series,max,available,unit}=model;
 const selected=new Set(series.map(s=>s.metric.key));
 const x=i=>(i+.5)*720/months.length,y=value=>280-value/max*260;
 const monthPoint=i=>({title:'Monatswerte · '+(unit==='rates'?'Quoten':'Anzahlen'),time:monthLabel(months[i]),rows:series.map(s=>({label:`${s.person.display_name} · ${s.metric.label}`,value:valueLabel(s.data[i].row,s.metric)})),note:'Separate Monatswerte. * = Anruf-Teilbestand. Laufende Monate sind unvollständig; keine Hochrechnung. Die Detailtabelle zeigt die Berechnungsbasis und den Vormonatsvergleich.'});
 const partialMonths=new Set(months.filter(month=>rows.some(row=>row.month_start===month&&row.partial&&shown.some(p=>p.slug===row.slug))));
 return `<div class="opening-development opening-development-single"><section class="opening-development-card">
 <div class="opening-chart-toolbar"><div><p class="opening-chart-eyebrow">Monatliche Entwicklung</p><h4>${active.label}</h4></div><div class="rate-switch" role="group" aria-label="Skala auswählen">${[['counts','Anzahlen'],['rates','Quoten']].map(([key,label])=>`<button type="button" data-opening-unit="${key}" aria-pressed="${unit===key}" class="${unit===key?'active':''}">${label}</button>`).join('')}</div></div>
 <div class="opening-metric-picker" role="group" aria-label="Kennzahl auswählen">${available.map(metric=>`<label class="${selected.has(metric.key)?'is-selected':''}"><input type="radio" name="opening-chart-metric" data-opening-metric="${metric.key}" ${selected.has(metric.key)?'checked':''}/><span>${metric.key==='decision_maker_contacts'?'Entscheider':metric.label}</span></label>`).join('')}</div>
 <div class="opening-person-legend">${shown.map(person=>`<span class="person-${person.slug}"><i></i>${esc(person.display_name)}</span>`).join('')}</div>
 <p class="opening-chart-note">${unit==='rates'?'Quote in %':active.unit+' je Monat'} · Gestrichelt = unvollständiger Zeitraum · * = Anruf-Teilbestand</p>
 <div class="opening-combined-plot"><div class="opening-y-axis" aria-hidden="true">${[4,3,2,1,0].map(i=>`<span>${fmt.format(max*i/4)}${unit==='rates'?' %':''}</span>`).join('')}</div><div class="opening-plot-body">
 <svg class="opening-combined-svg" viewBox="0 0 720 300" preserveAspectRatio="none" role="img" aria-label="${active.label} der Vertriebler über ${months.map(monthLabel).join(', ')}">
 ${[0,1,2,3,4].map(i=>`<path d="M0 ${20+i*65}H720" class="opening-chart-grid"/>`).join('')}
 ${months.map((month,i)=>partialMonths.has(month)?`<rect x="${Math.max(0,x(i)-70)}" y="0" width="${Math.min(720,x(i)+70)-Math.max(0,x(i)-70)}" height="300" class="opening-partial-month"/>`:'').join('')}
 ${series.map(s=>s.data.map((p,i)=>{
  const previous=i?s.data[i-1]:null;
  return p.value===null||!previous||previous.value===null?'':`<path d="M${x(i-1)} ${y(previous.value)}L${x(i)} ${y(p.value)}" class="opening-chart-line person-${s.person.slug} ${p.partial||previous.partial?'is-incomplete':''}" stroke-dasharray="${p.partial||previous.partial?'6 5':''}"/>`;
 }).join('')).join('')}
 </svg>${series.map((s,seriesIndex)=>s.data.map((p,i)=>p.value===null?'':`<button type="button" class="opening-combined-point person-${s.person.slug} ${p.partial?'is-incomplete':''}" style="left:${x(i)/720*100}%;top:${y(p.value)/300*100}%" aria-label="${esc(s.person.display_name+' · '+s.metric.label+' · '+monthLabel(months[i])+' · '+valueLabel(p.row,s.metric))}" data-chart-point="${esc(JSON.stringify(pointFor(s.person,p.row,months[i],s.metric,s.data[i-1]?.row)))}"><span class="opening-point-symbol"></span><span class="opening-point-value ${series.some((other,j)=>j!==seriesIndex&&other.data[i].value!==null&&(other.data[i].value>p.value||other.data[i].value===p.value&&j<seriesIndex))?'is-below':''}">${esc(valueLabel(p.row,s.metric))}</span></button>`).join('')).join('')}${series.every(s=>s.data.every(p=>p.value===null))?'<p class="opening-chart-empty">Für diese Auswahl liegen keine belegten Werte vor.</p>':''}
 </div></div><div class="opening-month-axis" style="grid-template-columns:repeat(${months.length},minmax(0,1fr))">${months.map((m,i)=>`<button type="button" data-chart-point="${esc(JSON.stringify(monthPoint(i)))}">${esc(monthLabel(m))}${partialMonths.has(m)?'<small>unvollständig</small>':series.every(s=>s.data[i].value===null)?'<small>Keine Daten</small>':''}</button>`).join('')}</div>
 <details class="opening-development-details"><summary>Werte &amp; Vormonatsvergleich</summary><div class="opening-chart-detail-series">${series.map(s=>`<section><h5 class="person-${s.person.slug}">${esc(s.person.display_name)} · ${s.metric.label}</h5><div class="opening-chart-months">${s.data.map((p,i)=>`<button type="button" class="opening-month-value" data-chart-point="${esc(JSON.stringify(pointFor(s.person,p.row,months[i],s.metric,s.data[i-1]?.row)))}"><span>${esc(monthLabel(months[i]))}</span><b>${esc(valueLabel(p.row,s.metric))}</b>${deltaMarkup(openingComparison(s.data[i-1]?.row,p.row,s.metric))}</button>`).join('')}</div></section>`).join('')}</div></details>
 </section></div>`;
}
export function renderOpeningMonthly(rows,people,view,referenceDate,mode='months',chartOptions={}) {
 const months=[...new Set(rows.map(r=>r.month_start))].sort();
 const shown=people.filter(p=>['michael','felix'].includes(p.slug)&&(view==='team'||view===p.slug));
 const heading=`<div class="selection-heading opening-month-heading"><div><p class="eyebrow">Dreimonatsrückblick</p><h3>Entwicklung der Vertriebler</h3></div><div class="rate-switch opening-view-switch" role="group" aria-label="Entwicklungsansicht">${[['months','Monatswerte'],['development','Gesamtentwicklung']].map(([key,label])=>`<button type="button" data-opening-view="${key}" aria-pressed="${mode===key}" class="${mode===key?'active':''}">${label}</button>`).join('')}</div></div><p class="selection-basis">Δ zum Vormonat: Grün = Anstieg, Rot = Rückgang. Laufende Monate vergleichen denselben Kalendertagbereich. Fehlende Anrufhistorie ergibt keine Quote.</p>`;
 if(!months.length)return heading+'<p>Für diesen Zeitraum sind noch keine Monatswerte verfügbar.</p>';
 if(mode==='development')return heading+developmentChart(rows,shown,months,chartOptions);
 return heading+`<div class="opening-month-people">${shown.map(person=>{
  const data=months.map(month=>rows.find(r=>r.month_start===month&&r.slug===person.slug));
  const complete=data.filter(r=>r&&!r.partial);const previous=complete.at(-2),current=complete.at(-1);
  return `<section class="opening-month-person"><h4>${esc(person.display_name)}</h4><div class="selection-table-wrap"><table class="selection-table"><thead><tr><th>KPI</th>${months.map((m,i)=>`<th>${esc(monthLabel(m))}${data[i]?.partial?`<small>bis ${esc(data[i].month_end.split('-').reverse().join('.'))} · unvollständig</small>`:''}</th>`).join('')}<th>Δ ${current?esc(monthLabel(current.month_start)):'Vormonat'}</th></tr></thead><tbody>${openingMonthMetrics.map(metric=>`<tr><th>${metric.label}</th>${data.map((row,i)=>`<td class="opening-period-cell" data-month="${esc(monthLabel(months[i]))}${row?.partial?' · läuft':''}"><button type="button" class="opening-month-value" data-chart-point="${esc(JSON.stringify(pointFor(person,row,months[i],metric,data[i-1])))}">${esc(valueLabel(row,metric))}</button>${i?deltaMarkup(openingComparison(data[i-1],row,metric)):''}</td>`).join('')}<td class="opening-month-delta">${deltaMarkup(openingComparison(previous,current,metric))}</td></tr>`).join('')}</tbody></table></div>${data.some(r=>r?.calls_coverage_complete===false)?'<p class="selection-basis">* Anruf-Teilbestand · — bei fehlender Anrufhistorie. Dafür wird kein Monatsvergleich berechnet.</p>':''}</section>`;
 }).join('')}</div>`;
}
