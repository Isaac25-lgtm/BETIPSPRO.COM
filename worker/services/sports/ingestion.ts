/**
 * Serialised ingestion jobs (admin-triggered or the single cron controller).
 * A D1 lease lock guarantees only one job talks to the provider at a time.
 * Every upstream call is metered by budget.ts; jobs record their provider-call count.
 */
import type { Env } from "../../env.ts";
import { dataMode } from "../../env.ts";
import { ApiError } from "../../lib/http.ts";
import { newId } from "../../lib/crypto.ts";
import { nowIso, todayEat } from "../../lib/time.ts";
import { ApiFootballProvider } from "../../providers/api-football/index.ts";
import type { FixtureBundle, OddsSnapshot } from "../../providers/types.ts";
import type { Priority } from "./budget.ts";

export type IngestKind = "status" | "fixtures_by_date" | "league_season" | "fixture_details" | "odds" | "team_last";

export interface IngestRequest {
  kind: IngestKind;
  date?: string;
  league?: string;
  season?: string;
  team?: string;
  last?: number;
  provider_ids?: string[];
  fixture?: string;
  priority?: Priority;
}

const LOCK_KEY = "lock:ingestion";
const LEASE_MS = 5 * 60_000;

async function acquireLock(env: Env, owner: string): Promise<boolean> {
  const now = Date.now();
  const res = await env.DB.prepare(
    `INSERT INTO app_config (key, value_json, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(key) DO UPDATE SET value_json = ?2, updated_at = ?3, updated_by = ?4
       WHERE CAST(json_extract(app_config.value_json, '$.until') AS INTEGER) < ?5
     RETURNING key`,
  )
    .bind(LOCK_KEY, JSON.stringify({ owner, until: now + LEASE_MS }), nowIso(), owner, now)
    .all();
  return res.results.length === 1;
}

async function releaseLock(env: Env, owner: string) {
  await env.DB.prepare("UPDATE app_config SET value_json = ?2 WHERE key = ?1 AND updated_by = ?3").bind(LOCK_KEY, JSON.stringify({ owner: null, until: 0 }), owner).run();
}

export async function upsertBundle(env: Env, b: FixtureBundle): Promise<number> {
  const now = nowIso();
  const s: D1PreparedStatement[] = [];
  for (const c of b.competitions) {
    s.push(env.DB.prepare(
      `INSERT INTO competitions (id, provider, provider_id, name, short_name, country, is_synthetic, current_season, coverage_json, rights_status, source_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, '{"loaded":true}', 'review_required', ?)
       ON CONFLICT(id) DO UPDATE SET current_season = excluded.current_season, coverage_json = '{"loaded":true}', source_updated_at = excluded.source_updated_at`,
    ).bind(c.id, c.provider, c.provider_id, c.name, c.short_name, c.country, c.current_season, now));
  }
  for (const t of b.teams) {
    s.push(env.DB.prepare(
      `INSERT INTO teams (id, provider, provider_id, name, short_name, code, country, competition_id, is_synthetic, source_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, source_updated_at = excluded.source_updated_at`,
    ).bind(t.id, t.provider, t.provider_id, t.name, t.short_name, t.code, t.country, t.competition_id, now));
  }
  for (const f of b.fixtures) {
    if (f.referee_id && f.referee_name) {
      s.push(env.DB.prepare("INSERT INTO referees (id, name, is_synthetic) VALUES (?, ?, 0) ON CONFLICT(id) DO NOTHING").bind(f.referee_id, f.referee_name));
    }
    s.push(env.DB.prepare(
      `INSERT INTO fixtures (id, provider, provider_id, competition_id, season, round, home_team_id, away_team_id, starts_at_utc, status,
                             home_goals, away_goals, home_goals_ht, away_goals_ht, score_json, venue_name, venue_city, referee_id, is_synthetic, provider_last_updated, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, starts_at_utc = excluded.starts_at_utc, home_goals = excluded.home_goals, away_goals = excluded.away_goals,
         home_goals_ht = excluded.home_goals_ht, away_goals_ht = excluded.away_goals_ht, score_json = excluded.score_json, referee_id = COALESCE(excluded.referee_id, fixtures.referee_id),
         venue_name = excluded.venue_name, provider_last_updated = excluded.provider_last_updated`,
    ).bind(f.id, f.provider, f.provider_id, f.competition_id, f.season, f.round, f.home_team_id, f.away_team_id, f.starts_at_utc, f.status,
      f.home_goals, f.away_goals, f.home_goals_ht, f.away_goals_ht, JSON.stringify({ fulltime: { home: f.home_goals, away: f.away_goals }, halftime: { home: f.home_goals_ht, away: f.away_goals_ht } }),
      f.venue_name, f.venue_city, f.referee_id, f.provider_last_updated, now));
  }
  for (const st of b.stats) {
    s.push(env.DB.prepare(
      `INSERT INTO fixture_team_stats (fixture_id, team_id, corners, yellow_cards, red_cards, shots, shots_on_target, possession_pct, xg, source, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api_football', ?)
       ON CONFLICT(fixture_id, team_id) DO UPDATE SET corners = excluded.corners, yellow_cards = excluded.yellow_cards, red_cards = excluded.red_cards,
         shots = excluded.shots, shots_on_target = excluded.shots_on_target, possession_pct = excluded.possession_pct, xg = excluded.xg, captured_at = excluded.captured_at`,
    ).bind(st.fixture_id, st.team_id, st.corners, st.yellow_cards, st.red_cards, st.shots, st.shots_on_target, st.possession_pct, st.xg, now));
  }
  for (let i = 0; i < s.length; i += 50) await env.DB.batch(s.slice(i, i + 50));
  return b.fixtures.length;
}

async function storeOdds(env: Env, odds: OddsSnapshot[]): Promise<number> {
  const s = odds.map((o) =>
    env.DB.prepare(
      `INSERT INTO bookmaker_snapshots (id, fixture_id, market_definition_id, bookmaker_name, odds_decimal, collected_at, stale_after, provider_source, is_synthetic)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0 WHERE EXISTS (SELECT 1 FROM fixtures WHERE id = ?) AND EXISTS (SELECT 1 FROM market_definitions WHERE id = ?)`,
    ).bind(newId("bk"), o.fixture_id, o.market_id, o.bookmaker_name, o.odds_decimal, o.collected_at, new Date(Date.now() + 6 * 3600_000).toISOString(), o.provider_source, o.fixture_id, o.market_id),
  );
  for (let i = 0; i < s.length; i += 50) await env.DB.batch(s.slice(i, i + 50));
  return odds.length;
}

export async function runIngestion(env: Env, req: IngestRequest, actor: string): Promise<Record<string, unknown>> {
  if (dataMode(env) === "DEMO") throw new ApiError(503, "PROVIDER_UNCONFIGURED", "Provider not configured (demo mode). Set SPORTS_PROVIDER=api_football and API_FOOTBALL_KEY in .dev.vars.");
  const jobId = newId("job");
  if (!(await acquireLock(env, jobId))) throw new ApiError(409, "CONFLICT", "Another ingestion job is running. Jobs are serialised to protect the provider quota.");
  const startedCalls = await callsForJob(env, jobId);
  await env.DB.prepare("INSERT INTO ingestion_jobs (id, kind, target_id, status, attempts, started_at, detail_json, created_at) VALUES (?, ?, ?, 'running', 1, ?, ?, ?)")
    .bind(jobId, req.kind, req.fixture ?? req.league ?? req.date ?? req.team ?? null, nowIso(), JSON.stringify({ request: req, actor }), nowIso()).run();
  const provider = new ApiFootballProvider(env, { jobId, priority: req.priority ?? "normal" });
  try {
    let detail: Record<string, unknown> = {};
    switch (req.kind) {
      case "status":
        detail = { quota: await provider.getQuotaState() };
        break;
      case "fixtures_by_date":
        detail = { fixtures: await upsertBundle(env, await provider.listFixtures({ date: req.date ?? todayEat(), league: req.league, season: req.season })) };
        break;
      case "league_season":
        if (!req.league || !req.season) throw new ApiError(422, "VALIDATION_FAILED", "league and season are required");
        detail = { fixtures: await upsertBundle(env, await provider.listFixtures({ league: req.league, season: req.season })) };
        break;
      case "team_last":
        if (!req.team) throw new ApiError(422, "VALIDATION_FAILED", "team (provider id) is required");
        detail = { fixtures: await upsertBundle(env, await provider.listFixtures({ team: req.team, last: Math.min(req.last ?? 10, 20) })) };
        break;
      case "fixture_details": {
        const ids = (req.provider_ids ?? []).slice(0, 20);
        if (!ids.length) throw new ApiError(422, "VALIDATION_FAILED", "provider_ids (1-20) required");
        const b = await provider.getFixtures(ids);
        detail = { fixtures: await upsertBundle(env, b), team_stat_rows: b.stats.length };
        break;
      }
      case "odds":
        if (!req.fixture) throw new ApiError(422, "VALIDATION_FAILED", "fixture (provider id) is required");
        detail = { odds_rows: await storeOdds(env, await provider.getOdds(req.fixture)) };
        break;
    }
    const calls = (await callsForJob(env, jobId)) - startedCalls;
    await env.DB.prepare("UPDATE ingestion_jobs SET status = 'succeeded', finished_at = ?, provider_calls = ?, detail_json = ? WHERE id = ?")
      .bind(nowIso(), calls, JSON.stringify({ request: req, actor, ...detail }), jobId).run();
    return { job_id: jobId, provider_calls: calls, ...detail };
  } catch (e) {
    const calls = (await callsForJob(env, jobId)) - startedCalls;
    const code = e instanceof ApiError ? e.code : "INTERNAL";
    await env.DB.prepare("UPDATE ingestion_jobs SET status = 'failed', finished_at = ?, provider_calls = ?, error_code = ?, detail_json = ? WHERE id = ?")
      .bind(nowIso(), calls, code, JSON.stringify({ request: req, actor, message: (e as Error).message }), jobId).run();
    throw e;
  } finally {
    await releaseLock(env, jobId);
  }
}

async function callsForJob(env: Env, jobId: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM provider_api_usage WHERE job_id = ?").bind(jobId).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Cron controller: does nothing unless a key is configured AND pilot leagues are configured. */
export async function scheduledRefresh(env: Env): Promise<string> {
  if (dataMode(env) === "DEMO") return "skipped: demo mode";
  const cfg = await env.DB.prepare("SELECT value_json FROM app_config WHERE key = 'ingestion'").first<{ value_json: string }>();
  const c = cfg ? JSON.parse(cfg.value_json) : {};
  if (c.paused) return "skipped: paused";
  const leagues: string[] = c.pilot_leagues ?? [];
  if (!leagues.length) return "skipped: no pilot leagues configured";
  const out: string[] = [];
  for (const league of leagues.slice(0, 3)) {
    try {
      await runIngestion(env, { kind: "fixtures_by_date", date: todayEat(), league, season: c.season }, "cron");
      out.push(`${league}: ok`);
    } catch (e) {
      out.push(`${league}: ${(e as Error).message}`);
      if (e instanceof ApiError && (e.code === "BUDGET_EXHAUSTED" || e.code === "RATE_LIMITED")) break;
    }
  }
  return out.join("; ");
}

/** Normalised history export for the offline Python pipeline (no provider calls). */
export async function exportHistory(env: Env, provider: string) {
  const [c, t, r, f, s] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT id, provider, provider_id, name, short_name, country, is_synthetic, current_season FROM competitions WHERE provider = ?").bind(provider),
    env.DB.prepare("SELECT id, provider, provider_id, name, short_name, code, country, primary_color, secondary_color, competition_id, is_synthetic FROM teams WHERE provider = ?").bind(provider),
    env.DB.prepare("SELECT DISTINCT r.id, r.name, r.is_synthetic FROM referees r JOIN fixtures f ON f.referee_id = r.id WHERE f.provider = ?").bind(provider),
    env.DB.prepare(`SELECT id, provider, provider_id, competition_id, season, round, home_team_id, away_team_id, starts_at_utc, status,
                           home_goals, away_goals, home_goals_ht, away_goals_ht, venue_name, venue_city, referee_id, is_synthetic FROM fixtures WHERE provider = ? ORDER BY starts_at_utc`).bind(provider),
    env.DB.prepare(`SELECT s.fixture_id, s.team_id, s.corners, s.yellow_cards, s.red_cards, s.shots, s.shots_on_target, s.possession_pct, s.xg
                      FROM fixture_team_stats s JOIN fixtures f ON f.id = s.fixture_id WHERE f.provider = ?`).bind(provider),
  ]);
  return { exported_at: nowIso(), provider, competitions: c.results, teams: t.results, referees: r.results, fixtures: f.results, team_stats: s.results };
}
