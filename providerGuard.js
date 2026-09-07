const realFetch = globalThis.fetch;
const cache = new Map();
let active = 0;
const queue = [];
const MAX_ACTIVE = 3;
const CACHE_MS = 20000;

function release(){ active=Math.max(0,active-1); const next=queue.shift(); if(next) next(); }
function acquire(){ return new Promise(resolve=>{ if(active<MAX_ACTIVE){ active++; resolve(); } else queue.push(()=>{active++;resolve();}); }); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function guardedFetch(input, init={}){
  const url = typeof input==='string' ? input : input?.url || String(input);
  const isBiquote = url.includes('biquote.io/api/');
  if(!isBiquote) return realFetch(input, init);

  const key=url;
  const hit=cache.get(key);
  if(hit && Date.now()-hit.at<CACHE_MS){
    return new Response(hit.body,{status:hit.status,headers:hit.headers});
  }

  await acquire();
  try{
    let lastErr;
    for(let attempt=0;attempt<3;attempt++){
      try{
        const r=await realFetch(input, init);
        const body=await r.text();
        const headers={}; r.headers.forEach((v,k)=>headers[k]=v);
        if(r.ok){
          cache.set(key,{at:Date.now(),body,status:r.status,headers});
          return new Response(body,{status:r.status,headers});
        }
        lastErr=new Error('Biquote HTTP '+r.status);
        if(r.status!==429 && r.status<500) return new Response(body,{status:r.status,headers});
      }catch(e){ lastErr=e; }
      await sleep(180*(attempt+1));
    }
    const stale=cache.get(key);
    if(stale) return new Response(stale.body,{status:stale.status,headers:stale.headers});
    throw lastErr || new Error('Biquote unavailable');
  } finally { release(); }
}

globalThis.fetch = guardedFetch;
