import { Hono, type Context } from "hono";
import { setOpenAccess } from "../services/access.ts";
import { z } from "zod";
import type { AppBindings } from "../env.ts";
import { dataMode, flag, num } from "../env.ts";
import { ApiError, ok } from "../lib/http.ts";
import { newId } from "../lib/crypto.ts";
import { nowIso, utcDay } from "../lib/time.ts";
import { adminOnly, requireAdmin } from "../middleware/index.ts";
import { createInvite } from "../services/auth.ts";
import { adminGrant } from "../services/credits.ts";
import { importSection, ImportRequestSchema } from "../services/importer.ts";
import { bumpCacheGeneration } from "../services/cache.ts";
import { budgetConfig, usageSummary } from "../services/sports/budget.ts";
import { exportHistory, runIngestion } from "../services/sports/ingestion.ts";
import { aiStatus, generateSummary } from "../services/ai/gemini.ts";
import { marketEvidence } from "../services/evidence.ts";
import { allowedNumbers, validateSummary } from "../services/ai/validate.ts";
import { settlePreKickoff } from "../services/settlement.ts";
import { refreshOdds } from "../services/sports/odds.ts";

export const adminRoutes = new Hono<AppBindings>();
adminRoutes.use("*", adminOnly);

async function body<T extends z.ZodTypeAny>(c: Context<AppBindings>, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be JSON.");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(422, "VALIDATION_FAILED", "Invalid request.", r.error.flatten());
  return r.data;
}

async function audit(c: Context<AppBindings>, action: string, entity: string, entityId: string | null, after: unknown) {
  await c.env.DB.prepare("INSERT INTO admin_audit_log (id, actor_id, action, entity, entity_id, after_json, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(newId("aud"), c.get("user")!.id, action, entity, entityId, JSON.stringify(after), c.get("requestId"), nowIso()).run();
}

adminRoutes.get("/overview", async (c) => {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [inv, users, credits, unlocks, fb, runs, stale, activeTesters] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare("SELECT status, COUNT(*) AS n FROM beta_invites GROUP BY status"),
    c.env.DB.prepare("SELECT role, COUNT(*) AS n FROM users WHERE status = 'active' GROUP BY role"),
    c.env.DB.prepare("SELECT kind, SUM(amount_signed) AS total, COUNT(*) AS n FROM credit_ledger GROUP BY kind"),
    c.env.DB.prepare("SELECT COUNT(*) AS total, COUNT(DISTINCT fixture_id) AS distinct_fixtures, COUNT(DISTINCT user_id) AS users FROM report_unlocks"),
    c.env.DB.prepare("SELECT COUNT(*) AS n, AVG(rating) AS avg_rating, SUM(triage_status = 'new') AS untriaged FROM beta_feedback"),
    c.env.DB.prepare("SELECT id, model_version, data_mode, generated_at, data_as_of_at, imported_at FROM model_runs WHERE json_extract(config_json, '$.kind') IS NULL ORDER BY generated_at DESC LIMIT 5"),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM fixtures WHERE status IN ('NS','TBD') AND starts_at_utc < ? AND is_synthetic = 0").bind(nowIso()),
    c.env.DB.prepare("SELECT COUNT(DISTINCT s.user_id) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.role = 'tester' AND s.created_at > ?").bind(weekAgo),
  ]);
  return ok(c, {
    environment: { app_env: c.env.APP_ENV, data_mode: dataMode(c.env), version: c.env.GIT_COMMIT ?? "local (not deployed)", payments_enabled: flag(c.env.PAYMENTS_ENABLED) },
    beta: { max_testers: num(c.env.MAX_BETA_USERS, 5), initial_credits: num(c.env.BETA_INITIAL_CREDITS, 10), invites: inv.results, users: users.results, weekly_active_testers: activeTesters.results[0]?.n ?? 0 },
    credits: credits.results,
    unlocks: unlocks.results[0],
    feedback: fb.results[0],
    provider: await usageSummary(c.env),
    providers: { api_football: await usageSummary(c.env, "api_football"), football_data_org: await usageSummary(c.env, "football_data_org") },
    stale_live_fixtures: stale.results[0]?.n ?? 0,
    model_runs: runs.results,
    ai: aiStatus(c.env),
  });
});

adminRoutes.get("/health/providers", async (c) => {
  const s = await usageSummary(c.env);
  const latestFixture = await c.env.DB.prepare("SELECT MAX(provider_last_updated) AS t FROM fixtures WHERE provider = 'api_football'").first<{ t: string | null }>();
  return ok(c, {
    api_football: {
      configured: s.configured, // never echoes the key
      mode: dataMode(c.env),
      quota: { used_today: s.used_today, operational_budget: s.operational_budget, hard_cap: s.hard_cap, provider_reported: s.provider_reported },
      last_successful_call: s.last_successful_call,
      data_age: latestFixture?.t ?? null,
      connection_test: "POST /api/v1/admin/ingest {\"kind\":\"status\"} (costs 1 request from the reserve)",
    },
    demo: { configured: true, cost: "0 provider calls (local synthetic data)" },
  });
});

// ------------------------------------------------------------------ testers & invitations

adminRoutes.get("/testers", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at, w.balance,
            (SELECT COUNT(*) FROM report_unlocks r WHERE r.user_id = u.id) AS unlocks,
            (SELECT MAX(created_at) FROM sessions s WHERE s.user_id = u.id) AS last_session
       FROM users u LEFT JOIN wallets w ON w.user_id = u.id ORDER BY u.created_at`,
  ).all();
  return ok(c, { items: rows.results });
});

adminRoutes.get("/invitations", async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, email, status, issued_at, used_at, expires_at FROM beta_invites ORDER BY issued_at DESC").all();
  return ok(c, { items: rows.results, note: "Codes are stored hashed and cannot be shown again. Revoke and reissue if a code is lost." });
});

adminRoutes.post("/invitations", async (c) => {
  const admin = requireAdmin(c);
  const b = await body(c, z.object({ email: z.string().trim().toLowerCase().email().max(200) }));
  const inv = await createInvite(c.env, admin.id, b.email);
  return ok(c, { ...inv, email: b.email, show_once: true }, { status: 201 });
});

adminRoutes.post("/invitations/:id/revoke", async (c) => {
  const r = await c.env.DB.prepare("UPDATE beta_invites SET status = 'revoked' WHERE id = ? AND status = 'issued'").bind(c.req.param("id")).run();
  if (!r.meta.changes) throw new ApiError(409, "CONFLICT", "Invite is not in an issued state.");
  await audit(c, "invite.revoke", "beta_invite", c.req.param("id"), {});
  return ok(c, { revoked: true });
});

adminRoutes.post("/credits/grant", async (c) => {
  const admin = requireAdmin(c);
  const key = c.req.header("idempotency-key");
  if (!key || key.length < 8) throw new ApiError(400, "BAD_REQUEST", "Idempotency-Key header is required for credit grants.");
  const b = await body(c, z.object({ user_id: z.string().max(80), amount: z.number().int(), reason: z.string().trim().min(3).max(200) }));
  return ok(c, await adminGrant(c.env, admin.id, b.user_id, b.amount, b.reason, key, c.get("requestId")));
});

adminRoutes.get("/credits/ledger", async (c) => {
  const userId = c.req.query("user_id");
  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.user_id, u.email, l.amount_signed, l.kind, l.reason, l.actor_id, l.idempotency_key, l.created_at
       FROM credit_ledger l JOIN users u ON u.id = l.user_id WHERE (?1 IS NULL OR l.user_id = ?1) ORDER BY l.created_at DESC LIMIT 500`,
  ).bind(userId ?? null).all();
  return ok(c, { items: rows.results });
});

// ------------------------------------------------------------------ data, ingestion, forecasts

adminRoutes.get("/fixtures", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT f.id, f.starts_at_utc, f.status, f.is_synthetic, f.is_public_sample, c.short_name AS competition, h.name AS home, a.name AS away,
            (SELECT COUNT(*) FROM match_reports r WHERE r.fixture_id = f.id) AS reports,
            (SELECT COUNT(*) FROM report_unlocks u WHERE u.fixture_id = f.id) AS unlocks,
            (SELECT COUNT(*) FROM fixture_team_stats s WHERE s.fixture_id = f.id) AS stat_rows
       FROM fixtures f JOIN competitions c ON c.id = f.competition_id JOIN teams h ON h.id = f.home_team_id JOIN teams a ON a.id = f.away_team_id
      WHERE f.status IN ('NS','TBD') OR f.starts_at_utc > ? ORDER BY f.starts_at_utc LIMIT 200`,
  ).bind(new Date(Date.now() - 3 * 86_400_000).toISOString()).all();
  return ok(c, { items: rows.results });
});

adminRoutes.post("/fixtures/:id/public-sample", async (c) => {
  const id = c.req.param("id");
  const r = await c.env.DB.prepare("SELECT 1 FROM match_reports WHERE fixture_id = ?").bind(id).first();
  if (!r) throw new ApiError(409, "REPORT_UNAVAILABLE", "Fixture has no report.");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE fixtures SET is_public_sample = 0 WHERE is_public_sample = 1"),
    c.env.DB.prepare("UPDATE fixtures SET is_public_sample = 1 WHERE id = ?").bind(id),
  ]);
  bumpCacheGeneration();
  await audit(c, "fixture.public_sample", "fixture", id, {});
  return ok(c, { public_sample: id });
});

adminRoutes.get("/usage", async (c) => ok(c, await usageSummary(c.env)));

adminRoutes.get("/jobs", async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, kind, target_id, status, attempts, provider_calls, started_at, finished_at, error_code, detail_json FROM ingestion_jobs ORDER BY created_at DESC LIMIT 100").all<Record<string, unknown>>();
  return ok(c, { items: rows.results.map((r) => ({ ...r, detail: JSON.parse((r.detail_json as string) ?? "{}"), detail_json: undefined })) });
});

adminRoutes.post("/ingest", async (c) => {
  const admin = requireAdmin(c);
  const b = await body(c, z.object({
    kind: z.enum(["status", "fixtures_by_date", "league_season", "fixture_details", "odds", "team_last", "fdo_competition"]),
    competition: z.string().regex(/^[A-Z0-9]{2,4}$/).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), league: z.string().regex(/^\d+$/).optional(), season: z.string().regex(/^\d{4}$/).optional(),
    team: z.string().regex(/^\d+$/).optional(), last: z.number().int().min(1).max(20).optional(),
    provider_ids: z.array(z.string().regex(/^\d+$/)).max(20).optional(), fixture: z.string().regex(/^\d+$/).optional(),
    priority: z.enum(["normal", "reserve"]).default("normal"),
  }));
  await audit(c, "ingest.run", "ingestion", b.kind, b);
  return ok(c, await runIngestion(c.env, b, admin.id));
});

adminRoutes.get("/export/history", async (c) => {
  const provider = c.req.query("provider") ?? "api_football";
  if (!["api_football", "football_data_org", "demo"].includes(provider)) throw new ApiError(400, "BAD_REQUEST", "Unknown provider.");
  await audit(c, "export.history", "provider", provider, {});
  return ok(c, await exportHistory(c.env, provider));
});

adminRoutes.post("/forecasts/import", async (c) => {
  const admin = requireAdmin(c);
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Body must be JSON.");
  }
  const parsed = ImportRequestSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(422, "VALIDATION_FAILED", "Import payload failed schema validation.", parsed.error.flatten());
  try {
    const res = await importSection(c.env.DB, parsed.data, { actorId: admin.id, now: nowIso() });
    if (parsed.data.section === "reports") bumpCacheGeneration();
    if (parsed.data.section === "run") await audit(c, "forecasts.import", "model_run", parsed.data.model_run.id, { data_mode: parsed.data.data_mode });
    return ok(c, res);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(409, "CONFLICT", (e as Error).message);
  }
});

adminRoutes.post("/cache/invalidate", async (c) => {
  const gen = bumpCacheGeneration();
  await audit(c, "cache.invalidate", "cache", null, { generation: gen });
  return ok(c, { generation: gen, note: "In-isolate cache cleared and cache keys rotated for this isolate. Report-version keys rotate automatically on new imports." });
});

adminRoutes.get("/forecasts", async (c) => {
  const [runs, byStatus, evals] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare("SELECT id, model_version, pipeline_version, data_mode, dataset_hash, generated_at, data_as_of_at, imported_at, (SELECT COUNT(*) FROM forecasts f WHERE f.model_run_id = m.id) AS forecasts FROM model_runs m ORDER BY generated_at DESC LIMIT 20"),
    c.env.DB.prepare("SELECT status, is_pre_kickoff, COUNT(*) AS n FROM forecasts GROUP BY status, is_pre_kickoff"),
    c.env.DB.prepare("SELECT market_family, competition_id, sample_n, brier, baseline_brier, log_loss, baseline_log_loss, data_mode FROM model_evaluations ORDER BY evaluated_at DESC LIMIT 60"),
  ]);
  return ok(c, { runs: runs.results, by_status: byStatus.results, evaluations: evals.results });
});

adminRoutes.get("/coverage", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.is_synthetic, c.rights_status, c.current_season,
            (SELECT COUNT(*) FROM fixtures f WHERE f.competition_id = c.id) AS fixtures,
            (SELECT COUNT(*) FROM fixtures f WHERE f.competition_id = c.id AND f.status IN ('FT','AET','PEN')) AS completed,
            (SELECT COUNT(*) FROM fixtures f WHERE f.competition_id = c.id AND f.home_goals_ht IS NOT NULL) AS with_ht,
            (SELECT COUNT(DISTINCT s.fixture_id) FROM fixture_team_stats s JOIN fixtures f ON f.id = s.fixture_id WHERE f.competition_id = c.id AND s.corners IS NOT NULL) AS with_corners,
            (SELECT COUNT(DISTINCT s.fixture_id) FROM fixture_team_stats s JOIN fixtures f ON f.id = s.fixture_id WHERE f.competition_id = c.id AND s.yellow_cards IS NOT NULL) AS with_cards,
            (SELECT COUNT(DISTINCT b.fixture_id) FROM bookmaker_snapshots b JOIN fixtures f ON f.id = b.fixture_id WHERE f.competition_id = c.id AND b.is_synthetic = 0) AS with_real_odds,
            (SELECT COUNT(DISTINCT r.fixture_id) FROM match_reports r JOIN fixtures f ON f.id = r.fixture_id WHERE f.competition_id = c.id) AS reports
       FROM competitions c ORDER BY c.is_synthetic, c.display_order`,
  ).all();
  const markets = await c.env.DB.prepare("SELECT family, tier, COUNT(*) AS markets, MIN(validation_status) AS validation_status, MIN(licensing_status) AS licensing_status FROM market_definitions GROUP BY family, tier ORDER BY tier, family").all();
  return ok(c, { competitions: rows.results, market_families: markets.results, rights_gate: "Public release and monetisation are BLOCKED until API-Football terms and rights holders' permissions for paid report presentation are confirmed." });
});

adminRoutes.get("/feedback", async (c) => {
  const rows = await c.env.DB.prepare("SELECT b.id, b.user_id, u.email, b.fixture_id, b.rating, b.category, b.text, b.answers_json, b.created_at, b.triage_status FROM beta_feedback b JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC LIMIT 300").all<Record<string, unknown>>();
  return ok(c, { items: rows.results.map((r) => ({ ...r, answers: JSON.parse((r.answers_json as string) ?? "{}"), answers_json: undefined })) });
});

adminRoutes.patch("/feedback/:id", async (c) => {
  const b = await body(c, z.object({ triage_status: z.enum(["new", "triaged", "resolved", "wontfix"]) }));
  const r = await c.env.DB.prepare("UPDATE beta_feedback SET triage_status = ? WHERE id = ?").bind(b.triage_status, c.req.param("id")).run();
  if (!r.meta.changes) throw new ApiError(404, "NOT_FOUND", "Feedback not found.");
  await audit(c, "feedback.triage", "beta_feedback", c.req.param("id"), b);
  return ok(c, { updated: true });
});

adminRoutes.get("/audit", async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, actor_id, action, entity, entity_id, after_json, request_id, created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT 300").all();
  return ok(c, { items: rows.results });
});

adminRoutes.get("/data-requests", async (c) => {
  const rows = await c.env.DB.prepare("SELECT d.id, d.user_id, u.email, d.kind, d.status, d.created_at FROM data_requests d JOIN users u ON u.id = d.user_id ORDER BY d.created_at DESC").all();
  return ok(c, { items: rows.results });
});

adminRoutes.get("/config", async (c) => {
  const rows = await c.env.DB.prepare("SELECT key, value_json, updated_at, updated_by FROM app_config WHERE key NOT LIKE 'lock:%' ORDER BY key").all<Record<string, unknown>>();
  return ok(c, {
    runtime: rows.results.map((r) => ({ ...r, value: JSON.parse(r.value_json as string), value_json: undefined })),
    environment_flags: {
      APP_ENV: c.env.APP_ENV, SPORTS_PROVIDER: c.env.SPORTS_PROVIDER, SPORTS_API_FREE_MODE: c.env.SPORTS_API_FREE_MODE,
      budget: budgetConfig(c.env), AI_EXPLANATIONS_ENABLED: c.env.AI_EXPLANATIONS_ENABLED, PAYMENTS_ENABLED: c.env.PAYMENTS_ENABLED,
      BETA_INVITE_ONLY: c.env.BETA_INVITE_ONLY, MAX_BETA_USERS: c.env.MAX_BETA_USERS, BETA_INITIAL_CREDITS: c.env.BETA_INITIAL_CREDITS,
      secrets_present: { API_FOOTBALL_KEY: !!c.env.API_FOOTBALL_KEY, SESSION_SECRET: !!c.env.SESSION_SECRET, ADMIN_BOOTSTRAP_TOKEN: !!c.env.ADMIN_BOOTSTRAP_TOKEN, TURNSTILE_SECRET_KEY: !!c.env.TURNSTILE_SECRET_KEY, VERTEX_SERVICE_ACCOUNT_JSON: !!c.env.VERTEX_SERVICE_ACCOUNT_JSON },
    },
    utc_day: utcDay(),
  });
});

adminRoutes.put("/config/access", async (c) => {
  const b = await body(c, z.object({ open: z.boolean() }));
  await setOpenAccess(c.env, b.open, c.get("user")!.id);
  await audit(c, "config.access", "app_config", "access", b);
  return ok(c, { saved: b });
});

adminRoutes.put("/config/ingestion", async (c) => {
  const b = await body(c, z.object({ pilot_leagues: z.array(z.string().regex(/^\d+$/)).max(3).default([]), season: z.string().regex(/^\d{4}$/).optional(), pilot_fixture_ids: z.array(z.string().max(160)).max(20).default([]), paused: z.boolean().default(false) }));
  await c.env.DB.prepare("INSERT INTO app_config (key, value_json, updated_at, updated_by) VALUES ('ingestion', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
    .bind(JSON.stringify(b), nowIso(), c.get("user")!.id).run();
  await audit(c, "config.ingestion", "app_config", "ingestion", b);
  return ok(c, { saved: b });
});

/** Offline AI batch support: month-to-date spend + which summaries already exist (so nothing is regenerated). */
adminRoutes.get("/ai/status", async (c) => {
  const start = nowIso().slice(0, 7) + "-01T00:00:00Z";
  const [spend, existing] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS usd, COUNT(*) AS n FROM ai_explanations WHERE created_at >= ?").bind(start),
    c.env.DB.prepare("SELECT fixture_id, market_definition_id, report_version, evidence_hash FROM ai_explanations ORDER BY created_at DESC LIMIT 5000"),
  ]);
  return ok(c, { month_start: start, month_spend_usd: spend.results[0]?.usd ?? 0, month_items: spend.results[0]?.n ?? 0, existing: existing.results });
});

/** Import summaries produced by scripts/ai-summaries.mjs (Vertex via the owner's Google login; no API keys). */
adminRoutes.post("/ai/import", async (c) => {
  const b = await body(c, z.object({
    rows: z.array(z.object({
      fixture_id: z.string().max(160), market_id: z.string().max(80), report_version: z.string().max(160), evidence_hash: z.string().max(100),
      model: z.string().max(80), text_json: z.string().max(20000), input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(),
      cost_usd: z.number().nonnegative().max(5),
    })).max(200),
  }));
  let written = 0;
  let rejected = 0;
  const Summary = z.object({ summary: z.string().min(20).max(900), key_points: z.array(z.string().min(3).max(200)).max(5) }).passthrough();
  for (const r of b.rows) {
    let text = r.text_json;
    let parsed: unknown = null;
    try { parsed = JSON.parse(r.text_json); } catch { /* invalid JSON is stored as rejected below */ }
    if (!(parsed && typeof parsed === "object" && (parsed as { rejected?: boolean }).rejected)) {
      const shape = Summary.safeParse(parsed);
      const rep = await c.env.DB.prepare("SELECT 1 FROM match_reports WHERE fixture_id = ? AND report_version = ?").bind(r.fixture_id, r.report_version).first();
      let problems: string[] = [];
      if (!shape.success) problems = ["summary shape invalid"];
      else if (!rep) problems = ["no report with this fixture and report version"];
      else {
        const ev = await marketEvidence(c.env, r.fixture_id, r.market_id).catch(() => null);
        if (!ev) problems = ["evidence unavailable for this market"];
        else problems = validateSummary([shape.data.summary, ...shape.data.key_points].join(" \n"), allowedNumbers(ev)).problems;
      }
      if (problems.length) {
        rejected++;
        text = JSON.stringify({ rejected: true, validation: { ok: false, problems, checked_at: nowIso(), by: "server-import" } });
      }
    }
    const res = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO ai_explanations (id, fixture_id, market_definition_id, report_version, evidence_hash, model, text_json, input_tokens, output_tokens, cost_usd, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM fixtures WHERE id = ?)",
    ).bind(newId("ai"), r.fixture_id, r.market_id, r.report_version, r.evidence_hash, r.model, text, r.input_tokens, r.output_tokens, r.cost_usd, nowIso(), r.fixture_id).run();
    written += res.meta.changes ?? 0;
  }
  bumpCacheGeneration();
  await audit(c, "ai.import", "ai_explanations", null, { rows: b.rows.length, written, cost_usd: b.rows.reduce((s, r) => s + r.cost_usd, 0) });
  return ok(c, { received: b.rows.length, written, rejected_by_server: rejected });
});

/** Bookmaker prices from The Odds API for upcoming fixtures (metered; ~12 credits per refresh). */
adminRoutes.post("/odds/refresh", async (c) => {
  const r = await refreshOdds(c.env, { jobId: newId("job") });
  await audit(c, "odds.refresh", "bookmaker_snapshots", null, r);
  return ok(c, r);
});

/** R-14: record outcomes for finished matches' pre-kickoff forecasts (append-only fields). */
adminRoutes.post("/settle", async (c) => {
  const r = await settlePreKickoff(c.env);
  await audit(c, "forecasts.settle", "forecasts", null, r);
  return ok(c, r);
});

adminRoutes.post("/ai/generate", async (c) => {
  const b = await body(c, z.object({ fixture_id: z.string().max(160), market_id: z.string().max(80) }));
  const ev = await marketEvidence(c.env, b.fixture_id, b.market_id);
  const compact = {
    market: ev.market.label, forecast: ev.forecast, league_baseline: ev.league_baseline,
    sets: ev.observed_evidence.map((s) => ({ title: s.title, sample: s.sample, settled: s.settled, hits: s.hits, rate: s.rate, averages: s.averages })),
    narrative: ev.narrative,
  };
  const res = await generateSummary(c.env, { fixtureId: b.fixture_id, marketId: b.market_id, reportVersion: ev.report_version, evidence: compact });
  await audit(c, "ai.generate", "fixture", b.fixture_id, { market: b.market_id, cached: res.cached });
  return ok(c, res);
});
