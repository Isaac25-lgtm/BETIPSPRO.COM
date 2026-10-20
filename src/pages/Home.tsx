import { Link } from "react-router";
import {
  ArrowRight, BarChart3, CalendarDays, Check, ChevronRight, Crown, FileText, Layers, Scale, ShieldCheck, Trophy,
} from "lucide-react";
import { useAuth } from "../app/auth";
import { useApi } from "../lib/api";
import { kickoffTime, longDate, odds, pct, eatYmd } from "../lib/format";
import type { FixtureList, FixtureSummary, Report } from "../lib/types";
import { CompMark, DemoPill, ErrorState, ProbBar, Skeleton, TeamBadge, teamLabel } from "../components/ui";

/**
 * LOCAL-ONLY preview hero cut from the owner's reference screenshot (real players + sponsor logos).
 * Enabled only in `vite dev` with VITE_LOCAL_REFERENCE_HERO=true in .env.local; the images are
 * gitignored and stripped from production builds. Replace with a licensed photo before launch.
 */
const LOCAL_REFERENCE_HERO = import.meta.env.DEV && import.meta.env.VITE_LOCAL_REFERENCE_HERO === "true";

export default function Home() {
  return (
    <div className="home">
      <Hero />
      <div className="container home-grid">
        <div className="home-main">
          <MatchInsightsCard />
          <LeagueTiles />
        </div>
        <aside className="home-side" aria-label="Access and performance">
          <PremiumCard />
          <PerformanceCard />
        </aside>
      </div>
      <ReportShowcase />
      <RecentResults />
      <BetaBand />
      <ResponsibleBand />
    </div>
  );
}

function Hero() {
  const { config } = useAuth();
  return (
    <section className="hero" aria-labelledby="hero-title">
      <picture className={`hero-art ${LOCAL_REFERENCE_HERO ? "hero-art-local" : ""}`}>
        {LOCAL_REFERENCE_HERO ? (
          <>
            <source media="(max-width: 767px)" srcSet="/images/local/hero-mobile-800.webp" />
            <img src="/images/local/hero-desktop-1600.webp" srcSet="/images/local/hero-desktop-1600.webp 1600w, /images/local/hero-desktop-2400.webp 2400w" sizes="100vw" alt="" fetchPriority="high" decoding="async" width={1600} height={415} />
          </>
        ) : (
          <>
            <source media="(max-width: 767px)" srcSet="/images/hero-mobile-800.webp 800w, /images/hero-mobile-1200.webp 1200w" sizes="100vw" />
            <img src="/images/hero-desktop-1600.webp" srcSet="/images/hero-desktop-1600.webp 1600w, /images/hero-desktop-2400.webp 2400w, /images/hero-desktop-3200.webp 3200w" sizes="100vw" alt="" fetchPriority="high" decoding="async" width={1600} height={415} />
          </>
        )}
      </picture>
      <div className="hero-overlay" />
      <div className="container hero-inner">
        <div className="hero-copy">
          {config?.data_mode === "DEMO" && (
            <div className="hero-demo">
              <DemoPill dark label="Demo mode: synthetic data, not live football" />
            </div>
          )}
          <h1 id="hero-title" className="hero-title">
            Smarter Match Insights
            <br />
            for <span className="hl">Informed Choices</span>
          </h1>
          <p className="hero-lede">
            Data-driven football analysis, transparent model probabilities and the real match evidence behind them, all in one place.
          </p>
          <Link to="/matches" className="btn btn-primary hero-cta">
            View Today&apos;s Matches <ArrowRight size={21} strokeWidth={2.6} />
          </Link>
        </div>
        <ul className="feature-strip" aria-label="What you get">
          <li><span className="fs-icon"><BarChart3 size={26} strokeWidth={2.4} /></span><span>Data-Driven<br />Analysis</span></li>
          <li><span className="fs-icon"><ShieldCheck size={26} strokeWidth={2.2} /></span><span>Evidence-Based<br />Insights</span></li>
          <li><span className="fs-icon"><Trophy size={26} strokeWidth={2.2} /></span><span>Major Leagues<br />&amp; Markets</span></li>
          <li><span className="fs-icon"><FileText size={26} strokeWidth={2.2} /></span><span>Full Match<br />Reports</span></li>
        </ul>
      </div>
    </section>
  );
}

function Flame() {
  return (
    <svg width="30" height="32" viewBox="0 0 24 26" aria-hidden="true">
      <defs>
        <linearGradient id="flame" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff9a1f" />
          <stop offset="1" stopColor="#e3201b" />
        </linearGradient>
      </defs>
      <path d="M12.6 1c.6 3.7-1.2 5.9-3 8C7.8 11 6 13 6 16.2 6 20.2 9 23 12.5 23S19 20.4 19 16.6c0-2.4-1-4.3-2.4-5.9-.2 1.7-.9 3-2.2 3.8.5-4.6-.4-9.4-1.8-13.5Z" fill="url(#flame)" />
      <path d="M12.4 13.2c.3 1.8-.6 2.8-1.4 3.7-.7.8-1.3 1.5-1.3 2.7 0 1.6 1.2 2.7 2.7 2.7s2.8-1.1 2.8-2.8c0-1.6-1-2.8-2.8-6.3Z" fill="#ffd25c" />
    </svg>
  );
}

function useTodayBoard() {
  return useApi<FixtureList>(`/fixtures?date=${eatYmd()}&status=all&page_size=50`, { ttlMs: 60_000 });
}

function MatchInsightsCard() {
  const { data, error, loading, reload } = useTodayBoard();
  const rows = (data?.items ?? []).filter((f) => f.featured).sort((a, b) => a.starts_at_utc.localeCompare(b.starts_at_utc)).slice(0, 5);
  const anyDemo = rows.some((r) => r.is_synthetic);
  return (
    <section className="card insights" aria-labelledby="insights-title">
      <header className="insights-head">
        <Flame />
        <h2 id="insights-title">Today&apos;s Match Insights</h2>
        {anyDemo && <DemoPill label="Synthetic" />}
        <span className="spacer" />
        <span className="date-pill"><CalendarDays size={17} aria-hidden="true" /> {longDate(new Date().toISOString())}</span>
        <Link to="/matches" className="link view-all">View All <ArrowRight size={17} /></Link>
      </header>
      {error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : (
        <>
          <div className="insights-table-wrap">
            <table className="insights-table">
              <caption className="sr-only">Today&apos;s fixtures with one featured market each. Featured means the model differs most from the league base rate; it is not a recommendation.</caption>
              <colgroup>
                <col className="c-match" /><col className="c-market" /><col className="c-odds" /><col className="c-prob" /><col className="c-league" /><col className="c-time" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Match</th>
                  <th scope="col" title="The market where the model differs most from the league's historical base rate. Not a recommendation.">Featured Market</th>
                  <th scope="col">Odds</th>
                  <th scope="col">Model Probability</th>
                  <th scope="col">League</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data
                  ? Array.from({ length: 5 }, (_, i) => (
                      <tr key={i} className="skeleton-row">
                        <td colSpan={6}><Skeleton h={22} /></td>
                      </tr>
                    ))
                  : rows.map((f) => <InsightRow key={f.id} f={f} />)}
              </tbody>
            </table>
          </div>
          <ul className="insights-cards" aria-label="Today's fixtures">
            {loading && !data ? Array.from({ length: 3 }, (_, i) => <li key={i}><Skeleton h={88} r={12} /></li>) : rows.map((f) => <InsightCard key={f.id} f={f} />)}
          </ul>
          {!loading && rows.length === 0 && (
            <div className="empty-state">
              <strong>No analysed fixtures today</strong>
              <span className="muted small">Browse upcoming dates in the match calendar.</span>
              <Link className="btn btn-outline btn-sm" to="/matches">Open match calendar</Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function OddsCell({ f }: { f: FixtureSummary }) {
  const o = f.featured?.odds;
  if (!o) return <span className="odds-pill odds-none" title="No licensed price available for this market">n/a</span>;
  return (
    <span className="odds-pill" title={`${o.bookmaker}${o.is_synthetic ? " (synthetic demo price, not a real bookmaker)" : ""}`}>
      {odds(o.decimal)}
    </span>
  );
}

function InsightRow({ f }: { f: FixtureSummary }) {
  const to = `/matches/${encodeURIComponent(f.id)}`;
  return (
    <tr className="insight-row">
      <td>
        <Link to={to} className="match-cell">
          <TeamBadge team={f.home} size={32} />
          <span className="team-name" title={f.home.name}>{teamLabel(f.home)}</span>
          <span className="vs">vs</span>
          <TeamBadge team={f.away} size={32} />
          <span className="team-name" title={f.away.name}>{teamLabel(f.away)}</span>
        </Link>
      </td>
      <td className="market-cell"><Link to={to}>{f.featured?.short_label}</Link></td>
      <td><OddsCell f={f} /></td>
      <td>
        <span className="conf-cell">
          <ProbBar p={f.featured?.probability ?? null} width={80} />
          <span className="num conf-pct">{pct(f.featured?.probability)}</span>
        </span>
      </td>
      <td>
        <span className="league-cell" title={f.competition.name}>
          <CompMark name={f.competition.name} synthetic={f.competition.is_synthetic} />
          <span className="league-name">{f.competition.short_name}</span>
        </span>
      </td>
      <td className="num time-cell">{kickoffTime(f.starts_at_utc)}</td>
    </tr>
  );
}

function InsightCard({ f }: { f: FixtureSummary }) {
  return (
    <li>
      <Link to={`/matches/${encodeURIComponent(f.id)}`} className="insight-card">
        <div className="ic-top">
          <span className="league-cell small"><CompMark name={f.competition.name} synthetic={f.competition.is_synthetic} /> {f.competition.short_name}</span>
          <span className="num ic-time">{kickoffTime(f.starts_at_utc)}</span>
        </div>
        <div className="ic-teams">
          <span><TeamBadge team={f.home} size={26} /> {teamLabel(f.home, 22)}</span>
          <span><TeamBadge team={f.away} size={26} /> {teamLabel(f.away, 22)}</span>
        </div>
        <div className="ic-market">
          <span className="ic-label">{f.featured?.short_label}</span>
          <ProbBar p={f.featured?.probability ?? null} width={64} />
          <span className="num conf-pct">{pct(f.featured?.probability)}</span>
          <OddsCell f={f} />
          <ChevronRight size={18} className="muted" aria-hidden="true" />
        </div>
      </Link>
    </li>
  );
}

const LEAGUES = [
  { id: "apif:39", title: "Premier League Hub", text: "Evidence and model probabilities for EPL matches.", cta: "View EPL Hub", img: "/images/league-premier.webp", Icon: Crown },
  { id: "apif:140", title: "La Liga Hub", text: "Transparent research on Spain's top-flight matches.", cta: "View La Liga Hub", img: "/images/league-liga.webp", Icon: Layers },
  { id: "apif:2", title: "Champions League Hub", text: "Europe's elite club competition, match by match.", cta: "View UCL Hub", img: "/images/league-continental.webp", Icon: Trophy },
];

function LeagueTiles() {
  return (
    <section className="league-tiles" aria-label="League hubs">
      {LEAGUES.map(({ id, title, text, cta, img, Icon }) => (
        <Link
          key={id}
          to={`/leagues/${encodeURIComponent(id)}`}
          className={`league-tile ${LOCAL_REFERENCE_HERO ? "league-tile-local" : ""}`}
          style={{ backgroundImage: `url(${LOCAL_REFERENCE_HERO ? img.replace("/images/", "/images/local/") : img})` }}
        >
          <span className="lt-inner">
            <span className="lt-icon" aria-hidden="true">{!LOCAL_REFERENCE_HERO && <Icon size={46} strokeWidth={1.6} />}</span>
            <span className="lt-body">
              <span className="lt-title">{title}</span>
              <span className="lt-text">{text}</span>
              <span className="lt-cta">{cta} <ArrowRight size={14} /></span>
            </span>
          </span>
        </Link>
      ))}
    </section>
  );
}

function PremiumCard() {
  const { me, config } = useAuth();
  const signedIn = !!me?.user;
  return (
    <section className="premium" aria-labelledby="premium-title">
      <div className="premium-head">
        <span className="crown"><Crown size={26} fill="#f6b51e" color="#f6b51e" /></span>
        <h2 id="premium-title">Full Match Reports<br />for Serious Analysts</h2>
      </div>
      <ul className="premium-list">
        {["Every supported market for the match", "Evidence tables from prior fixtures", "Model uncertainty, not false certainty", "Price comparison where licensed", "No ads, distraction-free"].map((t) => (
          <li key={t}><Check size={18} strokeWidth={3} /> {t}</li>
        ))}
      </ul>
      {signedIn ? (
        <Link to="/matches" className="btn btn-primary premium-cta">Unlock a Report <ArrowRight size={20} /></Link>
      ) : (
        <Link to="/join" className="btn btn-primary premium-cta">Join the Beta <ArrowRight size={20} /></Link>
      )}
      <p className="premium-foot">{config?.payments_enabled ? "" : `Invite-only beta: ${config?.beta_initial_credits ?? 10} free report credits. No payments taken.`}</p>
    </section>
  );
}

function PerformanceCard() {
  const { data } = useApi<{ counts: { verified_live_settled: number | null; live_published: number | null } }>("/statistics/models", { ttlMs: 120_000 });
  const verified = data?.counts?.verified_live_settled ?? 0;
  return (
    <section className="card perf" aria-labelledby="perf-title">
      <div className="perf-head">
        <BarChart3 size={34} color="#02ac4f" strokeWidth={3} aria-hidden="true" />
        <div>
          <h2 id="perf-title">Our Research Performance</h2>
          <p>Verified live record only</p>
        </div>
      </div>
      <div className="perf-kpis">
        <div><strong className="num">{verified}</strong><span>Verified Live Forecasts</span></div>
        <div><strong className="kpi-word">Pending</strong><span>Real-Data Backtest</span></div>
        <div><strong className="kpi-word">In review</strong><span>Calibration</span></div>
      </div>
      <Link to="/statistics" className="perf-link">How we measure accuracy <ChevronRight size={15} /></Link>
    </section>
  );
}

// ---------------------------------------------------------------- lower sections

type ArchiveItem = { id: string; fixture_id: string; market_label: string; probability: number; settled_outcome: number | null; home: string; away: string; home_goals: number | null; away_goals: number | null; starts_at_utc: string; is_pre_kickoff: boolean; is_synthetic: boolean; competition: string };

/** Dark showcase: what a credit unlocks, with a live preview built from the free sample report. */
function ReportShowcase() {
  const board = useTodayBoard();
  const sample = board.data?.items.find((f) => f.is_public_sample);
  const { data: r } = useApi<Report>(sample ? `/fixtures/${encodeURIComponent(sample.id)}/report` : null, { ttlMs: 300_000 });
  const get = (id: string) => r?.markets.find((m) => m.id === id);
  const rows: Array<[string, string]> = [
    ["TOTAL_GOALS_OVER_2_5_REGULATION", "Over 2.5 goals"],
    ["BTTS_YES_REGULATION", "Both teams to score"],
    ["TOTAL_CORNERS_OVER_9_5_REGULATION", "Over 9.5 corners"],
    ["TOTAL_YELLOW_CARDS_OVER_3_5_REGULATION", "Over 3.5 yellow cards"],
  ];
  return (
    <section className="showcase" aria-labelledby="showcase-title">
      <div className="container showcase-grid">
        <div className="showcase-copy">
          <span className="eyebrow eyebrow-dark">Full match report</span>
          <h2 id="showcase-title">Every market. Every number backed by real matches.</h2>
          <ul className="showcase-points">
            <li><Check size={18} strokeWidth={3} /> 50+ markets per match: result, goals, BTTS, corners, cards</li>
            <li><Check size={18} strokeWidth={3} /> The previous fixtures behind every probability</li>
            <li><Check size={18} strokeWidth={3} /> Honest uncertainty ranges, never “sure wins”</li>
          </ul>
          {sample && (
            <Link to={`/matches/${encodeURIComponent(sample.id)}`} className="btn btn-primary btn-lg">
              Open a free sample report <ArrowRight size={18} />
            </Link>
          )}
        </div>
        <div className="report-preview">
          {sample && r ? (
            <>
              <div className="rp-head">
                <span className="rp-team"><TeamBadge team={sample.home} size={34} /> {teamLabel(sample.home, 14)}</span>
                <span className="rp-time num">{kickoffTime(sample.starts_at_utc)}</span>
                <span className="rp-team rp-away">{teamLabel(sample.away, 14)} <TeamBadge team={sample.away} size={34} /></span>
              </div>
              <div className="rp-1x2">
                {(["MATCH_RESULT_HOME_REGULATION", "MATCH_RESULT_DRAW_REGULATION", "MATCH_RESULT_AWAY_REGULATION"] as const).map((id, i) => (
                  <div key={id} className="rp-1x2-cell">
                    <span>{i === 0 ? "Home" : i === 1 ? "Draw" : "Away"}</span>
                    <strong className="num">{pct(get(id)?.probability)}</strong>
                  </div>
                ))}
              </div>
              <ul className="rp-markets">
                {rows.map(([id, label]) => {
                  const m = get(id);
                  return (
                    <li key={id}>
                      <span>{label}</span>
                      <span className="rp-bar"><span style={{ width: `${(m?.probability ?? 0) * 100}%` }} /></span>
                      <strong className="num">{pct(m?.probability)}</strong>
                    </li>
                  );
                })}
              </ul>
              <div className="rp-foot">
                <span>{r.markets.filter((m) => m.probability != null).length} markets · evidence tables · model details</span>
                {sample.is_synthetic && <DemoPill dark label="Synthetic" />}
              </div>
            </>
          ) : (
            <div className="rp-skeleton" />
          )}
        </div>
      </div>
    </section>
  );
}

/** Settled forecasts as result cards (stored immutably, settled after the match). */
function RecentResults() {
  const { data } = useApi<{ items: ArchiveItem[] }>("/predictions/archive?settled=settled&market=TOTAL_GOALS_OVER_2_5_REGULATION", { ttlMs: 120_000 });
  const items = data?.items.slice(0, 4) ?? [];
  const synthetic = items.some((i) => i.is_synthetic);
  const backtest = items.some((i) => !i.is_pre_kickoff);
  return (
    <section className="section results" aria-labelledby="results-title">
      <div className="container">
        <div className="section-head">
          <div className="row-wrap">
            <h2 id="results-title" className="h-section">Recent results vs forecasts</h2>
            {(synthetic || backtest) && <DemoPill label={backtest ? "Synthetic backtest" : "Synthetic"} />}
          </div>
          <Link to="/predictions/archive" className="link">Full forecast archive <ArrowRight size={16} /></Link>
        </div>
        <div className="result-cards">
          {items.length === 0 && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} h={132} r={12} />)}
          {items.map((r) => (
            <Link key={r.id} to={`/matches/${encodeURIComponent(r.fixture_id)}`} className="card result-card">
              <span className="tiny muted">{r.competition} · {longDate(r.starts_at_utc)}</span>
              <span className="rc-match">
                <span>{r.home}</span><strong className="num">{r.home_goals}</strong>
                <span>{r.away}</span><strong className="num">{r.away_goals}</strong>
              </span>
              <span className="rc-foot">
                <span className="small">{r.market_label.replace("Total goals: ", "")} · <strong className="num">{pct(r.probability)}</strong></span>
                {r.settled_outcome === 1 ? <span className="pill pill-green">Happened</span> : <span className="pill pill-gray">Didn&apos;t happen</span>}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function BetaBand() {
  const { me, config } = useAuth();
  if (me?.user) return null;
  return (
    <section className="container beta-band-wrap" aria-label="Join the beta">
      <div className="beta-band">
        <div>
          <strong>Join the invite-only beta</strong>
          <span>{config?.beta_initial_credits ?? 10} free full match reports. No card, no payment.</span>
        </div>
        <Link to="/join" className="btn btn-primary">Get Started <ArrowRight size={18} /></Link>
      </div>
    </section>
  );
}

function ResponsibleBand() {
  return (
    <section className="responsible" aria-label="Responsible use">
      <div className="container responsible-inner">
        <Scale size={22} aria-hidden="true" />
        <p><strong>18+ only. Research, not betting advice.</strong> Probabilities are uncertain and never guarantee a result.</p>
        <Link to="/responsible-use" className="link-light">Responsible use <ArrowRight size={14} /></Link>
      </div>
    </section>
  );
}
