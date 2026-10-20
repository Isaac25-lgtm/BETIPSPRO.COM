/**
 * Bookmaker prices from The Odds API, matched to our fixtures and stored as bookmaker_snapshots (append-only history).
 *
 * - All calls go through the metered gateway (provider "the_odds_api"); responses are cached as provider snapshots.
 * - Events are matched to our fixtures by competition, kickoff (within 3 hours) and team-name similarity; an event
 *   that does not match one of our upcoming fixtures clearly is skipped, never guessed.
 * - Markets: 3-way match result (90 minutes) and goal totals at 1.5 / 2.5 / 3.5 / 4.5. Prices are real bookmaker
 *   quotes with the bookmaker named; nothing is synthesised.
 */
import type { Env } from "../../env.ts";
import { nowIso } from "../../lib/time.ts";
import { meteredGet, providerConfigured } from "./budget.ts";

/** Our competition id -> The Odds API sport key. */
export const ODDS_SPORTS: Record<string, string> = {
  "apif:39": "soccer_epl",
  "apif:140": "soccer_spain_la_liga",
  "apif:135": "soccer_italy_serie_a",
  "apif:78": "soccer_germany_bundesliga",
  "apif:61": "soccer_france_ligue_one",
  "apif:2": "soccer_uefa_champs_league",
};

interface OddsEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{ key: string; title: string; last_update: string; markets: Array<{ key: string; last_update?: string; outcomes: Array<{ name: string; price: number; point?: number }> }> }>;
}

const STOP = new Set(["fc", "cf", "afc", "sc", "ac", "as", "ssc", "club", "de", "del", "la", "the", "fk", "sk", "pae", "rc", "cd", "ud", "sd", "rcd", "sv", "vfl", "tsg", "1", "04", "05", "1899", "1901", "1907", "29", "calcio", "football", "futbol"]);
const ALIASES: Record<string, string> = { munich: "munchen", internazionale: "inter", lisbon: "portugal", athens: "aek", saint: "st", germain: "germain", sporting: "sporting", atletico: "atletico" };

export function teamTokens(name: string): string[] {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/).filter((t) => t && !STOP.has(t))
    .map((t) => ALIASES[t] ?? t);
}

/** Similarity of two team names in [0, 1]: token overlap, with 4-letter prefix matches counted (Munich/Munchen). */
export function teamSimilarity(a: string, b: string): number {
  const ta = teamTokens(a), tb = teamTokens(b);
  if (!ta.length || !tb.length) return 0;
  const hit = (x: string, ys: string[]) => ys.some((y) => y === x || (x.length >= 4 && y.length >= 4 && x.slice(0, 4) === y.slice(0, 4)));
  const ab = ta.filter((x) => hit(x, tb)).length, ba = tb.filter((y) => hit(y, ta)).length;
  return Math.max(ab / ta.length, ba / tb.length) * 0.7 + Math.min(ab / ta.length, ba / tb.length) * 0.3;
}

type Fx = { id: string; starts_at_utc: string; home: string; away: string; home_short: string; away_short: string };

/** Best fixture for an event: same competition (caller), kickoff within 3 h, both teams clearly similar. */
export function matchEvent(ev: Pick<OddsEvent, "commence_time" | "home_team" | "away_team">, fixtures: Fx[]): Fx | null {
  let best: { fx: Fx; score: number } | null = null;
  for (const fx of fixtures) {
    if (Math.abs(Date.parse(fx.starts_at_utc) - Date.parse(ev.commence_time)) > 3 * 3600_000) continue;
    const h = Math.max(teamSimilarity(ev.home_team, fx.home), teamSimilarity(ev.home_team, fx.home_short));
    const a = Math.max(teamSimilarity(ev.away_team, fx.away), teamSimilarity(ev.away_team, fx.away_short));
    if (h < 0.35 || a < 0.35) continue;
    const score = h + a;
    if (!best || score > best.score) best = { fx, score };
  }
  return best?.fx ?? null;
}

const TOTALS: Record<string, [string, string]> = {
  "1.5": ["TOTAL_GOALS_OVER_1_5_REGULATION", "TOTAL_GOALS_UNDER_1_5_REGULATION"],
  "2.5": ["TOTAL_GOALS_OVER_2_5_REGULATION", "TOTAL_GOALS_UNDER_2_5_REGULATION"],
  "3.5": ["TOTAL_GOALS_OVER_3_5_REGULATION", "TOTAL_GOALS_UNDER_3_5_REGULATION"],
  "4.5": ["TOTAL_GOALS_OVER_4_5_REGULATION", "TOTAL_GOALS_UNDER_4_5_REGULATION"],
};

/** Rows to store for one matched event (one per bookmaker per market). */
export function eventRows(ev: OddsEvent, fx: Fx, collectedAt: string) {
  const rows: Array<[string, string, string, string, number, string, string, string, number]> = [];
  for (const b of ev.bookmakers ?? []) {
    for (const m of b.markets ?? []) {
      for (const o of m.outcomes ?? []) {
        if (!(o.price > 1 && o.price < 1000)) continue;
        let market: string | null = null;
        if (m.key === "h2h") market = o.name === ev.home_team ? "MATCH_RESULT_HOME_REGULATION" : o.name === ev.away_team ? "MATCH_RESULT_AWAY_REGULATION" : o.name === "Draw" ? "MATCH_RESULT_DRAW_REGULATION" : null;
        else if (m.key === "totals" && o.point != null && TOTALS[String(o.point)]) market = o.name === "Over" ? TOTALS[String(o.point)][0] : o.name === "Under" ? TOTALS[String(o.point)][1] : null;
        if (!market) continue;
        rows.push([`odds_${fx.id}_${market}_${b.key}_${collectedAt}`, fx.id, market, b.title, o.price, collectedAt, fx.starts_at_utc, "the_odds_api", 0]);
      }
    }
  }
  return rows;
}

export async function refreshOdds(env: Env, opts: { jobId?: string | null; fetchImpl?: typeof fetch } = {}) {
  if (!providerConfigured(env, "the_odds_api")) return { skipped: "ODDS_API_KEY not configured" };
  const out: Record<string, { events: number; matched: number; rows: number; error?: string }> = {};
  const now = nowIso();
  for (const [comp, sport] of Object.entries(ODDS_SPORTS)) {
    const fx = await env.DB.prepare(
      `SELECT f.id, f.starts_at_utc, h.name AS home, a.name AS away, h.short_name AS home_short, a.short_name AS away_short
         FROM fixtures f JOIN teams h ON h.id = f.home_team_id JOIN teams a ON a.id = f.away_team_id
        WHERE f.competition_id = ? AND f.status IN ('NS','TBD') AND f.starts_at_utc > ? AND f.is_synthetic = 0`,
    ).bind(comp, now).all<Fx>();
    if (!fx.results.length) { out[comp] = { events: 0, matched: 0, rows: 0 }; continue; }
    try {
      const res = await meteredGet<OddsEvent[]>(env, `/sports/${sport}/odds`, { regions: "eu", markets: "h2h,totals", oddsFormat: "decimal", dateFormat: "iso" },
        { ttlSec: 6 * 3600, provider: "the_odds_api", jobId: opts.jobId ?? null, fetchImpl: opts.fetchImpl });
      const collected = res.fetchedAt;
      const rows = [];
      let matched = 0;
      for (const ev of res.body) {
        const f = matchEvent(ev, fx.results);
        if (!f) continue;
        matched++;
        rows.push(...eventRows(ev, f, collected));
      }
      const stmts: D1PreparedStatement[] = [];
      for (let i = 0; i < rows.length; i += 10) {
        const chunk = rows.slice(i, i + 10);
        stmts.push(env.DB.prepare(
          `INSERT OR IGNORE INTO bookmaker_snapshots (id, fixture_id, market_definition_id, bookmaker_name, odds_decimal, collected_at, stale_after, provider_source, is_synthetic) VALUES ${chunk.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")}`,
        ).bind(...chunk.flat()));
      }
      for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
      out[comp] = { events: res.body.length, matched, rows: rows.length };
    } catch (e) {
      out[comp] = { events: 0, matched: 0, rows: 0, error: (e as Error).message.slice(0, 160) };
      if (/BUDGET|RATE|remaining/i.test((e as Error).message)) break;
    }
  }
  return out;
}
