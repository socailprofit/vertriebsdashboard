// Use the existing protected report for both sides, including its import coverage.
const iso = d => d.toISOString().slice(0,10);
export function monthlyComparisonDates(referenceDate) {
 const [year,month,day]=referenceDate.split('-').map(Number);
 const monthEnd=new Date(Date.UTC(year,month,0)).getUTCDate();
 if(day===monthEnd)return null;
 const previousEnd=new Date(Date.UTC(year,month-1,0)).getUTCDate();
 const commonDay=Math.min(day,previousEnd);
 return {current:iso(new Date(Date.UTC(year,month-1,commonDay))),previous:iso(new Date(Date.UTC(year,month-2,commonDay))),days:commonDay};
}
export async function loadOpeningMonthly(loadReport,referenceDate,today) {
 const cutoff=referenceDate>today?today:referenceDate;
 const dates=monthlyComparisonDates(cutoff);
 const [rows,previous,current]=await Promise.all([
  loadReport(cutoff),dates?loadReport(dates.previous):[],
  dates&&dates.current!==cutoff?loadReport(dates.current):[],
 ]);
 if(!dates)return rows;
 return rows.map(row=>{
  if(!row.partial)return row;
  const before=previous.find(r=>r.slug===row.slug&&r.month_start===dates.previous.slice(0,7)+'-01');
  const after=dates.current===cutoff?row:current.find(r=>r.slug===row.slug&&r.month_start===row.month_start);
  return {...row,comparison:{previous:before,current:after,days:dates.days}};
 });
}
