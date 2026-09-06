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
async function candles(p,t,l=650){
  if(BIQUOTE.has(p)){try{return{rows:await biq(p,t,l),source:"BIQUOTE"}}catch{return{rows:await td(p,t,l),source:"TWELVE_DATA_FALLBACK"}}}
  return{rows:await td(p,t,l),source:"TWELVE_DATA"};
}
const atr=q=>q.slice(-14).reduce((s,c)=>s+c.high-c.low,0)/Math.min(14,q.length);
function falcon(q,p,t){
  const x=q.at(-1),a=atr(q),r=q.slice(-21,-1),ph=Math.max(...r.map(c=>c.high)),pl=Math.min(...r.map(c=>c.low)),f=q.slice(-8).reduce((s,c)=>s+c.close,0)/8,s=q.slice(-21).reduce((s,c)=>s+c.close,0)/21,b=f>s?"BUY":"SELL";
  return{pair:p,timeframe:t,bias:b,confidence:64,structure:`${b} pressure on ${t}.`,entry:x.close,stopLoss:b==="BUY"?pl-a*.2:ph+a*.2,targets:b==="BUY"?[ph,ph+a,ph+2*a]:[pl,pl-a,pl-2*a]};
}
function ict(q,p,t){
  const x=q.at(-1),w=q.slice(-80),hi=Math.max(...w.map(c=>c.high)),lo=Math.min(...w.map(c=>c.low)),eq=(hi+lo)/2,a=atr(q),prev=q.slice(-24,-2),bsl=Math.max(...prev.map(c=>c.high)),ssl=Math.min(...prev.map(c=>c.low)),fvgs=[],obs=[];
  for(let i=2;i<q.length;i++){
    const A=q[i-2],C=q[i];
    if(C.low>A.high)fvgs.push({name:"BULLISH FVG",low:A.high,high:C.low,startTime:A.time,endTime:C.time,kind:"FVG"});
    if(C.high<A.low)fvgs.push({name:"BEARISH FVG",low:C.high,high:A.low,startTime:A.time,endTime:C.time,kind:"FVG"});
  }
  for(let i=1;i<q.length-1;i++){
    const c=q[i],n=q[i+1],m=n.close-n.open;
    if(c.close<c.open&&m>a*.7&&n.close>c.high)obs.push({name:"BULLISH ORDER BLOCK",low:c.low,high:c.high,startTime:c.time,endTime:q.at(-1).time,kind:"OB"});
    if(c.close>c.open&&m<-a*.7&&n.close<c.low)obs.push({name:"BEARISH ORDER BLOCK",low:c.low,high:c.high,startTime:c.time,endTime:q.at(-1).time,kind:"OB"});
  }
  const bias=x.close<eq?"BUY":"SELL";
  const last=bias==="BUY"?fvgs.filter(z=>z.name.includes("BULLISH")).at(-1):fvgs.filter(z=>z.name.includes("BEARISH")).at(-1);
  const entry=last?(last.low+last.high)/2:x.close,sl=bias==="BUY"?Math.min(lo,ssl)-a*.1:Math.max(hi,bsl)+a*.1;
  const targets=bias==="BUY"?[eq,bsl,hi].filter(v=>v>entry):[eq,ssl,lo].filter(v=>v<entry);
  const ote=bias==="BUY"?{low:hi-.79*(hi-lo),high:hi-.62*(hi-lo)}:{low:lo+.62*(hi-lo),high:lo+.79*(hi-lo)};
  const lines=[
    {name:"DR HIGH",price:hi,kind:"DR"},{name:"DR LOW",price:lo,kind:"DR"},{name:"EQ 50%",price:eq,kind:"EQ"},
    {name:"BSL",price:bsl,kind:"BSL"},{name:"SSL",price:ssl,kind:"SSL"},
    {name:`ICT ${bias} ENTRY`,price:entry,kind:"ENTRY",prediction:true},{name:"ICT SL",price:sl,kind:"SL",prediction:true},
    ...targets.slice(0,3).map((v,i)=>({name:`ICT TP${i+1}`,price:v,kind:"TP",prediction:true}))
  ];
  const recentFvgs=fvgs.slice(-4),recentObs=obs.slice(-3);
  const zones=[{name:"DISCOUNT",low:lo,high:eq,kind:"DISCOUNT"},{name:"PREMIUM",low:eq,high:hi,kind:"PREMIUM"},{name:"OTE",low:ote.low,high:ote.high,kind:"OTE"},...recentFvgs,...recentObs];
  return{pair:p,timeframe:t,bias,confidence:68,narrative:`ICT ${t}: price is ${x.close>eq?"in premium":"in discount"}.`,entry,stopLoss:sl,targets:targets.slice(0,3),overlays:{lines,zones}};
}

app.get("/health",(_q,r)=>r.json({status:"ok",service:"Falcon Analysis"}));
for(const route of ["candles","analysis","ict-analysis"]){
  app.get(`/api/${route}`,async(q,r)=>{
    const p=String(q.query.pair||"EURUSD").toUpperCase(),t=String(q.query.timeframe||"5m").toLowerCase();
    if(!PAIRS.includes(p)||!TFS.includes(t))return r.status(400).json({error:"Unsupported selection"});
    try{
      const z=await candles(p,t);
      if(route==="candles")return r.json({pair:p,timeframe:t,source:z.source,candles:z.rows});
      if(z.rows.length<30)throw Error("Not enough candles");
      return r.json({...((route==="analysis")?falcon(z.rows,p,t):ict(z.rows.slice(-220),p,t)),source:z.source});
    }catch(e){r.status(503).json({error:e.message,bias:"NEUTRAL"})}
  });
}

const page = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>Falcon Analysis</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#070b12;color:#eef5ff;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.w{max-width:1180px;margin:auto;padding:12px}.c{background:#0d1420;border:1px solid #1b293b;border-radius:16px;padding:12px;margin:10px 0}.r{display:flex;gap:7px;overflow:auto}.b{padding:9px 12px;border-radius:10px;border:1px solid #27384f;background:#101a28;color:#c9d5e5;white-space:nowrap}.a{background:#eef5ff;color:#07101b}.ch{height:540px;position:relative;touch-action:none;overflow:hidden;background:#0a111b;border-radius:10px}.ch canvas{width:100%;height:100%;display:block}.tag{position:absolute;top:8px;background:#07101bdd;padding:6px 8px;border-radius:7px;font-size:11px;pointer-events:none}.l{left:8px}.rr{right:78px}.g{display:grid;grid-template-columns:1fr 1fr;gap:10px}.buy{color:#35d49a}.sell{color:#ff657a}.neutral{color:#f0c36a}.hint{font-size:11px;color:#7f8da0;margin-top:7px}@media(max-width:700px){.g{grid-template-columns:1fr}.ch{height:500px}}
</style>
</head>
<body>
<main class="w">
<h1>Falcon Analysis</h1>
<section class="c"><div class="r" id="pairs"></div><div class="r" id="tfs" style="margin-top:8px"></div></section>
<section class="c"><div class="ch" id="wrap"><canvas id="cv"></canvas><div class="tag l" id="title"></div><div class="tag rr" id="info">Drag • pinch/wheel to zoom</div></div><div class="hint">Price scale on the right • local time at the bottom • drag horizontally to scroll back</div></section>
<div class="g"><section class="c"><h3>Falcon Analysis</h3><div id="fb"></div><div id="fs"></div></section><section class="c"><h3>ICT Analysis</h3><div id="ib"></div><div id="is"></div></section></div>
</main>
<script>
const P=${JSON.stringify(PAIRS)},T=${JSON.stringify(TFS)},$=i=>document.getElementById(i);
let p='EURUSD',t='5m',C=[],I=null,n=84,end=null,drag=false,lx=0,pinchStart=0,pinchN=84;
const fmt=v=>Number.isFinite(+v)?(+v).toFixed(p.includes('JPY')?3:p==='XAUUSD'?2:5):'—';
const tm=m=>new Date(m).toLocaleString([],{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
function btn(id,a,v,set){$(id).innerHTML='';a.forEach(x=>{const b=document.createElement('button');b.className='b '+(x===v?'a':'');b.textContent=x.toUpperCase();b.onclick=()=>set(x);$(id).appendChild(b)})}
function ctl(){btn('pairs',P,p,x=>{p=x;end=null;ctl();load()});btn('tfs',T,t,x=>{t=x;end=null;ctl();load()})}
function vis(){const e=end??C.length;return C.slice(Math.max(0,e-n),e)}
function zfill(kind){if(kind==='OB')return'rgba(244,180,70,.12)';if(kind==='FVG')return'rgba(80,145,255,.10)';if(kind==='PREMIUM')return'rgba(255,80,100,.035)';if(kind==='DISCOUNT')return'rgba(45,210,155,.035)';if(kind==='OTE')return'rgba(170,110,255,.07)';return'rgba(140,150,170,.05)'}
function lcolor(kind){if(kind==='ENTRY')return'#28c6ff';if(kind==='SL')return'#ff5a70';if(kind==='TP')return'#37d49a';if(kind==='BSL')return'#ffb15c';if(kind==='SSL')return'#62b7ff';if(kind==='EQ')return'#d6b45f';return'#8090a5'}
function draw(){
  const cv=$('cv'),wrap=$('wrap'),d=devicePixelRatio||1,r=wrap.getBoundingClientRect();cv.width=r.width*d;cv.height=r.height*d;const x=cv.getContext('2d');x.setTransform(d,0,0,d,0,0);x.clearRect(0,0,r.width,r.height);
  const v=vis();if(!v.length)return;
  const L=10,R=78,TP=34,B=32,W=r.width-L-R,H=r.height-TP-B;
  let lo=Math.min(...v.map(c=>c.low)),hi=Math.max(...v.map(c=>c.high));
  for(const z of I?.overlays?.zones||[]){if(z.high>=lo&&z.low<=hi){lo=Math.min(lo,z.low);hi=Math.max(hi,z.high)}}
  for(const l of I?.overlays?.lines||[]){if(l.prediction||l.kind==='EQ'||l.kind==='BSL'||l.kind==='SSL'){lo=Math.min(lo,l.price);hi=Math.max(hi,l.price)}}
  const pd=(hi-lo)*.06||1;lo-=pd;hi+=pd;
  const Y=q=>TP+(hi-q)/(hi-lo)*H,S=W/v.length,X=i=>L+i*S,first=v[0].time,last=v.at(-1).time,TX=time=>L+(time-first)/Math.max(1,last-first)*W;
  x.strokeStyle='#152131';x.lineWidth=1;x.font='10px system-ui';x.textBaseline='middle';
  for(let i=0;i<=6;i++){const yy=TP+H*i/6;x.beginPath();x.moveTo(L,yy);x.lineTo(L+W,yy);x.stroke();const pr=hi-(hi-lo)*i/6;x.fillStyle='#8c9bad';x.fillText(fmt(pr),L+W+8,yy)}
  const zones=(I?.overlays?.zones||[]).filter(z=>z.high>=lo&&z.low<=hi);
  let labelYs=[];
  for(const z of zones){const y1=Y(z.high),y2=Y(z.low),sx=z.startTime?Math.max(L,TX(z.startTime)):L,ex=z.endTime?Math.min(L+W,TX(z.endTime)):L+W;if(ex<=L||sx>=L+W||ex<=sx)continue;x.fillStyle=zfill(z.kind);x.fillRect(sx,y1,Math.max(8,ex-sx),Math.max(2,y2-y1));if(z.kind==='FVG'||z.kind==='OB'||z.kind==='OTE'){let ly=Math.max(TP+10,Math.min(TP+H-10,(y1+y2)/2));while(labelYs.some(v=>Math.abs(v-ly)<14))ly+=14;labelYs.push(ly);x.fillStyle=z.kind==='OB'?'#e7bd77':z.kind==='FVG'?'#88b9ff':'#b794f6';x.font='bold 10px system-ui';x.fillText(z.name,sx+5,ly)}}
  v.forEach((c,i)=>{const cx=X(i)+S/2,yo=Y(c.open),yc=Y(c.close),up=c.close>=c.open,wc=Math.max(2,Math.min(11,S*.58));x.strokeStyle=up?'#2ecf9a':'#ff5f76';x.fillStyle=x.strokeStyle;x.beginPath();x.moveTo(cx,Y(c.high));x.lineTo(cx,Y(c.low));x.stroke();x.fillRect(cx-wc/2,Math.min(yo,yc),wc,Math.max(1,Math.abs(yc-yo)))});
  for(const l of I?.overlays?.lines||[]){const yy=Y(l.price);if(yy<TP||yy>TP+H)continue;x.strokeStyle=lcolor(l.kind);x.lineWidth=l.prediction?1.35:1;x.setLineDash(l.prediction?[3,5]:[7,5]);x.beginPath();x.moveTo(L,yy);x.lineTo(L+W,yy);x.stroke();x.setLineDash([]);if(l.prediction){const text=fmt(l.price);const tw=x.measureText(text).width;x.fillStyle=lcolor(l.kind);x.fillRect(L+W+2,yy-9,Math.min(R-4,tw+10),18);x.fillStyle='#07101b';x.font='bold 10px system-ui';x.fillText(text,L+W+7,yy)}else if(['BSL','SSL','EQ'].includes(l.kind)){x.fillStyle=lcolor(l.kind);x.font='bold 9px system-ui';x.fillText(l.name,L+6,yy-7)}}
  x.fillStyle='#8190a3';x.font='10px system-ui';x.textBaseline='alphabetic';for(let i=0;i<=4;i++){const idx=Math.min(v.length-1,Math.round(i*(v.length-1)/4)),c=v[idx],xx=X(idx);x.fillText(tm(c.time),Math.min(L+W-74,xx),TP+H+20)}
  $('title').textContent=p+' · '+t.toUpperCase()+' · '+tm(v.at(-1).time)+' · '+fmt(v.at(-1).close);
}
const wrap=$('wrap');
wrap.addEventListener('pointerdown',e=>{drag=true;lx=e.clientX;try{wrap.setPointerCapture(e.pointerId)}catch{}});
wrap.addEventListener('pointermove',e=>{const v=vis();if(v.length){const rect=wrap.getBoundingClientRect(),idx=Math.max(0,Math.min(v.length-1,Math.floor(((e.clientX-rect.left)/Math.max(1,rect.width))*v.length))),c=v[idx];$('info').textContent=tm(c.time)+'  O '+fmt(c.open)+' H '+fmt(c.high)+' L '+fmt(c.low)+' C '+fmt(c.close)}if(drag&&Math.abs(e.clientX-lx)>5){end=Math.max(n,Math.min(C.length,(end??C.length)+Math.round(-(e.clientX-lx)/(wrap.clientWidth/n))));lx=e.clientX;draw()}});
wrap.addEventListener('pointerup',()=>drag=false);wrap.addEventListener('pointercancel',()=>drag=false);
wrap.addEventListener('wheel',e=>{e.preventDefault();n=Math.max(22,Math.min(260,n+(e.deltaY>0?10:-10)));if(end!==null)end=Math.max(n,Math.min(C.length,end));draw()},{passive:false});
wrap.addEventListener('touchstart',e=>{if(e.touches.length===2){const a=e.touches[0],b=e.touches[1];pinchStart=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);pinchN=n}},{passive:true});
wrap.addEventListener('touchmove',e=>{if(e.touches.length===2&&pinchStart){e.preventDefault();const a=e.touches[0],b=e.touches[1],dist=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),ratio=pinchStart/Math.max(1,dist);n=Math.max(22,Math.min(260,Math.round(pinchN*ratio)));if(end!==null)end=Math.max(n,Math.min(C.length,end));draw()}},{passive:false});
wrap.addEventListener('touchend',()=>{pinchStart=0},{passive:true});
async function load(){try{const q='?pair='+p+'&timeframe='+t,[c,a,i]=await Promise.all([fetch('/api/candles'+q).then(r=>r.json()),fetch('/api/analysis'+q).then(r=>r.json()),fetch('/api/ict-analysis'+q).then(r=>r.json())]);if(c.error)throw Error(c.error);C=c.candles||[];I=i;if(end===null)end=C.length;$('fb').textContent=(a.bias||'NEUTRAL')+' '+(a.confidence||'')+'%';$('fb').className=a.bias==='BUY'?'buy':a.bias==='SELL'?'sell':'neutral';$('fs').textContent=a.structure||a.error||'';$('ib').textContent=(i.bias||'NEUTRAL')+' '+(i.confidence||'')+'%';$('ib').className=i.bias==='BUY'?'buy':i.bias==='SELL'?'sell':'neutral';$('is').textContent=i.narrative||i.error||'';draw()}catch(e){$('fs').textContent=e.message;$('is').textContent=e.message}}
ctl();load();setInterval(load,30000);addEventListener('resize',draw);
</script>
</body>
</html>`;

app.get("/",(_q,r)=>r.type("html").send(page));
app.listen(PORT,()=>console.log("Falcon Analysis listening on "+PORT));
