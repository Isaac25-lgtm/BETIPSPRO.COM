import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppBindings, SessionUser } from "../env.ts";
import { ApiError } from "../lib/http.ts";
import { newId, sha256Hex } from "../lib/crypto.ts";
import { SESSION_COOKIE, sessionUser } from "../services/auth.ts";

export const requestContext: MiddlewareHandler<AppBindings> = async (c, next) => {
  const rid = c.req.header("cf-ray") ?? newId("req");
  c.set("requestId", rid);
  c.set("user", null);
  await next();
  c.header("X-Request-Id", rid);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (new URL(c.req.url).protocol === "https:") c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
};

export const loadSession: MiddlewareHandler<AppBindings> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) c.set("user", await sessionUser(c.env, token));
  await next();
};

/**
 * CSRF defence for state-changing requests: SameSite=Lax cookies + a required custom header
 * (cannot be sent cross-site without a CORS preflight, which we never grant) + Origin check.
 */
export const csrf: MiddlewareHandler<AppBindings> = async (c, next) => {
  const m = c.req.method;
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
    if (c.req.header("x-requested-with") !== "fip") throw new ApiError(403, "CSRF_REJECTED", "Missing anti-CSRF header.");
    const origin = c.req.header("origin");
    if (origin && new URL(origin).host !== new URL(c.req.url).host) throw new ApiError(403, "CSRF_REJECTED", "Cross-origin request rejected.");
  }
  await next();
};

export function requireUser(c: Context<AppBindings>): SessionUser {
  const u = c.get("user");
  if (!u) throw new ApiError(401, "UNAUTHENTICATED", "Please sign in.");
  return u;
}

export function requireAdmin(c: Context<AppBindings>): SessionUser {
  const u = requireUser(c);
  if (u.role !== "admin") throw new ApiError(403, "FORBIDDEN", "Administrator access required.");
  return u;
}

/** Server-side admin guard for a whole router - hiding buttons in the UI is never the control. */
export const adminOnly: MiddlewareHandler<AppBindings> = async (c, next) => {
  requireAdmin(c);
  await next();
};

export async function ipHash(c: Context<AppBindings>): Promise<string> {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  return (await sha256Hex(`${c.env.SESSION_SECRET ?? "dev"}:ip:${ip}`)).slice(0, 32);
}

/** Cloudflare Turnstile server-side verification (only when enabled and configured). */
export async function verifyTurnstile(c: Context<AppBindings>, token: string | undefined): Promise<void> {
  if (c.env.TURNSTILE_ENABLED !== "true") return;
  if (!c.env.TURNSTILE_SECRET_KEY) throw new ApiError(503, "FEATURE_DISABLED", "Turnstile is enabled but not configured.");
  if (!token) throw new ApiError(400, "BAD_REQUEST", "Bot check missing.");
  const form = new FormData();
  form.append("secret", c.env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  const ip = c.req.header("cf-connecting-ip");
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const out = (await res.json()) as { success: boolean };
  if (!out.success) throw new ApiError(400, "BAD_REQUEST", "Bot check failed. Please retry.");
}
