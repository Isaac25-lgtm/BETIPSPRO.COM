import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { api, invalidate, useApi } from "../lib/api";

export interface Me {
  user: null | { id: string; email: string; display_name: string; role: "admin" | "tester" | "customer"; age_confirmed_at: string | null; privacy_consent_at: string | null };
  credits?: number;
  unlocked_reports?: number;
}

export interface PublicConfig {
  data_mode: "DEMO" | "FREE_API" | "PRODUCTION";
  synthetic_data_present: boolean;
  /** Testing phase: every report is open to everyone, no credits needed. */
  open_access: boolean;
  assistant_enabled?: boolean;
  payments_enabled: boolean;
  invite_only: boolean;
  max_beta_users: number;
  beta_initial_credits: number;
  ai_explanations_enabled: boolean;
  today_eat: string;
}

interface AuthCtx {
  me: Me | null;
  config: PublicConfig | null;
  loading: boolean;
  refresh: () => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const me = useApi<Me>("/me", { ttlMs: 15_000 });
  const cfg = useApi<PublicConfig>("/config/public", { ttlMs: 300_000 });
  const reloadMe = me.reload;
  const refresh = useCallback(() => {
    invalidate("/me");
    reloadMe();
  }, [reloadMe]);
  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" });
    invalidate("");
    reloadMe();
  }, [reloadMe]);
  const value = useMemo(() => ({ me: me.data, config: cfg.data, loading: me.loading, refresh, logout }), [me.data, cfg.data, me.loading, refresh, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}
