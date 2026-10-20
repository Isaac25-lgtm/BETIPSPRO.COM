/**
 * "Ask BetTipsPro AI": a chat assistant on DeepSeek (OpenAI-compatible API, function calling).
 *
 * Trust model (follow-up review F-01..F-06):
 *  - The model can only read the site's data through read-only tools. Its final text is VERIFIED before it is
 *    shown: every number must come from this turn's tool results (or the user's own question), every link must be
 *    /matches/<fixture> for a fixture those tools returned, and banned wording is refused. Anything else is
 *    replaced by an answer rendered deterministically from the tool results. Client-sent history is context only.
 *  - Question slots and spend are reserved atomically in D1 before work starts (per-visitor hourly limit, site-wide
 *    daily question limit, daily and monthly USD budgets with worst-case reservation per provider call).
 *  - Tools return only publishable forecasts (VERIFIED/PARTIAL) with period, data-as-of time and model version.
 * No conversation content is stored on the server.
 */
import type { Env } from "../env.ts";
import { ApiError } from "../lib/http.ts";
import { nowIso } from "../lib/time.ts";
import { marketById } from "../../shared/markets.ts";
import { openAccess } from "./access.ts";
import { realDataReady } from "./fixtures.ts";

const MODEL = "deepseek-flash";
const MAX_ROUNDS = 3;
const MAX_OUTPUT_TOKENS = 700;
const DEADLINE_MS = 40_000;
const HOURLY_PER_VISITOR = 30;
export const MAX_ANSWER_CHARS = 1800;
export const MAX_HISTORY_CHARS = 4000;

const POPULAR = [
  "MATCH_RESULT_HOME_REGULATION", "MATCH_RESULT_DRAW_REGULATION", "MATCH_RESULT_AWAY_REGULATION",
  "DOUBLE_CHANCE_HOME_DRAW_REGULATION", "DOUBLE_CHANCE_DRAW_AWAY_REGULATION", "DOUBLE_CHANCE_HOME_AWAY_REGULATION",
  "TOTAL_GOALS_OVER_1_5_REGULATION", "TOTAL_GOALS_OVER_2_5_REGULATION", "TOTAL_GOALS_UNDER_2_5_REGULATION",
  "TOTAL_GOALS_OVER_3_5_REGULATION", "TOTAL_GOALS_UNDER_3_5_REGULATION", "BTTS_YES_REGULATION", "BTTS_NO_REGULATION",
  "HOME_GOALS_OVER_1_5_REGULATION", "AWAY_GOALS_OVER_1_5_REGULATION", "FIRST_HALF_GOALS_OVER_0_5", "FIRST_HALF_GOALS_OVER_1_5",
];
const GROUPS: Record<string, string[]> = {
  popular: POPULAR,
  match_result: ["MATCH_RESULT_HOME_REGULATION", "MATCH_RESULT_DRAW_REGULATION", "MATCH_RESULT_AWAY_REGULATION"],
  home_win: ["MATCH_RESULT_HOME_REGULATION"], away_win: ["MATCH_RESULT_AWAY_REGULATION"], draw: ["MATCH_RESULT_DRAW_REGULATION"],
  double_chance: ["DOUBLE_CHANCE_HOME_DRAW_REGULATION", "DOUBLE_CHANCE_DRAW_AWAY_REGULATION", "DOUBLE_CHANCE_HOME_AWAY_REGULATION"],
  over_1_5: ["TOTAL_GOALS_OVER_1_5_REGULATION"], over_2_5: ["TOTAL_GOALS_OVER_2_5_REGULATION"], under_2_5: ["TOTAL_GOALS_UNDER_2_5_REGULATION"],
  over_3_5: ["TOTAL_GOALS_OVER_3_5_REGULATION"], under_3_5: ["TOTAL_GOALS_UNDER_3_5_REGULATION"],
  btts_yes: ["BTTS_YES_REGULATION"], btts_no: ["BTTS_NO_REGULATION"],
  first_half_goal: ["FIRST_HALF_GOALS_OVER_0_5"], team_goals: ["HOME_GOALS_OVER_1_5_REGULATION", "AWAY_GOALS_OVER_1_5_REGULATION"],
  all: [],
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "find_markets",
      description: "Search upcoming matches for markets whose model probability is inside a range. Returns match, kickoff (UTC), market, period, probability and fair decimal odds (1/probability), highest probability first.",
      parameters: {
        type: "object",
        properties: {
          min_probability: { type: "number", description: "0-1, e.g. 0.8 for 80%" },
          max_probability: { type: "number", description: "0-1, default 1" },
          market_group: { type: "string", enum: Object.keys(GROUPS), description: "Which markets to search; 'popular' (default) excludes near-certain lines like over 0.5 goals" },
          competition: { type: "string", description: "Optional competition name filter, e.g. 'Premier League', 'La Liga', 'Champions League'" },
          team: { type: "string", description: "Optional team name filter" },
          days_ahead: { type: "integer", description: "Look ahead this many days from now (default 7, max 10)" },
          one_per_match: { type: "boolean", description: "Keep only the highest qualifying market per match (default true)" },
          limit: { type: "integer", description: "Max rows (default 10, max 25)" },
        },
        required: ["min_probability"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_matches",
      description: "List upcoming matches with home/draw/away, over 2.5 and both-teams-to-score probabilities.",
      parameters: {
        type: "object",
        properties: {
          competition: { type: "string" }, team: { type: "string" },
          days_ahead: { type: "integer", description: "default 3, max 10" }, limit: { type: "integer", description: "default 15, max 30" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "match_report",
      description: "Summary of one upcoming match found by team name(s): key market probabilities, expected goals, each team's last 5 results before the forecast's data cut-off, and the league's base rates.",
      parameters: { type: "object", properties: { team: { type: "string" }, opponent: { type: "string" } }, required: ["team"] },
    },
  },
  {
    type: "function",
    function: { name: "model_performance", description: "The model's retrospective backtest accuracy versus league base rates (log loss; lower is better).", parameters: { type: "object", properties: {} } },
  },
];

const SYSTEM = `You are "Ask BetTipsPro AI", the research assistant on BetTipsPro, a football match-analysis site.
Answer ONLY with figures returned by your tools in this conversation turn. Never invent matches, probabilities, odds, records, injuries, line-ups or news; if a tool returns nothing, say so plainly. Copy numbers exactly as the tools give them.
Probabilities are the site's model estimates; each tool row says its period ("full time (90 minutes)" or "first half"). Fair odds are 1/probability, not bookmaker prices.
Kickoff times from tools are UTC; present them in East Africa Time (UTC+3), e.g. "Tue 22:00".
Format: one short intro line, then a numbered list, one line per item: **Home vs Away** - market - probability (fair odds) - kickoff, with a link [Open match](/matches/<fixture_id>) using only fixture_id values from the tools. No tables. Keep answers under 200 words.
Be direct and useful. No disclaimers or lectures. Never use the words "guaranteed", "sure", "lock", "banker" or "risk-free".
For "bets above X%" requests use find_markets with market_group "popular" and one_per_match true unless the user asks otherwise.
If asked about anything outside this site's football data, say briefly that you can only help with the site's match data.`;

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: unknown[]; tool_call_id?: string; reasoning_content?: string };
type ToolCall = { id: string; function: { name: string; arguments: string } };

const num = (v: string | undefined, d: number) => (v != null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
const price = (env: Env) => ({ inPerM: num(env.ASSISTANT_PRICE_IN_PER_M, 0.3), outPerM: num(env.ASSISTANT_PRICE_OUT_PER_M, 1.2) });

export async function assistantEnabled(env: Env): Promise<boolean> {
  return env.ASSISTANT_ENABLED === "true" && !!env.DEEPSEEK_API_KEY && (await openAccess(env));
}

/** F-02: one conditional INSERT reserves the slot only if both the visitor's hourly and the site's daily limits allow it. */
export async function rateLimit(env: Env, visitor: string) {
  const now = nowIso();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const dayStart = `${now.slice(0, 10)}T00:00:00Z`;
  const daily = num(env.ASSISTANT_DAILY_LIMIT, 1500);
  const res = await env.DB.prepare(
    `INSERT INTO auth_attempts (bucket, created_at)
       SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM auth_attempts WHERE bucket = ?1 AND created_at > ?3) < ?4
                       AND (SELECT COUNT(*) FROM auth_attempts WHERE bucket LIKE 'assistant:%' AND created_at >= ?5) < ?6`,
  ).bind(`assistant:${visitor}`, now, since, HOURLY_PER_VISITOR, dayStart, daily).run();
  if ((res.meta.changes ?? 0) === 1) return;
  const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE bucket = ? AND created_at > ?").bind(`assistant:${visitor}`, since).first<{ n: number }>();
  if ((mine?.n ?? 0) >= HOURLY_PER_VISITOR) throw new ApiError(429, "RATE_LIMITED", "You have asked a lot of questions in the last hour. Please try again a little later.");
  throw new ApiError(429, "RATE_LIMITED", "The assistant has reached today's limit. It resets at midnight UTC.");
}

/** F-03: reserve the worst-case cost of one provider call; refuse if it would exceed the daily or monthly budget. */
async function reserveSpend(env: Env, inputChars: number): Promise<number> {
  const p = price(env);
  const worst = ((inputChars / 2.5 + 400) / 1e6) * p.inPerM + (MAX_OUTPUT_TOKENS / 1e6) * p.outPerM;
  const now = nowIso();
  const res = await env.DB.prepare(
    `INSERT INTO assistant_spend (created_at, reserved_usd) SELECT ?1, ?2
      WHERE (SELECT COALESCE(SUM(COALESCE(actual_usd, reserved_usd)), 0) FROM assistant_spend WHERE created_at >= ?3) + ?2 <= ?4
        AND (SELECT COALESCE(SUM(COALESCE(actual_usd, reserved_usd)), 0) FROM assistant_spend WHERE created_at >= ?5) + ?2 <= ?6`,
  ).bind(now, worst, `${now.slice(0, 10)}T00:00:00Z`, num(env.ASSISTANT_DAILY_BUDGET_USD, 3), `${now.slice(0, 7)}-01T00:00:00Z`, num(env.ASSISTANT_MONTHLY_BUDGET_USD, 30)).run();
  if ((res.meta.changes ?? 0) !== 1) throw new ApiError(429, "BUDGET_EXHAUSTED", "The assistant has reached its spending limit for now. Please try again later.");
  return res.meta.last_row_id as number;
}

async function settleSpend(env: Env, id: number, usage: { prompt_tokens?: number; completion_tokens?: number } | undefined, ok: boolean) {
  const p = price(env);
  if (!ok || !usage) {
    // Unknown outcome: keep the full reservation counted (conservative).
    await env.DB.prepare("UPDATE assistant_spend SET status = 'failed' WHERE id = ?").bind(id).run();
    return;
  }
  const actual = ((usage.prompt_tokens ?? 0) / 1e6) * p.inPerM + ((usage.completion_tokens ?? 0) / 1e6) * p.outPerM;
  await env.DB.prepare("UPDATE assistant_spend SET status = 'settled', actual_usd = ?, input_tokens = ?, output_tokens = ? WHERE id = ?")
    .bind(actual, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, id).run();
}

// ------------------------------------------------------------------ tools (read-only)

const clampInt = (v: unknown, d: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Math.round(Number(v)) : d));
const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => "\\" + m).slice(0, 60)}%`;
const period = (m: string) => (m.startsWith("FIRST_HALF") ? "first half" : "full time (90 minutes)");
const pct1 = (p: number) => Math.round(p * 1000) / 10;
const odds2 = (p: number) => Math.round((1 / p) * 100) / 100;

async function scope(env: Env, days: number) {
  const realOnly = await realDataReady(env);
  const now = nowIso();
  const until = new Date(Date.now() + days * 86400_000).toISOString();
  const latest = `SELECT r.fixture_id, r.report_version FROM match_reports r JOIN fixtures f ON f.id = r.fixture_id
                   WHERE f.status IN ('NS','TBD') AND f.starts_at_utc > ?1 AND f.starts_at_utc < ?2${realOnly ? " AND f.is_synthetic = 0" : ""}
                     AND r.generated_at = (SELECT MAX(generated_at) FROM match_reports WHERE fixture_id = r.fixture_id)`;
  // F-04: only publishable forecasts; demo rows only exist (and are labelled) while no real data is loaded.
  const statuses = realOnly ? "('VERIFIED','PARTIAL')" : "('VERIFIED','PARTIAL','SIMULATED_DEMO')";
  return { latest, binds: [now, until] as unknown[], statuses, synthetic: !realOnly };
}

async function findMarkets(env: Env, a: Record<string, unknown>) {
  const min = Math.max(0, Math.min(1, Number(a.min_probability ?? 0.8)));
  const max = Math.max(min, Math.min(1, Number(a.max_probability ?? 1)));
  const group = GROUPS[String(a.market_group ?? "popular")] ?? POPULAR;
  const days = clampInt(a.days_ahead, 7, 1, 10);
  const limit = clampInt(a.limit, 10, 1, 25);
  const onePer = a.one_per_match !== false;
  const sc = await scope(env, days);
  const where = ["fo.probability >= ?3", "fo.probability <= ?4", `fo.status IN ${sc.statuses}`];
  const b: unknown[] = [...sc.binds, min, max];
  if (group.length) { where.push(`fo.market_definition_id IN (${group.map((_, i) => `?${b.length + i + 1}`).join(",")})`); b.push(...group); }
  if (a.competition) { where.push(`c.name LIKE ?${b.length + 1} ESCAPE '\\'`); b.push(like(String(a.competition))); }
  if (a.team) { where.push(`(h.name LIKE ?${b.length + 1} ESCAPE '\\' OR aw.name LIKE ?${b.length + 1} ESCAPE '\\')`); b.push(like(String(a.team))); }
  const rows = await env.DB.prepare(
    `SELECT fo.fixture_id, fo.market_definition_id AS m, fo.probability AS p, fo.data_as_of_at AS asof, fo.model_version AS mv, f.starts_at_utc AS ko, c.name AS comp, h.name AS home, aw.name AS away
       FROM forecasts fo JOIN (${sc.latest}) l ON l.fixture_id = fo.fixture_id AND l.report_version = fo.model_run_id
       JOIN fixtures f ON f.id = fo.fixture_id JOIN competitions c ON c.id = f.competition_id
       JOIN teams h ON h.id = f.home_team_id JOIN teams aw ON aw.id = f.away_team_id
      WHERE ${where.join(" AND ")} ORDER BY fo.probability DESC LIMIT 300`,
  ).bind(...b).all<{ fixture_id: string; m: string; p: number; asof: string; mv: string; ko: string; comp: string; home: string; away: string }>();
  const seen = new Set<string>();
  const out = [];
  for (const r of rows.results) {
    if (onePer && seen.has(r.fixture_id)) continue;
    seen.add(r.fixture_id);
    out.push({ fixture_id: r.fixture_id, match: `${r.home} vs ${r.away}`, competition: r.comp, kickoff_utc: r.ko, market: marketById.get(r.m)?.label ?? r.m, period: period(r.m), probability_pct: pct1(r.p), fair_odds: odds2(r.p), data_as_of: r.asof, model_version: r.mv });
    if (out.length >= limit) break;
  }
  return { count: out.length, synthetic_demo_data: sc.synthetic, filters: { min_probability: min, max_probability: max, market_group: a.market_group ?? "popular", days_ahead: days }, results: out };
}

async function listMatches(env: Env, a: Record<string, unknown>) {
  const days = clampInt(a.days_ahead, 3, 1, 10);
  const limit = clampInt(a.limit, 15, 1, 30);
  const sc = await scope(env, days);
  const where: string[] = [];
  const b: unknown[] = [...sc.binds];
  if (a.competition) { where.push(`c.name LIKE ?${b.length + 1} ESCAPE '\\'`); b.push(like(String(a.competition))); }
  if (a.team) { where.push(`(h.name LIKE ?${b.length + 1} ESCAPE '\\' OR aw.name LIKE ?${b.length + 1} ESCAPE '\\')`); b.push(like(String(a.team))); }
  const ids = ["MATCH_RESULT_HOME_REGULATION", "MATCH_RESULT_DRAW_REGULATION", "MATCH_RESULT_AWAY_REGULATION", "TOTAL_GOALS_OVER_2_5_REGULATION", "BTTS_YES_REGULATION"];
  const rows = await env.DB.prepare(
    `SELECT f.id AS fixture_id, f.starts_at_utc AS ko, c.name AS comp, h.name AS home, aw.name AS away, fo.market_definition_id AS m, fo.probability AS p
       FROM (${sc.latest}) l JOIN fixtures f ON f.id = l.fixture_id JOIN competitions c ON c.id = f.competition_id
       JOIN teams h ON h.id = f.home_team_id JOIN teams aw ON aw.id = f.away_team_id
       LEFT JOIN forecasts fo ON fo.fixture_id = l.fixture_id AND fo.model_run_id = l.report_version AND fo.status IN ${sc.statuses}
            AND fo.market_definition_id IN ('${ids.join("','")}')
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY f.starts_at_utc, f.id`,
  ).bind(...b).all<{ fixture_id: string; ko: string; comp: string; home: string; away: string; m: string | null; p: number | null }>();
  const by = new Map<string, Record<string, unknown>>();
  const key: Record<string, string> = { MATCH_RESULT_HOME_REGULATION: "home_win_pct", MATCH_RESULT_DRAW_REGULATION: "draw_pct", MATCH_RESULT_AWAY_REGULATION: "away_win_pct", TOTAL_GOALS_OVER_2_5_REGULATION: "over_2_5_pct", BTTS_YES_REGULATION: "btts_yes_pct" };
  for (const r of rows.results) {
    if (!by.has(r.fixture_id)) by.set(r.fixture_id, { fixture_id: r.fixture_id, match: `${r.home} vs ${r.away}`, competition: r.comp, kickoff_utc: r.ko, period: "full time (90 minutes)" });
    if (r.m && r.p != null) by.get(r.fixture_id)![key[r.m]] = pct1(r.p);
  }
  const out = [...by.values()].slice(0, limit).map((m) => (m.home_win_pct == null ? { ...m, limited_report: "too few recent matches for a full forecast; no probabilities published" } : m));
  return { count: out.length, synthetic_demo_data: sc.synthetic, results: out };
}

async function matchReport(env: Env, a: Record<string, unknown>) {
  const sc = await scope(env, 10);
  const b: unknown[] = [...sc.binds, like(String(a.team ?? ""))];
  let where = "(h.name LIKE ?3 ESCAPE '\\' OR aw.name LIKE ?3 ESCAPE '\\')";
  if (a.opponent) { where += " AND (h.name LIKE ?4 ESCAPE '\\' OR aw.name LIKE ?4 ESCAPE '\\')"; b.push(like(String(a.opponent))); }
  const fx = await env.DB.prepare(
    `SELECT f.id, f.starts_at_utc AS ko, c.name AS comp, f.home_team_id AS hid, f.away_team_id AS aid, h.name AS home, aw.name AS away, l.report_version AS v,
            (SELECT data_as_of_at FROM model_runs WHERE id = l.report_version) AS asof
       FROM (${sc.latest}) l JOIN fixtures f ON f.id = l.fixture_id JOIN competitions c ON c.id = f.competition_id
       JOIN teams h ON h.id = f.home_team_id JOIN teams aw ON aw.id = f.away_team_id WHERE ${where} ORDER BY f.starts_at_utc LIMIT 1`,
  ).bind(...b).first<{ id: string; ko: string; comp: string; hid: string; aid: string; home: string; away: string; v: string; asof: string | null }>();
  if (!fx) return { found: false, note: "No upcoming match with a report matches that team name in the next 10 days." };
  const cutoff = fx.asof && fx.asof < fx.ko ? fx.asof : fx.ko;
  const form = (team: string) => env.DB.prepare(
    `SELECT CASE WHEN f.home_team_id = ?1 THEN f.home_goals ELSE f.away_goals END AS gf, CASE WHEN f.home_team_id = ?1 THEN f.away_goals ELSE f.home_goals END AS ga
       FROM fixtures f WHERE (f.home_team_id = ?1 OR f.away_team_id = ?1) AND f.status IN ('FT','AET','PEN') AND f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
        AND f.starts_at_utc <= ?2 ORDER BY f.starts_at_utc DESC LIMIT 5`,
  ).bind(team, cutoff);
  const [fc, dr, rep, fh, fa] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(`SELECT market_definition_id AS m, probability AS p, status, quality_reason AS reason FROM forecasts WHERE fixture_id = ? AND model_run_id = ?`).bind(fx.id, fx.v),
    env.DB.prepare("SELECT metric, value FROM forecast_evidence WHERE fixture_id = ? AND model_run_id = ? AND metric IN ('expected_goals_home','expected_goals_away')").bind(fx.id, fx.v),
    env.DB.prepare("SELECT summary_json FROM match_reports WHERE fixture_id = ? AND report_version = ?").bind(fx.id, fx.v),
    form(fx.hid), form(fx.aid),
  ]);
  const ok = new Set(sc.synthetic ? ["VERIFIED", "PARTIAL", "SIMULATED_DEMO"] : ["VERIFIED", "PARTIAL"]);
  const home = fc.results.find((r) => r.m === "MATCH_RESULT_HOME_REGULATION");
  const limited = !home || home.p == null || !ok.has(home.status as string);
  const probs: Record<string, number> = {};
  if (!limited) for (const r of fc.results) {
    if (r.p != null && ok.has(r.status as string) && POPULAR.includes(r.m as string)) probs[`${marketById.get(r.m as string)?.label ?? r.m} (${period(r.m as string)})`] = pct1(r.p as number);
  }
  const summary = JSON.parse((rep.results[0]?.summary_json as string) ?? "{}");
  const base: Record<string, number> = {};
  for (const [k, v] of Object.entries((summary.baselines ?? {}) as Record<string, number>)) if (POPULAR.includes(k)) base[marketById.get(k)?.label ?? k] = pct1(v);
  const res = (rows: Record<string, unknown>[]) => rows.map((r) => ((r.gf as number) > (r.ga as number) ? "W" : r.gf === r.ga ? "D" : "L") + ` ${r.gf}-${r.ga}`);
  return {
    found: true, fixture_id: fx.id, match: `${fx.home} vs ${fx.away}`, competition: fx.comp, kickoff_utc: fx.ko, data_as_of: cutoff, synthetic_demo_data: sc.synthetic,
    limited_report: limited ? (home?.reason ?? "too few recent matches for a full forecast") : null,
    probabilities_pct: probs,
    expected_goals: limited ? {} : Object.fromEntries(dr.results.map((r) => [r.metric as string, Math.round((r.value as number) * 100) / 100])),
    league_base_rates_pct: base,
    form_last5_before_cutoff: { [fx.home]: res(fh.results), [fx.away]: res(fa.results) },
  };
}

async function modelPerformance(env: Env) {
  const run = await env.DB.prepare("SELECT id, model_version, data_mode FROM model_runs WHERE json_extract(config_json, '$.kind') = 'backtest' ORDER BY generated_at DESC LIMIT 1").first<{ id: string; model_version: string; data_mode: string }>();
  if (!run) return { available: false };
  const ev = await env.DB.prepare("SELECT market_family, sample_n, log_loss, baseline_log_loss FROM model_evaluations WHERE model_run_id = ? AND competition_id IS NULL").bind(run.id).all();
  return { model_version: run.model_version, data_mode: run.data_mode, method: "retrospective rolling-origin backtest on recent completed rounds", families: ev.results };
}

export async function runTool(env: Env, name: string, args: Record<string, unknown>) {
  try {
    if (name === "find_markets") return await findMarkets(env, args);
    if (name === "list_matches") return await listMatches(env, args);
    if (name === "match_report") return await matchReport(env, args);
    if (name === "model_performance") return await modelPerformance(env);
    return { error: `unknown tool ${name}` };
  } catch (e) {
    return { error: "tool failed", detail: (e as Error).message.slice(0, 200) };
  }
}

// ------------------------------------------------------------------ answer verification (F-01, F-05)

const BANNED = [/guarantee/i, /\bsure (win|bet|thing|shot)\b/i, /\block\b/i, /\bbanker\b/i, /risk[- ]free/i, /can'?t lose/i, /free money/i];
const eat = (iso: string) => new Date(Date.parse(iso) + 3 * 3600_000);

/** Numbers and fixture ids the answer may use: everything in this turn's tool results, EAT clock values for their kickoffs, and the question. */
export function allowedFacts(results: unknown[], question: string) {
  const nums = new Set<string>(["0", "3", "90"]);
  const fixtures = new Set<string>();
  const add = (n: number) => { if (!Number.isFinite(n)) return; for (const d of [0, 1, 2]) nums.add(n.toFixed(d)); nums.add(String(n)); };
  const walk = (v: unknown, k?: string) => {
    if (typeof v === "number") add(v);
    else if (typeof v === "string") {
      if (k === "fixture_id") fixtures.add(v);
      if (/^\d{4}-\d{2}-\d{2}T/.test(v)) { const d = eat(v); add(d.getUTCHours()); add(d.getUTCMinutes()); add(d.getUTCDate()); add(d.getUTCMonth() + 1); add(d.getUTCFullYear()); }
      for (const m of v.matchAll(/\d+(?:\.\d+)?/g)) add(Number(m[0]));
    } else if (Array.isArray(v)) { v.forEach((x) => walk(x)); add(v.length); }
    else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
  };
  results.forEach((r) => walk(r));
  for (const m of question.matchAll(/\d+(?:\.\d+)?/g)) add(Number(m[0]));
  const maxRows = Math.max(0, ...results.map((r) => ((r as { results?: unknown[] })?.results?.length ?? 0)));
  for (let i = 1; i <= Math.max(maxRows, 1); i++) add(i); // list numbering
  return { nums, fixtures };
}

export function verifyAnswer(text: string, facts: { nums: Set<string>; fixtures: Set<string> }): string[] {
  const problems: string[] = [];
  for (const re of BANNED) if (re.test(text)) problems.push(`banned wording ${re}`);
  for (const m of text.matchAll(/\]\(([^)\s]*)\)/g)) {
    const mm = m[1].match(/^\/matches\/([A-Za-z0-9:._-]+)$/);
    if (!mm || !facts.fixtures.has(decodeURIComponent(mm[1]))) problems.push(`unverified link ${m[1].slice(0, 60)}`);
  }
  const stripped = text.replace(/\]\([^)]*\)/g, "]");
  for (const m of stripped.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(m[0]);
    if (![m[0], n.toFixed(0), n.toFixed(1), n.toFixed(2)].some((v) => facts.nums.has(v))) problems.push(`unverified number ${m[0]}`);
  }
  return problems;
}

/** Deterministic answer built only from tool results (used when the model's text fails verification). */
export function renderFromTools(calls: Array<{ name: string; result: Record<string, unknown> }>): string {
  const when = (iso: string) => eat(iso).toLocaleString("en-GB", { timeZone: "UTC", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "");
  const lines: string[] = [];
  for (const { name, result } of calls) {
    const rows = (result.results as Array<Record<string, unknown>> | undefined) ?? [];
    if (name === "find_markets") {
      if (!rows.length) { lines.push("No upcoming markets match that request in the site's data."); continue; }
      lines.push("Here is what the site's data shows:");
      rows.forEach((r, i) => lines.push(`${i + 1}. **${r.match}** - ${r.market}${r.period === "first half" ? " (first half)" : ""} - ${r.probability_pct}% (fair odds ${r.fair_odds}) - ${when(r.kickoff_utc as string)} EAT [Open match](/matches/${r.fixture_id})`));
    } else if (name === "list_matches") {
      if (!rows.length) { lines.push("No upcoming matches with reports match that request."); continue; }
      lines.push("Upcoming matches in the site's data:");
      rows.forEach((r, i) => lines.push(r.home_win_pct == null
        ? `${i + 1}. **${r.match}** - limited report (too few recent matches) - ${when(r.kickoff_utc as string)} EAT [Open match](/matches/${r.fixture_id})`
        : `${i + 1}. **${r.match}** - home ${r.home_win_pct}%, draw ${r.draw_pct}%, away ${r.away_win_pct}% - ${when(r.kickoff_utc as string)} EAT [Open match](/matches/${r.fixture_id})`));
    } else if (name === "match_report") {
      if (!result.found) { lines.push(String(result.note ?? "No matching upcoming match.")); continue; }
      lines.push(`**${result.match}** (${result.competition}) - ${when(result.kickoff_utc as string)} EAT [Open match](/matches/${result.fixture_id})`);
      if (result.limited_report) lines.push("Limited report: too few recent matches for a full forecast, so no probabilities are published.");
      Object.entries((result.probabilities_pct ?? {}) as Record<string, number>).slice(0, 8).forEach(([k, v], i) => lines.push(`${i + 1}. ${k}: ${v}%`));
    } else if (name === "model_performance") {
      lines.push("Backtest log loss (lower is better), model vs league base rate:");
      ((result.families ?? []) as Array<Record<string, unknown>>).forEach((f, i) => lines.push(`${i + 1}. ${f.market_family}: ${Number(f.log_loss).toFixed(3)} vs ${Number(f.baseline_log_loss).toFixed(3)} (${f.sample_n} matches)`));
    }
  }
  return lines.join("\n") || "I can only answer from the site's match data. Try asking about upcoming matches, probabilities or a team.";
}

// ------------------------------------------------------------------ chat loop

export async function chat(env: Env, history: Array<{ role: "user" | "assistant"; content: string }>, fetchImpl: typeof fetch = fetch) {
  const started = Date.now();
  const question = history[history.length - 1].content.slice(0, 2000);
  const trimmed = history.slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  const messages: Msg[] = [{ role: "system", content: `${SYSTEM}\nCurrent time (UTC): ${nowIso()}.` }, ...trimmed];
  const calls: Array<{ name: string; result: Record<string, unknown> }> = [];
  let text = "";
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const remaining = DEADLINE_MS - (Date.now() - started);
    if (remaining < 3000) break;
    const body = JSON.stringify({ model: MODEL, messages, tools: round < MAX_ROUNDS ? TOOLS : undefined, temperature: 0.2, max_tokens: MAX_OUTPUT_TOKENS, reasoning_effort: "low" });
    const reservation = await reserveSpend(env, body.length);
    let j: { choices?: Array<{ message?: Msg & { tool_calls?: ToolCall[] } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null = null;
    try {
      const res = await fetchImpl("https://api.deepseek.com/chat/completions", {
        method: "POST", headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "content-type": "application/json" }, body,
        signal: AbortSignal.timeout(Math.min(30_000, remaining)),
      });
      j = res.ok ? await res.json() : null;
    } catch {
      j = null;
    }
    await settleSpend(env, reservation, j?.usage, !!j);
    const msg = j?.choices?.[0]?.message;
    if (!msg) {
      if (calls.length) break; // we already have data: answer from it
      throw new ApiError(502, "UPSTREAM_ERROR", "The assistant is unavailable right now. Please try again shortly.");
    }
    if (!msg.tool_calls?.length) { text = (msg.content ?? "").trim(); break; }
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls, ...(msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}) });
    for (const call of (msg.tool_calls as ToolCall[]).slice(0, 3)) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* empty args */ }
      const result = (await runTool(env, call.function.name, args)) as Record<string, unknown>;
      calls.push({ name: call.function.name, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12000) });
    }
  }
  const facts = allowedFacts(calls.map((c) => c.result), question);
  const problems = text ? verifyAnswer(text, facts) : ["empty answer"];
  let answer = problems.length === 0 ? text : renderFromTools(calls);
  if (answer.length > MAX_ANSWER_CHARS) answer = answer.slice(0, MAX_ANSWER_CHARS).replace(/\n[^\n]*$/, "") + "\n…";
  return { answer, tools_used: calls.map((c) => c.name), verified: problems.length === 0 ? "model" : "rendered_from_data" };
}
