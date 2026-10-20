// Latency report for a deployed site: API response times (p50/p95 over N runs) and real page loads in Chromium
// (TTFB, first contentful paint, largest contentful paint, load, bytes). Usage:
//   node tests/performance/latency.mjs [https://bettipspro.omodingisaac123.workers.dev] [runs=12]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const BASE = process.argv[2] ?? "https://bettipspro.omodingisaac123.workers.dev";
const RUNS = Number(process.argv[3] ?? 12);
const SAMPLE = "fdo%3Afx%3A575367";

const API = [
  "/api/v1/health", "/api/v1/config/public", "/api/v1/fixtures", "/api/v1/reports/overview", "/api/v1/statistics/models",
  `/api/v1/fixtures/${SAMPLE}/preview`, `/api/v1/fixtures/${SAMPLE}/report`, `/api/v1/fixtures/${SAMPLE}/markets/BTTS_YES_REGULATION/evidence`,
];
const PAGES = ["/", "/report", `/matches/${SAMPLE}`, `/matches/${SAMPLE}/markets/BTTS_YES_REGULATION`, "/matches"];

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

console.log(`Target ${BASE}, ${RUNS} runs per endpoint\n\nAPI (ms)                                                   p50    p95    max  status`);
const apiRows = [];
for (const path of API) {
  const t = [];
  let status = 0;
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    const r = await fetch(BASE + path);
    await r.arrayBuffer();
    t.push(performance.now() - s);
    status = r.status;
  }
  apiRows.push({ path, p50: pct(t, 50), p95: pct(t, 95), max: Math.max(...t), status });
  console.log(`${path.padEnd(58)} ${pct(t, 50).toFixed(0).padStart(5)} ${pct(t, 95).toFixed(0).padStart(6)} ${Math.max(...t).toFixed(0).padStart(6)}  ${status}`);
}

const { chromium } = require("@playwright/test");
const browser = await chromium.launch();
console.log(`\nPages (ms, cold = new browser context; warm = second load)     TTFB   FCP    LCP   load   KB`);
for (const path of PAGES) {
  for (const mode of ["cold", "warm"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    if (mode === "warm") await page.goto(BASE + path, { waitUntil: "networkidle" });
    let bytes = 0;
    page.on("response", async (r) => { try { bytes += (await r.body()).length; } catch { /* streamed */ } });
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    const m = await page.evaluate(() => new Promise((resolve) => {
      const nav = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
      let lcp = null;
      new PerformanceObserver((l) => { const e = l.getEntries(); lcp = e[e.length - 1]?.startTime ?? lcp; }).observe({ type: "largest-contentful-paint", buffered: true });
      setTimeout(() => resolve({ ttfb: nav.responseStart, fcp, lcp, load: nav.loadEventEnd }), 300);
    }));
    console.log(`${(path + " " + mode).padEnd(60)} ${m.ttfb.toFixed(0).padStart(5)} ${String(Math.round(m.fcp ?? 0)).padStart(5)} ${String(Math.round(m.lcp ?? 0)).padStart(6)} ${m.load.toFixed(0).padStart(6)} ${(bytes / 1024).toFixed(0).padStart(5)}`);
    await ctx.close();
  }
}
await browser.close();
