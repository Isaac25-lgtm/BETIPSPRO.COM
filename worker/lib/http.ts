import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppBindings } from "../env.ts";

export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INSUFFICIENT_CREDITS"
  | "REPORT_LOCKED"
  | "REPORT_UNAVAILABLE"
  | "RATE_LIMITED"
  | "CSRF_REJECTED"
  | "BUDGET_EXHAUSTED"
  | "PROVIDER_UNCONFIGURED"
  | "FEATURE_DISABLED"
  | "UPSTREAM_ERROR"
  | "INTERNAL";

export class ApiError extends Error {
  status: ContentfulStatusCode;
  code: ErrorCode;
  details?: unknown;
  constructor(status: ContentfulStatusCode, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Consistent JSON envelope: { ok, data, meta: { request_id, server_time } } */
export function ok<T>(c: Context<AppBindings>, data: T, init?: { status?: ContentfulStatusCode; cache?: string; meta?: Record<string, unknown> }) {
  c.header("Cache-Control", init?.cache ?? "private, no-store");
  return c.json(
    { ok: true, data, meta: { request_id: c.get("requestId"), server_time: new Date().toISOString(), ...init?.meta } },
    init?.status ?? 200,
  );
}

export function fail(c: Context<AppBindings>, err: ApiError) {
  c.header("Cache-Control", "no-store");
  return c.json(
    {
      ok: false,
      error: { code: err.code, message: err.message, details: err.details ?? null },
      meta: { request_id: c.get("requestId"), server_time: new Date().toISOString() },
    },
    err.status,
  );
}
