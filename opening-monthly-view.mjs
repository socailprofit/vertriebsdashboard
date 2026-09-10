import {escapeHtml as esc} from './render-security.mjs?v=2026-09-10-lead-quality';
export const openingMonthMetrics=[
 {key:'calls_gross',label:'Brutto-Anrufe',unit:'Anrufe'},
 {key:'calls_net',label:'Netto-Anrufe',unit:'Anrufe'},
 {key:'net_rate',label:'Nettoquote',unit:'%',denominator:'calls_gross'},
 {key:'connection_rate',label:'Durchstellquote',unit:'%',denominator:'gatekeeper_contacts'},
 {key:'decision_maker_contacts',label:'Entscheiderkontakte',unit:'Kontakte'},
 {key:'appointments',label:'Termine',unit:'Termine'},
 {key:'appointment_rate',label:'Terminquote',unit:'%',denominator:'decision_maker_contacts'},
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
export function renderOpeningMonthly(rows,people,view,referenceDate) {
 const months=[...new Set(rows.map(r=>r.month_start))].sort();
 const shown=people.filter(p=>['michael','felix'].includes(p.slug)&&(view==='team'||view===p.slug));
 const monthLabel=d=>new Intl.DateTimeFormat('de-DE',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${d}T12:00Z`));
 return `<div class="selection-heading"><div><p class="eyebrow">Dreimonatsrückblick</p><h3>Entwicklung der Vertriebler</h3></div></div><p class="selection-basis">Monatswerte bis zum gewählten Stichtag. Δ vergleicht ausschließlich die letzten zwei vollständigen Monate; ein laufender Monat wird nicht mit einem vollen Monat gleichgesetzt.</p><div class="opening-month-people">${shown.map(person=>{
  const data=months.map(month=>rows.find(r=>r.month_start===month&&r.slug===person.slug));
  const complete=data.filter(r=>r&&!r.partial);const previous=complete.at(-2),current=complete.at(-1);
  return `<section class="opening-month-person"><h4>${esc(person.display_name)}</h4><div class="selection-table-wrap"><table class="selection-table"><thead><tr><th>KPI</th>${months.map((m,i)=>`<th>${esc(monthLabel(m))}${data[i]?.partial?`<small>bis ${esc(data[i].month_end.split('-').reverse().join('.'))} · unvollständig</small>`:''}</th>`).join('')}<th>Δ ${current?esc(monthLabel(current.month_start)):'Vormonat'}</th></tr></thead><tbody>${openingMonthMetrics.map(metric=>`<tr><th>${metric.label}</th>${data.map((row,i)=>{
   const value=openingMetricValue(row,metric),label=value===null?'—':`${fmt.format(value)}${metric.unit==='%'?' %':''}${incompleteCalls(row,metric)?' *':''}`;
   const point={title:`${person.display_name} · ${metric.label}`,time:monthLabel(months[i]),rows:[{label:metric.label,value:value===null?'Keine berechenbare Basis':`${fmt.format(value)} ${metric.unit}`}],note:incompleteCalls(row,metric)?`Anrufimporte decken ${row.calls_coverage_days} von ${row.calendar_days} Kalendertagen ab. ${value===null?'Anrufhistorie fehlt.':'Erfasster Teilbestand, kein vollständiger Monatswert.'}`:row?.partial?`Unvollständiger Monat bis ${row.month_end}. Keine Hochrechnung.`:'Abgeschlossener Monatszeitraum.'};
   return `<td><button type="button" class="opening-month-value" data-chart-point="${esc(JSON.stringify(point))}">${label}</button></td>`;
  }).join('')}<td class="opening-month-delta">${openingDelta(previous,current,metric)}</td></tr>`).join('')}</tbody></table></div>${data.some(r=>r?.calls_coverage_complete===false)?'<p class="selection-basis">* Anruf-Teilbestand · — bei fehlender Anrufhistorie. Dafür wird kein Monatsvergleich berechnet.</p>':''}</section>`;
 }).join('')}</div>`;
}
