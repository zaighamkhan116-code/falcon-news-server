import "dotenv/config";
import cors from "cors";
import express from "express";

const app = express();
app.use(cors());

const requireKey = (name) => {
  if (!process.env[name]) throw new Error(`${name} is not configured in server/.env`);
  return process.env[name];
};

app.get("/health", (_request, response) => response.json({ status: "ok", service: "Falcon News server" }));

app.get("/api/calendar", async (_request, response) => {
  try {
    const key = requireKey("TRADING_ECONOMICS_API_KEY");
    const today = new Date().toISOString().slice(0, 10);
    const api = `https://api.tradingeconomics.com/calendar/${today}/${today}?c=${encodeURIComponent(key)}`;
    const upstream = await fetch(api);
    if (!upstream.ok) throw new Error(`Calendar provider returned ${upstream.status}`);
    const rows = await upstream.json();
    response.json(rows.map((event) => ({
      id: String(event.CalendarId ?? `${event.Date}-${event.Event}`), title: event.Event, currency: event.Currency ?? event.Country,
      impact: Number(event.Importance) >= 3 ? "high" : "medium", timeUtc: event.Date,
      forecast: Number(event.Forecast) || undefined, previous: Number(event.Previous) || undefined,
      actual: Number(event.Actual) || undefined, unit: event.Unit, category: "other"
    })).filter((event) => event.impact === "high" || event.impact === "medium"));
  } catch (error) { response.status(503).json({ error: error.message }); }
});

app.get("/api/breaking-news", async (_request, response) => {
  try {
    const token = requireKey("MARKETAUX_API_KEY");
    const api = `https://api.marketaux.com/v1/news/all?api_token=${encodeURIComponent(token)}&language=en&limit=20`;
    const upstream = await fetch(api);
    if (!upstream.ok) throw new Error(`News provider returned ${upstream.status}`);
    const payload = await upstream.json();
    response.json((payload.data ?? []).map((story) => ({ title: story.title, body: story.description, source: story.source, publishedAt: story.published_at, imageUrl: story.image_url, url: story.url })));
  } catch (error) { response.status(503).json({ error: error.message }); }
});

app.get("/api/macro", async (_request, response) => {
  try {
    const key = requireKey("FRED_API_KEY");
    const api = `https://api.stlouisfed.org/fred/series/observations?series_id=DTWEXBGS&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=5`;
    const upstream = await fetch(api);
    if (!upstream.ok) throw new Error(`FRED returned ${upstream.status}`);
    response.json(await upstream.json());
  } catch (error) { response.status(503).json({ error: error.message }); }
});

app.listen(process.env.PORT || 3000, () => console.log(`Falcon News server listening on port ${process.env.PORT || 3000}`));
