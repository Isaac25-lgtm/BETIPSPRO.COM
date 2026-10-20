/**
 * Regression tests for the 2026-10-20 code reviews: each case reproduces a reported failure and asserts the fix.
 * Real local D1 (miniflare). DeepSeek is mocked; no provider is ever called.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, setupUsers, type TestCtx } from "./harness.ts";
import { allowedFacts, chat, rateLimit, verifyAnswer } from "../../worker/services/assistant.ts";
import { allowedNumbers, validateSummary } from "../../worker/services/ai/validate.ts";
import { componentGate } from "../../worker/services/evidence.ts";

let t: TestCtx;
let admin: string;
let tester: string;
beforeAll(async () => {
  t = await createTestEnv({ seed: true });
  const u = await setupUsers(t, 3);
  admin = u.admin;
  tester = u.testers[0].cookie;
});
afterAll(async () => { await t?.dispose(); });

const mockProvider = (replies: unknown[]) => {
  let i = 0;
  return (async () => new Response(JSON.stringify(replies[Math.min(i++, replies.length - 1)]), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
};
const say = (content: string) => ({ choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
const callTool = (name: string, args: Record<string, unknown>) => ({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name, arguments: JSON.stringify(args) } }] } }], usage: { prompt_tokens: 1000, completion_tokens: 50 } });

describe("publication integrity", () => {
  it("R-03: a late import with a back-dated run is never marked as published before kickoff", async () => {
    const fx = (await t.env.DB.prepare("SELECT id, starts_at_utc FROM fixtures WHERE status = 'FT' ORDER BY starts_at_utc LIMIT 1").first<{ id: string; starts_at_utc: string }>())!;
    const old = new Date(Date.parse(fx.starts_at_utc) - 86400_000).toISOString().replace(/\.\d+Z$/, "Z");
    const run = { section: "run", data_mode: "SIMULATED_DEMO", model_run: { id: "run:late-test", model_version: "late", pipeline_version: "p", dataset_hash: "sha256:x", generated_at: old, data_as_of_at: old, calibration_version: null, market_catalog_version: "x", config: {} }, backtest_run: { id: "run:late-test:bt", description: "x" } };
    expect((await t.call("/api/v1/admin/forecasts/import", { cookie: admin, json: run })).status).toBe(200);
    const r = await t.call("/api/v1/admin/forecasts/import", { cookie: admin, json: { section: "forecasts", model_run_id: "run:late-test", rows: [{ fixture_id: fx.id, market_id: "BTTS_YES_REGULATION", probability: 0.5, status: "SIMULATED_DEMO", quality_reason: null, uncertainty: {} }] } });
    expect(r.body.data.late).toBe(1);
    const row = await t.env.DB.prepare("SELECT is_pre_kickoff, published_at FROM forecasts WHERE model_run_id = 'run:late-test'").first<{ is_pre_kickoff: number; published_at: string }>();
    expect(row!.is_pre_kickoff).toBe(0); // can never count as a published pre-kickoff forecast
    expect(Date.parse(row!.published_at)).toBeGreaterThan(Date.parse(fx.starts_at_utc));
  });

  it("R-20: impossible dates and reversed ranges are refused by the schema", async () => {
    const bad = await t.call("/api/v1/admin/forecasts/import", { cookie: admin, json: { section: "forecasts", model_run_id: "run:late-test", rows: [{ fixture_id: "x", market_id: "BTTS_YES_REGULATION", probability: 0.5, status: "VERIFIED", quality_reason: null, uncertainty: { p05: 0.9, p95: 0.1 }, data_as_of_at: "2026-99-99T99:99:99Z" }] } });
    expect(bad.status).toBe(422);
  });

  it("R-13: forecasts cannot be deleted or have publication metadata changed; settlement fields can be set", async () => {
    const id = (await t.env.DB.prepare("SELECT id FROM forecasts LIMIT 1").first<{ id: string }>())!.id;
    await expect(t.env.DB.prepare("UPDATE forecasts SET status = 'STALE' WHERE id = ?").bind(id).run()).rejects.toThrow(/immutable/);
    await expect(t.env.DB.prepare("UPDATE forecasts SET is_pre_kickoff = 1 - is_pre_kickoff WHERE id = ?").bind(id).run()).rejects.toThrow(/immutable/);
    await expect(t.env.DB.prepare("UPDATE forecasts SET uncertainty_json = '{}' WHERE id = ?").bind(id).run()).rejects.toThrow(/immutable/);
    await expect(t.env.DB.prepare("DELETE FROM forecasts WHERE id = ?").bind(id).run()).rejects.toThrow(/append-only/);
    await t.env.DB.prepare("UPDATE forecasts SET settled_outcome = settled_outcome WHERE id = ?").bind(id).run();
  });

  it("R-05: a component whose probabilities are withheld also withholds its matrix", () => {
    const g = componentGate([{ market_id: "MATCH_RESULT_HOME_REGULATION", probability: null }, { market_id: "FIRST_HALF_GOALS_OVER_0_5", probability: 0.7 }]);
    const a = g.analysis({ scoreline_matrix: [[1]], ht_matrix: [[1]] });
    expect(a.scoreline_matrix).toBeNull();
    expect(a.ht_matrix).not.toBeNull();
    expect(g.family("goals_dixon_coles")).toBe(false);
  });
});

describe("business rules", () => {
  it("R-15: unlocking during open access never spends a credit", async () => {
    await t.env.DB.prepare("UPDATE app_config SET value_json = '{\"open\":true}' WHERE key = 'access'").run();
    const { resetAccessCache } = await import("../../worker/services/access.ts");
    resetAccessCache();
    const id = (await t.env.DB.prepare("SELECT f.id FROM fixtures f JOIN match_reports r ON r.fixture_id = f.id WHERE f.is_public_sample = 0 LIMIT 1").first<{ id: string }>())!.id;
    const before = (await t.call("/api/v1/me", { cookie: tester })).body.data.credits;
    const r = await t.call(`/api/v1/fixtures/${encodeURIComponent(id)}/unlock`, { method: "POST", cookie: tester, headers: { "Idempotency-Key": "open-access-unlock-1" } });
    expect(r.status).toBe(200);
    expect(r.body.data.charged).toBe(false);
    expect((await t.call("/api/v1/me", { cookie: tester })).body.data.credits).toBe(before);
    await t.env.DB.prepare("UPDATE app_config SET value_json = '{\"open\":false}' WHERE key = 'access'").run();
    resetAccessCache();
  });

  it("R-16: concurrent invitations never exceed the tester limit", async () => {
    // 3 testers exist; the limit is 5, so of 4 simultaneous invitations exactly 2 may succeed.
    const res = await Promise.all([1, 2, 3, 4].map((i) => t.call("/api/v1/admin/invitations", { cookie: admin, json: { email: `race${i}@example.test` } })));
    expect(res.filter((r) => r.status === 201).length).toBe(2);
  });
});

describe("summary checks", () => {
  it("R-10: invented records are rejected; numbers must come from the evidence", () => {
    expect(validateSummary("The home team won 9 of its last 10 matches.", allowedNumbers({ forecast: { probability: 0.5 } })).ok).toBe(false);
    expect(validateSummary("The model gives 50%; they won 6 of 8.", allowedNumbers({ forecast: { probability: 0.5 }, sets: [{ hits: 6, settled: 8 }] })).ok).toBe(true);
  });

  it("R-10: the admin import re-validates summaries on the server and stores failures as rejected", async () => {
    const fx = (await t.env.DB.prepare("SELECT r.fixture_id, r.report_version FROM match_reports r JOIN fixtures f ON f.id = r.fixture_id WHERE f.status = 'NS' LIMIT 1").first<{ fixture_id: string; report_version: string }>())!;
    const row = { fixture_id: fx.fixture_id, market_id: "BTTS_YES_REGULATION", report_version: fx.report_version, evidence_hash: "h1", model: "gemini-2.5-flash", input_tokens: 1, output_tokens: 1, cost_usd: 0,
      text_json: JSON.stringify({ summary: "Guaranteed profit: this side has a 99.9876% chance of winning tonight.", key_points: ["Guaranteed profit"] }) };
    const r = await t.call("/api/v1/admin/ai/import", { cookie: admin, json: { rows: [row] } });
    expect(r.body.data.rejected_by_server).toBe(1);
    const stored = await t.env.DB.prepare("SELECT text_json FROM ai_explanations WHERE evidence_hash = 'h1'").first<{ text_json: string }>();
    expect(JSON.parse(stored!.text_json).rejected).toBe(true);
  });
});

describe("assistant", () => {
  const env = () => ({ ...t.env, DEEPSEEK_API_KEY: "test", ASSISTANT_ENABLED: "true" });

  it("F-01: invented figures from the model are never shown", async () => {
    const r = await chat(env(), [{ role: "user", content: "Who wins?" }], mockProvider([say("Guaranteed profit: Invented United have a 99.9876% chance of winning.")]));
    expect(r.answer).not.toMatch(/99\.9876|Invented United|Guaranteed/);
    expect(r.verified).toBe("rendered_from_data");
  });

  it("F-01: after a real tool call, an invented number is replaced by an answer built from the tool rows", async () => {
    const r = await chat(env(), [{ role: "user", content: "List matches" }], mockProvider([callTool("list_matches", { days_ahead: 10 }), say("Invented United vs Nobody: 99.9876% [Open match](/matches/fake:id)")]));
    expect(r.answer).not.toMatch(/99\.9876|fake:id/);
    expect(r.tools_used).toContain("list_matches");
    expect(r.verified).toBe("rendered_from_data");
  });

  it("F-05: links are only allowed to fixtures the tools returned", () => {
    const facts = allowedFacts([{ results: [{ fixture_id: "fdo:fx:1", probability_pct: 55 }] }], "q");
    expect(verifyAnswer("A - 55% [Open match](/matches/fdo:fx:1)", facts)).toEqual([]);
    expect(verifyAnswer("[x](//example.test/out)", facts).length).toBeGreaterThan(0);
    expect(verifyAnswer("[x](/matches/fdo:fx:999)", facts).length).toBeGreaterThan(0);
  });

  it("F-02: simultaneous questions cannot exceed the hourly limit", async () => {
    const res = await Promise.allSettled(Array.from({ length: 36 }, () => rateLimit(t.env, "visitor-race")));
    expect(res.filter((r) => r.status === "fulfilled").length).toBe(30);
  });

  it("F-03: a provider call is refused when it would exceed the spending budget", async () => {
    const poor = { ...env(), ASSISTANT_DAILY_BUDGET_USD: "0.0000001" };
    await expect(chat(poor, [{ role: "user", content: "hi" }], mockProvider([say("hello")]))).rejects.toThrow(/spending limit/);
  });

  it("F-06: answers are capped so they can always be sent back as history", async () => {
    const long = "word ".repeat(1500);
    const r = await chat(env(), [{ role: "user", content: "hi" }], mockProvider([say(long)]));
    expect(r.answer.length).toBeLessThanOrEqual(1802);
  });
});
