/**
 * "Ask BetTipsPro AI": a chat assistant on DeepSeek (OpenAI-compatible API, function calling).
 * The model never sees free text from the database it could misquote: it calls read-only tools that return
 * the site's own forecasts, and must answer only from those results. No conversation content is stored.
 */
import type { Env } from "../env.ts";
import { ApiError } from "../lib/http.ts";
import { nowIso } from "../lib/time.ts";
import { marketById } from "../../shared/markets.ts";
import { openAccess } from "./access.ts";
import { realDataReady } from "./fixtures.ts";

const MODEL = "deepseek-flash";
const MAX_ROUNDS = 4;
const HOURLY_PER_VISITOR = 30;

// Markets people actually ask about; near-certain lines (Over 0.5, Under 4.5...) are excluded unless asked for.
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
      description: "Search upcoming matches for markets whose model probability is inside a range. Returns match, kickoff (UTC), market, probability and fair decimal odds (1/probability), highest probability first.",
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
      description: "List upcoming matches with home/draw/away probabilities, over 2.5 and both-teams-to-score probabilities.",
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
      description: "Full summary of one upcoming match found by team name(s): key market probabilities, expected goals, each team's last 5 results, and the league's base rates.",
      parameters: { type: "object", properties: { team: { type: "string" }, opponent: { type: "string" } }, required: ["team"] },
    },
  },
  {
    type: "function",
    function: { name: "model_performance", description: "The model's backtest accuracy versus league base rates (log loss; lower is better).", parameters: { type: "object", properties: {} } },
  },
];

const SYSTEM = `You are "Ask BetTipsPro AI", the research assistant on BetTipsPro, a football match-analysis site.
Answer ONLY with figures returned by your tools. Never invent matches, probabilities, odds, injuries, line-ups or news; if a tool returns nothing, say so plainly.
Percentages are the site's model probabilities for 90-minute outcomes. When useful, also show fair odds (1/probability). They are not bookmaker prices.
Kickoff times from tools are UTC; present them in East Africa Time (UTC+3), e.g. "Tue 22:00".
Format: short intro line, then a numbered list, one line per item: **Home vs Away** - market - probability (fair odds) - kickoff, and link each match as [Home vs Away](/matches/<fixture_id>). No tables. Keep answers under 220 words unless asked for more.
Be direct and useful. Do not add disclaimers or betting-responsibility lectures. Never use the words "guaranteed", "sure", "lock" or "banker".
For "bets above X%" requests use find_markets with market_group "popular" and one_per_match true unless the user asks otherwise.
If asked about something outside football research on this site, say briefly that you can only help with the site's match data.`;

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: unknown[]; tool_call_id?: string; reasoning_content?: string };

export async function assistantEnabled(env: Env): Promise<boolean> {
  return env.ASSISTANT_ENABLED === "true" && !!env.DEEPSEEK_API_KEY && (await openAccess(env));
}

export async function rateLimit(env: Env, visitor: string) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const day = nowIso().slice(0, 10);
  const [mine, today] = await env.DB.batch<{ n: number }>([
    env.DB.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE bucket = ? AND created_at > ?").bind(`assistant:${visitor}`, since),
    env.DB.prepare("SELECT COUNT(*) AS n FROM auth_attempts WHERE bucket LIKE 'assistant:%' AND created_at >= ?").bind(`${day}T00:00:00Z`),
  ]);
  const daily = Number(env.ASSISTANT_DAILY_LIMIT ?? "1500");
  if ((mine.results[0]?.n ?? 0) >= HOURLY_PER_VISITOR) throw new ApiError(429, "RATE_LIMITED", "You have asked a lot of questions in the last hour. Please try again a little later.");
  if ((today.results[0]?.n ?? 0) >= daily) throw new ApiError(429, "RATE_LIMITED", "The assistant has reached today's limit. It resets at midnight UTC.");
  await env.DB.prepare("INSERT INTO auth_attempts (bucket, created_at) VALUES (?, ?)").bind(`assistant:${visitor}`, nowIso()).run();
}

// ------------------------------------------------------------------ tools (read-only)

const clampInt = (v: unknown, d: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Math.round(Number(v)) : d));
const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => "\\" + m).slice(0, 60)}%`;

async function latestCte(env: Env, days: number) {
  const realOnly = await realDataReady(env);
  const now = nowIso();
  const until = new Date(Date.now() + days * 86400_000).toISOString();
  const sql = `SELECT r.fixture_id, r.report_version FROM match_reports r JOIN fixtures f ON f.id = r.fixture_id
                WHERE f.status IN ('NS','TBD') AND f.starts_at_utc > ?1 AND f.starts_at_utc < ?2${realOnly ? " AND f.is_synthetic = 0" : ""}
                  AND r.generated_at = (SELECT MAX(generated_at) FROM match_reports WHERE fixture_id = r.fixture_id)`;
  return { sql, binds: [now, until] as unknown[] };
}

async function findMarkets(env: Env, a: Record<string, unknown>) {
  const min = Math.max(0, Math.min(1, Number(a.min_probability ?? 0.8)));
  const max = Math.max(min, Math.min(1, Number(a.max_probability ?? 1)));
  const group = GROUPS[String(a.market_group ?? "popular")] ?? POPULAR;
  const days = clampInt(a.days_ahead, 7, 1, 10);
  const limit = clampInt(a.limit, 10, 1, 25);
  const onePer = a.one_per_match !== false;
  const { sql, binds } = await latestCte(env, days);
  const where = ["fo.probability >= ?3", "fo.probability <= ?4"];
  const b: unknown[] = [...binds, min, max];
  if (group.length) where.push(`fo.market_definition_id IN (${group.map((_, i) => `?${b.length + i + 1}`).join(",")})`), b.push(...group);
  if (a.competition) { where.push(`c.name LIKE ?${b.length + 1} ESCAPE '\\'`); b.push(like(String(a.competition))); }
  if (a.team) { where.push(`(h.name LIKE ?${b.length + 1} ESCAPE '\\' OR a.name LIKE ?${b.length + 1} ESCAPE '\\')`); b.push(like(String(a.team))); }
  const rows = await env.DB.prepare(
    `SELECT fo.fixture_id, fo.market_definition_id AS m, fo.probability AS p, f.starts_at_utc AS ko, c.name AS comp, h.name AS home, a.name AS away
       FROM forecasts fo JOIN (${sql}) l ON l.fixture_id = fo.fixture_id AND l.report_version = fo.model_run_id
       JOIN fixtures f ON f.id = fo.fixture_id JOIN competitions c ON c.id = f.competition_id
       JOIN teams h ON h.id = f.home_team_id JOIN teams a ON a.id = f.away_team_id
      WHERE ${where.join(" AND ")} ORDER BY fo.probability DESC LIMIT 300`,
  ).bind(...b).all<{ fixture_id: string; m: string; p: number; ko: string; comp: string; home: string; away: string }>();
  const seen = new Set<string>();
  const out = [];
  for (const r of rows.results) {
    if (onePer && seen.has(r.fixture_id)) continue;
    seen.add(r.fixture_id);
    out.push({ fixture_id: r.fixture_id, match: `${r.home} vs ${r.away}`, competition: r.comp, kickoff_utc: r.ko, market: marketById.get(r.m)?.label ?? r.m, probability_pct: Math.round(r.p * 1000) / 10, fair_odds: Math.round((1 / r.p) * 100) / 100 });
    if (out.length >= limit) break;
  }
  return { count: out.length, filters: { min_probability: min, max_probability: max, market_group: a.market_group ?? "popular", days_ahead: days }, results: out };
}

async function listMatches(env: Env, a: Record<string, unknown>) {
  const days = clampInt(a.days_ahead, 3, 1, 10);
  const limit = clampInt(a.limit, 15, 1, 30);
  const { sql, binds } = await latestCte(env, days);
  const where: string[] = [];
  const b: unknown[] = [...binds];
  if (a.competition) { where.push(`c.name LIKE ?${b.length + 1} ESCAPE '\\'`); b.push(like(String(a.competition))); }
  if (a.team) { where.push(`(h.name LIKE ?${b.length + 1} ESCAPE '\\' OR a.name LIKE ?${b.length + 1} ESCAPE '\\')`); b.push(like(String(a.team))); }
  const ids = ["MATCH_RESULT_HOME_REGULATION", "MATCH_RESULT_DRAW_REGULATION", "MATCH_RESULT_AWAY_REGULATION", "TOTAL_GOALS_OVER_2_5_REGULATION", "BTTS_YES_REGULATION"];
  const rows = await env.DB.prepare(
    `SELECT f.id AS fixture_id, f.starts_at_utc AS ko, c.name AS comp, h.name AS home, a.name AS away, fo.market_definition_id AS m, fo.probability AS p
       FROM (${sql}) l JOIN fixtures f ON f.id = l.fixture_id JOIN competitions c ON c.id = f.competition_id
       JOIN teams h ON h.id = f.home_team_id JOIN teams a ON a.id = f.away_team_id
       LEFT JOIN forecasts fo ON fo.fixture_id = l.fixture_id AND fo.model_run_id = l.report_version AND fo.market_definition_id IN ('${ids.join("','")}')
      ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY f.starts_at_utc, f.id`,
  ).bind(...b).all<{ fixture_id: string; ko: string; comp: string; home: string; away: string; m: string | null; p: number | null }>();
  const by = new Map<string, Record<string, unknown>>();
  const key: Record<string, string> = { MATCH_RESULT_HOME_REGULATION: "home_win_pct", MATCH_RESULT_DRAW_REGULATION: "draw_pct", MATCH_RESULT_AWAY_REGULATION: "away_win_pct", TOTAL_GOALS_OVER_2_5_REGULATION: "over_2_5_pct", BTTS_YES_REGULATION: "btts_yes_pct" };
  for (const r of rows.results) {
    if (!by.has(r.fixture_id)) by.set(r.fixture_id, { fixture_id: r.fixture_id, match: `${r.home} vs ${r.away}`, competition: r.comp, kickoff_utc: r.ko });
    if (r.m && r.p != null) by.get(r.fixture_id)![key[r.m]] = Math.round(r.p * 1000) / 10;
  }
  const out = [...by.values()].slice(0, limit).map((m) => (m.home_win_pct == null ? { ...m, note: "limited report: too few recent matches for a full forecast" } : m));
  return { count: out.length, results: out };
}

async function matchReport(env: Env, a: Record<string, unknown>) {
  const { sql, binds } = await latestCte(env, 10);
  const b: unknown[] = [...binds, like(String(a.team ?? ""))];
  let where = "(h.name LIKE ?3 ESCAPE '\\' OR a.name LIKE ?3 ESCAPE '\\')";
  if (a.opponent) { where += " AND (h.name LIKE ?4 ESCAPE '\\' OR a.name LIKE ?4 ESCAPE '\\')"; b.push(like(String(a.opponent))); }
  const fx = await env.DB.prepare(
    `SELECT f.id, f.starts_at_utc AS ko, c.name AS comp, f.home_team_id AS hid, f.away_team_id AS aid, h.name AS home, a.name AS away, l.report_version AS v
       FROM (${sql}) l JOIN fixtures f ON f.id = l.fixture_id JOIN competitions c ON c.id = f.competition_id
       JOIN teams h ON h.id = f.home_team_id JOIN teams a ON a.id = f.away_team_id WHERE ${where} ORDER BY f.starts_at_utc LIMIT 1`,
  ).bind(...b).first<{ id: string; ko: string; comp: string; hid: string; aid: string; home: string; away: string; v: string }>();
  if (!fx) return { found: false, note: "No upcoming match with a report matches that team name in the next 10 days." };
  const form = (team: string) => env.DB.prepare(
    `SELECT CASE WHEN f.home_team_id = ?1 THEN f.home_goals ELSE f.away_goals END AS gf, CASE WHEN f.home_team_id = ?1 THEN f.away_goals ELSE f.home_goals END AS ga
       FROM fixtures f WHERE (f.home_team_id = ?1 OR f.away_team_id = ?1) AND f.status IN ('FT','AET','PEN') AND f.starts_at_utc < ?2 ORDER BY f.starts_at_utc DESC LIMIT 5`,
  ).bind(team, fx.ko);
  const [fc, dr, rep, fh, fa] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT market_definition_id AS m, probability AS p, quality_reason AS reason FROM forecasts WHERE fixture_id = ? AND model_run_id = ?").bind(fx.id, fx.v),
    env.DB.prepare("SELECT metric, value FROM forecast_evidence WHERE fixture_id = ? AND model_run_id = ? AND metric IN ('expected_goals_home','expected_goals_away')").bind(fx.id, fx.v),
    env.DB.prepare("SELECT summary_json FROM match_reports WHERE fixture_id = ? AND report_version = ?").bind(fx.id, fx.v),
    form(fx.hid), form(fx.aid),
  ]);
  const probs: Record<string, number> = {};
  let reason: string | null = null;
  for (const r of fc.results) {
    if (r.p != null && POPULAR.includes(r.m as string)) probs[marketById.get(r.m as string)?.label ?? (r.m as string)] = Math.round((r.p as number) * 1000) / 10;
    if (r.m === "MATCH_RESULT_HOME_REGULATION" && r.p == null) reason = r.reason as string;
  }
  const xg = Object.fromEntries(dr.results.map((r) => [r.metric as string, Math.round((r.value as number) * 100) / 100]));
  const summary = JSON.parse((rep.results[0]?.summary_json as string) ?? "{}");
  const base: Record<string, number> = {};
  for (const [k, v] of Object.entries((summary.baselines ?? {}) as Record<string, number>)) if (POPULAR.includes(k)) base[marketById.get(k)?.label ?? k] = Math.round(v * 1000) / 10;
  const res = (rows: Record<string, unknown>[]) => rows.map((r) => ((r.gf as number) > (r.ga as number) ? "W" : r.gf === r.ga ? "D" : "L") + ` ${r.gf}-${r.ga}`);
  return {
    found: true, fixture_id: fx.id, match: `${fx.home} vs ${fx.away}`, competition: fx.comp, kickoff_utc: fx.ko,
    limited_report: reason, probabilities_pct: probs, expected_goals: xg, league_base_rates_pct: base,
    form_last5: { [fx.home]: res(fh.results), [fx.away]: res(fa.results) },
  };
}

async function modelPerformance(env: Env) {
  const run = await env.DB.prepare("SELECT id, model_version FROM model_runs WHERE json_extract(config_json, '$.kind') = 'backtest' ORDER BY generated_at DESC LIMIT 1").first<{ id: string; model_version: string }>();
  if (!run) return { available: false };
  const ev = await env.DB.prepare("SELECT market_family, sample_n, log_loss, baseline_log_loss FROM model_evaluations WHERE model_run_id = ? AND competition_id IS NULL").bind(run.id).all();
  return { model_version: run.model_version, method: "rolling-origin backtest on recent completed rounds (retrospective)", families: ev.results };
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

// ------------------------------------------------------------------ chat loop

export async function chat(env: Env, history: Array<{ role: "user" | "assistant"; content: string }>) {
  const messages: Msg[] = [{ role: "system", content: `${SYSTEM}\nCurrent time (UTC): ${nowIso()}.` }, ...history.slice(-8)];
  const used: string[] = [];
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages, tools: round < MAX_ROUNDS ? TOOLS : undefined, temperature: 0.3, max_tokens: 900, reasoning_effort: "low" }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new ApiError(502, "UPSTREAM_ERROR", "The assistant is unavailable right now. Please try again shortly.");
    const j = (await res.json()) as { choices: Array<{ message: Msg & { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
    const msg = j.choices?.[0]?.message;
    if (!msg) throw new ApiError(502, "UPSTREAM_ERROR", "The assistant returned no answer. Please try again.");
    if (!msg.tool_calls?.length) return { answer: (msg.content ?? "").trim() || "I could not find an answer in the site's data.", tools_used: used };
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls, ...(msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}) });
    for (const call of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* empty args */ }
      used.push(call.function.name);
      const result = await runTool(env, call.function.name, args);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 12000) });
    }
  }
  return { answer: "I could not finish that request. Try asking a little more specifically.", tools_used: used };
}
