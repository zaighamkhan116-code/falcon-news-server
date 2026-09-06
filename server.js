import "dotenv/config";
import cors from "cors";
import express from "express";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const FALCON_SOURCE = (process.env.FALCON_MARKET_DATA_URL || "https://forex-falcon-candle-analysis-production.up.railway.app").replace(/\/$/, "");

const PAIRS = ["EURUSD", "EURJPY", "GBPUSD", "USDJPY", "XAUUSD", "AUDJPY", "AUDUSD"];
const TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h"];

app.get("/health", (_req, res) => res.json({ status: "ok", service: "Falcon Analysis", marketDataSource: FALCON_SOURCE }));
app.get("/api/config", (_req, res) => res.json({ pairs: PAIRS, timeframes: TIMEFRAMES }));

// Adapter endpoint. The Falcon market server remains the source of truth. Different
// deployments have used slightly different candle routes, so probe compatible paths.
app.get("/api/candles", async (req, res) => {
  const pair = String(req.query.pair || "EURUSD").toUpperCase();
  const timeframe = String(req.query.timeframe || "5m").toLowerCase();
  if (!PAIRS.includes(pair) || !TIMEFRAMES.includes(timeframe)) return res.status(400).json({ error: "Unsupported pair or timeframe" });
  const candidates = [
    `/api/candles?pair=${pair}&timeframe=${timeframe}&limit=500`,
    `/candles?pair=${pair}&timeframe=${timeframe}&limit=500`,
    `/api/market-data?pair=${pair}&timeframe=${timeframe}&limit=500`,
    `/api/live?pair=${pair}&timeframe=${timeframe}`
  ];
  for (const path of candidates) {
    try {
      const upstream = await fetch(`${FALCON_SOURCE}${path}`, { signal: AbortSignal.timeout(7000) });
      if (!upstream.ok) continue;
      const data = await upstream.json();
      return res.json(data);
    } catch { /* probe next route */ }
  }
  res.status(503).json({ error: "Falcon candle route not resolved yet", source: FALCON_SOURCE });
});

app.get("/api/analysis", async (req, res) => {
  const pair = String(req.query.pair || "EURUSD").toUpperCase();
  const timeframe = String(req.query.timeframe || "5m").toLowerCase();
  if (!PAIRS.includes(pair) || !TIMEFRAMES.includes(timeframe)) return res.status(400).json({ error: "Unsupported pair or timeframe" });
  res.json({
    pair, timeframe, status: "waiting-for-live-candles", bias: "NEUTRAL", confidence: null,
    structure: "Live structure analysis initializes when candle adapter resolves.",
    liquidity: [], fvg: [], supportResistance: [], entry: null, stopLoss: null, targets: [],
    concepts: ["market structure", "liquidity sweep/rejection", "FVG/imbalance", "support/resistance", "candle anatomy", "momentum", "volatility/regime", "multi-timeframe context"],
    note: "No BUY/SELL is fabricated without sufficient live market data."
  });
});

const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Falcon Analysis</title>
<style>*{box-sizing:border-box}body{margin:0;background:#070b12;color:#eef5ff;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1180px;margin:auto;padding:18px}.hero{padding:22px 4px 14px}.eyebrow{color:#7f8da3;font-size:12px;letter-spacing:2px}.hero h1{margin:5px 0;font-size:32px}.hero p{margin:0;color:#8d9bb0}.card{background:#0d1420;border:1px solid #1b293b;border-radius:18px;padding:16px;margin:14px 0;box-shadow:0 14px 40px #0005}.row{display:flex;gap:8px;overflow:auto;padding-bottom:3px}.chip{border:1px solid #27384f;background:#101a28;color:#c9d5e5;padding:10px 13px;border-radius:12px;white-space:nowrap;font-weight:700}.chip.active{background:#eef5ff;color:#07101b;border-color:#eef5ff}.label{font-size:11px;color:#74849a;letter-spacing:1.5px;margin:0 0 8px}.chart{height:430px;position:relative;border-radius:14px;overflow:hidden;background:linear-gradient(#0b121c,#080e16)}canvas{width:100%;height:100%}.watermark{position:absolute;top:14px;left:16px;font-size:14px;color:#8090a7}.live{position:absolute;top:14px;right:16px;font-size:11px;color:#8090a7}.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:14px}.bias{font-size:30px;font-weight:800;margin:4px 0}.neutral{color:#f0c36a}.muted{color:#8b99ad;font-size:13px;line-height:1.55}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.metric{background:#09111b;border:1px solid #172538;border-radius:12px;padding:12px}.metric b{display:block;font-size:17px;margin-top:5px}.concepts{display:flex;gap:7px;flex-wrap:wrap}.concept{font-size:11px;padding:7px 9px;border:1px solid #24344a;border-radius:999px;color:#aebbd0}@media(max-width:760px){.wrap{padding:12px}.hero h1{font-size:27px}.grid{grid-template-columns:1fr}.chart{height:390px}.metrics{grid-template-columns:1fr 1fr}.card{border-radius:15px}.hero{padding-top:14px}}</style></head><body><main class="wrap"><header class="hero"><div class="eyebrow">FOREX FALCON INTELLIGENCE</div><h1>Falcon Analysis</h1><p>Live structure • liquidity • direction • risk targets</p></header>
<section class="card"><div class="label">MARKET</div><div class="row" id="pairs"></div><div class="label" style="margin-top:15px">TIMEFRAME</div><div class="row" id="tfs"></div></section>
<section class="card"><div class="chart"><canvas id="chart"></canvas><div class="watermark" id="chartTitle">EURUSD · 5m</div><div class="live" id="feed">CONNECTING TO FALCON…</div></div></section>
<div class="grid"><section class="card"><div class="label">FALCON ANALYSIS</div><div class="bias neutral" id="bias">WAITING FOR LIVE DATA</div><p class="muted" id="summary">The analyst will issue BUY/SELL only after the selected pair and timeframe have enough live candles for structure, liquidity and risk validation.</p><div class="concepts" id="concepts"></div></section><section class="card"><div class="label">TRADE MAP</div><div class="metrics"><div class="metric"><span class="muted">Entry</span><b id="entry">—</b></div><div class="metric"><span class="muted">Stop Loss</span><b id="sl">—</b></div><div class="metric"><span class="muted">TP1</span><b id="tp1">—</b></div><div class="metric"><span class="muted">TP2</span><b id="tp2">—</b></div><div class="metric"><span class="muted">TP3</span><b id="tp3">—</b></div><div class="metric"><span class="muted">Confidence</span><b id="conf">—</b></div></div></section></div></main>
<script>const PAIRS=${JSON.stringify(PAIRS)},TFS=${JSON.stringify(TIMEFRAMES)};let pair='EURUSD',tf='5m';const $=id=>document.getElementById(id);function buttons(id,items,current,setter){const el=$(id);el.innerHTML='';items.forEach(x=>{const b=document.createElement('button');b.className='chip '+(x===current?'active':'');b.textContent=x;b.onclick=()=>setter(x);el.appendChild(b)})}function selectPair(x){pair=x;render();load()}function selectTf(x){tf=x;render();load()}function render(){buttons('pairs',PAIRS,pair,selectPair);buttons('tfs',TFS,tf,selectTf);$('chartTitle').textContent=pair+' · '+tf;drawPlaceholder()}function drawPlaceholder(){const c=$('chart'),d=devicePixelRatio||1,r=c.getBoundingClientRect();c.width=r.width*d;c.height=r.height*d;const x=c.getContext('2d');x.scale(d,d);x.strokeStyle='#142133';x.lineWidth=1;for(let i=1;i<6;i++){let y=r.height*i/6;x.beginPath();x.moveTo(0,y);x.lineTo(r.width,y);x.stroke()}for(let i=1;i<8;i++){let xx=r.width*i/8;x.beginPath();x.moveTo(xx,0);x.lineTo(xx,r.height);x.stroke()}x.fillStyle='#708096';x.font='13px system-ui';x.textAlign='center';x.fillText('Falcon live candles will render here',r.width/2,r.height/2)}async function load(){ $('feed').textContent='ANALYZING…';try{const a=await fetch('/api/analysis?pair='+pair+'&timeframe='+tf).then(r=>r.json());$('bias').textContent=a.bias==='NEUTRAL'?'WAITING FOR LIVE DATA':a.bias;$('summary').textContent=a.structure||a.note;$('entry').textContent=a.entry??'—';$('sl').textContent=a.stopLoss??'—';$('tp1').textContent=a.targets?.[0]??'—';$('tp2').textContent=a.targets?.[1]??'—';$('tp3').textContent=a.targets?.[2]??'—';$('conf').textContent=a.confidence==null?'—':a.confidence+'%';$('concepts').innerHTML=(a.concepts||[]).map(x=>'<span class="concept">'+x+'</span>').join('');$('feed').textContent='FALCON FEED'}catch(e){$('feed').textContent='FEED RETRYING'}}render();load();addEventListener('resize',drawPlaceholder);</script></body></html>`;

app.get("/", (_req, res) => res.type("html").send(page));
app.listen(PORT, () => console.log(`Falcon Analysis listening on port ${PORT}`));
