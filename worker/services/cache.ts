/**
 * Two-tier read cache for SHARED (non-user-specific) computed data, e.g. evidence for a
 * fixture/market/report-version. Entitlement checks ALWAYS happen before a cache lookup,
 * and nothing user-specific is ever stored here.
 *   L1: per-isolate in-memory LRU (zero latency, lost on isolate recycle)
 *   L2: Workers Cache API (per data centre), when available
 * Keys include the report version, so publishing a new model run naturally invalidates.
 */
import { clearPublicCache } from "../middleware/public-cache.ts";

const L1 = new Map<string, { exp: number; value: unknown }>();
const L1_MAX = 500;
let generation = 0;

export function bumpCacheGeneration(): number {
  L1.clear();
  clearPublicCache();
  return ++generation;
}

function cacheUrl(key: string) {
  return `https://cache.internal/${generation}/${encodeURIComponent(key)}`;
}

export async function cached<T>(key: string, ttlSec: number, compute: () => Promise<T>): Promise<{ value: T; hit: "l1" | "l2" | "miss" }> {
  const now = Date.now();
  const hit = L1.get(key);
  if (hit && hit.exp > now) {
    L1.delete(key);
    L1.set(key, hit);
    return { value: hit.value as T, hit: "l1" };
  }
  const cacheApi = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  if (cacheApi) {
    try {
      const res = await cacheApi.match(cacheUrl(key));
      if (res) {
        const value = (await res.json()) as T;
        setL1(key, value, ttlSec);
        return { value, hit: "l2" };
      }
    } catch {
      /* cache is best-effort */
    }
  }
  const value = await compute();
  setL1(key, value, ttlSec);
  if (cacheApi) {
    try {
      await cacheApi.put(cacheUrl(key), new Response(JSON.stringify(value), { headers: { "Cache-Control": `max-age=${ttlSec}`, "Content-Type": "application/json" } }));
    } catch {
      /* ignore */
    }
  }
  return { value, hit: "miss" };
}

function setL1(key: string, value: unknown, ttlSec: number) {
  if (L1.size >= L1_MAX) L1.delete(L1.keys().next().value as string);
  L1.set(key, { exp: Date.now() + ttlSec * 1000, value });
}
