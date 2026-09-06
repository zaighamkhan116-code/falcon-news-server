import "dotenv/config";
import cors from "cors";
import express from "express";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAIRS = ["EURUSD","EURJPY","GBPUSD","USDJPY","XAUUSD","AUDJPY","AUDUSD"];
const TFS = ["1m","2m","5m","15m","1h"];
const BIQUOTE = new Set(["EURUSD","EURJPY","GBPUSD","USDJPY","AUDJPY","AUDUSD"]);
const SYMBOLS = {EURUSD:"EUR/USD",EURJPY:"EUR/JPY",GBPUSD:"GBP/USD",USDJPY:"USD/JPY",AUDJPY:"AUD/JPY",AUDUSD:"AUD/USD",XAUUSD:"XAU/USD"};

function norm(a){
  return a.map(x=>({time:Number(x.time??new Date(x.openTime).getTime()),open:+x.open,high:+x.high,low:+x.low,close:+x.close}))
    .filter(x=>[x.time,x.open,x.high,x.low,x.close].every(Number.isFinite))
    .sort((a,b)=>a.time-b.time);
}
function agg(a,m){
  const s=m*60000,b=new Map();
  for(const x of a){const k=Math.floor(x.time/s)*s;if(!b.has(k))b.set(k,[]);b.get(k).push(x)}
  return [...b].map(([time,r])=>({time,open:r[0].open,high:Math.max(...r.map(x=>x.high)),low:Math.min(...r.map(x=>x.low)),close:r.at(-1).close}));
}
async function biq(p,t,l){
  const iv=t==="2m"?"1m":t,u=new URL(`https://biquote.io/api/${p}/ohlc`);
  u.searchParams.set("interval",iv);u.searchParams.set("limit",String(Math.min(1000,t==="2m"?l*2:l)));
  const r=await fetch(u,{signal:AbortSignal.timeout(7000)}),j=await r.json();
  if(!r.ok||!Array.isArray(j?.bars))throw Error("Biquote unavailable");
  const z=norm(j.bars);return t==="2m"?agg(z,2).slice(-l):z.slice(-l);
}
async function td(p,t,l){
  const k=process.env.TWELVE_DATA_API_KEY;if(!k)throw Error("Twelve Data key not configured");
  const iv={"1m":"1min","2m":"1min","5m":"5min","15m":"15min","1h":"1h"}[t],u=new URL("https://api.twelvedata.com/time_series");
  u.searchParams.set("symbol",SYMBOLS[p]);u.searchParams.set("interval",iv);u.searchParams.set("outputsize",String(Math.min(1000,t==="2m"?l*2:l)));u.searchParams.set("timezone","UTC");u.searchParams.set("apikey",k);
  const j=await (await fetch(u,{signal:AbortSignal.timeout(9000)})).json();
  if(!Array.isArray(j?.values))throw Error(j?.message||"Twelve Data unavailable");
  const z=norm(j.values.map(v=>({...v,time:new Date(String(v.datetime).replace(" ","T")+"Z").getTime()})));
  return t==="2m"?agg(z,2).slice(-l):z.slice(-l);
}
async function candles(p,t,l=800){
  if(BIQUOTE.has(p)){try{return{rows:await biq(p,t,l),source:"BIQUOTE"}}catch{return{rows:await td(p,t,l),source:"TWELVE_DATA_FALLBACK"}}}
  return{rows:await td(p,t,l),source:"TWELVE_DATA"};
}
const atr=q=>q.slice(-14).reduce((s,c)=>s+c.high-c.low,0)/Math.min(14,q.length);
function falcon(q,p,t){
  const x=q.at(-1),a=atr(q),r=q.slice(-21,-1),ph=Math.max(...r.map(c=>c.high)),pl=Math.min(...r.map(c=>c.low)),f=q.slice(-8).reduce((s,c)=>s+c.close,0)/8,s=q.slice(-21).reduce((s,c)=>s+c.close,0)/21,b=f>s?"BUY":"SELL";
  return{pair:p,timeframe:t,bias:b,confidence:64,structure:`${b} pressure on ${t}.`,entry:x.close,stopLoss:b==="BUY"?pl-a*.2:ph+a*.2,targets:b==="BUY"?[ph,ph+a,ph+2*a]:[pl,pl-a,pl-2*a]};
}
function ict(q,p,t){
  const x=q.at(-1),w=q.slice(-100),hi=Math.max(...w.map(c=>c.high)),lo=Math.min(...w.map(c=>c.low)),eq=(hi+lo)/2,a=atr(q),prev=q.slice(-28,-2),bsl=Math.max(...prev.map(c=>c.high)),ssl=Math.min(...prev.map(c=>c.low));
  const fvgs=[];
  for(let i=2;i<q.length;i++){
    const A=q[i-2],C=q[i];
    if(C.low>A.high){
      const low=A.high,high=C.low,after=q.slice(i+1),active=!after.some(k=>k.low<=low);
      if(active)fvgs.push({name:"BULL FVG",low,high,startTime:A.time,kind:"FVG",direction:"BULL"});
    }
    if(C.high<A.low){
      const low=C.high,high=A.low,after=q.slice(i+1),active=!after.some(k=>k.high>=high);
      if(active)fvgs.push({name:"BEAR FVG",low,high,startTime:A.time,kind:"FVG",direction:"BEAR"});
    }
  }
  const obs=[];
  for(let i=1;i<q.length-1;i++){
    const c=q[i],n=q[i+1],m=n.close-n.open,after=q.slice(i+2);
    if(c.close<c.open&&m>a*.75&&n.close>c.high){const active=!after.some(k=>k.close<c.low);if(active)obs.push({name:"BULL OB",low:c.low,high:c.high,startTime:c.time,kind:"OB",direction:"BULL"})}
    if(c.close>c.open&&m<-a*.75&&n.close<c.low){const active=!after.some(k=>k.close>c.high);if(active)obs.push({name:"BEAR OB",low:c.low,high:c.high,startTime:c.time,kind:"OB",direction:"BEAR"})}
  }
  const bias=x.close<eq?"BUY":"SELL";
  const relevantFvgs=fvgs.filter(z=>bias==="BUY"?z.direction==="BULL":z.direction==="BEAR").slice(-2);
  const relevantObs=obs.filter(z=>bias==="BUY"?z.direction==="BULL":z.direction==="BEAR").slice(-2);
  const last=relevantFvgs.at(-1),entry=last?(last.low+last.high)/2:x.close,sl=bias==="BUY"?Math.min(lo,ssl)-a*.1:Math.max(hi,bsl)+a*.1;
  const targets=bias==="BUY"?[eq,bsl,hi].filter(v=>v>entry):[eq,ssl,lo].filter(v=>v<entry);
  const ote=bias==="BUY"?{low:hi-.79*(hi-lo),high:hi-.62*(hi-lo)}:{low:lo+.62*(hi-lo),high:lo+.79*(hi-lo)};
  const nearOte=x.close>=ote.low-a&&x.close<=ote.high+a;
  const lines=[
    {name:"DRH",price:hi,kind:"DR"},{name:"DRL",price:lo,kind:"DR"},{name:"EQ",price:eq,kind:"EQ"},{name:"BSL",price:bsl,kind:"BSL"},{name:"SSL",price:ssl,kind:"SSL"},
    {name:`ICT ${bias} ENTRY`,price:entry,kind:"ENTRY",prediction:true},{name:"ICT SL",price:sl,kind:"SL",prediction:true},...targets.slice(0,3).map((v,i)=>({name:`TP${i+1}`,price:v,kind:"TP",prediction:true}))
  ];
  const zones=[...relevantFvgs,...relevantObs];if(nearOte)zones.unshift({name:"OTE",low:ote.low,high:ote.high,kind:"OTE"});
  return{pair:p,timeframe:t,bias,confidence:68,narrative:`ICT ${t}: ${bias} bias · ${x.close>eq?"premium":"discount"} · active PD arrays only.`,entry,stopLoss:sl,targets:targets.slice(0,3),overlays:{lines,zones}};
}

app.get("/health",(_q,r)=>r.json({status:"ok",service:"Falcon Analysis"}));
for(const route of ["candles","analysis","ict-analysis"]){
  app.get(`/api/${route}`,async(q,r)=>{
    const p=String(q.query.pair||"EURUSD").toUpperCase(),t=String(q.query.timeframe||"5m").toLowerCase();
    if(!PAIRS.includes(p)||!TFS.includes(t))return r.status(400).json({error:"Unsupported selection"});
    try{const z=await candles(p,t);if(route==="candles")return r.json({pair:p,timeframe:t,source:z.source,candles:z.rows});if(z.rows.length<30)throw Error("Not enough candles");return r.json({...((route==="analysis")?falcon(z.rows,p,t):ict(z.rows.slice(-260),p,t)),source:z.source})}catch(e){r.status(503).json({error:e.message,bias:"NEUTRAL"})}
  });
}

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"><title>Falcon Analysis</title><script src="https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script><style>
*{box-sizing:border-box}body{margin:0;background:#070b12;color:#eef5ff;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.w{max-width:1180px;margin:auto;padding:12px}.c{background:#0d1420;border:1px solid #1b293b;border-radius:16px;padding:12px;margin:10px 0}.r{display:flex;gap:7px;overflow:auto}.b{padding:9px 12px;border-radius:10px;border:1px solid #27384f;background:#101a28;color:#c9d5e5;white-space:nowrap}.a{background:#eef5ff;color:#07101b}.chartShell{position:relative;height:560px;background:#0a111b;border-radius:10px;overflow:hidden}.chart{position:absolute;inset:0}.overlay{position:absolute;inset:0;pointer-events:none;z-index:4}.hud{position:absolute;z-index:6;left:10px;top:8px;background:#07101bd9;border:1px solid #1c2a3c;border-radius:7px;padding:6px 8px;font-size:11px;pointer-events:none;max-width:72%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tools{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0}.mini{font-size:11px;padding:6px 8px;border:1px solid #26384d;border-radius:8px;background:#101a28;color:#b9c7d8}.mini.on{background:#1b2c40;color:#eef5ff}.g{display:grid;grid-template-columns:1fr 1fr;gap:10px}.buy{color:#35d49a}.sell{color:#ff657a}.neutral{color:#f0c36a}.hint{font-size:11px;color:#7f8da0;margin-top:7px}@media(max-width:700px){.g{grid-template-columns:1fr}.chartShell{height:520px}}
</style></head><body><main class="w"><h1>Falcon Analysis</h1><section class="c"><div class="r" id="pairs"></div><div class="r" id="tfs" style="margin-top:8px"></div></section><section class="c"><div class="chartShell" id="shell"><div class="chart" id="chart"></div><canvas class="overlay" id="ov"></canvas><div class="hud" id="hud">Loading…</div></div><div class="tools"><button class="mini on" id="zonesBtn">ICT Zones</button><button class="mini on" id="liqBtn">Liquidity</button><button class="mini on" id="tradeBtn">Trade Map</button><button class="mini" id="liveBtn">Go Live</button></div><div class="hint">Drag freely left/right • pinch or wheel to zoom • local time at bottom • prices on right scale</div></section><div class="g"><section class="c"><h3>Falcon Analysis</h3><div id="fb"></div><div id="fs"></div></section><section class="c"><h3>ICT Analysis</h3><div id="ib"></div><div id="is"></div></section></div></main><script>
const P=${JSON.stringify(PAIRS)},T=${JSON.stringify(TFS)},$=i=>document.getElementById(i);let p='EURUSD',t='5m',C=[],I=null,zonesOn=true,liqOn=true,tradeOn=true,priceLines=[];
const fmt=v=>Number.isFinite(+v)?(+v).toFixed(p.includes('JPY')?3:p==='XAUUSD'?2:5):'—';
const local=m=>new Date(m).toLocaleString([],{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
function btn(id,a,v,set){$(id).innerHTML='';a.forEach(x=>{const b=document.createElement('button');b.className='b '+(x===v?'a':'');b.textContent=x.toUpperCase();b.onclick=()=>set(x);$(id).appendChild(b)})}
function ctl(){btn('pairs',P,p,x=>{p=x;ctl();load(true)});btn('tfs',T,t,x=>{t=x;ctl();load(true)})}
const chart=LightweightCharts.createChart($('chart'),{layout:{background:{type:'solid',color:'#0a111b'},textColor:'#8f9dad',fontFamily:'system-ui'},grid:{vertLines:{color:'#111c2a'},horzLines:{color:'#111c2a'}},rightPriceScale:{borderColor:'#1b2b3d',scaleMargins:{top:.08,bottom:.08}},timeScale:{borderColor:'#1b2b3d',rightOffset:12,barSpacing:7,minBarSpacing:2,timeVisible:true,secondsVisible:false,fixLeftEdge:false,fixRightEdge:false},crosshair:{mode:LightweightCharts.CrosshairMode.Normal,vertLine:{color:'#42536a',style:3,width:1},horzLine:{color:'#42536a',style:3,width:1}},handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true}});
const series=chart.addCandlestickSeries({upColor:'#26d6a0',downColor:'#ff5d73',wickUpColor:'#26d6a0',wickDownColor:'#ff5d73',borderVisible:false,priceLineVisible:true,lastValueVisible:true});
function resize(){const s=$('shell').getBoundingClientRect();chart.applyOptions({width:s.width,height:s.height});const cv=$('ov'),d=devicePixelRatio||1;cv.width=s.width*d;cv.height=s.height*d;cv.style.width=s.width+'px';cv.style.height=s.height+'px';drawOverlay()}
new ResizeObserver(resize).observe($('shell'));
function clearLines(){for(const l of priceLines){try{series.removePriceLine(l)}catch{}}priceLines=[]}
function addLines(){clearLines();for(const l of I?.overlays?.lines||[]){if(l.prediction&&!tradeOn)continue;if(!l.prediction&&!liqOn)continue;const color=l.kind==='ENTRY'?'#28c6ff':l.kind==='SL'?'#ff5a70':l.kind==='TP'?'#37d49a':l.kind==='BSL'?'#ffb15c':l.kind==='SSL'?'#62b7ff':l.kind==='EQ'?'#d6b45f':'#78889b';const pl=series.createPriceLine({price:l.price,color,lineWidth:l.prediction?2:1,lineStyle:l.prediction?LightweightCharts.LineStyle.Dashed:LightweightCharts.LineStyle.Dotted,axisLabelVisible:l.prediction,title:l.prediction?l.name:''});priceLines.push(pl)}}
function rounded(ctx,x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function drawOverlay(){const cv=$('ov'),ctx=cv.getContext('2d'),d=devicePixelRatio||1;ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,cv.width/d,cv.height/d);if(!I)return;const shell=$('shell').getBoundingClientRect(),plotRight=shell.width-72;if(zonesOn){let used=[];for(const z of I.overlays?.zones||[]){const sx0=chart.timeScale().timeToCoordinate(Math.floor(z.startTime/1000)),y1=series.priceToCoordinate(z.high),y2=series.priceToCoordinate(z.low);if(y1==null||y2==null)continue;const sx=sx0==null?8:Math.max(8,sx0),ex=plotRight;if(ex-sx<14)continue;ctx.fillStyle=z.kind==='OB'?'rgba(238,174,70,.13)':z.kind==='FVG'?'rgba(72,140,255,.11)':'rgba(166,105,255,.09)';ctx.fillRect(sx,Math.min(y1,y2),ex-sx,Math.max(3,Math.abs(y2-y1)));let ly=Math.min(y1,y2)+12;while(used.some(v=>Math.abs(v-ly)<16))ly+=16;used.push(ly);ctx.font='600 10px system-ui';const tw=ctx.measureText(z.name).width+12;ctx.fillStyle='#0b1420dd';rounded(ctx,sx+5,ly-10,tw,16,4);ctx.fill();ctx.fillStyle=z.kind==='OB'?'#e6bd79':z.kind==='FVG'?'#8ab8ff':'#b79cff';ctx.fillText(z.name,sx+11,ly+2)}}if(liqOn){for(const l of I.overlays?.lines||[]){if(l.prediction||!['BSL','SSL','EQ','DR'].includes(l.kind))continue;const y=series.priceToCoordinate(l.price);if(y==null)continue;ctx.font='600 9px system-ui';ctx.fillStyle=l.kind==='BSL'?'#ffb15c':l.kind==='SSL'?'#62b7ff':l.kind==='EQ'?'#d6b45f':'#7f8fa3';ctx.fillText(l.name,10,y-5)}}}
chart.timeScale().subscribeVisibleLogicalRangeChange(()=>drawOverlay());
chart.subscribeCrosshairMove(param=>{if(!param.time){if(C.length){const c=C.at(-1);$('hud').textContent=p+' · '+t.toUpperCase()+' · '+local(c.time)+' · '+fmt(c.close)}return}const d=param.seriesData.get(series);if(d)$('hud').textContent=local(Number(param.time)*1000)+'  O '+fmt(d.open)+'  H '+fmt(d.high)+'  L '+fmt(d.low)+'  C '+fmt(d.close)});
function toggle(id,key){$(id).onclick=()=>{if(key==='zones')zonesOn=!zonesOn;if(key==='liq')liqOn=!liqOn;if(key==='trade')tradeOn=!tradeOn;$(id).classList.toggle('on',key==='zones'?zonesOn:key==='liq'?liqOn:tradeOn);addLines();drawOverlay()}}
toggle('zonesBtn','zones');toggle('liqBtn','liq');toggle('tradeBtn','trade');$('liveBtn').onclick=()=>{chart.timeScale().scrollToRealTime();chart.timeScale().applyOptions({rightOffset:12});drawOverlay()};
async function load(reset=false){try{const q='?pair='+p+'&timeframe='+t,[c,a,i]=await Promise.all([fetch('/api/candles'+q).then(r=>r.json()),fetch('/api/analysis'+q).then(r=>r.json()),fetch('/api/ict-analysis'+q).then(r=>r.json())]);if(c.error)throw Error(c.error);C=c.candles||[];I=i;series.setData(C.map(k=>({time:Math.floor(k.time/1000),open:k.open,high:k.high,low:k.low,close:k.close})));addLines();if(reset){chart.timeScale().fitContent();chart.timeScale().applyOptions({rightOffset:12,barSpacing:7})}else if(C.length){const vr=chart.timeScale().getVisibleLogicalRange();if(vr&&vr.to>C.length-8)chart.timeScale().scrollToRealTime()}$('fb').textContent=(a.bias||'NEUTRAL')+' '+(a.confidence||'')+'%';$('fb').className=a.bias==='BUY'?'buy':a.bias==='SELL'?'sell':'neutral';$('fs').textContent=a.structure||a.error||'';$('ib').textContent=(i.bias||'NEUTRAL')+' '+(i.confidence||'')+'%';$('ib').className=i.bias==='BUY'?'buy':i.bias==='SELL'?'sell':'neutral';$('is').textContent=i.narrative||i.error||'';if(C.length){const k=C.at(-1);$('hud').textContent=p+' · '+t.toUpperCase()+' · '+local(k.time)+' · '+fmt(k.close)}setTimeout(drawOverlay,50)}catch(e){$('fs').textContent=e.message;$('is').textContent=e.message}}
ctl();load(true);setInterval(()=>load(false),30000);
</script></body></html>`;
app.get("/",(_q,r)=>r.type("html").send(page));
app.listen(PORT,()=>console.log("Falcon Analysis listening on "+PORT));
