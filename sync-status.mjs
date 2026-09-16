// Import state and browser connectivity are different: a successful page read
// must never make a failed or overdue CRM import look current.
export function syncImportState(syncRun, dataAsOf, now = Date.now()) {
 const age = dataAsOf ? now - Date.parse(dataAsOf) : NaN;
 if (syncRun?.status === 'failed') return { delayed: true, note: 'Letzter Import fehlgeschlagen' };
 if (syncRun?.status === 'running') {
  const duration = now - Date.parse(syncRun.started_at);
  return duration > 5 * 60_000
   ? { delayed: true, note: 'Import verzögert' }
   : { delayed: false, note: 'Neue Daten werden eingelesen' };
 }
 if (!Number.isFinite(age) || age > 10 * 60_000) return { delayed: true, note: 'Aktualisierung steht aus' };
 return { delayed: false, note: '' };
}
