import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, Search } from "lucide-react";
import { useAuth } from "../app/auth";
import { useApi } from "../lib/api";
import { dateTime, kickoffDate, kickoffTime, pct } from "../lib/format";
import type { FixtureSummary } from "../lib/types";
import { EmptyState, ErrorState, Notice, Skeleton, TeamBadge, teamLabel } from "../components/ui";

interface OverviewMatch extends Omit<FixtureSummary, "featured"> {
  featured: null | { market_id: string; label: string; probability: number | null };
  probabilities: null | { home: number | null; draw: number | null; away: number | null; over_2_5: number | null; btts: number | null; first_half_goal: number | null; home_range: null | [number, number] };
  markets_priced: number;
  limited_reason: string | null;
  has_summary: boolean;
}
interface Overview {
  open_access: boolean;
  generated_at: string;
  matches: OverviewMatch[];
  coverage: Array<{ id: string; name: string; season: string; total: number; played: number }>;
}
interface Evaluation { market_family: string; competition_id: string | null; competition: string | null; sample_n: number; log_loss: number; baseline_log_loss: number }
interface Stats { backtest_run: null | { model_version: string; generated_at: string }; evaluations: Evaluation[] }

const FAMILIES: Array<[string, string]> = [
  ["MATCH_RESULT", "Match result"], ["TOTAL_GOALS_2_5", "Over/under 2.5"], ["BTTS", "Both teams score"], ["FIRST_HALF_GOALS_0_5", "First-half goal"],
];
const ymd = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" });

export default function MatchReport() {
  const { config } = useAuth();
  const ov = useApi<Overview>("/reports/overview", { ttlMs: 60_000 });
  const st = useApi<Stats>("/statistics/models", { ttlMs: 120_000 });
  const [comp, setComp] = useState("all");
  const [fullOnly, setFullOnly] = useState(false);
  const [q, setQ] = useState("");

  const matches = ov.data?.matches ?? [];
  const comps = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const x of matches) m.set(x.competition.id, { name: x.competition.name, n: (m.get(x.competition.id)?.n ?? 0) + 1 });
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [matches]);
  const shown = matches.filter((m) =>
    (comp === "all" || m.competition.id === comp) &&
    (!fullOnly || !m.limited_reason) &&
    (!q || `${m.home.name} ${m.away.name}`.toLowerCase().includes(q.toLowerCase())));
  const days = useMemo(() => {
    const out: Array<{ day: string; items: OverviewMatch[] }> = [];
    for (const m of shown) {
      const d = ymd(m.starts_at_utc);
      if (out.at(-1)?.day !== d) out.push({ day: d, items: [] });
      out.at(-1)!.items.push(m);
    }
    return out;
  }, [shown]);

  if (ov.error) return <div className="container section-tight"><ErrorState message={ov.error.message} onRetry={ov.reload} /></div>;

  const limited = matches.filter((m) => m.limited_reason).length;
  const played = (ov.data?.coverage ?? []).reduce((s, c) => s + c.played, 0);
  const first = matches[0]?.starts_at_utc, last = matches.at(-1)?.starts_at_utc;

  return (
    <div className="container mr-page">
      <div className="page-head">
        <span className="mr-eyebrow">{config?.open_access ? "Testing phase · open to everyone" : "Match report"}</span>
        <h1>Match report{first && last ? `: ${kickoffDate(first, { day: "numeric", month: "short" })} to ${kickoffDate(last, { day: "numeric", month: "short" })}` : ""}</h1>
        <p className="muted">
          Every upcoming match we hold data for, with the model's probabilities for 90-minute outcomes. Kickoffs are in East Africa Time.
        </p>
      </div>

      {!ov.data ? <Skeleton h={90} r={12} /> : (
        <dl className="mr-figures">
          <div><dt>Upcoming matches</dt><dd className="num">{matches.length}</dd></div>
          <div><dt>Full model reports</dt><dd className="num">{matches.length - limited}</dd></div>
          <div><dt>Limited by thin data</dt><dd className="num">{limited}</dd></div>
          <div><dt>Past results on file</dt><dd className="num">{played.toLocaleString("en-GB")}</dd></div>
        </dl>
      )}

      {ov.data && !ov.data.open_access && (
        <div style={{ marginTop: 16 }}><Notice tone="info">Probabilities for each match are part of its full report. Open a match to see the free sample or unlock it.</Notice></div>
      )}

      <section className="mr-section" aria-labelledby="mr-matches">
        <h2 id="mr-matches" className="h-section">Upcoming matches</h2>
        <div className="mr-filters">
          <div className="row-wrap" role="group" aria-label="Competition">
            <button className={`chip ${comp === "all" ? "active" : ""}`} onClick={() => setComp("all")}>All <span className="mr-ct">{matches.length}</span></button>
            {comps.map(([id, c]) => (
              <button key={id} className={`chip ${comp === id ? "active" : ""}`} onClick={() => setComp(id)}>{c.name.replace("UEFA ", "")} <span className="mr-ct">{c.n}</span></button>
            ))}
          </div>
          <div className="mr-filter-row">
            <label className="mr-check" htmlFor="mr-full"><input id="mr-full" type="checkbox" checked={fullOnly} onChange={(e) => setFullOnly(e.target.checked)} /> Full reports only</label>
            <label className="mr-search"><Search size={16} aria-hidden="true" /><input id="mr-q" type="search" placeholder="Find a team" aria-label="Find a team" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          </div>
        </div>
        <div className="mr-legend tiny muted">
          <span><i className="mr-key h" />Home win</span><span><i className="mr-key d" />Draw</span><span><i className="mr-key a" />Away win</span>
          <span>O2.5 = three or more goals · BTTS = both teams score · 1H = a goal before half-time</span>
        </div>

        {!ov.data ? <Skeleton h={420} r={12} /> : shown.length === 0 ? (
          <EmptyState title="No matches for these filters"><p className="muted small">Choose another competition or clear the team search.</p></EmptyState>
        ) : (
          <div className="card mr-list">
            <div className="mr-cols" aria-hidden="true">
              <span>EAT</span><span>Match</span><span>Result: home · draw · away</span><span className="r">O2.5</span><span className="r">BTTS</span><span className="r">1H</span><span>Highlighted market</span><span />
            </div>
            {days.map((d) => (
              <div key={d.day} role="list" aria-label={kickoffDate(d.items[0].starts_at_utc)}>
                <div className="mr-day">{kickoffDate(d.items[0].starts_at_utc, { weekday: "short", day: "numeric", month: "short" })}</div>
                {d.items.map((m) => <MatchRow key={m.id} m={m} />)}
              </div>
            ))}
          </div>
        )}
      </section>

      <ModelRecord stats={st.data} />

      <section className="mr-section" aria-labelledby="mr-cov">
        <h2 id="mr-cov" className="h-section">Data on file</h2>
        <p className="muted small">Results and fixtures held per competition. Bars show how much of the current season has been played.</p>
        <div className="card card-pad mr-cov">
          {coverageRows(ov.data?.coverage ?? []).map((c) => (
            <div key={c.id} className="mr-cov-row">
              <span className="mr-cov-name">{c.name.replace("UEFA ", "")}</span>
              <span className="mr-track" role="img" aria-label={`${c.played} of ${c.total} played`}><i style={{ width: `${c.total ? (c.played / c.total) * 100 : 0}%` }} /></span>
              <span className="tiny muted num">{c.played} of {c.total} played · {c.earlier.toLocaleString("en-GB")} earlier</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mr-section" aria-labelledby="mr-limits">
        <h2 id="mr-limits" className="h-section">What this build does not cover yet</h2>
        <ul className="mr-notes">
          <li><strong>No corners, cards or bookmaker odds.</strong> The free data plans used for testing carry scores only.</li>
          <li><strong>Champions League figures rest on few matches.</strong> Teams with fewer than six recent results get a limited report. We tested borrowing their domestic league form, and it made forecasts worse.</li>
          <li><strong>The model record is a backtest.</strong> It was run after the fact on past rounds. No forecast here has been settled live yet.</li>
        </ul>
        {ov.data && <p className="tiny muted">Updated {dateTime(ov.data.generated_at)}.</p>}
      </section>
    </div>
  );
}

function MatchRow({ m }: { m: OverviewMatch }) {
  const p = m.probabilities;
  const v = (x: number | null | undefined) => (x == null ? "–" : pct(x));
  const strong = (x: number | null | undefined) => (x != null && (x >= 0.65 || x <= 0.35) ? " strong" : "");
  return (
    <Link role="listitem" to={`/matches/${encodeURIComponent(m.id)}`} className="mr-row">
      <span className="mr-time num">{kickoffTime(m.starts_at_utc)}<small className="mr-comp">{m.competition.short_name}</small></span>
      <span className="mr-teams">
        <span><TeamBadge team={m.home} size={22} /> <span title={m.home.name}>{teamLabel(m.home, 22)}</span></span>
        <span><TeamBadge team={m.away} size={22} /> <span title={m.away.name}>{teamLabel(m.away, 22)}</span></span>
      </span>
      {m.limited_reason ? (
        <span className="mr-x12 mr-limited"><span className="pill pill-amber">Limited report</span><small>{m.limited_reason}</small></span>
      ) : p && p.home != null ? (
        <span className="mr-x12">
          <span className="mr-bar" aria-label={`Home ${v(p.home)}, draw ${v(p.draw)}, away ${v(p.away)}`} role="img">
            <i className="h" style={{ flexGrow: p.home }} /><i className="d" style={{ flexGrow: p.draw ?? 0 }} /><i className="a" style={{ flexGrow: p.away ?? 0 }} />
          </span>
          <span className="mr-lab num"><span>H <b>{v(p.home)}</b></span><span>D <b>{v(p.draw)}</b></span><span>A <b>{v(p.away)}</b></span></span>
          {p.home_range && <small className="mr-range num">Home win range {pct(p.home_range[0])} to {pct(p.home_range[1])}</small>}
        </span>
      ) : (
        <span className="mr-x12 tiny muted">In the full report</span>
      )}
      <span className={`mr-p mr-p-o25 num${strong(p?.over_2_5)}`}><small>O2.5</small>{v(p?.over_2_5)}</span>
      <span className={`mr-p mr-p-btts num${strong(p?.btts)}`}><small>BTTS</small>{v(p?.btts)}</span>
      <span className={`mr-p mr-p-ht num${strong(p?.first_half_goal)}`}><small>1H</small>{v(p?.first_half_goal)}</span>
      <span className="mr-lean">
        {m.featured ? <>{m.featured.label}{m.featured.probability != null && <> · {pct(m.featured.probability)}</>}</> : <span className="muted">No highlighted market</span>}
        <small>{m.markets_priced} markets priced{m.has_summary ? " · summary written" : ""}</small>
      </span>
      <ChevronRight size={18} className="mr-go muted" aria-hidden="true" />
    </Link>
  );
}

function ModelRecord({ stats }: { stats?: Stats | null }) {
  const evals = stats?.evaluations ?? [];
  const comps = [...new Map(evals.filter((e) => e.competition_id).map((e) => [e.competition_id!, e.competition ?? e.competition_id!])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const rows: Array<[string | null, string]> = [[null, "All competitions"], ...comps];
  return (
    <section className="mr-section" aria-labelledby="mr-record">
      <h2 id="mr-record" className="h-section">How the model has done</h2>
      <p className="muted small mr-measure">
        A backtest over the most recent completed rounds: each round predicted using only matches played before it, then scored against the result. The comparison is how often the outcome happens in that league. Lower log loss is better; the pill shows the model's improvement on that base rate.
        {stats?.backtest_run && <> Model {stats.backtest_run.model_version}.</>}
      </p>
      {!stats ? <Skeleton h={260} r={12} /> : evals.length === 0 ? <Notice tone="info">No backtest is available yet.</Notice> : (
        <div className="card mr-table-wrap">
          <table className="mr-table">
            <thead><tr><th scope="col">Competition</th>{FAMILIES.map(([, l]) => <th key={l} scope="col">{l}</th>)}</tr></thead>
            <tbody>
              {rows.map(([id, name]) => (
                <tr key={id ?? "all"} className={id == null ? "mr-all" : ""}>
                  <th scope="row">{name.replace("UEFA ", "")}</th>
                  {FAMILIES.map(([f]) => {
                    const e = evals.find((x) => x.competition_id === id && x.market_family === f);
                    if (!e) return <td key={f}>–</td>;
                    const d = ((e.baseline_log_loss - e.log_loss) / e.baseline_log_loss) * 100;
                    const tone = Math.abs(d) < 0.5 ? "flat" : d > 0 ? "up" : "down";
                    return (
                      <td key={f}>
                        <span className={`mr-delta ${tone}`}>{tone === "flat" ? "level" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%`}</span>
                        <span className="mr-vals num">{e.log_loss.toFixed(3)} vs {e.baseline_log_loss.toFixed(3)}</span>
                        <span className="mr-n num">{e.sample_n} matches</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tiny muted"><Link to="/statistics">Calibration charts and full statistics</Link></p>
    </section>
  );
}

function coverageRows(cov: Overview["coverage"]) {
  const by = new Map<string, Overview["coverage"]>();
  for (const c of cov) by.set(c.id, [...(by.get(c.id) ?? []), c]);
  return [...by.values()].map((rs) => {
    const sorted = [...rs].sort((a, b) => b.season.localeCompare(a.season));
    const cur = sorted[0];
    return { id: cur.id, name: cur.name, played: cur.played, total: cur.total, earlier: sorted.slice(1).reduce((s, r) => s + r.played, 0) };
  });
}
