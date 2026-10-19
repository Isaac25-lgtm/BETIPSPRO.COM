// Capture visual-review screenshots. Usage: node scripts/screenshots.mjs [baseUrl] [pathsCsv]
// Writes artifacts/visual-review/<name>-<w>x<h>.png
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:5173";
const only = process.argv[3]?.split(",");
const out = "artifacts/visual-review";
mkdirSync(out, { recursive: true });

const pages = [
  ["home", "/"],
  ["matches", "/matches"],
  ["match-sample", "__SAMPLE__"],
  ["evidence-sample", "__SAMPLE_EVIDENCE__"],
  ["statistics", "/statistics"],
  ["leagues", "/leagues"],
];
const viewports = [
  [1536, 1024],
  [390, 844],
  [360, 780],
  [768, 1024],
];

const browser = await chromium.launch();
const ctx0 = await browser.newContext();
const api = await ctx0.request.get(`${base}/api/v1/fixtures`);
const list = (await api.json()).data.items;
const sample = list.find((f) => f.is_public_sample) ?? list[0];
await ctx0.close();

for (const [w, h] of viewports) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [name, p] of pages) {
    if (only && !only.includes(name)) continue;
    const path = p === "__SAMPLE__" ? `/matches/${encodeURIComponent(sample.id)}` : p === "__SAMPLE_EVIDENCE__" ? `/matches/${encodeURIComponent(sample.id)}/markets/TOTAL_GOALS_UNDER_2_5_REGULATION` : p;
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `${out}/${name}-${w}x${h}.png`, fullPage: false });
    if (name === "home" || w < 800) await page.screenshot({ path: `${out}/${name}-${w}x${h}-full.png`, fullPage: true });
    console.log(`${name} ${w}x${h}${overflow > 0 ? `  HORIZONTAL OVERFLOW ${overflow}px` : ""}`);
  }
  await ctx.close();
}
await browser.close();
