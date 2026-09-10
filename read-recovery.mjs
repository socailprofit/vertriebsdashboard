// Only idempotent reads may be retried. Authorization failures never use cached data.
export function readError(label,error={}) {
 const result=new Error(`${label}: ${error.message||'Abruf fehlgeschlagen'}`);
 Object.assign(result,{label,code:error.code,status:error.status,name:error.name||'Error'});
 return result;
}
export function isAccessError(error) {
 return [401,403].includes(Number(error?.status))||['42501','PGRST301','PGRST302','PGRST303'].includes(error?.code);
}
export function isTransientReadError(error) {
 if(isAccessError(error))return false;
 return [408,429,500,502,503,504].includes(Number(error?.status))
  ||['57014','55P03','40001','40P01'].includes(error?.code)
  ||/timeout|timed out|network|fetch|offline|abort|connection|verbindung/i.test(`${error?.name} ${error?.message}`);
}
export async function withRequestTimeout(request,timeoutMs=30000) {
 const controller=new AbortController();let timer;
 try {
  return await Promise.race([
   Promise.resolve().then(()=>request(controller.signal)),
   new Promise((_,reject)=>{timer=setTimeout(()=>{
    const error=Object.assign(new Error('Zeitlimit beim Abruf erreicht'),{name:'TimeoutError'});
    controller.abort(error);reject(error);
   },timeoutMs);}),
  ]);
 } finally {clearTimeout(timer);}
}
export async function readWithRetry(request,{attempts=2,delay=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 for(let attempt=0;;attempt++){
  try{return await request();}
  catch(error){if(attempt+1>=attempts||!isTransientReadError(error))throw error;await delay(400+Math.random()*400);}
 }
}

// One recovery/poll loop per page; hidden tabs do not create query storms.
export function createReadRecovery(run,{enabled=()=>true,visible=()=>true,setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now,pollMs=90000}={}) {
 let timer=null,failures=0,dirty=false,running=false,lastSuccess=0,stopped=false;
 function cancel(){if(timer!==null)clearTimer(timer);timer=null;}
 function schedule(ms){cancel();if(!stopped&&enabled()&&visible())timer=setTimer(flush,ms);}
 async function flush(){
  timer=null;if(stopped||!enabled()||!visible()||running)return;
  running=true;dirty=false;
  try{await run();}finally{running=false;if(dirty&&timer===null)schedule(1000);}
 }
 return {
  success(){stopped=false;failures=0;lastSuccess=now();schedule(pollMs);},
  failed(error){if(!isTransientReadError(error)){stopped=true;dirty=false;cancel();return;}stopped=false;dirty=true;schedule([3000,10000,30000,60000][Math.min(failures++,3)]);},
  resume(){stopped=false;this.signal();},
  signal(){dirty=true;if(!running)schedule(700+Math.random()*500);},
  visibilityChanged(){if(!visible())cancel();else if(dirty||now()-lastSuccess>=60000)this.signal();else schedule(pollMs);},
  stop(){stopped=true;dirty=false;failures=0;lastSuccess=0;cancel();},
 };
}
