import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieOf, createTestEnv, setupUsers, type TestCtx } from "../integration/harness.ts";
import { importSection } from "../../worker/services/importer.ts";

const FAKE_KEY = "fake-api-football-key-SHOULD-NEVER-APPEAR";
let t: TestCtx;
let admin: string;
let tester: string;
let lockedId: string;
const bodies: string[] = [];

beforeAll(async () => {
  t = await createTestEnv({ seed: true, vars: { API_FOOTBALL_KEY: FAKE_KEY } });
  const u = await setupUsers(t, 1);
  admin = u.admin;
  tester = u.testers[0].cookie;
  lockedId = (await t.env.DB.prepare("SELECT f.id FROM fixtures f JOIN match_reports r ON r.fixture_id = f.id WHERE f.is_public_sample = 0 LIMIT 1").first<{ id: string }>())!.id;
});
afterAll(async () => { await t?.dispose(); });

async function call(path: string, init?: Parameters<TestCtx["call"]>[1]) {
  const r = await t.call(path, init);
  bodies.push(typeof r.body === "string" ? r.body : JSON.stringify(r.body));
  return r;
}

describe("RBAC: admin endpoints are protected server-side", () => {
  const adminGets = ["/api/v1/admin/overview", "/api/v1/admin/testers", "/api/v1/admin/usage", "/api/v1/admin/config", "/api/v1/admin/export/history", "/api/v1/admin/audit", "/api/v1/admin/health/providers"];
  it("anonymous gets 401", async () => {
    for (const p of adminGets) expect((await call(p)).status).toBe(401);
  });
  it("tester gets 403", async () => {
    for (const p of adminGets) expect((await call(p, { cookie: tester })).status).toBe(403);
    expect((await call("/api/v1/admin/credits/grant", { cookie: tester, headers: { "Idempotency-Key": "abcdefghij" }, json: { user_id: "x", amount: 50, reason: "hack" } })).status).toBe(403);
    expect((await call("/api/v1/admin/invitations", { cookie: tester, json: { email: "a@b.co" } })).status).toBe(403);
    expect((await call("/api/v1/admin/forecasts/import", { cookie: tester, json: { section: "fixtures", rows: [] } })).status).toBe(403);
  });
  it("admin gets 200", async () => {
    for (const p of adminGets) expect((await call(p, { cookie: admin })).status).toBe(200);
  });
});

describe("CSRF", () => {
  it("rejects state-changing requests without the anti-CSRF header", async () => {
    const r = await t.call(`/api/v1/fixtures/${encodeURIComponent(lockedId)}/unlock`, { method: "POST", cookie: tester, headers: { "x-requested-with": "" } });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("CSRF_REJECTED");
  });
  it("rejects cross-origin requests", async () => {
    const r = await t.call("/api/v1/auth/logout", { method: "POST", cookie: tester, headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
  });
});

describe("report entitlement", () => {
  it("anonymous cannot read a locked report or evidence", async () => {
    expect((await call(`/api/v1/fixtures/${encodeURIComponent(lockedId)}/report`)).status).toBe(401);
    expect((await call(`/api/v1/fixtures/${encodeURIComponent(lockedId)}/markets/BTTS_YES_REGULATION/evidence`)).status).toBe(401);
  });
  it("a tester without the entitlement gets 403 and no probabilities", async () => {
    const r = await call(`/api/v1/fixtures/${encodeURIComponent(lockedId)}/report`, { cookie: tester });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toMatch(/"probability"/);
  });
  it("public preview never exposes non-featured probabilities", async () => {
    const r = await call(`/api/v1/fixtures/${encodeURIComponent(lockedId)}/preview`);
    expect(r.status).toBe(200);
    expect(r.body.data.markets.every((m: Record<string, unknown>) => !("probability" in m))).toBe(true);
  });
  it("credits cannot be set by the client", async () => {
    const r = await call("/api/v1/me/credits", { method: "POST", cookie: tester, json: { balance: 999 } });
    expect([404, 405]).toContain(r.status);
    expect((await call("/api/v1/me", { cookie: tester })).body.data.credits).toBe(10);
  });
});

describe("authentication", () => {
  it("admin bootstrap works only once", async () => {
    const r = await call("/api/v1/setup/admin", { json: { token: t.env.ADMIN_BOOTSTRAP_TOKEN, email: "second@example.test", display_name: "Second", password: "AnotherPass123" } });
    expect(r.status).toBe(409);
    const bad = await call("/api/v1/setup/admin", { json: { token: "wrong-token-value", email: "x@example.test", display_name: "Xavier", password: "AnotherPass123" } });
    expect(bad.status).toBe(403);
  });
  it("session cookie is HttpOnly + SameSite=Lax and only a hash is stored", async () => {
    const r = await t.call("/api/v1/auth/login", { json: { email: "tester1@example.test", password: "TesterPass123" } });
    expect(r.setCookie).toMatch(/HttpOnly/);
    expect(r.setCookie).toMatch(/SameSite=Lax/);
    const token = cookieOf(r.setCookie).split("=")[1];
    const raw = await t.env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = ?").bind(token).first<{ n: number }>();
    expect(raw!.n).toBe(0);
  });
  it("logout revokes the session server-side", async () => {
    const login = await t.call("/api/v1/auth/login", { json: { email: "tester1@example.test", password: "TesterPass123" } });
    const c = cookieOf(login.setCookie);
    expect((await t.call("/api/v1/me", { cookie: c })).body.data.user).not.toBeNull();
    await t.call("/api/v1/auth/logout", { method: "POST", cookie: c });
    expect((await t.call("/api/v1/me", { cookie: c })).body.data.user).toBeNull();
  });
  it("invite codes are one-use and email-bound", async () => {
    const inv = await call("/api/v1/admin/invitations", { cookie: admin, json: { email: "bound@example.test" } });
    expect(inv.status).toBe(201);
    const code = inv.body.data.code;
    const wrong = await call("/api/v1/auth/redeem-invite", { json: { code, email: "other@example.test", display_name: "Other", password: "SomePass1234", age_confirmed: true, privacy_consent: true } });
    expect(wrong.status).toBe(400);
    const noAge = await call("/api/v1/auth/redeem-invite", { json: { code, email: "bound@example.test", display_name: "Bound", password: "SomePass1234", age_confirmed: false, privacy_consent: true } });
    expect(noAge.status).toBe(422);
    const ok1 = await call("/api/v1/auth/redeem-invite", { json: { code, email: "bound@example.test", display_name: "Bound", password: "SomePass1234", age_confirmed: true, privacy_consent: true } });
    expect(ok1.status).toBe(201);
    const again = await call("/api/v1/auth/redeem-invite", { json: { code, email: "bound@example.test", display_name: "Bound", password: "SomePass1234", age_confirmed: true, privacy_consent: true } });
    expect(again.status).toBe(409);
    const stored = await t.env.DB.prepare("SELECT COUNT(*) AS n FROM beta_invites WHERE code_hash = ?").bind(code).first<{ n: number }>();
    expect(stored!.n).toBe(0); // only the hash is stored
  });
  it("login is rate limited after repeated failures", async () => {
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await t.call("/api/v1/auth/login", { json: { email: "tester1@example.test", password: "wrong-password" } })).status;
    expect(last).toBe(429);
  });
});

describe("data integrity", () => {
  it("forecasts are immutable", async () => {
    await expect(t.env.DB.prepare("UPDATE forecasts SET probability = 0.99 WHERE id = (SELECT id FROM forecasts LIMIT 1)").run()).rejects.toThrow(/immutable/);
  });
  it("importer rejects forecasts whose data cut-off is not before kickoff (leakage)", async () => {
    const f = (await t.env.DB.prepare("SELECT id, starts_at_utc FROM fixtures WHERE status = 'NS' LIMIT 1").first<{ id: string; starts_at_utc: string }>())!;
    const run = (await t.env.DB.prepare("SELECT id FROM model_runs WHERE json_extract(config_json, '$.kind') IS NULL LIMIT 1").first<{ id: string }>())!;
    const res = await importSection(t.env.DB, { section: "forecasts", model_run_id: run.id, rows: [{ fixture_id: f.id, market_id: "BTTS_YES_REGULATION", probability: 0.5, status: "RESEARCH", quality_reason: null, uncertainty: {}, data_as_of_at: f.starts_at_utc }] }, { actorId: null, now: new Date().toISOString() });
    expect(res.rejected[0].reason).toMatch(/leakage/);
    expect(res.written).toBe(0);
  });
});

describe("secrets", () => {
  it("no response ever contains a secret value", async () => {
    await call("/api/v1/admin/config", { cookie: admin });
    await call("/api/v1/admin/health/providers", { cookie: admin });
    await call("/api/v1/health");
    const all = bodies.join("\n");
    expect(all).not.toContain(FAKE_KEY);
    expect(all).not.toContain(t.env.SESSION_SECRET!);
    expect(all).not.toContain(t.env.ADMIN_BOOTSTRAP_TOKEN!);
  });
});
