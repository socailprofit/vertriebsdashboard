// A reconciliation emits many row changes. Refresh once after the burst and
// never run concurrent background refreshes. A later change is not dropped.
export function createUpdateScheduler(onChange, {delayMs=1000, setTimer=setTimeout, clearTimer=clearTimeout}={}) {
  let timer=null, running=false, dirty=false, disposed=false;
  function schedule() {
    if(timer!==null)clearTimer(timer);
    timer=setTimer(flush,delayMs);
  }
  async function flush() {
    timer=null;
    if(disposed || running)return;
    running=true;dirty=false;
    try { await onChange(); }
    finally {
      running=false;
      if(!disposed && dirty)schedule();
    }
  }
  return {
    signal() { if(disposed)return;dirty=true;if(!running)schedule(); },
    dispose() { disposed=true;dirty=false;if(timer!==null)clearTimer(timer);timer=null; },
  };
}
