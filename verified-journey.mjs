// Shared deterministic reporting model. No current status is replayed into history.
export const STATUS = Object.freeze({
 setting:'stat_Bo9KBFViTrdAlKxJaSblfNcnB90ikOzf5g4ARS82mXb',
 closing:'stat_v6fo1NvqjwqsIIzUS9kNDGVIJVfcDxTxYDXwpqE4gpn',
 cc2:'stat_ohblHuUMB0T7CwMfQSZhu0xWc2GDGaOEtCYOHeMMA6c',
 customer:'stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory',
 disqualified:'stat_P1L8WuHSs14kYHbMuTRYQtuD98mjJIXMn9dnQNmEWCT',
});
export const PEOPLE = Object.freeze([
 {value:'user_thRspTxlj3UlN5P4ALk2vGwdSh2KlFxPth8OldN3pq4',label:'Felix'},
 {value:'user_PtDJ2ZbYSQx82Dht5CRc2QBLcDfRjvXKjQuOi1N5lzy',label:'Michael'},
 {value:'user_0ppgt8ZGdSGuoTvR7KE4UZPUqP6OJhLmQOkxizfacgR',label:'Anthony'},
 {value:'linkedin',label:'LinkedIn'},
]);
export function assignment(dimensions={},role='owner') {
 if(dimensions.backoffice_id==='linkedin' && dimensions.backoffice_basis && role==='assignment')return 'linkedin';
 const id=dimensions[(role==='assignment'?'owner':role)+'_id'];
 return PEOPLE.some(p=>p.value===id)?id:null;
}
export function personLabel(id,fallback) {
 return PEOPLE.find(p=>p.value===id)?.label || (fallback ? 'Ehemalig / nicht zugeordnet' : 'Nicht gepflegt');
}
export function matchesLead(lead,filters={}) {
 const d=lead.dimensions||{};
 return (!filters.employee || (filters.employee==='linkedin'
  ? d.backoffice_id==='linkedin' && !!d.backoffice_basis
  : (d[(filters.role||'owner')+'_id']||'__missing__')===filters.employee))
 && (!filters.source || (d.lead_source||'__missing__')===filters.source)
 && (!filters.industry || (d.industry||'__missing__')===filters.industry)
 && (!filters.status || (lead.status_id||'__missing__')===filters.status);
}
const ms=Date.parse;
const unique=rows=>{const m=new Map();for(const r of rows)if(!m.has(r.lead_id))m.set(r.lead_id,r);return [...m.values()];};
const byTime=(a,b)=>ms(a.at)-ms(b.at)||a.id.localeCompare(b.id);
export function journeyFacts(report) {
 const end=ms(report.activity_end), all=report.activity_history||[], facts=[];
 const push=(e,key,at=e.occurred_at)=>facts.push({lead_id:e.lead_id,key,at,id:e.source_event_id,kind:e.source_kind});
 const events=all.filter(e=>ms(e.occurred_at)<end&&ms(e.recorded_at)<end).sort((a,b)=>ms(a.occurred_at)-ms(b.occurred_at)||a.source_event_id.localeCompare(b.source_event_id));
 const priorCC2=new Map(),firstWon=new Map();
 for(const e of events) {
  if(e.source_kind==='lead_status_change') {
   if(e.status_id===STATUS.customer) {
    const old=firstWon.get(e.lead_id);
    if(!old||ms(e.recorded_at)<ms(old.recorded_at))firstWon.set(e.lead_id,e);
   }
   if(e.status_id===STATUS.closing)priorCC2.delete(e.lead_id);
   if(e.status_id===STATUS.disqualified)push(e,'lost',e.recorded_at);
   if(e.status_id==='stat_9z5zqirMleW4DbhYjsmZnV96jexVlXiYXU3yqIR8KzZ')push(e,'setter_no_show',e.recorded_at);
   if(e.status_id==='stat_13rPYib4kw9kmCqcrcVNysFD028WcuKwxQjH6syd0w6')push(e,'closer_no_show',e.recorded_at);
   continue;
  }
  if(e.publication_status!=='published')continue;
  if(e.event_type==='setter_activity') {
   push(e,'setter_show');
   if(e.setter_result==='✅ Closer terminiert')push(e,'qualified');
   if(e.setter_result==='❌ Disqualifiziert')push(e,'lost');
   if(e.setter_result==='🔎 Setter Follow Up')push(e,'followup');
  }
  if(e.event_type==='closer_activity') {
   const r=e.closer_result;
   if(r==='3. ✅ Verkauft - in CC2 🔥') {push(e,'cc2_show');push(e,'sold_cc2_evidence');}
   else if(r==='1. ✅ Verkauft - in CC1') {push(e,'cc1_show');push(e,'sold_cc1_evidence');}
   else if(r==='2. 🔥 CC2 vereinbart') {push(e,'cc1_show');push(e,'cc2_agreed');priorCC2.set(e.lead_id,e);}
   else {
    push(e,priorCC2.has(e.lead_id)?'cc2_show':'closer_unstaged');
    // "Nicht verkauft" is an unsuccessful attempt, not a final loss.
    if(r==='4. ❌ Nicht verkauft')push(e,'followup');
   }
  }
  if(e.event_type==='attendance_activity') {
   if(e.setter_no_show==='Nicht erschienen')push(e,'setter_no_show');
   if(e.closer_no_show==='Nicht erschienen')push(e,'closer_no_show');
  }
 }
 for(const e of firstWon.values())push(e,'customer',e.recorded_at);
 for(const m of report.calendar||[]) {
  if(ms(m.starts_at)>=end)continue;
  const e={lead_id:m.lead_id,source_event_id:m.meeting_id,source_kind:'meeting',occurred_at:m.starts_at};
  if(m.stage==='setter')push(e,'setting');
  // A uniquely matched performed calendar event also proves the call stage.
  if(m.outcome==='attended'&&m.stage==='closer')push(e,'cc1_show');
  if(m.outcome==='attended'&&m.stage==='cc2')push(e,'cc2_show');
 }
 return facts.sort(byTime);
}
export const METRICS=Object.freeze({
 setting:{label:'Setting · belegter Verlauf',color:'#79a2ff',unit:'Leads'},
 closing:{label:'CC1 · belegter Verlauf',color:'#e7a14c',unit:'Leads'},
 setter_show:{label:'Setting · Monatsaktivität',color:'#8dc5ff',unit:'Leads'},
 cc1_show:{label:'CC1 · Monatsaktivität',color:'#f3bf69',unit:'Leads'},
 cc2_show:{label:'Closer Call 2',color:'#c09bff',unit:'Leads'},
 customer:{label:'Neukunden',color:'#5dd6b0',unit:'Leads'},
 setter_no_show:{label:'Setting No Shows',color:'#ff8d9d',unit:'Leads'},
 closer_no_show:{label:'Closing No Shows',color:'#ed709a',unit:'Leads'},
 cc2_agreed:{label:'CC2 vereinbart',color:'#a29cff',unit:'Leads'},
});
export const DEFAULT_METRICS=['setting','closing','setter_show','cc1_show','cc2_show','customer'];
export function metricFacts(facts,key,start,end) {
 const rows=facts.filter(f=>f.key===key&&ms(f.at)>=ms(start)&&ms(f.at)<ms(end));
 return key==='setting'?[...new Map(rows.map(r=>[r.id,r])).values()]:unique(rows);
}
export function statusAt(report,leadId,end) {
 const history=(report.activity_history||[]).filter(e=>e.lead_id===leadId&&e.source_kind==='lead_status_change').sort((a,b)=>ms(a.recorded_at)-ms(b.recorded_at)||a.source_event_id.localeCompare(b.source_event_id));
 const before=history.filter(e=>ms(e.recorded_at)<ms(end));
 if(before.length)return before.at(-1).status_id;
 // A later recorded transition establishes the preceding state, never today's status.
 return history.find(e=>ms(e.recorded_at)>=ms(end))?.previous_status||null;
}
export function selectedCohort(report,key,start,end) {
 const status=STATUS[key];
 const events=(report.activity_history||[]).filter(e=>e.source_kind==='lead_status_change'&&e.previous_status===status&&ms(e.recorded_at)>=ms(start)&&ms(e.recorded_at)<ms(end))
 .sort((a,b)=>ms(a.recorded_at)-ms(b.recorded_at)||a.source_event_id.localeCompare(b.source_event_id));
 return unique(events).map(e=>({lead_id:e.lead_id,at:e.recorded_at,id:e.source_event_id,kind:e.source_kind,status_id:statusAt(report,e.lead_id,end),evidence:events.filter(x=>x.lead_id===e.lead_id).map(x=>({at:x.recorded_at,id:x.source_event_id,kind:x.source_kind}))}));
}
function withPhaseEntries(report,key,cohort) {
 return cohort.map(c=>{
  const entries=report.activity_history.filter(e=>e.lead_id===c.lead_id&&e.source_kind==='lead_status_change'&&e.status_id===STATUS[key]&&ms(e.recorded_at)<=ms(c.at)).sort((a,b)=>ms(a.recorded_at)-ms(b.recorded_at));
  return {...c,at:entries.at(-1)?.recorded_at||c.at,entry_known:entries.length>0};
 });
}
const NO_SHOW=new Set(['stat_9z5zqirMleW4DbhYjsmZnV96jexVlXiYXU3yqIR8KzZ','stat_13rPYib4kw9kmCqcrcVNysFD028WcuKwxQjH6syd0w6']);
// One retrospective population: source exits in the period plus actual CC2
// activity and first acquisition. New bookings alone never select a lead.
export function pipelineCohort(report,start,end) {
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(start)).map(p=>[p.type,p.value]));
 const utcStart=parts.year+'-'+parts.month+'-'+parts.day+'T00:00:00Z';
 const endParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(end)).map(p=>[p.type,p.value]));
 const utcEnd=endParts.hour==='00'&&endParts.minute==='00'&&endParts.second==='00'?new Date(Math.min(ms(endParts.year+'-'+endParts.month+'-'+endParts.day+'T00:00:00Z'),ms(report.data_as_of))).toISOString():end;
 const seeds=[...selectedCohort(report,'setting',utcStart,utcEnd),...selectedCohort(report,'closing',start,end),...metricFacts(report.facts,'cc2_show',start,end),...metricFacts(report.facts,'customer',start,end)].sort(byTime);
 return withPhaseEntries(report,'setting',unique(seeds)).filter(c=>!report.facts.some(f=>f.lead_id===c.lead_id&&f.key==='customer'&&ms(f.at)<ms(start))).map(c=>{
  const closingEntry=report.activity_history.filter(e=>e.lead_id===c.lead_id&&e.source_kind==='lead_status_change'&&e.status_id===STATUS.closing&&ms(e.recorded_at)<=ms(c.at)).sort((a,b)=>ms(a.recorded_at)-ms(b.recorded_at)).at(-1);
  const anchor=c.entry_known?c.at:closingEntry?.recorded_at||c.at;
  const facts=report.facts.filter(f=>f.lead_id===c.lead_id&&ms(f.at)>=ms(anchor)&&ms(f.at)<ms(end));
  const first=key=>facts.find(f=>f.key===key)||null;
  const setter=first('setter_show'),cc1=first('cc1_show'),cc2=first('cc2_show'),customer=first('customer');
  const qualified=setter?report.activity_history.find(e=>e.lead_id===c.lead_id&&e.source_kind==='lead_status_change'&&e.status_id===STATUS.closing&&ms(e.recorded_at)>=ms(setter.at)&&ms(e.recorded_at)<ms(end)):null;
  return {...c,setter,cc1,cc2,customer,qualified,facts};
 });
}
const pipelineStage={setting:'setter',closing:'cc1',cc2_show:'cc2',customer:'customer'};
export function metricEntries(report,key,start,end) {
 if(Object.hasOwn(pipelineStage,key))return pipelineCohort(report,start,end).flatMap(c=>{
  const proof=c[pipelineStage[key]];
  // A first acquisition remains visible even if its older Setting proof is missing.
  return proof?[{...c,...proof,evidence:[...(c.evidence||[]),proof]}]:[];
 });
 return metricFacts(report.facts,key,start,end);
}
export function buildJourneyReport(raw,filters={}) {
 if(!raw?.activity_history)return raw;
 const leads=(raw.leads||[]).filter(l=>matchesLead(l,filters)),ids=new Set(leads.map(l=>l.lead_id));
 const report={...raw,leads,activity_history:raw.activity_history.filter(e=>ids.has(e.lead_id)),calendar:(raw.calendar||[]).filter(m=>ids.has(m.lead_id))};
 report.facts=journeyFacts(report);
 report.references=(raw.groups||[]).map(g=>({...g,leads:(g.leads||[]).filter(l=>ids.has(l.lead_id))}));
 report.groups=[['setting','Setting','setting'],['closing','Closer Call 1','closing'],['cc2','Closer Call 2','cc2_show'],['customer','Neukunden','customer']].map(([key,label,metric])=>{
  const entries=metricEntries(report,metric,raw.activity_start,raw.activity_end);
  const reference=report.references.find(g=>g.key===key);
  const cohort=pipelineCohort(report,raw.activity_start,raw.activity_end);
  const groupLeads=unique(entries).map(f=>{
   const evidence=entries.filter(x=>x.lead_id===f.lead_id).flatMap(x=>x.evidence||[x]);
   return {...leads.find(l=>l.lead_id===f.lead_id),first_recorded_at:evidence[0].at,last_recorded_at:evidence.at(-1).at,matching_events:evidence.length,evidence};
  });
  return {key,label,metric,total:entries.length,leads:groupLeads,cohort,source_total:cohort.length,
   no_show_count:cohort.filter(l=>NO_SHOW.has(l.status_id)).length,
   selection_start:reference?.selection_start||raw.activity_start,selection_end:reference?.selection_end||raw.activity_end,time_zone:reference?.time_zone||'Europe/Berlin',verified:true};
 });
 report.rates=cohortRates(report);
 return report;
}
function cohortRates(report) {
 const cohort=pipelineCohort(report,report.activity_start,report.activity_end),end=report.activity_end,rows=[];
 const setting=cohort.filter(c=>c.setter),cc1=cohort.filter(c=>c.cc1),cc2=cohort.filter(c=>c.cc2);
 const linked=(population,from,to)=>population.filter(c=>c[to]&&ms(c[to].at)>=ms(c[from].at));
 const add=(key,label,numerator,denominator,basis,missing=denominator.filter(c=>!c.entry_known).length)=>rows.push({key,label,numerator,denominator,missing,basis:basis+(missing?' Für '+missing+' Leads fehlt '+(key==='cc2_customer'?'ein CC2-Gesprächsnachweis':'der zugehörige Setting-Eintritt')+'; die Quote bleibt offen.':''),value:denominator.length&&!missing?numerator.length/denominator.length:null});
 const base='Gemeinsame rückblickende Leadgruppe mit Setting-/Closing-Statuswechsel, dokumentiertem CC2 oder erstem Neukundenereignis im Zeitraum; Verlauf seit dem zugehörigen Setting-Eintritt, einschließlich Vormonaten.';
 const closingPopulation=cohort.filter(c=>c.qualified||c.cc1||c.facts.some(f=>f.key==='closer_no_show'));
 for(const [population,shown,prefix,label,noShowKey] of [[cohort,setting,'setter','Setting','setter_no_show'],[closingPopulation,cc1,'closer','CC1','closer_no_show']]) {
  add(prefix+'_show',label+' · belegte Showrate',shown,population,'Leads mit Gesprächsnachweis / ausgewertete Leads dieser Phase. '+base);
  add(prefix+'_no_show',label+' · belegte No-Show-Quote',population.filter(c=>c.facts.some(f=>f.key===noShowKey)),population,'Leads mit mindestens einem dokumentierten No Show / ausgewertete Leads dieser Phase. Mehrere Versuche können Show und No Show beim selben Lead ergeben. '+base);
  add(prefix+'_lost',label+' · Verlustquote',population.filter(c=>statusAt(report,c.lead_id,end)===STATUS.disqualified),population,'Am Zeitraumende ausdrücklich disqualifiziert / ausgewertete Leads dieser Phase. Follow-ups bleiben offen. '+base);
 }
 add('setting_handoff','Setting → Closing übergeben',setting.filter(c=>c.qualified),setting,'Nach dem belegten Setting dokumentierter Eintritt in Closing / dieselben Leads mit belegtem Setting. '+base);
 add('setting_cc1','Setting → CC1 durchgeführt',linked(setting,'setter','cc1'),setting,'Leads mit anschließendem belegtem CC1 / dieselben Leads mit belegtem Setting. '+base);
 add('cc1_cc2','CC1 → CC2 durchgeführt',linked(cc1,'cc1','cc2'),cc1,'Leads mit anschließendem belegtem CC2 / dieselben Leads mit belegtem CC1. CC2 ist optional. '+base);
 add('cc1_customer','CC1 → Neukunde',linked(cc1,'cc1','customer'),cc1,'Erster Neukunden-Statuswechsel nach CC1 / dieselben Leads mit belegtem CC1; beide Abschlusswege. '+base);
 const missingCC2=cohort.filter(c=>c.customer&&!c.cc2&&report.activity_history.some(e=>e.source_event_id===c.customer.id&&e.previous_status===STATUS.cc2)).length;
 add('cc2_customer','CC2 → Neukunde',linked(cc2,'cc2','customer'),cc2,'Erster Neukunden-Statuswechsel nach CC2 / dieselben Leads mit belegtem CC2. '+base,missingCC2);
 const direct=linked(cc1,'cc1','customer').filter(c=>c.facts.some(f=>f.key==='sold_cc1_evidence'&&ms(f.at)>=ms(c.cc1.at)&&ms(f.at)<=ms(c.customer.at))&&!c.facts.some(f=>f.key==='cc2_show'&&ms(f.at)>=ms(c.cc1.at)&&ms(f.at)<=ms(c.customer.at)));
 add('cc1_direct','Direktgewinn nach CC1',direct,cc1,'Expliziter Verkauf in CC1 plus erster Neukunden-Statuswechsel / dieselben Leads mit belegtem CC1. '+base);
 return rows;
}
export function monthlyBounds(report) {
 const [year,month]=report.period.start.split('-').map(Number);
 return Array.from({length:3},(_,i)=>{
  const d=new Date(Date.UTC(year,month-1+i,1));
  const start=berlinBoundary(d.getUTCFullYear(),d.getUTCMonth(),1);
  const next=berlinBoundary(d.getUTCFullYear(),d.getUTCMonth()+1,1);
  const end=Math.min(next,ms(report.activity_end));
  return {start:new Date(start).toISOString(),end:new Date(Math.max(start,end)).toISOString(),partial:end<next,label:new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric',timeZone:'UTC'}).format(d)};
 });
}
export function berlinBoundary(year,month,day) {
 const utc=Date.UTC(year,month,day);
 const offset=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Berlin',timeZoneName:'shortOffset'}).formatToParts(new Date(utc)).find(p=>p.type==='timeZoneName').value.match(/GMT([+-])(\d+)/);
 return utc-(offset?(offset[1]==='+'?1:-1)*Number(offset[2])*3600000:0);
}
