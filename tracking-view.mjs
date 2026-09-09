const monthOf=value=>value?new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit"}).format(new Date(value)):null;
export const TRACKING_MEMBERS = {michael:'Michael',felix:'Felix',antony:'Antony',linkedin:'LinkedIn · Backoffice'};
export function originTotals(rows, key) {
  if(!Array.isArray(rows))return null;
  const totals={};
  for(const row of rows){const count=Number(row[key]||0);if(!count)continue;const month=row.booked_date?.slice(0,7)||'unknown';totals[month]=(totals[month]||0)+count;}
  return Object.entries(totals).sort(([a],[b])=>a.localeCompare(b));
}
export function memberResults(rows) {
 const members={...TRACKING_MEMBERS};
 for(const row of rows) {const owner=row.owner||'unassigned';if(!members[owner])members[owner]=owner==='outside_current_team'?'Anderer Opener':'Nicht zugeordnet';}
 return Object.entries(members).map(([owner,label])=>{
  const leads=rows.filter(r=>(r.owner||'unassigned')===owner);
  return {owner,label,leads:leads.length,setter:leads.filter(r=>r.setter_at).length,closer:leads.filter(r=>r.closer_at).length,
   qualified:leads.filter(r=>r.setter_result==='setter_qualified').length,followup:leads.filter(r=>r.setter_result==='setter_follow_up').length,
   disqualified:leads.filter(r=>r.setter_result==='setter_disqualified').length,customers:leads.filter(r=>r.won_at).length,
   laterSetter:leads.filter(r=>r.setter_at&&monthOf(r.setter_at)>monthOf(r.first_meeting_at)).length,
   laterCloser:leads.filter(r=>r.closer_at&&monthOf(r.closer_at)>monthOf(r.first_meeting_at)).length};
 });
}
