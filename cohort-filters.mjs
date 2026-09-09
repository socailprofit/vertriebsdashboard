// Only aggregate counters cross the reporting API. Dates are Berlin calendar
// dates; bucket arithmetic is UTC to avoid browser timezone/DST drift.
export const PROCESS_ACTIVITY_KEYS = Object.freeze([
  'followup_contacts','further_followups','followup_appointments','followup_disqualified','followup_no_interest',
  'appointments','setter_calls','setter_qualified','setter_followups','setter_disqualified','setter_unrated',
  'setter_no_shows','setter_cancellations','setter_rescheduled','closer_no_shows','closer_cancellations','closer_rescheduled',
  'closer_calls','cc1_sales','cc2_sales','cc2_agreed','closer_lost','closer_unrated','new_customers',
  'setter_from_period_bookings','setter_from_prior_bookings','setter_without_booking',
  'cc2_calls','cc1_lost','cc2_lost','cc_unassigned_calls','closer_lost_unassigned','sales_after_prior_won'
]);
export function matchesAttribution(row, filters) {
  return (filters.source === 'all' || row.source === filters.source)
    && (filters.owner === 'all' || row.owner === filters.owner);
}
export function bookingBucket(date, scale = 'month') {
  if (!date) return null;
  const d = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime())) return null;
  if (scale === 'week') d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  else d.setUTCDate(1);
  return d.toISOString().slice(0,10);
}
export function bookingRange(source, selection, scale = 'month') {
  if (!selection || selection === 'period') return source.period;
  const start = bookingBucket(selection, scale);
  if (!start) return source.period;
  const d = new Date(start + 'T12:00:00Z');
  if (scale === 'week') d.setUTCDate(d.getUTCDate() + 6);
  else { d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); }
  return {start, end: d.toISOString().slice(0,10)};
}
export function aggregateCohortRows(rows) {
  const groups=new Map();
  for(const row of rows) {
    const id=JSON.stringify([row.source,row.owner]);
    const sum=groups.get(id) || {source:row.source,owner:row.owner};
    for(const [k,v] of Object.entries(row)) {
      if(['source','owner','booked_date'].includes(k))continue;
      if(v===null || sum[k]===null)sum[k]=null;
      else if(typeof v==='number')sum[k]=(sum[k] || 0)+v;
    }
    groups.set(id,sum);
  }
  return [...groups.values()];
}
export function selectCohort(source, filters, scale = 'month') {
  const chosen = bookingRange(source, filters.cohort, scale);
  const range = {...chosen,end:chosen.end < source.period.end ? chosen.end : source.period.end};
  const match = row => matchesAttribution(row, filters) && row.booked_date >= range.start && row.booked_date <= range.end;
  return {
    ...source,
    funnel_by_source: aggregateCohortRows((source.cohort_history || source.funnel_by_source || []).filter(match)),
    booking_cohort: aggregateCohortRows((source.booking_cohort_history || source.booking_cohort || []).filter(match)),
    cohort_range: range,
    cohort_complete: source.coverage?.history_complete === true || range.start >= source.coverage.retention_start,
  };
}
export function filteredActivity(source, filters) {
  if (!Array.isArray(source.activity_by_origin)) return null;
  return source.activity_by_origin.filter(row => matchesAttribution(row,filters))
    .reduce((sum,row) => {
      for (const key of PROCESS_ACTIVITY_KEYS) sum[key] += Number(row[key] || 0);
      return sum;
    }, Object.fromEntries(PROCESS_ACTIVITY_KEYS.map(key => [key,0])));
}
export function originGroups(source, filters, scale = 'month') {
  const groups = new Map();
  for (const row of source.activity_by_origin || []) {
    if (!matchesAttribution(row, filters)) continue;
    const key = bookingBucket(row.booked_date, scale) || 'unknown';
    const sum = groups.get(key) || {key, ...Object.fromEntries(PROCESS_ACTIVITY_KEYS.map(k=>[k,0]))};
    for (const k of PROCESS_ACTIVITY_KEYS) sum[k] += Number(row[k] || 0);
    groups.set(key,sum);
  }
  return [...groups.values()].filter(r=>r.setter_calls+r.closer_calls+r.cc2_agreed+r.new_customers>0)
    .sort((a,b)=>a.key.localeCompare(b.key));
}
