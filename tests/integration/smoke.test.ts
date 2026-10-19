import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, setupUsers, type TestCtx } from "./harness.ts";

let t: TestCtx;
beforeAll(async () => { t = await createTestEnv({ seed: true }); });
afterAll(async () => { await t?.dispose(); });

describe("API smoke (real local D1)", () => {
  it("health + public fixtures + preview + sample report", async () => {
    const h = await t.call("/api/v1/health");
    expect(h.status).toBe(200);
    expect(h.body.data.data_mode).toBe("DEMO");
    const list = await t.call("/api/v1/fixtures");
    expect(list.status).toBe(200);
    expect(list.body.data.items.length).toBeGreaterThan(0);
    const fx = list.body.data.items[0];
    expect(fx.is_synthetic).toBe(true);
    expect(fx.featured?.probability).toBeGreaterThan(0);
    const prev = await t.call(`/api/v1/fixtures/${encodeURIComponent(fx.id)}/preview`);
    expect(prev.status).toBe(200);
    expect(prev.body.data.markets.length).toBe(56);
    const sample = list.body.data.items.find((x: any) => x.is_public_sample);
    const rep = await t.call(`/api/v1/fixtures/${encodeURIComponent(sample.id)}/report`);
    expect(rep.status).toBe(200);
    expect(rep.body.data.display_notice).toMatch(/SYNTHETIC/);
    const ev = await t.call(`/api/v1/fixtures/${encodeURIComponent(sample.id)}/markets/TOTAL_GOALS_UNDER_2_5_REGULATION/evidence`);
    expect(ev.status).toBe(200);
    expect(ev.body.data.observed_evidence[0].rows.length).toBeGreaterThan(0);
  });

  it("users can be set up", async () => {
    const { testers } = await setupUsers(t, 2);
    const me = await t.call("/api/v1/me", { cookie: testers[0].cookie });
    expect(me.body.data.credits).toBe(10);
  });
});
