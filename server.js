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

app.get("/", (_req, res) => res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Falcon Analysis</title></head><body style="background:#070b12;color:#eef5ff;font-family:system-ui;padding:24px"><h1>Falcon Analysis</h1><p>Service restored. ICT Analysis remains enabled in the previous stable deployment and chart markings will be reintroduced safely.</p></body></html>`));

app.listen(PORT, () => console.log(`Falcon Analysis listening on port ${PORT}`));
