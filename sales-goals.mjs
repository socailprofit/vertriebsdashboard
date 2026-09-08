// Calendar goals use Monday–Friday. Public holidays are not subtracted.
export function workdaysBetween(start, end) {
  if (!start || !end || end < start) return 0;
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(last.getTime())) return 0;
  let count = 0;
  while (cursor <= last) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function goalPeriodRange(period, referenceDate) {
  const start = new Date(`${referenceDate}T12:00:00Z`);
  if (!Number.isFinite(start.getTime())) return { start: null, end: null };
  const end = new Date(start);
  if (period === "month") {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  } else if (period === "week") {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 4);
  }
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function salesTargetForRange(targets, personIds, column, range) {
  if (!column || !range?.start || !range?.end) return null;
  const ids = new Set(Array.isArray(personIds) ? personIds : [personIds]);
  const isRate = column.endsWith("_target");
  const rates = [];
  let total = 0;
  let found = false;
  for (const target of targets) {
    if (!ids.has(target.sales_person_id)) continue;
    const value = target[column];
    if (value === null || value === undefined || !Number.isFinite(Number(value))) continue;
    const start = target.period_start > range.start ? target.period_start : range.start;
    const end = target.period_end < range.end ? target.period_end : range.end;
    if (end < start) continue;
    if (isRate) { rates.push(Number(value)); continue; }
    const days = workdaysBetween(target.period_start, target.period_end);
    if (!days) continue;
    total += Number(value) * workdaysBetween(start, end) / days;
    found = true;
  }
  if (isRate) return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  return found && Math.round(total) > 0 ? Math.round(total) : null;
}

// 150 calls per weekday = green; 100 of those 150 = amber. Compare with the
// elapsed weekday goal, never a full future month, to colour today's progress.
export function grossCallPerformanceClass(value, elapsedTarget) {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || !elapsedTarget) return "is-neutral";
  if (Number(value) >= elapsedTarget) return "is-strong";
  if (Number(value) * 3 >= elapsedTarget * 2) return "is-ok";
  return "is-weak";
}
