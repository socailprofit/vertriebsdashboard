import {escapeHtml as esc} from './render-security.mjs?v=2026-09-10-lead-quality';
import {uniqueLeads,NO_SHOW_STATUS_IDS} from './lead-selection-model.mjs?v=2026-09-10-lead-quality';
const FOLLOWUPS=new Set(['stat_8ugtaHvwvKH3hIELdeQUqwUExa4Hn4ipsYQUuRvEfAm','stat_d9hxREiCT5xmQHv7HbfzeyBmeVHoZYUzkMXuwzPiIve','stat_SPNvi34PmlJBYNre2CJh12Yc78H6si1jYvNyhxarxwS']);
const CC2='stat_ohblHuUMB0T7CwMfQSZhu0xWc2GDGaOEtCYOHeMMA6c',SOLD='stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory';
export const historyMetrics={relevant:{label:'Relevant ohne No Show',color:'#79a2ff'},no_show:{label:'No Shows',color:'#ff8d9d'},followup:{label:'Follow-ups',color:'#f3bf69'},cc2:{label:'CC2',color:'#c09bff'},sold:{label:'Status verkauft',color:'#5dd6b0'}};
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
   if(FOLLOWUPS.has(id))v.followup++;if(id===CC2)v.cc2++;if(id===SOLD)v.sold++;
  }
  return v;
 });
}
export function renderHistoryChart(report,group,enabled=['relevant','no_show','cc2','sold']) {
 const series=buildHistorySeries(report,group),keys=Object.keys(historyMetrics).filter(k=>enabled.includes(k));
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
  if(p.unknown)rows.push({label:'Historischer Status ungeklärt',value:`${p.unknown} Leads`});
  const point={title:`${group.label} · damaliger Status`,time:fmt.format(new Date(p.at))+' Uhr',rows,note:'Stand aus protokollierten Statuswechseln. Filter beziehen sich auf heutige CRM-Felder.'};
  const a=i?(x(series[i-1].at)+x(p.at))/2:left,b=i<series.length-1?(x(p.at)+x(series[i+1].at))/2:w-right;
  return `<rect class="lead-history-hit" x="${a}" y="${top}" width="${Math.max(1,b-a)}" height="${plotH}" fill="transparent" tabindex="0" role="button" aria-label="Werte am ${esc(point.time)}" data-chart-point="${esc(JSON.stringify(point))}"/>`;
 }).join('');
 return `<div class="lead-history-legend">${Object.entries(historyMetrics).map(([key,m])=>`<label style="--series-color:${m.color}"><input type="checkbox" data-lead-chart-series="${key}" ${enabled.includes(key)?'checked':''}>${m.label}</label>`).join('')}</div><div class="lead-history-scroll"><svg class="lead-history-svg" viewBox="0 0 ${w} ${h}" aria-label="${esc(group.label)}: Entwicklung in Leads" role="group"><text x="${left}" y="15">Anzahl Leads</text>${grid}${paths}${ticks}${points}</svg></div><p class="selection-basis">Damals protokollierter Status · Uhrzeit Europe/Berlin. No Shows sind separat; CC2, Follow-ups und Verkäufe sind Teil der relevanten Leads. Ein Klick zeigt den genauen Stand. Bei historischen Zeiträumen kann dieser von den heutigen Statuskarten abweichen.</p>`;
}
