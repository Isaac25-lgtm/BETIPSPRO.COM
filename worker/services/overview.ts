import type { Env } from "../env.ts";
import { nowIso } from "../lib/time.ts";
import { marketById } from "../../shared/markets.ts";
import { openAccess } from "./access.ts";
import { FIXTURE_SELECT, realDataReady, toSummary, type FixtureRow, type FixtureSummary } from "./fixtures.ts";

/**
 * Match report overview: every upcoming fixture that has a report, with its headline probabilities, plus how much
 * data is held per competition. Probabilities are included only while open access is on (otherwise they belong to
 * the paid report and only the public sample shows them).
 */
const KEY_MARKETS = [
  "MATCH_RESULT_HOME_REGULATION", "MATCH_RESULT_DRAW_REGULATION", "MATCH_RESULT_AWAY_REGULATION",
  "TOTAL_GOALS_OVER_2_5_REGULATION", "BTTS_YES_REGULATION", "FIRST_HALF_GOALS_OVER_0_5",
] as const;

export interface OverviewMatch extends Omit<FixtureSummary, "featured"> {
  featured: null | { market_id: string; label: string; probability: number | null };
  probabilities: null | { home: number | null; draw: number | null; away: number | null; over_2_5: number | null; btts: number | null; first_half_goal: number | null; home_range: null | [number, number] };
  markets_priced: number;
  limited_reason: string | null;
  has_summary: boolean;
}

export async function reportOverview(env: Env) {
  const open = await openAccess(env);
  const realOnly = await realDataReady(env);
  const now = nowIso();
  const rows = await env.DB.prepare(
    `${FIXTURE_SELECT} WHERE r.report_version IS NOT NULL AND f.status IN ('NS','TBD') AND f.starts_at_utc > ?${realOnly ? " AND f.is_synthetic = 0" : ""}
      ORDER BY f.starts_at_utc, c.display_order, c.name, f.id LIMIT 300`,
  ).bind(now).all<FixtureRow>();
  const fixtures = rows.results;

  // One pass over the latest report's forecasts for the headline markets.
  const probs = new Map<string, Map<string, { p: number | null; unc: string; reason: string | null }>>();
  const priced = new Map<string, number>();
  const summaries = new Set<string>();
  const featured = new Map<string, number | null>();
  if (fixtures.length) {
    const latest = `SELECT r.fixture_id, r.report_version FROM match_reports r
                      JOIN fixtures f ON f.id = r.fixture_id
                     WHERE f.status IN ('NS','TBD') AND f.starts_at_utc > ?1
                       AND r.generated_at = (SELECT MAX(generated_at) FROM match_reports WHERE fixture_id = r.fixture_id)`;
    const [fc, cnt, ai, fe] = await env.DB.batch<Record<string, unknown>>([
      env.DB.prepare(
        `SELECT fo.fixture_id, fo.market_definition_id AS m, fo.probability AS p, fo.uncertainty_json AS unc, fo.quality_reason AS reason
           FROM forecasts fo JOIN (${latest}) l ON l.fixture_id = fo.fixture_id AND l.report_version = fo.model_run_id
          WHERE fo.market_definition_id IN (${KEY_MARKETS.map(() => "?").join(",")})`,
      ).bind(now, ...KEY_MARKETS),
      env.DB.prepare(
        `SELECT fo.fixture_id, COUNT(*) AS n FROM forecasts fo JOIN (${latest}) l ON l.fixture_id = fo.fixture_id AND l.report_version = fo.model_run_id
          WHERE fo.probability IS NOT NULL GROUP BY fo.fixture_id`,
      ).bind(now),
      env.DB.prepare(
        `SELECT DISTINCT x.fixture_id FROM ai_explanations x JOIN (${latest}) l ON l.fixture_id = x.fixture_id AND l.report_version = x.report_version
          WHERE x.text_json NOT LIKE '%"rejected":true%'`,
      ).bind(now),
      env.DB.prepare(
        `SELECT fo.fixture_id, fo.probability AS p FROM forecasts fo JOIN (${latest}) l ON l.fixture_id = fo.fixture_id AND l.report_version = fo.model_run_id
           JOIN match_reports r ON r.fixture_id = fo.fixture_id AND r.report_version = l.report_version AND r.featured_market_id = fo.market_definition_id`,
      ).bind(now),
    ]);
    for (const r of fe.results) featured.set(r.fixture_id as string, r.p as number | null);
    for (const r of fc.results) {
      const id = r.fixture_id as string;
      if (!probs.has(id)) probs.set(id, new Map());
      probs.get(id)!.set(r.m as string, { p: r.p as number | null, unc: (r.unc as string) ?? "{}", reason: r.reason as string | null });
    }
    for (const r of cnt.results) priced.set(r.fixture_id as string, r.n as number);
    for (const r of ai.results) summaries.add(r.fixture_id as string);
  }

  const matches: OverviewMatch[] = fixtures.map((r) => {
    const m = probs.get(r.id);
    const get = (k: string) => m?.get(k)?.p ?? null;
    const home = m?.get("MATCH_RESULT_HOME_REGULATION");
    let range: null | [number, number] = null;
    try {
      const u = JSON.parse(home?.unc ?? "{}");
      if (u.p05 != null && u.p95 != null) range = [u.p05, u.p95];
    } catch { /* no interval */ }
    const show = open || !!r.is_public_sample;
    const fm = r.featured_market_id ? marketById.get(r.featured_market_id) : undefined;
    const featuredP = r.featured_market_id ? (m?.get(r.featured_market_id)?.p ?? featured.get(r.id) ?? null) : null;
    return {
      ...toSummary(r),
      featured: fm ? { market_id: fm.id, label: fm.label, probability: show ? featuredP : null } : null,
      probabilities: show
        ? { home: get("MATCH_RESULT_HOME_REGULATION"), draw: get("MATCH_RESULT_DRAW_REGULATION"), away: get("MATCH_RESULT_AWAY_REGULATION"),
            over_2_5: get("TOTAL_GOALS_OVER_2_5_REGULATION"), btts: get("BTTS_YES_REGULATION"), first_half_goal: get("FIRST_HALF_GOALS_OVER_0_5"), home_range: range }
        : null,
      markets_priced: priced.get(r.id) ?? 0,
      limited_reason: home && home.p == null ? home.reason : null,
      has_summary: summaries.has(r.id),
    };
  });

  const cov = await env.DB.prepare(
    `SELECT c.id, c.name, f.season, COUNT(*) AS total,
            SUM(CASE WHEN f.status IN ('FT','AET','PEN') AND f.home_goals IS NOT NULL THEN 1 ELSE 0 END) AS played
       FROM fixtures f JOIN competitions c ON c.id = f.competition_id
      WHERE f.is_synthetic = ? GROUP BY c.id, c.name, f.season ORDER BY c.display_order, c.name, f.season DESC`,
  ).bind(realOnly ? 0 : 1).all<{ id: string; name: string; season: string; total: number; played: number }>();

  return { open_access: open, generated_at: now, matches, coverage: cov.results };
}
