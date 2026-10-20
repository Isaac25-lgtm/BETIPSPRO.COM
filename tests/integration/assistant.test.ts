/**
 * Ask BetTipsPro AI: the data tools return only real forecast rows inside the requested range, and the chat
 * route is closed unless the assistant is enabled, a key exists and open access is on. DeepSeek is never called here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, type TestCtx } from "./harness.ts";
import { runTool } from "../../worker/services/assistant.ts";

let t: TestCtx;
beforeAll(async () => { t = await createTestEnv({ seed: true, openAccess: true }); });
afterAll(async () => { await t?.dispose(); });

describe("assistant tools", () => {
  it("find_markets returns markets inside the range, highest first, one per match", async () => {
    const r = (await runTool(t.env, "find_markets", { min_probability: 0.6, days_ahead: 10, limit: 25 })) as { results: Array<{ fixture_id: string; probability_pct: number; fair_odds: number }> };
    expect(r.results.length).toBeGreaterThan(0);
    for (const x of r.results) {
      expect(x.probability_pct).toBeGreaterThanOrEqual(60);
      expect(Math.abs(x.fair_odds - 100 / x.probability_pct)).toBeLessThan(0.02);
    }
    const ps = r.results.map((x) => x.probability_pct);
    expect([...ps].sort((a, b) => b - a)).toEqual(ps);
    expect(new Set(r.results.map((x) => x.fixture_id)).size).toBe(r.results.length);
  });

  it("list_matches and match_report return real fixtures and handle unknown teams", async () => {
    const l = (await runTool(t.env, "list_matches", { days_ahead: 10 })) as { results: Array<{ match: string }> };
    expect(l.results.length).toBeGreaterThan(0);
    const team = l.results[0].match.split(" vs ")[0];
    const rep = (await runTool(t.env, "match_report", { team })) as { found: boolean; probabilities_pct?: Record<string, number> };
    expect(rep.found).toBe(true);
    expect((await runTool(t.env, "match_report", { team: "No Such Team FC" }) as { found: boolean }).found).toBe(false);
  });
});

describe("assistant route", () => {
  it("is not available without a DeepSeek key", async () => {
    const r = await t.call("/api/v1/assistant/chat", { json: { messages: [{ role: "user", content: "hi" }] } });
    expect(r.status).toBe(404);
    expect((await t.call("/api/v1/config/public")).body.data.assistant_enabled).toBe(false);
  });
});
