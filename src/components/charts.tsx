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

export function ScorelineHeatmap({ matrix, home, away, title, totals }: { matrix: number[][]; home: string; away: string; title: string; totals?: { home: number; draw: number; away: number } }) {
  const { bind, node } = useTip();
  const max = Math.max(...matrix.flat());
  const n = matrix.length;
  // Exact model totals when given; summing the display grid would count the folded 6+/6+ cell as a draw.
  let ph = 0, pd = 0, pa = 0;
  matrix.forEach((row, h) => row.forEach((v, a) => { if (h > a) ph += v; else if (h === a) pd += v; else pa += v; }));
  if (totals) ({ home: ph, draw: pd, away: pa } = totals);
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

/** Model vs league base rate for key markets: one row per market, two dots on a 0-100% track. */
export function BaseRateComparison({ rows, title }: { rows: Array<{ label: string; model: number; base: number }>; title: string }) {
  const { bind, node } = useTip();
  const sorted = [...rows].sort((a, b) => Math.abs(b.model - b.base) - Math.abs(a.model - a.base));
  return (
    <figure className="chart dumbbell">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="db-legend"><span><i className="db-dot base" />League average</span><span><i className="db-dot up" />Model higher</span><span><i className="db-dot down" />Model lower</span></div>
      <div className="db-rows" role="list">
        {sorted.map((r) => {
          const lo = Math.min(r.model, r.base), hi = Math.max(r.model, r.base);
          const dir = r.model >= r.base ? "up" : "down";
          const diff = Math.round((r.model - r.base) * 100);
          return (
            <div key={r.label} className="db-row" role="listitem" {...bind(<><strong>{r.label}</strong><br />Model {pc(r.model, 0)} · league {pc(r.base, 0)} ({diff >= 0 ? "+" : ""}{diff} pts)</>)}>
              <span className="db-label">{r.label}</span>
              <span className="db-track">
                {[25, 50, 75].map((g) => <i key={g} className="db-grid" style={{ left: `${g}%` }} />)}
                <i className={`db-span ${dir}`} style={{ left: `${lo * 100}%`, width: `${Math.max((hi - lo) * 100, 0.6)}%` }} />
                <i className="db-dot base" style={{ left: `${r.base * 100}%` }} />
                <i className={`db-dot ${dir}`} style={{ left: `${r.model * 100}%` }} />
              </span>
              <span className={`db-val num ${dir}`}>{pc(r.model, 0)}<small>{diff >= 0 ? "+" : ""}{diff}</small></span>
            </div>
          );
        })}
      </div>
      <div className="db-axis" aria-hidden="true"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
      {node}
    </figure>
  );
}

/** Total goals in the match (0..6+) from the scoreline matrix, split at the 2.5 line. */
export function TotalGoalsChart({ matrix, title, expectedGoals, under25 }: { matrix: number[][]; title: string; expectedGoals?: number | null; under25?: number | null }) {
  const { bind, node } = useTip();
  const totals = Array.from({ length: 7 }, () => 0);
  matrix.forEach((row, h) => row.forEach((v, a) => { totals[Math.min(h + a, 6)] += v; }));
  const max = Math.max(...totals);
  // F-09: use the model's own expected goals; the folded display grid would treat every 6+ score as exactly 6.
  const under = under25 ?? totals[0] + totals[1] + totals[2];
  const exp = expectedGoals ?? matrix.reduce((s, row, h) => s + row.reduce((t, v, a) => t + v * (h + a), 0), 0);
  return (
    <figure className="chart goals-dist">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="gd-summary">
        <span><b className="num">{pc(under, 0)}</b> under 2.5</span>
        <span><b className="num">{pc(1 - under, 0)}</b> over 2.5</span>
        <span><b className="num">{exp.toFixed(1)}</b> goals expected</span>
      </div>
      <div className="gd-bars" role="img" aria-label={`${title}: ${totals.map((v, i) => `${i === 6 ? "6+" : i} goals ${pc(v, 0)}`).join(", ")}`}>
        {totals.map((v, i) => (
          <div key={i} className={`gd-col ${i <= 2 ? "under" : "over"}`} {...bind(<><strong>{i === 6 ? "6 or more" : i} goal{i === 1 ? "" : "s"}</strong><br />Model probability {pc(v)}</>)}>
            <span className="gd-pct num">{pc(v, 0)}</span>
            <span className="gd-bar" style={{ height: `${(v / max) * 100}%` }} />
            <span className="gd-x">{i === 6 ? "6+" : i}</span>
          </div>
        ))}
        <span className="gd-line" aria-hidden="true"><em>2.5</em></span>
      </div>
      {node}
    </figure>
  );
}

/** Last matches per team: goals scored above the line, conceded below, coloured by result. */
export function FormTimeline({ home, away, form }: { home: string; away: string; form: { home: Array<{ fixture_id: string; starts_at_utc: string; venue: "H" | "A"; opponent: string; goals_for: number; goals_against: number; result: "W" | "D" | "L" }>; away: Array<{ fixture_id: string; starts_at_utc: string; venue: "H" | "A"; opponent: string; goals_for: number; goals_against: number; result: "W" | "D" | "L" }> } }) {
  const { bind, node } = useTip();
  const all = [...form.home, ...form.away];
  const max = Math.max(3, ...all.map((m) => Math.max(m.goals_for, m.goals_against)));
  const team = (name: string, rows: typeof form.home) => {
    const list = [...rows].slice(0, 10).reverse();
    const gf = rows.slice(0, 10).reduce((s, m) => s + m.goals_for, 0), ga = rows.slice(0, 10).reduce((s, m) => s + m.goals_against, 0);
    const pts = rows.slice(0, 10).reduce((s, m) => s + (m.result === "W" ? 3 : m.result === "D" ? 1 : 0), 0);
    return (
      <div className="ft-team">
        <div className="ft-head"><strong>{name}</strong><span className="tiny muted num">{gf} scored · {ga} conceded · {pts} pts from {Math.min(rows.length, 10)}</span></div>
        <div className="ft-grid">
          {list.map((m) => (
            <div key={m.fixture_id} className={`ft-col ft-${m.result}`} {...bind(<><strong>{m.venue === "H" ? "vs" : "at"} {m.opponent}</strong><br />{m.goals_for}-{m.goals_against} · {m.result === "W" ? "Win" : m.result === "D" ? "Draw" : "Loss"}<br />{new Date(m.starts_at_utc).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</>)}>
              <span className="ft-up"><i style={{ height: `${(m.goals_for / max) * 100}%` }} /></span>
              <span className="ft-down"><i style={{ height: `${(m.goals_against / max) * 100}%` }} /></span>
              <span className="ft-res">{m.result}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };
  return (
    <figure className="chart form-timeline">
      <figcaption className="chart-title">Recent form: goals scored (up) and conceded (down)</figcaption>
      {team(home, form.home)}
      {team(away, form.away)}
      <p className="chart-note">Oldest on the left, most recent on the right. Bar colour shows the result.</p>
      {node}
    </figure>
  );
}
