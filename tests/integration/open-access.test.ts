/**
 * Testing-phase open access (D-026): every report readable without sign-in or credits; admin can switch it off,
 * which restores the lock exactly. Real local D1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, setupUsers, type TestCtx } from "./harness.ts";

let t: TestCtx;
let admin: string;
let tester: string;
let lockedId: string;

beforeAll(async () => {
  t = await createTestEnv({ seed: true, openAccess: true });
  const u = await setupUsers(t, 1);
  admin = u.admin;
  tester = u.testers[0].cookie;
  lockedId = (await t.env.DB.prepare("SELECT f.id FROM fixtures f JOIN match_reports r ON r.fixture_id = f.id WHERE f.is_public_sample = 0 LIMIT 1").first<{ id: string }>())!.id;
});
afterAll(async () => { await t?.dispose(); });

const report = (cookie?: string) => t.call(`/api/v1/fixtures/${encodeURIComponent(lockedId)}/report`, cookie ? { cookie } : {});

describe("open access", () => {
  it("lets anonymous visitors read any full report and its evidence", async () => {
    const r = await report();
    expect(r.status).toBe(200);
    expect(r.body.data.access).toBe("open");
    const ev = await t.call(`/api/v1/fixtures/${encodeURIComponent(lockedId)}/markets/MATCH_RESULT_HOME_REGULATION/evidence`);
    expect(ev.status).toBe(200);
  });

  it("does not spend credits when a signed-in tester reads a report", async () => {
    const before = (await t.call("/api/v1/me", { cookie: tester })).body.data.credits;
    expect((await report(tester)).status).toBe(200);
    expect((await t.call("/api/v1/me", { cookie: tester })).body.data.credits).toBe(before);
  });

  it("publishes the flag and headline probabilities in the overview", async () => {
    expect((await t.call("/api/v1/config/public")).body.data.open_access).toBe(true);
    const o = (await t.call("/api/v1/reports/overview")).body.data;
    expect(o.open_access).toBe(true);
    expect(o.matches.length).toBeGreaterThan(0);
    const withProbs = o.matches.filter((m: any) => m.probabilities?.home != null);
    expect(withProbs.length).toBeGreaterThan(0);
    for (const m of withProbs) expect(Math.abs(m.probabilities.home + m.probabilities.draw + m.probabilities.away - 1)).toBeLessThan(0.01);
  });

  it("only an admin can switch it, and switching off restores the lock", async () => {
    expect((await t.call("/api/v1/admin/config/access", { method: "PUT", cookie: tester, json: { open: false } })).status).toBe(403);
    expect((await t.call("/api/v1/admin/config/access", { method: "PUT", cookie: admin, json: { open: false } })).status).toBe(200);
    expect((await report()).status).toBe(401);
    expect((await report(tester)).status).toBe(403);
    const o = (await t.call("/api/v1/reports/overview")).body.data;
    expect(o.matches.filter((m: any) => !m.is_public_sample).every((m: any) => m.probabilities === null)).toBe(true);
    expect((await t.call("/api/v1/admin/config/access", { method: "PUT", cookie: admin, json: { open: true } })).status).toBe(200);
    expect((await report()).status).toBe(200);
  });
});
