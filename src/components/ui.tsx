import type { ReactNode } from "react";
import { AlertTriangle, FlaskConical, Info, Lock } from "lucide-react";
import { brand } from "../../shared/brand";
import { initials, qualityLabel } from "../lib/format";
import type { TeamRef } from "../lib/types";

/** Brand mark (direction A "probability ring") + placeholder wordmark from shared/brand.ts. */
export function BrandMark({ size = 48 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className="brand-mark">
      <circle cx="24" cy="24" r="20.5" fill="none" stroke="#1df992" strokeOpacity=".22" strokeWidth="4" />
      <circle cx="24" cy="24" r="20.5" fill="none" stroke="#1df992" strokeWidth="4" strokeLinecap="round" strokeDasharray="100 128.8" transform="rotate(-62 24 24)" />
      <circle cx="24" cy="24" r="14" fill="#fff" />
      <path d="M24 17.6 30.1 22 27.8 29.2H20.2L17.9 22Z" fill="#001424" />
      <path d="M24 17.6V10.2M30.1 22l7-2.3M27.8 29.2l4.3 6M20.2 29.2l-4.3 6M17.9 22l-7-2.3" stroke="#001424" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ compact = false, dark = true }: { compact?: boolean; dark?: boolean }) {
  return (
    <span className={`logo ${dark ? "logo-dark" : "logo-light"} ${compact ? "logo-compact" : ""}`}>
      <BrandMark size={compact ? 36 : 52} />
      <span className="logo-text">
        <span className="logo-word">
          {brand.wordmark.base}
          <span className="logo-accent">{brand.wordmark.accent}</span>
        </span>
        {!compact && <span className="logo-tag">{brand.tagLine}</span>}
      </span>
    </span>
  );
}

/** Clean circular monogram from team colours. No club crests are used (rights not cleared). */
export function TeamBadge({ team, size = 32 }: { team: Pick<TeamRef, "name" | "primary_color" | "secondary_color" | "code">; size?: number }) {
  const c1 = team.primary_color ?? "#334155";
  const c2 = team.secondary_color ?? "#ffffff";
  const light = isLight(c1);
  const ink = light ? "#0f172a" : isLight(c2) ? c2 : "#ffffff";
  const id = `tb-${(team.code ?? team.name).replace(/[^a-z0-9]/gi, "")}`;
  const label = (team.code ?? initials(team.name)).slice(0, 3).toUpperCase();
  return (
    <span className="team-badge" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 32 32" width={size} height={size}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".22" />
            <stop offset=".55" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity=".18" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="15" fill={c1} />
        <circle cx="16" cy="16" r="15" fill={`url(#${id})`} />
        <circle cx="16" cy="16" r="13.2" fill="none" stroke={light ? "#94a3b8" : c2} strokeOpacity={light ? 0.5 : 0.75} strokeWidth="1.2" />
        <text x="16" y={label.length > 2 ? 19.6 : 20.2} textAnchor="middle" fontSize={label.length > 2 ? 9.6 : 11.5} fontWeight="800" letterSpacing="-.3" fill={ink} fontFamily="Inter, sans-serif">
          {label}
        </text>
      </svg>
    </span>
  );
}

/** Full name when it fits a compact cell, otherwise the provider/demo short name. */
export function teamLabel(team: Pick<TeamRef, "name" | "short_name">, max = 16) {
  return team.name.length <= max || !team.short_name ? team.name : team.short_name;
}

function isLight(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 186;
}

/** Neutral competition marker: initials tile (no league emblems are used). */
export function CompMark({ name, synthetic }: { name: string; synthetic?: boolean }) {
  const palette = ["#3d195b", "#e2231a", "#0e4a8f", "#1b7d3b", "#b45309", "#0f766e"];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="comp-mark" style={{ background: palette[h % palette.length] }} aria-hidden="true">
      {initials(name.replace(/^Demo\s+/, ""))}
      {synthetic && <span className="comp-mark-dot" />}
    </span>
  );
}

export function QualityPill({ status }: { status: string }) {
  const q = qualityLabel[status] ?? { label: status, tone: "pill-gray", help: "" };
  return (
    <span className={`pill ${q.tone}`} title={q.help}>
      {status === "SIMULATED_DEMO" && <FlaskConical size={12} aria-hidden="true" />}
      {q.label}
    </span>
  );
}

export function DemoPill({ dark = false, label = "Synthetic demo" }: { dark?: boolean; label?: string }) {
  return (
    <span className={`pill ${dark ? "pill-demo-dark" : "pill-demo"}`} title="Fictional teams and data generated for demonstration. Not real football information.">
      <FlaskConical size={12} aria-hidden="true" /> {label}
    </span>
  );
}

export function ProbBar({ p, lo, hi, width = 88, tone = "green" }: { p: number | null; lo?: number; hi?: number; width?: number; tone?: "green" | "blue" }) {
  return (
    <span className={`prob-bar prob-${tone}`} style={{ width }} role="img" aria-label={p == null ? "No probability" : `${Math.round(p * 100)} percent`}>
      {lo != null && hi != null && <span className="prob-interval" style={{ left: `${lo * 100}%`, width: `${Math.max((hi - lo) * 100, 1)}%` }} />}
      {p != null && <span className="prob-fill" style={{ width: `${Math.max(p * 100, 1.5)}%` }} />}
    </span>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "demo" | "warn"; children: ReactNode }) {
  const Icon = tone === "demo" ? FlaskConical : tone === "warn" ? AlertTriangle : Info;
  return (
    <div className={`notice notice-${tone}`} role={tone === "warn" ? "alert" : "note"}>
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function LockedValue({ label = "Locked" }: { label?: string }) {
  return (
    <span className="locked-value" aria-label={label}>
      <Lock size={13} aria-hidden="true" /> <span className="locked-blur" aria-hidden="true">00%</span>
    </span>
  );
}

export function Skeleton({ h = 16, w = "100%", r = 8, style }: { h?: number; w?: number | string; r?: number; style?: React.CSSProperties }) {
  return <span className="skel" style={{ display: "block", height: h, width: w, borderRadius: r, ...style }} aria-hidden="true" />;
}

export function ErrorState({ title = "Could not load this", message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertTriangle size={22} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        {message && <p className="muted small">{message}</p>}
      </div>
      {onRetry && (
        <button className="btn btn-outline btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      {children && <div className="muted small">{children}</div>}
    </div>
  );
}
