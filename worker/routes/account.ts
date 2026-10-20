import { Hono, type Context } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { z } from "zod";
import type { AppBindings } from "../env.ts";
import { ApiError, ok } from "../lib/http.ts";
import { newId } from "../lib/crypto.ts";
import { nowIso } from "../lib/time.ts";
import { ipHash, requireUser, verifyTurnstile } from "../middleware/index.ts";
import {
  bootstrapAdmin, checkRateLimit, createSession, login, recordAttempt, redeemInvite, revokeAllSessions, revokeSession, SESSION_COOKIE, sessionCookie,
} from "../services/auth.ts";
import { ENTITLEMENT_SCOPE, getBalance, hasEntitlement, unlockReport } from "../services/credits.ts";
import { openAccess } from "../services/access.ts";
import { fullReport, marketEvidence } from "../services/evidence.ts";
import { cached } from "../services/cache.ts";
import { cachedSummary } from "../services/ai/gemini.ts";

export const accountRoutes = new Hono<AppBindings>();

async function body<T extends z.ZodTypeAny>(c: Context<AppBindings>, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be JSON.");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(422, "VALIDATION_FAILED", "Please check the highlighted fields.", r.error.flatten());
  return r.data;
}

async function startSession(c: Context<AppBindings>, userId: string) {
  const { token } = await createSession(c.env, userId, c.req.header("user-agent") ?? null);
  c.header("Set-Cookie", sessionCookie(token, new URL(c.req.url).protocol === "https:"));
}

// ------------------------------------------------------------------ auth

const Email = z.string().trim().toLowerCase().email().max(200);

accountRoutes.post("/setup/admin", async (c) => {
  const b = await body(c, z.object({ token: z.string().min(1).max(500), email: Email, display_name: z.string().trim().min(2).max(60), password: z.string().max(200) }));
  await checkRateLimit(c.env, `bootstrap:${await ipHash(c)}`, 5, 60);
  await recordAttempt(c.env, `bootstrap:${await ipHash(c)}`);
  const id = await bootstrapAdmin(c.env, b.token, b.email, b.display_name, b.password);
  return ok(c, { user_id: id }, { status: 201 });
});

accountRoutes.post("/auth/login", async (c) => {
  const b = await body(c, z.object({ email: Email, password: z.string().min(1).max(200) }));
  const userId = await login(c.env, b.email, b.password, await ipHash(c));
  await startSession(c, userId);
  return ok(c, { signed_in: true });
});

accountRoutes.post("/auth/redeem-invite", async (c) => {
  const b = await body(c, z.object({
    code: z.string().trim().min(6).max(40), email: Email, display_name: z.string().trim().min(2).max(60), password: z.string().max(200),
    age_confirmed: z.boolean(), privacy_consent: z.boolean(), turnstile_token: z.string().max(4000).optional(),
  }));
  await verifyTurnstile(c, b.turnstile_token);
  const userId = await redeemInvite(c.env, { code: b.code, email: b.email, displayName: b.display_name, password: b.password, ageConfirmed: b.age_confirmed, privacyConsent: b.privacy_consent }, await ipHash(c));
  await startSession(c, userId);
  return ok(c, { signed_in: true, credits: await getBalance(c.env, userId) }, { status: 201 });
});

accountRoutes.post("/auth/logout", async (c) => {
  const u = c.get("user");
  if (u) await revokeSession(c.env, u.session_id);
  if (getCookie(c, SESSION_COOKIE)) deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return ok(c, { signed_out: true });
});

// ------------------------------------------------------------------ me

accountRoutes.get("/me", async (c) => {
  const u = c.get("user");
  if (!u) return ok(c, { user: null });
  const [w, unlocks] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare("SELECT balance FROM wallets WHERE user_id = ?").bind(u.id),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM report_unlocks WHERE user_id = ?").bind(u.id),
  ]);
  return ok(c, {
    user: { id: u.id, email: u.email, display_name: u.display_name, role: u.role, age_confirmed_at: u.age_confirmed_at, privacy_consent_at: u.privacy_consent_at },
    credits: (w.results[0]?.balance as number) ?? 0,
    unlocked_reports: (unlocks.results[0]?.n as number) ?? 0,
  });
});

accountRoutes.get("/me/credits", async (c) => {
  const u = requireUser(c);
  const ledger = await c.env.DB.prepare("SELECT id, amount_signed, kind, reason, created_at, metadata_json FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 200").bind(u.id).all<Record<string, unknown>>();
  return ok(c, {
    balance: await getBalance(c.env, u.id),
    ledger: ledger.results.map((l) => ({ ...l, metadata: JSON.parse((l.metadata_json as string) ?? "{}"), metadata_json: undefined })),
    policy: { entitlement_scope: ENTITLEMENT_SCOPE, expiry: c.env.BETA_CREDITS_EXPIRE === "true" ? "configured" : "no expiry during the beta period", unit: "1 credit = 1 full match report (all supported markets, all report revisions)" },
  });
});

accountRoutes.get("/me/unlocks", async (c) => {
  const u = requireUser(c);
  const rows = await c.env.DB.prepare(
    `SELECT u.fixture_id, u.unlocked_at, f.starts_at_utc, f.status, f.home_goals, f.away_goals, f.is_synthetic, c.short_name AS competition, h.name AS home, a.name AS away
       FROM report_unlocks u JOIN fixtures f ON f.id = u.fixture_id JOIN competitions c ON c.id = f.competition_id
       JOIN teams h ON h.id = f.home_team_id JOIN teams a ON a.id = f.away_team_id
      WHERE u.user_id = ? ORDER BY u.unlocked_at DESC`,
  ).bind(u.id).all<Record<string, unknown>>();
  return ok(c, { items: rows.results.map((r) => ({ ...r, is_synthetic: !!r.is_synthetic })) });
});

accountRoutes.get("/me/saved", async (c) => {
  const u = requireUser(c);
  const rows = await c.env.DB.prepare("SELECT fixture_id, created_at FROM saved_fixtures WHERE user_id = ? ORDER BY created_at DESC").bind(u.id).all();
  return ok(c, { items: rows.results });
});

accountRoutes.post("/me/saved/:fixtureId", async (c) => {
  const u = requireUser(c);
  const fid = c.req.param("fixtureId");
  const exists = await c.env.DB.prepare("SELECT 1 FROM fixtures WHERE id = ?").bind(fid).first();
  if (!exists) throw new ApiError(404, "NOT_FOUND", "Fixture not found.");
  await c.env.DB.prepare("INSERT OR IGNORE INTO saved_fixtures (user_id, fixture_id, created_at) VALUES (?, ?, ?)").bind(u.id, fid, nowIso()).run();
  return ok(c, { saved: true });
});

accountRoutes.delete("/me/saved/:fixtureId", async (c) => {
  const u = requireUser(c);
  await c.env.DB.prepare("DELETE FROM saved_fixtures WHERE user_id = ? AND fixture_id = ?").bind(u.id, c.req.param("fixtureId")).run();
  return ok(c, { saved: false });
});

accountRoutes.post("/me/sessions/revoke-all", async (c) => {
  const u = requireUser(c);
  await revokeAllSessions(c.env, u.id);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return ok(c, { revoked: true });
});

accountRoutes.post("/me/data-request", async (c) => {
  const u = requireUser(c);
  const b = await body(c, z.object({ kind: z.enum(["export", "delete"]) }));
  const open = await c.env.DB.prepare("SELECT id FROM data_requests WHERE user_id = ? AND kind = ? AND status = 'open'").bind(u.id, b.kind).first();
  if (!open) await c.env.DB.prepare("INSERT INTO data_requests (id, user_id, kind, status, created_at) VALUES (?, ?, ?, 'open', ?)").bind(newId("dsr"), u.id, b.kind, nowIso()).run();
  return ok(c, { recorded: true, note: "The administrator processes data requests manually during the beta (target: within 30 days)." }, { status: 202 });
});

// ------------------------------------------------------------------ reports & evidence

async function canView(c: Context<AppBindings>, fixtureId: string): Promise<"sample" | "admin" | "entitled" | "open"> {
  const f = await c.env.DB.prepare("SELECT is_public_sample FROM fixtures WHERE id = ?").bind(fixtureId).first<{ is_public_sample: number }>();
  if (!f) throw new ApiError(404, "NOT_FOUND", "Fixture not found.");
  if (f.is_public_sample) return "sample";
  const u = c.get("user");
  if (u?.role === "admin") return "admin";
  // Testing phase: everyone can read every report without credits (D-026).
  if (await openAccess(c.env)) return "open";
  if (!u) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to view this report.");
  if (await hasEntitlement(c.env, u.id, fixtureId)) return "entitled";
  throw new ApiError(403, "REPORT_LOCKED", "Unlock this match report to view its full analysis (1 credit; all markets included).", { balance: await getBalance(c.env, u.id) });
}

accountRoutes.post("/fixtures/:id/unlock", async (c) => {
  const u = requireUser(c);
  if (!u.age_confirmed_at) throw new ApiError(403, "FORBIDDEN", "Please confirm you are 18+ in settings before unlocking reports.");
  const key = c.req.header("idempotency-key") ?? null;
  if (key && (key.length < 8 || key.length > 100)) throw new ApiError(400, "BAD_REQUEST", "Invalid Idempotency-Key.");
  const res = await unlockReport(c.env, u.id, c.req.param("id"), key);
  return ok(c, res, { status: res.charged ? 201 : 200 });
});

accountRoutes.get("/fixtures/:id/report", async (c) => {
  const id = c.req.param("id");
  const access = await canView(c, id);
  const v = await c.env.DB.prepare("SELECT report_version FROM match_reports WHERE fixture_id = ? ORDER BY generated_at DESC LIMIT 1").bind(id).first<{ report_version: string }>();
  if (!v) throw new ApiError(409, "REPORT_UNAVAILABLE", "No report has been prepared for this fixture.");
  const { value, hit } = await cached(`report:${id}:${v.report_version}`, 600, () => fullReport(c.env, id));
  c.header("X-Cache", hit);
  return ok(c, { ...value, access });
});

accountRoutes.get("/fixtures/:id/markets/:marketId/evidence", async (c) => {
  const id = c.req.param("id");
  const marketId = c.req.param("marketId");
  const access = await canView(c, id);
  const v = await c.env.DB.prepare("SELECT report_version FROM match_reports WHERE fixture_id = ? ORDER BY generated_at DESC LIMIT 1").bind(id).first<{ report_version: string }>();
  if (!v) throw new ApiError(409, "REPORT_UNAVAILABLE", "No report has been prepared for this fixture.");
  const { value, hit } = await cached(`evidence:${id}:${marketId}:${v.report_version}`, 600, () => marketEvidence(c.env, id, marketId));
  const ai = c.env.AI_EXPLANATIONS_ENABLED === "true" ? await cachedSummary(c.env, id, marketId, v.report_version) : null;
  c.header("X-Cache", hit);
  return ok(c, { ...value, ai_summary: ai, access });
});

// ------------------------------------------------------------------ feedback

const Answer = z.string().trim().max(1000).optional();
accountRoutes.post("/feedback", async (c) => {
  const u = requireUser(c);
  const b = await body(c, z.object({
    fixture_id: z.string().max(160).nullable().optional(),
    rating: z.number().int().min(1).max(5),
    category: z.enum(["general", "bug", "inaccuracy", "design", "mobile", "pricing", "feature_request"]),
    text: z.string().trim().min(3).max(4000),
    answers: z.object({ aesthetics: Answer, mobile: Answer, usefulness: Answer, trust: Answer, gaps: Answer, price_sensitivity: Answer, speed: Answer, confusing: Answer }).partial().default({}),
    turnstile_token: z.string().max(4000).optional(),
  }));
  await verifyTurnstile(c, b.turnstile_token);
  await checkRateLimit(c.env, `feedback:${u.id}`, 10, 60);
  await recordAttempt(c.env, `feedback:${u.id}`);
  if (b.fixture_id) {
    const f = await c.env.DB.prepare("SELECT 1 FROM fixtures WHERE id = ?").bind(b.fixture_id).first();
    if (!f) throw new ApiError(404, "NOT_FOUND", "Fixture not found.");
  }
  const id = newId("fb");
  await c.env.DB.prepare("INSERT INTO beta_feedback (id, user_id, fixture_id, rating, category, text, answers_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, u.id, b.fixture_id ?? null, b.rating, b.category, b.text, JSON.stringify(b.answers), nowIso()).run();
  return ok(c, { id, thanks: true }, { status: 201 });
});

accountRoutes.get("/me/feedback", async (c) => {
  const u = requireUser(c);
  const rows = await c.env.DB.prepare("SELECT id, fixture_id, rating, category, text, created_at, triage_status FROM beta_feedback WHERE user_id = ? ORDER BY created_at DESC").bind(u.id).all();
  return ok(c, { items: rows.results });
});

accountRoutes.post("/me/consent", async (c) => {
  const u = requireUser(c);
  const b = await body(c, z.object({ age_confirmed: z.literal(true), privacy_consent: z.literal(true) }));
  void b;
  await c.env.DB.prepare("UPDATE users SET age_confirmed_at = COALESCE(age_confirmed_at, ?), privacy_consent_at = COALESCE(privacy_consent_at, ?) WHERE id = ?").bind(nowIso(), nowIso(), u.id).run();
  return ok(c, { updated: true });
});
