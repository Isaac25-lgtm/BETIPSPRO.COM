import { Link } from "react-router";
import {
  ArrowRight, BarChart3, CalendarDays, Check, ChevronRight, FileText, Scale, ShieldCheck, Trophy,
} from "lucide-react";
import { useAuth } from "../app/auth";
import { useApi } from "../lib/api";
import { addDays, kickoffDate, kickoffTime, longDate, odds, pct, eatYmd } from "../lib/format";
import type { FixtureList, FixtureSummary, Report } from "../lib/types";
import { CompMark, DemoPill, ErrorState, ProbBar, Skeleton, TeamBadge, teamLabel } from "../components/ui";

/**
 * LOCAL-ONLY preview hero cut from the owner's reference screenshot (real players + sponsor logos).
 * Enabled only in `vite dev` with VITE_LOCAL_REFERENCE_HERO=true in .env.local; the images are
 * gitignored and stripped from production builds. Replace with a licensed photo before launch.
 */
const LOCAL_REFERENCE_HERO = import.meta.env.DEV && import.meta.env.VITE_LOCAL_REFERENCE_HERO === "true";

const eatYmdOf = (iso: string) => eatYmd(new Date(iso));

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
  const board = useTodayBoard();
  const today = board.data?.items.filter((f) => f.featured).length;
  const sample = board.data?.items.find((f) => f.is_public_sample);
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
          {(config?.data_mode === "DEMO" || config?.synthetic_data_present) && (
            <p className="hero-eyebrow">
              <span className="hero-eyebrow-dot" aria-hidden="true" />
              Demo build · fictional teams and data
            </p>
          )}
          <h1 id="hero-title" className="hero-title">
            Smarter match insights
            <br />
            for <span className="hl">informed choices</span>
          </h1>
          <p className="hero-lede">
            Model probabilities for every market, with the real match evidence behind each number.
          </p>
          <div className="hero-actions">
            <Link to="/matches" className="btn btn-primary hero-cta">
              View today&apos;s matches <ArrowRight size={18} strokeWidth={2.4} />
            </Link>
            {sample && (
              <Link to={`/matches/${encodeURIComponent(sample.id)}`} className="hero-secondary">
                See a free sample report <ArrowRight size={16} />
              </Link>
            )}
          </div>
        </div>
        <ul className="feature-strip" aria-label="What you get">
          <li><span className="fs-icon"><BarChart3 size={20} strokeWidth={2} /></span><span><strong>Model probabilities</strong><small>50+ markets per match</small></span></li>
          <li><span className="fs-icon"><ShieldCheck size={20} strokeWidth={2} /></span><span><strong>Real match evidence</strong><small>Every number is traceable</small></span></li>
          <li><span className="fs-icon"><Trophy size={20} strokeWidth={2} /></span><span><strong>League hubs</strong><small>Tables, form and fixtures</small></span></li>
          <li><span className="fs-icon"><FileText size={20} strokeWidth={2} /></span><span><strong>Full match reports</strong><small>{config?.open_access ? "Open to everyone while we test" : "One credit unlocks it all"}</small></span></li>
        </ul>
        <dl className="hero-stats" aria-label="At a glance">
          <div><dt>Markets per match</dt><dd className="num">56</dd></div>
          <div><dt>Matches today</dt><dd className="num">{today ?? "–"}</dd></div>
          {config?.open_access ? <div><dt>Reports open</dt><dd>All</dd></div> : <div><dt>Free beta reports</dt><dd className="num">{config?.beta_initial_credits ?? 10}</dd></div>}
        </dl>
      </div>
    </section>
  );
}

function useTodayBoard() {
  return useApi<FixtureList>(`/fixtures?date=${eatYmd()}&status=all&page_size=50`, { ttlMs: 60_000 });
}

function MatchInsightsCard() {
  const { data, error, loading, reload } = useTodayBoard();
  const today = (data?.items ?? []).filter((f) => f.featured);
  const thin = !!data && today.length < 5;
  const next1 = useApi<FixtureList>(thin ? `/fixtures?date=${addDays(eatYmd(), 1)}&status=upcoming&page_size=50` : null, { ttlMs: 60_000 });
  const next2 = useApi<FixtureList>(thin ? `/fixtures?date=${addDays(eatYmd(), 2)}&status=upcoming&page_size=50` : null, { ttlMs: 60_000 });
  const later = [...(next1.data?.items ?? []), ...(next2.data?.items ?? [])].filter((f) => f.featured);
  const rows = [...today, ...later].sort((a, b) => a.starts_at_utc.localeCompare(b.starts_at_utc)).slice(0, 5);
  const includesLater = rows.some((r) => !today.includes(r));
  const anyDemo = rows.some((r) => r.is_synthetic);
  const showOdds = rows.some((r) => r.featured?.odds);
  return (
    <section className="card insights" aria-labelledby="insights-title">
      <header className="insights-head">
        <div className="ih-title">
          <h2 id="insights-title">{includesLater ? "Upcoming match insights" : "Today\u2019s match insights"}</h2>
          <p className="ih-meta">
            <CalendarDays size={14} aria-hidden="true" /> {includesLater ? "Today and the next two days" : longDate(new Date().toISOString())}
            {anyDemo && <span className="ih-tag">Synthetic data</span>}
          </p>
        </div>
        <Link to="/matches" className="link view-all">View all <ArrowRight size={16} /></Link>
      </header>
      {error ? (
        <ErrorState message={error.message} onRetry={reload} />
      ) : (
        <>
          <div className="insights-table-wrap">
            <table className={`insights-table ${showOdds ? "" : "no-odds"}`}>
              <caption className="sr-only">Today&apos;s fixtures with one featured market each. Featured means the model differs most from the league base rate.</caption>
              <colgroup>
                <col className="c-match" /><col className="c-market" />{showOdds && <col className="c-odds" />}<col className="c-prob" /><col className="c-league" /><col className="c-time" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Match</th>
                  <th scope="col" title="The market where the model differs most from the league's historical base rate. Not a recommendation.">Featured market</th>
                  {showOdds && <th scope="col">Odds</th>}
                  <th scope="col">Model probability</th>
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
                  : rows.map((f) => <InsightRow key={f.id} f={f} showOdds={showOdds} />)}
              </tbody>
            </table>
          </div>
          <ul className="insights-cards" aria-label="Today's fixtures">
            {loading && !data ? Array.from({ length: 3 }, (_, i) => <li key={i}><Skeleton h={88} r={12} /></li>) : rows.map((f) => <InsightCard key={f.id} f={f} showOdds={showOdds} />)}
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

function InsightRow({ f, showOdds }: { f: FixtureSummary; showOdds: boolean }) {
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
      {showOdds && <td><OddsCell f={f} /></td>}
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
      <td className="num time-cell">{eatYmdOf(f.starts_at_utc) === eatYmd() ? kickoffTime(f.starts_at_utc) : `${kickoffDate(f.starts_at_utc, { weekday: "short" })} ${kickoffTime(f.starts_at_utc)}`}</td>
    </tr>
  );
}

function InsightCard({ f, showOdds }: { f: FixtureSummary; showOdds: boolean }) {
  return (
    <li>
      <Link to={`/matches/${encodeURIComponent(f.id)}`} className="insight-card">
        <div className="ic-top">
          <span className="league-cell small"><CompMark name={f.competition.name} synthetic={f.competition.is_synthetic} /> {f.competition.short_name}</span>
          <span className="num ic-time">{eatYmdOf(f.starts_at_utc) === eatYmd() ? kickoffTime(f.starts_at_utc) : `${kickoffDate(f.starts_at_utc, { weekday: "short" })} ${kickoffTime(f.starts_at_utc)}`}</span>
        </div>
        <div className="ic-teams">
          <span><TeamBadge team={f.home} size={26} /> {teamLabel(f.home, 22)}</span>
          <span><TeamBadge team={f.away} size={26} /> {teamLabel(f.away, 22)}</span>
        </div>
        <div className="ic-market">
          <span className="ic-label">{f.featured?.short_label}</span>
          <ProbBar p={f.featured?.probability ?? null} width={64} />
          <span className="num conf-pct">{pct(f.featured?.probability)}</span>
          {showOdds && <OddsCell f={f} />}
          <ChevronRight size={18} className="muted" aria-hidden="true" />
        </div>
      </Link>
    </li>
  );
}

const LEAGUES = [
  { id: "apif:39", title: "Premier League hub", tag: "England", color: "#7c3aed", text: "Evidence and model probabilities for EPL matches.", cta: "View EPL hub", img: "/images/league-premier.webp" },
  { id: "apif:140", title: "La Liga hub", tag: "Spain", color: "#ea580c", text: "Transparent research on Spain's top-flight matches.", cta: "View La Liga hub", img: "/images/league-liga.webp" },
  { id: "apif:2", title: "Champions League hub", tag: "Europe", color: "#2563eb", text: "Europe's elite club competition, match by match.", cta: "View UCL hub", img: "/images/league-continental.webp" },
];

function LeagueTiles() {
  return (
    <section className="league-tiles" aria-label="League hubs">
      {LEAGUES.map(({ id, title, tag, color, text, cta, img }) => (
        <Link
          key={id}
          to={`/leagues/${encodeURIComponent(id)}`}
          className={`league-tile ${LOCAL_REFERENCE_HERO ? "league-tile-local" : "league-tile-photo"}`}
          style={{ backgroundImage: `url(${LOCAL_REFERENCE_HERO ? img.replace("/images/", "/images/local/") : img})` }}
        >
          <span className="lt-inner">
            {LOCAL_REFERENCE_HERO && <span className="lt-icon" aria-hidden="true" />}
            <span className="lt-body">
              {!LOCAL_REFERENCE_HERO && <span className="lt-tag"><i style={{ background: color }} />{tag}</span>}
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
        <p className="premium-eyebrow">Beta access</p>
        <h2 id="premium-title">Full match reports<br />for serious analysts</h2>
      </div>
      <ul className="premium-list">
        {["Every supported market for the match", "Evidence tables from prior fixtures", "Model uncertainty, not false certainty", "Price comparison where licensed", "No ads, distraction-free"].map((t) => (
          <li key={t}><Check size={16} strokeWidth={2.6} /> {t}</li>
        ))}
      </ul>
      {config?.open_access ? (
        <Link to="/report" className="btn btn-primary premium-cta">Open the match report <ArrowRight size={18} /></Link>
      ) : signedIn ? (
        <Link to="/matches" className="btn btn-primary premium-cta">Unlock a report <ArrowRight size={18} /></Link>
      ) : (
        <Link to="/join" className="btn btn-primary premium-cta">Join the beta <ArrowRight size={18} /></Link>
      )}
      <p className="premium-foot">{config?.open_access ? "Testing phase: every report is open. No credits needed." : config?.payments_enabled ? "" : `Invite-only beta: ${config?.beta_initial_credits ?? 10} free report credits. No payments taken.`}</p>
    </section>
  );
}

function PerformanceCard() {
  const { data } = useApi<{ counts: { verified_live_settled: number | null; live_published: number | null }; backtest_run: { data_mode: string } | null; evaluations: Array<{ competition_id: string | null; log_loss: number; baseline_log_loss: number }> }>("/statistics/models", { ttlMs: 120_000 });
  const verified = data?.counts?.verified_live_settled ?? 0;
  const realBacktest = data?.backtest_run && data.backtest_run.data_mode !== "SIMULATED_DEMO";
  const overall = (data?.evaluations ?? []).filter((e) => e.competition_id == null);
  const beats = overall.filter((e) => e.log_loss < e.baseline_log_loss).length;
  return (
    <section className="card perf" aria-labelledby="perf-title">
      <div className="perf-head">
        <p className="perf-eyebrow">Track record</p>
        <h2 id="perf-title">Our research performance</h2>
        <p>Only verified, pre-kick-off forecasts count.</p>
      </div>
      <div className="perf-kpis">
        <div><strong className="num">{verified}</strong><span>Verified live forecasts</span></div>
        {realBacktest && overall.length ? (
          <div><strong className="num">{beats}/{overall.length}</strong><span>Markets beating the baseline</span></div>
        ) : (
          <div><strong className="kpi-status"><i className="dot dot-amber" />Pending</strong><span>Real-data backtest</span></div>
        )}
        <div><strong className="kpi-status"><i className="dot dot-blue" />In review</strong><span>Calibration</span></div>
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
  const candidates: Array<[string, string]> = [
    ["TOTAL_GOALS_OVER_2_5_REGULATION", "Over 2.5 goals"],
    ["BTTS_YES_REGULATION", "Both teams to score"],
    ["TOTAL_CORNERS_OVER_9_5_REGULATION", "Over 9.5 corners"],
    ["TOTAL_YELLOW_CARDS_OVER_3_5_REGULATION", "Over 3.5 yellow cards"],
    ["FIRST_HALF_GOALS_OVER_0_5", "Goal in the first half"],
    ["DOUBLE_CHANCE_HOME_DRAW_REGULATION", "Home win or draw"],
    ["TOTAL_GOALS_OVER_3_5_REGULATION", "Over 3.5 goals"],
  ];
  const rows = candidates.filter(([id]) => get(id)?.probability != null).slice(0, 4);
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
                <span className="rp-team"><TeamBadge team={sample.home} size={34} /> {teamLabel(sample.home, 12)}</span>
                <span className="rp-time num">{kickoffTime(sample.starts_at_utc)}</span>
                <span className="rp-team rp-away">{teamLabel(sample.away, 12)} <TeamBadge team={sample.away} size={34} /></span>
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
            {synthetic ? <DemoPill label={backtest ? "Synthetic backtest" : "Synthetic"} /> : backtest && <span className="pill pill-gray" title="Computed after the matches using only data available before kick-off">Retrospective backtest</span>}
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
  if (config?.open_access) {
    return (
      <section className="container beta-band-wrap" aria-label="Match report">
        <div className="beta-band">
          <div>
            <strong>Every report is open while we test</strong>
            <span>See all upcoming matches with data, the model's record and what we cover. No sign-in needed.</span>
          </div>
          <Link to="/report" className="btn btn-primary">Open the match report <ArrowRight size={18} /></Link>
        </div>
      </section>
    );
  }
  if (me?.user) return null;
  return (
    <section className="container beta-band-wrap" aria-label="Join the beta">
      <div className="beta-band">
        <div>
          <strong>Join the invite-only beta</strong>
          <span>{config?.beta_initial_credits ?? 10} free full match reports. No card, no payment.</span>
        </div>
        <Link to="/join" className="btn btn-primary">Get started <ArrowRight size={18} /></Link>
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
