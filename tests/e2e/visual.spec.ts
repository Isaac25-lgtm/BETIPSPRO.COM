/** Visual QA: screenshots at the reference viewport + mobile breakpoints; asserts no horizontal page scroll. */
import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  [1536, 1024], [1280, 800], [1024, 768], [768, 1024], [430, 932], [414, 896], [390, 844], [360, 780], [320, 640], [844, 390],
] as const;
const PAGES = [["home", "/"], ["matches", "/matches"], ["leagues", "/leagues"], ["statistics", "/statistics"], ["archive", "/predictions/archive"], ["how", "/research/how-it-works"], ["login", "/login"], ["join", "/join"]] as const;

for (const [w, h] of VIEWPORTS) {
  test(`no horizontal overflow at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const list = await (await page.request.get("/api/v1/fixtures")).json();
    const sample = list.data.items.find((f: { is_public_sample: boolean }) => f.is_public_sample);
    const all: Array<readonly [string, string]> = [...PAGES, ["match", `/matches/${encodeURIComponent(sample.id)}`], ["evidence", `/matches/${encodeURIComponent(sample.id)}/markets/TOTAL_CORNERS_OVER_9_5_REGULATION`]];
    for (const [name, path] of all) {
      await page.goto(path, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${name} overflows at ${w}px`).toBeLessThanOrEqual(0);
      if (w === 1536 || w === 390 || w === 360 || w === 768) await page.screenshot({ path: `artifacts/visual-review/e2e-${name}-${w}x${h}.png` });
    }
  });
}

test("touch targets on mobile nav and tabs are at least 44px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  for (const sel of [".tab", ".nav-burger", ".hero-cta"]) {
    const box = await page.locator(sel).first().boundingBox();
    expect(box!.height, sel).toBeGreaterThanOrEqual(44);
  }
});
