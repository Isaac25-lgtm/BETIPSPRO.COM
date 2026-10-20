/**
 * Provider budget gateway: hard caps enforced atomically in real D1, snapshots reused,
 * and normal report browsing produces ZERO upstream calls.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, setupUsers, type TestCtx } from "./harness.ts";
import { admit, meteredGet } from "../../worker/services/sports/budget.ts";

const KEY = "unit-test-key-xyz";
let t: TestCtx;
let calls: string[] = [];
const okBody = (n = 0) => JSON.stringify({ get: "fixtures", parameters: {}, errors: [], results: n, paging: { current: 1, total: 1 }, response: [] });
const fakeFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  calls.push(String(url));
  expect((init?.headers as Record<string, string>)["x-apisports-key"]).toBe(KEY);
  return new Response(okBody(), { status: 200, headers: { "x-ratelimit-requests-limit": "100", "x-ratelimit-requests-remaining": "90" } });
}) as typeof fetch;

beforeAll(async () => {
  t = await createTestEnv({ seed: true, vars: { API_FOOTBALL_KEY: KEY, SPORTS_PROVIDER: "api_football", SPORTS_API_DAILY_BUDGET: "12", SPORTS_API_DAILY_HARD_CAP: "15", SPORTS_API_PER_MINUTE_MAX: "10" } });
});
afterAll(async () => { await t?.dispose(); });

describe("budget gateway", () => {
  it("reuses a fresh snapshot instead of calling upstream", async () => {
    calls = [];
    const a = await meteredGet(t.env, "/fixtures", { date: "2026-01-01" }, { ttlSec: 3600, fetchImpl: fakeFetch });
    const b = await meteredGet(t.env, "/fixtures", { date: "2026-01-01" }, { ttlSec: 3600, fetchImpl: fakeFetch });
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(calls.length).toBe(1);
  });

  it("per-minute window stops at the configured limit", async () => {
    // Pinned clock (fresh day + minute) so the test can never straddle a real minute boundary.
    const at = new Date("2030-01-01T10:00:30Z");
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => admit(t.env, "normal", at)));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(10);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.code === "RATE_LIMITED")).toBe(true);
    const used = await t.env.DB.prepare("SELECT used FROM provider_rate_windows WHERE minute_bucket = ?").bind("2030-01-01T10:00").first<{ used: number }>();
    expect(used!.used).toBe(10);
  });

  it("daily operational budget refuses further calls; reserve priority may use the remainder up to the hard cap", async () => {
    await t.env.DB.prepare("DELETE FROM provider_rate_windows").run();
    await t.env.DB.prepare("UPDATE provider_quota SET used = 11").run();
    await admit(t.env); // 12th = budget
    await expect(admit(t.env)).rejects.toMatchObject({ code: "BUDGET_EXHAUSTED" });
    await admit(t.env, "reserve"); // 13
    await admit(t.env, "reserve"); // 14
    await admit(t.env, "reserve"); // 15 = hard cap
    await expect(admit(t.env, "reserve")).rejects.toMatchObject({ code: "BUDGET_EXHAUSTED" });
    const q = await t.env.DB.prepare("SELECT used FROM provider_quota").first<{ used: number }>();
    expect(q!.used).toBe(15);
  });

  it("an exhausted budget means no network request is made", async () => {
    calls = [];
    await expect(meteredGet(t.env, "/fixtures", { date: "2026-02-02" }, { ttlSec: 0, fetchImpl: fakeFetch })).rejects.toMatchObject({ code: "BUDGET_EXHAUSTED" });
    expect(calls.length).toBe(0);
  });

  it("usage log never contains the key", async () => {
    const rows = await t.env.DB.prepare("SELECT * FROM provider_api_usage").all();
    expect(JSON.stringify(rows.results)).not.toContain(KEY);
  });

  it("report and evidence views trigger zero provider calls", async () => {
    const before = (await t.env.DB.prepare("SELECT COUNT(*) AS n FROM provider_api_usage").first<{ n: number }>())!.n;
    const { testers } = await setupUsers(t, 1);
    const sample = (await t.env.DB.prepare("SELECT id FROM fixtures WHERE is_public_sample = 1").first<{ id: string }>())!.id;
    for (let i = 0; i < 3; i++) {
      await t.call(`/api/v1/fixtures/${encodeURIComponent(sample)}/report`, { cookie: testers[0].cookie });
      await t.call(`/api/v1/fixtures/${encodeURIComponent(sample)}/markets/BTTS_YES_REGULATION/evidence`);
      await t.call("/api/v1/fixtures");
    }
    const after = (await t.env.DB.prepare("SELECT COUNT(*) AS n FROM provider_api_usage").first<{ n: number }>())!.n;
    expect(after).toBe(before);
  });
});
