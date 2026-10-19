import { useState, type FormEvent } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useSearchParams } from "react-router";
import { Bookmark, CreditCard, FileText, LayoutDashboard, LogOut, MessageSquare, Settings } from "lucide-react";
import { useAuth } from "../app/auth";
import { api, ApiError, useApi } from "../lib/api";
import { dateTime, kickoffDate } from "../lib/format";
import { DemoPill, EmptyState, Notice, Skeleton } from "../components/ui";

interface Unlock { fixture_id: string; unlocked_at: string; starts_at_utc: string; status: string; home: string; away: string; competition: string; home_goals: number | null; away_goals: number | null; is_synthetic: boolean }

export default function Account() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading && !me) return <div className="container section-tight"><Skeleton h={200} r={12} /></div>;
  if (!me?.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return (
    <div className="container account">
      <aside className="account-nav" aria-label="Account">
        <div className="account-who"><strong>{me.user.display_name}</strong><span className="tiny muted">{me.user.email}</span></div>
        <NavLink end to="/app"><LayoutDashboard size={17} /> Dashboard</NavLink>
        <NavLink to="/app/reports"><FileText size={17} /> My reports</NavLink>
        <NavLink to="/app/credits"><CreditCard size={17} /> Credits</NavLink>
        <NavLink to="/app/feedback"><MessageSquare size={17} /> Feedback</NavLink>
        <NavLink to="/app/settings"><Settings size={17} /> Settings</NavLink>
      </aside>
      <div className="account-main">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="reports" element={<Reports />} />
          <Route path="credits" element={<Credits />} />
          <Route path="feedback" element={<FeedbackPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  );
}

function Dashboard() {
  const { me } = useAuth();
  const [sp] = useSearchParams();
  const unlocks = useApi<{ items: Unlock[] }>("/me/unlocks");
  const saved = useApi<{ items: Array<{ fixture_id: string }> }>("/me/saved");
  return (
    <>
      <div className="page-head"><h1>Welcome, {me!.user!.display_name.split(" ")[0]}</h1></div>
      {sp.get("welcome") && <Notice tone="info">Your account is ready with <strong>{me?.credits} free report credits</strong>. Start with the <Link className="link" to="/matches">match calendar</Link>, unlock a match, then tell us what you think on the <Link className="link" to="/app/feedback">feedback page</Link>.</Notice>}
      <div className="grid-3 kpi-row" style={{ marginTop: 16 }}>
        <div className="card card-pad kpi"><span className="tiny muted">Report credits</span><strong className="num">{me?.credits ?? 0}</strong><Link className="link small" to="/app/credits">View ledger</Link></div>
        <div className="card card-pad kpi"><span className="tiny muted">Unlocked reports</span><strong className="num">{me?.unlocked_reports ?? 0}</strong><Link className="link small" to="/app/reports">Open reports</Link></div>
        <div className="card card-pad kpi"><span className="tiny muted">Saved matches</span><strong className="num">{saved.data?.items.length ?? 0}</strong><Link className="link small" to="/matches">Browse matches</Link></div>
      </div>
      <section className="card card-pad" style={{ marginTop: 16 }}>
        <h2 className="h-card">Recent reports</h2>
        <UnlockList items={(unlocks.data?.items ?? []).slice(0, 5)} loading={unlocks.loading} />
      </section>
      {(saved.data?.items.length ?? 0) > 0 && (
        <section className="card card-pad" style={{ marginTop: 16 }}>
          <h2 className="h-card"><Bookmark size={16} /> Saved matches</h2>
          <ul className="mini-list">{saved.data!.items.map((s) => <li key={s.fixture_id}><Link to={`/matches/${encodeURIComponent(s.fixture_id)}`}>{s.fixture_id}</Link></li>)}</ul>
        </section>
      )}
    </>
  );
}

function UnlockList({ items, loading }: { items: Unlock[]; loading: boolean }) {
  if (loading && !items.length) return <Skeleton h={80} />;
  if (!items.length) return <EmptyState title="No reports unlocked yet"><Link className="link" to="/matches">Find a match to research</Link></EmptyState>;
  return (
    <ul className="report-list">
      {items.map((u) => (
        <li key={u.fixture_id}>
          <Link to={`/matches/${encodeURIComponent(u.fixture_id)}`} className="report-item">
            <span><strong>{u.home}</strong> vs <strong>{u.away}</strong><span className="tiny muted">{u.competition} · {kickoffDate(u.starts_at_utc)}</span></span>
            {u.is_synthetic && <DemoPill label="Synthetic" />}
            <span className="tiny muted">Unlocked {dateTime(u.unlocked_at)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Reports() {
  const unlocks = useApi<{ items: Unlock[] }>("/me/unlocks");
  return (
    <>
      <div className="page-head"><h1>My reports</h1><p className="muted">Every match you unlock stays readable, including later refreshes, at no extra cost.</p></div>
      <section className="card card-pad"><UnlockList items={unlocks.data?.items ?? []} loading={unlocks.loading} /></section>
    </>
  );
}

function Credits() {
  const { data } = useApi<{ balance: number; ledger: Array<{ id: string; amount_signed: number; kind: string; reason: string; created_at: string; metadata: { fixture_id?: string } }>; policy: { entitlement_scope: string; expiry: string; unit: string } }>("/me/credits");
  return (
    <>
      <div className="page-head"><h1>Credits</h1><p className="muted">{data?.policy.unit}. Expiry: {data?.policy.expiry ?? "-"}.</p></div>
      <div className="card card-pad kpi" style={{ maxWidth: 280 }}><span className="tiny muted">Balance</span><strong className="num">{data?.balance ?? "-"}</strong></div>
      <section className="card card-pad" style={{ marginTop: 16 }}>
        <h2 className="h-card">Ledger</h2>
        <p className="tiny muted">Append-only record. Corrections appear as new entries; nothing is edited.</p>
        <div className="table-scroll"><table className="dtable">
          <thead><tr><th>Date</th><th>Type</th><th>Reason</th><th>Change</th></tr></thead>
          <tbody>{(data?.ledger ?? []).map((l) => (
            <tr key={l.id}><td className="nowrap">{dateTime(l.created_at)}</td><td>{l.kind.replace("_", " ")}</td><td>{l.reason}{l.metadata.fixture_id && <> · <Link className="link" to={`/matches/${encodeURIComponent(l.metadata.fixture_id)}`}>match</Link></>}</td><td className={`num ${l.amount_signed > 0 ? "pos" : "neg"}`}>{l.amount_signed > 0 ? "+" : ""}{l.amount_signed}</td></tr>
          ))}</tbody>
        </table></div>
      </section>
      <p className="small muted" style={{ marginTop: 12 }}>No purchases are possible during the beta.</p>
    </>
  );
}

const QUESTIONS: Array<[string, string]> = [
  ["aesthetics", "How does the design look and feel?"],
  ["mobile", "How usable is it on your phone?"],
  ["usefulness", "How useful was the analysis for your research?"],
  ["trust", "Do you trust the evidence? What would increase trust?"],
  ["gaps", "What features or markets are missing?"],
  ["price_sensitivity", "Would you pay about USD 3 for 10 reports? Why or why not?"],
  ["speed", "How fast did pages load for you?"],
  ["confusing", "Was anything confusing or badly worded?"],
];

function FeedbackPage() {
  const [rating, setRating] = useState(4);
  const [category, setCategory] = useState("general");
  const [text, setText] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [fixture, setFixture] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = useApi<{ items: Array<{ id: string; category: string; rating: number; text: string; created_at: string; triage_status: string }> }>("/me/feedback");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/feedback", { json: { rating, category, text, answers, fixture_id: fixture || null } });
      setMsg({ ok: true, t: "Thank you! Your feedback was recorded." });
      setText("");
      setAnswers({});
      mine.reload();
    } catch (e2) {
      setMsg({ ok: false, t: (e2 as ApiError).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-head"><h1>Beta feedback</h1><p className="muted">Please be candid. Short answers are fine. Report wrong data with the category “Inaccuracy” and the match ID from the address bar.</p></div>
      <form className="card card-pad feedback-form" onSubmit={submit}>
        {msg && <p className={msg.ok ? "form-ok" : "form-error"} role="status">{msg.t}</p>}
        <div className="grid-2">
          <div className="field"><label htmlFor="cat">Category</label>
            <select id="cat" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {["general", "bug", "inaccuracy", "design", "mobile", "pricing", "feature_request"].map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
            </select>
          </div>
          <div className="field"><label htmlFor="fx">Match ID (optional)</label><input id="fx" className="input" value={fixture} onChange={(e) => setFixture(e.target.value)} placeholder="e.g. demo:dpd:2026-27:r11:m1" /></div>
        </div>
        <fieldset className="rating"><legend className="label">Overall rating</legend>
          {[1, 2, 3, 4, 5].map((n) => <label key={n} className={`rate ${rating === n ? "on" : ""}`}><input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />{n}</label>)}
        </fieldset>
        {QUESTIONS.map(([k, q]) => (
          <div key={k} className="field"><label htmlFor={`q-${k}`}>{q}</label><input id={`q-${k}`} className="input" maxLength={1000} value={answers[k] ?? ""} onChange={(e) => setAnswers({ ...answers, [k]: e.target.value })} /></div>
        ))}
        <div className="field"><label htmlFor="text">Anything else? (required)</label><textarea id="text" className="textarea" required minLength={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} /></div>
        <button className="btn btn-primary" disabled={busy || text.trim().length < 3}>{busy ? "Sending..." : "Send feedback"}</button>
      </form>
      {(mine.data?.items.length ?? 0) > 0 && (
        <section className="card card-pad" style={{ marginTop: 16 }}>
          <h2 className="h-card">Your previous feedback</h2>
          <ul className="mini-list">{mine.data!.items.map((f) => <li key={f.id}><strong>{f.category}</strong> · {f.rating}/5 · <span className="muted">{f.text.slice(0, 120)}</span> <span className="pill pill-gray">{f.triage_status}</span></li>)}</ul>
        </section>
      )}
    </>
  );
}

function SettingsPage() {
  const { me, logout, refresh } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const request = async (kind: "export" | "delete") => {
    if (kind === "delete" && !confirm("Request deletion of your account and data? The administrator will process it manually.")) return;
    await api("/me/data-request", { json: { kind } });
    setMsg(`Your ${kind} request was recorded.`);
  };
  const consent = async () => {
    await api("/me/consent", { json: { age_confirmed: true, privacy_consent: true } });
    refresh();
  };
  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      {msg && <p className="form-ok">{msg}</p>}
      <section className="card card-pad stack">
        <h2 className="h-card">Profile</h2>
        <dl className="driver-list">
          <div><dt>Name</dt><dd>{me?.user?.display_name}</dd></div>
          <div><dt>Email</dt><dd>{me?.user?.email}</dd></div>
          <div><dt>Role</dt><dd>{me?.user?.role}</dd></div>
          <div><dt>18+ confirmed</dt><dd>{dateTime(me?.user?.age_confirmed_at)}</dd></div>
          <div><dt>Privacy consent</dt><dd>{dateTime(me?.user?.privacy_consent_at)}</dd></div>
        </dl>
        {!me?.user?.age_confirmed_at && <button className="btn btn-outline" onClick={() => void consent()}>Confirm I am 18+ and accept the privacy notice</button>}
      </section>
      <section className="card card-pad stack" style={{ marginTop: 16 }}>
        <h2 className="h-card">Sessions</h2>
        <div className="row-wrap">
          <button className="btn btn-outline" onClick={() => void logout()}><LogOut size={16} /> Sign out</button>
          <button className="btn btn-outline" onClick={async () => { await api("/me/sessions/revoke-all", { method: "POST" }); await logout(); }}>Sign out everywhere</button>
        </div>
      </section>
      <section className="card card-pad stack" style={{ marginTop: 16 }}>
        <h2 className="h-card">Your data</h2>
        <p className="small muted">Request a copy of your data, or deletion of your account and personal data.</p>
        <div className="row-wrap">
          <button className="btn btn-outline" onClick={() => void request("export")}>Request data export</button>
          <button className="btn btn-danger" onClick={() => void request("delete")}>Request account deletion</button>
        </div>
      </section>
    </>
  );
}
