/**
 * Full report + per-market evidence. Everything here is computed from stored records:
 * the forecast row (immutable), model drivers, and the actual prior fixtures/statistics that
 * were available at the forecast's data_as_of_at. Historical hit-rates are shown SEPARATELY
 * from the model probability and are never presented as the same thing.
 */
import type { Env } from "../env.ts";
import { ApiError } from "../lib/http.ts";
import { nowIso } from "../lib/time.ts";
import { catalog, evidenceKind, exclusiveGroup, marketById, settle, type MarketDef, type Outcome, type Predicate } from "../../shared/markets.ts";
import { getFixtureRow, teamForm, type FixtureRow } from "./fixtures.ts";
import { explainMarket } from "./explain.ts";

const COMPLETED = "('FT','AET','PEN')";

export interface HistMatch {
  fixture_id: string;
  starts_at_utc: string;
  competition: string;
  season: string;
  home_team_id: string;
  away_team_id: string;
  home_name: string;
  away_name: string;
  hg: number;
  ag: number;
  hth: number | null;
  ath: number | null;
  home_corners: number | null;
  away_corners: number | null;
  home_yc: number | null;
  away_yc: number | null;
  referee_id: string | null;
  is_synthetic: number;
}

const HIST_SELECT = `
  SELECT f.id AS fixture_id, f.starts_at_utc, c.short_name AS competition, f.season, f.home_team_id, f.away_team_id,
         h.name AS home_name, a.name AS away_name, f.home_goals AS hg, f.away_goals AS ag, f.home_goals_ht AS hth, f.away_goals_ht AS ath,
         hs.corners AS home_corners, aws.corners AS away_corners, hs.yellow_cards AS home_yc, aws.yellow_cards AS away_yc,
         f.referee_id, f.is_synthetic
    FROM fixtures f
    JOIN competitions c ON c.id = f.competition_id
    JOIN teams h ON h.id = f.home_team_id
    JOIN teams a ON a.id = f.away_team_id
    LEFT JOIN fixture_team_stats hs ON hs.fixture_id = f.id AND hs.team_id = f.home_team_id
    LEFT JOIN fixture_team_stats aws ON aws.fixture_id = f.id AND aws.team_id = f.away_team_id`;

/** Re-orient a past match so the market's HOME side refers to `perspective` playing as `role`. */
function orient(m: HistMatch, perspective: string | null, role: "HOME" | "AWAY"): Outcome {
  const total = (a: number | null, b: number | null) => (a == null || b == null ? null : a + b);
  const base: Outcome = { hg: m.hg, ag: m.ag, hth: m.hth, ath: m.ath, corners_total: total(m.home_corners, m.away_corners), yellow_total: total(m.home_yc, m.away_yc) };
  if (!perspective) return base;
  const pIsHome = m.home_team_id === perspective;
  const swap = (role === "HOME") !== pIsHome;
  return swap ? { ...base, hg: m.ag, ag: m.hg, hth: m.ath, ath: m.hth } : base;
}

interface EvidenceRow {
  fixture_id: string;
  date: string;
  competition: string;
  home: string;
  away: string;
  score: string;
  ht_score: string | null;
  venue: "H" | "A" | null;
  corners: { home: number | null; away: number | null; total: number | null };
  yellow_cards: { home: number | null; away: number | null; total: number | null };
  stat_value: number | null;
  hit: 0 | 1 | null;
  is_synthetic: boolean;
}

interface EvidenceSet {
  key: string;
  title: string;
  window: string;
  perspective_team: string | null;
  sample: number;
  settled: number;
  hits: number;
  rate: number | null;
  averages: Record<string, number | null>;
  rows: EvidenceRow[];
}

function statValue(kind: "goals" | "corners" | "cards", p: Predicate, o: Outcome): number | null {
  if (kind === "corners") return o.corners_total;
  if (kind === "cards") return o.yellow_total;
  if (p.period === "HT") return o.hth == null || o.ath == null ? null : o.hth + o.ath;
  return o.hg == null || o.ag == null ? null : o.hg + o.ag;
}

function buildSet(key: string, title: string, window: string, matches: HistMatch[], market: MarketDef, perspective: string | null, role: "HOME" | "AWAY", kind: "goals" | "corners" | "cards"): EvidenceSet {
  const rows: EvidenceRow[] = matches.map((m) => {
    const o = orient(m, perspective, role);
    const hit = settle(market.predicate, o);
    return {
      fixture_id: m.fixture_id,
      date: m.starts_at_utc,
      competition: m.competition,
      home: m.home_name,
      away: m.away_name,
      score: `${m.hg}-${m.ag}`,
      ht_score: m.hth == null ? null : `${m.hth}-${m.ath}`,
      venue: perspective ? (m.home_team_id === perspective ? "H" : "A") : null,
      corners: { home: m.home_corners, away: m.away_corners, total: o.corners_total },
      yellow_cards: { home: m.home_yc, away: m.away_yc, total: o.yellow_total },
      stat_value: statValue(kind, market.predicate, o),
      hit,
      is_synthetic: !!m.is_synthetic,
    };
  });
  const settled = rows.filter((r) => r.hit !== null);
  const hits = settled.filter((r) => r.hit === 1).length;
  const vals = rows.map((r) => r.stat_value).filter((v): v is number => v != null);
  const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
  const averages: Record<string, number | null> = { mean: round(mean, 2), median };
  if (perspective) {
    const forAgainst = matches.map((m) => {
      const home = m.home_team_id === perspective;
      const pick = (h: number | null, a: number | null) => (home ? [h, a] : [a, h]);
      const [gf, ga] = pick(m.hg, m.ag);
      const [cf, ca] = pick(m.home_corners, m.away_corners);
      const [yf, ya] = pick(m.home_yc, m.away_yc);
      return { gf, ga, cf, ca, yf, ya };
    });
    const avg = (k: keyof (typeof forAgainst)[number]) => {
      const v = forAgainst.map((x) => x[k]).filter((x): x is number => x != null);
      return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length, 2) : null;
    };
    Object.assign(averages, kind === "goals" ? { goals_for: avg("gf"), goals_against: avg("ga") } : kind === "corners" ? { corners_for: avg("cf"), corners_against: avg("ca") } : { yellows_for: avg("yf"), yellows_against: avg("ya") });
  }
  return { key, title, window, perspective_team: perspective, sample: rows.length, settled: settled.length, hits, rate: settled.length ? round(hits / settled.length, 4) : null, averages, rows };
}

const round = (v: number | null, d = 3) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

async function latestForecasts(env: Env, fixtureId: string, runId: string) {
  const res = await env.DB.prepare(
    `SELECT market_definition_id AS market_id, probability, status, quality_reason, uncertainty_json, model_version, generated_at, data_as_of_at, dataset_hash, model_run_id
       FROM forecasts WHERE fixture_id = ? AND model_run_id = ?`,
  )
    .bind(fixtureId, runId)
    .all<{ market_id: string; probability: number | null; status: string; quality_reason: string | null; uncertainty_json: string; model_version: string; generated_at: string; data_as_of_at: string; dataset_hash: string; model_run_id: string }>();
  return res.results;
}

function oddsView(rows: Array<{ market_definition_id: string; bookmaker_name: string; odds_decimal: number; collected_at: string; stale_after: string; is_synthetic: number; provider_source: string }>, market: MarketDef) {
  const group = exclusiveGroup(market);
  const now = nowIso();
  const byBook = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!group.some((g) => g.id === r.market_definition_id)) continue;
    const list = byBook.get(r.bookmaker_name) ?? [];
    list.push(r);
    byBook.set(r.bookmaker_name, list);
  }
  return [...byBook.entries()].map(([bookmaker, list]) => {
    const latest = new Map<string, (typeof list)[number]>();
    for (const r of list) {
      const prev = latest.get(r.market_definition_id);
      if (!prev || prev.collected_at < r.collected_at) latest.set(r.market_definition_id, r);
    }
    const sel = latest.get(market.id);
    const complete = group.every((g) => latest.has(g.id)) && group.length > 1;
    const overround = complete ? group.reduce((s, g) => s + 1 / latest.get(g.id)!.odds_decimal, 0) : null;
    return {
      bookmaker,
      is_synthetic: !!sel?.is_synthetic,
      provider_source: sel?.provider_source ?? null,
      decimal: sel?.odds_decimal ?? null,
      implied_probability: sel ? round(1 / sel.odds_decimal, 4) : null,
      normalized_probability: sel && overround ? round(1 / sel.odds_decimal / overround, 4) : null,
      overround: overround == null ? null : round(overround, 4),
      collected_at: sel?.collected_at ?? null,
      stale: sel ? sel.stale_after <= now : true,
      group: group.map((g) => ({ market_id: g.id, label: g.short_label, decimal: latest.get(g.id)?.odds_decimal ?? null })),
    };
  });
}

export async function fullReport(env: Env, fixtureId: string) {
  const row = await getFixtureRow(env, fixtureId);
  if (!row.report_version) throw new ApiError(409, "REPORT_UNAVAILABLE", "No report has been prepared for this fixture.");
  const runId = row.report_version;
  const [rep, drv, odds, run] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT summary_json, analysis_json, evidence_manifest_json, generated_at, report_status FROM match_reports WHERE fixture_id = ? AND report_version = ?").bind(fixtureId, runId),
    env.DB.prepare("SELECT model_family, metric, value, sample_window FROM forecast_evidence WHERE fixture_id = ? AND model_run_id = ? ORDER BY model_family, metric").bind(fixtureId, runId),
    env.DB.prepare("SELECT market_definition_id, bookmaker_name, odds_decimal, collected_at, stale_after, is_synthetic, provider_source FROM bookmaker_snapshots WHERE fixture_id = ?").bind(fixtureId),
    env.DB.prepare("SELECT id, model_version, pipeline_version, dataset_hash, data_mode, generated_at, data_as_of_at, market_catalog_version, config_json FROM model_runs WHERE id = ?").bind(runId),
  ]);
  // R-11: supporting history stops at the forecast's data cut-off, not at kickoff, so later matches never appear.
  const runAsOf = (run.results[0] as { data_as_of_at?: string } | undefined)?.data_as_of_at;
  const histCutoff = runAsOf && runAsOf < row.starts_at_utc ? new Date(Date.parse(runAsOf) + 1000).toISOString() : row.starts_at_utc;
  const h2h = await env.DB.prepare(`${HIST_SELECT} WHERE ((f.home_team_id = ?1 AND f.away_team_id = ?2) OR (f.home_team_id = ?2 AND f.away_team_id = ?1)) AND f.status IN ${COMPLETED} AND f.starts_at_utc < ?3 ORDER BY f.starts_at_utc DESC LIMIT 6`).bind(row.h_id, row.a_id, histCutoff).all();
  const forecasts = await latestForecasts(env, fixtureId, runId);
  const report = rep.results[0] as { summary_json: string; analysis_json: string; evidence_manifest_json: string; generated_at: string; report_status: string };
  const modelRun = run.results[0] as Record<string, unknown>;
  const oddsRows = odds.results as Parameters<typeof oddsView>[0];
  const fcById = new Map(forecasts.map((f) => [f.market_id, f]));
  const [homeForm, awayForm] = await Promise.all([teamForm(env, row.h_id, histCutoff, 10), teamForm(env, row.a_id, histCutoff, 10)]);

  const markets = catalog.markets.map((m) => {
    const f = fcById.get(m.id);
    const quotes = oddsView(oddsRows, m).filter((o) => o.decimal != null && !o.stale);
    const ov = quotes.sort((a, b) => (b.decimal ?? 0) - (a.decimal ?? 0))[0] ?? oddsView(oddsRows, m).find((o) => o.decimal != null) ?? null;
    return {
      id: m.id, label: m.label, short_label: m.short_label, category: m.category, family: m.family, tier: m.tier,
      settlement_period: m.settlement_period,
      probability: f?.probability ?? null,
      status: f?.status ?? "NOT_MODELLED",
      quality_reason: f?.quality_reason ?? (f ? null : "This market was not modelled for this fixture."),
      uncertainty: f ? JSON.parse(f.uncertainty_json) : null,
      model_version: f?.model_version ?? null,
      generated_at: f?.generated_at ?? null,
      price: ov ? { bookmaker: ov.bookmaker, decimal: ov.decimal, implied_probability: ov.implied_probability, is_synthetic: ov.is_synthetic, stale: ov.stale, bookmakers: quotes.length } : null,
    };
  });

  // R-05: a component whose probabilities are withheld also withholds its distribution and drivers.
  const gate = componentGate(forecasts);
  const drivers: Record<string, Array<{ metric: string; value: number | null; sample_window: string | null }>> = {};
  for (const d of drv.results as Array<{ model_family: string; metric: string; value: number | null; sample_window: string | null }>) {
    if (!gate.family(d.model_family)) continue;
    (drivers[d.model_family] ??= []).push({ metric: d.metric, value: d.value, sample_window: d.sample_window });
  }
  const isDemo = modelRun?.data_mode === "SIMULATED_DEMO";
  return {
    fixture_id: fixtureId,
    report_version: runId,
    report_status: report.report_status,
    generated_at: report.generated_at,
    display_notice: isDemo ? "SYNTHETIC DEMO DATA: NOT A REAL FORECAST" : null,
    model_run: modelRun ? { ...modelRun, config: JSON.parse((modelRun.config_json as string) ?? "{}"), config_json: undefined } : null,
    summary: JSON.parse(report.summary_json),
    analysis: gate.analysis(JSON.parse(report.analysis_json)),
    evidence_manifest: JSON.parse(report.evidence_manifest_json),
    markets,
    drivers,
    form: { home: homeForm, away: awayForm },
    head_to_head: (h2h.results as unknown as HistMatch[]).map((m) => ({ fixture_id: m.fixture_id, date: m.starts_at_utc, competition: m.competition, home: m.home_name, away: m.away_name, score: `${m.hg}-${m.ag}`, ht_score: m.hth == null ? null : `${m.hth}-${m.ath}` })),
    coverage: {
      goals: gate.ft ? "available" : "insufficient",
      half_time_scores: forecasts.some((f) => f.market_id.startsWith("FIRST_HALF") && f.probability != null) ? "available" : "unavailable",
      corners: forecasts.some((f) => f.market_id.startsWith("TOTAL_CORNERS") && f.probability != null) ? "available" : "unavailable",
      cards: forecasts.some((f) => f.market_id.startsWith("TOTAL_YELLOW") && f.probability != null) ? "available" : "unavailable",
      xg: "unavailable",
      lineups: "unavailable",
      injuries: "unavailable",
      odds: oddsRows.length ? (oddsRows.every((o) => o.is_synthetic) ? "synthetic_demo_only" : "available") : "unavailable",
    },
    unsupported: catalog.unsupported,
  };
}

export async function marketEvidence(env: Env, fixtureId: string, marketId: string) {
  const market = marketById.get(marketId);
  if (!market) throw new ApiError(404, "NOT_FOUND", "Unknown market.");
  const row: FixtureRow = await getFixtureRow(env, fixtureId);
  if (!row.report_version) throw new ApiError(409, "REPORT_UNAVAILABLE", "No report has been prepared for this fixture.");
  const runId = row.report_version;
  const fc = await env.DB.prepare(
    `SELECT probability, status, quality_reason, uncertainty_json, model_version, generated_at, data_as_of_at, dataset_hash
       FROM forecasts WHERE fixture_id = ? AND market_definition_id = ? AND model_run_id = ?`,
  )
    .bind(fixtureId, marketId, runId)
    .first<{ probability: number | null; status: string; quality_reason: string | null; uncertainty_json: string; model_version: string; generated_at: string; data_as_of_at: string; dataset_hash: string }>();
  const kind = evidenceKind(market);
  // Evidence is cut at the forecast's data_as_of_at (inclusive) so it matches what the model saw.
  const cutoff = fc ? new Date(Date.parse(fc.data_as_of_at) + 1000).toISOString() : row.starts_at_utc;
  const curSeason = row.season;
  const stmts = [
    env.DB.prepare(`${HIST_SELECT} WHERE f.home_team_id = ?1 AND f.status IN ${COMPLETED} AND f.starts_at_utc < ?2 ORDER BY f.starts_at_utc DESC LIMIT 8`).bind(row.h_id, cutoff),
    env.DB.prepare(`${HIST_SELECT} WHERE f.away_team_id = ?1 AND f.status IN ${COMPLETED} AND f.starts_at_utc < ?2 ORDER BY f.starts_at_utc DESC LIMIT 8`).bind(row.a_id, cutoff),
    env.DB.prepare(`${HIST_SELECT} WHERE (f.home_team_id = ?1 OR f.away_team_id = ?1) AND f.status IN ${COMPLETED} AND f.starts_at_utc < ?2 ORDER BY f.starts_at_utc DESC LIMIT 10`).bind(row.h_id, cutoff),
    env.DB.prepare(`${HIST_SELECT} WHERE (f.home_team_id = ?1 OR f.away_team_id = ?1) AND f.status IN ${COMPLETED} AND f.starts_at_utc < ?2 ORDER BY f.starts_at_utc DESC LIMIT 10`).bind(row.a_id, cutoff),
    env.DB.prepare(`${HIST_SELECT} WHERE ((f.home_team_id = ?1 AND f.away_team_id = ?2) OR (f.home_team_id = ?2 AND f.away_team_id = ?1)) AND f.status IN ${COMPLETED} AND f.starts_at_utc < ?3 ORDER BY f.starts_at_utc DESC LIMIT 6`).bind(row.h_id, row.a_id, cutoff),
    env.DB.prepare(`${HIST_SELECT} WHERE f.competition_id = ?1 AND f.season = ?2 AND f.status IN ${COMPLETED} AND f.starts_at_utc < ?3 ORDER BY f.starts_at_utc DESC LIMIT 400`).bind(row.competition_id, curSeason, cutoff),
    env.DB.prepare(`${HIST_SELECT} WHERE f.referee_id = ?1 AND f.status IN ${COMPLETED} AND f.starts_at_utc < ?2 ORDER BY f.starts_at_utc DESC LIMIT 10`).bind(row.referee_id ?? "", cutoff),
    env.DB.prepare("SELECT model_family, metric, value, sample_window FROM forecast_evidence WHERE fixture_id = ? AND model_run_id = ? AND model_family = ?").bind(fixtureId, runId, market.model_family),
    env.DB.prepare("SELECT market_definition_id, bookmaker_name, odds_decimal, collected_at, stale_after, is_synthetic, provider_source FROM bookmaker_snapshots WHERE fixture_id = ?").bind(fixtureId),
    env.DB.prepare("SELECT analysis_json, summary_json FROM match_reports WHERE fixture_id = ? AND report_version = ?").bind(fixtureId, runId),
    env.DB.prepare("SELECT name, is_synthetic FROM referees WHERE id = ?").bind(row.referee_id ?? ""),
    env.DB.prepare("SELECT data_mode FROM model_runs WHERE id = ?").bind(runId),
  ];
  const res = await env.DB.batch<Record<string, unknown>>(stmts);
  const H = (i: number) => res[i].results as unknown as HistMatch[];
  const homeName = row.h_name;
  const awayName = row.a_name;

  const sets: EvidenceSet[] = [
    buildSet("home_recent_home", `${homeName}: last home matches`, "LAST_8_HOME", H(0), market, row.h_id, "HOME", kind),
    buildSet("away_recent_away", `${awayName}: last away matches`, "LAST_8_AWAY", H(1), market, row.a_id, "AWAY", kind),
    buildSet("home_recent_all", `${homeName}: last 10 matches (all venues)`, "LAST_10_ALL", H(2), market, row.h_id, "HOME", kind),
    buildSet("away_recent_all", `${awayName}: last 10 matches (all venues)`, "LAST_10_ALL", H(3), market, row.a_id, "AWAY", kind),
    buildSet("head_to_head", `Head-to-head (oriented to ${homeName})`, "LAST_6_MEETINGS", H(4), market, row.h_id, "HOME", kind),
  ];
  const league = buildSet("league_baseline", `${row.c_name}: ${curSeason} season to date`, "SEASON_TO_DATE", H(5), market, null, "HOME", kind);
  league.rows = league.rows.slice(0, 0); // aggregate only (avoid shipping hundreds of rows)
  if (kind === "cards") {
    sets.push(buildSet("referee_recent", `Assigned referee: last 10 matches`, "LAST_10_REFEREE", H(6), market, null, "HOME", kind));
  }

  // Distribution (histogram) of the relevant statistic for each team's last-10 sample.
  const hist = (s: EvidenceSet) => {
    const counts: Record<string, number> = {};
    for (const r of s.rows) if (r.stat_value != null) counts[String(r.stat_value)] = (counts[String(r.stat_value)] ?? 0) + 1;
    return counts;
  };
  const report = res[9].results[0] as { analysis_json: string; summary_json: string } | undefined;
  const analysis = report ? JSON.parse(report.analysis_json) : {};
  const summary = report ? JSON.parse(report.summary_json) : {};
  const referee = res[10].results[0] as { name: string; is_synthetic: number } | undefined;
  const isDemo = (res[11].results[0] as { data_mode?: string } | undefined)?.data_mode === "SIMULATED_DEMO";
  const modelDist =
    kind === "corners" ? { type: "total_pmf", stat: "corners", values: analysis.corners_total_pmf ?? null }
    : kind === "cards" ? { type: "total_pmf", stat: "yellow_cards", values: analysis.cards_total_pmf ?? null }
    : market.predicate.period === "HT" ? { type: "scoreline_matrix", period: "HT", values: analysis.ht_matrix ?? null }
    : { type: "scoreline_matrix", period: "FT", values: analysis.scoreline_matrix ?? null };

  const odds = oddsView(res[8].results as Parameters<typeof oddsView>[0], market);
  const withheld = fc?.probability == null;
  if (withheld) (modelDist as { values: unknown }).values = null;
  const drivers = withheld ? [] : (res[7].results as Array<{ metric: string; value: number | null; sample_window: string | null }>);
  const forecast = fc
    ? { probability: fc.probability, status: fc.status, quality_reason: fc.quality_reason, uncertainty: JSON.parse(fc.uncertainty_json), model_version: fc.model_version, forecast_generated_at: fc.generated_at, as_of_data_at: fc.data_as_of_at, dataset_hash: fc.dataset_hash }
    : { probability: null, status: "INSUFFICIENT", quality_reason: "This market was not modelled for this fixture.", uncertainty: null, model_version: null, forecast_generated_at: null, as_of_data_at: null, dataset_hash: null };
  const baseRate = (summary?.baselines ?? {})[market.id] ?? league.rate;

  const sourceIds = new Set<string>();
  for (const s of sets) for (const r of s.rows) sourceIds.add(r.fixture_id);

  return {
    fixture_id: fixtureId,
    market_id: marketId,
    market: { id: market.id, label: market.label, short_label: market.short_label, category: market.category, family: market.family, tier: market.tier, settlement_period: market.settlement_period, settlement_rules: market.settlement_rules, model_family: market.model_family, validation_status: market.validation_status, threshold: market.threshold },
    fixture: { home: homeName, away: awayName, competition: row.c_name, starts_at_utc: row.starts_at_utc, referee: referee ? { name: referee.name, confirmed: false } : null },
    report_version: runId,
    forecast,
    evidence_kind: kind,
    observed_evidence: sets,
    league_baseline: { title: league.title, window: league.window, sample: league.sample, settled: league.settled, hits: league.hits, rate: league.rate, averages: league.averages, model_training_base_rate: baseRate },
    distributions: { model: modelDist, observed: { home_last10: hist(sets[2]), away_last10: hist(sets[3]) } },
    model_drivers: drivers,
    prices: odds,
    narrative: explainMarket({ market, forecast, sets, league, homeName, awayName, kind, referee: referee?.name ?? null, isDemo }),
    methodology:
      kind === "goals"
        ? "Model probability is derived from a Dixon-Coles scoreline distribution (team attack/defence ratings with time decay and shrinkage). It is NOT equal to any raw historical hit-rate shown below."
        : kind === "corners"
          ? "Model probability comes from a penalised negative-binomial model of each team's corners for/against (time-decayed); the two team distributions are convolved assuming independence."
          : "Model probability comes from a penalised negative-binomial model of total yellow cards with team and referee effects shrunk towards the league average.",
    data_coverage: {
      cutoff_used: cutoff,
      stats_rows_with_corners: sets[2].rows.filter((r) => r.corners.total != null).length + sets[3].rows.filter((r) => r.corners.total != null).length,
      stats_rows_with_cards: sets[2].rows.filter((r) => r.yellow_cards.total != null).length + sets[3].rows.filter((r) => r.yellow_cards.total != null).length,
      xg: "unavailable",
    },
    source_manifest: { source_fixture_ids: [...sourceIds], count: sourceIds.size, provider: isDemo ? "synthetic-demo" : row.provider },
    display_notice: isDemo ? "SYNTHETIC DEMO DATA: NOT A REAL FORECAST" : null,
  };
}


/** Which model components may be shown for a report: a component is shown only if at least one of its markets has
 * a published probability (R-05). The full-time goals component follows the home-win market, like the UI. */
export function componentGate(forecasts: Array<{ market_id: string; probability: number | null }>) {
  const has = (pred: (id: string) => boolean) => forecasts.some((f) => pred(f.market_id) && f.probability != null);
  const ft = forecasts.some((f) => f.market_id === "MATCH_RESULT_HOME_REGULATION" && f.probability != null);
  const ht = has((id) => id.startsWith("FIRST_HALF"));
  const corners = has((id) => id.startsWith("TOTAL_CORNERS"));
  const cards = has((id) => id.startsWith("TOTAL_YELLOW"));
  return {
    ft, ht, corners, cards,
    family: (f: string) => (f === "goals_dixon_coles" ? ft : f === "first_half_poisson" ? ht : f === "corners_negative_binomial" ? corners : f === "cards_negative_binomial" ? cards : true),
    analysis: (a: Record<string, unknown>) => ({
      ...a,
      scoreline_matrix: ft ? a.scoreline_matrix ?? null : null,
      ht_matrix: ht ? a.ht_matrix ?? null : null,
      corners_total_pmf: corners ? a.corners_total_pmf ?? null : null,
      cards_total_pmf: cards ? a.cards_total_pmf ?? null : null,
    }),
  };
}
