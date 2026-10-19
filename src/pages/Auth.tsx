import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../app/auth";
import { api, ApiError, invalidate } from "../lib/api";
import { Logo } from "../components/ui";

function safeNext(n: string | null) {
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/app";
}

export default function Login() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/auth/login", { json: { email, password } });
      invalidate("");
      refresh();
      nav(safeNext(sp.get("next")));
    } catch (e2) {
      setErr((e2 as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit} noValidate>
        <div className="auth-logo"><Logo dark={false} compact /></div>
        <h1>Sign in</h1>
        <p className="muted small">The beta is invite-only. Use the email and password you set when you accepted your invitation.</p>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button className="btn btn-primary btn-block" disabled={busy || !email || !password}>{busy ? "Signing in..." : "Sign in"}</button>
        <p className="small muted">Have an invitation code? <Link className="link" to="/join">Accept your invite</Link></p>
      </form>
    </div>
  );
}

export function Join() {
  const nav = useNavigate();
  const { refresh, config } = useAuth();
  const [sp] = useSearchParams();
  const [f, setF] = useState({ code: sp.get("code") ?? "", email: sp.get("email") ?? "", display_name: "", password: "", age_confirmed: false, privacy_consent: false });
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setFieldErrs({});
    try {
      await api("/auth/redeem-invite", { json: f });
      invalidate("");
      refresh();
      nav("/app?welcome=1");
    } catch (e2) {
      const ae = e2 as ApiError;
      setErr(ae.message);
      const d = ae.details as { fieldErrors?: Record<string, string[]> } | null;
      if (d?.fieldErrors) setFieldErrs(d.fieldErrors);
    } finally {
      setBusy(false);
    }
  };
  const fe = (k: string) => fieldErrs[k]?.[0] && <span className="tiny" style={{ color: "#9a3412" }}>{fieldErrs[k][0]}</span>;
  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit} noValidate>
        <div className="auth-logo"><Logo dark={false} compact /></div>
        <h1>Join the beta</h1>
        <p className="muted small">Invite-only: {config?.max_beta_users ?? 5} testers, {config?.beta_initial_credits ?? 10} free report credits each. No payment details are ever requested.</p>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="field"><label htmlFor="code">Invitation code</label><input id="code" className="input mono" placeholder="XXXX-XXXX-XXXX" autoComplete="one-time-code" value={f.code} onChange={set("code")} required />{fe("code")}</div>
        <div className="field"><label htmlFor="jemail">Email (the invited address)</label><input id="jemail" className="input" type="email" autoComplete="email" value={f.email} onChange={set("email")} required />{fe("email")}</div>
        <div className="field"><label htmlFor="name">Display name</label><input id="name" className="input" autoComplete="nickname" value={f.display_name} onChange={set("display_name")} required />{fe("display_name")}</div>
        <div className="field"><label htmlFor="jpw">Password</label><input id="jpw" className="input" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} required minLength={10} /><span className="tiny muted">At least 10 characters with letters and numbers.</span>{fe("password")}</div>
        <label className="check"><input type="checkbox" checked={f.age_confirmed} onChange={set("age_confirmed")} /> I confirm I am 18 years or older.</label>
        <label className="check"><input type="checkbox" checked={f.privacy_consent} onChange={set("privacy_consent")} /> <span>I accept the <Link className="link" to="/legal/terms" target="_blank">beta terms</Link> and <Link className="link" to="/legal/privacy" target="_blank">privacy notice</Link>, and understand content is information, not betting advice.</span></label>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Creating account..." : "Create account"}</button>
        <p className="small muted">Already joined? <Link className="link" to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
