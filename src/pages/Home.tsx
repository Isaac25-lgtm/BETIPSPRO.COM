import { Link } from "react-router";
import {
  ArrowRight, BarChart3, BookOpenCheck, CalendarDays, Check, ChevronRight, Crown, Database, FileSearch, Gauge, Layers, LineChart, Scale, ShieldCheck, Sigma, Trophy, Zap,
} from "lucide-react";
import { useAuth } from "../app/auth";
import { useApi } from "../lib/api";
import { kickoffTime, longDate, odds, pct, eatYmd } from "../lib/format";
import type { FixtureList, FixtureSummary } from "../lib/types";
import { CompMark, DemoPill, ErrorState, ProbBar, Skeleton, TeamBadge } from "../components/ui";

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
      <ArchivePreview />
      <HowItWorks />
      <SampleAnalysis />
      <Coverage />
      <BetaPricing />
      <ResponsibleBand />
    </div>
  );
}

function Hero() {
  const { config } = useAuth();
  return (
    <section className="hero" aria-labelledby="hero-title">
      <picture className="hero-art">
        <source media="(max-width: 767px)" srcSet="/images/hero-mobile-800.webp 800w, /images/hero-mobile-1200.webp 1200w" sizes="100vw" />
        <img src="/images/hero-desktop-1600.webp" srcSet="/images/hero-desktop-1600.webp 1600w, /images/hero-desktop-2400.webp 2400w, /images/hero-desktop-3200.webp 3200w" sizes="100vw" alt="" fetchPriority="high" decoding="async" width={1600} height={415} />
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
          <li><span className="fs-icon"><Zap size={26} strokeWidth={2.2} /></span><span>Research<br />Tools</span></li>
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
          <span className="team-name">{f.home.name}</span>
          <span className="vs">vs</span>
          <TeamBadge team={f.away} size={32} />
          <span className="team-name">{f.away.name}</span>
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
        <span className="league-cell">
          <CompMark name={f.competition.name} synthetic={f.competition.is_synthetic} />
          {f.competition.short_name}
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
          <span><TeamBadge team={f.home} size={26} /> {f.home.name}</span>
          <span><TeamBadge team={f.away} size={26} /> {f.away.name}</span>
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
  { id: "apif:39", title: "Premier League Hub", text: "In-depth evidence and model probabilities for EPL matches.", cta: "View EPL Hub", img: "/images/league-premier.webp", Icon: Crown },
  { id: "apif:140", title: "La Liga Hub", text: "Research Spain's biggest matches with transparent evidence.", cta: "View La Liga Hub", img: "/images/league-liga.webp", Icon: Layers },
  { id: "apif:2", title: "Champions League Hub", text: "Europe's elite club competition, analysed match by match.", cta: "View UCL Hub", img: "/images/league-continental.webp", Icon: Trophy },
];

function LeagueTiles() {
  return (
    <section className="league-tiles" aria-label="League hubs">
      {LEAGUES.map(({ id, title, text, cta, img, Icon }) => (
        <Link key={id} to={`/leagues/${encodeURIComponent(id)}`} className="league-tile" style={{ backgroundImage: `url(${img})` }}>
          <span className="lt-icon"><Icon size={34} strokeWidth={1.8} /></span>
          <span className="lt-body">
            <span className="lt-title">{title}</span>
            <span className="lt-text">{text}</span>
            <span className="lt-cta">{cta} <ArrowRight size={15} /></span>
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

function ArchivePreview() {
  const { data } = useApi<{ items: Array<{ id: string; fixture_id: string; market_label: string; probability: number; settled_outcome: number | null; home: string; away: string; home_goals: number | null; away_goals: number | null; starts_at_utc: string; is_pre_kickoff: boolean; is_synthetic: boolean; competition: string }> }>(
    "/predictions/archive?settled=settled&market=TOTAL_GOALS_OVER_2_5_REGULATION",
    { ttlMs: 120_000 },
  );
  const items = data?.items.slice(0, 6) ?? [];
  return (
    <section className="section" aria-labelledby="archive-title">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="eyebrow">Accountability</span>
            <h2 id="archive-title" className="h-section">Past forecasts &amp; results</h2>
            <p className="lede">Every forecast is stored immutably with its timestamp and data cut-off, then settled against the actual result. We never rewrite old forecasts.</p>
          </div>
          <Link to="/predictions/archive" className="btn btn-outline">Open the archive <ArrowRight size={16} /></Link>
        </div>
        <div className="card archive-card">
          <div className="table-scroll">
            <table className="dtable cards-sm">
              <thead><tr><th>Match</th><th>Market</th><th>Model probability</th><th>Result</th><th>Outcome</th><th>Type</th></tr></thead>
              <tbody>
                {items.length === 0 && Array.from({ length: 4 }, (_, i) => <tr key={i}><td colSpan={6}><Skeleton h={18} /></td></tr>)}
                {items.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Match"><strong>{r.home}</strong> <span className="muted">vs</span> <strong>{r.away}</strong><div className="tiny muted">{r.competition} · {longDate(r.starts_at_utc)}</div></td>
                    <td data-label="Market">{r.market_label.replace("Total goals: ", "")}</td>
                    <td data-label="Model" className="num"><span className="conf-cell"><ProbBar p={r.probability} width={70} /> {pct(r.probability)}</span></td>
                    <td data-label="Result" className="num">{r.home_goals}-{r.away_goals}</td>
                    <td data-label="Outcome">{r.settled_outcome === 1 ? <span className="pill pill-green">Happened</span> : <span className="pill pill-gray">Did not happen</span>}</td>
                    <td data-label="Type">{r.is_pre_kickoff ? <span className="pill pill-blue">Published pre-kickoff</span> : <span className="pill pill-demo">Backtest{r.is_synthetic ? " · synthetic" : ""}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny muted archive-note">A 70% forecast should fail about 3 times in 10. Judge models on calibration and log loss across many matches, never on single results.</p>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { Icon: Database, title: "Sourced records", text: "Fixtures, scores and match statistics from a licensed provider, each stamped with source and time. Synthetic data is always labelled." },
    { Icon: Sigma, title: "Independent models", text: "Dixon-Coles goal model, negative-binomial corners and cards models, fitted only on data available before kick-off." },
    { Icon: Gauge, title: "Uncertainty & quality", text: "Each probability carries an uncertainty range and a quality label. Too little data means no number, not a guess." },
    { Icon: FileSearch, title: "Traceable evidence", text: "Open any market to see the prior fixtures, hit-rates, distributions and model drivers behind it." },
  ];
  return (
    <section className="section how" aria-labelledby="how-title">
      <div className="container">
        <span className="eyebrow">Method</span>
        <h2 id="how-title" className="h-section">How the probabilities are computed</h2>
        <div className="grid-4 how-grid">
          {steps.map(({ Icon, title, text }, i) => (
            <div key={title} className="card card-pad how-step">
              <span className="how-num">{i + 1}</span>
              <Icon size={26} color="#067a3e" aria-hidden="true" />
              <h3 className="h-card">{title}</h3>
              <p className="muted small">{text}</p>
            </div>
          ))}
        </div>
        <Link to="/research/how-it-works" className="link">Read the full methodology <ArrowRight size={16} /></Link>
      </div>
    </section>
  );
}

function SampleAnalysis() {
  const { data } = useTodayBoard();
  const sample = data?.items.find((f) => f.is_public_sample) ?? data?.items[0];
  return (
    <section className="section sample" aria-labelledby="sample-title">
      <div className="container sample-grid">
        <div>
          <span className="eyebrow">Free sample</span>
          <h2 id="sample-title" className="h-section">See a complete match report before you join</h2>
          <p className="lede">One fixture is always open as a free sample: every supported market, the evidence tables and the model details. Exactly what a report credit unlocks.</p>
          <div className="row-wrap" style={{ marginTop: 18 }}>
            {sample && <Link to={`/matches/${encodeURIComponent(sample.id)}`} className="btn btn-dark">Open the free sample report <ArrowRight size={16} /></Link>}
            <Link to="/research/how-it-works" className="btn btn-outline">What&apos;s inside a report</Link>
          </div>
        </div>
        <div className="card sample-card" aria-hidden={!sample}>
          {sample ? (
            <>
              <div className="sample-teams">
                <span><TeamBadge team={sample.home} size={36} /> {sample.home.name}</span>
                <span className="muted small">vs</span>
                <span><TeamBadge team={sample.away} size={36} /> {sample.away.name}</span>
              </div>
              <div className="sample-rows">
                {[
                  { k: "Featured market", v: sample.featured?.short_label ?? "-" },
                  { k: "Model probability", v: pct(sample.featured?.probability) },
                  { k: "Markets in report", v: "56 defined · quality-gated" },
                  { k: "Evidence sets", v: "Home, away, last 10, H2H, league" },
                ].map((r) => (
                  <div key={r.k} className="sample-row"><span className="muted">{r.k}</span><strong>{r.v}</strong></div>
                ))}
              </div>
              {sample.is_synthetic && <DemoPill />}
            </>
          ) : (
            <Skeleton h={180} />
          )}
        </div>
      </div>
    </section>
  );
}

function Coverage() {
  const { data } = useApi<{ items: Array<{ id: string; name: string; country: string; is_synthetic: boolean; completed: number; upcoming: number; rights_status: string }> }>("/competitions", { ttlMs: 120_000 });
  return (
    <section className="section" aria-labelledby="coverage-title">
      <div className="container">
        <span className="eyebrow">Coverage</span>
        <h2 id="coverage-title" className="h-section">League coverage</h2>
        <p className="lede">Coverage depends on what our data plan actually provides. We show what is loaded, never a blanket promise.</p>
        <div className="coverage-grid">
          {(data?.items ?? []).map((c) => (
            <Link key={c.id} to={`/leagues/${encodeURIComponent(c.id)}`} className="card coverage-item">
              <CompMark name={c.name} synthetic={c.is_synthetic} />
              <span className="cov-name"><strong>{c.name}</strong><span className="tiny muted">{c.country}</span></span>
              {c.is_synthetic ? <span className="pill pill-demo">Synthetic demo</span> : c.completed > 0 ? <span className="pill pill-green">Data loaded</span> : <span className="pill pill-gray">Awaiting provider data</span>}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function BetaPricing() {
  return (
    <section className="section beta" aria-labelledby="beta-title">
      <div className="container beta-grid">
        <div>
          <span className="eyebrow">Beta</span>
          <h2 id="beta-title" className="h-section">Free during the invite-only beta</h2>
          <p className="lede">Five invited testers each receive ten report credits. One credit unlocks one match: every supported market, all evidence and later refreshes of that report. Reopening it never costs again.</p>
          <ul className="beta-points">
            <li><Check size={18} /> No card, no Mobile Money, no payments in the beta</li>
            <li><Check size={18} /> A credit is one match report, never an API request</li>
            <li><Check size={18} /> Pricing after the beta is still being tested, not final</li>
          </ul>
          <Link to="/pricing" className="btn btn-outline">Beta &amp; pricing details <ArrowRight size={16} /></Link>
        </div>
        <div className="beta-cards">
          {[
            { n: "10", t: "free report credits per tester" },
            { n: "1", t: "credit per match, all markets included" },
            { n: "0", t: "charge for reopening or switching markets" },
          ].map((x) => (
            <div key={x.t} className="beta-stat"><strong className="num">{x.n}</strong><span>{x.t}</span></div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ResponsibleBand() {
  return (
    <section className="responsible" aria-labelledby="resp-title">
      <div className="container responsible-inner">
        <Scale size={30} aria-hidden="true" />
        <div>
          <h2 id="resp-title">Research responsibly</h2>
          <p>18+ only. Probabilities describe uncertainty; they do not predict certain outcomes or guarantee winnings. We never tell you what to bet. If gambling stops being fun, take a break and seek support.</p>
        </div>
        <Link to="/responsible-use" className="btn btn-outline-light">Responsible use <BookOpenCheck size={16} /></Link>
        <Link to="/statistics" className="btn btn-outline-light only-desktop">Model limits <LineChart size={16} /></Link>
      </div>
    </section>
  );
}
