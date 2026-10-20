/**
 * OPTIONAL Gemini (Vertex AI) summaries - OFF by default (AI_EXPLANATIONS_ENABLED=false).
 *
 * - Admin-triggered only, once per fixture/market/report-version/evidence-hash; cached and reused for
 *   every viewer. Viewer clicks NEVER call the model.
 * - Monthly hard budget (AI_MONTHLY_BUDGET_USD) and per-job token ceilings; pricing must be configured
 *   explicitly (AI_PRICE_INPUT_PER_MTOK / AI_PRICE_OUTPUT_PER_MTOK) - we never assume free credits.
 * - The model only receives verified evidence; output is schema-checked and every number reconciled
 *   (validate.ts). Any failure -> deterministic template, never a blocked page.
 * - Uses a SEPARATE, project-specific service account (never the owner's other production credentials).
 */
import type { Env } from "../../env.ts";
import { flag, num } from "../../env.ts";
import { ApiError } from "../../lib/http.ts";
import { b64url, newId, sha256Hex } from "../../lib/crypto.ts";
import { nowIso } from "../../lib/time.ts";
import { allowedNumbers, validateSummary } from "./validate.ts";

const MAX_INPUT_CHARS = 24_000; // ~6k tokens
const MAX_OUTPUT_TOKENS = 600;

export function aiStatus(env: Env) {
  const e = env as Env & { AI_PRICE_INPUT_PER_MTOK?: string; AI_PRICE_OUTPUT_PER_MTOK?: string };
  return {
    enabled: flag(env.AI_EXPLANATIONS_ENABLED),
    credentials_configured: !!env.VERTEX_SERVICE_ACCOUNT_JSON && !!env.VERTEX_PROJECT_ID,
    monthly_budget_usd: num(env.AI_MONTHLY_BUDGET_USD, 0),
    pricing_configured: !!e.AI_PRICE_INPUT_PER_MTOK && !!e.AI_PRICE_OUTPUT_PER_MTOK,
    model: env.VERTEX_MODEL ?? null,
  };
}

async function monthSpend(env: Env): Promise<number> {
  const start = nowIso().slice(0, 7) + "-01T00:00:00Z";
  const r = await env.DB.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_explanations WHERE created_at >= ?").bind(start).first<{ s: number }>();
  return r?.s ?? 0;
}

async function accessToken(saJson: string): Promise<string> {
  const sa = JSON.parse(saJson) as { client_email: string; private_key: string; token_uri?: string };
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: sa.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3000 })}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${b64url(sig)}`,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function generateSummary(env: Env, input: { fixtureId: string; marketId: string; reportVersion: string; evidence: Record<string, unknown> }) {
  const st = aiStatus(env);
  if (!st.enabled) throw new ApiError(403, "FEATURE_DISABLED", "AI explanations are disabled (AI_EXPLANATIONS_ENABLED=false). Deterministic templates are used.");
  if (!st.credentials_configured) throw new ApiError(503, "FEATURE_DISABLED", "Vertex credentials are not configured.");
  if (!st.pricing_configured) throw new ApiError(503, "FEATURE_DISABLED", "Set AI_PRICE_INPUT_PER_MTOK and AI_PRICE_OUTPUT_PER_MTOK for the selected model so spend can be enforced.");
  const e = env as Env & { AI_PRICE_INPUT_PER_MTOK?: string; AI_PRICE_OUTPUT_PER_MTOK?: string };
  const priceIn = num(e.AI_PRICE_INPUT_PER_MTOK, NaN);
  const priceOut = num(e.AI_PRICE_OUTPUT_PER_MTOK, NaN);

  const evidenceJson = JSON.stringify(input.evidence);
  if (evidenceJson.length > MAX_INPUT_CHARS) throw new ApiError(422, "VALIDATION_FAILED", "Evidence too large for the per-job token ceiling.");
  const evidenceHash = await sha256Hex(evidenceJson);
  const existing = await env.DB.prepare("SELECT text_json FROM ai_explanations WHERE fixture_id = ? AND market_definition_id = ? AND report_version = ? AND evidence_hash = ?")
    .bind(input.fixtureId, input.marketId, input.reportVersion, evidenceHash).first<{ text_json: string }>();
  if (existing) return { cached: true, summary: JSON.parse(existing.text_json) };

  const worstCase = (MAX_INPUT_CHARS / 4 / 1e6) * priceIn + (MAX_OUTPUT_TOKENS / 1e6) * priceOut;
  if ((await monthSpend(env)) + worstCase > st.monthly_budget_usd) throw new ApiError(429, "BUDGET_EXHAUSTED", "Monthly AI budget would be exceeded; using deterministic template.");

  const prompt = [
    "You summarise VERIFIED football evidence for adult analysts. Rules:",
    "- Use ONLY numbers present in the EVIDENCE JSON. Do not compute new numbers.",
    "- Distinguish the model probability from historical hit-rates.",
    "- No certainty, guarantees, betting instructions, urgency or promotional language.",
    "- No tactical claims (formations, pressing, overlaps) - that data is not available.",
    "- Never criticise or imply bias by a referee.",
    'Return JSON: {"summary": string (<= 120 words), "key_points": string[] (<= 4)}.',
    "EVIDENCE:",
    evidenceJson,
  ].join("\n");
  const token = await accessToken(env.VERTEX_SERVICE_ACCOUNT_JSON!);
  const loc = env.VERTEX_LOCATION ?? "us-central1";
  const model = env.VERTEX_MODEL ?? "gemini-2.5-flash";
  if (!/^gemini-[\d.]+-flash(-lite)?$/.test(model)) throw new ApiError(503, "FEATURE_DISABLED", "Only Gemini Flash models are allowed for summaries.");
  const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${env.VERTEX_PROJECT_ID}/locations/${loc}/publishers/google/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: "application/json",
        responseSchema: { type: "OBJECT", properties: { summary: { type: "STRING" }, key_points: { type: "ARRAY", items: { type: "STRING" } } }, required: ["summary", "key_points"] },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new ApiError(502, "INTERNAL", `Vertex returned HTTP ${res.status}; template used instead.`);
  const out = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  const tokensIn = out.usageMetadata?.promptTokenCount ?? 0;
  const tokensOut = out.usageMetadata?.candidatesTokenCount ?? 0;
  const cost = (tokensIn / 1e6) * priceIn + (tokensOut / 1e6) * priceOut;
  let parsed: { summary: string; key_points: string[] };
  try {
    parsed = JSON.parse(out.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    if (typeof parsed.summary !== "string" || !Array.isArray(parsed.key_points)) throw new Error("shape");
  } catch {
    throw new ApiError(502, "INTERNAL", "Model output failed schema validation; template used instead.");
  }
  const v = validateSummary([parsed.summary, ...parsed.key_points].join(" \n"), allowedNumbers(input.evidence));
  const record = { ...parsed, validation: v, model: env.VERTEX_MODEL, generated_at: nowIso() };
  // Cost is recorded even for rejected output so the budget stays honest.
  await env.DB.prepare("INSERT OR IGNORE INTO ai_explanations (id, fixture_id, market_definition_id, report_version, evidence_hash, model, text_json, input_tokens, output_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(newId("ai"), input.fixtureId, input.marketId, input.reportVersion, evidenceHash, env.VERTEX_MODEL ?? "unknown", JSON.stringify(v.ok ? record : { rejected: true, validation: v }), tokensIn, tokensOut, cost, nowIso())
    .run();
  if (!v.ok) throw new ApiError(422, "VALIDATION_FAILED", "Generated summary contained unverifiable claims and was rejected; template used instead.", v.problems);
  return { cached: false, summary: record, cost_usd: cost };
}

export async function cachedSummary(env: Env, fixtureId: string, marketId: string, reportVersion: string) {
  const r = await env.DB.prepare("SELECT text_json FROM ai_explanations WHERE fixture_id = ? AND market_definition_id = ? AND report_version = ? ORDER BY created_at DESC LIMIT 1")
    .bind(fixtureId, marketId, reportVersion).first<{ text_json: string }>();
  if (!r) return null;
  const j = JSON.parse(r.text_json);
  return j.rejected ? null : j;
}
