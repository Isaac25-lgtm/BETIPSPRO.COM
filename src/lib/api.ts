/**
 * Tiny API client. Same-origin only (the Worker serves both the SPA and /api), so no keys or
 * provider URLs ever reach the browser. Mutations carry the anti-CSRF header.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string; details: unknown };
  meta: { request_id: string; server_time: string; [k: string]: unknown };
}

const cache = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

export function invalidate(prefix = "") {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
  listeners.forEach((l) => l());
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const method = (init.method ?? (init.json !== undefined ? "POST" : "GET")).toUpperCase();
  if (method !== "GET") headers.set("x-requested-with", "fip");
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { ...init, method, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "NETWORK", "Network problem. Check your connection and try again.");
  }
  let env: Envelope<T> | null = null;
  try {
    env = (await res.json()) as Envelope<T>;
  } catch {
    /* non-JSON */
  }
  if (!res.ok || !env?.ok) {
    throw new ApiError(res.status, env?.error?.code ?? "HTTP_" + res.status, env?.error?.message ?? `Request failed (${res.status}).`, env?.error?.details);
  }
  return env.data;
}

/** GET with an in-memory stale-while-revalidate cache, deduplicated across components. */
export function useApi<T>(path: string | null, opts: { ttlMs?: number } = {}) {
  const ttl = opts.ttlMs ?? 30_000;
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>(() => {
    const hit = path ? cache.get(path) : undefined;
    return { data: (hit?.data as T) ?? null, error: null, loading: !!path && !hit };
  });
  const [tick, setTick] = useState(0);
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const hit = cache.get(path);
    if (hit) setState({ data: hit.data as T, error: null, loading: false });
    else setState((s) => ({ data: s.data && pathRef.current === path ? s.data : null, error: null, loading: true }));
    if (hit && Date.now() - hit.at < ttl) return;
    let p = inflight.get(path) as Promise<T> | undefined;
    if (!p) {
      p = api<T>(path);
      inflight.set(path, p);
      p.finally(() => inflight.delete(path));
    }
    let alive = true;
    p.then(
      (data) => {
        cache.set(path, { at: Date.now(), data });
        if (alive && pathRef.current === path) setState({ data, error: null, loading: false });
      },
      (error: ApiError) => {
        if (alive && pathRef.current === path) setState((s) => ({ data: hit ? s.data : null, error, loading: false }));
      },
    );
    return () => {
      alive = false;
    };
  }, [path, ttl, tick]);

  const reload = useCallback(() => {
    if (pathRef.current) cache.delete(pathRef.current);
    setTick((t) => t + 1);
  }, []);
  return { ...state, reload };
}

export function idempotencyKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
