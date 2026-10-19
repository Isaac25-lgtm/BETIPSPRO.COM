// Debug helper: list elements wider than the viewport. Usage: node scripts/find-overflow.mjs <url> [width]
import { chromium } from "@playwright/test";
const url = process.argv[2];
const width = Number(process.argv[3] ?? 390);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width, height: 844 } });
await p.goto(url, { waitUntil: "networkidle" });
const res = await p.evaluate((w) => {
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.right > w + 1 && r.width > 0) {
      const parentOver = el.parentElement && el.parentElement.getBoundingClientRect().right > w + 1;
      if (!parentOver || out.length < 3) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
    }
  }
  return out.slice(0, 15);
}, width);
console.log(res.join("\n"));
await b.close();
