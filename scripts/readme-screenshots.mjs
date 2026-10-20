// Curated README screenshots -> docs/screenshots/*.jpg (synthetic demo data only).
// Usage: node scripts/readme-screenshots.mjs [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:5173";
const out = "docs/screenshots";
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const list = (await (await fetch(`${base}/api/v1/fixtures`)).json()).data.items;
const sample = list.find((f) => f.is_public_sample) ?? list[0];
const match = `/matches/${encodeURIComponent(sample.id)}`;
const shots = [
  ["home-desktop", "/", 1536, 1024, 1, false],
  ["home-mobile", "/", 390, 844, 2, false],
  ["report-showcase", "/", 1536, 900, 1, "showcase"],
  ["match-centre", match, 1440, 900, 1, false],
  ["market-evidence", `${match}/markets/TOTAL_GOALS_UNDER_2_5_REGULATION`, 1440, 1000, 1, false],
  ["matches-mobile", "/matches", 390, 844, 2, false],
];
for (const [name, path, w, h, dpr, scrollTo] of shots) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await p.goto(base + path, { waitUntil: "networkidle" });
  await p.waitForTimeout(600);
  if (scrollTo) {
    await p.locator(`.${scrollTo}`).scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
    await p.locator(`.${scrollTo}`).screenshot({ path: `${out}/${name}.jpg`, type: "jpeg", quality: 82 });
  } else {
    await p.screenshot({ path: `${out}/${name}.jpg`, type: "jpeg", quality: 82 });
  }
  await p.close();
  console.log("wrote", name);
}
await b.close();
