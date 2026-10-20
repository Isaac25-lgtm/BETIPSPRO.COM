// Generate evidence-grounded Gemini summaries OFFLINE and import them (owner decision 2026-10-20).
//
// - Auth: the owner's Google login via gcloud Application Default Credentials (NO API keys).
// - Billing: Vertex AI on project `paperaid` (trial credits); every request carries the label
//   app=bettipspro so its cost is reported separately; the script enforces a monthly cap.
// - Each summary is generated ONCE per fixture/market/report version/evidence hash and reused for
//   every viewer. Every number in the output is reconciled against the evidence; failures are stored
//   as rejected (cost still counted) and the site keeps its deterministic explanation.
//
// Usage: node scripts/ai-summaries.mjs --admin-email a@x --admin-password ... [--fixtures 20] [--cap 10]
//        [--markets MATCH_RESULT_HOME_REGULATION,TOTAL_GOALS_OVER_2_5_REGULATION,BTTS_YES_REGULATION]
//        [--project paperaid] [--location us-central1] [--model gemini-2.5-flash] [--dry-run]
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { allowedNumbers, validateSummary } from "../worker/services/ai/validate.ts";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(`--${k}`);
const BASE = arg("url", "http://127.0.0.1:5173");
const PROJECT = arg("project", "paperaid");
const LOCATION = arg("location", "us-central1");
const MODEL = arg("model", "gemini-2.5-flash");
// R-09: the owner authorised at most $10/month for summaries; a higher --cap is refused.
const AUTHORISED_MAX = 10;
const CAP = Number(arg("cap", "10"));
if (!Number.isFinite(CAP) || CAP <= 0 || CAP > AUTHORISED_MAX) throw new Error(`--cap must be between 0 and ${AUTHORISED_MAX} (owner-authorised monthly ceiling).`);
const MAX_FIXTURES = Number(arg("fixtures", "20"));
const MARKETS = arg("markets", "MATCH_RESULT_HOME_REGULATION,TOTAL_GOALS_OVER_2_5_REGULATION,BTTS_YES_REGULATION").split(",");
// Gemini 2.5 Flash paid-tier prices (USD per 1M tokens), ai.google.dev/gemini-api/docs/pricing (checked 2026-10-20).
const PRICE = { "gemini-2.5-flash": [0.3, 2.5], "gemini-2.5-flash-lite": [0.1, 0.4] }[MODEL];
if (!PRICE) throw new Error(`No verified price for ${MODEL}; add it before running so the cap can be enforced.`);
const MAX_OUT = 450;
const PROMPT_VERSION = "summaries-v3";
const H = { "content-type": "application/json", "x-requested-with": "fip" };

const gcloud = process.platform === "win32" ? '"C:\\Users\\USER\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"' : "gcloud";
const token = execSync(`${gcloud} auth application-default print-access-token`, { encoding: "utf8" }).trim();

const login = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: H, body: JSON.stringify({ email: arg("admin-email"), password: arg("admin-password") }) });
if (!login.ok) throw new Error("admin login failed");
const cookie = login.headers.get("set-cookie").split(";")[0];
const get = async (p) => {
  const r = await fetch(`${BASE}/api/v1${p}`, { headers: { cookie } });
  const j = await r.json();
  if (!j.ok) throw new Error(`${p}: ${j.error?.message}`);
  return j.data;
};

const status = await get("/admin/ai/status");
const done = new Set(status.existing.map((e) => `${e.fixture_id}|${e.market_definition_id}|${e.report_version}|${e.evidence_hash}`));
let spend = Number(status.month_spend_usd);
console.log(`Month-to-date Gemini spend for this app: $${spend.toFixed(4)} (cap $${CAP}). Existing summaries: ${status.existing.length}.`);

const now = new Date().toISOString();
const fixtures = (await get("/admin/fixtures")).items
  .filter((f) => !f.is_synthetic && f.reports > 0 && f.starts_at_utc > now)
  .sort((a, b) => a.starts_at_utc.localeCompare(b.starts_at_utc));

const SYSTEM = [
  "You are a sharp, plain-spoken football analyst writing for adult bettors who do their own research.",
  "Write natural English, like a good match-preview column. Explain WHY the model leans the way it does",
  "(the expected-goals and attack/defence figures), then what the recent record and league norm say.",
  "STRICT RULES:",
  "- Use figures EXACTLY as written in the EVIDENCE (e.g. '78%', '6 of 8', '2.3 expected goals'). Never create, round, convert or combine numbers.",
  "- Keep the model's probability separate from historical records; say clearly which is which.",
  "- No certainty, guarantees, tips, betting instructions, urgency or hype. Never tell anyone what to bet.",
  "- No betting slang (e.g. 'hit the over', 'value bet', 'banker', 'stake'). Describe outcomes neutrally, e.g. 'three or more goals'.",
  "- No tactics, formations, injuries or team news: that information is not in the evidence.",
  "- Never criticise or imply bias by a referee. If a sample is small, say so briefly.",
  'Return JSON: {"summary": string (60-90 words), "key_points": string[] (exactly 3, each under 16 words)}.',
].join("\n");

const rows = [];
let calls = 0, accepted = 0, rejected = 0, skipped = 0, tokIn = 0, tokOut = 0;
let fixturesDone = 0;
outer: for (const f of fixtures) {
  if (fixturesDone >= MAX_FIXTURES) break;
  let usedThisFixture = false;
  for (const marketId of MARKETS) {
    const ev = await get(`/fixtures/${encodeURIComponent(f.id)}/markets/${marketId}/evidence`);
    if (ev.forecast.probability == null) { skipped++; continue; }
    // Pre-format every figure in plain English so the model can quote, never compute.
    const pctf = (v) => (v == null ? null : `${Math.round(v * 100)}%`);
    const dec = (v, d = 1) => (v == null ? null : Number(v).toFixed(d));
    const drv = Object.fromEntries(ev.model_drivers.filter((d) => d.value != null).map((d) => [d.metric, d.value]));
    const recordLine = (s) => (s.settled ? `${s.title}: happened in ${s.hits} of ${s.settled} (${pctf(s.rate)})` : `${s.title}: no matches available`);
    const compact = {
      match: `${ev.fixture.home} vs ${ev.fixture.away}`,
      competition: ev.fixture.competition,
      market: ev.market.label,
      model: {
        probability: pctf(ev.forecast.probability),
        uncertainty_range: ev.forecast.uncertainty?.p05 != null ? `${pctf(ev.forecast.uncertainty.p05)} to ${pctf(ev.forecast.uncertainty.p95)}` : null,
        expected_goals: drv.expected_goals_home != null ? `${ev.fixture.home} ${dec(drv.expected_goals_home)}, ${ev.fixture.away} ${dec(drv.expected_goals_away)}` : null,
        attack_vs_league_average: drv.attack_multiplier_home != null ? `${ev.fixture.home} ${dec(drv.attack_multiplier_home, 2)}x, ${ev.fixture.away} ${dec(drv.attack_multiplier_away, 2)}x` : null,
        goals_conceded_vs_league_average: drv.defence_multiplier_home != null ? `${ev.fixture.home} ${dec(drv.defence_multiplier_home, 2)}x, ${ev.fixture.away} ${dec(drv.defence_multiplier_away, 2)}x` : null,
        matches_used: drv.training_matches != null ? `${drv.training_matches} matches` : null,
      },
      recent_record: ev.observed_evidence.map(recordLine),
      league_norm: ev.league_baseline.settled ? `${ev.league_baseline.title}: happened in ${ev.league_baseline.hits} of ${ev.league_baseline.settled} (${pctf(ev.league_baseline.rate)})` : null,
      caveats: ev.narrative.caveats,
    };
    const evidenceJson = JSON.stringify(compact);
    // Prompt version is part of the hash: changing the rules regenerates every summary.
    const hash = createHash("sha256").update(`${PROMPT_VERSION}
${evidenceJson}`).digest("hex");
    if (done.has(`${f.id}|${marketId}|${ev.report_version}|${hash}`)) { skipped++; continue; }
    const worst = ((evidenceJson.length / 3 + 400) / 1e6) * PRICE[0] + (MAX_OUT / 1e6) * PRICE[1];
    // Re-read the durable month-to-date spend before every call, so concurrent or earlier runs are counted.
    spend = Math.max(spend, Number((await get("/admin/ai/status")).month_spend_usd));
    if (spend + worst > CAP) { console.log(`Stopping: monthly cap $${CAP} would be exceeded.`); break outer; }
    if (has("dry-run")) { console.log(`[dry-run] would summarise ${compact.match} / ${compact.market}`); continue; }

    // Trial projects have low per-minute quotas: pace calls and back off politely on 429.
    await new Promise((r) => setTimeout(r, Number(arg("pace-ms", "4500"))));
    let res;
    for (let attempt = 1; ; attempt++) {
    res = await fetch(`https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-goog-user-project": PROJECT, "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: `EVIDENCE:\n${evidenceJson}` }] }],
        generationConfig: {
          temperature: 0.2, maxOutputTokens: MAX_OUT, thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseSchema: { type: "OBJECT", properties: { summary: { type: "STRING" }, key_points: { type: "ARRAY", items: { type: "STRING" } } }, required: ["summary", "key_points"] },
        },
        labels: { app: "bettipspro", component: "match-summaries" },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status !== 429 || attempt >= 4) break;
    console.log(`  rate limited by Vertex; waiting ${20 * attempt}s (attempt ${attempt}/3)`);
    await new Promise((r) => setTimeout(r, 20_000 * attempt));
    }
    calls++;
    const out = await res.json();
    if (!res.ok) { console.log(`Vertex error ${res.status}: ${out.error?.message ?? ""}`); break outer; }
    const inT = out.usageMetadata?.promptTokenCount ?? 0;
    const outT = (out.usageMetadata?.candidatesTokenCount ?? 0) + (out.usageMetadata?.thoughtsTokenCount ?? 0);
    const cost = (inT / 1e6) * PRICE[0] + (outT / 1e6) * PRICE[1];
    spend += cost; tokIn += inT; tokOut += outT;
    let parsed = null;
    try { parsed = JSON.parse(out.candidates?.[0]?.content?.parts?.[0]?.text ?? ""); } catch { /* schema failure */ }
    const ok = parsed && typeof parsed.summary === "string" && Array.isArray(parsed.key_points);
    const v = ok ? validateSummary([parsed.summary, ...parsed.key_points].join(" \n"), allowedNumbers(compact)) : { ok: false, problems: ["schema"] };
    if (v.ok) accepted++; else rejected++;
    usedThisFixture = true;
    const row = {
      fixture_id: f.id, market_id: marketId, report_version: ev.report_version, evidence_hash: hash, model: MODEL,
      text_json: JSON.stringify(v.ok ? { ...parsed, validation: v, model: MODEL, generated_at: new Date().toISOString() } : { rejected: true, validation: v }),
      input_tokens: inT, output_tokens: outT, cost_usd: Number(cost.toFixed(6)),
    };
    rows.push(row);
    // Persist each billed attempt immediately (durable spend record even if the run crashes later).
    const imp = await fetch(`${BASE}/api/v1/admin/ai/import`, { method: "POST", headers: { ...H, cookie }, body: JSON.stringify({ rows: [row] }) });
    if (!imp.ok) { console.log(`Import failed (${imp.status}); stopping so no billed attempt goes unrecorded.`); break outer; }
    console.log(`${v.ok ? "OK      " : "REJECTED"} ${compact.match} / ${compact.market}${v.ok ? "" : `  (${v.problems.join("; ").slice(0, 120)})`}`);
  }
  if (usedThisFixture) fixturesDone++;
}

console.log(`Recorded ${rows.length} attempt(s) as they were made.`);
console.log(`\nVertex calls: ${calls} | accepted ${accepted} | rejected ${rejected} | skipped ${skipped} | tokens in/out ${tokIn}/${tokOut} | this run $${(rows.reduce((s, r) => s + r.cost_usd, 0)).toFixed(4)} | month-to-date $${spend.toFixed(4)} of $${CAP}`);
