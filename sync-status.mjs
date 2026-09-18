// Import state and browser connectivity are different: a successful page read
// must never make a failed or overdue CRM import look current.
const berlinTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function isSyncTime(at) {
 const p=Object.fromEntries(berlinTime.formatToParts(new Date(at)).map(x=>[x.type,x.value]));
 const minute=Number(p.hour)*60+Number(p.minute);
 return !['Sat','Sun'].includes(p.weekday)&&minute>=450&&minute<=1020;
}
// Match the live cron: Mo–Fr 07:30 through the final 17:00 tick, Berlin time.
export function nextSyncAt(now=Date.now()) {
 let at=(Math.floor(now/300000)+1)*300000;
 while(!isSyncTime(at))at+=300000;
 return at;
}
export function nextSyncLabel(now=Date.now()) {
 const next=nextSyncAt(now),minutes=Math.ceil((next-now)/60000);
 return minutes<=5?`nächster Lauf in ~${minutes} Min`:
  `nächster Lauf ${new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',weekday:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(next))} Uhr`;
}
export function syncImportState(syncRun, dataAsOf, now = Date.now()) {
 const age = dataAsOf ? now - Date.parse(dataAsOf) : NaN;
 if (syncRun?.status === 'failed') return { delayed: true, note: 'Letzter Import fehlgeschlagen' };
 if (syncRun?.status === 'running') {
  const duration = now - Date.parse(syncRun.started_at);
  return duration > 5 * 60_000
   ? { delayed: true, note: 'Import verzögert' }
   : { delayed: false, note: 'Neue Daten werden eingelesen' };
 }
 let lastExpected=Math.floor(now/300000)*300000;
 while(!isSyncTime(lastExpected))lastExpected-=300000;
 const cutoff=(isSyncTime(now)?now:lastExpected)-10*60_000;
 if (!Number.isFinite(age) || Date.parse(dataAsOf)<cutoff) return { delayed: true, note: 'Aktualisierung steht aus' };
 if(!isSyncTime(now))return {delayed:false,note:'Abrufpause'};
 return { delayed: false, note: '' };
}
