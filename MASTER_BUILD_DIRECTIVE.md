# FOOTBALL MATCH INTELLIGENCE PLATFORM — MASTER IDE BUILD DIRECTIVE

**Document type:** Executable product requirements + design system + engineering architecture + implementation and acceptance checklist  
**Revision:** 1.1 | **Prepared:** 19 October 2026  
**Owner:** Motion Imprints Technologies (company owner only; **NOT** the public-facing product name)  
**Product brand:** **UNDECIDED**. `BetTipsPro` is the lettering in the reference screenshot, **not an approved final name**. Build a swappable brand identity; do not silently rename the product to Motion Imprints Football Intelligence or MatchLens.  
**Build mode:** Local-first, real end-to-end beta for five invited testers; public commercial deployment and real billing are *later gated steps*.  
**Primary visual source:** The homepage screenshot supplied by the project owner, to be copied into this IDE project as `design/reference/homepage-reference.png`. If its actual filename differs, locate the provided image and update the reference manifest.  
**Secondary UX reference:** [Sofascore](https://www.sofascore.com/) for fixture discovery, match-centre information architecture, mobile navigation, statistics and drill-down *concepts*, **not** for wholesale copying of protected artwork, styling, code, trade dress or content.  
**Deployment target:** GitHub for source/version control (**not the intended app host**); Cloudflare Workers (with static assets) for public frontend/API and Cloudflare D1 for initial transactional data when deployment is approved.  
**Football provider:** [API-Football / API-SPORTS](https://www.api-football.com/), **FREE plan first**. Do not purchase $19 Pro, or any other paid service, without owner approval.  
**AI:** Existing Gemini via Vertex AI can be integrated through an optional, budget-gated adapter; it is **not required** for the platform's core mathematics.

---

## 0. IMPORTANT: HOW THE IDE AGENT MUST WORK

You are the lead product engineer, frontend designer, backend engineer, QA engineer, statistical systems integrator and documentation author for this project. **Build a working project**, not just a concept document or a set of static screenshots. Work in sensible phases, keep the application runnable, and report exactly which features are verified, mocked, blocked or not implemented.

1. **FIRST read the attached reference homepage screenshot.** If not found, search the workspace for images. Treat the screenshot as the **non-negotiable primary desktop UI blueprint**. Do not substitute a generic SaaS template, a new dashboard arrangement or your own unrelated aesthetic. Match its structural layout closely and refine for usability. Its image assets and brand words may be replaced with properly licensed/original assets and product-accurate copy.
2. **Do not begin by deploying or making purchases.** First set up the workspace, logo/brand configuration, UI, real database/auth/API boundaries, test fixtures and working local app. Prepare Cloudflare deployment configuration but keep production publish/paid services behind explicit owner approval.
3. **Make reasonable engineering decisions autonomously** and record them in `docs/decisions.md`. Do not interrupt the owner for routine technical choices. Ask only for an indispensable secret/account action, legal/licensing approval, brand/domain finalization before purchase, payment integration credentials, or irreversible/published/deployment actions.
4. **Never fabricate live fixtures, true probabilities, bookmaker odds, historical records or performance metrics.** For local demos use clearly labeled **SYNTHETIC DEMO DATA** and ensure demo content can never be mistaken for live sports information.
5. **Real data and model results must be distinguishable from model-free mocks.** The app must run gracefully in `DEMO`, `FREE_API`, and eventually `PRODUCTION` environments with explicit status indicators.
6. **Do not pass API keys or credentials into client JavaScript, Git commits, logs or browser network responses.** Backend fetches only.
7. Implement code, database migrations, unit/integration/e2e tests and run them. Perform **visual screenshot reviews** at desktop 1536×1024 and multiple mobile breakpoints. Correct obvious mismatches rather than simply declaring completion.
8. The owner values **low lag, fast response and professional polish**. Use cached read paths and precomputed forecasts; do not call sports APIs or Gemini for every click.
9. Keep implementation modular. This is a commercial product prototype, not a loose set of scripts.
10. **Do not claim 500 simultaneous users are supported until a representative load test measures it.** Engineer toward that target and document bottlenecks.
11. Each milestone ends with a concise status report: what works, what was tested, API calls consumed, money spent (if any), obstacles, and next implementation steps.
12. The beta must remain free to testers. Monetary packages are *commercial experiments*, not permission to collect money or advertise profits.

### Explicit owner decisions (do not override)

- **Free API-Football trial first**, not a paid API subscription at this stage.
- **Initial pilot:** five invited testers; ten **full-match-report unlock credits each** (50 possible unlocks). A credit is *not* an upstream API request.
- The uploaded reference screenshot should determine the homepage appearance. Sofascore-style match discovery is secondary.
- Mobile is a first-class, highly polished experience.
- Build first; GitHub repository setup and Cloudflare deployment when ready/authorized.
- Pricing hypothesis: **USD $3 for 10 complete match reports**; future tiers may be tested. No live payments in the initial beta.
- Users choose markets and inspect probabilities and evidence; the platform **does not simply instruct them what to bet**.
- A chosen match unlocks **all available supported markets** and its report for that user; reopening it or clicking other markets does not spend another credit.
- Platform owner is Motion Imprints Technologies, but the **customer-facing product has a separate yet-to-be-chosen name**.
- Commercial viability matters; do not fake conversion rates, prediction success, historical ROI or operating profit.

---

## 1. PRODUCT NORTH STAR

Create an elegant **football evidence and probability research platform** for adult football analysts and bettors, with optional prepaid match-report access.

The product answers four questions for every fixture:

1. **What outcomes are plausible?** Independently calculated model probabilities for supported markets (not merely an API provider's predictions).
2. **Why does the model estimate that?** Verifiable evidence: actual prior fixtures, scorelines, goals, xG where licensed/available, corners, cards, home/away splits, opposing-team strength, player availability, referee history and tactical event data *only when actually sourced*.
3. **What prices exist?** Properly sourced bookmaker decimal odds, timestamped and identified, **only where the provider covers them**. Never assume betPawa Uganda prices are in the feed.
4. **How trustworthy is this forecast?** Dataset coverage, observation sample sizes, uncertainties, calibration/backtest results and permanent before-kickoff forecast archives.

**Do not market certainty.** Avoid “guaranteed wins”, “fixed matches”, “sure odds”, “risk-free income” and fabricated claim phrases such as “68% win rate” if not verified.

### Customer segmentation

- **Visitor:** can browse fixtures, leagues, public basic statistics, product explanation, example report, and a limited explicitly specified free sample.
- **Beta tester (invited):** can log in and unlock up to 10 distinct full-match reports using allocated free beta credits.
- **Paid customer (later):** buys credits or access bundles; features gated behind approved payment, age/legal checks and verified transaction processing.
- **Administrator:** can review usage, API budgets, data freshness, queues, forecasts, evidence, test feedback and manual credit grants through audited controls.

### Defined non-goals for the first beta

- No bookmaker wagering, deposit-taking, betting slips submitted to third-party betting accounts, automated bet placement or money custody.
- No claim to support every football league or every betPawa market. Market breadth is **coverage- and validation-gated**.
- No live, in-play second-by-second prediction system in phase one.
- No automated paid ad campaigns or unsolicited messaging.
- No unbounded AI chat or repeated LLM calls per click.
- No paid subscription / live checkout before classification/compliance/licensing checks.

---

## 2. BRAND + LOGO FIRST, WITHOUT BLOCKING ENGINEERING

The brand is not finalized. Start by creating a **brand configuration abstraction** before polishing screens:

```ts
export const brand = {
  publicName: "BetTipsPro", // VISUAL PLACEHOLDER from screenshot, NOT a final approval
  tagLine: "Analyse smarter. Understand the evidence.",
  companyOwner: "Motion Imprints Technologies",
  primary: "#16EE8D",
  deepNavy: "#031727",
  faviconPath: "/brand/favicon.svg",
  logoPath: "/brand/brand-mark.svg"
};
```

Implement a logo mark as an editable/vector SVG in source: sophisticated football + probability/data motif; legible at 24px and as a mobile app icon; no copying another company's logo or existing sports-club mark. Provide horizontal full logo, standalone mark, white/green version, favicon and a placeholder wordmark. Test on dark navbar and light cards. It must be easy to replace the wordmark when the owner chooses the final business name.

- Provide 2–3 clean local logo directions in `design/brand/` with vector output, not ten random concepts.
- Avoid embedding big illustrations into the logo.
- Preserve layout when changing from a short to a medium-length name.
- **Do not purchase a domain, commission a logo, register a trademark or finalize the name without explicit owner approval.**
- Licensing: do not casually reuse club badges, league competition emblems, player photographs or Sofascore artwork commercially. Use original/licensed replacements and confirm rights before publication.

---

## 3. VISUAL BLUEPRINT: PRIMARY SCREENSHOT IS THE SOURCE OF TRUTH

### 3.1 Reference priority order

1. **User-provided BetTipsPro homepage image:** reference for desktop proportions, visual hierarchy, alignment, section arrangement, typography mood, background, cards, accent, spacing.
2. **User feedback after local screenshot review:** controls adjustments.
3. **Sofascore:** reference for deep match centres, fixture lists, live status presentation, tabs, mobile navigational patterns and statistical organization (not its branding/style).
4. Modern accessibility/responsive conventions, when not in conflict with the reference.

The screenshot is approximately **1536 × 1024**. Inspect its actual dimensions and geometry programmatically/visually; do not assume the measurements below are exact. Capture comparison screenshots at the same viewport and iteratively tune.

### 3.2 Desktop structure — reproduce closely

**A. Dark horizontal nav (~top 75px in the sample):** left logo and small tag line; centre nav links; search icon, Login outline and luminous green Get Started button on the right. A subtle navy gradient, no giant white header. Suggested links: Home, Today's Matches, Match Centre, Leagues, Statistics, Tools, Blog. Product navigation labels may differ from screenshot only where clarity improves.

**B. Full-width stadium hero (~75–473px in sample):** cinematic football/stadium photography or original composition. Strong navy overlays create legible white bold 2-line heading; selectively highlight one line/phrase in green. Description and prominent green CTA left; a group of footballers/stadium action on the right, with natural cropping. Preserve large type and dark premium sports editorial aesthetic. If the image in the screenshot cannot be commercially used, replace **only the hero artwork** with appropriately licensed original art preserving the same composition, contrast and positions. Never rely on copyrighted photos merely because an AI mockup showed recognizable players.

**C. Hero benefits bar:** four compact items across bottom of hero using dark circular icons: Data-Driven Analysis, Evidence-Based Insights, Major Leagues & Markets, Research Tools. Vertical separators or clean spacing. Avoid fabricated accuracy claims.

**D. Light content zone:** soft off-white/very light-gray background begins directly under hero, with consistent max-width container and two-column asymmetric grid (~70% / 30%). Moderate gap and crisp shadows.

**E. Main left white card:** “Today's Match Insights” or visually same footprint as “Today's Top Tips”: flame/sports symbol, date pill, “View all” action. Compact table with columns: Fixture, Highlight Market, Decimal Odds (if provider+rights), Model Probability, Competition, Kickoff. Club badge/icons only when legally usable. Several densely packed but readable rows; subtle separators; small green progress bars; odds pills. Rows clickable to fixture research. Don't populate real-looking fixtures with invented values; demo label when mock.

**F. Right dark premium card:** deep-green/dark textured football creative, crown icon, compelling copy about unlocking deep analysis, mini feature checklist, wide green CTA. In beta CTA means “Join beta / Unlock report”, not an operational paid purchase. Keep same relative footprint and visual density as reference.

**G. Right white performance card below premium:** chart icon, “Our Research Performance” or comparable, three horizontally arranged KPIs. Do **not** show 68% wins, 24.6% ROI, 147 winning tips from the original screenshot unless our immutable recorded forecasts substantiate those exact values. For beta, show “Backtest pending”, “0 verified live forecasts”, “Calibration under evaluation”, or clearly labeled tutorial mock data. Preserve the card design.

**H. Three league tiles below main table:** Premier League, La Liga, UEFA Champions League; image-based cards with navy overlays, titles and small detail text, outline/light CTA; same visual positions and sizes as reference. Real league name use may be allowed descriptively; avoid unlicensed competition logos and photos.

**I. Lower page sections beyond screenshot:** past forecasts and results; how probabilities are computed; sample analysis preview; league coverage; pricing beta; responsible use; footer with privacy, terms, data notices, attribution and company ownership. These must visually harmonize with hero and screenshot.

### 3.3 Suggested design tokens (tune to actual reference)

```css
:root {
  --navy-950: #031521;
  --navy-900: #061b2b;
  --navy-800: #0a2739;
  --accent: #16ed87;
  --accent-hover: #07d977;
  --surface: #ffffff;
  --page: #f5f8fa;
  --text: #10202f;
  --muted: #62748a;
  --line: #e3ebf0;
  --radius-card: 13px;
  --radius-button: 8px;
  --shadow-card: 0 5px 20px rgba(1, 20, 35, 0.06);
  --font-sans: Inter, ui-sans-serif, system-ui, sans-serif;
  --content-max: 1420px;
}
```

Use consistent weights, readable compact sports tables, meaningful hover/focus states, subtle transitions only (150–250ms), no gratuitous animations or excessive blurred glass. Keep the screenshot's recognizable aesthetic.

### 3.4 Mobile design — not desktop squashed

Test widths **320, 360, 390, 414, 430, 768, 1024, 1280, 1536** and landscape. Target actual common Android devices in Uganda and slow connections.

- A compact dark mobile nav: logo, search, sign-in/profile, accessible menu; no clipped navigation.
- Hero: keep stadium backdrop and aesthetic, but crop visually to show pitch/athlete on the upper/right side **without** hiding the headline. Scale headline to 30–38px depending width; CTA stays above fold where feasible. Use art-directed mobile hero crop or a dedicated lighter derivative image, not a huge desktop file forced into a phone.
- Feature icons become a two-by-two grid or compact horizontal strip.
- Fixtures should be **mobile-friendly stacked match cards** or an intentionally scrollable compact table with pinned match identity; do not make users pan across six tiny illegible columns.
- Cards stack in this order: featured fixtures, league navigation, premium beta access, verified performance, methodology; adapt emphasis as needed while preserving the primary design.
- On match details: sticky compact match header; horizontal scrollable tabs such as Overview, Goals, Corners, Cards, Players, Referee, Odds, Model & Evidence. Keep touch targets >=44×44 CSS pixels when possible.
- Evidence tables need expandable rows, concise metrics and ability to drill down; never bury underlying records behind generic prose.
- Mobile loading skeletons must match card shapes and avoid layout jumps.
- Do not show sideways overall page scrolling, stacked sticky bars occupying most of screen, detached CTAs, oversized image payloads or tiny typography.
- Color contrast and keyboard navigation are mandatory. Respect reduced motion, screenreader labels and semantic table headers.

### 3.5 Visual QA deliverables

Generate saved screenshots in `artifacts/visual-review/` at 1536×1024 and 390×844 (plus 360 and 768 widths) with the **same viewport** as the source reference. Compare structural geometry, content density, navbar placement, hero height, player/stadium composition, button contrast, tables, right-hand cards and league tiles. Use image-diff tooling if available but also manually assess. Iterate until there are **no conspicuous layout deviations**. Note any permitted changes: replacing rights-sensitive media, legal/compliant messaging, responsive adaptations and truthful performance stats.

---

## 4. INFORMATION ARCHITECTURE + ROUTES

### Public

| Route | Main purpose |
|---|---|
| `/` | Screenshot-faithful homepage |
| `/matches` | Fixture calendar, today/tomorrow, league/date/team search, status |
| `/matches/:matchId` | Free preview; report unlock and complete match research for entitled users |
| `/leagues` | Competition directory, supported seasons, upcoming fixtures |
| `/leagues/:leagueId` | Competition fixture board and coverage metrics |
| `/statistics` | Model performance, league coverage, public validation methodology |
| `/predictions/archive` | Timestamped pre-match public forecast record and settled results |
| `/research/how-it-works` | Models, evidence, uncertainty, market definitions |
| `/pricing` | Beta explanation now; transparent prices later |
| `/about` | Product, company ownership, purpose |
| `/legal/privacy`, `/legal/terms`, `/legal/data-rights`, `/responsible-use` | Required policy pages (owner/legal review before public commercialization) |

### Signed-in

| Route | Main purpose |
|---|---|
| `/app` | Dashboard, recent unlocks, favorites, credits |
| `/app/reports` | Purchased/unlocked match reports and history |
| `/app/credits` | Credit ledger; beta grants; later payment history |
| `/app/settings` | Profile, consent, logout, session controls |
| `/app/feedback` | Beta feedback, inaccuracy reports |

### Admin (role protected)

`/admin`, `/admin/testers`, `/admin/credits`, `/admin/fixtures`, `/admin/ingestion`, `/admin/forecasts`, `/admin/coverage`, `/admin/api-budget`, `/admin/feedback`, `/admin/audit`, `/admin/config`.

No admin endpoint may be authorized solely by hiding a frontend button.

---

## 5. SINGLE MATCH RESEARCH EXPERIENCE — THE PRINCIPAL VALUE

A customer selects a fixture, sees a short free overview and optionally unlocks a full **match dossier**. An unlocked report contains:

1. Fixture identity: teams, competition/season, stadium, date/time in Uganda timezone (EAT) plus UTC, official status, confirmed vs tentative kickoff, source last updated.
2. Probability summary: home/draw/away (mutually exclusive total 100% within rounding), double chance, goals over/under, BTTS, correct score if supported. Only independent, validated model output.
3. Explore markets grouped by category: Match Result, Goals, BTTS, First Half, Corners, Cards, Referee, Player Events, Special/Combined. Every item has probability, model/data quality status, time of forecast and unlock state.
4. Click a market e.g. **Under 2.5 goals**: **a full evidence view, not a tooltip with generic text**. Show model estimate, independent historical occurrence rates, sample sizes and time windows; actual previous fixtures in sortable tables; recent performance; home/away splits; opposition quality; head-to-head context; xG if source supports it; team availability; charted distributions; model assumptions and uncertainty; sources and dates; and a restrained narrative.
5. For **Over 9.5 corners**: average/median and frequency of corner totals over N recent fixtures, team-for/team-against rates and opponents; relevant event-time/tactical proxy evidence if present; avoid speculative "always overlaps" claims without tracking/event-location data.
6. For **Over 3.5 yellow cards**: referee match history (where known), team cards for/against, league baseline, discipline context, card counting/settlement rules; never insult or assert bias by a named referee.
7. Player props only if reliable lineup, minutes and event feed exist. Conditional-on-starting model and “lineup not confirmed” state required.
8. Price panel: bookmaker name, market key, decimal price, implied probability `1/odds`, optional normalized market probability if all mutually exclusive outcomes are present; last observed timestamp and provider; disable comparison if stale or bookmaker not supported. The platform's model probability is **separate** from bookmaker implied probability.
9. Historical result/forecast audit: links to settled fixture outcomes and the exact immutable pre-kickoff published forecast; indicate model revision dates. Never rewrite old forecasts to look successful.
10. Evidence quality labels: `VERIFIED`, `PARTIAL`, `INSUFFICIENT`, `STALE`, `SIMULATED_DEMO`. If required source records are absent, display **Insufficient evidence** rather than a made-up probability.
11. Explain market settlement distinctions. E.g., 90-minute regular-time result differs from extra-time winner; card points differ from raw card count; player props sometimes void if not starting. Do not claim compatibility with betPawa without verifying actual market rules.
12. Actions: save, copy report citation/permalink, download lightweight printable summary if feasible; **no direct automated bets**.

### Required evidence detail structure

```json
{
  "fixture_id": "provider:fixture_id",
  "market_id": "TOTAL_GOALS_UNDER_2_5_REGULATION",
  "forecast": {
    "probability": 0.55,
    "model_version": "goals-v0.1",
    "forecast_generated_at": "ISO_UTC",
    "as_of_data_at": "ISO_UTC",
    "interval": null,
    "status": "DEMO_ONLY"
  },
  "observed_evidence": {
    "recent_home": {"sample": 8, "under_hits": 5, "window": "LAST_8_HOME", "source_fixture_ids": []},
    "recent_away": {"sample": 8, "under_hits": 5, "window": "LAST_8_AWAY", "source_fixture_ids": []},
    "h2h": {"sample": 0, "source_fixture_ids": []}
  },
  "methodology": "Model probability derived from the estimated scoreline distribution; not equal to a raw historical hit rate.",
  "data_coverage": {"goals": "available", "xg": "unavailable"},
  "source_manifest": [],
  "display_notice": "SYNTHETIC DEMO DATA: NOT A REAL FORECAST"
}
```

The above is a **shape sample**, not data that should be passed off as a live event. Real records must include actual provider IDs, query timestamps and sourced fixture IDs.

### Example of proper explanatory writing

**Bad:** “This is 78% because this team has always dominated at home.”  
**Better:** “The model currently estimates X%, using the teams' estimated goal rates and opponent-adjusted performance. In the last N verified home matches, Team A recorded Y unders; Team B recorded Z away unders. These historical shares are shown separately from the model probability. Historical head-to-head comparisons are based on M matches, with older matches downweighted. The sample does not establish a guaranteed result.”

For model explanations, require traceability to the underlying features and explicit distinction between model drivers and descriptive history. Do not use SHAP or other explanatory tooling as a causal proof.

---

## 6. FOOTBALL DATA PROVIDER: FREE FIRST, REALISTIC BUDGET

### 6.1 Verified provider plan (check current terms again at account creation)

API-Football official pricing lists a **free plan with 100 requests/day**, broadly available endpoints, but **restricted seasons and uneven historical coverage**. The $19 Pro plan advertises 7,500 requests/day but **we are not buying it yet**. Direct-dashboard free requests are rate-limited; plan for **no more than 10 calls/minute** unless live account headers/docs confirm otherwise. Requests/day reset at 00:00 UTC for subscriptions bought via the API-Football dashboard. Never share the API key or open multiple accounts to evade free limits.

Important: **A report unlock credit is NOT one upstream API request**. Do not design the system around equating these.

### 6.2 Provider account steps (only when key is needed)

1. Prepare API adaptor, schema, mocks, tests, environment validation and dashboard UI *before requiring the key*.
2. When actual API verification is essential, tell owner: open `https://dashboard.api-football.com/` or `https://dashboard.api-football.com/register`, create **one free account**, then provide the API key **only via a local secret/.dev.vars/environment secret flow**, not a chat paste or GitHub commit.
3. Add `.dev.vars.example` placeholders; `.dev.vars` and `.env` with secrets are `.gitignore`d. Use `wrangler secret put` only when authorized for a deployed environment.
4. Implement a `/health/providers` diagnostic visible only to admins that returns `configured/unconfigured`, connection success/failure, quota remaining if provider supports it, data age and endpoint coverage — **never** echoes the API key.
5. If key unavailable, finish every part that is not key-dependent; keep functional demo provider and clear setup instructions. The owner can add it later without refactoring code.

### 6.3 Ingestion rules

**Rate-limit implementation detail:** Official API-Football provider guidance (12 June and 27 July 2026) gives the Free plan **10 requests/minute**, alongside 100 requests/day. Capture the actual response headers `x-ratelimit-requests-limit`, `x-ratelimit-requests-remaining`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining`; observe both counters. Prefer a single scheduled ingestion controller for the beta. If admin/manual/background workers can all enqueue updates, they must coordinate through **one shared, atomic budget/rate limiter**; separate in-memory counters in edge isolates are insufficient. The Python pipeline must consume saved snapshots or go through the same budget gateway, not silently make a second set of unmetered calls. When no central coordination can be demonstrated, disable concurrent upstream fetching and allow an admin-only serialized batch job.

**Provider route verification:** Query `GET /status` only according to the documented API-Football contract (or equivalent) and count its request cost; never assume quota-check endpoints are free. Read the official endpoint specs before implementation.

- Provider abstraction: `SportsDataProvider` interface; `ApiFootballProvider`, `DemoFixtureProvider`, eventually secondary data provider.
- Normalize fixture ID, league, season, teams, timezone-aware kickoff, status, score, half-time, source update time.
- Normalize provider-specific market labels and bookmaker information into internal versioned market taxonomy.
- API fetches only server-side or in authorized offline scripts. Never client-to-provider direct calls.
- Use fetch timeouts, capped retries with jitter, circuit breakers, response validation, source/raw checksum and logging without secrets.
- Apply **central quota admission control**, minimum delay between calls, per-minute token bucket, and a daily usage ceiling **at or below 80** for the beta initially; reserve 20 calls for emergencies/debugging. Reconfigure based on measured consumption, never unlimited.
- API call deduplication: single-flight for concurrent same-key fetch; cache keyed on endpoint+normalized params+provider version.
- Do not re-fetch old settled fixtures unnecessarily. Refresh upcoming fixtures at sensible intervals; adjust as kickoff approaches while remaining inside the free quota.
- When rate-limited or exhausted, show cached data with age/coverage notices. No uncontrolled retry loops.
- Some historical endpoints on the free plan may be unusable for modelling: report this explicitly as a **data limitation**. Do not bridge gaps with imagined seasons.
- Prioritize ~10 **preselected pilot fixtures** for the first test, rather than assuming all 50 unlocked reports will be for 50 independently data-heavy fixtures.

### 6.4 Request budget example — planning assumption, not quota guarantee

| Daily activity | Planned calls |
|---|---:|
| Schedule/fixture refresh | 8 |
| Selected fixtures core event/statistics data | 30 |
| Teams' recent match/stat data | 22 |
| Selective lineups/injuries/odds checks | 12 |
| Retry/diagnostic allowance | 8 |
| **Operational budget** | **80** |
| Reserve inside 100 daily cap | 20 |

Actual data completeness will depend on **how many endpoints and historical calls each fixture really needs**. Measure actual provider usage per prepared report and revise accordingly. If ten excellent reports cannot fit the free tier due to historical season limits, reduce fixture count or offer a research preview and document the paid-data gate — **do not pretend the free tier supplies rich history that it does not**.

### 6.5 Major licensing / commercial rights gate

API-Football states that its subscription **does not itself grant rights to publicly publish all sports data, competition assets or images**, and that betting-platform use may need additional permission from rights holders. Direct resale of raw feed data is restricted. Read official terms at `https://www.api-football.com/terms` and contact the provider/appropriate rights holders about our exact **paid match-report presentation** before commercial launch.

Therefore:

- For local beta, use minimal legally appropriate data access and owner-controlled testing. Do not publish unauthorised bulk proprietary records publicly.
- Do not build a bulk raw-feed redistribution download product.
- Logo/club crest/league badge rights are separate from statistics rights.
- Public release and monetization are **blocked until legal/data-rights review is completed**, not merely until a user pays an API subscription.

---

## 7. STATISTICS + PREDICTION ENGINE — ACTUAL NUMERICAL MODELS

Use Python 3.12 (or an explicitly compatible version), pandas, NumPy, scipy, statsmodels, scikit-learn and optionally XGBoost/LightGBM. Heavy modelling runs **offline / batch in its own Python pipeline**, not inside a Cloudflare Worker HTTP request. The frontend consumes versioned, persisted prediction artifacts.

### 7.1 Model families

| Market family | Initial method | Derived/validation notes |
|---|---|---|
| 1X2, match goals, total goal thresholds, BTTS, exact score | Poisson attack/defence model; compare Dixon–Coles or bivariate Poisson | Derive jointly from scoreline distribution; correct sum-to-one properties |
| First-half result/goals | Time-split model or event-time rate model | Do not just halve whole-match estimates without testing |
| Corners for/against & total corners | Negative binomial count models, conditional team effects | Check dispersion, home/away and opposition quality |
| Yellow cards, bookings | Count model with referee+team+league effects | Respect bet settlement definitions and booking-point differences |
| Red cards, penalties | Regularized/hierarchical rare-event models | Strong shrinkage, wide uncertainty, minimum sample checks |
| Player shots or other props | Participation/minutes conditioned count models | Need reliable lineup/availability/player records |
| Market combinations | Joint probability simulation with dependencies | Do not multiply marginal probabilities if correlated |

### 7.2 Evaluation strategy

- Set baselines: league rates, team rolling rates, naive scoring distribution and bookmaker benchmark **only if odds are legally available**.
- Use chronological train/validation/test splits or rolling-origin evaluation; **no future injury/lineup/results leakage**.
- All features must have an `as_of_at` timestamp and be available before forecast lock time.
- Compare log loss, Brier score, reliability/calibration plots, ECE (with limitations), sharpness and, where available, benchmark odds/margins. Win rate alone is insufficient.
- Validate separately by league, market family, time horizon, event rarity and coverage level. Report sample sizes and error bars.
- Fit calibration only on held-out past data, not on evaluation records.
- Check invariants: 1X2 sums to 1, Over 2.5 + Under 2.5 = 1 for same settlement period, monotonically decreasing probability with increasing over-goal threshold, odds-implied calculations consistent with decimal price.
- Simulations: if using 20,000+ joint samples for convenience, simulation count is **not** historical evidence sample size and cannot erase model uncertainty.
- Do not publish a probability if insufficient training coverage or no validated mapping exists. Show a quality flag and reason.
- Store permanently: input dataset version/hash, model version, forecast time, calibration version, market definition version, as-of time, feature provenance, evaluation metrics and predicted probability.
- For the **first free-data pilot**, if real historic data are too sparse for a credible model, still implement the model pipeline and mark forecasts as research/experimental; require real validation before describing them as predictive expertise.

### 7.3 Business and outcome rules

- No model training on post-match data for that same pre-match prediction.
- Actual settled results joined after fixture finishes; use source status and settlement definitions; use manual verified correction workflow when needed.
- Keep immutable archive of forecasts made before kickoff. If models are updated, new version new record, old record preserved.
- Performance dashboard should not display ROI unless we have explicitly defined historical price snapshots, stakes/settlement, costs and tested calculation methodology. A prediction accuracy dashboard is **not** a fabricated betting performance report.

### 7.4 Pipeline execution separation

`python` scripts process provider snapshots, train/validate models and generate versioned compact JSON artifacts. In beta, execute from the owner's development machine with a CLI; upload/import safely to local database via authenticated administration/import script. **Do not silently add a perpetual paid Python server.** Run local batch modelling with explicit recorded provenance and consistent shared provider quota bookkeeping. Future options: scheduled GitHub Actions (with known schedule drift and quotas), a managed Python job runner, or a Cloudflare-compatible paid compute solution only after benchmarking and owner approval.

---

## 8. OPTIONAL GEMINI / VERTEX LAYER — EVIDENCE-GROUNDED ONLY

Reuse lessons from the owner's existing Gemini/Vertex AI work **without sharing production credentials, quota or billing accidentally**. Separate configuration and monthly budget per project.

The Gemini module is **off by default** for the pilot; pure deterministic templates should produce useful, factual explanations immediately. Later enable optional cached summaries generated **once per fixture/report version**, not on every viewer click.

### AI boundaries

- Gemini **cannot invent model probabilities, past scores, cards, corners, odds, player availability or source citations**.
- It gets only verified structured evidence and approved model outputs with source manifest.
- Ask it to summarize the verified facts, model uncertainty and interpretations clearly. Require structured JSON and schema validation.
- Post-process by exact reconciliation of numeric claims/fixture IDs to source registry. Unsupported claims are rejected or replaced with deterministic fallback text.
- No claimed tactical formations, overlaps or pressing tendencies unless event/position/verified source material supports such inference. Explicitly say evidence not available.
- No "sure win", "guaranteed profit", coercive urgency, excessive promotional gambling language.
- AI errors must never block core match pages.

### Budget controls

- Feature flag `AI_EXPLANATIONS_ENABLED=false` by default.
- Set per-job and per-month token ceilings, global hard application spend budget and maximum concurrent generation jobs.
- Calculate input/output tokens and model pricing from actual selected Vertex model; do not assume free promotional credits remain.
- Store generated explanation, token/cost metadata and content hash. Reuse for all customers unlocking that fixture and market until data/model version changes.
- On quota exhaustion return template explanation, no repetitive expensive retries.

---

## 9. CUSTOMER CREDITS + $3 PRICING LOGIC

### Beta first

- Create exactly **five invited beta accounts** (or support five concurrently through admin invitation flows).
- Each receives **10 free full-match-report unlock credits** via a one-time idempotent admin-grant transaction. No card or Mobile Money charge in beta.
- A distinct `user_id + fixture_id + report_version_entitlement_scope` is one report unlock. A previously unlocked fixture remains readable; do **not** deduct again for browsing markets, returning after logout, hitting reload, retries or viewing newly refreshed report revisions within the defined entitlement policy.
- Decide and document whether free beta credits expire. Suggested beta test: no expiry during the short, defined beta period. Make it configurable.
- The word **request** in consumer pricing means **match-report entitlement**, not raw API or Gemini calls.
- If only ten preselected fixtures exist, five users can analyze the same ten reports with maximum **ten underlying data sets** cached, even though fifty entitlements are issued.

### Commercial hypothesis (disabled during beta)

| Proposed package | Price | Unlock credits | Effective cost/report |
|---|---:|---:|---:|
| Starter | **$3** | 10 | $0.30 |
| Analyst (experiment) | $7 | 30 | ~$0.23 |
| Pro (experiment) | $15 | 80 | $0.1875 |

These are *unvalidated willingness-to-pay hypotheses*. Consider UGX display and payment gateway fees before final pricing. Provide price configuration rather than hardcoding bundles in multiple screens. Do not show a functioning paid checkout before legal/payment readiness.

### Security requirements for credits

- Authoritative credits live in server-side SQL, **never** localStorage.
- Enforce atomic decrement and idempotent entitlement creation inside one transaction. Use unique unlock key and conditional `balance >= 1` update. Double-click, refresh, parallel browser tabs and simultaneous requests must never double-charge.
- Ledger is append-only: grants, spends, refunds, reversals/voids, expiry when enabled, adjustments; every record has a reason, actor, idempotency key and time.
- Manual admin credits require role auth and audit log; not a public POST route.
- Never grant credits because a client reports a payment as successful. Future payment credits apply only after verified signed provider webhooks and duplicate-event detection.
- Render useful “not enough credits”, “report unavailable”, “already unlocked”, “provider data stale” and “try later” states.

---

## 10. TECH STACK — FAST CLOUDFLARE-FRIENDLY WEB APPLICATION

### Chosen default stack (adjust only with documented justification)

- **Frontend:** React + TypeScript + Vite + Tailwind CSS (or high-quality CSS modules) + accessible component primitives; React Router or another mature client router with code splitting. Keep third-party JS lean.
- **API:** TypeScript Cloudflare Worker, preferably Hono or similarly lightweight framework with schema validation (e.g., Zod). Avoid large Node-only server frameworks that perform poorly in Worker runtime.
- **Deployment:** Cloudflare Worker **Static Assets** serving compiled frontend and Worker API in one coherent project; GitHub as source and later Cloudflare Git integration or Wrangler-based CI, configured but not deployed without authorization.
- **Transactional DB:** Cloudflare D1 SQLite with migrations and typed query layer. Free tier is suitable for an initial prototype but imposes data-size, daily row quotas and single-DB serialization; write efficient indexed queries and test load.
- **Object storage:** avoid for pilot if unneeded; consider R2 later for appropriately licensed larger historical snapshots/model artifacts; can store compact artifacts during local development.
- **Cache:** HTTP edge caching for public pages and versioned resources; tiny in-process cache where safe; optional Workers KV only if needed given its own write limits. D1 indexes and precomputed report JSON remain the source of truth.
- **Background scheduling:** scheduled Worker only for small fetch/admin tasks within Worker CPU and provider quota; **Python ML remains separate**.
- **Stats/models:** Python offline modules with deterministic outputs and imported forecast snapshots.
- **Tests:** Vitest + Testing Library + Playwright; Python pytest and model invariants; k6/Artillery or equivalent representative load tests.
- **Security:** maintained Worker-compatible authentication library/provider with verified integration; avoid building raw password systems by hand. Invite-only beta + OAuth identity is acceptable if correctly validated. If library compatibility is doubtful, evaluate alternatives and document trade-offs before implementing.

### Do not assume instant capacity

Cloudflare Free Workers include 100,000 Worker requests/day and strict **CPU** quotas (currently 10ms CPU/request) — fine for light cached request handlers, not CPU-heavy ML. The $5 Cloudflare Workers Paid entry tier changes limits but may incur overages; **do not silently subscribe**. D1 Free currently has a 500MB per-database size limit and daily row-read/write limits; test actual usage. More concurrent browser sessions do not mean more API-Football calls, but they *do* create frontend/API/cache/database load and potentially costs.

### Source control vs hosting — clarify

- **GitHub:** repository of code, commit history, review and CI. GitHub Pages is *not* our chosen full-stack production host.
- **Cloudflare:** frontend/Worker API/CDN + D1 at launch.
- **Later workflow:** develop locally → tests/visual review → commit to GitHub → configure Cloudflare integration/secrets → preview staging → approve production deploy.

---

## 11. DATABASE DESIGN — REQUIRED ENTITIES AND CONSTRAINTS

Write actual D1 SQL migrations and typed access methods. Suggested tables (adapt nomenclature cleanly):

1. `users(id PK, email UNIQUE, display_name, role, age_confirmed_at, created_at, status)`.
2. `auth_accounts(user_id, provider, provider_subject, UNIQUE(provider, provider_subject))` and session storage per selected validated auth system.
3. `beta_invites(id, email_or_hash, code_hash, status, issued_at, used_at, expires_at, max_uses)` with signed/invited control; redact codes in logs.
4. `wallets(user_id UNIQUE, balance CHECK(balance>=0), updated_at, version)`.
5. `credit_ledger(id, user_id, amount_signed, kind, actor_id, idempotency_key UNIQUE, created_at, metadata_json)`.
6. `report_unlocks(id, user_id, fixture_id, unlocked_at, entitlement_scope, UNIQUE(user_id,fixture_id,entitlement_scope))`.
7. `competitions(id PK, provider_id UNIQUE, name, country, coverage_json, source_updated_at)`.
8. `teams(id PK, provider_id UNIQUE, name, competition info, source_updated_at)`.
9. `fixtures(id PK, provider_id UNIQUE, competition_id, season, home_team_id, away_team_id, starts_at_utc, status, score_json, provider_last_updated)`.
10. `fixture_events(id PK, fixture_id, provider_event_id, period, minute, kind, data_json, source_version)`.
11. `team_stats_snapshots(id PK, fixture_id or team/season, scope, data_json, captured_at, provider_id, checksum)`.
12. `market_definitions(id PK, family, settlement_period, label, threshold, definition_json, version, active)`.
13. `forecasts(id PK, fixture_id, market_definition_id, probability, model_version, generated_at, data_as_of_at, dataset_hash, status, quality_reason, uncertainty_json, UNIQUE(fixture_id, market_definition_id, model_version, generated_at))`.
14. `forecast_evidence(id PK, forecast_id, source_fixture_id, metric, value, sample_window, source_ref, captured_at)`.
15. `bookmaker_snapshots(id PK, fixture_id, market_definition_id, bookmaker_name, odds_decimal, collected_at, stale_after, provider_source)`.
16. `match_reports(id PK, fixture_id, report_version, report_status, summary_json, analysis_json, evidence_manifest_json, generated_at, UNIQUE(fixture_id,report_version))`.
17. `model_evaluations(id PK, model_version, market_family, league, period, sample_n, brier, log_loss, calibration_json, evaluated_at)`.
18. `provider_api_usage(id PK, provider, utc_day, endpoint, request_count, credits_consumed, status, latency_ms, UNIQUE-safe aggregation key)`.
19. `ingestion_jobs(id PK, kind, target_id, status, attempts, provider_calls, started_at, finished_at, error_code)`.
20. `beta_feedback(id PK, user_id, fixture_id NULL, rating, category, text, created_at, triage_status)`.
21. `admin_audit_log(id PK, actor_id, action, entity, entity_id, before_json, after_json, created_at)`.
22. `plans`, `orders`, `payments`, `payment_events` can be migrations/schema-stubbed for **later**, but **checkout and payment webhooks remain disabled** until a provider is approved and fully implemented.

Indexes on `(fixtures.starts_at_utc, competition_id)`, `(forecasts.fixture_id, market_definition_id, generated_at)`, `(report_unlocks.user_id, fixture_id)`, `(bookmaker_snapshots.fixture_id, collected_at)`, `(credit_ledger.user_id, created_at)`, `(provider_api_usage.utc_day, provider)`. Do not create huge JSON blobs in a single D1 row. Enforce DB foreign keys and validate schemas.

### D1 atomicity implementation note

Use an implementation that is **actually atomic in the selected Cloudflare D1 runtime**, such as a properly constructed D1 transactional batch with conditional wallet update and postconditions, or a validated equivalent serialization pattern. Do not copy ordinary `BEGIN TRANSACTION` / `COMMIT` SQL from a Node SQLite tutorial without verifying D1's supported behavior. Concurrency tests must exercise the real D1 adapter rather than only an in-memory mock; if the database method cannot enforce all-or-nothing ledger+unlock semantics under races, fix the design before beta.

### Credit atomicity test (mandatory)

On a wallet containing one credit, launch two simultaneous distinct report unlock attempts. Exactly one succeeds, one fails appropriately, wallet becomes zero, ledger count is exactly one spend. Repeat with two requests for the **same** fixture and verify at most one charge but both can view the unlocked report. Handle retry/idempotency and failure between ledger/entitlement creation without lost credits.

---

## 12. EXPLICIT API CONTRACT (IMPLEMENT AND DOCUMENT)

Public read endpoints (rate-limited and indexed):

- `GET /api/v1/health` readiness (no secrets)
- `GET /api/v1/competitions?country=&supported=`
- `GET /api/v1/fixtures?date=&league=&team=&status=&page=`
- `GET /api/v1/fixtures/:id/preview`
- `GET /api/v1/fixtures/:id/markets` (only public unlocked sample values as approved)
- `GET /api/v1/statistics/models` verified historical metrics only
- `GET /api/v1/predictions/archive?league=&market=&period=`

Authenticated:

- `GET /api/v1/me`, `GET /api/v1/me/credits`, `GET /api/v1/me/unlocks`
- `POST /api/v1/fixtures/:id/unlock` with idempotency key and optional report version; atomic server-side credit consumption
- `GET /api/v1/fixtures/:id/report` entitlement check, versioned report JSON; 402/403/409 or appropriate structured errors
- `GET /api/v1/fixtures/:id/markets/:marketId/evidence`
- `POST /api/v1/feedback` with validation + anti-bot/rate limits

Admin-only:

- `GET /api/v1/admin/usage`, `GET /api/v1/admin/jobs`, `GET /api/v1/admin/coverage`
- `POST /api/v1/admin/invitations`, `POST /api/v1/admin/credits/grant`
- `POST /api/v1/admin/ingest` or strongly authenticated local import pipeline
- `POST /api/v1/admin/forecasts/import` after strict schemas and as-of validations
- `POST /api/v1/admin/cache/invalidate` on authorized changes

Apply consistent structured JSON envelopes, error codes, pagination, request IDs, server timestamps, caching headers, strict parsing, useful unauthorized/insufficient-credit states and versioning. **No unauthenticated endpoint may trigger unbounded live API-Football/Gemini operations**.

---

## 13. AUTHENTICATION / TESTER ACCESS

Beta testing needs **real authentication**, not hardcoded “five demo users” on the client. Suggested:

1. One verified administrator initialized through secure one-time setup.
2. Admin creates five invitations tied to intended tester email addresses; invite expires and is one-use.
3. Sign-in via a mature OAuth implementation or other maintained Cloudflare-compatible auth library; verify nonce/state/PKCE/session and actual provider identity. Never trust a client-submitted email without verification.
4. Server-side, secure `HttpOnly`, `Secure`, appropriately `SameSite` scoped session cookies; CSRF protection where applicable, session expiry/revocation and rate limits.
5. Automatic idempotent allocation of ten beta credits after a valid accepted invitation; audited.
6. `adult_confirmed` and privacy consent captured before content access, but self-attestation is not proof of regulatory compliance; lawyer/regulator review before public use.
7. Clear logout and “delete account/request data” workflows. Protect personal data according to applicable law.
8. Bot controls such as Cloudflare Turnstile for registration/abusive forms, with **server-side validation**; do not assume a client widget alone is protective.
9. Give testers a short feedback guide and build a page for qualitative feedback and bug reporting.

---

## 14. HIGH PERFORMANCE, 500-CONCURRENT-USER DESIGN TARGET

### Performance objectives (aspirational; measure)

- Home cached-page LCP **<=2.5s** at p75 on realistic 4G mobile; CLS **<=0.1**, INP **<=200ms** on tested devices.
- Cached fixture list endpoint p95 **<300ms** under a representative steady workload.
- Cached full-report API endpoint p95 **<600ms** under realistic load including auth and DB lookups.
- Interactive market tab switches perceived instantaneous (<100ms local UI latency), no new upstream AI/sports fetch per click.
- No long-blocking CPU tasks in HTTP handlers. Target zero accidental 3rd-party provider calls on a standard cached report view.
- Minimum WCAG AA-style contrast/keyboard/semantics wherever practical.

### Architecture choices

- Build small, static, CDN-cached landing route/assets; use `Cache-Control` appropriately with privacy boundaries.
- Never edge-cache a private authenticated response globally. Use per-user auth gates; cache shared public report **data structures** only at safe backend boundaries.
- Pre-generate model outcomes and evidence. Use stale-while-revalidate only where accurate/staleness disclosed.
- Ship AVIF/WebP hero artwork with responsive `srcset`; preload only critical font/image subset; lazy-load league artwork below viewport.
- Use route-level code splitting; avoid a huge chart/AI module on home route.
- Skeletons reflect real component dimensions; support offline/poor-network retry without double-unlocking.
- Avoid chat widgets, auto-video, heavy backgrounds, perpetual polling, arbitrary 3D libraries, huge icon packages.
- D1 single-database read throughput is finite. Use indexed select queries, select only required fields, minimize joins and cache public fixture boards. Load-test and scale strategy if real performance demands it.

### Performance and cost budgets are independent

- **Upstream sports-data quota:** hard admissions controls (100/day absolute Free maximum, 80/day initial operational target, 10/min provider cap) regardless of whether five or 500 customers browse the site.
- **Web traffic:** model browser requests (HTML/CSS/JS/image) separately from authenticated Worker calls; 500 connected users is not a provider quota unit.
- **Gemini:** off by default. If later enabled, count generated report variants, not user page views, and enforce independent billing controls.
- **D1 and Cloudflare:** benchmark rows read/written, Workers CPU and free-tier requests under traffic spikes. If paid capacity is required, report estimated cost and request consent.

### Load test matrix

Simulate **1 / 5 / 25 / 100 / 500 concurrent users** across these actions:

- 65% browsing cached fixture board and opening match details.
- 20% reading saved reports and clicking internal market tabs (zero new upstream provider calls).
- 10% logging in / viewing credits.
- 5% simultaneous report unlocks with deliberate duplicates and failures.

Report p50/p95/p99 latency, error rate, browser Core Web Vitals, D1 reads/writes, provider calls and spend, CPU/memory. Run limited or local representative tests before any live public stress test. **If free Cloudflare limits cannot hit the 500-user target, state measured failure and propose scaling options; do not make up a success result.**

---

## 15. ADMIN OPERATIONS + COST CONTROL DASHBOARD

The admin page must show:

- Number of invitations sent, testers activated, weekly active testers, credits granted/spent, distinct report unlocks, user feedback scores.
- Sports API configured/unconfigured, current UTC day's provider calls, free cap, safety reserve, calls by endpoint, last successful refresh, stale fixtures.
- Data-provider and legal-rights status by competition/market.
- Models published, validation status, calibration quality, forecasting coverage and failures.
- Gemini toggle/budget/spending only when enabled; no exposed API keys.
- Cloudflare deployment environment and last commit/version.
- Responsive, filters, time-window exports for owner's internal analysis.

**Never claim that "0 API calls" on a mock is a demonstrated production cost.** Show provider mode clearly.

---

## 16. MARKET CATALOGUE + BOOKMAKER SUPPORT

Create versioned `market_definitions` with `id`, `market_family`, `settlement_rules`, `scope`, `threshold`, `required_data`, `model_family`, `validation_status`, `coverage_requirements`, `licensing_status`, `active_for_beta`.

### Beta market rollout

- **Tier A:** 1X2, double chance, Over/Under common goal thresholds, BTTS, exact-score distribution where model calibrated.
- **Tier B:** team goals, first-half totals, corners, yellow-card counts **only when sufficient quality records exist**.
- **Tier C:** referee/player markets, rare events, complex combinations after data quality and calibration requirements met.

No blanket promise of “50+ markets”. Show realistic, supported coverage. Bookmaker markets require exact settlement definitions (90 minutes vs extra time, void rules, cards/pitches, etc.), and odds data may not include **betPawa**. If betPawa is absent, show selected available bookmaker with proper name/time, or omit market price instead of inventing an equivalent. No unauthorized scraping or bypass of bookmaker access controls.

---

## 17. BETTING/GAMING COMPLIANCE, SAFETY AND BUSINESS ETHICS

Before money-taking or public betting-related advertising, obtain **Ugandan legal/regulatory classification** of a paid odds/analysis service and any relevant advertising/consumer protection/privacy compliance. The [National Lotteries and Gaming Regulatory Board](https://lgrb.go.ug/) publishes gambling advertising guidelines. Do **not** assume non-wagering reports are exempt or require a gambling operator licence; get a qualified determination.

- Adult-only access controls appropriate to jurisdiction.
- Clearly display: analysis is informational, all probabilities are uncertain, no guarantee of winnings.
- Responsible-gambling links and self-exclusion resources where appropriate; avoid urgency, payday inducements, guaranteed returns, "must bet" messages, manipulative loss-chasing prompts.
- Terms of service, refund/dispute policy before live selling, privacy policy, consent, transparent use of Google/Cloudflare/provider data, cookie notices as required.
- All false/unsubstantiated ROI, winning tip counts and performance claims prohibited.
- All paid beta/test transactions (if ever introduced) require approved licensed payment integration, independent payment verification and signed webhook handling.

---

## 18. DELIVERABLE REPOSITORY STRUCTURE

Use a single maintainable repo (adjust folder names slightly only with documented reason):

```text
football-research-platform/
├── README.md
├── MASTER_BUILD_DIRECTIVE.md               # this file copied into repo
├── AGENTS.md                                # terse project-specific agent instructions
├── package.json
├── pnpm-lock.yaml                           # or other chosen reproducible lockfile
├── wrangler.jsonc                           # Cloudflare config, no secrets
├── .dev.vars.example
├── .gitignore
├── .github/workflows/
│   ├── ci.yml
│   └── preview-deploy.yml                   # optional, OFF until owner approval
├── design/
│   ├── reference/homepage-reference.png     # user-provided blueprint; local unless permission to commit
│   ├── brand/                               # editable SVG logo candidates and tokens
│   └── visual-qa-checklist.md
├── public/
│   ├── brand/
│   └── images/                              # original/licensed optimized assets
├── src/
│   ├── app/                                 # routing, providers, layouts
│   ├── pages/                               # home, match list, match centre, reports, admin
│   ├── components/                          # hero, fixture table, probability, evidence, charts
│   ├── features/{fixtures,reports,markets,credits,auth,admin}/
│   ├── styles/                              # screenshot-based design tokens
│   ├── lib/                                 # API client, formatting, validation, utils
│   └── main.tsx
├── worker/
│   ├── index.ts                             # request handler
│   ├── routes/
│   ├── middleware/
│   ├── services/{sports,forecasts,reports,credits,ai}/
│   ├── providers/{api-football,demo}/
│   ├── db/
│   └── jobs/
├── migrations/                              # Cloudflare D1 migration SQL
├── model-pipeline/
│   ├── pyproject.toml
│   ├── src/{ingest,features,models,calibrate,validate,export}/
│   ├── scripts/
│   ├── tests/
│   └── data/README.md                       # licenses/data acquisition; data not in Git
├── fixtures/demo/                           # CLEARLY synthetic example records
├── tests/{unit,integration,e2e,security,performance}/
├── artifacts/visual-review/                 # generated screenshots; generally ignore in git
└── docs/
    ├── decisions.md
    ├── status.md
    ├── technical-architecture.md
    ├── setup-free-api-football.md
    ├── database-schema.md
    ├── market-taxonomy.md
    ├── model-validation.md
    ├── licensing-and-compliance.md
    ├── cloudflare-deploy-runbook.md
    ├── beta-test-script.md
    ├── security-review.md
    ├── costs-and-quotas.md
    └── release-checklist.md
```

Create real content and executable code, not empty folder theater.

---

## 19. IMPLEMENTATION ORDER — DO THESE IN SEQUENCE, DON'T STOP AT A MOCKUP

### Phase 0 — Inspect assets, baseline and decisions

- [ ] Find and inspect owner-uploaded homepage screenshot, report dimensions, copy to `design/reference/homepage-reference.png` where authorized.
- [ ] Check workspace; do not overwrite unrelated existing work. Create isolated repo/project directory.
- [ ] Write `docs/decisions.md`, record brand placeholder and reference priority.
- [ ] Scaffold app, Worker, migrations, model-pipeline folder, tests and project README.
- [ ] Define exact acceptance checklist from sections 3, 5 and 21.

### Phase 1 — Logo system and screenshot-accurate frontend

- [ ] Brand config and SVG mark candidates; owner can later approve/replace name and mark.
- [ ] Reproduce desktop navbar, hero, feature strip, fixtures table, dark premium card, white performance card, three league tiles.
- [ ] Add believable but **obviously demo** fixture records, no counterfeit current odds/claims.
- [ ] Mobile layouts 320–430 and tablet; make navigation/filters/tables genuinely usable.
- [ ] Create match list, deep match centre, market analysis drilldown, unlock UI, admin and account shells.
- [ ] Generate/inspect reference-comparison screenshots; fix disparities.
- [ ] All buttons/links functional; no dead CTAs or inert UI-only features.

### Phase 2 — Database/auth/credits

- [ ] D1 migrations, seed data and local DB initialization.
- [ ] Secure invite-only login, sessions, RBAC and admin route.
- [ ] Invite five testers with 10 credits each; robust idempotent grant.
- [ ] Unlock transaction and ledger, re-open/report entitlements, concurrency tests.
- [ ] Correct error/loading/empty/stale states and feedback flows.

### Phase 3 — Football API free-plan integration

- [ ] Provider abstraction, demo provider and contract tests.
- [ ] Environment variable handling and guide for **one** API-Football free account.
- [ ] Admin-only connection test, request counter, 10/min guard and <=80/day operational budget.
- [ ] Real fixtures, selected reliable historical stats, odds only if available and rights suitable.
- [ ] Write source manifest and coverage report for ten selected pilot matches.
- [ ] Fall back to explicitly labeled demo mode when key/data unavailable; don't invent values.

### Phase 4 — Independent statistical engine

- [ ] Python ingestion normalization, stable feature generation and reproducible model script.
- [ ] Goals baseline and model, 1X2/BTTS/threshold derivations, validation and archive.
- [ ] Other market families only when data available and model validation supports.
- [ ] Versioned model artifact import to D1/API and data-evidence detail panels.
- [ ] Source records, sample sizes, previous fixtures and forecast rationale.

### Phase 5 — Gemini (optional)

- [ ] Deterministic explanation templates work with Gemini **disabled**.
- [ ] Separate budget-limited Vertex adapter, schemas, source number verification, retries/fallback.
- [ ] Cache one report explanation per model/evidence hash and report version.
- [ ] In beta, keep off unless owner authorizes actual token spending and provides isolated credentials.

### Phase 6 — Robustness + beta acceptance

- [ ] QA screenshot comparisons at all breakpoints; no overflow.
- [ ] Automated tests and security/cross-role tests green.
- [ ] API-Football calls measured and <= free cap.
- [ ] Five invitees can each unlock ten distinct reports where available; no double deductions.
- [ ] Browse one match with 15–20 truly supported and validated markets **only if data enables**; otherwise list actual supported count with honest gating.
- [ ] All statistical statements/records sources/known unknowns displayed.
- [ ] Run local/staging load matrix and document measured performance.
- [ ] Create beta guide and tester feedback workflow.

### Phase 7 — GitHub / Cloudflare preparation (do not deploy prematurely)

- [ ] Git repository, CI, dependency lock, secrets hygiene, SECURITY.md and .gitignore.
- [ ] Wrangler config, D1 bindings/migrations, production-safe env flags, preview route, DNS/custom-domain checklist.
- [ ] Document step-by-step Cloudflare connection from GitHub and anticipated free/paid quotas.
- [ ] Once owner approves, push/connect/deploy, test preview, check auth/HTTPS/headers and then public environment only with legal/data rights and security approval.
- [ ] **Do not publish the source screenshot or restricted data into a public GitHub repository by default**. Source visibility should be decided explicitly.

### Phase 8 — Commercialization after readiness gates

- [ ] Validate the business name/domain/trademark availability.
- [ ] Complete data publishing permissions and Uganda regulatory/legal review.
- [ ] Decide approved merchant of record/payment provider, Mobile Money support and settlement/webhook controls.
- [ ] Activate pricing/checkout only after successful verified test transaction, reconciliation and refunds/security review.
- [ ] Analyze paid conversion and retention based on actual users rather than assumptions.

---

## 20. IMPLEMENTATION EXAMPLES / GROUND RULES

### Provider interface (illustrative; adapt to actual coverage)

```ts
interface SportsDataProvider {
  listFixtures(dateISO: string, leagueIds?: string[]): Promise<FixtureRecord[]>;
  getFixture(fixtureId: string): Promise<FixtureRecord | null>;
  getHistoricalRecords(input: {teamId: string; season?: number; cutoffUtc: string}): Promise<VerifiedMatchRecord[]>;
  getFixtureStats(fixtureId: string): Promise<SourceStampedStats | null>;
  getOdds?(fixtureId: string): Promise<OddsSnapshot[]>;
  getQuotaState?(): Promise<{limit: number; used: number; resetAt?: string}>;
}
```

Every source record includes provenance `(provider, fetched_at, provider_fixture_id, season, data_status)`. Every odds snapshot includes bookmaker, market, decimal odds, as-of time and licensing/availability.

### Feature flags

```dotenv
APP_ENV=development
SPORTS_PROVIDER=demo                 # demo | api_football
SPORTS_API_FREE_MODE=true
SPORTS_API_DAILY_BUDGET=80
SPORTS_API_PER_MINUTE_MAX=10
AI_EXPLANATIONS_ENABLED=false
PAYMENTS_ENABLED=false
BETA_INVITE_ONLY=true
MAX_BETA_USERS=5
BETA_INITIAL_CREDITS=10
PUBLIC_PERFORMANCE_ONLY_VERIFIED=true
```

Secret examples separated from non-secrets:

```dotenv
# Secret placeholders; never put actual credentials in version control.
API_FOOTBALL_KEY=YOUR_KEY_GOES_IN_LOCAL_SECRET_STORE
SESSION_SECRET=GENERATE_A_STRONG_SECRET
OAUTH_CLIENT_SECRET=OPTIONAL_WHEN_IDENTITY_PROVIDER_CONFIGURED
VERTEX_CREDENTIALS=OPTIONAL_AND_DISABLED_IN_BETA
```

### Response quality standards

- Use unambiguous `utc` timestamp storage and Uganda EAT presentation, including kickoff changes.
- No fabricated bookmaker partnerships, no false “verified” badge.
- Abort stale provider call on timeout; preserve already-prepared analysis where suitable.
- Report/cache version IDs stable, unlike volatile LLM prose.
- Full historical evidence datasets may be license-restricted; the engineering team must decide what can legally be displayed and retained.
- Cache privacy: never expose customer emails, credits or private reports from another user's session.

---

## 21. RELEASE ACCEPTANCE CHECKLIST (MUST REPORT PASS/FAIL)

### Design

- [ ] At 1536x1024 the reference screenshot's navbar, stadium hero, green CTA, feature strip, main fixture card, premium sidebar, performance sidebar and league tiles are recognizably reproduced.
- [ ] At 390x844 all flows are properly designed, not reduced desktop; no sideways page overflow; hero, headers, CTA and figures legible.
- [ ] Logo editable/swappable; protected sports imagery replaced or licensed.
- [ ] Distinguishes demo data from live data visually, especially on homepage.

### Product behavior

- [ ] Fixtures/league filtering and search work.
- [ ] Match preview and full evidence drill-down exist; no generic unsupported “because history” prose.
- [ ] Every market probability has model/source/version/quality metadata, or correctly shows insufficient evidence.
- [ ] At least the validated initial markets render with historical tables and source identifiers.
- [ ] No fake odds, matches, performance numbers or ref allegations.
- [ ] Public forecasts are immutable and measurable after completion.

### Beta and API budgets

- [ ] Exactly 5 invited testers possible; 10 credits granted each once.
- [ ] One match consumes at most one credit per user; repeated views/markets cost 0 additional credits.
- [ ] Parallel unlock tests do not overspend wallet or duplicate ledger records.
- [ ] Free provider mode throttles at documented limit and stops before exceeding daily budget.
- [ ] Cached report reads produce **zero** new API-Football and Gemini calls.
- [ ] Works in demo mode before owner creates free provider account.

### Performance, security, compliance

- [ ] Mobile performance test and visual diff evidence; measured timings recorded.
- [ ] No exposed secrets, client-side authority over balances, insecure admin endpoints or payments bypass.
- [ ] Unit/integration/e2e suites executed and their results logged.
- [ ] Auth/session/CSRF/credit/concurrent load tests documented.
- [ ] No unapproved spend, Git push, deployment or public monetization.
- [ ] Legal/data rights/regulatory gates clearly visible in `docs/release-checklist.md`.
- [ ] Reproducible README commands from a fresh machine and no hidden credentials.

---

## 22. INITIAL TEST PROCEDURE: FIVE PEOPLE × TEN REPORTS

1. Operator runs local demo. IDE displays screenshot-faithful homepage and fully navigable demo reports.
2. Operator creates one free API-Football account when prompted by the setup guide (not ahead of necessity); securely configures key.
3. Pipeline selects and audits **ten** near-term fixtures whose free-plan data coverage is acceptable; record missing data transparently. Do not invent fixture availability.
4. Historical/statistical sources are prepared under <=80 provider calls/day budget, supplemented **only with legitimate permitted public/owned datasets** if necessary. No unauthorized scraping.
5. Models run offline. If evaluation cannot credibly support a market, disable it / mark research only.
6. Owner uses admin invite flow to register five invited adults; each gets ten credits.
7. Each person unlocks some of the same ten fixtures and explores goal, match result, corner/card (where available) evidence tabs; reopening and tab switching cannot consume additional credits.
8. Every tester completes a feedback form: screenshot aesthetics, mobile usability, analysis usefulness, trust/evidence strength, feature gaps, price sensitivity, response speed and confusing wording.
9. Owner reviews measured economics: sports provider calls, cached hit rate, Gemini calls (ideally 0 during beta), errors, report completion time and user feedback.
10. Only after findings, decide whether free data suffices or $19/month Pro is justified, and whether a paid product is legally/licensably ready.

---

## 23. FUTURE COMMERCIAL STRATEGY — NOT A LICENSE TO MISLEAD

Target a premium data-analysis service whose value is transparent explanatory work. The draft selling proposition:

> “Explore the probabilities, actual match evidence and model uncertainty behind football markets. Research each match in depth, then make your own informed decisions.”

Measure real funnel: `visitor → free demo viewed → account invited/registered → report unlocked → next-week return → paid trial → renewed purchase`. Track cohort retention, per-report operating cost, refunded transactions, evidence quality complaints and false confidence in model percentages. Do not plan future revenue by assuming that betting interest means high paid conversion.

Monetization should be compatible with mobile-money customers, transparent UGX equivalent, payment fees and refunds; choose provider after due diligence. On site, avoid implying the model can generate income reliably.

---

## 24. SOURCE LINKS / REFERENCES TO RE-CHECK WHEN BUILDING

* [API-Football pricing](https://www.api-football.com/pricing) — free plan 100 calls/day, paid plans, endpoint families; limits can change.
* [API-SPORTS official rate-limit explanation](https://www.api-football.com/news/post/how-ratelimit-works) and [quota optimization](https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage) — Free 10/min, quota headers, efficient cache use.
* [API-Football official terms](https://www.api-football.com/terms) — no direct feed resale; third-party publishing/logo rights; betting-use licences may be needed.
* [API-Football docs](https://www.api-football.com/documentation-v3) — correct endpoint contract; do not guess response fields.
* [Cloudflare Workers static assets](https://developers.cloudflare.com/workers/static-assets/) — one frontend+Worker deployment unit.
* [Cloudflare Worker pricing](https://developers.cloudflare.com/workers/platform/pricing/) — plan limitations, CPU, request allowances.
* [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) — account/database limits and read/write quotas.
* [Cloudflare Workers GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/) — source push → preview/deploy after authorization.
* [Cloudflare Turnstile security](https://developers.cloudflare.com/turnstile/get-started/) — verify tokens server-side.
* [Uganda NLGRB advertising guidelines](https://lgrb.go.ug/download/nlgrb-advertising-guidelines/) — legal review, not a determination of the site's classification.
* [Sofascore](https://www.sofascore.com/) — *functional UX research only*, never a licence to copy.

**Important technical caution:** Do not present these links and projected performance targets as a completed security, commercial rights, or capacity audit. Verify the current product documentation and actual capabilities at implementation time.

---

## 25. FIRST ACTION REQUEST TO IDE AGENT (START HERE)

**Proceed to implementation now.** First inspect the provided screenshot and the repository environment. Give the owner a short paragraph confirming how you will reproduce the screenshot visually; then execute Phase 0 → Phase 1 and continue through the remaining locally implementable phases without asking for routine permission. Use clear, small commits and run validations. Only stop where an external account/secret, actual spend, production publication, uncertain sports data rights or legal approval requires the owner's action.

### Before declaring the beta complete, hand over these concrete outputs

1. Local URL and exact commands from a fresh checkout, with `demo` mode functioning without secrets.
2. Screenshot review files for 1536×1024 and 390×844; concise discussion of deviations from the reference.
3. A clickable walkthrough: homepage → fixture → locked market → unlock once → evidence page → other markets free → reopen after logout/login → feedback.
4. Five-user invite and credit-ledger test proof, including double-click/race tests.
5. API-Football free-account setup page requiring the owner's one authorized key-entry action, measured quota consumption on the test match sample.
6. Clear result count for actually model-supported markets and a documented list of unsupported markets.
7. Real test output (unit, integration, E2E, security, mobile, load) and limitations. No invented green checkmarks.
8. Cloudflare deployment runbook, GitHub instructions and precise owner approvals needed; **do not present readiness as permission to deploy or charge customers**.

**Critical rule:** When the user opens the working homepage in the browser, it should immediately remind them of the exact supplied BetTipsPro image. It should not resemble a generic different dashboard. When a user opens a market like Under 2.5 goals, the next page should display substantive traceable match-specific evidence rather than unverifiable AI prose. When five beta users access the same report, they should share precomputed data without multiplying provider costs.

**Definition of success:** A visually impressive, mobile-polished, functional, securely gated and genuinely testable free beta; production-ready architectural foundations and honest documentation of what is still awaiting external accounts, data rights, model validation, branding and deployment approval.
