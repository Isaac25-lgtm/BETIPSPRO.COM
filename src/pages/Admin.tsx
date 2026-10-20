import { useState, type FormEvent, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router";
import { Activity, ClipboardList, Cog, Database, FileBarChart, Gauge, MessageSquare, Server, Users } from "lucide-react";
import { useAuth } from "../app/auth";
import { api, ApiError, idempotencyKey, useApi } from "../lib/api";
import { dateTime } from "../lib/format";
import { DemoPill, ErrorState, Notice, Skeleton } from "../components/ui";

export default function Admin() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading && !me) return <div className="container section-tight"><Skeleton h={200} /></div>;
  if (!me?.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (me.user.role !== "admin") return <div className="container section-tight"><ErrorState title="Administrator access required" message="Your account does not have admin permissions." /></div>;
  return (
    <div className="container account admin">
      <aside className="account-nav" aria-label="Admin">
        <div className="account-who"><strong>Admin console</strong><span className="tiny muted">Every action is audited</span></div>
        <NavLink end to="/admin"><Gauge size={17} /> Overview</NavLink>
        <NavLink to="/admin/testers"><Users size={17} /> Testers & invites</NavLink>
        <NavLink to="/admin/credits"><ClipboardList size={17} /> Credits ledger</NavLink>
        <NavLink to="/admin/fixtures"><Database size={17} /> Fixtures</NavLink>
        <NavLink to="/admin/ingestion"><Server size={17} /> Ingestion & API budget</NavLink>
        <NavLink to="/admin/forecasts"><FileBarChart size={17} /> Forecasts & coverage</NavLink>
        <NavLink to="/admin/feedback"><MessageSquare size={17} /> Feedback</NavLink>
        <NavLink to="/admin/audit"><Activity size={17} /> Audit log</NavLink>
        <NavLink to="/admin/config"><Cog size={17} /> Config</NavLink>
      </aside>
      <div className="account-main">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="testers" element={<Testers />} />
          <Route path="credits" element={<Ledger />} />
          <Route path="fixtures" element={<Fixtures />} />
          <Route path="ingestion" element={<Ingestion />} />
          <Route path="api-budget" element={<Ingestion />} />
          <Route path="forecasts" element={<Forecasts />} />
          <Route path="coverage" element={<Forecasts />} />
          <Route path="feedback" element={<Feedback />} />
          <Route path="audit" element={<Audit />} />
          <Route path="config" element={<Config />} />
        </Routes>
      </div>
    </div>
  );
}

function Head({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="page-head"><h1>{title}</h1>{children && <p className="muted">{children}</p>}</div>;
}

function Table({ cols, rows }: { cols: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-scroll"><table className="dtable">
      <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.length === 0 ? <tr><td colSpan={cols.length} className="muted">Nothing yet.</td></tr> : rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

interface Overview {
  environment: { app_env: string; data_mode: string; version: string; payments_enabled: boolean };
  beta: { max_testers: number; initial_credits: number; invites: Array<{ status: string; n: number }>; users: Array<{ role: string; n: number }>; weekly_active_testers: number };
  credits: Array<{ kind: string; total: number; n: number }>;
  unlocks: { total: number; distinct_fixtures: number; users: number };
  feedback: { n: number; avg_rating: number | null; untriaged: number };
  provider: { configured: boolean; used_today: number; operational_budget: number; hard_cap: number; reserve: number; per_minute_max: number; provider_reported: { limit: number | null; remaining: number | null }; last_successful_call: { created_at: string } | null };
  stale_live_fixtures: number;
  model_runs: Array<{ id: string; model_version: string; data_mode: string; generated_at: string }>;
  ai: { enabled: boolean; credentials_configured: boolean; monthly_budget_usd: number };
}

function Overview() {
  const { data, error } = useApi<Overview>("/admin/overview", { ttlMs: 10_000 });
  if (error) return <ErrorState message={error.message} />;
  if (!data) return <Skeleton h={300} />;
  const cnt = (arr: Array<{ n: number; [k: string]: unknown }>, k: string, v: string) => arr.find((x) => x[k] === v)?.n ?? 0;
  const granted = data.credits.filter((c) => c.total > 0).reduce((s, c) => s + c.total, 0);
  const spent = -(data.credits.find((c) => c.kind === "spend")?.total ?? 0);
  const p = data.provider;
  return (
    <>
      <Head title="Overview">Environment <strong>{data.environment.app_env}</strong> · data mode <strong>{data.environment.data_mode}</strong> · version {data.environment.version}</Head>
      {data.environment.data_mode === "DEMO" && <Notice tone="demo">Provider not configured: the site serves synthetic demo data. Provider usage of 0 calls here is a demo figure, not a demonstrated production cost.</Notice>}
      <div className="grid-4 kpi-row" style={{ marginTop: 16 }}>
        <Kpi label="Testers active" value={`${cnt(data.beta.users, "role", "tester")} / ${data.beta.max_testers}`} sub={`${cnt(data.beta.invites, "status", "issued")} invites pending`} />
        <Kpi label="Weekly active testers" value={data.beta.weekly_active_testers} />
        <Kpi label="Credits granted / spent" value={`${granted} / ${spent}`} sub={`${data.unlocks.distinct_fixtures} distinct fixtures unlocked`} />
        <Kpi label="Feedback" value={data.feedback.n} sub={data.feedback.avg_rating ? `avg ${data.feedback.avg_rating.toFixed(1)}/5 · ${data.feedback.untriaged} new` : "none yet"} />
      </div>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card card-pad">
          <h2 className="h-card">Sports API (API-Football)</h2>
          <BudgetBar used={p.used_today} budget={p.operational_budget} cap={p.hard_cap} />
          <dl className="driver-list">
            <div><dt>Configured</dt><dd>{p.configured ? "Yes (key hidden)" : "No"}</dd></div>
            <div><dt>Per-minute limit</dt><dd>{p.per_minute_max}</dd></div>
            <div><dt>Provider-reported remaining</dt><dd>{p.provider_reported.remaining ?? "unknown"}</dd></div>
            <div><dt>Last successful call</dt><dd>{dateTime(p.last_successful_call?.created_at)}</dd></div>
            <div><dt>Stale live fixtures</dt><dd>{data.stale_live_fixtures}</dd></div>
          </dl>
        </section>
        <section className="card card-pad">
          <h2 className="h-card">Models & AI</h2>
          <Table cols={["Run", "Mode", "Generated"]} rows={data.model_runs.map((r) => [<span className="mono tiny">{r.id}</span>, r.data_mode === "SIMULATED_DEMO" ? <DemoPill label="Synthetic" /> : r.data_mode, dateTime(r.generated_at)])} />
          <p className="small" style={{ marginTop: 10 }}>Gemini explanations: <strong>{data.ai.enabled ? "enabled" : "disabled"}</strong> · credentials {data.ai.credentials_configured ? "configured" : "not configured"} · monthly budget ${data.ai.monthly_budget_usd}</p>
        </section>
      </div>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return <div className="card card-pad kpi"><span className="tiny muted">{label}</span><strong className="num">{value}</strong>{sub && <span className="tiny muted">{sub}</span>}</div>;
}

function BudgetBar({ used, budget, cap }: { used: number; budget: number; cap: number }) {
  return (
    <div className="budget">
      <div className="budget-bar" role="img" aria-label={`${used} of ${cap} requests used today`}>
        <span className="budget-used" style={{ width: `${(used / cap) * 100}%` }} />
        <span className="budget-mark" style={{ left: `${(budget / cap) * 100}%` }} />
      </div>
      <div className="row tiny muted" style={{ justifyContent: "space-between" }}><span><strong className="num">{used}</strong> used today (UTC)</span><span>budget {budget} · reserve {cap - budget} · hard cap {cap}</span></div>
    </div>
  );
}

function Testers() {
  const testers = useApi<{ items: Array<{ id: string; email: string; display_name: string; role: string; status: string; balance: number; unlocks: number; last_session: string | null }> }>("/admin/testers");
  const invites = useApi<{ items: Array<{ id: string; email: string; status: string; issued_at: string; expires_at: string; used_at: string | null }> }>("/admin/invitations");
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<{ email: string; code: string; expires_at: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [grant, setGrant] = useState<{ user: string; amount: number; reason: string }>({ user: "", amount: 1, reason: "" });
  const [gmsg, setGmsg] = useState<string | null>(null);
  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api<{ email: string; code: string; expires_at: string }>("/admin/invitations", { json: { email } });
      setCreated(r);
      setEmail("");
      invites.reload();
    } catch (e2) {
      setErr((e2 as ApiError).message);
    }
  };
  const doGrant = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api<{ duplicate: boolean; balance: number }>("/admin/credits/grant", { json: { user_id: grant.user, amount: grant.amount, reason: grant.reason }, headers: { "Idempotency-Key": idempotencyKey() } });
      setGmsg(r.duplicate ? "Duplicate request ignored." : `Done. New balance ${r.balance}.`);
      testers.reload();
    } catch (e2) {
      setGmsg((e2 as ApiError).message);
    }
  };
  return (
    <>
      <Head title="Testers & invitations">Invite exactly the testers you intend (max 5). Codes are one-use, email-bound, expire in 14 days and are shown once.</Head>
      <form className="card card-pad row-wrap" onSubmit={invite}>
        <input className="input" style={{ maxWidth: 320 }} type="email" placeholder="tester@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Tester email" />
        <button className="btn btn-primary">Create invitation</button>
        {err && <span className="form-error">{err}</span>}
      </form>
      {created && (
        <Notice tone="info">
          Invitation for <strong>{created.email}</strong>: code <code className="mono">{created.code}</code> (expires {dateTime(created.expires_at)}). Copy it now; it cannot be shown again. Send it privately with the link <code className="mono">{location.origin}/join</code>.
        </Notice>
      )}
      <section className="card card-pad" style={{ marginTop: 16 }}>
        <h2 className="h-card">Users</h2>
        <Table cols={["Name", "Email", "Role", "Credits", "Unlocks", "Last session", "ID"]} rows={(testers.data?.items ?? []).map((u) => [u.display_name, u.email, u.role, u.balance, u.unlocks, dateTime(u.last_session), <span className="mono tiny">{u.id}</span>])} />
      </section>
      <section className="card card-pad" style={{ marginTop: 16 }}>
        <h2 className="h-card">Invitations</h2>
        <Table cols={["Email", "Status", "Issued", "Expires", "Used", ""]} rows={(invites.data?.items ?? []).map((i) => [i.email, i.status, dateTime(i.issued_at), dateTime(i.expires_at), dateTime(i.used_at), i.status === "issued" ? <button className="btn btn-ghost btn-sm" onClick={async () => { await api(`/admin/invitations/${i.id}/revoke`, { method: "POST" }); invites.reload(); }}>Revoke</button> : null])} />
      </section>
      <form className="card card-pad stack" style={{ marginTop: 16 }} onSubmit={doGrant}>
        <h2 className="h-card">Manual credit adjustment (audited)</h2>
        <div className="grid-3">
          <select className="select" value={grant.user} onChange={(e) => setGrant({ ...grant, user: e.target.value })} required aria-label="User">
            <option value="">Choose user</option>
            {(testers.data?.items ?? []).map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
          </select>
          <input className="input" type="number" min={-100} max={100} value={grant.amount} onChange={(e) => setGrant({ ...grant, amount: Number(e.target.value) })} aria-label="Amount" />
          <input className="input" placeholder="Reason (required)" value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.target.value })} required minLength={3} aria-label="Reason" />
        </div>
        <div className="row"><button className="btn btn-dark">Apply</button>{gmsg && <span className="small">{gmsg}</span>}</div>
      </form>
    </>
  );
}

function Ledger() {
  const { data } = useApi<{ items: Array<{ id: string; email: string; amount_signed: number; kind: string; reason: string; idempotency_key: string; created_at: string }> }>("/admin/credits/ledger");
  return (
    <>
      <Head title="Credits ledger">Append-only. A database trigger blocks updates and deletes.</Head>
      <section className="card card-pad"><Table cols={["Date", "User", "Kind", "Change", "Reason", "Idempotency key"]} rows={(data?.items ?? []).map((l) => [dateTime(l.created_at), l.email, l.kind, <strong className="num">{l.amount_signed > 0 ? "+" : ""}{l.amount_signed}</strong>, l.reason, <span className="mono tiny">{l.idempotency_key.slice(0, 40)}</span>])} /></section>
    </>
  );
}

function Fixtures() {
  const { data, reload } = useApi<{ items: Array<{ id: string; starts_at_utc: string; status: string; is_synthetic: number; is_public_sample: number; competition: string; home: string; away: string; reports: number; unlocks: number; stat_rows: number }> }>("/admin/fixtures");
  return (
    <>
      <Head title="Fixtures">Upcoming and recent fixtures, report availability and unlock counts. One fixture can be the free public sample.</Head>
      <section className="card card-pad"><Table cols={["Kick-off", "Match", "Status", "Report", "Unlocks", "Sample"]} rows={(data?.items ?? []).map((f) => [dateTime(f.starts_at_utc), <>{f.home} vs {f.away}<div className="tiny muted">{f.competition}{f.is_synthetic ? " · synthetic" : ""}</div></>, f.status, f.reports ? "Yes" : "No", f.unlocks, f.is_public_sample ? <strong>Public sample</strong> : f.reports ? <button className="btn btn-ghost btn-sm" onClick={async () => { await api(`/admin/fixtures/${encodeURIComponent(f.id)}/public-sample`, { method: "POST" }); reload(); }}>Make sample</button> : null])} /></section>
    </>
  );
}

function Ingestion() {
  const usage = useApi<{ configured: boolean; used_today: number; operational_budget: number; hard_cap: number; reserve: number; per_minute_max: number; by_endpoint_today: Array<{ endpoint: string; status: string; calls: number; avg_ms: number }>; daily_history: Array<{ utc_day: string; calls: number }>; resets: string }>("/admin/usage", { ttlMs: 5000 });
  const jobs = useApi<{ items: Array<{ id: string; kind: string; status: string; provider_calls: number; started_at: string; error_code: string | null; detail: { message?: string } }> }>("/admin/jobs", { ttlMs: 5000 });
  const [form, setForm] = useState({ kind: "status", date: "", league: "", season: "", ids: "", fixture: "", team: "" });
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setOut(null);
    const body: Record<string, unknown> = { kind: form.kind };
    if (form.date) body.date = form.date;
    if (form.league) body.league = form.league;
    if (form.season) body.season = form.season;
    if (form.fixture) body.fixture = form.fixture;
    if (form.team) body.team = form.team;
    if (form.ids) body.provider_ids = form.ids.split(/[\s,-]+/).filter(Boolean);
    if (form.kind === "status") body.priority = "reserve";
    try {
      setOut(JSON.stringify(await api("/admin/ingest", { json: body }), null, 2));
    } catch (e2) {
      setOut(`${(e2 as ApiError).code}: ${(e2 as ApiError).message}`);
    } finally {
      setBusy(false);
      usage.reload();
      jobs.reload();
    }
  };
  const u = usage.data;
  return (
    <>
      <Head title="Ingestion & API budget">One shared, atomic D1 budget gates every upstream call (cron, admin and pipeline). Jobs run one at a time.</Head>
      {u && !u.configured && <Notice tone="warn"><strong>API-Football key not configured.</strong> Follow <code>docs/setup-free-api-football.md</code>: create ONE free account at dashboard.api-football.com, put the key in <code>.dev.vars</code> as <code>API_FOOTBALL_KEY</code> and set <code>SPORTS_PROVIDER=api_football</code>. Never paste the key into chat or Git.</Notice>}
      {u && <section className="card card-pad" style={{ marginTop: 16 }}><h2 className="h-card">Today</h2><BudgetBar used={u.used_today} budget={u.operational_budget} cap={u.hard_cap} /><p className="tiny muted">{u.resets}. Per-minute max {u.per_minute_max}.</p>
        <Table cols={["Endpoint", "Status", "Calls", "Avg ms"]} rows={u.by_endpoint_today.map((r) => [r.endpoint, r.status, r.calls, Math.round(r.avg_ms)])} /></section>}
      <form className="card card-pad stack" style={{ marginTop: 16 }} onSubmit={run}>
        <h2 className="h-card">Run an ingestion job</h2>
        <div className="grid-3">
          <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Job kind">
            <option value="status">Connection test (/status, 1 reserve call)</option>
            <option value="fixtures_by_date">Fixtures by date (1 call)</option>
            <option value="league_season">League season results (1 call)</option>
            <option value="fixture_details">Fixture details + stats (≤20 ids, 1 call)</option>
            <option value="team_last">Team last N matches (1 call)</option>
            <option value="odds">Odds for a fixture (1 call)</option>
          </select>
          <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label="Date" />
          <input className="input" placeholder="League id (e.g. 39)" value={form.league} onChange={(e) => setForm({ ...form, league: e.target.value })} aria-label="League" />
          <input className="input" placeholder="Season (e.g. 2023)" value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} aria-label="Season" />
          <input className="input" placeholder="Fixture provider ids (comma)" value={form.ids} onChange={(e) => setForm({ ...form, ids: e.target.value })} aria-label="Fixture ids" />
          <input className="input" placeholder="Fixture id (odds) / team id" value={form.fixture || form.team} onChange={(e) => setForm({ ...form, fixture: form.kind === "odds" ? e.target.value : "", team: form.kind === "team_last" ? e.target.value : "" })} aria-label="Fixture or team id" />
        </div>
        <button className="btn btn-dark" disabled={busy}>{busy ? "Running..." : "Run job"}</button>
        {out && <pre className="code-out">{out}</pre>}
      </form>
      <section className="card card-pad" style={{ marginTop: 16 }}>
        <h2 className="h-card">Recent jobs</h2>
        <Table cols={["Started", "Kind", "Status", "Provider calls", "Error"]} rows={(jobs.data?.items ?? []).map((j) => [dateTime(j.started_at), j.kind, j.status, j.provider_calls, j.error_code ? `${j.error_code}: ${j.detail.message ?? ""}` : ""])} />
      </section>
    </>
  );
}

function Forecasts() {
  const f = useApi<{ runs: Array<{ id: string; model_version: string; data_mode: string; generated_at: string; data_as_of_at: string; forecasts: number }>; by_status: Array<{ status: string; is_pre_kickoff: number; n: number }> }>("/admin/forecasts");
  const c = useApi<{ competitions: Array<{ id: string; name: string; is_synthetic: number; rights_status: string; fixtures: number; completed: number; with_ht: number; with_corners: number; with_cards: number; with_real_odds: number; reports: number }>; market_families: Array<{ family: string; tier: string; markets: number; validation_status: string; licensing_status: string }>; rights_gate: string }>("/admin/coverage");
  return (
    <>
      <Head title="Forecasts & coverage">Imported model runs, forecast statuses and data/rights coverage by competition.</Head>
      <Notice tone="warn">{c.data?.rights_gate ?? "Rights review pending."}</Notice>
      <section className="card card-pad" style={{ marginTop: 16 }}><h2 className="h-card">Model runs</h2><Table cols={["Run", "Mode", "Generated", "Data as of", "Forecasts"]} rows={(f.data?.runs ?? []).map((r) => [<span className="mono tiny">{r.id}</span>, r.data_mode, dateTime(r.generated_at), dateTime(r.data_as_of_at), r.forecasts])} /></section>
      <section className="card card-pad" style={{ marginTop: 16 }}><h2 className="h-card">Forecasts by status</h2><Table cols={["Status", "Pre-kickoff", "Count"]} rows={(f.data?.by_status ?? []).map((r) => [r.status, r.is_pre_kickoff ? "yes" : "backtest", r.n])} /></section>
      <section className="card card-pad" style={{ marginTop: 16 }}><h2 className="h-card">Competition coverage</h2><Table cols={["Competition", "Rights", "Fixtures", "Results", "HT", "Corners", "Cards", "Real odds", "Reports"]} rows={(c.data?.competitions ?? []).map((x) => [<>{x.name}{x.is_synthetic ? <> <DemoPill label="Synthetic" /></> : null}</>, x.rights_status, x.fixtures, x.completed, x.with_ht, x.with_corners, x.with_cards, x.with_real_odds, x.reports])} /></section>
      <section className="card card-pad" style={{ marginTop: 16 }}><h2 className="h-card">Market families</h2><Table cols={["Family", "Tier", "Markets", "Validation", "Licensing"]} rows={(c.data?.market_families ?? []).map((m) => [m.family, m.tier, m.markets, m.validation_status, m.licensing_status])} /></section>
    </>
  );
}

function Feedback() {
  const { data, reload } = useApi<{ items: Array<{ id: string; email: string; fixture_id: string | null; rating: number; category: string; text: string; answers: Record<string, string>; created_at: string; triage_status: string }> }>("/admin/feedback");
  return (
    <>
      <Head title="Beta feedback" />
      <div className="stack">
        {(data?.items ?? []).length === 0 && <p className="muted">No feedback yet.</p>}
        {(data?.items ?? []).map((f) => (
          <section key={f.id} className="card card-pad">
            <div className="row-wrap"><strong>{f.email}</strong><span className="pill pill-gray">{f.category}</span><span>{f.rating}/5</span><span className="tiny muted">{dateTime(f.created_at)}</span><span className="spacer" />
              <select className="select" style={{ width: 150, minHeight: 36 }} value={f.triage_status} onChange={async (e) => { await api(`/admin/feedback/${f.id}`, { method: "PATCH", json: { triage_status: e.target.value } }); reload(); }} aria-label="Triage status">
                {["new", "triaged", "resolved", "wontfix"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <p style={{ marginTop: 8 }}>{f.text}</p>
            {Object.entries(f.answers).length > 0 && <dl className="driver-list">{Object.entries(f.answers).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
            {f.fixture_id && <p className="tiny muted">Fixture: {f.fixture_id}</p>}
          </section>
        ))}
      </div>
    </>
  );
}

function Audit() {
  const { data } = useApi<{ items: Array<{ id: string; actor_id: string; action: string; entity: string; entity_id: string | null; after_json: string | null; created_at: string }> }>("/admin/audit");
  return (
    <>
      <Head title="Audit log" />
      <section className="card card-pad"><Table cols={["When", "Actor", "Action", "Entity", "Details"]} rows={(data?.items ?? []).map((a) => [dateTime(a.created_at), <span className="mono tiny">{a.actor_id}</span>, a.action, `${a.entity}${a.entity_id ? `:${a.entity_id.slice(0, 30)}` : ""}`, <span className="mono tiny">{(a.after_json ?? "").slice(0, 120)}</span>])} /></section>
    </>
  );
}

function Config() {
  const { data, reload } = useApi<{ runtime: Array<{ key: string; value: unknown; updated_at: string }>; environment_flags: Record<string, unknown> }>("/admin/config");
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const access = data?.runtime.find((r) => r.key === "access")?.value as { open?: boolean } | undefined;
  const open = !!access?.open;
  const toggle = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api("/admin/config/access", { method: "PUT", json: { open: !open } });
      setMsg(!open ? "Every report is now open to everyone." : "Reports are locked again. Testers unlock them with credits.");
      reload();
      refresh();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not save the setting.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Head title="Configuration">Environment flags come from wrangler.jsonc / secrets. Secrets are reported only as present or absent.</Head>
      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <h2 className="h-card">Report access</h2>
        <p className="small muted" style={{ margin: "6px 0 12px" }}>
          {open
            ? "Open: anyone can read every full report, signed in or not, and no credits are used. Use this while testing."
            : "Locked: full reports need a credit (the public sample stays free). Credits and unlocks work as normal."}
        </p>
        <button className={`btn ${open ? "btn-outline" : "btn-primary"} btn-sm`} disabled={busy || !data} onClick={() => void toggle()}>
          {busy ? "Saving..." : open ? "Lock reports (use credits)" : "Open every report"}
        </button>
        {msg && <p className="form-ok small" role="status" style={{ marginTop: 10 }}>{msg}</p>}
        <p className="tiny muted" style={{ marginTop: 8 }}>Reports switch immediately; banners and copy on public pages can take up to 5 minutes to update.</p>
      </section>
      <section className="card card-pad"><h2 className="h-card">Environment</h2><pre className="code-out">{JSON.stringify(data?.environment_flags ?? {}, null, 2)}</pre></section>
      <section className="card card-pad" style={{ marginTop: 16 }}><h2 className="h-card">Runtime config</h2><pre className="code-out">{JSON.stringify(data?.runtime ?? [], null, 2)}</pre></section>
    </>
  );
}
