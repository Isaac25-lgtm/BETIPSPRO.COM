/**
 * Lightweight SVG/HTML charts (no chart library). Single-hue sequential for magnitude,
 * validated two-series pair for home/away (see tokens.css), hover tooltips on every mark,
 * text in text colours, and a table view for screen readers.
 */
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const bind = (content: ReactNode) => ({
    onMouseEnter: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content }),
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => {
      const r = (e.target as Element).getBoundingClientRect();
      setTip({ x: r.left + r.width / 2, y: r.top, content });
    },
    onBlur: () => setTip(null),
    tabIndex: 0,
  });
  const node = tip ? createPortal(<div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.content}</div>, document.body) : null;
  return { bind, node };
}

const pc = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

/** Scoreline heatmap ramps: one hue per result region (home win / draw / away win), light -> dark by probability. */
const RAMPS = {
  home: ["#eefaf3", "#c6efd8", "#8edcb1", "#3fbb7c", "#0f8f52", "#05633a"],
  draw: ["#fdf7ea", "#f8e5b8", "#efc76e", "#dba233", "#b27812", "#7d520a"],
  away: ["#eef3fd", "#c9d8f8", "#93b2ef", "#5583e0", "#2f5fc4", "#1c3f8f"],
} as const;

function ramp(stops: readonly string[], t: number) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  const a = stops[i], b = stops[i + 1];
  const mix = (k: number) => Math.round(parseInt(a.slice(k, k + 2), 16) * (1 - f) + parseInt(b.slice(k, k + 2), 16) * f).toString(16).padStart(2, "0");
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

export function ScorelineHeatmap({ matrix, home, away, title }: { matrix: number[][]; home: string; away: string; title: string }) {
  const { bind, node } = useTip();
  const max = Math.max(...matrix.flat());
  const n = matrix.length;
  let ph = 0, pd = 0, pa = 0;
  matrix.forEach((row, h) => row.forEach((v, a) => { if (h > a) ph += v; else if (h === a) pd += v; else pa += v; }));
  return (
    <figure className="chart heatmap">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="hm-wrap">
        <div className="hm-ylabel">{home} goals</div>
        <div>
          <div className="hm-xlabel">{away} goals</div>
          <div className="hm-grid" style={{ gridTemplateColumns: `28px repeat(${n}, minmax(34px, 1fr))` }} role="img" aria-label={`${title}. Most likely scorelines are shown darker.`}>
            <span />
            {matrix[0].map((_, a) => <span key={a} className="hm-axis">{a === n - 1 ? `${a}+` : a}</span>)}
            {matrix.map((row, h) => (
              <Row key={h} h={h} n={n} row={row} max={max} bind={bind} home={home} away={away} />
            ))}
          </div>
        </div>
      </div>
      <div className="hm-legend">
        <span><i style={{ background: RAMPS.home[4] }} />{home} win <b className="num">{pc(ph, 0)}</b></span>
        <span><i style={{ background: RAMPS.draw[3] }} />Draw <b className="num">{pc(pd, 0)}</b></span>
        <span><i style={{ background: RAMPS.away[4] }} />{away} win <b className="num">{pc(pa, 0)}</b></span>
        <span className="muted">Darker = more likely</span>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>{matrix.map((row, h) => <tr key={h}>{row.map((v, a) => <td key={a}>{`${h}-${a}: ${pc(v)}`}</td>)}</tr>)}</tbody>
      </table>
      {node}
    </figure>
  );
}

function Row({ h, n, row, max, bind, home, away }: { h: number; n: number; row: number[]; max: number; bind: ReturnType<typeof useTip>["bind"]; home: string; away: string }) {
  return (
    <>
      <span className="hm-axis">{h === n - 1 ? `${h}+` : h}</span>
      {row.map((v, a) => {
        const t = Math.sqrt(v / max);
        const stops = h > a ? RAMPS.home : h === a ? RAMPS.draw : RAMPS.away;
        return (
          <span key={a} className="hm-cell" style={{ background: ramp(stops, t), color: t > 0.62 ? "#fff" : "#10202f" }} {...bind(<><strong>{home} {h} - {a} {away}</strong><br />Model probability {pc(v)}</>)}>
            {(v * 100).toFixed(v >= 0.1 ? 0 : 1)}
          </span>
        );
      })}
    </>
  );
}

/** Probability mass function bars with an Over/Under threshold marker. */
export function PmfBars({ values, threshold, statLabel, title }: { values: number[]; threshold: number | null; statLabel: string; title: string }) {
  const { bind, node } = useTip();
  const max = Math.max(...values);
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="pmf" role="img" aria-label={`${title}${threshold != null ? `; threshold ${threshold}` : ""}`}>
        {values.map((v, k) => {
          const over = threshold != null && k > threshold;
          return (
            <div key={k} className="pmf-col" {...bind(<><strong>{k} {statLabel}</strong><br />Model probability {pc(v)}</>)}>
              <span className={`pmf-bar ${over ? "over" : ""}`} style={{ height: `${Math.max((v / max) * 100, 1)}%` }} />
              <span className="pmf-k">{k}</span>
              {threshold != null && k === Math.floor(threshold) && <span className="pmf-line" aria-hidden="true" />}
            </div>
          );
        })}
      </div>
      {threshold != null && (
        <div className="legend">
          <span><i className="lg-sw lg-under" /> {statLabel} ≤ {Math.floor(threshold)}</span>
          <span><i className="lg-sw lg-over" /> {statLabel} ≥ {Math.ceil(threshold)} (over {threshold})</span>
        </div>
      )}
      <table className="sr-only"><caption>{title}</caption><tbody>{values.map((v, k) => <tr key={k}><td>{k}</td><td>{pc(v)}</td></tr>)}</tbody></table>
      {node}
    </figure>
  );
}

/** Grouped histogram for two series (home team vs away team samples). */
export function TwoSeriesHistogram({ a, b, aLabel, bLabel, statLabel, title, threshold }: { a: Record<string, number>; b: Record<string, number>; aLabel: string; bLabel: string; statLabel: string; title: string; threshold?: number | null }) {
  const { bind, node } = useTip();
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)].map(Number))].sort((x, y) => x - y);
  if (!keys.length) return <p className="muted small">No observed values in the sample.</p>;
  const full = Array.from({ length: keys[keys.length - 1] - keys[0] + 1 }, (_, i) => keys[0] + i);
  const max = Math.max(...full.map((k) => Math.max(a[k] ?? 0, b[k] ?? 0)), 1);
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="legend">
        <span><i className="lg-sw" style={{ background: "var(--series-home)" }} /> {aLabel}</span>
        <span><i className="lg-sw" style={{ background: "var(--series-away)" }} /> {bLabel}</span>
      </div>
      <div className="hist" role="img" aria-label={title}>
        {full.map((k) => (
          <div key={k} className={`hist-col ${threshold != null && k > threshold ? "is-over" : ""}`}>
            <div className="hist-bars">
              <span className="hist-bar" style={{ height: `${((a[k] ?? 0) / max) * 100}%`, background: "var(--series-home)" }} {...bind(<><strong>{aLabel}</strong><br />{a[k] ?? 0} match(es) with {k} {statLabel}</>)} />
              <span className="hist-bar" style={{ height: `${((b[k] ?? 0) / max) * 100}%`, background: "var(--series-away)" }} {...bind(<><strong>{bLabel}</strong><br />{b[k] ?? 0} match(es) with {k} {statLabel}</>)} />
            </div>
            <span className="pmf-k">{k}</span>
          </div>
        ))}
      </div>
      <p className="chart-note">Each team&apos;s last 10 matches.{threshold != null ? ` Shaded columns are above ${threshold}.` : ""}</p>
      <table className="sr-only"><caption>{title}</caption><thead><tr><th>{statLabel}</th><th>{aLabel}</th><th>{bLabel}</th></tr></thead><tbody>{full.map((k) => <tr key={k}><td>{k}</td><td>{a[k] ?? 0}</td><td>{b[k] ?? 0}</td></tr>)}</tbody></table>
      {node}
    </figure>
  );
}

/** Reliability diagram: predicted vs observed with the perfect-calibration diagonal. */
export function CalibrationChart({ bins, title }: { bins: Array<{ bin: string; n: number; mean_predicted: number; observed_rate: number }>; title: string }) {
  const { bind, node } = useTip();
  const W = 280, H = 220, P = 46;
  const x = (v: number) => P + v * (W - P - 8);
  const y = (v: number) => H - P - v * (H - P - 8);
  const maxN = Math.max(...bins.map((b) => b.n), 1);
  return (
    <figure className="chart calib">
      <figcaption className="chart-title">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}. Points near the diagonal indicate good calibration.`}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="#e6edf2" />
            <text x={P - 6} y={y(t) + 4} fontSize="10" textAnchor="end" fill="#5d6f84">{t * 100}%</text>
            <text x={x(t)} y={H - P + 14} fontSize="10" textAnchor="middle" fill="#5d6f84">{t * 100}%</text>
          </g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#94a3b8" strokeDasharray="4 4" />
        <polyline fill="none" stroke="#0a9d5a" strokeWidth="2" points={bins.map((b) => `${x(b.mean_predicted)},${y(b.observed_rate)}`).join(" ")} />
        {bins.map((b) => (
          <circle key={b.bin} cx={x(b.mean_predicted)} cy={y(b.observed_rate)} r={4 + 4 * Math.sqrt(b.n / maxN)} fill="#0a9d5a" stroke="#fff" strokeWidth="2" {...bind(<><strong>Bin {b.bin}</strong><br />Predicted {pc(b.mean_predicted)} · observed {pc(b.observed_rate)}<br />n = {b.n}</>)} />
        ))}
        <text x={W / 2 + 10} y={H - 4} fontSize="10" textAnchor="middle" fill="#33475b">Predicted probability</text>
        <text x={10} y={H / 2 - 10} fontSize="10" textAnchor="middle" fill="#33475b" transform={`rotate(-90 10 ${H / 2 - 10})`}>Observed rate</text>
      </svg>
      <table className="sr-only"><caption>{title}</caption><thead><tr><th>Bin</th><th>n</th><th>Predicted</th><th>Observed</th></tr></thead><tbody>{bins.map((b) => <tr key={b.bin}><td>{b.bin}</td><td>{b.n}</td><td>{pc(b.mean_predicted)}</td><td>{pc(b.observed_rate)}</td></tr>)}</tbody></table>
      {node}
    </figure>
  );
}

export function FormStrip({ results }: { results: Array<"W" | "D" | "L"> }) {
  return (
    <span className="form-strip" aria-label={`Recent form: ${results.join(" ")}`}>
      {results.map((r, i) => <span key={i} className={`form-chip form-${r}`}>{r}</span>)}
    </span>
  );
}
