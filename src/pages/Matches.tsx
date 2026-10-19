import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CalendarDays, ChevronLeft, ChevronRight, FileCheck2, Lock, Search, Unlock } from "lucide-react";
import { useAuth } from "../app/auth";
import { useApi } from "../lib/api";
import { addDays, eatYmd, kickoffDate, kickoffTime, pct, statusLabel, ymdLabel } from "../lib/format";
import type { FixtureList, FixtureSummary } from "../lib/types";
import { CompMark, DemoPill, EmptyState, ErrorState, ProbBar, Skeleton, TeamBadge } from "../components/ui";

function useUnlockedSet() {
  const { me } = useAuth();
  const { data } = useApi<{ items: Array<{ fixture_id: string }> }>(me?.user ? "/me/unlocks" : null, { ttlMs: 20_000 });
  return useMemo(() => new Set((data?.items ?? []).map((i) => i.fixture_id)), [data]);
}

export default function Matches() {
  const [sp, setSp] = useSearchParams();
  const today = eatYmd();
  const date = sp.get("date") ?? today;
  const league = sp.get("league") ?? "";
  const status = (sp.get("status") as "all" | "upcoming" | "finished") ?? "all";
  const [q, setQ] = useState(sp.get("q") ?? "");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (sp.get("focus") === "search") searchRef.current?.focus();
  }, [sp]);
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = new URLSearchParams({ status, page_size: "100" });
  if (debounced.length >= 2) query.set("q", debounced);
  else query.set("date", date);
  if (league) query.set("league", league);
  const { data, error, loading, reload } = useApi<FixtureList>(`/fixtures?${query.toString()}`, { ttlMs: 60_000 });
  const comps = useApi<{ items: Array<{ id: string; name: string; short_name: string; is_synthetic: boolean; upcoming: number; completed: number }> }>("/competitions", { ttlMs: 300_000 });
  const unlocked = useUnlockedSet();

  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp);
    if (v == null || v === "") n.delete(k);
    else n.set(k, v);
    n.delete("focus");
    setSp(n, { replace: true });
  };

  const groups = useMemo(() => {
    const m = new Map<string, { comp: FixtureSummary["competition"]; items: FixtureSummary[] }>();
    for (const f of data?.items ?? []) {
      const g = m.get(f.competition.id) ?? { comp: f.competition, items: [] };
      g.items.push(f);
      m.set(f.competition.id, g);
    }
    return [...m.values()];
  }, [data]);

  const days = Array.from({ length: 9 }, (_, i) => addDays(date, i - 4));
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollerRef.current?.querySelector<HTMLElement>(".date-chip.active");
    const sc = scrollerRef.current;
    if (el && sc) sc.scrollLeft = el.offsetLeft - sc.clientWidth / 2 + el.clientWidth / 2;
  }, [date]);

  return (
    <div className="container matches-page">
      <div className="page-head">
        <h1>Matches</h1>
        <p className="muted">Fixtures by day in Uganda time (EAT). Open any match for its free preview and full report.</p>
      </div>

      <div className="match-toolbar card">
        <div className="date-strip" role="tablist" aria-label="Choose date">
          <button className="icon-round" aria-label="Previous days" onClick={() => set("date", addDays(date, -1))}><ChevronLeft size={18} /></button>
          <div className="date-scroller" ref={scrollerRef}>
            {days.map((d) => (
              <button key={d} role="tab" aria-selected={d === date && debounced.length < 2} className={`date-chip ${d === date && debounced.length < 2 ? "active" : ""} ${d === today ? "is-today" : ""}`} onClick={() => { setQ(""); set("date", d === today ? null : d); }}>
                <span className="dc-day">{ymdLabel(d)}</span>
                <span className="dc-date">{d.slice(8)}/{d.slice(5, 7)}</span>
              </button>
            ))}
          </div>
          <button className="icon-round" aria-label="Next days" onClick={() => set("date", addDays(date, 1))}><ChevronRight size={18} /></button>
          <label className="date-pick">
            <CalendarDays size={18} aria-hidden="true" />
            <span className="sr-only">Pick a date</span>
            <input type="date" value={date} onChange={(e) => e.target.value && set("date", e.target.value)} />
          </label>
        </div>
        <div className="filter-row">
          <label className="search-box">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Search teams or competitions</span>
            <input ref={searchRef} className="input" type="search" placeholder="Search team or competition" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select className="select league-select" value={league} onChange={(e) => set("league", e.target.value)} aria-label="Filter by competition">
            <option value="">All competitions</option>
            {(comps.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.is_synthetic ? " (synthetic)" : c.completed === 0 ? " (no data yet)" : ""}</option>
            ))}
          </select>
          <div className="seg" role="group" aria-label="Match status">
            {(["all", "upcoming", "finished"] as const).map((s) => (
              <button key={s} className={`seg-btn ${status === s ? "active" : ""}`} aria-pressed={status === s} onClick={() => set("status", s === "all" ? null : s)}>
                {s === "all" ? "All" : s === "upcoming" ? "Upcoming" : "Finished"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {debounced.length >= 2 && <p className="muted small search-note">Showing results for “{debounced}” within ±30 days.</p>}

      {error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : loading && !data ? (
        <div className="fixture-groups">{Array.from({ length: 2 }, (_, i) => <div key={i} className="card fixture-group"><Skeleton h={22} w="30%" /><Skeleton h={58} style={{ marginTop: 14 }} /><Skeleton h={58} style={{ marginTop: 8 }} /></div>)}</div>
      ) : groups.length === 0 ? (
        <div className="card"><EmptyState icon={<CalendarDays size={28} />} title="No fixtures for this selection">Try another date or clear the filters. Real competitions show fixtures only once the data provider is connected.</EmptyState></div>
      ) : (
        <div className="fixture-groups">
          {groups.map((g) => (
            <section key={g.comp.id} className="card fixture-group" aria-label={g.comp.name}>
              <header className="fg-head">
                <CompMark name={g.comp.name} synthetic={g.comp.is_synthetic} />
                <Link to={`/leagues/${encodeURIComponent(g.comp.id)}`} className="fg-title">{g.comp.name}</Link>
                <span className="muted small">{g.comp.country}</span>
                {g.comp.is_synthetic && <DemoPill />}
                <span className="spacer" />
                <span className="muted small">{g.items.length} match{g.items.length === 1 ? "" : "es"}</span>
              </header>
              <ul className="fixture-list">
                {g.items.map((f) => <FixtureRow key={f.id} f={f} unlocked={unlocked.has(f.id)} showDate={debounced.length >= 2} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function FixtureRow({ f, unlocked, showDate }: { f: FixtureSummary; unlocked: boolean; showDate?: boolean }) {
  const finished = ["FT", "AET", "PEN"].includes(f.status);
  return (
    <li>
      <Link to={`/matches/${encodeURIComponent(f.id)}`} className="fixture-row">
        <span className="fr-time">
          {showDate && <span className="tiny muted">{kickoffDate(f.starts_at_utc)}</span>}
          <span className="num">{kickoffTime(f.starts_at_utc)}</span>
          <span className={`fr-status ${finished ? "ft" : f.display_status === "AWAITING_RESULT" ? "await" : ""}`}>{finished ? "FT" : f.display_status === "AWAITING_RESULT" ? "Awaiting" : statusLabel(f.status) === "Not started" ? "" : statusLabel(f.status)}</span>
        </span>
        <span className="fr-teams">
          <span className="fr-team"><TeamBadge team={f.home} size={24} /> <span>{f.home.name}</span>{finished && <strong className="fr-score num">{f.score.home}</strong>}</span>
          <span className="fr-team"><TeamBadge team={f.away} size={24} /> <span>{f.away.name}</span>{finished && <strong className="fr-score num">{f.score.away}</strong>}</span>
        </span>
        <span className="fr-featured">
          {f.featured ? (
            <>
              <span className="fr-market">{f.featured.short_label}</span>
              <span className="fr-prob"><ProbBar p={f.featured.probability} width={56} /> <span className="num">{pct(f.featured.probability)}</span></span>
            </>
          ) : (
            <span className="tiny muted">{f.report.available ? "Report ready" : "No report yet"}</span>
          )}
        </span>
        <span className="fr-access" title={f.is_public_sample ? "Free sample report" : unlocked ? "Unlocked" : f.report.available ? "Full report: 1 credit" : "No report"}>
          {f.is_public_sample ? <span className="pill pill-green">Free</span> : unlocked ? <Unlock size={18} color="#067a3e" /> : f.report.available ? <Lock size={17} className="muted" /> : null}
        </span>
      </Link>
    </li>
  );
}

/** Match Centre hub: report-ready fixtures for the next 7 days + the user's unlocked reports. */
export function MatchCentreHub() {
  const today = eatYmd();
  const d = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today, i));
  const { me } = useAuth();
  const unlocked = useUnlockedSet();
  const lists = [useApi<FixtureList>(`/fixtures?date=${d[0]}&status=upcoming&page_size=100`), useApi<FixtureList>(`/fixtures?date=${d[1]}&status=upcoming&page_size=100`), useApi<FixtureList>(`/fixtures?date=${d[2]}&status=upcoming&page_size=100`)];
  const mine = useApi<{ items: Array<{ fixture_id: string; home: string; away: string; competition: string; starts_at_utc: string; unlocked_at: string; is_synthetic: boolean }> }>(me?.user ? "/me/unlocks" : null);
  return (
    <div className="container">
      <div className="page-head">
        <h1>Match Centre</h1>
        <p className="muted">Report-ready fixtures for the next three days, plus the reports you have unlocked.</p>
      </div>
      <div className="centre-grid">
        <div className="fixture-groups">
          {lists.map((l, i) => (
            <section key={d[i]} className="card fixture-group">
              <header className="fg-head"><CalendarDays size={18} /><span className="fg-title">{ymdLabel(d[i])}</span><span className="muted small">{kickoffDate(d[i] + "T12:00:00Z")}</span></header>
              {l.loading && !l.data ? <Skeleton h={58} /> : (l.data?.items ?? []).filter((f) => f.report.available).length === 0 ? (
                <p className="muted small" style={{ padding: "8px 4px" }}>No report-ready fixtures.</p>
              ) : (
                <ul className="fixture-list">{(l.data?.items ?? []).filter((f) => f.report.available).map((f) => <FixtureRow key={f.id} f={f} unlocked={unlocked.has(f.id)} />)}</ul>
              )}
            </section>
          ))}
          <Link to="/matches" className="btn btn-outline">Full match calendar</Link>
        </div>
        <aside className="card card-pad centre-side">
          <h2 className="h-card"><FileCheck2 size={18} /> Your unlocked reports</h2>
          {!me?.user ? (
            <p className="muted small">Sign in to see your reports. <Link to="/login" className="link">Login</Link></p>
          ) : (mine.data?.items ?? []).length === 0 ? (
            <p className="muted small">No reports unlocked yet. Each credit unlocks one full match report.</p>
          ) : (
            <ul className="mini-list">
              {mine.data!.items.slice(0, 12).map((u) => (
                <li key={u.fixture_id}><Link to={`/matches/${encodeURIComponent(u.fixture_id)}`}><strong>{u.home}</strong> vs <strong>{u.away}</strong><span className="tiny muted">{u.competition} · {kickoffDate(u.starts_at_utc)}</span></Link></li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
