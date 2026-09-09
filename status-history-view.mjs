import { escapeHtml as esc } from './render-security.mjs?v=2026-09-09-cc2-evidence-fix';

const integer=new Intl.NumberFormat('de-DE');
const decimal=new Intl.NumberFormat('de-DE',{maximumFractionDigits:1});
const dateTime=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'});
const partsFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const MAIN_STATUSES=Object.freeze([
  {key:'setting',label:'Setting',color:'#3b9dff'},
  {key:'closing',label:'Closing',color:'#9b8cff'},
  {key:'cc2',label:'CC2 Nachgespräch',color:'#f5a524'},
  {key:'offer',label:'Angebotsphase',color:'#4ac7df'},
  {key:'sold',label:'Verkauft · Neukunde',color:'#3ddc84'},
]);
const amount=n=>integer.format(Number(n)||0);
const empty='<p class="antony-analysis-empty">Statusdaten werden geladen …</p>';
const shortLabel=label=>String(label??'').replace(/^-+|-+$/g,'').trim();
const statusByKey=(report,key)=>(report?.statuses||[]).find(s=>s.metric_key===key);
const button=(key,direction,value,label)=>`<button type="button" class="status-count" data-status-detail="${esc(key)}" data-status-direction="${esc(direction)}" aria-label="${esc(label)}">${amount(value)} <span aria-hidden="true">↗</span></button>`;
const point=payload=>`data-chart-point="${esc(JSON.stringify(payload))}"`;
function localParts(at){const p=Object.fromEntries(partsFormat.formatToParts(new Date(at)).map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour),minute:Number(p.minute)};}
function shortDate(date){return `${date.slice(8,10)}.${date.slice(5,7)}.`;}

export function statusEvents(report,key='all',direction='entered',destination=null){
  const status=statusByKey(report,key);
  const start=report?.period?.start,cutoff=Date.parse(report?.cutoff);
  return (report?.events||[]).filter(e=>{
    const at=Date.parse(e.occurred_at);
    if(!Number.isFinite(at)||!Number.isFinite(cutoff)||at>cutoff||localParts(e.occurred_at).date<start)return false;
    return (key==='all'||(status && (direction==='left'?e.previous_status:e.new_status)===status.status_id)) && (!destination||e.new_status===destination);
  });
}

export function renderStatusCards(report){
  if(!report)return empty;
  return MAIN_STATUSES.map(s=>{
    const row=statusByKey(report,s.key);
    return `<button type="button" class="antony-activity" data-status-step="${s.key}" aria-label="${esc(s.label)}: ${amount(row?.entered_leads)} Leads hineingewechselt, ${amount(row?.left_leads)} hinausgewechselt, Übergänge anzeigen"><span>${esc(s.label)}</span><strong>${amount(row?.entered_leads)}</strong><span class="status-count-caption">Leads hineingewechselt</span><span class="status-card-exits">${amount(row?.left_leads)} hinausgewechselt</span><span class="activity-detail-icon" aria-hidden="true">↗</span></button>`;
  }).join('');
}

export function renderStatusTable(report){
  if(!report)return empty;
  return `<div class="chart-table-scroll"><table class="status-history-table"><thead><tr><th scope="col">Close-Status</th><th scope="col">Erreicht · Leads</th><th scope="col">Verlassen · Leads</th><th scope="col">Wechsel hinein</th><th scope="col">Wechsel heraus</th></tr></thead><tbody>${report.statuses.map(s=>`<tr><th scope="row">${esc(shortLabel(s.label))}</th><td>${button(s.metric_key,'entered',s.entered_leads,`${shortLabel(s.label)} erreicht: ${s.entered_leads} Leads`)}</td><td>${button(s.metric_key,'left',s.left_leads,`${shortLabel(s.label)} verlassen: ${s.left_leads} Leads`)}</td><td>${amount(s.entered_events)}</td><td>${amount(s.left_events)}</td></tr>`).join('')}</tbody></table></div><p class="chart-legend">„Erreicht“ und „Verlassen“ zählen jeden Lead je Status einmal. Die Wechsel zählen auch Wiederholungen.</p>`;
}

export function statusExits(report,key){
  const status=statusByKey(report,key);
  if(!status)return {status:null,denominator:0,rows:[],overlap:false};
  const outgoing=statusEvents(report,key,'left');
  const denominator=new Set(outgoing.map(e=>e.lead_id)).size;
  const groups=new Map();
  for(const e of outgoing){const g=groups.get(e.new_status)||{id:e.new_status,label:e.new_label,leads:new Set(),events:0};g.leads.add(e.lead_id);g.events++;groups.set(e.new_status,g);}
  const rows=[...groups.values()].map(g=>({...g,leads:g.leads.size,rate:denominator?100*g.leads.size/denominator:null})).sort((a,b)=>b.leads-a.leads||a.label.localeCompare(b.label));
  return {status,denominator,rows,overlap:rows.reduce((n,r)=>n+r.leads,0)>denominator};
}

export function renderStatusTransitions(report){
  if(!report)return empty;
  return `<p class="chart-legend">Anteil = Leads mit diesem Zielstatus ÷ alle Leads, die den jeweiligen Schritt im Zeitraum verlassen haben.</p><div class="status-transition-grid">${report.statuses.filter(s=>s.metric_key!=='sold').map(s=>{
    const exits=statusExits(report,s.metric_key);
    return `<details class="status-transition" data-status-step-panel="${s.metric_key}" ${['setting','closing','cc2'].includes(s.metric_key)?'open':''}><summary><span>${esc(shortLabel(s.label))}</span><b>${amount(exits.denominator)} weitergewechselt</b></summary>${exits.rows.length?exits.rows.map(r=>{
      const payload={title:`${shortLabel(s.label)} → ${shortLabel(r.label)}`,time:`${shortDate(report.period.start)} – ${shortDate(report.period.end)}`,rows:[{label:'Leads mit diesem Zielstatus',value:amount(r.leads)},{label:'Leads, die diesen Schritt verlassen haben',value:amount(exits.denominator)},{label:'Anteil',value:`${decimal.format(r.rate)} %`},{label:'Belegte Wechsel auf diesem Weg',value:amount(r.events)}],note:exits.overlap?'Ein Lead kann nach einem Rückwechsel mehrere Zielstatus erreichen. Die Anteile können sich deshalb überschneiden.':'Anteil an tatsächlich weitergewechselten Leads. Follow-up ist kein endgültiger Verlust.'};
      return `<div class="status-exit"><button type="button" class="status-exit-value" ${point(payload)}><span>${esc(shortLabel(r.label))}</span><b>${decimal.format(r.rate)} %</b><small>${amount(r.leads)} von ${amount(exits.denominator)} Leads</small><progress max="100" value="${r.rate}" aria-label="${esc(shortLabel(r.label))}: ${decimal.format(r.rate)} Prozent"></progress></button><button type="button" class="process-detail-toggle" data-status-detail="${esc(s.metric_key)}" data-status-direction="left" data-status-destination="${esc(r.id)}" aria-label="Belege: ${esc(shortLabel(s.label))} nach ${esc(shortLabel(r.label))}">Belege ↗</button></div>`;
    }).join(''):'<p>Keine belegten Ausgänge in diesem Zeitraum.</p>'}${exits.overlap?'<p class="status-overlap">Mehrfachwege: Einzelne Leads wechselten zurück und danach erneut weiter. Die Zielanteile überschneiden sich.</p>':''}</details>`;
  }).join('')}</div>`;
}

export const HANDOFF_RATES=Object.freeze([
 {key:'setting_forward',from:'setting',to:['closing','cc2','offer','sold'],label:'Setting → Closing-Prozess'},
 {key:'closing_cc2',from:'closing',to:['cc2'],label:'Closing → CC2'},
 {key:'cc2_sold',from:'cc2',to:['sold'],label:'CC2 → Verkauft'},
 {key:'offer_sold',from:'offer',to:['sold'],label:'Angebot → Verkauft'},
]);

export function handoffRate(report,rule){
 const exits=statusEvents(report,rule.from,'left');
 const ids=new Set(rule.to.map(key=>statusByKey(report,key)?.status_id).filter(Boolean));
 const numerator=new Set(exits.filter(e=>ids.has(e.new_status)).map(e=>e.lead_id)).size;
 const denominator=new Set(exits.map(e=>e.lead_id)).size;
 return {numerator,denominator,rate:denominator?100*numerator/denominator:null};
}

export function renderHandoffRates(report){
 if(!report)return empty;
 return `<div class="handoff-rate-grid">${HANDOFF_RATES.map(rule=>{
  const r=handoffRate(report,rule),value=r.rate===null?'—':`${decimal.format(r.rate)} %`;
  const destinations=rule.to.map(key=>shortLabel(statusByKey(report,key)?.label||key)).join(', ');
  const payload={title:rule.label,time:`${shortDate(report.period.start)} – ${shortDate(report.period.end)}`,rows:[{label:'Leads mit dieser Weitergabe',value:amount(r.numerator)},{label:'Leads, die den Ausgangsstatus verlassen haben',value:amount(r.denominator)},{label:'Weitergabequote',value}],note:`Direkte Wechsel nach: ${destinations}. Je Lead einmal; keine Division unabhängiger Eingangs- oder Gesprächszahlen.`};
  return `<div class="handoff-rate"><button type="button" ${point(payload)}><span>${esc(rule.label)}</span><strong>${value}</strong><small>${amount(r.numerator)} von ${amount(r.denominator)} ausgehenden Leads</small></button><button type="button" class="process-detail-toggle" data-status-step="${rule.from}">Alle Wege ↗</button></div>`;
 }).join('')}</div>`;
}

export function buildStatusTimeline(report){
  if(!report?.period || !report.cutoff)return [];
  const {start,end,type}=report.period;
  if(start>end)return [];
  const cutoff=localParts(report.cutoff);
  const events=statusEvents(report).sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at));
  const days=[];for(let day=start;day<=end && days.length<100;){days.push(day);const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);day=d.toISOString().slice(0,10);}
  const buckets=type==='day'?Array.from({length:cutoff.hour+1},(_,hour)=>({date:start,hour,label:`${String(hour).padStart(2,'0')}:00`})) : days.map(date=>({date,hour:23,label:shortDate(date)}));
  return buckets.map(b=>{const values={};for(const s of MAIN_STATUSES){const id=statusByKey(report,s.key)?.status_id;values[s.key]=new Set(events.filter(e=>e.new_status===id).filter(e=>{const p=localParts(e.occurred_at);return p.date<b.date||(p.date===b.date&&p.hour<=b.hour);}).map(e=>e.lead_id)).size;}return {...b,...values};});
}

export function renderStatusChart(report){
  if(!report)return empty;
  const rows=buildStatusTimeline(report);
  if(!rows.length)return '<p>Keine vergangenen Zeitpunkte in dieser Auswahl.</p>';
  const width=960,height=270,pad={left:38,right:16,top:18,bottom:34};
  const max=Math.max(4,Math.ceil(Math.max(...rows.flatMap(r=>MAIN_STATUSES.map(s=>r[s.key])))/4)*4);
  const x=i=>pad.left+i/Math.max(1,rows.length-1)*(width-pad.left-pad.right),y=n=>height-pad.bottom-n/max*(height-pad.bottom-pad.top);
  const grid=Array.from({length:5},(_,i)=>{const n=i*max/4;return `<g><line x1="${pad.left}" y1="${y(n)}" x2="${width-pad.right}" y2="${y(n)}"/><text x="${pad.left-8}" y="${y(n)+4}">${amount(n)}</text></g>`;}).join('');
  const lines=MAIN_STATUSES.map(s=>`<path d="${rows.map((r,i)=>`${i?'L':'M'}${x(i)} ${y(r[s.key])}`).join(' ')}" style="stroke:${s.color}"/>${rows.map((r,i)=>`<circle cx="${x(i)}" cy="${y(r[s.key])}" r="3" style="fill:${s.color}"/>`).join('')}`).join('');
  const w=(width-pad.left-pad.right)/Math.max(1,rows.length-1);
  const points=rows.map((r,i)=>{const cutoffParts=localParts(report.cutoff);const endTime=i===rows.length-1?`${String(cutoffParts.hour).padStart(2,'0')}:${String(cutoffParts.minute).padStart(2,'0')}`:`${String(r.hour+1).padStart(2,'0')}:00`;const time=report.period.type==='day'?`${shortDate(r.date)} ${r.label}–${endTime} Uhr`:`${shortDate(r.date)}${r.date===report.period.end?' · bis '+dateTime.format(new Date(report.cutoff))+' Uhr':''}`;const payload={title:'Erreichte Status',time,rows:MAIN_STATUSES.map(s=>({label:s.label,value:`${amount(r[s.key])} Leads`})),note:'Je Status einmal pro Lead · seit Beginn der Auswahl aufsummiert. Letzter Punkt nur bis zum ausgewiesenen Datenstand.'};const left=Math.max(pad.left,x(i)-w/2),right=Math.min(width-pad.right,x(i)+w/2);return `<rect class="chart-hit-area" x="${left}" y="${pad.top}" width="${right-left}" height="${height-pad.top-pad.bottom}" tabindex="0" role="button" aria-label="Werte anzeigen: ${esc(time)}" ${point(payload)}/>`;}).join('');
  const labels=rows.map((r,i)=>i===0||i===rows.length-1||i%Math.max(1,Math.ceil(rows.length/6))===0?`<text x="${x(i)}" y="${height-8}" text-anchor="${i===0?'start':i===rows.length-1?'end':'middle'}">${r.label}</text>`:'').join('');
  return `<div class="antony-performance-legend">${MAIN_STATUSES.map(s=>`<span><i style="background:${s.color}"></i>${esc(s.label)}<b>${amount(rows.at(-1)[s.key])}</b></span>`).join('')}</div><div class="chart-axis-copy"><span>Leads je Status · kumuliert</span><span>${report.period.type==='day'?'Uhrzeit':'Datum'} · Berlin</span></div><svg viewBox="0 0 ${width} ${height}" role="group" aria-label="Historische Statuswechsel im Zeitverlauf"><g class="antony-performance-grid">${grid}${labels}</g><g class="antony-performance-lines">${lines}</g>${points}</svg>`;
}

export function renderStatusEvidence(report,key='all',direction='entered',destination=null){
  if(!report)return empty;
  const rows=statusEvents(report,key,direction,destination).sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at));
  const s=statusByKey(report,key);
  return `<p class="status-evidence-heading">${s?esc(shortLabel(s.label))+' · '+(direction==='left'?'Ausgänge':'Eingänge'):'Alle Schritte'} · ${amount(rows.length)} belegte Wechsel · ${amount(new Set(rows.map(e=>e.lead_id)).size)} Leads</p>${rows.length?`<div class="chart-table-scroll"><table class="status-history-table"><thead><tr><th>Datum · Uhrzeit (Berlin)</th><th>Lead</th><th>Von</th><th>Nach</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${esc(dateTime.format(new Date(e.occurred_at)))} Uhr</td><td>${/^lead_[A-Za-z0-9]+$/.test(e.lead_id)?`<a href="https://app.close.com/lead/${encodeURIComponent(e.lead_id)}/" target="_blank" rel="noopener noreferrer">${esc(e.lead_name||e.lead_id)} ↗</a>`:esc(e.lead_name||e.lead_id)}</td><td>${esc(shortLabel(e.previous_label))}</td><td>${esc(shortLabel(e.new_label))}</td></tr>`).join('')}</tbody></table></div>`:'<p>Keine belegten Wechsel für diese Auswahl.</p>'}`;
}

export function statusPreview(date,type){
  const statuses=[...MAIN_STATUSES,{key:'setter_followup',label:'Setter Follow Up'},{key:'setter_no_show',label:'No Show - Setting'}].map((s,i)=>({status_id:`stat_preview${i}`,metric_key:s.key,label:s.label,sort_order:i,entered_leads:0,left_leads:0,entered_events:0,left_events:0}));
  const start=type==='day'?date:date.slice(0,8)+'01';
  const report={period:{start,end:date,type},cutoff:date+'T12:00:00Z',data_as_of:date+'T12:00:00Z',statuses,events:[],transitions:[],attendance_events:[]};
  const transitions=[['setting','closing'],['closing','cc2'],['cc2','sold'],['setting','setter_followup'],['setting','setter_no_show']];
  transitions.forEach(([from,to],i)=>{const a=statuses.find(s=>s.metric_key===from),b=statuses.find(s=>s.metric_key===to);report.events.push({source_event_id:`preview${i}`,lead_id:`lead_preview${i<3?'A':i}`,lead_name:'Beispielunternehmen',previous_status:a.status_id,new_status:b.status_id,previous_label:a.label,new_label:b.label,occurred_at:date+`T${String(7+i).padStart(2,'0')}:00:00Z`});});
  for(const s of statuses){const entered=report.events.filter(e=>e.new_status===s.status_id),left=report.events.filter(e=>e.previous_status===s.status_id);s.entered_leads=new Set(entered.map(e=>e.lead_id)).size;s.left_leads=new Set(left.map(e=>e.lead_id)).size;s.entered_events=entered.length;s.left_events=left.length;}
  [['setter','show','✅ Closer terminiert'],['setter','no_show','Nicht erschienen'],['setter','cancelled','⛔ Abgesagt'],['closer','show','2. 🔥 CC2 vereinbart']].forEach(([stage,outcome,result],i)=>report.attendance_events.push({source_event_id:`attendance_preview${i}`,lead_id:`lead_preview${i}`,lead_name:'Beispielunternehmen',stage,outcome,result,occurred_at:date+`T${String(7+i).padStart(2,'0')}:00:00Z`}));
  return report;
}
