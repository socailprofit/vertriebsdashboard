import {buildJourneyReport} from './verified-journey.mjs?v=2026-09-10-verified-journey';
export function uniqueLeads(group) { return [...new Map((group?.leads||[]).map(lead=>[lead.lead_id,lead])).values()]; }
export const NO_SHOW_STATUS_IDS = new Set(['stat_9z5zqirMleW4DbhYjsmZnV96jexVlXiYXU3yqIR8KzZ','stat_13rPYib4kw9kmCqcrcVNysFD028WcuKwxQjH6syd0w6']);
export function selectionPopulation(group) {
 const all=uniqueLeads(group),noShows=group?.key==='customer'?[]:all.filter(l=>NO_SHOW_STATUS_IDS.has(l.status_id));
 const unknown=group?.key==='customer'?[]:all.filter(l=>!l.status_id);
 const excluded=new Set([...noShows,...unknown].map(l=>l.lead_id));
 return {all,noShows,unknown,relevant:all.filter(l=>!excluded.has(l.lead_id))};
}

export function filterLeadReport(report,filters={}) {
 if(report?.activity_history)return buildJourneyReport(report,filters);
 if(!report?.groups)return report;
 return {...report,groups:report.groups.map(group=>{
  const leads=uniqueLeads(group).filter(lead=>{
   const d=lead.dimensions||{};
   return (!filters.employee || (d[`${filters.role||'owner'}_id`]||'__missing__')===filters.employee)
    && (!filters.source || (d.lead_source||'__missing__')===filters.source)
    && (!filters.industry || (d.industry||'__missing__')===filters.industry)
    && (!filters.status || (lead.status_id||'__missing__')===filters.status);
  });
  return {...group,leads,total:leads.length,unfiltered_total:uniqueLeads(group).length};
 })};
}
