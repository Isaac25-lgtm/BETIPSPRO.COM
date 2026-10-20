import { Hono } from "hono";
import { cached } from "../services/cache.ts";
import { z } from "zod";
import type { AppBindings } from "../env.ts";
import { dataMode, flag, num } from "../env.ts";
import { ApiError, ok } from "../lib/http.ts";
import { todayEat } from "../lib/time.ts";
import { catalog, marketById } from "../../shared/markets.ts";
import { fixturePreview, listFixtures, realDataReady } from "../services/fixtures.ts";
import { publicCache } from "../middleware/public-cache.ts";
import { openAccess } from "../services/access.ts";
import { assistantEnabled } from "../services/assistant.ts";
import { reportOverview } from "../services/overview.ts";

const PUBLIC_CACHE = "public, max-age=30, s-maxage=60, stale-while-revalidate=120";
export const publicRoutes = new Hono<AppBindings>();

// Shared response cache for user-independent reads (never for reports, evidence, /me or admin).
// TTLs: data only changes on an admin import, so slow-moving aggregates cache for 5 minutes.
const CACHE_TTL: Record<string, number> = {
  "/config/public": 300, "/competitions": 300, "/competitions/:id": 300, "/markets/catalog": 3600, "/statistics/models": 300,
  "/predictions/archive": 300, "/plans": 3600, "/fixtures": 60, "/fixtures/:id/preview": 120, "/fixtures/:id/markets": 300,
};
for (const [path, ttl] of Object.entries(CACHE_TTL)) publicRoutes.use(path, publicCache(ttl));

publicRoutes.get("/health", async (c) => {
  const t0 = Date.now();
  const db = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return ok(c, { status: db?.ok === 1 ? "ok" : "degraded", db_latency_ms: Date.now() - t0, env: c.env.APP_ENV, data_mode: dataMode(c.env), version: c.env.GIT_COMMIT ?? "local" });
});

publicRoutes.get("/config/public", async (c) => {
  // The demo banner must follow the DATA being shown, not just whether a provider key exists.
  const syn = (await realDataReady(c.env)) ? { s: 0 } : await c.env.DB.prepare("SELECT EXISTS (SELECT 1 FROM fixtures WHERE is_synthetic = 1) AS s").first<{ s: number }>();
  return ok(c, {
    data_mode: dataMode(c.env),
    synthetic_data_present: !!syn?.s,
    open_access: await openAccess(c.env),
    payments_enabled: flag(c.env.PAYMENTS_ENABLED),
    invite_only: flag(c.env.BETA_INVITE_ONLY),
    max_beta_users: num(c.env.MAX_BETA_USERS, 5),
    beta_initial_credits: num(c.env.BETA_INITIAL_CREDITS, 10),
    ai_explanations_enabled: flag(c.env.AI_EXPLANATIONS_ENABLED),
    assistant_enabled: await assistantEnabled(c.env),
    turnstile_enabled: flag(c.env.TURNSTILE_ENABLED),
    performance_only_verified: flag(c.env.PUBLIC_PERFORMANCE_ONLY_VERIFIED),
    market_catalog_version: catalog.version,
    today_eat: todayEat(),
  }, { cache: PUBLIC_CACHE });
});

publicRoutes.get("/competitions", async (c) => {
  const supported = c.req.query("supported");
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.short_name, c.country, c.is_synthetic, c.current_season, c.coverage_json, c.rights_status, c.display_order,
            (SELECT COUNT(*) FROM fixtures f WHERE f.competition_id = c.id AND f.status IN ('NS','TBD') AND f.starts_at_utc > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-1 day')) AS upcoming,
            (SELECT COUNT(*) FROM fixtures f WHERE f.competition_id = c.id AND f.status IN ('FT','AET','PEN')) AS completed,
            (SELECT COUNT(DISTINCT r.fixture_id) FROM match_reports r JOIN fixtures f ON f.id = r.fixture_id WHERE f.competition_id = c.id) AS reports,
            (SELECT COUNT(*) FROM teams t WHERE t.competition_id = c.id) AS teams
       FROM competitions c WHERE (?1 = 0 OR c.is_synthetic = 0) ORDER BY c.is_synthetic, c.display_order, c.name`,
  ).bind((await realDataReady(c.env)) ? 1 : 0).all<Record<string, unknown>>();
  let items = rows.results.map((r) => ({ ...r, is_synthetic: !!r.is_synthetic, coverage: JSON.parse((r.coverage_json as string) ?? "{}"), coverage_json: undefined }));
  if (supported === "true") items = items.filter((i) => ((i as Record<string, unknown>).completed as number) > 0);
  return ok(c, { items }, { cache: PUBLIC_CACHE });
});

publicRoutes.get("/competitions/:id", async (c) => {
  const id = c.req.param("id");
  const comp = await c.env.DB.prepare("SELECT id, name, short_name, country, is_synthetic, current_season, coverage_json, rights_status FROM competitions WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!comp) throw new ApiError(404, "NOT_FOUND", "Competition not found.");
  const [upcoming, table, recent] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare("SELECT id FROM fixtures WHERE competition_id = ? AND status IN ('NS','TBD') ORDER BY starts_at_utc LIMIT 30").bind(id),
    c.env.DB.prepare(
      `WITH m AS (
         SELECT home_team_id AS team, home_goals AS gf, away_goals AS ga FROM fixtures WHERE competition_id = ?1 AND season = ?2 AND status IN ('FT','AET','PEN')
         UNION ALL SELECT away_team_id, away_goals, home_goals FROM fixtures WHERE competition_id = ?1 AND season = ?2 AND status IN ('FT','AET','PEN'))
       SELECT t.id, t.name, t.short_name, t.primary_color, COUNT(*) AS played, SUM(gf > ga) AS won, SUM(gf = ga) AS drawn, SUM(gf < ga) AS lost,
              SUM(gf) AS goals_for, SUM(ga) AS goals_against, SUM(CASE WHEN gf > ga THEN 3 WHEN gf = ga THEN 1 ELSE 0 END) AS points
         FROM m JOIN teams t ON t.id = m.team GROUP BY t.id ORDER BY points DESC, (SUM(gf) - SUM(ga)) DESC, goals_for DESC`,
    ).bind(id, comp.current_season ?? ""),
    c.env.DB.prepare("SELECT COUNT(*) AS n, AVG(home_goals + away_goals) AS avg_goals, AVG(CASE WHEN home_goals > 0 AND away_goals > 0 THEN 1.0 ELSE 0 END) AS btts_rate, AVG(CASE WHEN home_goals + away_goals > 2 THEN 1.0 ELSE 0 END) AS over25_rate FROM fixtures WHERE competition_id = ? AND season = ? AND status IN ('FT','AET','PEN')").bind(id, comp.current_season ?? ""),
  ]);
  return ok(c, {
    competition: { ...comp, is_synthetic: !!comp.is_synthetic, coverage: JSON.parse((comp.coverage_json as string) ?? "{}"), coverage_json: undefined },
    upcoming_fixture_ids: upcoming.results.map((r) => r.id),
    standings: table.results,
    season_stats: recent.results[0] ?? null,
  }, { cache: PUBLIC_CACHE });
});

const ListQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  league: z.string().max(80).optional(),
  team: z.string().max(80).optional(),
  q: z.string().trim().min(2).max(60).optional(),
  status: z.enum(["upcoming", "finished", "all"]).default("all"),
  page: z.coerce.number().int().min(1).max(100).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});

publicRoutes.get("/fixtures", async (c) => {
  const parsed = ListQuery.safeParse(c.req.query());
  if (!parsed.success) throw new ApiError(400, "VALIDATION_FAILED", "Invalid query parameters.", parsed.error.flatten());
  const p = parsed.data;
  const data = await listFixtures(c.env, { ...p, pageSize: p.page_size });
  return ok(c, data, { cache: PUBLIC_CACHE, meta: { data_mode: dataMode(c.env) } });
});

// Cached per access state (not in the shared cache), so switching open access off hides probabilities at once.
publicRoutes.get("/reports/overview", async (c) => {
  const open = await openAccess(c.env);
  const { value } = await cached(`overview:${open ? "open" : "locked"}`, 120, () => reportOverview(c.env));
  return ok(c, value, { cache: "private, max-age=30" });
});

publicRoutes.get("/fixtures/:id/preview", async (c) => ok(c, await fixturePreview(c.env, c.req.param("id")), { cache: PUBLIC_CACHE }));

publicRoutes.get("/fixtures/:id/markets", async (c) => {
  const p = await fixturePreview(c.env, c.req.param("id"));
  return ok(c, { markets: p.markets, categories: p.categories, probabilities_visible: false, note: "Probabilities are part of the full report (or the free public sample)." }, { cache: PUBLIC_CACHE });
});

publicRoutes.get("/markets/catalog", (c) =>
  ok(c, { version: catalog.version, categories: catalog.categories, markets: catalog.markets.map(({ predicate: _p, ...m }) => m), unsupported: catalog.unsupported }, { cache: "public, max-age=3600" }),
);

publicRoutes.get("/statistics/models", async (c) => {
  const latest = await c.env.DB.prepare("SELECT id, model_version, data_mode, generated_at, config_json FROM model_runs WHERE json_extract(config_json, '$.kind') = 'backtest' ORDER BY generated_at DESC LIMIT 1").first<Record<string, unknown>>();
  const [evals, counts] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(
      `SELECT e.market_family, e.competition_id, c.name AS competition, e.period, e.sample_n, e.brier, e.log_loss, e.baseline_brier, e.baseline_log_loss, e.calibration_json, e.data_mode, e.evaluated_at
         FROM model_evaluations e LEFT JOIN competitions c ON c.id = e.competition_id WHERE e.model_run_id = ? ORDER BY e.competition_id IS NOT NULL, e.competition_id, e.market_family`,
    ).bind(latest?.id ?? ""),
    c.env.DB.prepare(
      `SELECT
         SUM(CASE WHEN is_pre_kickoff = 1 AND status IN ('VERIFIED','PARTIAL') AND probability IS NOT NULL AND settled_outcome IS NOT NULL THEN 1 ELSE 0 END) AS verified_live_settled,
         SUM(CASE WHEN is_pre_kickoff = 1 AND status IN ('VERIFIED','PARTIAL') AND probability IS NOT NULL THEN 1 ELSE 0 END) AS live_published,
         SUM(CASE WHEN is_pre_kickoff = 1 AND status = 'SIMULATED_DEMO' THEN 1 ELSE 0 END) AS demo_published,
         SUM(CASE WHEN is_pre_kickoff = 0 THEN 1 ELSE 0 END) AS backtest_rows
       FROM forecasts`,
    ),
  ]);
  return ok(c, {
    backtest_run: latest ? { id: latest.id, model_version: latest.model_version, data_mode: latest.data_mode, generated_at: latest.generated_at, description: JSON.parse((latest.config_json as string) ?? "{}").description } : null,
    evaluations: evals.results.map((e) => ({ ...e, calibration: JSON.parse((e.calibration_json as string) ?? "[]"), calibration_json: undefined })),
    counts: counts.results[0],
    roi: { available: false, reason: "No ROI is published: it requires recorded historical price snapshots, staking and settlement rules, and costs. Accuracy metrics are not betting returns." },
    disclaimer: "Backtest metrics on synthetic data demonstrate the evaluation pipeline only; they say nothing about real-world performance.",
  }, { cache: PUBLIC_CACHE });
});

const ArchiveQuery = z.object({
  league: z.string().max(80).optional(),
  market: z.string().max(80).optional(),
  kind: z.enum(["all", "pre_kickoff", "backtest"]).default("all"),
  settled: z.enum(["all", "settled", "pending"]).default("all"),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

publicRoutes.get("/predictions/archive", async (c) => {
  const parsed = ArchiveQuery.safeParse(c.req.query());
  if (!parsed.success) throw new ApiError(400, "VALIDATION_FAILED", "Invalid query parameters.", parsed.error.flatten());
  const q = parsed.data;
  const where = ["fo.probability IS NOT NULL"];
  if (await realDataReady(c.env)) where.push("f.is_synthetic = 0");
  const binds: unknown[] = [];
  if (q.league) { where.push("f.competition_id = ?"); binds.push(q.league); }
  if (q.market) {
    if (!marketById.has(q.market)) throw new ApiError(400, "VALIDATION_FAILED", "Unknown market.");
    where.push("fo.market_definition_id = ?"); binds.push(q.market);
  } else {
    where.push("fo.market_definition_id IN ('MATCH_RESULT_HOME_REGULATION','TOTAL_GOALS_OVER_2_5_REGULATION','BTTS_YES_REGULATION','TOTAL_CORNERS_OVER_9_5_REGULATION','TOTAL_YELLOW_CARDS_OVER_3_5_REGULATION')");
  }
  if (q.kind === "pre_kickoff") where.push("fo.is_pre_kickoff = 1");
  if (q.kind === "backtest") where.push("fo.is_pre_kickoff = 0");
  if (q.settled === "settled") where.push("fo.settled_outcome IS NOT NULL");
  if (q.settled === "pending") where.push("fo.settled_outcome IS NULL");
  const pageSize = 50;
  const sql = `SELECT fo.id, fo.fixture_id, fo.market_definition_id AS market_id, fo.probability, fo.status, fo.is_pre_kickoff, fo.settled_outcome, fo.generated_at, fo.data_as_of_at, fo.model_version,
                      f.starts_at_utc, f.status AS fixture_status, f.home_goals, f.away_goals, f.is_synthetic, c.short_name AS competition, h.name AS home, a.name AS away
                 FROM forecasts fo JOIN fixtures f ON f.id = fo.fixture_id JOIN competitions c ON c.id = f.competition_id JOIN teams h ON h.id = f.home_team_id JOIN teams a ON a.id = f.away_team_id
                WHERE ${where.join(" AND ")} ORDER BY f.starts_at_utc DESC, fo.fixture_id, fo.market_definition_id LIMIT ? OFFSET ?`;
  const [rows, count] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(sql).bind(...binds, pageSize, (q.page - 1) * pageSize),
    c.env.DB.prepare(`SELECT COUNT(*) AS n, AVG(CASE WHEN fo.settled_outcome IS NOT NULL THEN (fo.probability - fo.settled_outcome) * (fo.probability - fo.settled_outcome) END) AS brier, SUM(fo.settled_outcome IS NOT NULL) AS settled FROM forecasts fo JOIN fixtures f ON f.id = fo.fixture_id WHERE ${where.join(" AND ")}`).bind(...binds),
  ]);
  return ok(c, {
    items: rows.results.map((r) => ({ ...r, market_label: marketById.get(r.market_id as string)?.label ?? r.market_id, is_pre_kickoff: !!r.is_pre_kickoff, is_synthetic: !!r.is_synthetic })),
    total: (count.results[0] as { n: number }).n,
    summary: count.results[0],
    page: q.page,
    page_size: pageSize,
    note: "Rows with is_pre_kickoff=false are retrospective backtests computed using only pre-kickoff data; they were not published before the match.",
  }, { cache: PUBLIC_CACHE });
});

publicRoutes.get("/plans", async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, name, price_minor, currency, credits, active, is_experiment FROM plans ORDER BY price_minor").all<Record<string, unknown>>();
  return ok(c, { payments_enabled: flag(c.env.PAYMENTS_ENABLED), plans: rows.results, notice: "Pricing is an unvalidated hypothesis. No payments are taken during the beta." }, { cache: PUBLIC_CACHE });
});
