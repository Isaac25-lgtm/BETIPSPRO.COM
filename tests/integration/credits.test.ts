/**
 * Credit & entitlement guarantees, exercised against REAL local D1 (miniflare) - not a mock.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieOf, createTestEnv, setupUsers, type TestCtx } from "./harness.ts";

let t: TestCtx;
let admin: string;
let testers: Array<{ email: string; cookie: string }>;
let fixtureIds: string[];
let sampleId: string;

beforeAll(async () => {
  t = await createTestEnv({ seed: true });
  ({ admin, testers } = await setupUsers(t, 5));
  const rows = await t.env.DB.prepare("SELECT f.id, f.is_public_sample FROM fixtures f JOIN match_reports r ON r.fixture_id = f.id ORDER BY f.starts_at_utc, f.id").all<{ id: string; is_public_sample: number }>();
  sampleId = rows.results.find((r) => r.is_public_sample)!.id;
  fixtureIds = rows.results.filter((r) => !r.is_public_sample).map((r) => r.id);
});
afterAll(async () => { await t?.dispose(); });

const unlock = (cookie: string, id: string, key?: string) =>
  t.call(`/api/v1/fixtures/${encodeURIComponent(id)}/unlock`, { method: "POST", cookie, headers: key ? { "Idempotency-Key": key } : {} });
const balance = async (cookie: string) => (await t.call("/api/v1/me", { cookie })).body.data.credits as number;
const spends = async (userEmail: string) =>
  (await t.env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger l JOIN users u ON u.id = l.user_id WHERE u.email = ? AND l.kind = 'spend'").bind(userEmail).first<{ n: number }>())!.n;
const userId = async (email: string) => (await t.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>())!.id;

async function setBalance(email: string, target: number) {
  const current = await balance(testers.find((x) => x.email === email)!.cookie);
  if (current === target) return;
  const r = await t.call("/api/v1/admin/credits/grant", { cookie: admin, headers: { "Idempotency-Key": `test-${email}-${Date.now()}-${Math.random()}` }, json: { user_id: await userId(email), amount: target - current, reason: "test setup" } });
  expect(r.status).toBe(200);
}

describe("beta allocation", () => {
  it("exactly five testers, ten credits each, granted once", async () => {
    for (const tt of testers) expect(await balance(tt.cookie)).toBe(10);
    const grants = await t.env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'beta_grant'").first<{ n: number }>();
    expect(grants!.n).toBe(5);
    const sixth = await t.call("/api/v1/admin/invitations", { cookie: admin, json: { email: "sixth@example.test" } });
    expect(sixth.status).toBe(409);
    expect(sixth.body.error.message).toMatch(/limited to 5/);
  });
});

describe("unlock semantics", () => {
  it("one credit per match; reopening, other markets and logout/login cost nothing", async () => {
    const tt = testers[0];
    const id = fixtureIds[0];
    const r1 = await unlock(tt.cookie, id, "click-aaaaaaaa");
    expect(r1.status).toBe(201);
    expect(r1.body.data.charged).toBe(true);
    expect(await balance(tt.cookie)).toBe(9);
    // repeated clicks / retries
    const r2 = await unlock(tt.cookie, id, "click-aaaaaaaa");
    const r3 = await unlock(tt.cookie, id, "click-bbbbbbbb");
    expect(r2.body.data.charged).toBe(false);
    expect(r3.body.data.charged).toBe(false);
    // browse report + many markets
    expect((await t.call(`/api/v1/fixtures/${encodeURIComponent(id)}/report`, { cookie: tt.cookie })).status).toBe(200);
    for (const m of ["TOTAL_GOALS_UNDER_2_5_REGULATION", "BTTS_YES_REGULATION", "TOTAL_CORNERS_OVER_9_5_REGULATION", "TOTAL_YELLOW_CARDS_OVER_3_5_REGULATION", "MATCH_RESULT_DRAW_REGULATION"]) {
      expect((await t.call(`/api/v1/fixtures/${encodeURIComponent(id)}/markets/${m}/evidence`, { cookie: tt.cookie })).status).toBe(200);
    }
    // logout / login
    await t.call("/api/v1/auth/logout", { method: "POST", cookie: tt.cookie });
    const login = await t.call("/api/v1/auth/login", { json: { email: tt.email, password: "TesterPass123" } });
    tt.cookie = cookieOf(login.setCookie);
    expect((await t.call(`/api/v1/fixtures/${encodeURIComponent(id)}/report`, { cookie: tt.cookie })).status).toBe(200);
    expect(await balance(tt.cookie)).toBe(9);
    expect(await spends(tt.email)).toBe(1);
  });

  it("public sample report never costs a credit", async () => {
    const tt = testers[1];
    const r = await unlock(tt.cookie, sampleId);
    expect(r.body.data.charged).toBe(false);
    expect(r.body.data.free_reason).toBe("public_sample");
    expect(await balance(tt.cookie)).toBe(10);
  });

  it("each tester can unlock ten distinct reports; the eleventh is refused without charge", async () => {
    const tt = testers[2];
    for (let i = 0; i < 10; i++) expect((await unlock(tt.cookie, fixtureIds[i])).body.data.charged).toBe(true);
    expect(await balance(tt.cookie)).toBe(0);
    const r = await unlock(tt.cookie, fixtureIds[10]);
    expect(r.status).toBe(402);
    expect(r.body.error.code).toBe("INSUFFICIENT_CREDITS");
    expect(await balance(tt.cookie)).toBe(0);
    expect(await spends(tt.email)).toBe(10);
    // already-unlocked fixtures remain readable at zero balance
    expect((await t.call(`/api/v1/fixtures/${encodeURIComponent(fixtureIds[3])}/report`, { cookie: tt.cookie })).status).toBe(200);
    // not-unlocked fixture stays locked
    expect((await t.call(`/api/v1/fixtures/${encodeURIComponent(fixtureIds[10])}/report`, { cookie: tt.cookie })).status).toBe(403);
  });
});

describe("concurrency (mandatory atomicity test)", () => {
  it("wallet with ONE credit + two simultaneous DISTINCT unlocks: exactly one succeeds", async () => {
    const tt = testers[3];
    await setBalance(tt.email, 1);
    const [a, b] = await Promise.all([unlock(tt.cookie, fixtureIds[20]), unlock(tt.cookie, fixtureIds[21])]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 402]);
    expect(await balance(tt.cookie)).toBe(0);
    expect(await spends(tt.email)).toBe(1);
    const unlocks = await t.env.DB.prepare("SELECT COUNT(*) AS n FROM report_unlocks WHERE user_id = ?").bind(await userId(tt.email)).first<{ n: number }>();
    expect(unlocks!.n).toBe(1);
  });

  it("two simultaneous unlocks of the SAME fixture: at most one charge, both can view", async () => {
    const tt = testers[4];
    await setBalance(tt.email, 1);
    const [a, b] = await Promise.all([unlock(tt.cookie, fixtureIds[25], "same-key-1111"), unlock(tt.cookie, fixtureIds[25], "same-key-2222")]);
    expect([a.status, b.status].every((s) => s === 200 || s === 201)).toBe(true);
    expect([a.body.data.charged, b.body.data.charged].filter(Boolean).length).toBe(1);
    expect(await balance(tt.cookie)).toBe(0);
    expect(await spends(tt.email)).toBe(1);
    expect((await t.call(`/api/v1/fixtures/${encodeURIComponent(fixtureIds[25])}/report`, { cookie: tt.cookie })).status).toBe(200);
  });

  it("burst of 8 parallel clicks on one fixture plus 8 on others with 3 credits never overspends", async () => {
    const tt = testers[1];
    await setBalance(tt.email, 3);
    const before = await spends(tt.email);
    const reqs = [...Array.from({ length: 8 }, () => unlock(tt.cookie, fixtureIds[30])), ...Array.from({ length: 8 }, (_, i) => unlock(tt.cookie, fixtureIds[31 + i]))];
    const res = await Promise.all(reqs);
    const charged = res.filter((r) => r.body?.data?.charged).length;
    expect(charged).toBe(3);
    expect(await balance(tt.cookie)).toBe(0);
    expect((await spends(tt.email)) - before).toBe(3);
    const w = await t.env.DB.prepare("SELECT balance FROM wallets WHERE user_id = ?").bind(await userId(tt.email)).first<{ balance: number }>();
    expect(w!.balance).toBeGreaterThanOrEqual(0);
  });
});

describe("ledger integrity", () => {
  it("ledger is append-only (UPDATE and DELETE are rejected by triggers)", async () => {
    await expect(t.env.DB.prepare("UPDATE credit_ledger SET amount_signed = 100").run()).rejects.toThrow(/append-only/);
    await expect(t.env.DB.prepare("DELETE FROM credit_ledger").run()).rejects.toThrow(/append-only/);
  });

  it("wallet balance equals the sum of the ledger for every user", async () => {
    const rows = await t.env.DB.prepare(
      "SELECT w.user_id, w.balance, COALESCE((SELECT SUM(amount_signed) FROM credit_ledger l WHERE l.user_id = w.user_id), 0) AS ledger FROM wallets w",
    ).all<{ user_id: string; balance: number; ledger: number }>();
    for (const r of rows.results) expect(r.balance).toBe(r.ledger);
  });

  it("admin grants are idempotent on the Idempotency-Key", async () => {
    const tt = testers[0];
    const uid = await userId(tt.email);
    const key = "grant-idem-key-123";
    const a = await t.call("/api/v1/admin/credits/grant", { cookie: admin, headers: { "Idempotency-Key": key }, json: { user_id: uid, amount: 2, reason: "bonus" } });
    const b = await t.call("/api/v1/admin/credits/grant", { cookie: admin, headers: { "Idempotency-Key": key }, json: { user_id: uid, amount: 2, reason: "bonus" } });
    expect(a.body.data.duplicate).toBe(false);
    expect(b.body.data.duplicate).toBe(true);
    expect(await balance(tt.cookie)).toBe(11);
  });
});
