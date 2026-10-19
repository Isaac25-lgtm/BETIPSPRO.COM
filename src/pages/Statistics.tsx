import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Info } from "lucide-react";
import { useApi } from "../lib/api";
import { dateTime, longDate, pct } from "../lib/format";
import { DemoPill, ErrorState, Notice, ProbBar, Skeleton } from "../components/ui";
import { CalibrationChart } from "../components/charts";

interface Evaluation { market_family: string; competition_id: string | null; competition: string | null; sample_n: number; brier: number; log_loss: number; baseline_brier: number; baseline_log_loss: number; calibration: Array<{ bin: string; n: number; mean_predicted: number; observed_rate: number }>; data_mode: string }
interface Stats {
  backtest_run: null | { id: string; model_version: string; data_mode: string; generated_at: string; description: string };
  evaluations: Evaluation[];
  counts: { verified_live_settled: number | null; live_published: number | null; demo_published: number | null; backtest_rows: number | null };
  roi: { available: boolean; reason: string };
  disclaimer: string;
}

const FAMILY: Record<string, string> = {
  MATCH_RESULT: "Match result (1X2)", TOTAL_GOALS_2_5: "Over/Under 2.5 goals", BTTS: "Both teams to score", FIRST_HALF_GOALS_0_5: "First-half over 0.5", TOTAL_CORNERS_9_5: "Corners over 9.5", TOTAL_YELLOW_CARDS_3_5: "Yellow cards over 3.5",
};

export default function Statistics() {
  const { data, error, reload } = useApi<Stats>("/statistics/models", { ttlMs: 120_000 });
  const [scope, setScope] = useState<string>("ALL");
  if (error) return <div className="container section-tight"><ErrorState message={error.message} onRetry={reload} /></div>;
  const evals = (data?.evaluations ?? []).filter((e) => (scope === "ALL" ? e.competition_id == null : e.competition_id === scope));
  const comps = [...new Map((data?.evaluations ?? []).filter((e) => e.competition_id).map((e) => [e.competition_id!, e.competition ?? e.competition_id!])).entries()];
  const demo = data?.backtest_run?.data_mode === "SIMULATED_DEMO";
  return (
    <div className="container">
      <div className="page-head">
        <h1>Model performance</h1>
        <p className="muted">How we measure forecast quality: log loss, Brier score and calibration against a league base-rate baseline. Lower is better for both scores. Win rates and ROI are not used.</p>
      </div>
      <div className="grid-4 kpi-row">
        <div className="card card-pad kpi"><span className="tiny muted">Verified live forecasts (settled)</span><strong className="num">{data?.counts.verified_live_settled ?? 0}</strong><span className="tiny muted">Pre-kickoff, real data</span></div>
        <div className="card card-pad kpi"><span className="tiny muted">Live forecasts published</span><strong className="num">{data?.counts.live_published ?? 0}</strong><span className="tiny muted">Real-data, awaiting/settled</span></div>
        <div className="card card-pad kpi"><span className="tiny muted">Demo forecasts</span><strong className="num">{data?.counts.demo_published ?? 0}</strong><span className="tiny muted">Synthetic, excluded from record</span></div>
        <div className="card card-pad kpi"><span className="tiny muted">ROI</span><strong>Not published</strong><span className="tiny muted" title={data?.roi.reason}>Requires recorded prices & staking rules</span></div>
      </div>
      {demo && <div style={{ marginTop: 16 }}><Notice tone="demo"><strong>Backtest on synthetic data.</strong> {data?.disclaimer}</Notice></div>}
      {data?.backtest_run && <p className="small muted" style={{ marginTop: 12 }}><Info size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> {data.backtest_run.description} Model {data.backtest_run.model_version}, generated {dateTime(data.backtest_run.generated_at)}.</p>}

      <div className="row-wrap" style={{ margin: "18px 0" }} role="group" aria-label="Scope">
        <button className={`chip ${scope === "ALL" ? "active" : ""}`} onClick={() => setScope("ALL")}>All competitions</button>
        {comps.map(([id, name]) => <button key={id} className={`chip ${scope === id ? "active" : ""}`} onClick={() => setScope(id)}>{name}</button>)}
      </div>

      {!data ? <Skeleton h={300} r={12} /> : evals.length === 0 ? (
        <Notice tone="info">No evaluations are available yet. Real-data backtests appear once enough provider history is loaded.</Notice>
      ) : (
        <div className="eval-grid">
          {evals.map((e) => {
            const better = e.log_loss < e.baseline_log_loss;
            return (
              <section key={e.market_family + (e.competition_id ?? "")} className="card card-pad eval-card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h2 className="h-card">{FAMILY[e.market_family] ?? e.market_family}</h2>
                  {e.data_mode === "SIMULATED_DEMO" && <DemoPill />}
                </div>
                <dl className="eval-metrics">
                  <div><dt>Matches (n)</dt><dd className="num">{e.sample_n}</dd></div>
                  <div><dt>Log loss</dt><dd className="num">{e.log_loss.toFixed(4)} <span className="tiny muted">base {e.baseline_log_loss.toFixed(4)}</span></dd></div>
                  <div><dt>Brier</dt><dd className="num">{e.brier.toFixed(4)} <span className="tiny muted">base {e.baseline_brier.toFixed(4)}</span></dd></div>
                </dl>
                <p className={`small ${better ? "eval-good" : "eval-bad"}`}>{better ? "Beats the base-rate baseline on log loss in this sample." : "Does NOT beat the base-rate baseline on log loss in this sample."} {e.sample_n < 300 ? "Small sample: differences may be noise." : ""}</p>
                {e.calibration.length > 0 && <CalibrationChart bins={e.calibration} title="Calibration (reliability)" />}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ArchiveRow { id: string; fixture_id: string; market_id: string; market_label: string; probability: number; status: string; is_pre_kickoff: boolean; settled_outcome: number | null; generated_at: string; data_as_of_at: string; model_version: string; starts_at_utc: string; home: string; away: string; home_goals: number | null; away_goals: number | null; competition: string; is_synthetic: boolean }

export function Archive() {
  const [sp, setSp] = useSearchParams();
  const kind = sp.get("kind") ?? "all";
  const market = sp.get("market") ?? "";
  const page = Number(sp.get("page") ?? 1);
  const q = new URLSearchParams({ kind, page: String(page) });
  if (market) q.set("market", market);
  const { data, error, reload } = useApi<{ items: ArchiveRow[]; total: number; page_size: number; summary: { n: number; brier: number | null; settled: number }; note: string }>(`/predictions/archive?${q}`, { ttlMs: 60_000 });
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== "page") n.delete("page"); setSp(n, { replace: true }); };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <div className="container">
      <div className="page-head">
        <h1>Forecast archive</h1>
        <p className="muted">Immutable, timestamped forecasts with their data cut-off and settled outcome. New model versions create new records; old ones are never edited.</p>
      </div>
      <div className="card card-pad archive-filters">
        <div className="seg" role="group" aria-label="Forecast type">
          {[["all", "All"], ["pre_kickoff", "Published pre-kickoff"], ["backtest", "Retrospective backtest"]].map(([k, l]) => (
            <button key={k} className={`seg-btn ${kind === k ? "active" : ""}`} aria-pressed={kind === k} onClick={() => set("kind", k === "all" ? "" : k)}>{l}</button>
          ))}
        </div>
        <select className="select" value={market} onChange={(e) => set("market", e.target.value)} aria-label="Market">
          <option value="">Key markets</option>
          <option value="MATCH_RESULT_HOME_REGULATION">Home win</option>
          <option value="MATCH_RESULT_DRAW_REGULATION">Draw</option>
          <option value="TOTAL_GOALS_OVER_2_5_REGULATION">Over 2.5 goals</option>
          <option value="BTTS_YES_REGULATION">BTTS yes</option>
          <option value="TOTAL_CORNERS_OVER_9_5_REGULATION">Corners over 9.5</option>
          <option value="TOTAL_YELLOW_CARDS_OVER_3_5_REGULATION">Yellows over 3.5</option>
        </select>
        {data && <span className="small muted">{data.total} forecasts · {data.summary.settled} settled{data.summary.brier != null ? ` · Brier ${data.summary.brier.toFixed(4)}` : ""}</span>}
      </div>
      {data?.note && <p className="tiny muted" style={{ margin: "10px 0" }}>{data.note}</p>}
      {error ? <ErrorState message={error.message} onRetry={reload} /> : (
        <div className="card archive-card">
          <div className="table-scroll">
            <table className="dtable cards-sm">
              <thead><tr><th>Kick-off</th><th>Match</th><th>Market</th><th>Probability</th><th>Result</th><th>Outcome</th><th>Type</th><th>Data cut-off</th></tr></thead>
              <tbody>
                {!data && Array.from({ length: 8 }, (_, i) => <tr key={i}><td colSpan={8}><Skeleton h={18} /></td></tr>)}
                {data?.items.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Kick-off" className="nowrap">{longDate(r.starts_at_utc)}</td>
                    <td data-label="Match"><Link className="link-plain" to={`/matches/${encodeURIComponent(r.fixture_id)}`}><strong>{r.home}</strong> vs <strong>{r.away}</strong></Link><div className="tiny muted">{r.competition}</div></td>
                    <td data-label="Market">{r.market_label}</td>
                    <td data-label="Probability" className="num"><span className="conf-cell"><ProbBar p={r.probability} width={60} /> {pct(r.probability)}</span></td>
                    <td data-label="Result" className="num">{r.home_goals != null ? `${r.home_goals}-${r.away_goals}` : "-"}</td>
                    <td data-label="Outcome">{r.settled_outcome == null ? <span className="pill pill-gray">Pending</span> : r.settled_outcome ? <span className="pill pill-green">Happened</span> : <span className="pill pill-red">Did not happen</span>}</td>
                    <td data-label="Type">{r.is_pre_kickoff ? <span className="pill pill-blue">Pre-kickoff</span> : <span className="pill pill-amber">Backtest</span>}{r.is_synthetic && <> <DemoPill label="Synthetic" /></>}</td>
                    <td data-label="Cut-off" className="tiny muted nowrap">{dateTime(r.data_as_of_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => set("page", String(page - 1))}>Previous</button>
            <span className="small muted">Page {page} of {pages}</span>
            <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => set("page", String(page + 1))}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
