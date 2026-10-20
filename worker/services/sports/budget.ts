/**
 * The ONE gateway for upstream sports-data calls, for every provider.
 *
 * Admission control is atomic in D1 (shared across every Worker isolate, cron, admin action and
 * the offline pipeline - which never calls a provider directly), per provider:
 *   - daily operational budget + reserve up to a hard cap (reserve only for explicit admin diagnostics)
 *   - per-minute window
 *   - provider-reported remaining quota (from response headers) also respected
 * Both counters are incremented in a single D1 batch with a guard; if either limit is hit the batch
 * rolls back and NO request is sent. Responses are snapshotted (checksummed) and reused within a TTL,
 * with in-isolate single-flight for identical concurrent requests. Keys are never logged/returned.
 *
 * Providers:
 *   api_football       API-SPORTS v3. Free: 100/day, 10/min, seasons 2022-2024 only.
 *   football_data_org  football-data.org v4. Free: 12 competitions incl. current season, 10/min,
 *                      no stated daily cap (we still impose one). Throttle headers:
 *                      X-Requests-Available-Minute, X-RequestCounter-Reset.
 */
import type { Env } from "../../env.ts";
import { num } from "../../env.ts";
import { ApiError } from "../../lib/http.ts";
import { newId, sha256Hex } from "../../lib/crypto.ts";
import { minuteBucket, nowIso, utcDay } from "../../lib/time.ts";

export type ProviderName = "api_football" | "football_data_org";
export const PROVIDER: ProviderName = "api_football";
const TIMEOUT_MS = 10_000;

export type Priority = "normal" | "reserve";

export interface MeteredResponse<T = unknown> {
  body: T;
  fromCache: boolean;
  snapshotId: string | null;
  fetchedAt: string;
}

interface ProviderSpec {
  label: string;
  baseUrl: string;
  key: (env: Env) => string | undefined;
  authHeader: string;
  limits: (env: Env) => { daily: number; hardCap: number; perMinute: number };
  /** Returns an error message when the body signals a provider-level error, else null. */
  bodyError: (body: unknown) => string | null;
  isValidBody: (body: unknown) => boolean;
  captureHeaders: (h: Headers) => { limit: number | null; remaining: number | null; minuteRemaining: number | null; resetSec: number | null };
}

const numOrNull = (v: string | null) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

function apiFootballErrors(errors: unknown): string | null {
  if (!errors) return null;
  if (Array.isArray(errors)) return errors.length ? errors.map(String).join("; ") : null;
  if (typeof errors === "object") {
    const vals = Object.entries(errors as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`);
    return vals.length ? vals.join("; ") : null;
  }
  return String(errors);
}

export const PROVIDERS: Record<ProviderName, ProviderSpec> = {
  api_football: {
    label: "API-Football",
    baseUrl: "https://v3.football.api-sports.io",
    key: (env) => env.API_FOOTBALL_KEY,
    authHeader: "x-apisports-key",
    limits: (env) => {
      const hardCap = Math.min(num(env.SPORTS_API_DAILY_HARD_CAP, 100), 100);
      return { hardCap, daily: Math.min(num(env.SPORTS_API_DAILY_BUDGET, 80), hardCap), perMinute: Math.min(num(env.SPORTS_API_PER_MINUTE_MAX, 10), 10) };
    },
    isValidBody: (b) => !!b && typeof b === "object" && "response" in (b as object) && "errors" in (b as object),
    bodyError: (b) => apiFootballErrors((b as { errors?: unknown })?.errors),
    captureHeaders: (h) => ({
      limit: numOrNull(h.get("x-ratelimit-requests-limit")),
      remaining: numOrNull(h.get("x-ratelimit-requests-remaining")),
      minuteRemaining: numOrNull(h.get("x-ratelimit-remaining")),
      resetSec: null,
    }),
  },
  football_data_org: {
    label: "football-data.org",
    baseUrl: "https://api.football-data.org/v4",
    key: (env) => env.FOOTBALL_DATA_ORG_KEY,
    authHeader: "X-Auth-Token",
    limits: (env) => {
      const hardCap = num(env.FDO_DAILY_HARD_CAP, 1000);
      // Free tier is 10/min; we stay at 9 to leave headroom for clock skew between us and the provider.
      return { hardCap, daily: Math.min(num(env.FDO_DAILY_BUDGET, 800), hardCap), perMinute: Math.min(num(env.FDO_PER_MINUTE_MAX, 9), 10) };
    },
    isValidBody: (b) => !!b && typeof b === "object",
    bodyError: (b) => {
      const o = b as { errorCode?: unknown; message?: unknown; error?: unknown };
      return o && (o.errorCode != null || (o.error != null && o.message != null)) ? String(o.message ?? o.error) : null;
    },
    captureHeaders: (h) => ({
      limit: null,
      remaining: null,
      minuteRemaining: numOrNull(h.get("x-requests-available-minute")),
      resetSec: numOrNull(h.get("x-requestcounter-reset")),
    }),
  },
};

export function providerConfigured(env: Env, provider: ProviderName): boolean {
  return !!PROVIDERS[provider].key(env);
}

export function budgetConfig(env: Env, provider: ProviderName = PROVIDER) {
  const l = PROVIDERS[provider].limits(env);
  return { daily: l.daily, hardCap: l.hardCap, reserve: l.hardCap - l.daily, perMinute: l.perMinute };
}

export function paramsKey(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/** Atomically reserve one upstream call. Throws BUDGET_EXHAUSTED / RATE_LIMITED without calling upstream. */
export async function admit(env: Env, priority: Priority = "normal", at: Date = new Date(), provider: ProviderName = PROVIDER): Promise<{ used: number }> {
  const cfg = budgetConfig(env, provider);
  const limit = priority === "reserve" ? cfg.hardCap : cfg.daily;
  const day = utcDay(at);
  const minute = minuteBucket(at);
  const now = nowIso();
  const q = await env.DB.prepare("SELECT used, provider_reported_remaining FROM provider_quota WHERE provider = ? AND utc_day = ?").bind(provider, day).first<{ used: number; provider_reported_remaining: number | null }>();
  if (q?.provider_reported_remaining != null && q.provider_reported_remaining <= (priority === "reserve" ? 0 : cfg.reserve)) {
    throw new ApiError(429, "BUDGET_EXHAUSTED", `Provider reports only ${q.provider_reported_remaining} requests remaining today; holding the reserve.`);
  }
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO provider_quota (provider, utc_day, used, updated_at) VALUES (?1, ?2, 1, ?3)
         ON CONFLICT(provider, utc_day) DO UPDATE SET used = used + 1, updated_at = ?3 WHERE provider_quota.used < ?4`,
      ).bind(provider, day, now, limit),
      env.DB.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('daily-budget-exhausted', '$') END"),
      env.DB.prepare(
        `INSERT INTO provider_rate_windows (provider, minute_bucket, used) VALUES (?1, ?2, 1)
         ON CONFLICT(provider, minute_bucket) DO UPDATE SET used = used + 1 WHERE provider_rate_windows.used < ?3`,
      ).bind(provider, minute, cfg.perMinute),
      env.DB.prepare("SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('minute-window-full', '$') END"),
    ]);
  } catch {
    const after = await env.DB.prepare("SELECT used FROM provider_quota WHERE provider = ? AND utc_day = ?").bind(provider, day).first<{ used: number }>();
    if ((after?.used ?? 0) >= limit) {
      throw new ApiError(429, "BUDGET_EXHAUSTED", `Daily ${PROVIDERS[provider].label} budget reached (${after?.used}/${limit}${priority === "normal" ? `, reserve of ${cfg.reserve} held back` : ""}). Cached data will be shown.`);
    }
    throw new ApiError(429, "RATE_LIMITED", `Per-minute ${PROVIDERS[provider].label} limit (${cfg.perMinute}/min) reached; try again shortly.`);
  }
  const r = await env.DB.prepare("SELECT used FROM provider_quota WHERE provider = ? AND utc_day = ?").bind(provider, day).first<{ used: number }>();
  return { used: r?.used ?? 0 };
}

const inflight = new Map<string, Promise<MeteredResponse>>();
const breakerOpenUntil: Partial<Record<ProviderName, number>> = {};

async function circuitOpen(env: Env, provider: ProviderName): Promise<boolean> {
  if (Date.now() < (breakerOpenUntil[provider] ?? 0)) return true;
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const recent = await env.DB.prepare("SELECT status FROM provider_api_usage WHERE provider = ? AND created_at > ? ORDER BY created_at DESC LIMIT 3").bind(provider, since).all<{ status: string }>();
  return recent.results.length === 3 && recent.results.every((r) => r.status !== "ok" && r.status !== "provider_error");
}

/**
 * Metered GET. `ttlSec` controls snapshot reuse (0 = always call). Every upstream attempt is admitted,
 * counted and logged. One retry with jitter for network/5xx; never for 4xx/429.
 */
export async function meteredGet<T = unknown>(
  env: Env,
  endpoint: string,
  params: Record<string, string | number | undefined>,
  opts: { ttlSec: number; priority?: Priority; jobId?: string | null; fetchImpl?: typeof fetch; provider?: ProviderName } = { ttlSec: 3600 },
): Promise<MeteredResponse<T>> {
  const provider = opts.provider ?? PROVIDER;
  const spec = PROVIDERS[provider];
  const key = spec.key(env);
  if (!key) throw new ApiError(503, "PROVIDER_UNCONFIGURED", `${spec.label} key is not configured.`);
  const pkey = paramsKey(params);
  const cacheKey = `${provider}:${endpoint}?${pkey}`;
  if (opts.ttlSec > 0) {
    const since = new Date(Date.now() - opts.ttlSec * 1000).toISOString();
    const snap = await env.DB.prepare("SELECT id, body_json, fetched_at FROM provider_snapshots WHERE provider = ? AND endpoint = ? AND params_key = ? AND fetched_at > ? ORDER BY fetched_at DESC LIMIT 1")
      .bind(provider, endpoint, pkey, since)
      .first<{ id: string; body_json: string; fetched_at: string }>();
    if (snap) return { body: JSON.parse(snap.body_json) as T, fromCache: true, snapshotId: snap.id, fetchedAt: snap.fetched_at };
  }
  const existing = inflight.get(cacheKey);
  if (existing) return existing as Promise<MeteredResponse<T>>;
  const p = (async () => {
    if (await circuitOpen(env, provider)) throw new ApiError(503, "PROVIDER_UNCONFIGURED", `${spec.label} circuit breaker is open after repeated failures; retry in a few minutes.`);
    const doFetch = opts.fetchImpl ?? fetch;
    let attempt = 0;
    for (;;) {
      attempt++;
      await admit(env, opts.priority ?? "normal", new Date(), provider);
      const started = Date.now();
      let status = "ok";
      let httpStatus: number | null = null;
      try {
        const url = `${spec.baseUrl}${endpoint}${pkey ? `?${pkey}` : ""}`;
        const res = await doFetch(url, { headers: { [spec.authHeader]: key }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        httpStatus = res.status;
        const hdr = spec.captureHeaders(res.headers);
        await captureQuotaHeaders(env, provider, hdr);
        if (hdr.minuteRemaining === 0) breakerOpenUntil[provider] = Date.now() + Math.max(hdr.resetSec ?? 60, 1) * 1000;
        if (res.status === 429) {
          status = "rate_limited";
          breakerOpenUntil[provider] = Date.now() + Math.max(hdr.resetSec ?? 60, 1) * 1000;
          throw new ApiError(429, "RATE_LIMITED", `${spec.label} rate limit hit (429). Backing off for ${hdr.resetSec ?? 60}s.`);
        }
        if (res.status >= 500) {
          status = "upstream_5xx";
          throw new Error(`upstream ${res.status}`);
        }
        const text = await res.text();
        let body: unknown = null;
        try {
          body = JSON.parse(text);
        } catch {
          status = "invalid_response";
          throw new ApiError(502, "INTERNAL", `${spec.label} returned a non-JSON response.`);
        }
        const perr = spec.bodyError(body);
        if (!res.ok || perr) {
          status = res.ok ? "provider_error" : "upstream_4xx";
          throw new ApiError(502, "INTERNAL", `Provider error: ${perr ?? `HTTP ${res.status}`}`, { provider_errors: perr });
        }
        if (!spec.isValidBody(body)) {
          status = "invalid_response";
          throw new ApiError(502, "INTERNAL", `${spec.label} response did not match the documented envelope.`);
        }
        const checksum = "sha256:" + (await sha256Hex(text));
        const snapId = newId("snp");
        const fetchedAt = nowIso();
        if (text.length < 1_500_000) {
          const results = Number((body as { results?: number; resultSet?: { count?: number } }).results ?? (body as { resultSet?: { count?: number } }).resultSet?.count ?? 0) || 0;
          await env.DB.prepare("INSERT OR IGNORE INTO provider_snapshots (id, provider, endpoint, params_key, fetched_at, checksum, results, body_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(snapId, provider, endpoint, pkey, fetchedAt, checksum, results, text)
            .run();
        }
        return { body: body as T, fromCache: false, snapshotId: snapId, fetchedAt };
      } catch (e) {
        if (status === "ok") status = "network_error";
        const retryable = status === "network_error" || status === "upstream_5xx";
        if (!retryable || attempt >= 2) throw e instanceof ApiError ? e : new ApiError(502, "INTERNAL", `Provider request failed (${status}).`);
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
      } finally {
        await env.DB.prepare("INSERT INTO provider_api_usage (id, provider, utc_day, endpoint, params_key, status, http_status, latency_ms, credits_consumed, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
          .bind(newId("use"), provider, utcDay(), endpoint, pkey, status, httpStatus, Date.now() - started, opts.jobId ?? null, nowIso())
          .run();
      }
    }
  })();
  inflight.set(cacheKey, p as Promise<MeteredResponse>);
  try {
    return (await p) as MeteredResponse<T>;
  } finally {
    inflight.delete(cacheKey);
  }
}

async function captureQuotaHeaders(env: Env, provider: ProviderName, h: { limit: number | null; remaining: number | null }) {
  if (h.limit == null && h.remaining == null) return;
  await env.DB.prepare(
    `INSERT INTO provider_quota (provider, utc_day, used, provider_reported_limit, provider_reported_remaining, updated_at) VALUES (?1, ?2, 0, ?3, ?4, ?5)
     ON CONFLICT(provider, utc_day) DO UPDATE SET provider_reported_limit = ?3, provider_reported_remaining = ?4, updated_at = ?5`,
  )
    .bind(provider, utcDay(), h.limit, h.remaining, nowIso())
    .run();
}

export async function usageSummary(env: Env, provider: ProviderName = PROVIDER) {
  const day = utcDay();
  const cfg = budgetConfig(env, provider);
  const [q, byEndpoint, recent, last] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare("SELECT used, provider_reported_limit, provider_reported_remaining, updated_at FROM provider_quota WHERE provider = ? AND utc_day = ?").bind(provider, day),
    env.DB.prepare("SELECT endpoint, status, COUNT(*) AS calls, AVG(latency_ms) AS avg_ms FROM provider_api_usage WHERE provider = ? AND utc_day = ? GROUP BY endpoint, status ORDER BY calls DESC").bind(provider, day),
    env.DB.prepare("SELECT utc_day, COUNT(*) AS calls FROM provider_api_usage WHERE provider = ? GROUP BY utc_day ORDER BY utc_day DESC LIMIT 14").bind(provider),
    env.DB.prepare("SELECT created_at, endpoint, status FROM provider_api_usage WHERE provider = ? AND status = 'ok' ORDER BY created_at DESC LIMIT 1").bind(provider),
  ]);
  const row = q.results[0] as { used: number; provider_reported_limit: number | null; provider_reported_remaining: number | null; updated_at: string } | undefined;
  return {
    provider,
    label: PROVIDERS[provider].label,
    configured: providerConfigured(env, provider),
    utc_day: day,
    used_today: row?.used ?? 0,
    operational_budget: cfg.daily,
    hard_cap: cfg.hardCap,
    reserve: cfg.reserve,
    per_minute_max: cfg.perMinute,
    provider_reported: { limit: row?.provider_reported_limit ?? null, remaining: row?.provider_reported_remaining ?? null, updated_at: row?.updated_at ?? null },
    by_endpoint_today: byEndpoint.results,
    daily_history: recent.results,
    last_successful_call: last.results[0] ?? null,
    resets: "00:00 UTC (per provider documentation; verify on the account dashboard)",
  };
}
