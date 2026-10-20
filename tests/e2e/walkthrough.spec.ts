/**
 * Owner's acceptance walkthrough (section 25.3):
 * homepage -> fixture -> locked market -> unlock once -> evidence -> other markets free ->
 * reopen after logout/login -> feedback.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";

const vars = Object.fromEntries(readFileSync(".dev.vars", "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const H = { "x-requested-with": "fip" };
const TESTER = { email: "walkthrough@example.test", password: "Walkthrough123" };

async function adminInvite(request: APIRequestContext, email: string) {
  await request.post("/api/v1/setup/admin", { headers: H, data: { token: vars.ADMIN_BOOTSTRAP_TOKEN, email: "e2e-admin@example.test", display_name: "E2E Admin", password: "E2eAdminPass123" } });
  const login = await request.post("/api/v1/auth/login", { headers: H, data: { email: "e2e-admin@example.test", password: "E2eAdminPass123" } });
  expect(login.ok()).toBeTruthy();
  const inv = await request.post("/api/v1/admin/invitations", { headers: H, data: { email } });
  expect(inv.status()).toBe(201);
  const code = (await inv.json()).data.code as string;
  await request.post("/api/v1/auth/logout", { headers: H });
  return code;
}

test("full beta walkthrough", async ({ page, request }) => {
  const code = await adminInvite(request, TESTER.email);

  // Homepage reproduces the reference structure and labels demo data.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Smarter match insights/i })).toBeVisible();
  await expect(page.getByText(/Demo build · fictional teams and data/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /(Today.s|Upcoming) match insights/i })).toBeVisible();
  await expect(page.locator(".insight-row")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: /Full match reports/i })).toBeVisible();
  await expect(page.getByText(/Verified live forecasts/i)).toBeVisible();

  // Accept the invitation through the real UI.
  await page.goto(`/join?email=${encodeURIComponent(TESTER.email)}`);
  await page.getByLabel("Invitation code").fill(code);
  await page.getByLabel("Display name").fill("Walk Through");
  await page.getByLabel("Password").fill(TESTER.password);
  await page.getByLabel(/18 years or older/).check();
  await page.getByLabel(/accept the/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/10 free report credits/)).toBeVisible();

  // Open a non-sample fixture from the homepage table.
  await page.goto("/");
  const rows = page.locator(".insight-row a.match-cell");
  await rows.nth(1).click();
  await expect(page.locator(".mode-banner")).toContainText("fictional");
  await expect(page.getByRole("heading", { name: "Unlock the full match report" })).toBeVisible();
  await page.getByRole("tab", { name: /Markets/ }).click();
  await expect(page.locator(".market-row.locked").first()).toBeVisible();
  const matchUrl = page.url().split("?")[0];

  // Unlock exactly once.
  await page.getByRole("button", { name: /Unlock report/ }).click();
  await expect(page.locator(".unlock-note")).toContainText("1 credit used, 9 left");
  await expect(page.getByRole("heading", { name: "All markets" })).toBeVisible();

  // Evidence page with traceable rows.
  await page.locator("a.market-row", { hasText: "Under 2.5" }).first().click();
  await expect(page.getByRole("heading", { name: "Total goals: Under 2.5", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Observed evidence" })).toBeVisible();
  await expect(page.locator(".ev-table tbody tr").first()).toBeVisible();
  await expect(page.getByText("Settlement definition")).toBeVisible();

  // Other markets cost nothing.
  await page.locator(".sibling-markets a", { hasText: "Over 3.5 Goals" }).click();
  await expect(page.getByRole("heading", { name: "Total goals: Over 3.5", exact: true })).toBeVisible();
  const me = await (await page.request.get("/api/v1/me")).json();
  expect(me.data.credits).toBe(9);

  // Logout, login, reopen: still unlocked, still 9 credits.
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto(`/login?next=${encodeURIComponent(new URL(matchUrl).pathname)}`);
  await page.getByLabel("Email").fill(TESTER.email);
  await page.getByLabel("Password").fill(TESTER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Probability summary" })).toBeVisible();
  expect((await (await page.request.get("/api/v1/me")).json()).data.credits).toBe(9);

  // Feedback.
  await page.goto("/app/feedback");
  await page.getByLabel("How useful was the analysis for your research?").fill("Evidence tables are clear.");
  await page.getByLabel("Anything else? (required)").fill("End-to-end walkthrough feedback.");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByText("Thank you! Your feedback was recorded.")).toBeVisible();
});

test("free sample report is open without login and costs nothing", async ({ page }) => {
  await page.goto("/matches");
  await page.locator(".fixture-row", { has: page.locator(".pill", { hasText: "Free" }) }).first().click();
  await expect(page.getByText(/free sample report/i).first()).toBeVisible();
  await page.getByRole("tab", { name: "Goals" }).click();
  await expect(page.locator("figcaption", { hasText: "Scoreline distribution (model)" })).toBeVisible();
});

test("matches calendar search and filters work", async ({ page }) => {
  await page.goto("/matches");
  await expect(page.locator(".fixture-group").first()).toBeVisible();
  await page.getByRole("searchbox").fill("Northbridge");
  await expect(page.getByText(/Showing results for/)).toBeVisible();
  await expect(page.locator(".fixture-row").first()).toContainText("Northbridge");
  await page.getByRole("searchbox").fill("");
  await page.getByRole("button", { name: "Finished" }).click();
  await expect(page).toHaveURL(/status=finished/);
});

test("admin console is protected", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
  const res = await page.request.get("/api/v1/admin/overview");
  expect(res.status()).toBe(401);
});
