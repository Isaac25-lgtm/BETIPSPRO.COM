import type { Env } from "../env.ts";
import { ApiError } from "../lib/http.ts";
import { eatDayBounds, nowIso, todayEat } from "../lib/time.ts";
import { catalog, marketById } from "../../shared/markets.ts";

export interface TeamRef {
  id: string;
  name: string;
  short_name: string;
  code: string | null;
  primary_color: string | null;
  secondary_color: string | null;
}

export interface FixtureSummary {
  id: string;
  starts_at_utc: string;
  status: string;
  display_status: string;
  round: string | null;
  score: { home: number | null; away: number | null };
  is_synthetic: boolean;
  is_public_sample: boolean;
  competition: { id: string; name: string; short_name: string; country: string; is_synthetic: boolean };
  home: TeamRef;
  away: TeamRef;
  report: { available: boolean; version: string | null };
  featured: null | {
    market_id: string;
    label: string;
    short_label: string;
    probability: number | null;
    status: string;
    odds: null | { decimal: number; bookmaker: string; is_synthetic: boolean; collected_at: string };
  };
}

export const FIXTURE_SELECT = `
  SELECT f.id, f.starts_at_utc, f.status, f.round, f.home_goals, f.away_goals, f.home_goals_ht, f.away_goals_ht,
         f.is_synthetic, f.is_public_sample, f.venue_name, f.venue_city, f.referee_id, f.kickoff_confirmed, f.season,
         f.provider, f.provider_id, f.provider_last_updated, f.competition_id,
         c.name AS c_name, c.short_name AS c_short, c.country AS c_country, c.is_synthetic AS c_syn, c.rights_status AS c_rights,
         h.id AS h_id, h.name AS h_name, h.short_name AS h_short, h.code AS h_code, h.primary_color AS h_c1, h.secondary_color AS h_c2,
         a.id AS a_id, a.name AS a_name, a.short_name AS a_short, a.code AS a_code, a.primary_color AS a_c1, a.secondary_color AS a_c2,
         r.report_version, r.featured_market_id, r.generated_at AS report_generated_at, r.summary_json, r.report_status
    FROM fixtures f
    JOIN competitions c ON c.id = f.competition_id
    JOIN teams h ON h.id = f.home_team_id
    JOIN teams a ON a.id = f.away_team_id
    LEFT JOIN match_reports r ON r.id = (SELECT id FROM match_reports WHERE fixture_id = f.id ORDER BY generated_at DESC LIMIT 1)`;

export type FixtureRow = Record<string, unknown> & {
  id: string; starts_at_utc: string; status: string; round: string | null; home_goals: number | null; away_goals: number | null;
  home_goals_ht: number | null; away_goals_ht: number | null; is_synthetic: number; is_public_sample: number;
  venue_name: string | null; venue_city: string | null; referee_id: string | null; kickoff_confirmed: number; season: string;
  provider: string; provider_id: string; provider_last_updated: string | null; competition_id: string;
  c_name: string; c_short: string; c_country: string; c_syn: number; c_rights: string;
  h_id: string; h_name: string; h_short: string; h_code: string | null; h_c1: string | null; h_c2: string | null;
  a_id: string; a_name: string; a_short: string; a_code: string | null; a_c1: string | null; a_c2: string | null;
  report_version: string | null; featured_market_id: string | null; report_generated_at: string | null; summary_json: string | null; report_status: string | null;
};

export function displayStatus(status: string, startsAt: string): string {
  if ((status === "NS" || status === "TBD") && startsAt < nowIso()) return "AWAITING_RESULT";
  return status;
}

export function toSummary(r: FixtureRow): Omit<FixtureSummary, "featured"> {
  return {
    id: r.id,
    starts_at_utc: r.starts_at_utc,
    status: r.status,
    display_status: displayStatus(r.status, r.starts_at_utc),
    round: r.round,
    score: { home: r.home_goals, away: r.away_goals },
    is_synthetic: !!r.is_synthetic,
    is_public_sample: !!r.is_public_sample,
    competition: { id: r.competition_id, name: r.c_name, short_name: r.c_short, country: r.c_country, is_synthetic: !!r.c_syn },
    home: { id: r.h_id, name: r.h_name, short_name: r.h_short, code: r.h_code, primary_color: r.h_c1, secondary_color: r.h_c2 },
    away: { id: r.a_id, name: r.a_name, short_name: r.a_short, code: r.a_code, primary_color: r.a_c1, secondary_color: r.a_c2 },
    report: { available: !!r.report_version, version: r.report_version },
  };
}

export async function getFixtureRow(env: Env, id: string): Promise<FixtureRow> {
  const row = await env.DB.prepare(`${FIXTURE_SELECT} WHERE f.id = ?`).bind(id).first<FixtureRow>();
  if (!row) throw new ApiError(404, "NOT_FOUND", "Fixture not found.");
  return row;
}

export interface ListParams {
  date?: string;
  league?: string;
  team?: string;
  q?: string;
  status?: "upcoming" | "finished" | "all";
  page: number;
  pageSize: number;
}

/**
 * Once real (non-synthetic) reports exist, synthetic demo records are hidden from public listings
 * so testers never see fictional and real matches mixed. Cached per isolate for 60s.
 */
let realReadyCache: { at: number; value: boolean } | null = null;
export async function realDataReady(env: Env): Promise<boolean> {
  if (realReadyCache && Date.now() - realReadyCache.at < 60_000) return realReadyCache.value;
  const r = await env.DB.prepare("SELECT EXISTS (SELECT 1 FROM match_reports r JOIN fixtures f ON f.id = r.fixture_id WHERE f.is_synthetic = 0) AS v").first<{ v: number }>();
  realReadyCache = { at: Date.now(), value: !!r?.v };
  return realReadyCache.value;
}

export async function listFixtures(env: Env, p: ListParams) {
  const where: string[] = [];
  const binds: unknown[] = [];
  let range: { start: string; end: string } | null = null;
  if (p.date || !p.q) {
    range = eatDayBounds(p.date ?? todayEat());
  } else {
    const now = Date.now();
    range = { start: new Date(now - 30 * 86_400_000).toISOString(), end: new Date(now + 30 * 86_400_000).toISOString() };
  }
  where.push("f.starts_at_utc >= ? AND f.starts_at_utc < ?");
  if (await realDataReady(env)) where.push("f.is_synthetic = 0");
  binds.push(range.start, range.end);
  if (p.league) { where.push("f.competition_id = ?"); binds.push(p.league); }
  if (p.team) { where.push("(f.home_team_id = ? OR f.away_team_id = ?)"); binds.push(p.team, p.team); }
  if (p.q) {
    where.push("(h.name LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
    const like = `%${p.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    binds.push(like, like, like);
  }
  if (p.status === "upcoming") where.push("f.status IN ('NS','TBD')");
  if (p.status === "finished") where.push("f.status IN ('FT','AET','PEN')");

  const sql = `${FIXTURE_SELECT} WHERE ${where.join(" AND ")} ORDER BY c.display_order, c.name, f.starts_at_utc, f.id LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS n FROM fixtures f JOIN competitions c ON c.id = f.competition_id JOIN teams h ON h.id = f.home_team_id JOIN teams a ON a.id = f.away_team_id WHERE ${where.join(" AND ")}`;
  const [rows, count] = await env.DB.batch<FixtureRow | { n: number }>([
    env.DB.prepare(sql).bind(...binds, p.pageSize, (p.page - 1) * p.pageSize),
    env.DB.prepare(countSql).bind(...binds),
  ]);
  const list = rows.results as FixtureRow[];
  const items = await attachFeatured(env, list);
  return { items, total: (count.results[0] as { n: number }).n, page: p.page, page_size: p.pageSize, range };
}

/** Public "featured market" sample per fixture: one probability + (labelled) price, no other markets. */
export async function attachFeatured(env: Env, rows: FixtureRow[]): Promise<FixtureSummary[]> {
  const withFeatured = rows.filter((r) => r.featured_market_id && r.report_version);
  const probs = new Map<string, { probability: number | null; status: string }>();
  const odds = new Map<string, { decimal: number; bookmaker: string; is_synthetic: boolean; collected_at: string }>();
  if (withFeatured.length) {
    const keys = JSON.stringify(withFeatured.map((r) => [r.id, r.featured_market_id, r.report_version]));
    const [fc, od] = await env.DB.batch<Record<string, unknown>>([
      env.DB.prepare(
        `SELECT fo.fixture_id, fo.probability, fo.status FROM forecasts fo
           JOIN json_each(?) j ON fo.fixture_id = json_extract(j.value, '$[0]')
                              AND fo.market_definition_id = json_extract(j.value, '$[1]')
                              AND fo.model_run_id = json_extract(j.value, '$[2]')`,
      ).bind(keys),
      env.DB.prepare(
        `SELECT b.fixture_id, b.odds_decimal, b.bookmaker_name, b.is_synthetic, b.collected_at FROM bookmaker_snapshots b
           JOIN json_each(?) j ON b.fixture_id = json_extract(j.value, '$[0]') AND b.market_definition_id = json_extract(j.value, '$[1]')
          WHERE b.stale_after > ? ORDER BY b.collected_at`,
      ).bind(keys, nowIso()),
    ]);
    for (const r of fc.results) probs.set(r.fixture_id as string, { probability: r.probability as number | null, status: r.status as string });
    // Best available price in the most recent update (rows are ordered by collected_at).
    for (const r of od.results) {
      const prev = odds.get(r.fixture_id as string);
      const newer = !prev || (r.collected_at as string) > prev.collected_at;
      if (newer || ((r.collected_at as string) === prev!.collected_at && (r.odds_decimal as number) > prev!.decimal)) {
        odds.set(r.fixture_id as string, { decimal: r.odds_decimal as number, bookmaker: r.bookmaker_name as string, is_synthetic: !!r.is_synthetic, collected_at: r.collected_at as string });
      }
    }
  }
  return rows.map((r) => {
    const base = toSummary(r);
    const m = r.featured_market_id ? marketById.get(r.featured_market_id) : undefined;
    const pr = probs.get(r.id);
    return {
      ...base,
      featured: m && pr ? { market_id: m.id, label: m.label, short_label: m.short_label, probability: pr.probability, status: pr.status, odds: odds.get(r.id) ?? null } : null,
    };
  });
}

export interface FormEntry {
  fixture_id: string;
  starts_at_utc: string;
  competition: string;
  venue: "H" | "A";
  opponent: string;
  goals_for: number;
  goals_against: number;
  result: "W" | "D" | "L";
}

export async function teamForm(env: Env, teamId: string, before: string, limit = 5): Promise<FormEntry[]> {
  const res = await env.DB.prepare(
    `SELECT f.id, f.starts_at_utc, f.home_team_id, f.home_goals, f.away_goals, c.short_name AS comp, h.name AS hname, a.name AS aname
       FROM fixtures f JOIN competitions c ON c.id = f.competition_id JOIN teams h ON h.id = f.home_team_id JOIN teams a ON a.id = f.away_team_id
      WHERE (f.home_team_id = ?1 OR f.away_team_id = ?1) AND f.status IN ('FT','AET','PEN') AND f.starts_at_utc < ?2
      ORDER BY f.starts_at_utc DESC LIMIT ?3`,
  )
    .bind(teamId, before, limit)
    .all<{ id: string; starts_at_utc: string; home_team_id: string; home_goals: number; away_goals: number; comp: string; hname: string; aname: string }>();
  return res.results.map((r) => {
    const home = r.home_team_id === teamId;
    const gf = home ? r.home_goals : r.away_goals;
    const ga = home ? r.away_goals : r.home_goals;
    return {
      fixture_id: r.id, starts_at_utc: r.starts_at_utc, competition: r.comp, venue: home ? "H" : "A",
      opponent: home ? r.aname : r.hname, goals_for: gf, goals_against: ga, result: gf > ga ? "W" : gf < ga ? "L" : "D",
    };
  });
}

export async function fixturePreview(env: Env, id: string) {
  const row = await getFixtureRow(env, id);
  const [summary] = await attachFeatured(env, [row]);
  const [homeForm, awayForm] = await Promise.all([teamForm(env, row.h_id, row.starts_at_utc), teamForm(env, row.a_id, row.starts_at_utc)]);
  let marketStatus: Array<{ id: string; status: string }> = [];
  let referee: string | null = null;
  let oddsCount = 0;
  if (row.report_version) {
    const [fs, ref, oc] = await env.DB.batch<Record<string, unknown>>([
      env.DB.prepare("SELECT market_definition_id AS id, status FROM forecasts WHERE fixture_id = ? AND model_run_id = ?").bind(id, row.report_version),
      env.DB.prepare("SELECT name FROM referees WHERE id = ?").bind(row.referee_id ?? ""),
      env.DB.prepare("SELECT COUNT(*) AS n FROM bookmaker_snapshots WHERE fixture_id = ?").bind(id),
    ]);
    marketStatus = fs.results as Array<{ id: string; status: string }>;
    referee = (ref.results[0]?.name as string) ?? null;
    oddsCount = (oc.results[0]?.n as number) ?? 0;
  }
  const statusById = new Map(marketStatus.map((m) => [m.id, m.status]));
  const summaryJson = row.summary_json ? JSON.parse(row.summary_json) : null;
  return {
    fixture: {
      ...summary,
      season: row.season,
      venue: row.venue_name ? { name: row.venue_name, city: row.venue_city } : null,
      referee: referee ? { name: referee, confirmed: false } : null,
      kickoff_confirmed: !!row.kickoff_confirmed,
      provider: row.provider,
      provider_last_updated: row.provider_last_updated,
      rights_status: row.c_rights,
    },
    form: { home: homeForm, away: awayForm },
    report: row.report_version
      ? {
          version: row.report_version,
          generated_at: row.report_generated_at,
          status: row.report_status,
          data_as_of_at: summaryJson?.data_as_of_at ?? null,
          featured_rule: summaryJson?.featured?.rule ?? null,
          featured_base_rate: summaryJson?.featured?.league_base_rate ?? null,
          odds_snapshots: oddsCount,
        }
      : null,
    markets: catalog.markets.map((m) => ({
      id: m.id, label: m.label, short_label: m.short_label, category: m.category, tier: m.tier,
      status: statusById.get(m.id) ?? (row.report_version ? "NOT_MODELLED" : "NO_REPORT"),
    })),
    categories: catalog.categories,
    unsupported: catalog.unsupported,
  };
}
