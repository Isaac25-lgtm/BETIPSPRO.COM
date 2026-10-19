/**
 * Response cache for PUBLIC, user-independent GET endpoints (fixture board, previews, competitions,
 * statistics, archive). Two tiers: in-isolate memo + Workers Cache API (per data centre).
 * Only applied to routes whose output never depends on the session; responses that set cookies or
 * are not 200 are never stored. Private routes (reports, evidence, /me, admin) never use this.
 */
import type { MiddlewareHandler } from "hono";
import type { AppBindings } from "../env.ts";

const memo = new Map<string, { exp: number; body: string; headers: [string, string][] }>();
const MAX = 400;

export function publicCache(ttlSec = 60): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (c.req.method !== "GET") return next();
    const url = new URL(c.req.url);
    const key = `${url.pathname}?${[...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&")}`;
    const now = Date.now();
    const hit = memo.get(key);
    if (hit && hit.exp > now) return new Response(hit.body, { headers: [...hit.headers, ["X-Cache", "memo"]] });

    const cacheApi = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
    const cacheKey = new Request(`https://public-cache.internal${key}`);
    if (cacheApi) {
      try {
        const res = await cacheApi.match(cacheKey);
        if (res) {
          const body = await res.text();
          const headers = [...res.headers.entries()].filter(([k]) => k !== "x-cache") as [string, string][];
          store(key, body, headers, ttlSec);
          return new Response(body, { headers: [...headers, ["X-Cache", "edge"]] });
        }
      } catch {
        /* best effort */
      }
    }

    await next();
    if (c.res.status !== 200 || c.res.headers.has("set-cookie")) return;
    const body = await c.res.clone().text();
    const headers: [string, string][] = [["content-type", "application/json"], ["cache-control", c.res.headers.get("cache-control") ?? `public, max-age=30, s-maxage=${ttlSec}`]];
    store(key, body, headers, ttlSec);
    if (cacheApi) {
      const put = cacheApi.put(cacheKey, new Response(body, { headers: [...headers, ["cache-control", `public, max-age=${ttlSec}`]] })).catch(() => undefined);
      try {
        c.executionCtx.waitUntil(put);
      } catch {
        await put;
      }
    }
    c.res.headers.set("X-Cache", "miss");
  };
}

function store(key: string, body: string, headers: [string, string][], ttlSec: number) {
  if (memo.size >= MAX) memo.delete(memo.keys().next().value as string);
  memo.set(key, { exp: Date.now() + ttlSec * 1000, body, headers });
}

export function clearPublicCache() {
  memo.clear();
}
