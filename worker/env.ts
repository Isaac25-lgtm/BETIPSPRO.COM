export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  // non-secret vars (wrangler.jsonc)
  APP_ENV: string;
  SPORTS_PROVIDER: string;
  SPORTS_API_FREE_MODE: string;
  SPORTS_API_DAILY_BUDGET: string;
  SPORTS_API_DAILY_HARD_CAP: string;
  SPORTS_API_PER_MINUTE_MAX: string;
  AI_EXPLANATIONS_ENABLED: string;
  AI_MONTHLY_BUDGET_USD: string;
  PAYMENTS_ENABLED: string;
  BETA_INVITE_ONLY: string;
  MAX_BETA_USERS: string;
  BETA_INITIAL_CREDITS: string;
  BETA_CREDITS_EXPIRE: string;
  PUBLIC_PERFORMANCE_ONLY_VERIFIED: string;
  TURNSTILE_ENABLED: string;
  // secrets (.dev.vars / wrangler secret) - never echoed
  ADMIN_BOOTSTRAP_TOKEN?: string;
  SESSION_SECRET?: string;
  API_FOOTBALL_KEY?: string;
  FOOTBALL_DATA_ORG_KEY?: string;
  FDO_DAILY_BUDGET?: string;
  FDO_DAILY_HARD_CAP?: string;
  FDO_PER_MINUTE_MAX?: string;
  TURNSTILE_SECRET_KEY?: string;
  VERTEX_SERVICE_ACCOUNT_JSON?: string;
  VERTEX_PROJECT_ID?: string;
  VERTEX_LOCATION?: string;
  VERTEX_MODEL?: string;
  GIT_COMMIT?: string;
  // Ask BetTipsPro AI (DeepSeek); key is a secret, never logged
  DEEPSEEK_API_KEY?: string;
  ASSISTANT_ENABLED?: string;
  ASSISTANT_DAILY_LIMIT?: string;
  ASSISTANT_DAILY_BUDGET_USD?: string;
  ASSISTANT_MONTHLY_BUDGET_USD?: string;
  ASSISTANT_PRICE_IN_PER_M?: string;
  ASSISTANT_PRICE_OUT_PER_M?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  role: "admin" | "tester" | "customer";
  status: string;
  age_confirmed_at: string | null;
  privacy_consent_at: string | null;
  session_id: string;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { requestId: string; user: SessionUser | null };
};

export const flag = (v: string | undefined) => v === "true" || v === "1";
export const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export type DataMode = "DEMO" | "FREE_API" | "PRODUCTION";
export function dataMode(env: Env): DataMode {
  if (env.SPORTS_PROVIDER !== "api_football" || !env.API_FOOTBALL_KEY) return "DEMO";
  return flag(env.SPORTS_API_FREE_MODE) ? "FREE_API" : "PRODUCTION";
}
