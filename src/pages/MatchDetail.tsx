import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowRight, Bookmark, BookmarkCheck, ChevronRight, Copy, FileText, Info, Lock, MapPin, Printer, ShieldCheck, Unlock, User } from "lucide-react";
import { useAuth } from "../app/auth";
import { api, ApiError, idempotencyKey, invalidate, useApi } from "../lib/api";
import { dateTime, kickoffTime, longDate, metricLabels, odds, pct, statusLabel, utcTime } from "../lib/format";
import type { FormEntry, Preview, Report, ReportMarket } from "../lib/types";
import { DemoPill, ErrorState, LockedValue, Notice, ProbBar, QualityPill, Skeleton, TeamBadge, teamLabel } from "../components/ui";
import { BaseRateComparison, FormStrip, FormTimeline, PmfBars, ScorelineHeatmap, TotalGoalsChart } from "../components/charts";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "markets", label: "Markets" },
  { id: "goals", label: "Goals" },
  { id: "corners", label: "Corners" },
  { id: "cards", label: "Cards" },
  { id: "form", label: "Form & H2H" },
  { id: "odds", label: "Odds" },
  { id: "model", label: "Model & Evidence" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function MatchDetail() {
  const { id = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as TabId) || "overview";
  const { me, config } = useAuth();
  const preview = useApi<Preview>(`/fixtures/${encodeURIComponent(id)}/preview`, { ttlMs: 60_000 });
  const fx = preview.data?.fixture;
  const canTry = !!fx?.report.available && (fx.is_public_sample || !!me?.user || !!config?.open_access);
  const report = useApi<Report>(canTry ? `/fixtures/${encodeURIComponent(id)}/report` : null, { ttlMs: 120_000 });
  const locked = !report.data;
  const [unlockNote, setUnlockNote] = useState<string | null>(null);
  const lockReason = report.error?.code;

  if (preview.error) return <div className="container section-tight"><ErrorState title={preview.error.status === 404 ? "Match not found" : "Could not load this match"} message={preview.error.message} onRetry={preview.reload} /></div>;
  if (!preview.data || !fx) return <MatchSkeleton />;

  const setTab = (t: TabId) => {
    const n = new URLSearchParams(sp);
    if (t === "overview") n.delete("tab");
    else n.set("tab", t);
    setSp(n, { replace: true });
  };

  return (
    <div className="match-page">
      <MatchHeader p={preview.data} />
      <div className="match-tabs-bar">
        <div className="container">
          <div className="match-tabs" role="tablist" aria-label="Match sections">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`mtab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
                {locked && t.id !== "overview" && t.id !== "form" && <Lock size={12} aria-label="locked" />}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="container match-body">
        {unlockNote && <p className="form-ok unlock-note" role="status">{unlockNote}</p>}
        {report.loading && canTry && !report.data ? (
          <div className="card card-pad"><Skeleton h={22} w="40%" /><Skeleton h={160} style={{ marginTop: 14 }} /></div>
        ) : locked ? (
          <LockedView p={preview.data} tab={tab} reason={lockReason} onUnlocked={(note) => { setUnlockNote(note); report.reload(); }} />
        ) : (
          <ReportView p={preview.data} r={report.data!} tab={tab} setTab={setTab} />
        )}
      </div>
    </div>
  );
}

function MatchSkeleton() {
  return (
    <div className="match-page" aria-busy="true">
      <div className="match-header"><div className="container"><Skeleton h={90} r={12} style={{ opacity: .15 }} /></div></div>
      <div className="container match-body"><Skeleton h={300} r={12} /></div>
    </div>
  );
}

function MatchHeader({ p }: { p: Preview }) {
  const f = p.fixture;
  const finished = ["FT", "AET", "PEN"].includes(f.status);
  const { me } = useAuth();
  const saved = useApi<{ items: Array<{ fixture_id: string }> }>(me?.user ? "/me/saved" : null);
  const isSaved = !!saved.data?.items.some((s) => s.fixture_id === f.id);
  const toggleSave = async () => {
    await api(`/me/saved/${encodeURIComponent(f.id)}`, { method: isSaved ? "DELETE" : "POST" });
    invalidate("/me/saved");
  };
  return (
    <header className="match-header">
      <div className="container">
        <div className="mh-meta">
          <Link to={`/leagues/${encodeURIComponent(f.competition.id)}`} className="mh-comp">{f.competition.name}</Link>
          <span>· {f.round}</span>
          {f.is_synthetic && <DemoPill dark />}
          <span className="spacer" />
          {me?.user && (
            <button className="icon-btn" onClick={() => void toggleSave()} aria-pressed={isSaved} aria-label={isSaved ? "Remove from saved" : "Save match"}>
              {isSaved ? <BookmarkCheck size={20} color="#1df992" /> : <Bookmark size={20} />}
            </button>
          )}
        </div>
        <div className="mh-main">
          <div className="mh-team"><TeamBadge team={f.home} size={52} /><span>{f.home.name}</span></div>
          <div className="mh-center">
            {finished ? (
              <span className="mh-score num">{f.score.home} - {f.score.away}</span>
            ) : (
              <span className="mh-time num">{kickoffTime(f.starts_at_utc)}</span>
            )}
            <span className="mh-date">{longDate(f.starts_at_utc)} · EAT</span>
            <span className={`mh-status ${f.display_status === "AWAITING_RESULT" ? "await" : ""}`}>{statusLabel(f.display_status)}</span>
          </div>
          <div className="mh-team"><TeamBadge team={f.away} size={52} /><span>{f.away.name}</span></div>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- locked / free preview

function UnlockCard({ p, reason, onUnlocked }: { p: Preview; reason?: string; onUnlocked: (note: string) => void }) {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [key] = useState(idempotencyKey);
  const f = p.fixture;
  const modelled = p.markets.filter((m) => !["NOT_MODELLED", "NO_REPORT", "INSUFFICIENT"].includes(m.status)).length;

  if (!f.report.available) {
    return (
      <div className="card unlock-card">
        <FileText size={28} />
        <h2 className="h-card">No report prepared for this match yet</h2>
        <p className="muted small">Reports are generated only when enough verified data exists. Nothing can be unlocked, and no credit is used.</p>
      </div>
    );
  }
  const unlock = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ charged: boolean; balance: number; free_reason?: string }>(`/fixtures/${encodeURIComponent(f.id)}/unlock`, { method: "POST", headers: { "Idempotency-Key": key } });
      const note = r.charged ? `Report unlocked. 1 credit used, ${r.balance} left.` : "Already unlocked. No credit used.";
      setMsg({ tone: "ok", text: note });
      invalidate(`/fixtures/${encodeURIComponent(f.id)}`);
      invalidate("/me");
      refresh();
      onUnlocked(note);
    } catch (e) {
      const err = e as ApiError;
      setMsg({ tone: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card unlock-card">
      <span className="unlock-icon"><Lock size={22} /></span>
      <h2 className="h-card">Unlock the full match report</h2>
      <p className="muted small">One credit unlocks <strong>this match</strong>: all {modelled} modelled markets, every evidence table, distributions, model details and future refreshes of this report. Reopening it or switching markets never costs another credit.</p>
      {!me?.user ? (
        <div className="row-wrap">
          <button className="btn btn-primary" onClick={() => nav(`/login?next=${encodeURIComponent(location.pathname)}`)}>Login to unlock</button>
          <Link to="/join" className="btn btn-outline">Join the beta</Link>
        </div>
      ) : (
        <>
          <div className="row-wrap">
            <button className="btn btn-primary" disabled={busy || (me.credits ?? 0) < 1} onClick={() => void unlock()}>
              <Unlock size={18} /> {busy ? "Unlocking..." : "Unlock report · 1 credit"}
            </button>
            <span className="small muted">Balance: <strong className="num">{me.credits ?? 0}</strong> credits</span>
          </div>
          {(me.credits ?? 0) < 1 && <p className="small form-error">You have no credits left. During the beta, ask the administrator if you need more. No payments are taken.</p>}
        </>
      )}
      {msg && <p className={msg.tone === "ok" ? "form-ok" : "form-error"} role="status">{msg.text}</p>}
      {reason === "REPORT_LOCKED" && !msg && <p className="tiny muted">You have not unlocked this match yet.</p>}
    </div>
  );
}

function LockedView({ p, tab, reason, onUnlocked }: { p: Preview; tab: TabId; reason?: string; onUnlocked: (note: string) => void }) {
  const f = p.fixture;
  return (
    <div className="match-grid">
      <div className="match-col">
        {(tab === "overview" || tab === "markets") && (
          <section className="card card-pad">
            <h2 className="h-card">Free preview</h2>
            {f.featured ? (
              <div className="featured-box">
                <div>
                  <span className="tiny muted">Featured market (public sample)</span>
                  <strong className="fb-label">{f.featured.label}</strong>
                  <span className="tiny muted">{p.report?.featured_base_rate != null ? `League base rate ${pct(p.report.featured_base_rate)}` : ""}</span>
                </div>
                <div className="fb-prob"><span className="num">{pct(f.featured.probability)}</span><ProbBar p={f.featured.probability} width={120} /></div>
              </div>
            ) : <p className="muted small">No featured market for this match.</p>}
            <MarketList markets={p.markets.map((m) => ({ ...m, probability: null, price: null, uncertainty: null, quality_reason: null, family: "", settlement_period: "", model_version: null, generated_at: null }))} fixtureId={f.id} locked />
          </section>
        )}
        {tab === "form" && <FormSection home={f.home.name} away={f.away.name} form={p.form} />}
        {!["overview", "markets", "form"].includes(tab) && (
          <section className="card card-pad locked-section">
            <Lock size={24} />
            <h2 className="h-card">This section is part of the full report</h2>
            <p className="muted small">Unlock the match to see distributions, evidence tables, prices and model details. All sections and markets are included for one credit.</p>
          </section>
        )}
      </div>
      <aside className="match-side">
        <UnlockCard p={p} reason={reason} onUnlocked={onUnlocked} />
        <FixtureFacts p={p} />
        {tab === "overview" && <FormSection home={f.home.name} away={f.away.name} form={p.form} compact />}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- full report

const BASE_MARKETS: Array<[string, string]> = [
  ["MATCH_RESULT_HOME_REGULATION", "Home win"], ["MATCH_RESULT_DRAW_REGULATION", "Draw"], ["MATCH_RESULT_AWAY_REGULATION", "Away win"],
  ["TOTAL_GOALS_OVER_1_5_REGULATION", "Over 1.5 goals"], ["TOTAL_GOALS_OVER_2_5_REGULATION", "Over 2.5 goals"], ["TOTAL_GOALS_OVER_3_5_REGULATION", "Over 3.5 goals"],
  ["BTTS_YES_REGULATION", "Both teams score"], ["FIRST_HALF_GOALS_OVER_0_5", "Goal before half-time"],
];

function baseRows(r: Report) {
  const base = r.summary.baselines ?? {};
  const by = new Map(r.markets.map((m) => [m.id, m.probability]));
  return BASE_MARKETS.flatMap(([id, label]) => {
    const model = by.get(id), b = base[id];
    return model != null && b != null ? [{ label, model, base: b }] : [];
  });
}

function ReportView({ p, r, tab, setTab }: { p: Preview; r: Report; tab: TabId; setTab: (t: TabId) => void }) {
  const f = p.fixture;
  const by = useMemo(() => new Map(r.markets.map((m) => [m.id, m])), [r]);
  const get = (id: string) => by.get(id);
  const supported = r.markets.filter((m) => m.probability != null).length;
  return (
    <div className="match-grid">
      <div className="match-col">
        {r.access === "sample" && <p className="sample-note"><Info size={15} aria-hidden="true" /> Free sample report: every section is open, exactly as a credit unlocks it.</p>}
        {tab === "overview" && (
          <>
            <section className="card card-pad">
              <div className="row-wrap" style={{ justifyContent: "space-between" }}>
                <h2 className="h-card">Probability summary</h2>
                <span className="tiny muted">{supported} of {r.markets.length} markets have a published probability</span>
              </div>
              <div className="x12">
                {(["MATCH_RESULT_HOME_REGULATION", "MATCH_RESULT_DRAW_REGULATION", "MATCH_RESULT_AWAY_REGULATION"] as const).map((id, i) => {
                  const m = get(id);
                  return (
                    <Link key={id} to={`/matches/${encodeURIComponent(f.id)}/markets/${id}`} className="x12-cell">
                      <span className="x12-k">{i === 0 ? teamLabel(f.home, 12) : i === 1 ? "Draw" : teamLabel(f.away, 12)}</span>
                      <span className="x12-v num">{pct(m?.probability)}</span>
                      <ProbBar p={m?.probability ?? null} lo={m?.uncertainty?.p05} hi={m?.uncertainty?.p95} width={140} />
                      <span className="tiny muted">90% range {pct(m?.uncertainty?.p05)}–{pct(m?.uncertainty?.p95)}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
            {baseRows(r).length > 0 && (
              <section className="card card-pad"><BaseRateComparison rows={baseRows(r)} title="Model vs league average" /></section>
            )}
            <section className="card card-pad">
              <h2 className="h-card">Key markets</h2>
              <MarketList markets={["TOTAL_GOALS_OVER_2_5_REGULATION", "TOTAL_GOALS_UNDER_2_5_REGULATION", "BTTS_YES_REGULATION", "DOUBLE_CHANCE_HOME_DRAW_REGULATION", "TOTAL_CORNERS_OVER_9_5_REGULATION", "TOTAL_YELLOW_CARDS_OVER_3_5_REGULATION"].map(get).filter(Boolean) as ReportMarket[]} fixtureId={f.id} />
              <button className="btn btn-outline btn-sm" onClick={() => setTab("markets")}>All markets <ArrowRight size={15} /></button>
            </section>
          </>
        )}
        {tab === "markets" && (
          <section className="card card-pad">
            <h2 className="h-card">All markets</h2>
            <p className="muted small">Choose any market to open its evidence.</p>
            {groupByCategory(r.markets).map(([cat, ms]) => (
              <div key={cat} className="market-cat">
                <h3>{cat}</h3>
                <MarketList markets={ms} fixtureId={f.id} />
              </div>
            ))}
            <Unsupported list={r.unsupported} />
          </section>
        )}
        {tab === "goals" && (
          <>
            {r.analysis.scoreline_matrix && <section className="card card-pad"><ScorelineHeatmap matrix={r.analysis.scoreline_matrix} home={f.home.name} away={f.away.name} title="Scoreline distribution (model)" /></section>}
            {r.analysis.scoreline_matrix && <section className="card card-pad"><TotalGoalsChart matrix={r.analysis.scoreline_matrix} title="Total goals in the match (model)" /></section>}
            <section className="card card-pad">
              <h2 className="h-card">Goal thresholds</h2>
              <MarketList markets={r.markets.filter((m) => ["TOTAL_GOALS", "BTTS", "TEAM_GOALS"].includes(m.family))} fixtureId={f.id} />
            </section>
            <Drivers r={r} family="goals_dixon_coles" title="Goal model drivers" />
            {r.analysis.ht_matrix && <section className="card card-pad"><ScorelineHeatmap matrix={r.analysis.ht_matrix} home={f.home.name} away={f.away.name} title="First-half score distribution (separate model)" /><MarketList markets={r.markets.filter((m) => m.category === "First Half")} fixtureId={f.id} /></section>}
          </>
        )}
        {tab === "corners" && (
          <>
            {r.analysis.corners_total_pmf ? <section className="card card-pad"><PmfBars values={r.analysis.corners_total_pmf} threshold={9.5} statLabel="corners" title="Total corners distribution (model)" /></section> : <Notice tone="warn">Corner data is insufficient for this fixture, so no corner probabilities are published.</Notice>}
            <section className="card card-pad"><h2 className="h-card">Corner markets</h2><MarketList markets={r.markets.filter((m) => m.category === "Corners")} fixtureId={f.id} /></section>
            <Drivers r={r} family="corners_negative_binomial" title="Corner model drivers" />
          </>
        )}
        {tab === "cards" && (
          <>
            {r.analysis.cards_total_pmf ? <section className="card card-pad"><PmfBars values={r.analysis.cards_total_pmf} threshold={3.5} statLabel="yellow cards" title="Total yellow cards distribution (model)" /></section> : <Notice tone="warn">Card data is insufficient for this fixture.</Notice>}
            <section className="card card-pad"><h2 className="h-card">Card markets</h2><MarketList markets={r.markets.filter((m) => m.category === "Cards")} fixtureId={f.id} />
              <p className="tiny muted">Raw yellow-card counts, not booking points.</p></section>
            <Drivers r={r} family="cards_negative_binomial" title="Card model drivers" />
          </>
        )}
        {tab === "form" && (
          <>
            {(r.form.home.length > 0 || r.form.away.length > 0) && <section className="card card-pad"><FormTimeline home={f.home.name} away={f.away.name} form={r.form} /></section>}
            <FormSection home={f.home.name} away={f.away.name} form={r.form} />
            <section className="card card-pad">
              <h2 className="h-card">Head-to-head</h2>
              {r.head_to_head.length === 0 ? <p className="muted small">No previous meetings in the available data.</p> : (
                <div className="table-scroll"><table className="dtable"><thead><tr><th>Date</th><th>Competition</th><th>Match</th><th>FT</th><th>HT</th></tr></thead>
                  <tbody>{r.head_to_head.map((h) => <tr key={h.fixture_id}><td>{longDate(h.date)}</td><td>{h.competition}</td><td>{h.home} vs {h.away}</td><td className="num"><strong>{h.score}</strong></td><td className="num">{h.ht_score ?? "-"}</td></tr>)}</tbody></table></div>
              )}
            </section>
          </>
        )}
        {tab === "odds" && <OddsSection r={r} fixtureId={f.id} />}
        {tab === "model" && <ModelSection r={r} />}
      </div>
      <aside className="match-side">
        <ReportActions r={r} p={p} />
        <FixtureFacts p={p} r={r} />
      </aside>
    </div>
  );
}

function groupByCategory(ms: ReportMarket[]): Array<[string, ReportMarket[]]> {
  const m = new Map<string, ReportMarket[]>();
  for (const x of ms) m.set(x.category, [...(m.get(x.category) ?? []), x]);
  return [...m.entries()];
}

export function MarketList({ markets, fixtureId, locked }: { markets: ReportMarket[]; fixtureId: string; locked?: boolean }) {
  return (
    <ul className="market-list">
      {markets.map((m) => {
        const inner = (
          <>
            <span className="ml-label">{m.label.replace(/^[^:]+: /, "")}<span className="tiny muted ml-cat">{m.category}{m.tier !== "A" ? ` · Tier ${m.tier}` : ""}</span></span>
            {locked ? (
              <LockedValue />
            ) : m.probability == null ? (
              <span className="ml-insufficient" title={m.quality_reason ?? ""}>No probability</span>
            ) : (
              <span className="ml-prob">
                <ProbBar p={m.probability} lo={m.uncertainty?.p05} hi={m.uncertainty?.p95} width={96} />
                <strong className="num">{pct(m.probability)}</strong>
              </span>
            )}
            {!locked && <span className="ml-price num" title={m.price ? `${m.price.bookmaker}${m.price.is_synthetic ? " (synthetic)" : ""}` : "No licensed price"}>{m.price ? odds(m.price.decimal) : ""}</span>}
            {m.status === "SIMULATED_DEMO" ? <span className="ml-pill-spacer" /> : <QualityPill status={m.status} />}
            {!locked && <ChevronRight size={18} className="muted" aria-hidden="true" />}
          </>
        );
        return (
          <li key={m.id}>
            {locked ? <div className="market-row locked">{inner}</div> : <Link to={`/matches/${encodeURIComponent(fixtureId)}/markets/${m.id}`} className="market-row">{inner}</Link>}
          </li>
        );
      })}
    </ul>
  );
}

function Unsupported({ list }: { list: Array<{ family: string; reason: string }> }) {
  return (
    <details className="unsupported">
      <summary>Markets we do not publish yet ({list.length})</summary>
      <ul>{list.map((u) => <li key={u.family}><strong>{u.family.replace(/_/g, " ").toLowerCase()}</strong>: {u.reason}</li>)}</ul>
    </details>
  );
}

function FormSection({ home, away, form, compact }: { home: string; away: string; form: { home: FormEntry[]; away: FormEntry[] }; compact?: boolean }) {
  const block = (name: string, rows: FormEntry[]) => (
    <div className="form-block">
      <div className="row" style={{ justifyContent: "space-between" }}><strong>{name}</strong><FormStrip results={rows.slice(0, 5).map((r) => r.result)} /></div>
      {!compact && (
        <div className="table-scroll"><table className="dtable"><thead><tr><th>Date</th><th>Venue</th><th>Opponent</th><th>Score</th><th>Result</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.fixture_id}><td>{longDate(r.starts_at_utc)}</td><td>{r.venue === "H" ? "Home" : "Away"}</td><td>{r.opponent}</td><td className="num">{r.goals_for}-{r.goals_against}</td><td><span className={`form-chip form-${r.result}`}>{r.result}</span></td></tr>)}</tbody></table></div>
      )}
    </div>
  );
  return (
    <section className={`card card-pad ${compact ? "form-compact" : ""}`}>
      <h2 className="h-card">Recent form</h2>
      {block(home, form.home)}
      {block(away, form.away)}
      <p className="tiny muted">Last {compact ? 5 : form.home.length} completed matches before kick-off, all competitions in the dataset.</p>
    </section>
  );
}

function FixtureFacts({ p, r }: { p: Preview; r?: Report }) {
  const f = p.fixture;
  return (
    <section className="card card-pad facts">
      <h2 className="h-card">Match facts</h2>
      <dl>
        <dt>Kick-off</dt><dd>{dateTime(f.starts_at_utc)}<span className="tiny muted"> ({utcTime(f.starts_at_utc)}{f.kickoff_confirmed ? "" : ", tentative"})</span></dd>
        {f.venue && <><dt><MapPin size={14} /> Venue</dt><dd>{f.venue.name}</dd></>}
        {f.referee && <><dt><User size={14} /> Referee</dt><dd>{f.referee.name} <span className="tiny muted">(not confirmed)</span></dd></>}
        <dt>Source</dt><dd>{f.provider === "demo" ? "Synthetic demo generator" : f.provider}{f.provider_last_updated ? <span className="tiny muted"> · updated {dateTime(f.provider_last_updated)}</span> : null}</dd>
        {p.report && <><dt>Report</dt><dd>Generated {dateTime(p.report.generated_at)}<br /><span className="tiny muted">Data as of {dateTime(p.report.data_as_of_at)}</span></dd></>}
        {r?.model_run && <><dt>Model</dt><dd>{r.model_run.model_version} <span className="tiny muted">({r.model_run.data_mode})</span></dd></>}
      </dl>
    </section>
  );
}

function ReportActions({ r, p }: { r: Report; p: Preview }) {
  const [copied, setCopied] = useState(false);
  const cite = `${p.fixture.home.name} vs ${p.fixture.away.name}, ${longDate(p.fixture.starts_at_utc)}. Report ${r.report_version}, generated ${r.generated_at}. ${location.origin}/matches/${encodeURIComponent(p.fixture.id)}`;
  return (
    <section className="card card-pad actions-card">
      <div className="row"><ShieldCheck size={20} color="#067a3e" /><strong>{r.access === "sample" ? "Free sample report" : r.access === "admin" ? "Admin view" : r.access === "open" ? "Open report (testing phase)" : "Unlocked report"}</strong></div>
      <div className="row-wrap">
        <button className="btn btn-outline btn-sm" onClick={() => { void navigator.clipboard?.writeText(cite); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Copy size={15} /> {copied ? "Copied" : "Copy citation"}</button>
        <button className="btn btn-outline btn-sm" onClick={() => window.print()}><Printer size={15} /> Print summary</button>
      </div>
    </section>
  );
}

function Drivers({ r, family, title }: { r: Report; family: string; title: string }) {
  const d = r.drivers[family];
  if (!d?.length) return null;
  return (
    <section className="card card-pad">
      <h2 className="h-card">{title}</h2>
      <dl className="driver-grid">
        {d.map((x) => <div key={x.metric}><dt>{metricLabels[x.metric] ?? x.metric}</dt><dd className="num">{x.value == null ? "-" : Number.isInteger(x.value) ? x.value : x.value.toFixed(3)}</dd></div>)}
      </dl>
    </section>
  );
}

function OddsSection({ r, fixtureId }: { r: Report; fixtureId: string }) {
  const priced = r.markets.filter((m) => m.price);
  const synthetic = priced.some((m) => m.price?.is_synthetic);
  return (
    <section className="card card-pad">
      <h2 className="h-card">Prices vs model</h2>
      {synthetic && <Notice tone="demo">These prices come from a <strong>synthetic demo book</strong>, not a real bookmaker. They exist only to demonstrate the comparison panel.</Notice>}
      {priced.length === 0 ? (
        <p className="muted small">No price data for this match.</p>
      ) : (
        <div className="table-scroll">
          <table className="dtable">
            <thead><tr><th>Market</th><th>Bookmaker</th><th>Decimal</th><th>Implied (1/odds)</th><th>Model</th><th></th></tr></thead>
            <tbody>
              {priced.map((m) => (
                <tr key={m.id}>
                  <td><Link className="link" to={`/matches/${encodeURIComponent(fixtureId)}/markets/${m.id}`}>{m.label}</Link></td>
                  <td>{m.price!.bookmaker}</td>
                  <td className="num">{odds(m.price!.decimal)}{m.price!.stale && <span className="pill pill-amber" style={{ marginLeft: 6 }}>stale</span>}</td>
                  <td className="num">{pct(m.price!.implied_probability, 1)}</td>
                  <td className="num">{pct(m.probability, 1)}</td>
                  <td><ChevronRight size={16} className="muted" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ModelSection({ r }: { r: Report }) {
  const m = r.model_run;
  return (
    <>
      <section className="card card-pad">
        <h2 className="h-card">Model run & provenance</h2>
        {m && (
          <dl className="driver-grid">
            <div><dt>Model version</dt><dd>{m.model_version}</dd></div>
            <div><dt>Pipeline</dt><dd>{m.pipeline_version}</dd></div>
            <div><dt>Data mode</dt><dd>{m.data_mode}</dd></div>
            <div><dt>Generated</dt><dd>{dateTime(m.generated_at)}</dd></div>
            <div><dt>Data as of</dt><dd>{dateTime(m.data_as_of_at)}</dd></div>
            <div><dt>Market catalogue</dt><dd>{m.market_catalog_version}</dd></div>
            <div className="wide"><dt>Dataset hash</dt><dd className="mono">{m.dataset_hash}</dd></div>
            <div className="wide"><dt>Report version</dt><dd className="mono">{r.report_version}</dd></div>
          </dl>
        )}
      </section>
      <section className="card card-pad">
        <h2 className="h-card">Data coverage</h2>
        <ul className="coverage-list">
          {Object.entries(r.coverage).map(([k, v]) => (
            <li key={k}><span>{k.replace(/_/g, " ")}</span><span className={`pill ${v === "available" ? "pill-green" : v.includes("synthetic") ? "pill-demo" : "pill-gray"}`}>{v.replace(/_/g, " ")}</span></li>
          ))}
        </ul>
      </section>
      <section className="card card-pad">
        <h2 className="h-card">Evidence quality labels</h2>
        <ul className="quality-legend">
          {["VERIFIED", "PARTIAL", "INSUFFICIENT", "STALE", "SIMULATED_DEMO"].map((s) => <li key={s}><QualityPill status={s} /></li>)}
        </ul>
        <Unsupported list={r.unsupported} />
      </section>
    </>
  );
}
