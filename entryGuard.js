import express from "express";

const originalJson = express.response.json;
const originalSend = express.response.send;
const avg = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0;
const atr = q => avg(q.slice(-14).map(c=>Math.max(0,(+c.high)-(+c.low))));

function context(candles){
  const q=(candles||[]).slice(-160), x=q.at(-1), prev=q.at(-2);
  if(!x||!prev||q.length<25)return null;
  const a=Math.max(atr(q),1e-12), recent=q.slice(-20,-1), wider=q.slice(-60,-1);
  const recentLow=Math.min(...recent.map(c=>+c.low)), recentHigh=Math.max(...recent.map(c=>+c.high));
  const widerLow=Math.min(...wider.map(c=>+c.low)), widerHigh=Math.max(...wider.map(c=>+c.high));
  const range=Math.max(widerHigh-widerLow,a), pos=((+x.close)-widerLow)/range;
  const downExtension=(Math.max(...q.slice(-8).map(c=>+c.high))-(+x.close))/a;
  const upExtension=((+x.close)-Math.min(...q.slice(-8).map(c=>+c.low)))/a;
  const sweptLow=(+x.low<recentLow && +x.close>recentLow) || q.slice(-3).some(c=>+c.low<recentLow && +c.close>recentLow);
  const sweptHigh=(+x.high>recentHigh && +x.close<recentHigh) || q.slice(-3).some(c=>+c.high>recentHigh && +c.close<recentHigh);
  const bullReject=(+x.close>+x.open)&&((+x.close)-(+x.low)>.55*((+x.high)-(+x.low)));
  const bearReject=(+x.close<+x.open)&&((+x.high)-(+x.close)>.55*((+x.high)-(+x.low)));
  const bullDisplace=(+x.close>+prev.high)&&((+x.close)-(+x.open)>.45*a);
  const bearDisplace=(+x.close<+prev.low)&&((+x.open)-(+x.close)>.45*a);
  return {x,a,pos,downExtension,upExtension,sweptLow,sweptHigh,bullConfirm:sweptLow||bullReject||bullDisplace,bearConfirm:sweptHigh||bearReject||bearDisplace,recentLow,recentHigh,widerLow,widerHigh};
}

function retarget(A,c){
  if(!A||!c||!['BUY','SELL'].includes(A.bias)||!Number.isFinite(+A.entryLevel))return A;
  const dir=A.bias==='BUY'?1:-1, entry=+A.entryLevel, a=c.a;
  const min1=a*.75, minGap=a*.65;
  const raw=[];
  const add=(price,label)=>{price=+price;if(!Number.isFinite(price))return;const d=dir*(price-entry);if(d>=min1)raw.push({price,label,d})};
  add(c.recentHigh,'recent structural high');add(c.widerHigh,'external buy-side liquidity');
  add(c.recentLow,'recent structural low');add(c.widerLow,'external sell-side liquidity');
  for(const l of A.overlays?.lines||[]){
    if(['BSL','SSL','STRUCT'].includes(l.kind))add(l.price,l.kind==='BSL'?'buy-side liquidity':l.kind==='SSL'?'sell-side liquidity':'structural liquidity');
  }
  raw.sort((x,y)=>x.d-y.d);
  const t1=raw[0]||{price:entry+dir*a*.9,label:'ATR-backed meaningful objective',d:a*.9};
  const t2=raw.find(x=>x.d>=t1.d+minGap)||{price:entry+dir*Math.max(a*1.8,t1.d+a*.75),label:'next external liquidity objective'};
  const old1=Math.abs((+A.tp1||entry)-entry);
  if(old1>=min1){
    const old2=Math.abs((+A.tp2||entry)-entry);
    if(old2>=old1+minGap)return A;
  }
  const lines=(A.overlays?.lines||[]).filter(l=>!['TP1','TP2'].includes(l.kind));
  lines.push({name:'TP1',price:t1.price,kind:'TP1',prediction:true},{name:'TP2',price:t2.price,kind:'TP2',prediction:true});
  return {...A,tp1:t1.price,tp2:t2.price,tp1Label:t1.label,tp2Label:t2.label,narrative:(A.narrative||'')+' Targets ignore nearby micro levels: TP1 is the first meaningful structural/liquidity objective and TP2 is the next external objective.',overlays:{...(A.overlays||{}),lines,zones:A.overlays?.zones||[],trendLines:A.overlays?.trendLines||[]}};
}

function verifiedTouches(line,candles,timeframe){
  if(!line||!Array.isArray(candles)||!candles.length)return null;
  const tf=String(line.tf||'').toLowerCase();
  if(tf!==String(timeframe||'').toLowerCase())return null;
  const q=candles.filter(c=>+c.time>=+line.startTime&&+c.time<=+line.endTime);
  if(q.length<3)return null;
  const a=Math.max(atr(q),1e-12),tol=a*.12;
  let clusters=0,lastTouch=-99;
  for(let i=0;i<q.length;i++){
    const c=q[i],lp=+line.startPrice+(+line.slope)*((+c.time)-(+line.startTime));
    const wickTouch=(+c.low<=lp+tol&&+c.high>=lp-tol);
    const bodyCross=Math.min(+c.open,+c.close)<lp-tol&&Math.max(+c.open,+c.close)>lp+tol;
    const correctSide=line.direction==='BUY'?Math.min(+c.open,+c.close)>=lp-tol:Math.max(+c.open,+c.close)<=lp+tol;
    if(wickTouch&&!bodyCross&&correctSide){if(i-lastTouch>2)clusters++;lastTouch=i;}
  }
  return clusters>=2?clusters:null;
}

function fixTrendTouches(A,candles,timeframe){
  if(!A?.overlays?.trendLines)return A;
  const trendLines=A.overlays.trendLines.map(l=>{
    const n=verifiedTouches(l,candles,timeframe);
    return {...l,touches:Number.isFinite(n)?n:null};
  });
  return {...A,overlays:{...A.overlays,trendLines}};
}

function guardAnalysis(A,c){
  if(!A||!c||!['BUY','SELL'].includes(A.bias))return A;
  const atLow=c.pos<.28 || c.downExtension>2.0;
  const atHigh=c.pos>.72 || c.upExtension>2.0;
  let next=A.bias, reason='';
  if(A.bias==='SELL'&&atLow){
    if(c.bullConfirm){next='BUY';reason='Bearish move is extended into sell-side liquidity/discount and bullish reversal confirmation is present.'}
    else {next='WAIT';reason='Bearish bias remains, but price is already extended into sell-side liquidity/discount. Do not chase a SELL; wait for a retracement or bullish reversal confirmation.'}
  } else if(A.bias==='BUY'&&atHigh){
    if(c.bearConfirm){next='SELL';reason='Bullish move is extended into buy-side liquidity/premium and bearish reversal confirmation is present.'}
    else {next='WAIT';reason='Bullish bias remains, but price is already extended into buy-side liquidity/premium. Do not chase a BUY; wait for a retracement or bearish reversal confirmation.'}
  }
  if(next===A.bias)return retarget(A,c);
  const out={...A,bias:next,narrative:reason+' '+(A.narrative||''),confidence:next==='WAIT'?Math.min(+A.confidence||50,55):Math.min(78,Math.max(58,+A.confidence||58))};
  if(next==='WAIT'){
    out.entryLevel=null;out.entryLabel='WAIT — LOCATION NOT FAVORABLE';out.tp1=null;out.tp2=null;out.tp1Label='';out.tp2Label='';
    out.overlays={...(A.overlays||{}),lines:(A.overlays?.lines||[]).filter(l=>!['BUYLVL','SELLLVL','TP1','TP2'].includes(l.kind)),zones:A.overlays?.zones||[],trendLines:A.overlays?.trendLines||[]};
    return out;
  }
  const entry=+c.x.close, dir=next==='BUY'?1:-1;
  out.entryLevel=entry;out.entryLabel=next==='BUY'?'CONFIRMED REVERSAL FROM SELL-SIDE LIQUIDITY':'CONFIRMED REVERSAL FROM BUY-SIDE LIQUIDITY';
  const t1=entry+dir*c.a*.9,t2=entry+dir*c.a*1.8;out.tp1=t1;out.tp2=t2;out.tp1Label='first meaningful structure objective';out.tp2Label='next external liquidity objective';
  out.overlays={...(A.overlays||{}),lines:[{name:next,price:entry,kind:next==='BUY'?'BUYLVL':'SELLLVL',prediction:true},{name:'TP1',price:t1,kind:'TP1',prediction:true},{name:'TP2',price:t2,kind:'TP2',prediction:true},...(A.overlays?.lines||[]).filter(l=>!['BUYLVL','SELLLVL','TP1','TP2'].includes(l.kind))],zones:A.overlays?.zones||[],trendLines:A.overlays?.trendLines||[]};
  return out;
}

express.response.json=function(body){
  try{
    if(body?.candles&&body?.analyses){
      delete body.analyses.MOMENTUM;
      const c=context(body.candles);
      if(c){
        const analyses={};
        for(const [k,v] of Object.entries(body.analyses)){
          let out=guardAnalysis(v,c);
          if(k==='TREND')out=fixTrendTouches(out,body.candles,body.timeframe);
          analyses[k]=out;
        }
        body={...body,analyses};
      }
    }
  }catch{}
  return originalJson.call(this,body);
};

express.response.send=function(body){
  try{
    if(typeof body==='string'&&body.includes('Falcon Analysis')){
      body=body.replace('"MOMENTUM",','');
      body=body.replace("const label=l.tf+' '+(action?'ACTION':'SAFETY')+' · '+l.touches+' touches'","const label=l.tf+' '+(action?'ACTION':'SAFETY')+(Number.isFinite(l.touches)?' · '+l.touches+' verified touches':'')");
    }
  }catch{}
  return originalSend.call(this,body);
};
