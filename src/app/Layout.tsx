import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { BarChart3, CalendarDays, FileText, Home, LogOut, Menu, Search, Shield, Trophy, User, X } from "lucide-react";
import { brand } from "../../shared/brand";
import { Logo } from "../components/ui";
import { useAuth } from "./auth";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/matches", label: "Today's Matches" },
  { to: "/match-centre", label: "Match Centre" },
  { to: "/leagues", label: "Leagues" },
  { to: "/statistics", label: "Statistics" },
  { to: "/research/how-it-works", label: "Tools" },
  { to: "/predictions/archive", label: "Archive" },
];

function DataModeBanner() {
  const { config } = useAuth();
  if (!config || config.data_mode !== "DEMO") return null;
  return (
    <div className="mode-banner" role="note">
      <div className="container mode-banner-inner">
        <strong>Demo mode:</strong>&nbsp;all teams, fixtures, statistics, prices and probabilities shown are <strong>synthetic</strong> and fictional. No live sports data is connected yet.
      </div>
    </div>
  );
}

export function Layout() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);
  const user = me?.user;

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="nav" role="banner">
        <div className="container nav-inner">
          <Link to="/" className="nav-logo" aria-label={`${brand.publicName} home`}>
            <span className="only-desktop"><Logo /></span>
            <span className="only-mobile"><Logo compact /></span>
          </Link>
          <nav className="nav-links" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="nav-actions">
            <button className="icon-btn" aria-label="Search matches" onClick={() => nav("/matches?focus=search")}>
              <Search size={24} />
            </button>
            {user ? (
              <>
                {user.role === "admin" && (
                  <Link to="/admin" className="btn btn-outline-light btn-sm only-desktop">
                    <Shield size={16} /> Admin
                  </Link>
                )}
                <Link to="/app" className="nav-credits only-desktop" title="Report credits">
                  <span className="num">{me?.credits ?? 0}</span> credits
                </Link>
                <Link to="/app" className="btn btn-primary nav-cta only-desktop">
                  <User size={17} /> {user.display_name.split(" ")[0]}
                </Link>
                <Link to="/app" className="icon-btn only-mobile" aria-label="My account">
                  <User size={22} />
                </Link>
              </>
            ) : (
              <>
                <Link to="/login" className="btn btn-outline-light nav-login only-desktop">Login</Link>
                <Link to="/join" className="btn btn-primary nav-cta only-desktop">Get Started</Link>
                <Link to="/login" className="btn btn-outline-light btn-sm only-mobile">Login</Link>
              </>
            )}
            <button className="icon-btn nav-burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen(!open)}>
              {open ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </header>

      <div id="mobile-menu" className={`mobile-menu ${open ? "open" : ""}`} hidden={!open}>
        <nav aria-label="Mobile">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `mobile-link ${isActive ? "active" : ""}`}>
              {n.label}
            </NavLink>
          ))}
          <NavLink to="/pricing" className="mobile-link">Beta & Pricing</NavLink>
          <NavLink to="/responsible-use" className="mobile-link">Responsible use</NavLink>
          {user?.role === "admin" && <NavLink to="/admin" className="mobile-link">Admin</NavLink>}
        </nav>
        <div className="mobile-menu-actions">
          {user ? (
            <>
              <Link to="/app" className="btn btn-primary btn-block">My account · {me?.credits ?? 0} credits</Link>
              <button className="btn btn-outline-light btn-block" onClick={() => void logout()}>
                <LogOut size={16} /> Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/join" className="btn btn-primary btn-block">Get Started (beta invite)</Link>
              <Link to="/login" className="btn btn-outline-light btn-block">Login</Link>
            </>
          )}
        </div>
      </div>

      {/* On the homepage the demo status is shown inside the hero and cards to preserve the reference composition. */}
      {loc.pathname !== "/" && <DataModeBanner />}
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />

      <nav className="tabbar" aria-label="Quick navigation">
        <NavLink to="/" end className="tab"><Home size={21} /><span>Home</span></NavLink>
        <NavLink to="/matches" className="tab"><CalendarDays size={21} /><span>Matches</span></NavLink>
        <NavLink to="/leagues" className="tab"><Trophy size={21} /><span>Leagues</span></NavLink>
        <NavLink to="/statistics" className="tab"><BarChart3 size={21} /><span>Stats</span></NavLink>
        <NavLink to={user ? "/app/reports" : "/login"} className="tab"><FileText size={21} /><span>Reports</span></NavLink>
      </nav>
    </>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Logo />
          <p className="footer-note">
            Football evidence and probability research for adults (18+). Information only: probabilities are uncertain estimates, not advice or guarantees. We do not take bets or hold funds.
          </p>
          <p className="footer-owner">
            Operated by <strong>{brand.companyOwner}</strong>. Product name is a placeholder pending approval.
          </p>
        </div>
        <div>
          <h3>Research</h3>
          <Link to="/matches">Matches</Link>
          <Link to="/leagues">Leagues</Link>
          <Link to="/statistics">Model performance</Link>
          <Link to="/predictions/archive">Forecast archive</Link>
          <Link to="/research/how-it-works">How it works</Link>
        </div>
        <div>
          <h3>Product</h3>
          <Link to="/pricing">Beta & pricing</Link>
          <Link to="/about">About</Link>
          <Link to="/app/feedback">Beta feedback</Link>
          <Link to="/responsible-use">Responsible use</Link>
        </div>
        <div>
          <h3>Legal</h3>
          <Link to="/legal/privacy">Privacy</Link>
          <Link to="/legal/terms">Terms</Link>
          <Link to="/legal/data-rights">Data & attribution</Link>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} {brand.companyOwner}. Beta build: not for public commercial use.</span>
        <span>Football data provider (when enabled): API-Football. No club or competition logos are used.</span>
      </div>
    </footer>
  );
}
