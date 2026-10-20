# System handoff: football match-intelligence platform

Snapshot of 20 October 2026, commit `037040d` on `main` (github.com/Isaac25-lgtm/BETIPSPRO.COM). This document is
the single entry point for an engineer or AI agent who has never seen the project. Read it fully before changing
anything, then read `docs/decisions.md` (D-001 to D-027) for the reasoning behind each choice.

---

## 1. What this is

A web platform that publishes **statistical football match reports**: for each upcoming match, model probabilities
for 56 betting-style markets (1X2, totals, both teams to score, first half, correct score, corners, cards), plus the
historical evidence behind each number (recent form tables, league base rates, head to head, model drivers).

- **Owner / operator:** Motion Imprints Technologies (contact: omodingisaac123@gmail.com, the owner, Isaac).
- **Product name:** "BetTipsPro" is the current working name, set in one place: `shared/brand.ts`.
- **Audience:** adults (18+) who research matches before betting elsewhere. The site never takes bets, holds money,
  gives tips or tells anyone what to bet.
- **Phase:** **testing**. It is live on Cloudflare with every report open to everyone (no sign-in, no credits).
  The paid model (invite-only beta, 5 testers x 10 report credits) is fully built and can be switched back on.
- **Origin:** built from `MASTER_BUILD_DIRECTIVE.md` (the owner's original build brief). The homepage was designed to
  match the owner's reference screenshot `design/reference/homepage-reference.png` (gitignored, local only).

## 2. Owner preferences and standing rules (follow these)

The owner is direct and judges the product by how it looks and whether it is useful. Learned preferences:

1. **Show evidence, not disclaimers.** Remove hedging copy ("this is a model output, not a raw hit-rate",
   "descriptive only", "not a recommendation", footnotes about templates or AI). Give the figures and let the user
   decide. Keep only the legal 18+ / not-advice line in the footer and the responsibility strip.
2. **Never mention AI or Gemini in the UI.** The generated text box is labelled "Match summary". No AI branding.
3. **Gemini is for cheap writing only.** gemini-2.5-flash with thinking off (Flash-Lite is fine). Never a Pro or
   thinking model, never Gemini for predictions or analysis. Monthly cap $10. Uses the owner's Google Cloud trial
   credits via gcloud Application Default Credentials (no API keys).
4. **Look legitimate and natural.** The owner rejected "AI-generated / vibe-coded" looks, stick-figure art and
   cramped or wrapping cards. Check every change at desktop (1280-1536 px) and phone (390 px) widths, and look at
   the result, not just the overflow tests.
5. **No method sections on the homepage.** "No one is interested in Method." Methodology lives on secondary pages.
6. **Only improve the model with evidence.** Changes must beat the current model on held-out matches (paired,
   with confidence intervals). Retaining the current model after a failed experiment is a valid outcome.
7. **Never fabricate.** No invented fixtures, odds, probabilities, injuries or performance. Insufficient data means
   the market shows "Insufficient evidence" with the reason. Synthetic demo data is labelled and hidden once real
   data exists.
8. **Secrets** live in `.dev.vars` locally and as Cloudflare Worker secrets in production. Never print, log or
   commit them.
9. **Spending:** Cloudflare is on a paid plan the owner already has. Do not buy anything else (data plans, domains,
   AI usage beyond the cap) without asking. The owner has authorised pushing to GitHub and deploying to Cloudflare.
10. **Local reference images** (real players and league logos cut from the owner's screenshot) live in
    `public/images/local/` (gitignored) and are used only in local dev with `VITE_LOCAL_REFERENCE_HERO=true` in
    `.env.local`. A Vite plugin deletes them from every build. They must never be deployed or committed.

## 3. Current state at a glance

| Item | Value |
|---|---|
| Live site | https://bettipspro.omodingisaac123.workers.dev (Cloudflare Worker `bettipspro`, D1 `fip-prod`) |
| Report page | https://bettipspro.omodingisaac123.workers.dev/report |
| Access | Open to everyone (app_config `access = {"open": true}`); toggle in Admin > Config |
| Data | football-data.org free tier: Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League; seasons 2025/26 (complete) and 2026/27 (in progress). 3,837 fixtures, 2,689 played. API-Football free tier also holds Premier League 2024/25 (380 matches; separate team ids, not used by the model). |
| Model | `fip-v0.2` (goals model `goals-dc-v0.2`), run `run:fip-v0.2:20261020T123024Z` |
| Upcoming reports | 77 matches (20-29 Oct 2026): 62 full reports, 15 limited (Champions League teams with < 6 recent matches) |
| Match summaries | 63 (21 matches x 3 markets), gemini-2.5-flash; month spend about $0.11 of $10 |
| Tests | 51 Python, 50 TypeScript (unit + integration + security), 26 Playwright browser tests, all passing |
| Data freshness | Manual. No scheduled refresh in production (see section 12). |

Backtest of v0.2 (rolling origin, last 7 completed rounds per competition, retrospective):

| Market family | n | Model log loss | League base rate |
|---|---|---|---|
| Match result 1X2 | 250 | 0.9568 | 1.0626 |
| Over/Under 2.5 | 250 | 0.6510 | 0.6654 |
| Both teams to score | 250 | 0.6718 | 0.6813 |
| First-half over 0.5 | 326 | 0.6018 | 0.6111 |

On the larger 1,781-match study (section 9.4), v0.2 roughly matches the league base rate on O/U and BTTS but has no
demonstrated edge over it. The 1X2 edge (about 0.07 log loss per match) is consistent. Nothing has been compared
with bookmaker odds, and no forecast has been settled live yet.

## 4. Architecture

```
 Browser (React SPA)  ──/api/v1──►  Cloudflare Worker (Hono + Zod)  ──►  Cloudflare D1 (SQLite)
        ▲                                   │   ▲
        │ static assets (same Worker)       │   │ authenticated admin import (JSON sections)
        │                                   ▼   │
        │                    metered provider gateway ──► football-data.org / API-Football
        │
 Offline (owner's machine):
   Python model pipeline (model-pipeline/)  ── reads GET /admin/export/history ──► fits models ──► artifact.json
   scripts/import-artifact.mjs  ── POST /admin/forecasts/import ──► D1
   scripts/ai-summaries.mjs     ── Vertex AI (gcloud ADC) ──► POST /admin/ai/import ──► D1
```

Principles: heavy computation is offline (Python). The Worker only reads precomputed, versioned rows and computes
evidence tables on read. Forecasts are immutable (DB trigger); a new model run is a new set of rows. Every upstream
sports API call goes through one budget gateway.

Stack: React 19, Vite 7, React Router 7, hand-written CSS (tokens in `src/styles/tokens.css`), Inter + Inter Tight
fonts, lucide-react icons. Worker: Hono 4, Zod. `@cloudflare/vite-plugin` runs SPA and Worker as one unit in dev.
Python 3.12: numpy, scipy, pandas, pytest. npm (not pnpm).

## 5. Repository map

```
src/                     React app
  app/                   router.tsx (routes), Layout.tsx (nav, footer, mobile tabs), auth.tsx (session + public config context)
  pages/                 Home, Matches (+ Match Centre hub), MatchDetail, MarketEvidence, Report, Leagues, Statistics (+ Archive),
                         Account, Admin, Auth (login/join), Info (how it works, pricing, about, legal, data rights)
  components/            ui.tsx (badges, pills, ProbBar, Notice, Skeleton...), charts.tsx (scoreline heatmap, PMF bars, histograms, calibration)
  lib/                   api.ts (fetch + cache hook), format.ts (EAT dates, pct, labels), types.ts
  styles/                tokens.css, base.css, pages.css (page styles; report page under ".mr-")
worker/
  index.ts               Hono app, middleware, routes, scheduled handler
  env.ts                 Env interface, flag(), dataMode()
  routes/                public.ts, account.ts (auth, me, reports, evidence, feedback), admin.ts
  services/              access.ts (open access), auth.ts, credits.ts (atomic unlock), evidence.ts (computed on read),
                         explain.ts (deterministic explanation template), fixtures.ts (listing, preview), importer.ts (artifact validation),
                         overview.ts (/reports/overview), cache.ts
  services/sports/       budget.ts (multi-provider metered gateway), ingestion.ts (jobs, export for the pipeline, cron)
  services/ai/           gemini.ts (runtime adapter, off in practice), validate.ts (guardrails: number reconciliation + banned phrases)
  providers/             football-data-org/, api-football/, demo/ (normalisers to provider-neutral records)
  middleware/            requestContext, csrf, loadSession, public-cache
shared/                  brand.ts, markets.ts + market-catalog.json (56 markets, settlement predicates shared by TS and Python)
migrations/              0001 schema, 0002 payments stub, 0003 reference competitions + config, 0004 open access
model-pipeline/
  src/fip_model/         cli.py, engine.py (fit, forecast, backtest, artifact), markets.py, models/goals.py (Dixon-Coles), models/counts.py (NB2)
  research/              harness.py + dcfast.py + run_*.py (the v1.2 model study; outputs in research/out/, gitignored)
  tests/test_models.py
  data/raw, data/exports  (gitignored) provider export and fitted artifacts
scripts/                 import-artifact, ai-summaries, ai-recheck, provider-probe, seed-demo, setup-local, reset-local-db,
                         beta-bootstrap, e2e-prepare, screenshots, readme-screenshots, build-market-catalog, find-overflow
tests/                   unit/, integration/ (real local D1 via getPlatformProxy), security/, e2e/ (Playwright), performance/
docs/                    decisions.md, status.md, model-v1.2-evaluation.md, technical-architecture.md, database-schema.md,
                         market-taxonomy.md, costs-and-quotas.md, licensing-and-compliance.md, security-review.md, runbooks
```

## 6. Frontend

Routes (`src/app/router.tsx`): `/` home, `/matches` (date strip, search, filters), `/match-centre`, `/matches/:id`
(tabs: Overview, Markets, Goals, Corners, Cards, Form & H2H, Odds, Model & Evidence), `/matches/:id/markets/:marketId`
(evidence page), `/report` (all upcoming matches with probabilities, model record, data coverage), `/leagues`,
`/leagues/:id`, `/statistics` (backtest, calibration), `/predictions/archive`, `/research/how-it-works`,
`/pricing`, `/about`, `/responsible-use`, `/legal/*`, `/login`, `/join`, `/app` (account), `/admin/*`.

- Times are shown in East Africa Time (Africa/Kampala); "today" is the EAT calendar day.
- `useAuth()` exposes `me` and the public config (`data_mode`, `open_access`, `synthetic_data_present`...). Copy
  about credits switches automatically when `open_access` is true.
- The scoreline heatmap colours cells by result region (home win green, draw amber, away win blue), shading by
  probability, with region totals in the legend. Display grids fold scores >= 6 into a "6+" row and column.
- Mobile: bottom tab bar, purpose-built mobile hero, no horizontal overflow from 320 to 1536 px (tested).

## 7. Worker API (`/api/v1`)

Responses are `{ ok, data, meta }` or `{ ok: false, error: { code, message, details } }`. Mutating requests need the
header `x-requested-with: fip` and a matching Origin (CSRF). Sessions are HttpOnly cookies.

- **Public:** `GET /health`, `/config/public`, `/competitions`, `/competitions/:id`, `/fixtures` (date/league/team/q/status),
  `/fixtures/:id/preview`, `/fixtures/:id/markets`, `/reports/overview`, `/markets/catalog`, `/statistics/models`,
  `/predictions/archive`, `/plans`. User-independent GETs are cached 60 s.
- **Account:** `POST /setup/admin` (one-time bootstrap with ADMIN_BOOTSTRAP_TOKEN), `/auth/login`, `/auth/redeem-invite`,
  `/auth/logout`, `GET /me`, `/me/credits`, `/me/unlocks`, saved fixtures, sessions, consent, data requests, feedback,
  `POST /fixtures/:id/unlock`, `GET /fixtures/:id/report`, `GET /fixtures/:id/markets/:marketId/evidence`.
  Report and evidence access (`canView` in account.ts): public sample, then admin, then **open access**, then a credit
  entitlement; otherwise 401/403.
- **Admin:** overview, provider health, testers, invitations, credit grants and ledger, fixtures and public sample,
  usage, jobs, `POST /ingest`, `GET /export/history?provider=`, `POST /forecasts/import`, cache invalidation, forecasts,
  coverage, feedback, audit log, data requests, `GET /config`, `PUT /config/access`, `PUT /config/ingestion`,
  `GET /ai/status`, `POST /ai/import`, `POST /ai/generate`. Every admin mutation is audited.

## 8. Database (D1)

Tables: users, auth_accounts, sessions, auth_attempts, beta_invites, wallets, credit_ledger, competitions, teams,
referees, fixtures, fixture_team_stats, fixture_events, provider_snapshots, team_stats_snapshots, market_definitions,
model_runs, forecasts, forecast_evidence, bookmaker_snapshots, match_reports, report_unlocks, model_evaluations,
ai_explanations, provider_quota, provider_rate_windows, provider_api_usage, ingestion_jobs, beta_feedback,
saved_fixtures, admin_audit_log, app_config, data_requests, plans, orders, payments, payment_events.

Invariants:
- `forecasts` are immutable (trigger `forecasts_immutable`); `credit_ledger` is append-only (no update/delete triggers).
- Unlocking is one atomic D1 batch (entitlement insert, conditional wallet decrement, ledger insert, postcondition guard).
- `match_reports` has one row per fixture per report version; the newest `generated_at` is served.
- `is_synthetic` marks demo rows; once any real report exists, synthetic rows are hidden from public listings.
- `app_config` keys: `access` (open flag), `beta`, `ingestion`.
- IDs are namespaced by provider: `fdo:fx:575367` (fixture), `fdo:team:64`, competitions use canonical league ids
  (`apif:39` Premier League, `apif:140` La Liga, `apif:2` Champions League, `apif:78` Bundesliga, `apif:135` Serie A,
  `apif:61` Ligue 1).

## 9. Statistical model

### 9.1 Pipeline
`python run.py fit --input data/raw/fdo-export.json --out data/exports/artifact.json [--as-of ISO] [--horizon-days 10]`
fits per competition, forecasts upcoming fixtures within 10 days, runs a rolling-origin backtest over the last 7
completed rounds and writes one artifact (competitions, teams, fixtures, forecasts, drivers, reports, archive
backtest rows, evaluations). `--as-of` reproduces a run exactly.

### 9.2 Models
- **Full-time goals:** Dixon-Coles (Poisson with low-score correction rho), exponential time decay xi = 0.0019/day
  (365-day half-life), fitted by penalised weighted maximum likelihood with an analytic gradient (L-BFGS-B).
  v0.2 shrinkage: team **quality** (att - dfn)/2 ridge 4 and goal **propensity** (att + dfn)/2 ridge 48.
  rho is kept inside its admissible range per match; the scoreline grid grows until the tail is below 1e-10.
  All goal markets derive from one scoreline matrix, so they are mutually consistent.
- **First half:** separate Poisson fit (no rho, ridge 6). Experimental tier.
- **Corners / cards:** penalised negative binomial (NB2) with team and referee effects. The free data tier has no
  corner or card statistics, so these markets show "Insufficient evidence" on real data.
- **Uncertainty:** Laplace approximation (numerical Hessian), 250 parameter draws, 5th to 95th percentile range.
- **Gates:** 60 completed league matches, 6 per team; otherwise the market is INSUFFICIENT with a reason.
- **Featured market:** the Tier A market whose probability sits furthest above the league base rate (informational).

### 9.3 Markets
56 markets in `shared/market-catalog.json` (generated by `scripts/build-market-catalog.mjs`, do not hand-edit). Each
has a settlement predicate evaluated identically by `shared/markets.ts` and `model-pipeline/src/fip_model/markets.py`.
Regulation time only (90 minutes plus stoppage); extra time and penalties excluded (the football-data.org adapter
stores `regularTime` scores for AET/PEN matches).

### 9.4 The v1.2 model study (`docs/model-v1.2-evaluation.md`)
An external proposal ("Consensus v1.2") was triaged and tested on 1,781 real matches with a leakage-free
rolling-origin harness (cut-offs Monday/Thursday, tune on 2025/26, holdout 2026/27, paired block-bootstrap CIs).
- **Adopted:** split quality/propensity shrinkage (O/U +0.020 [0.012, 0.028], BTTS +0.013 [0.008, 0.018] log loss,
  1X2 unchanged); admissible rho; adaptive grid; analytic gradient.
- **Rejected:** pooling domestic leagues with the Champions League, with or without league-strength offsets (CL 1X2
  significantly worse; pooled forecasts for thin-data teams were worse than the base rate); first-half changes;
  decay changes; wider rho bound; independent Poisson.
- **Deferred:** dynamic team strengths, bivariate Poisson, ensembles (two seasons of data are too few to show a gain),
  xG, line-ups, odds, corners, cards (no legal free source).
- Finding: v0.1's reported O/U and BTTS gains on 250 matches did not replicate over a full season.

## 10. Evidence, explanations and match summaries

- **Evidence pages** are computed on read from normalised tables using the forecast's `data_as_of_at` as the
  cut-off: home team's last home matches, away team's last away matches, last 10 each, head to head, league base
  rate, referee (cards), model distribution, observed histograms, model drivers, settlement rule, provenance.
- **Explanation text** comes from a deterministic template (`worker/services/explain.ts`); every number comes from
  the evidence object.
- **Match summaries** (the "Match summary" box) are written offline by `scripts/ai-summaries.mjs`:
  Vertex AI `gemini-2.5-flash`, project `paperaid`, location `us-central1`, request label `app=bettipspro`,
  `thinkingBudget: 0`, JSON response schema, temperature 0.2, paced 4.5 s per call with 429 retry. Auth is the owner's
  gcloud ADC token (`gcloud auth application-default print-access-token`). Each summary is generated once per
  fixture / market / report version / evidence hash (`PROMPT_VERSION = "summaries-v3"`), then validated:
  every number must reconcile with the evidence (`worker/services/ai/validate.ts`) and banned phrases (certainty,
  tips, betting slang like "hit the over", "value bet", "punters", "stake") reject it. Rejected rows are stored as
  rejected and the site falls back to the template. `scripts/ai-recheck.mjs` re-applies current rules to stored rows.
  Markets summarised: home win, over 2.5, BTTS yes. Cost about $0.0006 per summary.
- In production `AI_EXPLANATIONS_ENABLED=true` only means stored summaries are shown. The Worker has no Vertex
  credentials, so it never calls Gemini itself.

## 11. Access, auth and credits

- Invite-only registration (admin creates one-use, email-bound invite codes; max 5 testers), PBKDF2-SHA256 passwords,
  hashed server-side sessions, D1-backed login throttling, RBAC (admin / tester / customer), 18+ confirmation.
- Credits: 10 per tester; one credit unlocks one match (all markets, all future report versions); reopening is free.
- **Open access** (`worker/services/access.ts`): when on, everyone can read every report and evidence page, no credit
  is used, the overview endpoint includes probabilities, and the UI hides locks and credit copy. Integration and E2E
  tests run with access off so the credit flow stays covered (`tests/integration/open-access.test.ts` covers both).

## 12. Deployment and operations

Environments:
- **Local dev:** `npm run dev` on http://127.0.0.1:5173 (Vite + Worker in workerd, local D1 in `.wrangler/state`).
  Top-level vars in `wrangler.jsonc` plus `.dev.vars`.
- **Production:** `env.production` in `wrangler.jsonc`: worker `bettipspro`, D1 `fip-prod`
  (id fe2844ec-a183-46ce-be58-0d83049f4ed9), no cron, `SPORTS_PROVIDER=api_football` (gives data_mode FREE_API).
  Cloudflare account: omodingisaac123@gmail.com's account. Another D1 database there, `jerseyville-db`, is unrelated;
  do not touch it.

Secrets (names only; values never in the repo): local `.dev.vars` holds ADMIN_BOOTSTRAP_TOKEN, SESSION_SECRET,
API_FOOTBALL_KEY, FOOTBALL_DATA_ORG_KEY, SPORTS_PROVIDER, AI_EXPLANATIONS_ENABLED, AI_MONTHLY_BUDGET_USD.
Production Worker secrets: SESSION_SECRET, ADMIN_BOOTSTRAP_TOKEN, API_FOOTBALL_KEY, FOOTBALL_DATA_ORG_KEY.
Production admin login (owner's email) is in the gitignored file `prod-admin.local.txt` in the project root.

Runbooks:
```bash
# Redeploy the site
CLOUDFLARE_ENV=production npx vite build && npx wrangler deploy
# Schema change: add migrations/000N_*.sql, then
npx wrangler d1 migrations apply DB --local
npx wrangler d1 migrations apply DB --remote --env production
# Set a production secret (value on stdin)
npx wrangler secret put NAME --env production
```

**Refreshing data (manual, about 5 minutes):**
1. Pull fresh fixtures/results into the local DB through the gateway, one job per competition and season:
   `node scripts/provider-probe.mjs --admin-email <local admin> --admin-password <pw> --delay-ms 7000 --jobs '[{"kind":"fdo_competition","competition":"PL","season":"2026"}, ...]'`
   (competitions PL, PD, SA, BL1, FL1, CL; football-data.org free tier allows 10 requests/minute).
2. Export: `GET /api/v1/admin/export/history?provider=football_data_org` (admin session) and save the `data` object
   to `model-pipeline/data/raw/fdo-export.json`.
3. Fit: `cd model-pipeline && python run.py fit --input data/raw/fdo-export.json --out data/exports/artifact.json`.
4. Import locally and to production:
   `node scripts/import-artifact.mjs --file model-pipeline/data/exports/artifact.json --url <http://127.0.0.1:5173 | https://bettipspro.omodingisaac123.workers.dev> --admin-email ... --admin-password ...`
5. Optional summaries: `node scripts/ai-summaries.mjs --admin-email ... --admin-password ... --fixtures 21 --cap 10 [--url ...]`
   (requires gcloud ADC on the owner's machine). A new model run means new report versions, so summaries must be
   regenerated for it.

Local dev login and the local admin are separate from production. The local admin credentials are the owner's;
ask the owner rather than guessing.

## 13. Local setup and tests

```bash
npm ci
npx playwright install chromium
cp .dev.vars.example .dev.vars        # fill in secrets; demo mode works without provider keys
npm run db:migrate && npm run db:seed # local D1 with the synthetic demo world
npm run dev
cd model-pipeline && python -m pip install -e ".[dev]"   # numpy, scipy, pandas, statsmodels, pytest
```

| Command | What it runs |
|---|---|
| `npx tsc -b` | typecheck app + worker |
| `npm test` | Vitest unit + integration + security against real local D1 (about 45 s) |
| `npm run test:e2e` | Playwright walkthrough + visual overflow at 10 viewports (about 10 min; isolated DB in `.wrangler/e2e-state`) |
| `npm run model:test` | Python model tests (about 35 s) |
| `python model-pipeline/research/run_*.py` | research experiments (minutes, parallel) |

## 14. Known limitations and debt

- **No automatic data refresh in production.** Results and forecasts go stale until someone runs section 12's refresh.
  Best next step: a GitHub Action or small scheduled job that runs ingest, export, fit and import.
- **Free data only:** no corners, cards, odds, line-ups or xG. Corner/card markets and the price panel are empty.
- **Champions League:** teams with fewer than 6 recent CL matches get limited reports (pooling was tested and rejected).
- **No live track record yet.** All performance figures are retrospective backtests.
- `dataMode()` derives FREE_API from `SPORTS_PROVIDER=api_football` plus an API-Football key, even though the live data
  comes from football-data.org. Works, but the naming is misleading.
- Quality labels: goals markets show "Verified data" once sample gates pass; this means the data checks passed,
  not that each market is empirically validated (deferred item from the v1.2 review).
- `docs/status.md` starts with the milestone-1 report (demo-only era); the newer state is in its later "Update"
  sections and in this document.
- Licensing: football-data.org free-tier commercial use is unconfirmed; check before charging users. Attribution is
  shown in the footer and on the data page. API-Football data/logo publication rights are not granted by the
  subscription. No club crests or player photos are used in production.
- Load: local tests were clean to 100 concurrent users; 500 failed locally (development machine, not Cloudflare).

## 15. Suggested next steps (owner has expressed interest)

1. Automated daily refresh (ingest, fit, import, summaries) with a failure alert.
2. Custom domain (owner mentioned BETIPSPRO.COM) via Cloudflare DNS, if the owner owns it.
3. A paid data source for corners, cards and odds when the owner chooses one; then value comparisons against
   timestamped bookmaker prices (never fabricated).
4. Prospective track record: settle archived pre-kickoff forecasts after each match and show it on /statistics.
5. Cross-provider team matching (API-Football vs football-data.org ids) to use more history.
6. Team news via Gemini with Google Search grounding and cited sources (owner's idea; keep it cheap, Flash only).
7. Other sports later; football first.

## 16. Environment quirks (Windows machine)

- Git Bash heredocs (`cat <<'EOF'`) often fail with "unexpected EOF"; write files with an editor/tool or small
  Python scripts (always `encoding="utf-8"`).
- PowerShell `Invoke-RestMethod` sends `Expect: 100-continue` and gets HTTP 417 from the dev server; use curl or Node fetch.
- Stopping Vite can leave an orphan `workerd.exe` locking `.wrangler/state`; kill it before resetting the DB.
- The dev server binds 127.0.0.1 (Windows otherwise listens on ::1 only).
- gcloud on this machine: `C:\Users\USER\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd`.
- Vertex trial quota is low: pace calls (4.5 s) and retry 429s.

## 17. Glossary

- **Log loss:** average negative log probability given to what happened; lower is better. **Base rate:** how often the
  outcome happened in that league before the cut-off. **Backtest:** forecasts computed after the fact using only data
  available before each match. **Report version:** the model run id a match report belongs to. **Open access:**
  testing mode where all reports are free. **INSUFFICIENT:** not enough data to publish a probability.
