import {renderJourneyChart} from './verified-journey-view.mjs?v=2026-09-10-verified-journey-2';
import {escapeHtml as esc} from './render-security.mjs?v=2026-09-10-verified-journey-2';
import {uniqueLeads,NO_SHOW_STATUS_IDS} from './lead-selection-model.mjs?v=2026-09-10-verified-journey-2';
const FOLLOWUPS=new Set(['stat_8ugtaHvwvKH3hIELdeQUqwUExa4Hn4ipsYQUuRvEfAm','stat_d9hxREiCT5xmQHv7HbfzeyBmeVHoZYUzkMXuwzPiIve','stat_SPNvi34PmlJBYNre2CJh12Yc78H6si1jYvNyhxarxwS']);
const CC2='stat_ohblHuUMB0T7CwMfQSZhu0xWc2GDGaOEtCYOHeMMA6c',SOLD='stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory';
export const historyMetrics={relevant:{label:'Relevant ohne No Show',color:'#79a2ff'},no_show:{label:'No Shows',color:'#ff8d9d'},followup:{label:'Follow-ups',color:'#f3bf69'},cc2:{label:'CC2',color:'#c09bff'},sold:{label:'Neukunden',color:'#5dd6b0'}};
export function buildHistorySeries(report,group) {
 const start=Date.parse(group?.selection_start),end=Date.parse(group?.selection_end);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!Array.isArray(report?.history))return [];
 const leads=uniqueLeads(group),ids=new Set(leads.map(l=>l.lead_id));
 const history=report.history.filter(e=>ids.has(e.lead_id)&&Date.parse(e.recorded_at)>=start&&Date.parse(e.recorded_at)<end)
  .sort((a,b)=>Date.parse(a.recorded_at)-Date.parse(b.recorded_at)||a.source_event_id.localeCompare(b.source_event_id));
 const times=[...new Set([start,...history.map(e=>Date.parse(e.recorded_at)),end])].sort((a,b)=>a-b);
 const status=new Map();let cursor=0;
 return times.map(at=>{
  while(cursor<history.length&&Date.parse(history[cursor].recorded_at)<=at){status.set(history[cursor].lead_id,history[cursor].status_id);cursor++;}
  const v={at,total:0,relevant:0,no_show:0,followup:0,cc2:0,sold:0,unknown:0};
  for(const lead of leads){if(Date.parse(lead.first_recorded_at)>at)continue;
   v.total++;const id=status.get(lead.lead_id);if(!id){v.unknown++;continue;}
   if(NO_SHOW_STATUS_IDS.has(id)&&group.key!=='customer')v.no_show++;else v.relevant++;
   if(FOLLOWUPS.has(id))v.followup++;if(id===CC2)v.cc2++;if(history.some(e=>e.lead_id===lead.lead_id&&e.status_id===SOLD&&Date.parse(e.recorded_at)<=at))v.sold++;
  }
  return v;
 });
}
export function renderHistoryChart(report,group,enabled=['relevant','no_show','cc2','sold']) {
 if(report?.facts)return renderJourneyChart(report,enabled);
 if(report.period?.type==='trend')return renderMonthlyComparison(report,group,enabled);
 const series=buildHistorySeries(report,group),keys=group.key==='customer'?['sold']:Object.keys(historyMetrics).filter(k=>enabled.includes(k));
 if(!series.length)return '<p class="selection-basis">Für diesen Zeitraum liegt noch kein auswertbarer Statusverlauf vor.</p>';
 const w=1000,h=300,left=48,right=20,top=26,bottom=48,plotW=w-left-right,plotH=h-top-bottom;
 const min=series[0].at,max=series.at(-1).at,peak=Math.max(1,...series.flatMap(p=>keys.map(k=>p[k])));
 const x=at=>left+(at-min)/(max-min||1)*plotW,y=v=>top+plotH-v/peak*plotH;
 const fmt=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'});
 const axisFmt=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',...(report.period?.type==='day'?{hour:'2-digit',minute:'2-digit'}:{day:'2-digit',month:'2-digit'})});
 const pct=(n,d)=>d?`${new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(n/d*100)} %`:'—';
 const paths=keys.map(k=>{const d=series.map((p,i)=>i?`H${x(p.at).toFixed(2)}V${y(p[k]).toFixed(2)}`:`M${x(p.at).toFixed(2)},${y(p[k]).toFixed(2)}`).join(' ');return `<path d="${d}" fill="none" stroke="${historyMetrics[k].color}" stroke-width="2.5"/>`;}).join('');
 const grid=[...new Set(Array.from({length:5},(_,i)=>Math.round(peak*i/4)))].map(v=>`<line x1="${left}" x2="${w-right}" y1="${y(v)}" y2="${y(v)}" stroke="#304156"/><text x="${left-10}" y="${y(v)+4}" text-anchor="end">${v}</text>`).join('');
 const ticks=Array.from({length:5},(_,i)=>{const at=min+(max-min)*i/4;return `<text x="${x(at)}" y="${h-20}" text-anchor="${i===0?'start':i===4?'end':'middle'}">${esc(axisFmt.format(new Date(at)))}</text>`;}).join('');
 const points=series.map((p,i)=>{
  const rows=[{label:'Gesamte Auswahl bis dahin',value:`${p.total} Leads`},...keys.map(k=>({label:historyMetrics[k].label,value:`${p[k]} Leads`})),{label:'No-Show-Quote',value:`${p.no_show} / ${p.total} · ${pct(p.no_show,p.total)}`}];
  if(group.key==='customer')rows.pop();
  if(p.unknown)rows.push({label:'Historischer Status ungeklärt',value:`${p.unknown} Leads`});
  const point={title:`${group.label} · damaliger Status`,time:fmt.format(new Date(p.at))+' Uhr',rows,note:'Stand aus protokollierten Statuswechseln. Filter beziehen sich auf heutige CRM-Felder.'};
  const a=i?(x(series[i-1].at)+x(p.at))/2:left,b=i<series.length-1?(x(p.at)+x(series[i+1].at))/2:w-right;
  return `<rect class="lead-history-hit" x="${a}" y="${top}" width="${Math.max(1,b-a)}" height="${plotH}" fill="transparent" tabindex="0" role="button" aria-label="Werte am ${esc(point.time)}" data-chart-point="${esc(JSON.stringify(point))}"/>`;
 }).join('');
 return `<div class="lead-history-legend">${Object.entries(historyMetrics).filter(([key])=>group.key!=='customer'||key==='sold').map(([key,m])=>`<label style="--series-color:${m.color}"><input type="checkbox" data-lead-chart-series="${key}" ${enabled.includes(key)?'checked':''}>${m.label}</label>`).join('')}</div><div class="lead-history-scroll"><svg class="lead-history-svg" viewBox="0 0 ${w} ${h}" aria-label="${esc(group.label)}: Entwicklung in Leads" role="group"><text x="${left}" y="15">Anzahl Leads</text>${grid}${paths}${ticks}${points}</svg></div><p class="selection-basis">Damals protokollierter Status · Uhrzeit Europe/Berlin. No Shows sind separat; CC2 und Follow-ups zeigen den damaligen Status. Neukunden zählen beim dokumentierten Wechsel zu „Verkauft – Neukunde“. Ein Klick zeigt den genauen Stand. Bei historischen Zeiträumen kann dieser von den heutigen Statuskarten abweichen.</p>`;
}

function monthBoundary(year,month,timeZone){
 const utc=Date.UTC(year,month,1);if(timeZone==='UTC')return utc;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'shortOffset'}).formatToParts(new Date(utc));
 const offset=parts.find(p=>p.type==='timeZoneName').value.match(/GMT([+-])(\d+)(?::(\d+))?/);
 return utc-(offset?(offset[1]==='+'?1:-1)*(Number(offset[2])*60+Number(offset[3]||0))*60000:0);
}
export function buildMonthlyComparison(report,group){
 const [year,month]=report.period.start.split('-').map(Number),limit=Date.parse(group.selection_end);
 const history=report.history||[],leads=uniqueLeads(group);
 return Array.from({length:3},(_,i)=>{
  const d=new Date(Date.UTC(year,month-1+i,1)),start=monthBoundary(d.getUTCFullYear(),d.getUTCMonth(),group.time_zone||'UTC'),next=monthBoundary(d.getUTCFullYear(),d.getUTCMonth()+1,group.time_zone||'UTC'),end=Math.min(next,limit);
  const matches=history.filter(e=>Date.parse(e.recorded_at)>=start&&Date.parse(e.recorded_at)<end&&(group.status_side==='new'?e.status_id===group.status_id:e.previous_status===group.status_id));
  const first=new Map();for(const e of matches){if(!first.has(e.lead_id)||Date.parse(e.recorded_at)<Date.parse(first.get(e.lead_id)))first.set(e.lead_id,e.recorded_at);}
  const monthly={...group,selection_start:new Date(start).toISOString(),selection_end:new Date(Math.max(start,end)).toISOString(),leads:leads.filter(l=>first.has(l.lead_id)).map(l=>({...l,first_recorded_at:first.get(l.lead_id)}))};
  const point=buildHistorySeries(report,monthly).at(-1)||{total:0,relevant:0,no_show:0,followup:0,cc2:0,sold:0};
  return {...point,start,end,partial:end<next,label:new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric',timeZone:'UTC'}).format(d)};
 });
}
function renderMonthlyComparison(report,group,enabled){
 const months=buildMonthlyComparison(report,group),keys=group.key==='customer'?['sold']:Object.keys(historyMetrics).filter(k=>enabled.includes(k));
 const peak=Math.max(1,...months.flatMap(m=>keys.map(k=>m[k]))),left=48,top=30,h=300,plotH=205,plotW=920,slot=plotW/3;
 const bars=months.map((m,i)=>{
  const width=Math.min(38,220/Math.max(1,keys.length)),origin=left+i*slot+(slot-width*keys.length)/2;
  const rects=keys.map((k,j)=>`<rect x="${origin+j*width}" y="${top+plotH-m[k]/peak*plotH}" width="${width-6}" height="${m[k]/peak*plotH}" fill="${historyMetrics[k].color}" rx="3"/><text x="${origin+j*width+(width-6)/2}" y="${top+plotH-m[k]/peak*plotH-7}" text-anchor="middle">${m[k]}</text>`).join('');
  const point={title:`${group.label} · ${m.label}`,time:`${new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'}).format(new Date(m.partial?m.end:m.end-1))} Uhr (Berlin) · ${m.partial?'laufender Monat':'Monatsende'}`,rows:[{label:'Auswahl in diesem Monat',value:`${m.total} Leads`},...keys.map(k=>({label:historyMetrics[k].label,value:`${m[k]} Leads`})),{label:'No-Show-Quote',value:m.total?`${m.no_show} / ${m.total} · ${new Intl.NumberFormat('de-DE',{maximumFractionDigits:1}).format(m.no_show/m.total*100)} %`:'—'}],note:'Eigene Monatsauswahl und damaliger Status am Monatsende bzw. Datenstand. Keine Addition der Vormonate.'};
  if(group.key==='customer')point.rows.pop();
  return `${rects}<text x="${left+(i+.5)*slot}" y="265" text-anchor="middle">${esc(m.label)}</text>${m.partial?`<text x="${left+(i+.5)*slot}" y="285" text-anchor="middle">bis Datenstand · unvollständig</text>`:''}<rect class="lead-history-hit" x="${left+i*slot}" y="${top}" width="${slot}" height="${plotH}" fill="transparent" tabindex="0" role="button" aria-label="${esc(m.label)}: Monatswerte ansehen" data-chart-point="${esc(JSON.stringify(point))}"/>`;
 }).join('');
 const grid=[...new Set(Array.from({length:5},(_,i)=>Math.round(peak*i/4)))].map(v=>`<line x1="${left}" x2="980" y1="${top+plotH-v/peak*plotH}" y2="${top+plotH-v/peak*plotH}" stroke="#304156"/><text x="38" y="${top+plotH-v/peak*plotH+4}" text-anchor="end">${v}</text>`).join('');
 return `${renderLegend(enabled,group.key)}<div class="lead-history-scroll"><svg class="lead-history-svg" viewBox="0 0 1000 ${h}" role="group" aria-label="Monatsvergleich ${esc(group.label)}"><text x="48" y="15">Anzahl Leads je Monat</text>${grid}${bars}</svg></div><p class="selection-basis">Jeder Monat separat · Status am jeweiligen Monatsende. Der laufende Monat endet am Datenstand. Neukunden zählen beim dokumentierten Wechsel zu „Verkauft – Neukunde“.</p>`;
}
function renderLegend(enabled,groupKey){return `<div class="lead-history-legend">${Object.entries(historyMetrics).filter(([key])=>groupKey!=='customer'||key==='sold').map(([key,m])=>`<label style="--series-color:${m.color}"><input type="checkbox" data-lead-chart-series="${key}" ${enabled.includes(key)?'checked':''}>${m.label}</label>`).join('')}</div>`;}
