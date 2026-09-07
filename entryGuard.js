import express from "express";

const originalJson = express.response.json;
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
  return {x,a,pos,downExtension,upExtension,sweptLow,sweptHigh,bullConfirm:sweptLow||bullReject||bullDisplace,bearConfirm:sweptHigh||bearReject||bearDisplace,recentLow,recentHigh};
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
  if(next===A.bias)return A;
  const out={...A,bias:next,narrative:reason+' '+(A.narrative||''),confidence:next==='WAIT'?Math.min(+A.confidence||50,55):Math.min(78,Math.max(58,+A.confidence||58))};
  if(next==='WAIT'){
    out.entryLevel=null;out.entryLabel='WAIT — LOCATION NOT FAVORABLE';out.tp1=null;out.tp2=null;out.tp1Label='';out.tp2Label='';
    out.overlays={...(A.overlays||{}),lines:(A.overlays?.lines||[]).filter(l=>!['BUYLVL','SELLLVL','TP1','TP2'].includes(l.kind)),zones:A.overlays?.zones||[],trendLines:A.overlays?.trendLines||[]};
  } else {
    const entry=+c.x.close, dir=next==='BUY'?1:-1;
    out.entryLevel=entry;out.entryLabel=next==='BUY'?'CONFIRMED REVERSAL FROM SELL-SIDE LIQUIDITY':'CONFIRMED REVERSAL FROM BUY-SIDE LIQUIDITY';
    const t1=entry+dir*c.a*.9,t2=entry+dir*c.a*1.8;out.tp1=t1;out.tp2=t2;out.tp1Label='first meaningful structure objective';out.tp2Label='next external liquidity objective';
    out.overlays={...(A.overlays||{}),lines:[{name:next,price:entry,kind:next==='BUY'?'BUYLVL':'SELLLVL',prediction:true},{name:'TP1',price:t1,kind:'TP1',prediction:true},{name:'TP2',price:t2,kind:'TP2',prediction:true},...(A.overlays?.lines||[]).filter(l=>!['BUYLVL','SELLLVL','TP1','TP2'].includes(l.kind))],zones:A.overlays?.zones||[],trendLines:A.overlays?.trendLines||[]};
  }
  return out;
}

express.response.json=function(body){
  try{
    if(body?.candles&&body?.analyses){const c=context(body.candles);if(c){body={...body,analyses:Object.fromEntries(Object.entries(body.analyses).map(([k,v])=>[k,guardAnalysis(v,c)]))};}
  }catch{}
  return originalJson.call(this,body);
};
