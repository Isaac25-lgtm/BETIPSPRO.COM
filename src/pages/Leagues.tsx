import { Link, useParams } from "react-router";
import { ArrowRight, Database, ShieldAlert } from "lucide-react";
import { useAuth } from "../app/auth";
import { useApi } from "../lib/api";
import { pct } from "../lib/format";
import type { FixtureList } from "../lib/types";
import { CompMark, DemoPill, EmptyState, ErrorState, Notice, Skeleton } from "../components/ui";
import { FixtureRow } from "./Matches";

interface Comp { id: string; name: string; short_name: string; country: string; is_synthetic: boolean; current_season: string | null; upcoming: number; completed: number; reports: number; teams: number; rights_status: string }

export default function Leagues() {
  const { data, error, reload } = useApi<{ items: Comp[] }>("/competitions", { ttlMs: 120_000 });
  const real = (data?.items ?? []).filter((c) => !c.is_synthetic);
  const demo = (data?.items ?? []).filter((c) => c.is_synthetic);
  return (
    <div className="container">
      <div className="page-head">
        <h1>Leagues</h1>
        <p className="muted">Competitions we cover, with what data is actually loaded. Competition names are used descriptively; no official logos are shown.</p>
      </div>
      {error && <ErrorState message={error.message} onRetry={reload} />}
      {!data && !error && <div className="grid-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={120} r={12} />)}</div>}
      {real.length > 0 && (
        <section className="section-tight">
          <h2 className="h-card" style={{ marginBottom: 12 }}>Target competitions (API-Football)</h2>
          <div className="grid-3">{real.map((c) => <LeagueCard key={c.id} c={c} />)}</div>
        </section>
      )}
      {demo.length > 0 && (
        <section className="section-tight">
          <h2 className="h-card" style={{ marginBottom: 12 }}>Synthetic demo competitions</h2>
          <div className="grid-3">{demo.map((c) => <LeagueCard key={c.id} c={c} />)}</div>
        </section>
      )}
    </div>
  );
}

function LeagueCard({ c }: { c: Comp }) {
  return (
    <Link to={`/leagues/${encodeURIComponent(c.id)}`} className="card card-pad league-card">
      <div className="row">
        <CompMark name={c.name} id={c.id} synthetic={c.is_synthetic} />
        <div className="spacer"><strong>{c.name}</strong><div className="tiny muted">{c.country}{c.current_season ? ` · ${c.current_season}` : ""}</div></div>
        {c.is_synthetic ? <DemoPill /> : c.completed > 0 ? <span className="pill pill-green">Data loaded</span> : <span className="pill pill-gray">Awaiting data</span>}
      </div>
      <div className="league-stats">
        <span><strong className="num">{c.upcoming}</strong> upcoming</span>
        <span><strong className="num">{c.completed}</strong> results</span>
        <span><strong className="num">{c.reports}</strong> reports</span>
      </div>
    </Link>
  );
}

export function LeagueDetail() {
  const { id = "" } = useParams();
  const { config } = useAuth();
  const { data, error, reload } = useApi<{ competition: Comp; upcoming_fixture_ids: string[]; standings: Array<{ id: string; name: string; played: number; won: number; drawn: number; lost: number; goals_for: number; goals_against: number; points: number }>; season_stats: { n: number; avg_goals: number | null; btts_rate: number | null; over25_rate: number | null } | null }>(`/competitions/${encodeURIComponent(id)}`, { ttlMs: 120_000 });
  const next = useApi<FixtureList>(data ? `/fixtures?league=${encodeURIComponent(id)}&status=all&date=${config?.today_eat ?? ""}` : null);
  if (error) return <div className="container section-tight"><ErrorState title="Competition not found" message={error.message} onRetry={reload} /></div>;
  if (!data) return <div className="container section-tight"><Skeleton h={40} w="40%" /><Skeleton h={240} r={12} style={{ marginTop: 16 }} /></div>;
  const c = data.competition;
  const s = data.season_stats;
  return (
    <div className="container">
      <div className="page-head">
        <nav className="breadcrumbs"><Link to="/leagues">Leagues</Link><span>/</span><span>{c.name}</span></nav>
        <div className="row"><CompMark name={c.name} id={c.id} synthetic={c.is_synthetic} /><h1>{c.name}</h1>{c.is_synthetic && <DemoPill />}</div>
        <p className="muted">{c.country}{c.current_season ? ` · season ${c.current_season}` : ""}</p>
      </div>
      {!c.is_synthetic && data.standings.length === 0 && (
        <Notice tone="info">
          <strong>No provider data loaded for this competition yet.</strong> Fixtures, results and reports appear here once the API-Football free account is connected and the administrator ingests this league within the daily request budget. Free-plan season access may be restricted; any limitation will be shown here rather than filled with invented data.
        </Notice>
      )}
      {!c.is_synthetic && <div style={{ marginTop: 12 }}><Notice tone="warn"><ShieldAlert size={14} style={{ display: "inline" }} /> Publishing rights for this competition&apos;s data in a paid product are under review. Public commercial release is blocked until confirmed.</Notice></div>}
      {data.standings.length > 0 && (
        <div className="league-detail-grid">
          <section className="card card-pad">
            <h2 className="h-card">Table ({c.current_season})</h2>
            <div className="table-scroll"><table className="dtable">
              <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>Pts</th></tr></thead>
              <tbody>{data.standings.map((t, i) => <tr key={t.id}><td>{i + 1}</td><td><strong>{t.name}</strong></td><td className="num">{t.played}</td><td className="num">{t.won}</td><td className="num">{t.drawn}</td><td className="num">{t.lost}</td><td className="num">{t.goals_for}</td><td className="num">{t.goals_against}</td><td className="num"><strong>{t.points}</strong></td></tr>)}</tbody>
            </table></div>
            <p className="tiny muted">Computed from stored results (regulation-time scores).</p>
          </section>
          <aside className="stack">
            <section className="card card-pad">
              <h2 className="h-card">Season profile</h2>
              <dl className="driver-list">
                <div><dt>Matches played</dt><dd className="num">{s?.n ?? 0}</dd></div>
                <div><dt>Avg goals / match</dt><dd className="num">{s?.avg_goals?.toFixed(2) ?? "-"}</dd></div>
                <div><dt>Over 2.5 rate</dt><dd className="num">{pct(s?.over25_rate)}</dd></div>
                <div><dt>BTTS rate</dt><dd className="num">{pct(s?.btts_rate)}</dd></div>
              </dl>
            </section>
            <Link to={`/matches?league=${encodeURIComponent(c.id)}`} className="btn btn-dark btn-block">All fixtures <ArrowRight size={16} /></Link>
          </aside>
        </div>
      )}
      <section className="section-tight">
        <h2 className="h-card" style={{ marginBottom: 12 }}>Today</h2>
        {(next.data?.items ?? []).length === 0 ? (
          <div className="card"><EmptyState icon={<Database size={26} />} title="No fixtures today in this competition"><Link className="link" to={`/matches?league=${encodeURIComponent(c.id)}`}>Browse other dates</Link></EmptyState></div>
        ) : (
          <div className="card fixture-group"><ul className="fixture-list">{next.data!.items.map((f) => <FixtureRow key={f.id} f={f} unlocked={false} />)}</ul></div>
        )}
      </section>
    </div>
  );
}
