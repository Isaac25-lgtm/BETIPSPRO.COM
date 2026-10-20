import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Check, ChevronDown, ChevronUp, Minus, Scale, X } from "lucide-react";
import { useApi } from "../lib/api";
import { dateTime, longDate, metricLabels, odds, pct } from "../lib/format";
import type { Evidence, EvidenceSet, Preview, Report } from "../lib/types";
import { ErrorState, Notice, ProbBar, QualityPill, Skeleton } from "../components/ui";
import { PmfBars, ScorelineHeatmap, TwoSeriesHistogram } from "../components/charts";

export default function MarketEvidence() {
  const { id = "", marketId = "" } = useParams();
  const fid = encodeURIComponent(id);
  const ev = useApi<Evidence>(`/fixtures/${fid}/markets/${encodeURIComponent(marketId)}/evidence`, { ttlMs: 300_000 });
  const report = useApi<Report>(ev.data ? `/fixtures/${fid}/report` : null, { ttlMs: 300_000 });
  const preview = useApi<Preview>(`/fixtures/${fid}/preview`, { ttlMs: 300_000 });

  if (ev.error) {
    const locked = ev.error.code === "REPORT_LOCKED" || ev.error.code === "UNAUTHENTICATED";
    return (
      <div className="container section-tight">
        <ErrorState title={locked ? "This market is part of a locked report" : "Could not load the evidence"} message={locked ? "Unlock the match report (1 credit, all markets included) to view this evidence." : ev.error.message} />
        <Link to={`/matches/${fid}`} className="btn btn-primary" style={{ marginTop: 16 }}>Go to the match</Link>
      </div>
    );
  }
  if (!ev.data) return <div className="container section-tight" aria-busy="true"><Skeleton h={36} w="50%" /><Skeleton h={200} r={12} style={{ marginTop: 16 }} /><Skeleton h={320} r={12} style={{ marginTop: 16 }} /></div>;
  const e = ev.data;
  const f = e.forecast;
  const thresholdForHist = e.market.threshold;
  const statLabel = e.evidence_kind === "corners" ? "corners" : e.evidence_kind === "cards" ? "yellow cards" : e.market.settlement_period === "FIRST_HALF" ? "first-half goals" : "goals";
  const fx = preview.data?.fixture;
  const siblings = (report.data?.markets ?? []).filter((m) => m.category === e.market.category);

  return (
    <div className="container evidence-page">
      <div className="ev-hero">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to={`/matches/${fid}`}><ArrowLeft size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> {e.fixture.home} vs {e.fixture.away}</Link>
        <span>/</span><span>{e.market.category}</span>
      </nav>
      <header className="ev-head">
        <div>
          <h1>{e.market.label}</h1>
          <p className="muted">{e.fixture.home} vs {e.fixture.away} · {e.fixture.competition} · {longDate(e.fixture.starts_at_utc)}</p>
        </div>
        <QualityPill status={f.status} />
      </header>
      </div>

      {siblings.length > 1 && (
        <div className="sibling-markets" role="navigation" aria-label="Other markets in this category">
          {siblings.map((m) => (
            <Link key={m.id} to={`/matches/${fid}/markets/${m.id}`} className={`chip ${m.id === e.market_id ? "active" : ""}`} aria-current={m.id === e.market_id ? "page" : undefined}>
              {m.short_label} <span className="num">{pct(m.probability)}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="ev-grid">
        <div className="ev-main">
          <section className="card card-pad ev-summary">
            <div className="ev-prob">
              <span className="tiny muted">Model probability</span>
              <strong className="num">{f.probability == null ? "n/a" : pct(f.probability, 1)}</strong>
              <ProbBar p={f.probability} lo={f.uncertainty?.p05} hi={f.uncertainty?.p95} width={220} />
              {f.uncertainty?.p05 != null && <span className="tiny muted">90% parameter range {pct(f.uncertainty.p05)} – {pct(f.uncertainty.p95)}</span>}
            </div>
            <div className="ev-compare">
              <div><span className="tiny muted">League base rate (historical)</span><strong className="num">{pct(e.league_baseline.rate)}</strong><span className="tiny muted">{e.league_baseline.hits}/{e.league_baseline.settled} this season</span></div>
              <div><span className="tiny muted">Fair odds implied by model</span><strong className="num">{f.probability ? odds(1 / f.probability) : "-"}</strong><span className="tiny muted">1 / probability, no margin</span></div>
              <div><span className="tiny muted">Forecast generated</span><strong className="small">{dateTime(f.forecast_generated_at)}</strong><span className="tiny muted">data as of {dateTime(f.as_of_data_at)}</span></div>
            </div>
            {f.probability == null && <Notice tone="warn"><strong>Insufficient evidence.</strong> {f.quality_reason}</Notice>}
          </section>

          <section className="card card-pad narrative">
            <h2 className="h-card">{e.narrative.headline}</h2>
            {e.narrative.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
            {e.narrative.caveats.length > 0 && <ul className="caveats">{e.narrative.caveats.map((c) => <li key={c}>{c}</li>)}</ul>}
            {e.ai_summary && (
              <div className="ai-summary">
                <span className="ai-label">Match summary</span>
                <p>{e.ai_summary.summary}</p>
                {e.ai_summary.key_points?.length > 0 && <ul>{e.ai_summary.key_points.map((k) => <li key={k}>{k}</li>)}</ul>}
              </div>
            )}
          </section>

          <section className="ev-sets" aria-label="Observed evidence">
            <h2 className="h-section ev-h2">Observed evidence</h2>
            <div className="sets-grid">
              {e.observed_evidence.map((s) => <EvidenceCard key={s.key} s={s} kind={e.evidence_kind} />)}
            </div>
          </section>

          <section className="card card-pad">
            {e.distributions.model.type === "scoreline_matrix" && Array.isArray(e.distributions.model.values) ? (
              <ScorelineHeatmap matrix={e.distributions.model.values as number[][]} home={e.fixture.home} away={e.fixture.away} title={e.distributions.model.period === "HT" ? "First-half scoreline distribution (model)" : "Scoreline distribution (model)"} />
            ) : Array.isArray(e.distributions.model.values) ? (
              <PmfBars values={e.distributions.model.values as number[]} threshold={e.market.threshold} statLabel={statLabel} title={`Total ${statLabel}: model distribution`} />
            ) : <p className="muted small">Model distribution unavailable.</p>}
          </section>
          <section className="card card-pad">
            <TwoSeriesHistogram a={e.distributions.observed.home_last10} b={e.distributions.observed.away_last10} aLabel={`${e.fixture.home} (last 10)`} bLabel={`${e.fixture.away} (last 10)`} statLabel={statLabel} title={`Observed match totals: ${statLabel}`} threshold={thresholdForHist} />
          </section>
        </div>

        <aside className="ev-side">
          <section className="card card-pad">
            <h2 className="h-card">Model drivers</h2>
            <dl className="driver-list">
              {e.model_drivers.map((d) => <div key={d.metric}><dt>{metricLabels[d.metric] ?? d.metric}</dt><dd className="num">{d.value == null ? "-" : Number.isInteger(d.value) ? d.value : d.value.toFixed(3)}</dd></div>)}
            </dl>
          </section>

          <section className="card card-pad">
            <h2 className="h-card">Price panel</h2>
            {e.prices.length > 6 && <p className="tiny muted">Best 6 of {e.prices.filter((pr) => pr.decimal != null).length} bookmaker prices.</p>}
            {e.prices.length === 0 ? (
              <p className="muted small">No price for this market.</p>
            ) : [...e.prices].filter((pr) => pr.decimal != null).sort((x, y) => (y.decimal ?? 0) - (x.decimal ?? 0)).slice(0, 6).map((pr) => (
              <div key={pr.bookmaker} className="price-box">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{pr.bookmaker}</strong>
                  {pr.is_synthetic ? <span className="pill pill-demo">Synthetic</span> : pr.stale ? <span className="pill pill-amber">Stale</span> : <span className="pill pill-green">Current</span>}
                </div>
                <dl className="driver-list">
                  <div><dt>Decimal price</dt><dd className="num">{odds(pr.decimal)}</dd></div>
                  <div><dt>Implied (1/odds)</dt><dd className="num">{pct(pr.implied_probability, 1)}</dd></div>
                  {pr.normalized_probability != null && <div><dt>Margin-normalised</dt><dd className="num">{pct(pr.normalized_probability, 1)}</dd></div>}
                  {pr.overround != null && <div><dt>Book overround</dt><dd className="num">{pct(pr.overround - 1, 1)}</dd></div>}
                  <div><dt>Model probability</dt><dd className="num">{pct(f.probability, 1)}</dd></div>
                  <div><dt>Observed at</dt><dd>{dateTime(pr.collected_at)}</dd></div>
                </dl>
                {pr.stale && <p className="tiny muted">Comparison disabled: price is stale.</p>}
              </div>
            ))}
          </section>

          <section className="card card-pad">
            <h2 className="h-card"><Scale size={16} style={{ display: "inline", verticalAlign: "-2px" }} /> Settlement definition</h2>
            <p className="small">{e.market.settlement_rules}</p>
          </section>

          <section className="card card-pad">
            <h2 className="h-card">Sources & provenance</h2>
            <dl className="driver-list">
              <div><dt>Source fixtures cited</dt><dd className="num">{e.source_manifest.count}</dd></div>
              <div><dt>Provider</dt><dd>{e.source_manifest.provider}</dd></div>
              <div><dt>Model version</dt><dd>{f.model_version}</dd></div>
              <div><dt>Market validation</dt><dd>{e.market.validation_status}</dd></div>
              <div><dt>Report version</dt><dd className="mono tiny">{e.report_version}</dd></div>
              <div><dt>Dataset hash</dt><dd className="mono tiny">{f.dataset_hash?.slice(0, 22)}...</dd></div>
              <div><dt>Evidence cut-off</dt><dd>{dateTime(String(e.data_coverage.cutoff_used))}</dd></div>
            </dl>
          </section>
          {fx && <Link to={`/matches/${fid}?tab=markets`} className="btn btn-outline btn-block">All markets for this match</Link>}
        </aside>
      </div>
    </div>
  );
}

function EvidenceCard({ s, kind }: { s: EvidenceSet; kind: "goals" | "corners" | "cards" }) {
  const [open, setOpen] = useState(s.key === "home_recent_home" || s.key === "away_recent_away");
  const avg = Object.entries(s.averages).filter(([, v]) => v != null);
  return (
    <section className="card ev-set">
      <button className="ev-set-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ev-set-title">
          <strong>{s.title}</strong>
          <span className="tiny muted">{s.window.replace(/_/g, " ").toLowerCase()} · {s.settled} settled of {s.sample}</span>
        </span>
        <span className="ev-rate">
          <strong className="num">{s.settled ? `${s.hits}/${s.settled}` : "-"}</strong>
          <span className="tiny muted">{pct(s.rate)}</span>
        </span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {avg.length > 0 && (
        <div className="ev-avgs">{avg.map(([k, v]) => <span key={k}><span className="tiny muted">{k.replace(/_/g, " ")}</span> <strong className="num">{v}</strong></span>)}</div>
      )}
      {open && (
        s.rows.length === 0 ? <p className="muted small" style={{ padding: "0 14px 14px" }}>No matches in this window.</p> : (
          <div className="table-scroll">
            <table className="dtable ev-table">
              <thead>
                <tr><th>Date</th><th>Match</th><th>FT</th><th>HT</th>{kind === "corners" && <th>Corners</th>}{kind === "cards" && <th>Yellows</th>}<th>Hit</th></tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.fixture_id} title={`Source fixture ${r.fixture_id}`}>
                    <td className="nowrap">{longDate(r.date)}</td>
                    <td><span className={r.venue === "H" ? "strong-home" : ""}>{r.home}</span> <span className="muted">vs</span> <span className={r.venue === "A" ? "strong-home" : ""}>{r.away}</span><div className="tiny muted">{r.competition}</div></td>
                    <td className="num"><strong>{r.score}</strong></td>
                    <td className="num">{r.ht_score ?? "-"}</td>
                    {kind === "corners" && <td className="num">{r.corners.total ?? "-"} <span className="tiny muted">({r.corners.home ?? "-"}-{r.corners.away ?? "-"})</span></td>}
                    {kind === "cards" && <td className="num">{r.yellow_cards.total ?? "-"} <span className="tiny muted">({r.yellow_cards.home ?? "-"}-{r.yellow_cards.away ?? "-"})</span></td>}
                    <td>{r.hit === 1 ? <span className="hit yes" aria-label="Outcome occurred"><Check size={15} /></span> : r.hit === 0 ? <span className="hit no" aria-label="Outcome did not occur"><X size={15} /></span> : <span className="hit na" aria-label="Not settleable"><Minus size={15} /></span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}
