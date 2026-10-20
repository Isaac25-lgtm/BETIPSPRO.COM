# Status report: milestone 1 (local beta build), 2026-10-20

**Money spent:** $0 · **API-Football calls:** 0 (no key yet; demo mode) · **Gemini tokens:** 0 · **Deployments / pushes:** none.

## What works (verified)
- Screenshot-faithful homepage (desktop + art-directed mobile), match calendar (date strip, search, competition/status filters), Match Centre hub, match page with free preview / unlock / 8 report tabs, per-market evidence pages, leagues, statistics, forecast archive, info/legal pages, account area, admin console.
- Invite-only auth, sessions, CSRF, RBAC, 5-tester cap, 10 credits each, atomic unlock, append-only ledger, idempotent admin grants, audit log.
- Python pipeline: synthetic world → Dixon-Coles / first-half / NB corners / NB cards → 56 markets with uncertainty → rolling backtest → versioned artifact → validated importer.
- API-Football adapter + single metered budget gateway + serialised ingestion jobs + export endpoint for the pipeline (tested with mocks; **not yet run against the live API**: needs the owner's key).
- Gemini/Vertex adapter with reconciliation guardrails (tested offline; **never called**: disabled).

## Test results (actual runs)
| Suite | Result |
|---|---|
| TypeScript `tsc -b` | clean |
| Vitest unit + integration + security (real local D1) | 45/45 pass |
| Python model tests | 19/19 pass |
| Playwright E2E walkthrough + visual (10 viewports × 10 pages, desktop + mobile projects) | 26/26 pass (last full run) |
| Load matrix 1/5/25/100/500 (local) | 0% errors to 100 users; 500 users **fails** locally (~5–8% errors); see `costs-and-quotas.md` |

## Acceptance checklist (directive §21)

### Design
- [x] 1536×1024 reproduces navbar, stadium hero, green CTA, feature strip, fixture card, premium card, performance card, league tiles. Hero photo replaced with original art (rights).
- [x] 390×844 purpose-built mobile; no horizontal overflow at 320–1536 (automated).
- [x] Logo editable/swappable (`shared/brand.ts`, SVGs); protected imagery replaced.
- [x] Demo vs live clearly distinguished (banner, pills, notices, statuses).

### Product behaviour
- [x] Fixture/league filtering and search.
- [x] Preview + full evidence drill-down with traceable source fixtures; deterministic, non-causal narrative.
- [x] Every market has model/version/quality metadata or "insufficient evidence".
- [x] Initial markets render with historical tables and source identifiers.
- [x] No fake odds/matches/performance (synthetic labelled; real competitions empty until data loads).
- [x] Forecasts immutable (DB trigger) and settled; backtests flagged as retrospective.

### Beta & budgets
- [x] Exactly 5 testers; 10 credits once each.
- [x] One credit per match; reopen / other markets / logout-login free.
- [x] Parallel unlocks never overspend (tests + load-test integrity check).
- [x] Free provider mode throttles (80/day + reserve to 100, 10/min) and stops before the cap (tests with mocked upstream).
- [x] Cached report reads make zero provider/Gemini calls (test).
- [x] Works in demo mode before any account exists.

### Performance, security, compliance
- [~] Mobile performance: visual and overflow evidence recorded; **Core Web Vitals not yet measured on a real 4G device** (to do on staging).
- [x] No exposed secrets, no client authority over balances, admin protected, payments disabled.
- [x] Unit/integration/E2E executed (results above).
- [x] Auth/session/CSRF/credit/concurrency tests; load test documented.
- [x] No spend, push, deploy or monetisation.
- [x] Legal/data/regulatory gates listed in `release-checklist.md`.
- [x] README commands from a fresh checkout; no hidden credentials.

## Model-supported markets
56 defined. In demo mode all 56 publish synthetic probabilities. With real data, each is published only if its data gate passes (goals: ≥60 league matches and ≥6 per team; corners/cards/HT: ≥40 matches with those stats); Tier B markets are labelled PARTIAL until validated. Unsupported families: see `market-taxonomy.md`.

## Obstacles / limitations
- Real-data behaviour (free-plan season access, stats coverage, odds availability) is unknown until a key is configured.
- Synthetic backtest: 1X2 model does not beat the base rate (n=126). Displayed honestly.
- 500 concurrent users not demonstrated (local single-process limit); staging test required.
- Auth is invite-code + password (no OAuth/email verification yet), adequate for 5 known testers.

## Next steps
1. Owner: create the free API-Football account and add the key → run `status` and a 1-league pilot (≈30 calls).
2. Fit on real history, import, review data coverage, select ~10 pilot fixtures.
3. Staging deployment (after approval) → Core Web Vitals + load matrix on Cloudflare.
4. Brand decision; legal/data-rights review; then consider OAuth and payments.


## Update 2026-10-20: real data connected

- **football-data.org** (free) loaded for Premier League, La Liga, Champions League, Bundesliga, Serie A and Ligue 1, seasons 2025 and 2026: 3,837 real fixtures for 12 requests.
- **API-Football** (free) connected: plan Free, 100/day. Current season blocked on the free plan (only 2022-2024). 380 Premier League 2024/25 matches loaded for research.
- **Real-data backtest** (rolling origin over recent rounds, out-of-sample, n=250 matches; 326 for first half):

| Family | Log loss (model / base rate) | Brier (model / base rate) |
|---|---|---|
| Match result 1X2 | 0.9564 / 1.0626 | 0.5655 / 0.6433 |
| Over/Under 2.5 | 0.6523 / 0.6654 | 0.2303 / 0.2365 |
| BTTS | 0.6790 / 0.6813 | 0.2427 / 0.2441 |
| First-half over 0.5 | 0.6018 / 0.6111 | 0.2068 / 0.2104 |

  The model beats the base rate on all four, with a small edge on BTTS. This is one sample of 250 matches; it is not yet a validated track record, and nothing has been compared with bookmaker prices.
- **Model v0.2 (same day)**: a larger rolling-origin study (1,781 real matches) showed the v0.1 gains on O/U 2.5 and BTTS did not hold over a full season. v0.2 shrinks each team's goal propensity harder: O/U log loss improved by 0.020 and BTTS by 0.013 (both significant), with 1X2 unchanged. On the standard 250-match backtest: 1X2 0.9568, O/U 0.6510, BTTS 0.6718, first half 0.6018. Details: `docs/model-v1.2-evaluation.md`.
- 77 real fixtures in the next 10 days have reports. Corners and cards show Insufficient evidence: the free tier has no such statistics. Champions League newcomers with too few matches are also Insufficient.
- Demo data is hidden automatically once real reports exist. The free sample report is PSG vs FC Barcelona.
