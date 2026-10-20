/**
 * Prospective settlement (review R-14): once a match is finished, every genuinely pre-kickoff forecast for it gets
 * its outcome recorded. Only settled_outcome / settled_at change (the immutability triggers allow nothing else), so
 * the published probability, timestamps and model identity stay exactly as they were before kickoff.
 * Runs from the daily cron and after each import; idempotent.
 */
import type { Env } from "../env.ts";
import { nowIso } from "../lib/time.ts";
import { marketById, settle } from "../../shared/markets.ts";

export async function settlePreKickoff(env: Env, limit = 3000): Promise<{ examined: number; settled: number; void: number }> {
  const rows = await env.DB.prepare(
    `SELECT fo.id, fo.market_definition_id AS m, f.home_goals AS hg, f.away_goals AS ag, f.home_goals_ht AS hth, f.away_goals_ht AS ath,
            (SELECT SUM(corners) FROM fixture_team_stats s WHERE s.fixture_id = f.id HAVING COUNT(corners) = 2) AS corners_total,
            (SELECT SUM(yellow_cards) FROM fixture_team_stats s WHERE s.fixture_id = f.id HAVING COUNT(yellow_cards) = 2) AS yellow_total
       FROM forecasts fo JOIN fixtures f ON f.id = fo.fixture_id
      WHERE fo.is_pre_kickoff = 1 AND fo.probability IS NOT NULL AND fo.settled_at IS NULL
        AND f.status IN ('FT','AET','PEN') AND f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
      LIMIT ?`,
  ).bind(limit).all<{ id: string; m: string; hg: number; ag: number; hth: number | null; ath: number | null; corners_total: number | null; yellow_total: number | null }>();
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  let voided = 0;
  for (const r of rows.results) {
    const def = marketById.get(r.m);
    if (!def) continue;
    const o = settle(def.predicate, { hg: r.hg, ag: r.ag, hth: r.hth, ath: r.ath, corners_total: r.corners_total, yellow_total: r.yellow_total });
    if (o === null) voided++;
    // settled_at marks the row as processed; a null outcome means the needed statistic was unavailable (void).
    stmts.push(env.DB.prepare("UPDATE forecasts SET settled_outcome = ?, settled_at = ? WHERE id = ? AND settled_at IS NULL").bind(o, now, r.id));
  }
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  return { examined: rows.results.length, settled: stmts.length - voided, void: voided };
}
