import { Link } from "react-router";
import { ArrowRight, Check, X } from "lucide-react";
import { brand } from "../../shared/brand";
import { useApi } from "../lib/api";
import { Notice } from "../components/ui";

type Page = "how" | "pricing" | "about" | "responsible" | "privacy" | "terms" | "data";

export default function InfoPages({ page }: { page: Page }) {
  const body = { how: <How />, pricing: <Pricing />, about: <About />, responsible: <Responsible />, privacy: <Privacy />, terms: <Terms />, data: <DataRights /> }[page];
  return <div className="container prose-page">{body}</div>;
}

const DraftLegal = () => (
  <Notice tone="warn"><strong>Draft for the closed beta.</strong> This page has not yet been reviewed by a lawyer and must be reviewed (including for Ugandan law and NLGRB guidance) before any public or commercial launch.</Notice>
);

function How() {
  return (
    <article className="prose">
      <h1>How it works</h1>
      <p className="lede">We estimate probabilities with statistical models fitted only on data available before kick-off, then show the evidence and uncertainty behind every number. You decide what, if anything, to do with it.</p>
      <h2>1. Data</h2>
      <p>Fixtures, results and match statistics come from a licensed provider (API-Football, free plan first). Every record carries its source and capture time. Until the provider is connected the site runs on clearly labelled <strong>synthetic demo data</strong>: fictional teams, matches and figures.</p>
      <h2>2. Models</h2>
      <ul>
        <li><strong>Goals (Dixon-Coles):</strong> attack and defence ratings with home advantage, exponential time decay (half-life about a year) and shrinkage. One scoreline distribution produces 1X2, double chance, totals, both teams to score, team goals and correct score, so they are always mutually consistent.</li>
        <li><strong>First half:</strong> a separate model fitted on half-time scores, not a halved full-match estimate.</li>
        <li><strong>Corners:</strong> negative-binomial model of each team&apos;s corners for and against, allowing extra variance.</li>
        <li><strong>Yellow cards:</strong> negative-binomial model with team and referee effects shrunk towards the league average.</li>
      </ul>
      <h2>3. Uncertainty and quality gates</h2>
      <p>Each probability has a 90% parameter-uncertainty range (Laplace approximation). It excludes model-specification error, so true uncertainty is wider. If required records are missing or samples are too small we publish <em>Insufficient evidence</em> instead of a number.</p>
      <h2>4. Evidence</h2>
      <p>For any market you can open the actual prior fixtures behind it: home and away samples, last 10 matches, head-to-head, league base rate and (for cards) the listed referee&apos;s recent matches. Historical hit-rates are shown separately from the model probability because they are not the same thing.</p>
      <h2>5. Evaluation</h2>
      <p>Models are evaluated chronologically (rolling origin) with log loss, Brier score and calibration plots against a base-rate baseline. We do not publish win rates or ROI. See <Link className="link" to="/statistics">model performance</Link>.</p>
      <h2>What we do not do</h2>
      <ul className="neg-list">
        <li><X size={16} /> Tell you what to bet, or place bets</li>
        <li><X size={16} /> Claim certainty, “sure odds” or guaranteed profit</li>
        <li><X size={16} /> Use line-ups, injuries, xG or tactical data we do not actually have</li>
        <li><X size={16} /> Edit past forecasts after the result is known</li>
      </ul>
      <Link to="/matches" className="btn btn-primary">Explore matches <ArrowRight size={16} /></Link>
    </article>
  );
}

function Pricing() {
  const { data } = useApi<{ payments_enabled: boolean; plans: Array<{ id: string; name: string; price_minor: number; currency: string; credits: number }>; notice: string }>("/plans");
  return (
    <article className="prose">
      <h1>Beta & pricing</h1>
      <p className="lede">The beta is free and invite-only: five testers, ten report credits each. One credit unlocks one match report with every supported market. Reopening it, switching markets and later refreshes cost nothing.</p>
      <Notice tone="info">{data?.notice ?? "No payments are taken during the beta."}</Notice>
      <h2>Possible future packages (being tested)</h2>
      <p>These are hypotheses, not offers. Prices may change, and nothing can be bought yet.</p>
      <div className="grid-3 plan-grid">
        {(data?.plans ?? []).map((p) => (
          <div key={p.id} className="card card-pad plan">
            <span className="pill pill-gray">Not available</span>
            <h3>{p.name}</h3>
            <strong className="plan-price">${(p.price_minor / 100).toFixed(0)}</strong>
            <span className="muted">{p.credits} match reports · ${(p.price_minor / 100 / p.credits).toFixed(2)} each</span>
          </div>
        ))}
      </div>
      <h2>What a credit is (and is not)</h2>
      <ul className="pos-list">
        <li><Check size={16} /> One credit = one full match report for your account</li>
        <li><Check size={16} /> Includes every supported market and evidence page for that match</li>
        <li><Check size={16} /> Never an API request and never a bet</li>
      </ul>
      <p className="small muted">Before any paid launch: approved payment provider (including Mobile Money), UGX pricing, refund policy, verified payment webhooks and legal review.</p>
    </article>
  );
}

function About() {
  return (
    <article className="prose">
      <h1>About</h1>
      <p className="lede">{brand.publicName} (placeholder name) is a football evidence and probability research platform built and operated by <strong>{brand.companyOwner}</strong>.</p>
      <p>Our aim is simple: show the probabilities, the actual match evidence and the model uncertainty behind football markets, so adult analysts can do their own research. We are not a bookmaker, we do not take bets or hold money, and we do not sell certainty.</p>
      <p>The product is in a closed beta with five invited testers. The public brand name, domain and logo are not final.</p>
    </article>
  );
}

function Responsible() {
  return (
    <article className="prose">
      <h1>Responsible use</h1>
      <p className="lede">This service is for adults aged 18 and over. It provides information only.</p>
      <ul>
        <li>Probabilities describe uncertainty. A 70% estimate is expected to be wrong about 3 times in 10.</li>
        <li>Nothing here guarantees winnings or tells you what to bet. Past patterns do not guarantee future results.</li>
        <li>Only gamble with money you can afford to lose. Never chase losses.</li>
        <li>Set limits on time and money. Take breaks.</li>
        <li>If gambling causes stress, debt or conflict, stop and talk to someone you trust or a qualified counsellor.</li>
      </ul>
      <h2>Getting help</h2>
      <p>In Uganda, the National Lotteries and Gaming Regulatory Board (NLGRB) publishes information on responsible gaming and licensed operators: <a className="link" href="https://lgrb.go.ug/" target="_blank" rel="noreferrer noopener">lgrb.go.ug</a>. Licensed operators must offer self-exclusion tools. Use them if you need a break.</p>
      <p className="small muted">We do not send promotional messages, use urgency tactics or reward losses.</p>
    </article>
  );
}

function Privacy() {
  return (
    <article className="prose">
      <h1>Privacy notice (beta draft)</h1>
      <DraftLegal />
      <h2>What we collect</h2>
      <ul>
        <li>Account: email address, display name, a salted password hash, 18+ confirmation and consent timestamps.</li>
        <li>Usage needed to run the service: sessions (stored hashed), report unlocks, credit ledger, saved matches and feedback you send.</li>
        <li>Security: hashed IP-derived identifiers for rate limiting. We do not store raw IP addresses in our database.</li>
      </ul>
      <h2>What we do not do</h2>
      <p>No advertising trackers, no sale of personal data, no profiling for marketing. Optional AI summaries (off during the beta) never receive personal data.</p>
      <h2>Processors</h2>
      <p>Hosting on Cloudflare (Workers and D1) once deployed. Football data from API-Football (no personal data shared).</p>
      <h2>Your rights</h2>
      <p>You can request an export or deletion of your data from <Link className="link" to="/app/settings">account settings</Link>. During the beta, requests are processed manually by {brand.companyOwner}.</p>
    </article>
  );
}

function Terms() {
  return (
    <article className="prose">
      <h1>Beta terms (draft)</h1>
      <DraftLegal />
      <ul>
        <li>Access is by personal invitation, for adults 18+, for testing and feedback only.</li>
        <li>Content is information and research, not financial or betting advice. No outcome is guaranteed.</li>
        <li>Report credits have no cash value, cannot be transferred, and are granted free during the beta.</li>
        <li>Do not scrape, resell or redistribute data or reports. Provider data is licensed for display within the service only.</li>
        <li>Demo content is synthetic and fictional.</li>
        <li>We may change or end the beta at any time.</li>
      </ul>
    </article>
  );
}

function DataRights() {
  return (
    <article className="prose">
      <h1>Data sources, rights & attribution</h1>
      <DraftLegal />
      <ul>
        <li><strong>Synthetic demo data:</strong> generated by our own pipeline; all teams, referees, venues and numbers are fictional.</li>
        <li><strong>API-Football (API-SPORTS):</strong> football data when enabled. Their subscription does not by itself grant rights to publish all data, logos or images commercially, and betting-related use may need permission from rights holders. Public monetisation is blocked until this is reviewed.</li>
        <li><strong>Logos and imagery:</strong> we show no club crests, competition emblems or player photos. Team marks are generated monograms. Hero and card artwork is original procedural art.</li>
        <li><strong>Competition names</strong> are used descriptively only, and imply no endorsement.</li>
        <li><strong>Bookmaker prices:</strong> shown only when our licensed provider supplies them, with bookmaker name and timestamp. No scraping.</li>
      </ul>
    </article>
  );
}

export function NotFound() {
  return (
    <div className="container section">
      <div className="empty-state">
        <strong style={{ fontSize: 28 }}>Page not found</strong>
        <p className="muted">The page you asked for does not exist.</p>
        <Link to="/" className="btn btn-primary">Back to home</Link>
      </div>
    </div>
  );
}
