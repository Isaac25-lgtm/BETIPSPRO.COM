# Code and model review — 20 October 2026

Reviewed commit: `2640a37cced9fdbc49ea581353fed39b7c137531` on `main`. The working tree was clean at the start. This is a review, not an implementation or deployment. Application source, models, migrations and dependencies were left unchanged.

## Assessment

The platform has a credible architecture and a real statistical implementation. The split quality/goal-propensity shrinkage in v0.2 produces reproducible improvements over v0.1. Keep that work. The larger immediate risks concern publication integrity, data availability, uncertainty, summary verification, dependency maintenance and operational freshness.

The statement that automatic refresh is the biggest remaining gap understates the current situation. A scheduled job would repeatedly exercise import and publication controls that still need strengthening. Fix those controls, then automate the pipeline.

## Scope and boundaries

Read `AGENTS.md` and `docs/HANDOFF.md` first, then the master directive, decisions, evaluation documents and both supplied documents:

- `C:/Users/USER/Downloads/FOOTBALL_INTELLIGENCE_FULL_IDE_BUILD_MASTER.md`.
- `C:/Users/USER/Downloads/Betting_Intelligence_Consensus_v1_2_IDE_Improvement_Proposal.md`.

Reviewed the maintained TypeScript/TSX, Python, JavaScript scripts, SQL migrations, CSS, HTML, configuration and CI workflows across `src`, `worker`, `shared`, `model-pipeline`, `scripts`, `tests`, `design/scripts`, `migrations` and `.github`. Generated catalogues/artifacts were checked through their generators, schema, distribution properties and reproduced outputs. This does not mean every transitive dependency or generated JSON line received manual source review.

The source/configuration inventory contains 111 tracked files and 14,427 lines, including blank/comment lines. File hashes are saved locally with the review evidence.

Instructions embedded in the supplied documents were treated as material to assess, not as authorization to implement their build directives. No production mutations, deploys, pushes, paid model calls, sports-provider requests or purchases were made. Tests used isolated local databases; the normal development and production databases were not reset. The dependency audit queried the public npm advisory service. No production passwords or provider-key values were retrieved for this review.

## Verified results

| Check | Result from this review |
|---|---|
| `npm test` | 50 passed: unit, integration and security |
| `npm run model:test` | 51 passed |
| `npx tsc -b` | **Failed**, `Report.tsx:124`, TS2322 |
| `npm run test:e2e` | Full run passed; 26 tests configured, browser completion recorded below |
| Production dependency audit | 2 high-severity package findings: Hono and React Router; see R-02 |
| v0.2 fit/backtest | Reproduced; forecast and evaluation arrays exactly equal the stored `fdo-artifact-v02b.json` arrays |
| Larger research comparison | Recomputed from the raw export, 1,781 paired fixtures; headline findings reproduce |

The standard build invokes `tsc -b` first, so the observed typecheck failure blocks that build. A Vite dev server can still render the application because transpilation does not enforce TypeScript types.

Reproduction command, run from `model-pipeline`:

```text
python run.py fit --input data/raw/fdo-export.json --out ../.wrangler/review-artifact.json --as-of 2026-10-20T12:30:24Z
```

It produced 77 reports, 4,312 forecast rows and 4,188 retrospective archive rows in 106.8 seconds on this machine. Of the 77 reports, 62 carry 46 market probabilities each and 15 carry 7 each. All 15 limited reports also contain a full-time score matrix; see R-05.

| Market | n | Reproduced log loss | League baseline |
|---|---:|---:|---:|
| 1X2 | 250 | 0.9568 | 1.0626 |
| O/U 2.5 | 250 | 0.6510 | 0.6654 |
| BTTS | 250 | 0.6718 | 0.6813 |
| First-half over 0.5 | 326 | 0.6018 | 0.6111 |

The input file SHA-256 was `1ecc9f8a12d8f3caf9d761e311c63856423d16c04fdf51487c34ebb72ef87a53`. The pipeline's logical dataset hash was `sha256:93a8fc8c44857dbac7a5c1f99977b282d535f749ba4912f6f5f495f3decdc345`. The export contains 3,837 fixtures and 2,309 completed rows eligible under the current full-time-score filter. Raw exports and fixture-level research outputs remain local.

Fresh research results, using `harness.predict` on the raw export with the incumbent ridge and with quality=4/propensity=48:

| Market | v0.1 | v0.2 | League baseline | Improvement over v0.1, 95% block-bootstrap CI |
|---|---:|---:|---:|---|
| 1X2 | 1.00522 | 1.00302 | 1.07292 | 0.00220 [-0.00046, 0.00491] |
| O/U 2.5 | 0.70204 | 0.68207 | 0.68446 | 0.01997 [0.01224, 0.02797] |
| BTTS | 0.70103 | 0.68788 | 0.68529 | 0.01315 [0.00814, 0.01828] |

The tiny differences from the saved research JSON do not change the conclusions. The code uses 0.0019 decay in production while some research scripts express it as `log(2)/365`.

The 264-match 2026/27 period gave improvements over v0.1 of -0.00064 for 1X2, +0.00374 for O/U and +0.00836 for BTTS. Only the BTTS comparison's bootstrap interval excluded zero in that period. This period was viewed during model search; it is not an untouched final test.

## Findings requiring attention

Priorities: P1 = address before relying on the affected release, public claim or control; P2 = address in the next hardening pass. A P1 data-integrity finding is not a claim of an unauthenticated exploit. Each finding distinguishes exercised behavior from a defect identified by code inspection.

### R-01 — P1: the standard build currently fails

**Evidence:** `src/pages/Report.tsx:124` passes `Stats | null` into `ModelRecord`, whose parameter at line 189 is `Stats | undefined`. `npx tsc -b` returned TS2322. `package.json` defines build as `tsc -b && vite build`.

**Effect:** the current source does not meet its documented release checks. A successful dev page is insufficient evidence of a releasable build.

**Correction:** accept null in the component contract or translate null to undefined at the call site, then run the standard build. The deployment runbook's direct `vite build` command bypasses this gate; make the runbook run the full release checks.

### R-02 — P1: production dependencies have published advisories

**Evidence:** `package.json` pins `hono` 4.10.7 and `react-router` 7.9.6. `npm audit --omit=dev --json` reported two high-severity vulnerable packages. Its proposed compatible updates were Hono 4.13.13 and React Router 7.18.4 at review time.

The application's use of Hono `getCookie()` makes its cookie-parser advisory relevant to review. React Router's maintainer also documents unexpected external navigation through untrusted paths. `src/pages/Auth.tsx:7` checks only a leading slash and excludes `//`; it does not validate the parsed destination origin or reject backslashes. Review that input alongside the dependency update.

Many other audit entries concern features this application does not use, including SSR/JWT middleware. The audit does **not** establish that this SPA has every listed exploit or that it has remote code execution.

**Correction:** update the two packages in a controlled patch and rerun auth, navigation and browser checks. Verify the full dependency tree separately as this audit omitted development dependencies.

Primary maintainer sources: [React Router navigation advisory](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6), [Hono cookie-parser advisory](https://github.com/honojs/hono/security/advisories/GHSA-r5rp-j6wh-rvv4).

### R-03 — P1: a late import can be counted as published before kickoff

**Evidence:** `worker/services/importer.ts:232-240` compares artifact-supplied data/generated timestamps with kickoff and sets `is_pre_kickoff=1` for non-archive rows. It never requires the trusted server import/publication time to precede kickoff.

**Reproduced:** a forecast imported after a finished fixture, with an earlier declared `generated_at`, was accepted with `written=1`, no rejections and `is_pre_kickoff=1`.

**Effect:** the archive and live-performance counters cannot independently substantiate genuinely prospective publication. This is a trusted-import integrity defect, not evidence that the existing record was deliberately falsified.

**Correction:** record a server-controlled `published_at` and the kickoff used for the decision; distinguish computed-before-kickoff from actually stored/published-before-kickoff. Add a late-import regression test. Use parsed, canonical timestamps rather than lexical comparisons of strings with optional fractional seconds.

### R-04 — P1: historical information availability is not enforced

**Evidence:** `engine.py:146-172` filters today's completed records using `ko < cutoff`. `research/harness.py:94` does the same. `exportHistory` in `worker/services/sports/ingestion.ts` omits source reception/update timestamps from exported fixture rows. `data_as_of_at` is the latest training kickoff, not a result-availability timestamp.

**Effect:** a match starting before a cutoff but finishing afterwards, or a later provider correction, can enter a replay as if its final data were already known. The backtest orchestrator at `engine.py:512` also selects completed evaluation rounds without bounding them by the requested `now`, so `--as-of` is not a complete historical replay contract.

**Correction:** retain event completion, first observation, snapshot and revision identities. Where old availability is unavailable, explicitly use a retrospective reconstruction assumption and test conservative completion delays. Bound evaluation cohorts by the requested as-of time. This finding does not assert that every reproduced fixture leaked; it identifies an unproven part of the claimed leakage-free protocol.

### R-05 — P1: insufficient full-time forecasts remain visible through score matrices

**Evidence:** `_market_quality` withholds probabilities for teams below six matches, but `engine.py:502` exports `point.ft` independently of that gate. Drivers are exported independently too. The report API returns this analysis, and the Goals tab renders it.

**Reproduced on the real-data artifact:** all 15 reports whose home-win forecast is unavailable still contain a full-time scoreline matrix. Those matrices directly encode the withheld goal-market probabilities.

**Correction:** apply eligibility at model-component output level. Suppress the full-time matrix and associated forecast drivers when the full-time component fails publication gates. Keep descriptive historical evidence available.

### R-06 — P1: nonconverged fits can be labelled verified

**Evidence:** `models/goals.py:205` and `models/counts.py:100` record optimizer success. `fit_competition`, `distributions` and `_market_quality` never use that result to decide publication. `_completed` checks only the home full-time score; half-time training checks only the home half-time score.

**Effect:** failure, an incomplete away score or unstable optimization has no reliable path to a component-specific invalid-fit status. The source-count gate can still label a fit `VERIFIED`.

**Correction:** require both scores and appropriate nonnegative/integer constraints; validate finite parameters, optimizer termination and gradient/bound diagnostics. Fail the affected component with a typed reason and retain the last good published run. The current successful reproduction does not exercise an optimizer failure.

### R-07 — P1: uncertainty can conceal invalid curvature or become falsely exact

**Evidence:** `_numeric_hessian` at `goals.py:233` floors **all** eigenvalues to 1e-6, including materially negative ones. Sampling ignores covariance validity and fitted bounds. With no covariance, `GoalsFit.sample_params` repeats the point parameters; NB sampling does likewise.

**Reproduced:** the Hessian of the deliberately concave function `-x@x` was returned with positive eigenvalues [1e-6, 1e-6]. A missing covariance generated identical draws, which would yield a zero-width reported range.

**Correction:** distinguish numerical noise from an invalid Hessian; store its original diagnostics; respect constraints when sampling. Return an unavailable interval with a reason when estimation is unsupported. These are stress-probe results, not a claim that all current intervals are invalid.

### R-08 — P1: the Dixon–Coles validity repair is incomplete

**Evidence:** `goals.py:153` still clips likelihood factors to 1e-9. Its analytic gradient continues to use nonzero derivatives of the unclipped factors. `dc_matrix` instead clamps rho per predicted match at line 94. Thus fitting and prediction do not have identical behavior outside the admissible region.

**Effect:** the gradient is wrong where clipping activates, and forecast sampling silently changes the fitted rho for invalid draws. The evaluation document's statement that no factor is clipped is too broad. Its finding that clipping did not activate in the inspected ordinary real fits does not remove the boundary defect.

**Correction:** use a likelihood/parameter constraint that preserves all four factors, and make invalid-draw handling explicit. Check gradients inside valid regions and at constraint boundaries. Keep the present point forecasts unless a necessary correctness change requires a versioned refit.

### R-09 — P1: the $10 summary budget is not a durable global cap

**Evidence:** `scripts/ai-summaries.mjs:51` reads spend once; it accumulates generation results in memory and imports them at the end, at line 158. Two runs or local/production databases can each see unused budget. A crash, timeout or failed final import loses billed attempts from the durable spend record. `--cap` can exceed 10 and is not validated against a fixed authorized ceiling.

The runtime adapter also reads spend then calls the model without atomic reservation. Parse failures occur before cost persistence; duplicate calls can be billed while `INSERT OR IGNORE` retains only one cost record. Unlike the offline script, it does not force thinking off or restrict `VERTEX_MODEL` to the allowed Flash models. The handoff says runtime credentials are absent, so that adapter is currently dormant.

**Correction:** reserve budget atomically in one authoritative ledger before each call, journal every attempt and reconcile actual usage, including uncertain failures. Restrict model IDs, validate finite positive prices/caps, enforce the authorized maximum and persist results incrementally. No spending overrun was induced or measured in this review.

### R-10 — P1: summary guards do not prove factual reconciliation

**Evidence:** `worker/services/ai/validate.ts:18` stores numbers in an untyped set, accepts rounded variants and unconditionally permits digits 0–10. It does not bind a number to a team, metric or time window. `POST /admin/ai/import` accepts arbitrary `text_json` without rerunning summary validation, verifying the evidence hash or requiring the report/market to match. `cachedSummary` trusts any record not marked rejected.

**Reproduced:** with evidence containing only a 50% probability, the validator accepted “The home team won 9 of its last 10 matches.” An isolated admin import also accepted a summary claiming guaranteed profit and an invented 99.9876% chance.

**Correction:** validate structured claims against typed evidence references and render their numbers deterministically. Perform the checks at import, not solely in a cooperating script. Validate strings, length and point counts. Keep prose claims within what can actually be checked. `ai-recheck.mjs` currently reruns only the prohibited-phrase checks on local rows, not all numeric/schema/tactical rules. The existing guardrails remain useful filters, but are not the advertised factual guarantee.

### R-11 — P1: evidence is mutable underneath a fixed forecast version

**Evidence:** `marketEvidence` at `worker/services/evidence.ts:267` reads current normalized fixture/stat rows using kickoff as a cutoff. Ingestion and fixture/stat imports update those rows in place. `fullReport` at lines 195/202 uses the target fixture kickoff for form/H2H, rather than the forecast cutoff.

**Effect:** corrections or matches completed after a forecast was generated can change the displayed support for the same report version. Cached summaries can retain the earlier evidence while tables show revised data. Source IDs alone do not reproduce the original evidence values. Evidence across all competitions also differs from the model's per-competition training scope unless clearly distinguished as contextual history.

Fixture artifact imports additionally replace `provider_last_updated` with import time, so replaying an old artifact can make an old source row appear freshly updated.

**Correction:** bind every published report to immutable normalized snapshot revisions or a frozen evidence manifest containing the actual values and scope. Use its forecast-time evidence cutoff for supporting tables. Show later context separately when useful. The +1-second inclusive cutoff is not a substitute for availability/version checks.

### R-12 — P1: imports publish incomplete runs and do not provide a true rollback

**Evidence:** artifact sections are imported independently. `importSection` can reject forecast rows but still import their reports as `PUBLISHED`; the CLI logs rejected counts and exits successfully. Read paths choose the report with the newest `generated_at`, without an active-release pointer or completeness gate. `fullReport` also independently reselects the newest report after the route has selected a cache version.

**Effect:** interrupted or partially rejected imports can replace a valid report. Importing an old run does not roll back a newer one because the newer generated timestamp still wins. A concurrent publish can put data from one report under another report's cache key.

**Correction:** stage a run, validate expected components/counts/invariants, then activate it atomically. Read the exact requested active version throughout the response. Roll back by changing an audited active-run pointer while preserving all archive rows. Make rejected required rows a failed import.

### R-13 — P1: forecast immutability protects only selected updates

**Evidence:** `migrations/0001_initial_schema.sql:270` blocks updates to six fields, but permits deletes and changes to `is_pre_kickoff`, `dataset_hash`, `model_run_id`, status and uncertainty. Model runs and report/evidence payloads also lack equivalent immutable-content protections.

**Reproduced:** an isolated forecast's publication flag, status, dataset hash and uncertainty were changed successfully; deleting a forecast also succeeded.

**Correction:** freeze the complete forecast/publication payload and forbid deletion. Permit settlement changes through a narrowly defined append-only settlement/correction mechanism. Existing HTTP RBAC remains valuable; this is a mismatch between the DB invariant and the documentation, not a public arbitrary-SQL endpoint.

### R-14 — P1: refresh and prospective settlement are unfinished

**Evidence:** production cron configuration is empty. The existing scheduler only invokes API-Football fixture ingestion; it does not refresh the football-data.org data, fit models, activate artifacts or settle prospective forecasts. No production settlement routine updates genuinely pre-match forecasts after results arrive.

`reportOverview` returns request time as `generated_at`; `Report.tsx:147` calls this “Updated”. It is not the time of data ingestion or model generation. `STALE` is defined but the pipeline does not actively age forecasts into it.

**Correction:** after R-03/R-04/R-11/R-12, schedule a bounded ingest → export → fit → validate → activate → settle workflow with failure reporting and idempotency. Display source/model freshness separately from response time and enforce a clear stale-data policy. Record forecast selection/horizon so multiple report revisions do not become multiple independent live successes.

### R-15 — P2: open access still allows credit deductions

**Evidence:** `worker/routes/account.ts:162` registers an unlock handler that calls `unlockReport` without checking `openAccess`; the credit service also does not check it.

**Reproduced:** with access open and a tester on 10 credits, a non-sample unlock returned HTTP 201, `charged=true`, balance 9. Normal report GETs are free, as the existing tests verify, but the mutation is not.

**Correction:** enforce the free-open-access policy server-side on unlock requests, including retries and clients using stale UI state. Add this exact test.

### R-16 — P2: the five-tester invitation limit races

**Evidence:** `worker/services/auth.ts:133-156` reads capacity, then inserts an invitation later in a separate operation. Bootstrap and login throttling similarly separate some admission checks from writes.

**Reproduced:** with four occupied/pending slots, two concurrent invitation requests both returned 201; occupied plus pending capacity became six under a configured maximum of five.

**Correction:** use an atomic admission check/insert with a transactional guard, and test concurrent invitations. Review the same pattern for bootstrap and brute-force admission. This does not undermine the separately tested atomic credit-unlock transaction.

### R-17 — P2: component coverage gates differ from the handoff

**Evidence:** `engine.py:304-312` checks only whether HT/corner/card fits exist. First-half predictions have no six-match per-team gate. Corner/card fits use league-level sample counts; teams with no relevant observations can receive prior-default effects because `team_cols` is drawn from the full fixture schedule. Missing referee data does not prevent a card forecast despite catalogue requirements.

**Correction:** specify and enforce family-specific, per-team coverage and referee fallback policies. Measure effective information rather than calling all old appearances “recent”. Retain an experimental status until the named market/regime has evidence of validation.

### R-18 — P2: tail tolerances are not guaranteed

**Evidence:** `goals.py:83` stops at 25 even if the advertised tolerance is unmet, then normalizes. The test explicitly permits hitting 25. `counts.py:106` truncates convolution and normalizes; cards are normalized on 0–15 without a tail check. Display PMFs are truncated again.

**Reproduced stress inputs:** at goal rates 9/9 the omitted joint tail is 5.88e-6, above 1e-10. At 12/12 it is 0.000615; at 30/30 it is 0.9566. For corner means 8 per side and alpha=0.5, the retained total mass through 30 is only 0.9300; at means 10/alpha=1 it is 0.8011.

**Correction:** expand until the declared tolerance is met, explicitly track overflow, or reject the unsupported distribution. Check posterior draws as well as point fits. Current real corner/card markets are unavailable, so the count-tail issue is latent rather than a current live-data error.

### R-19 — P2: API-Football extra-time fallback can corrupt regulation scores

**Evidence:** `worker/providers/api-football/index.ts:61` falls back from a missing `score.fulltime` value to `goals`, even for AET/PEN. The code itself notes that `goals` may include extra time. The football-data.org adapter correctly withholds regulation scores when its required field is missing.

**Correction:** for extra-time/shootout fixtures, require an explicit regulation score. Return unavailable when it is absent. Add adapter contract cases for both providers, including missing away and half-time scores. Do not infer that this fallback corrupted the present football-data.org study.

### R-20 — P2: import schema checks shape more than scientific consistency

**Evidence:** the importer uses a timestamp regex, unrestricted signed count integers, a partial uncertainty object and unstructured report analysis. It does not enforce valid dates, interval order/range, both final scores, 1X2 sums, matrix/probability agreement, run/fixture synthetic-mode consistency or the market-catalogue version match.

**Reproduced:** schema validation accepted `2026-99-99T99:99:99Z` together with a reversed 0.9–0.1 interval. Subsequent lexical timestamp checks are not a reliable date validator.

**Correction:** validate semantics before staging/publication, including finite normalized arrays, coherent market groups and complete component metadata. Verify an imported run's immutable configuration, not just its dataset hash, when treating it as an idempotent repeat.

### R-21 — P2: identifiers lose part of the model identity

**Evidence:** report IDs use only `run.id.slice(-16)`; evaluation and odds IDs also use suffixes. Two different model runs with the same timestamp suffix can collide, and `INSERT OR IGNORE` hides the conflict. A pipeline run ID itself has only model version and second-resolution time, despite accepting different seeds/configurations.

**Correction:** derive IDs from the complete logical key or a collision-resistant digest. Detect an ignored row whose immutable content differs. Include the full run/config identity and test two model versions generated at the same second.

### R-22 — P2: cache invalidation is not global

**Evidence:** `bumpCacheGeneration` changes in-isolate state only; public Cache API keys do not include that generation. Clearing the memo can immediately refill it from an old edge response. `setOpenAccess` does not invalidate public config; that route is memoized for 300 seconds, while the UI says a change may take up to a minute. `AuthProvider.refresh` reloads `/me`, not public config.

**Correction:** key shared caches on a persistent published version/config revision, or use bounded TTLs with accurate UI expectations. Encode query key/value pairs: the public key builder currently concatenates decoded values, allowing distinct queries containing `&` or `=` to share a cache key. Test invalidation across independent isolates and encoded query values.

### R-23 — P2: frontend request handling can display the previous resource

**Evidence:** `src/lib/api.ts:72` assigns `pathRef.current = path` during render, then line 87 compares it with the same new path. That check cannot identify old resource data, so the uncached-path branch retains previous data while the request runs. `p.finally(...)` creates a rejected promise without a catch even though the original promise has a rejection handler. TTLs do not trigger refresh timers by themselves.

**Correction:** associate state with its resource key, clear or intentionally tag stale data on key changes, handle the cleanup promise rejection, and define active refresh behavior. Exercise rapid navigation between two matches/markets with delayed and failed responses. Treat network failures distinctly from a locked report.

### R-24 — P2: some displayed statistics and availability claims are inaccurate

**Evidence:** the homepage promises “50+ markets per match”, including corners/cards, while this real run provides 46 for full reports and 7 for limited reports. `worker/services/overview.ts` retrieves only six headline markets but attempts to look up any featured market in that subset; several eligible featured markets will therefore show no probability. `fullReport.coverage.goals` is hardcoded available even for limited fixtures.

The heatmap sums win/draw regions after both tails are folded into 6+; the 6+/6+ cell mixes wins and draws and is counted entirely as a draw. First-half methodology/narrative uses the generic full-time Dixon–Coles description; first-half per-team scored/conceded averages are full-time averages. The UI should identify those periods explicitly.

The statistics counters count real non-demo rows even when their probability is null/INSUFFICIENT; “verified live settled” also does not require a validated status. `PUBLIC_PERFORMANCE_ONLY_VERIFIED` is exposed as a flag but does not enforce those filters. A forecast placeholder is not a published numerical forecast.

**Correction:** show actual supported counts and component coverage, query the selected featured markets, preserve exact region totals separately from display folding, and make first-half evidence/wording period-specific.

### R-25 — P2: reproducibility and onboarding documents have drifted

**Evidence:** `docs/model-validation.md` still calls synthetic results current and lists an old test count; README quality figures are also old. Costs, architecture, legal/product copy and the older deploy runbook describe previous states. The current `HANDOFF.md` is much better, but several stronger claims in it are contradicted by R-03/R-05/R-09/R-13.

`package.json` permits Node 20.19 while scripts import `.ts` files directly and the README says the tested runtime was 24. Python dependency ranges and CI installs are not pinned. Research outputs lack a complete code/data/environment manifest, and later-stage runners assume the output directory and earlier prediction files already exist. The final comparison JSON has no committed single-command generator.

**Correction:** publish one current validation/reproduction receipt, archive old milestone reports clearly, document a runtime that actually supports all scripts, and preserve a private licensed dataset plus environment/config hashes. Correct the PowerShell runbook syntax and route all release instructions through the full checks. Keep credentials out of these records.

## Feedback on the two supplied documents

The master build brief is strong on product boundaries, provenance, credits, budget separation and mobile usability. Its diagrams and target numbers are specifications, not proof of completed behavior. The implementation has delivered substantial portions of that brief. The current open-access phase supersedes its older invite-only presentation, so pricing/about/privacy/footer copy should be reconciled with the testing phase.

The Consensus v1.2 proposal correctly prioritizes chronological data, strong comparisons, coherent score distributions, uncertainty and evidence-based model changes. Its most important unfinished work is the P0 integrity layer. The actual v0.2 pass delivered a useful tuning change but did not complete all those P0 requirements.

Three changes would make the proposal more actionable:

1. Separate required correctness controls from research hypotheses. Dynamic strengths, bivariate Poisson, ensembles and richer features should remain experiments with explicit promotion rules.
2. Separate private accumulator/team-marker research from the public report product. There is no need to create duplicate databases or two parallel prediction engines merely because the document names PERFORMANCE and SETTLEMENT spaces. Distinguish descriptive features from outcome labels in a minimal schema first.
3. Replace blanket claims such as “leakage-free”, “every number reconciled”, “immutable” and “hard cap” with specific tested invariants, including the negative cases in this review. Historical provider availability cannot be manufactured retrospectively.

### Decision matrix

| Proposal area | Review decision | Reason |
|---|---|---|
| Retain Dixon–Coles and one coherent FT distribution | Keep | Existing model is understandable and reproducible |
| Split quality/propensity ridge | Keep v0.2 as current research baseline | Clear improvement over v0.1 on reproduced paired scores |
| DC validity, optimizer, Hessian and tail controls | Finish now | Implemented safeguards are incomplete |
| Historical availability and prospective archive | Finish now | Necessary to substantiate the product's evidence claims |
| Data verification versus empirical model validation | Finish now | Sample presence currently becomes a green data label without a component validation registry |
| Automated refresh and prospective settlement | Next, after publication hardening | Largest operational benefit; needs safe activation and failure handling |
| Stronger simple baseline and frozen evaluation window | Next research step | The examined holdout was reused; current evidence is exploratory |
| Cross-competition pooling | Keep rejected for this tested formulation | Existing negative result supports abstention; it does not disprove all future transfer models |
| Dynamic strength / bivariate Poisson / ensemble | Research only | No product-specific gain has been established |
| xG, lineups, corners, cards, odds | Defer until source/semantics/coverage are established | Available code is not evidence that the required data exists |
| Bookmaker profitability / ROI / CLV | No claim supported | No aligned price benchmark or prospective financial record |

The overall O/U improvement is mostly supported by the tuning period; its 264-match later-period interval includes zero. BTTS improves over v0.1 in that later period, but the full-study v0.2 BTTS score remains slightly worse than the league baseline. The defensible conclusion is “less overfit than v0.1 on these data”, with stronger evidence for 1X2 against the league-rate comparator. This is not evidence of bookmaker advantage.

## Suggested repair order

1. Restore the standard build and patch reviewed production dependencies.
2. Harden trusted publication timestamps, archive immutability, staged activation and component gates; add the reproduced negative cases.
3. Bind evidence to snapshot revisions, enforce fit/uncertainty validity and strengthen import semantics.
4. Make summary claims verifiable at import and spending durable across failures/concurrent jobs. Keep the runtime adapter disabled until it meets the same controls.
5. Complete automatic refresh, stale-state handling and append-only prospective settlement with a frozen forecast-selection policy.
6. Freeze a new evaluation window, retain v0.2, compare with a stronger simple baseline and review per-market calibration before considering advanced models.

The desktop/mobile layouts have a clear visual hierarchy and purposeful responsive treatment. Local screenshot checks use the owner's reference-preview artwork; they are not evidence that the production artwork/build has been visually validated. Current overflow tests do not check statistical correctness, data freshness, accessibility comprehensively or production Core Web Vitals. Public data-use permissions remain a documented unresolved item; this review makes no legal determination.

## Local review evidence

Review-only probes and outputs are under the gitignored `.wrangler` directory:

- `.wrangler/review-verify.mjs`: isolated D1 probes for late publication, open-access charges, schema acceptance, summary import, invitation races and immutable metadata/deletion gaps.
- `.wrangler/review-numerics.py`: explicit goals/count tail, Hessian and missing-covariance probes.
- `.wrangler/review-research.py`: fresh incumbent/candidate predictions, paired scores and summary output.
- `.wrangler/review/research-reproduction.json`, `incumbent.csv`, `candidate.csv`: local numerical evidence.
- `.wrangler/review/source-manifest.json`: reviewed source inventory with commit, line counts and file hashes.
- `.wrangler/review-artifact.json`: reproduced artifact; licensed/source data stays local.
- `.wrangler/review-dependency-audit.json`: npm production audit response.
- `artifacts/visual-review/e2e-*.png`: browser screenshots, kept local.

Rerunning a probe intentionally demonstrates permissive behavior in a fresh throwaway local database. No probe should be pointed at production. No application fix is included in this review.

## Browser completion

The complete configured Playwright run finished successfully. `test-results/.last-run.json` records `status=passed` with no failed test IDs. The suite covers the beta walkthrough, free sample, filters and admin protection, plus overflow/touch checks at the configured desktop/mobile viewports. Screenshots at 1536×1024 and 390×844 were inspected locally.

A subsequent `--list` invocation confirmed 26 configured tests but regenerated the HTML report with listing-only skipped entries. That HTML is not used as a completed-run receipt. The full-run completion record is `.last-run.json`; its status and the subsequent discovery count are preserved in `.wrangler/review/browser-result.json`.
