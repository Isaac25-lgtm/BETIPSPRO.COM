# Follow-up code and model review — 20 October 2026

The standard build is fixed. All configured application, model and browser tests pass. The new assistant adds reproducible failures in answer validation, request limits, data-quality handling and conversation state. Several important findings from the first review also still reproduce.

This is a review artifact; application source, dependencies, migrations and production state were not changed.

## Version and scope

Started at `89f8e9bf7e0e5b7bd4ee6f24efe4d78f5c0f8533`, including the uncommitted assistant implementation. That implementation was committed during the review as `9b1f9c64ca07f5b52a2fd8071564c767dd729932`. File hashes confirmed that the reviewed source contents matched after that commit.

Compared against the first review's `2640a37cced9fdbc49ea581353fed39b7c137531`. Reviewed every changed source/configuration line across 28 files, plus the affected existing paths, the crest manifest, static headers, robots policy and documentation changes. Those 28 complete files contain 5,262 lines. The maintained source/configuration inventory now contains 118 files and 15,423 lines; this is an inventory count, not a claim that every unchanged line or dependency was manually re-audited this time.

Read `AGENTS.md` and the updated handoff first. Decisions D-028 through D-030 explain the imagery and assistant changes. The later recorded owner decisions authorize those changes; the older handoff rules should be reconciled with them. Commands inside reference documents were treated as review material, not new implementation instructions.

Tests ran in `.wrangler/review2-snapshot`, copied from tracked and nonignored untracked files. It contains dummy bootstrap/session secrets, no copied `.dev.vars` or `.env.local`, and no provider keys. Its databases are isolated. Dependencies are shared through a directory junction. No production writes, pushes, deployments, sports-provider requests or paid language-model requests were made. The npm audit queried the public advisory service.

## Verification

| Check | Result |
|---|---|
| `npm test` | **53 passed**, 7 test files |
| `npm run model:test` | **51 passed** |
| `npm run build` | **Passed**, including `tsc -b` and client/Worker Vite builds |
| `npm run test:e2e` | **26 passed**, desktop and mobile, 8.1 minutes |
| Targeted assistant integration probes | Validation, quota and quality failures below reproduced using real isolated D1 and mocked provider responses |
| Additional assistant browser probes | External links, reset race and malformed-history crash reproduced; no horizontal overflow at 1536×1024 or 390×844 |
| Fresh real-data fit/backtest | Forecast and evaluation arrays exactly equal stored `fdo-artifact-v02b.json` |
| `npm audit --omit=dev --json` | Still reports **2 high-severity package findings**, Hono and React Router |

The snapshot's shared dependency junction caused Vite to reject font paths outside its serving root during the standard E2E run. That is a review-harness limitation, not an application regression. The tests still completed, but their screenshots alone do not validate the intended fonts. The additional assistant browser check supplied those same local font files through Playwright interception; fonts loaded and its desktop/mobile screenshots were inspected. The standard E2E setup disables open access and has no assistant key, so its passing result does not exercise the enabled assistant. Reference assets controlled by the owner's excluded `.env.local` were not part of this fallback-art test build.

### Model reproduction

Ran from the snapshot's `model-pipeline`:

```text
python run.py fit --input ../../../model-pipeline/data/raw/fdo-export.json --out ../.wrangler/review2-real-artifact.json --as-of 2026-10-20T12:30:24Z
```

Result: 77 reports, 4,312 forecast rows, 4,188 archive rows, 165.6 seconds. Exact equality holds for both forecast and evaluation arrays against the existing v0.2 artifact.

| Market | n | Log loss | League baseline |
|---|---:|---:|---:|
| 1X2 | 250 | 0.9568 | 1.0626 |
| Over/under 2.5 | 250 | 0.6510 | 0.6654 |
| BTTS | 250 | 0.6718 | 0.6813 |
| First-half over 0.5 | 326 | 0.6018 | 0.6111 |

Raw-input SHA-256: `1ecc9f8a12d8f3caf9d761e311c63856423d16c04fdf51487c34ebb72ef87a53`.
Logical dataset hash: `sha256:93a8fc8c44857dbac7a5c1f99977b282d535f749ba4912f6f5f495f3decdc345`.
No model implementation changed in this diff. The separate 1,781-match model-selection study was not rerun in this pass; its prior reproduction and methodological findings remain in the first review.

## New findings

P1 means address before relying on the affected control or claim. P2 means correct in the next hardening pass. Mock-provider probes test application enforcement; they are not evidence that the live provider actually produced the injected bad answer.

### F-01 — P1: assistant answers are not verified against evidence

**Location:** `worker/services/assistant.ts:247`, especially line 261; `worker/routes/account.ts:164`.

The prompt asks for tool-backed facts, but the adapter accepts any final provider text. It does not require evidence for factual answers, reconcile claims against tool results, validate fixture links, or enforce its own prohibited wording. Client-supplied assistant messages are also forwarded as conversation history without server-side provenance.

**Reproduction:** a mocked provider returned “Guaranteed profit: Invented United have a 99.9876% chance of winning.” The real route returned HTTP 200 with that text and `tools_used: []`. A second probe called `list_matches` first and then invented the same team/probability; the text was still returned unchanged. Merely requiring one tool call would not fix the latter case.

**Correction:** return a typed answer containing references to retrieved fixture/market rows, then render numbers and links from those rows. Validate references and claims before publication; fail closed on missing evidence. Keep model-authored prose separate from canonical numbers. Treat client history as untrusted context.

### F-02 — P1: both request limits race under concurrency

**Location:** `worker/services/assistant.ts:102`.

The count queries run before a separate insertion. Putting the two reads in one D1 batch does not make the later reservation atomic.

**Reproduction on isolated D1:**

- With 29 recorded questions and an hourly limit of 30, six simultaneous calls all succeeded; the final count was **35**.
- With a configured daily limit of 1 and zero recorded questions, six simultaneous visitors all succeeded; the final count was **6**.

**Correction:** reserve capacity atomically for both dimensions, using a conditional database mutation or a serialized coordinator. Test the last available slot with concurrent requests and verify the stored count as well as HTTP responses.

### F-03 — P1: the new assistant has no enforced monetary budget

**Location:** `worker/services/assistant.ts:250`; `wrangler.jsonc:65`.

DeepSeek calls go directly to `fetch`. There is no spend reservation, usage ledger, monthly/daily currency cap, or reconciliation of provider token usage. The existing Gemini budget setting does not cover this path. Counting user questions is not equivalent to limiting provider spend.

**Reproduction:** one question made **five provider requests** in the mocked tool loop. Each request permits 900 output tokens, and accumulated history/tool results are sent again. At the configured 1,500-question daily allowance, the loop permits up to 7,500 provider requests before considering the quota race. This is a request-count bound, not a dollar estimate. Five separate 45-second timeouts also provide no single overall request deadline.

**Correction:** define an explicit budget for this provider, atomically reserve spend before calls, record actual usage and release unused reservations. Add total token/tool-work and overall time limits. Do not infer that the owner's Gemini limit automatically authorizes a particular DeepSeek budget.

### F-04 — P1: assistant tools discard forecast quality and freshness

**Location:** `worker/services/assistant.ts:120`, `:138`, `:173`, `:193`, `:225`.

Tools select the newest report and nonnull probabilities without enforcing forecast status or freshness. Their output omits forecast/data-as-of timestamps, model/run provenance and explicit synthetic flags. `match_report` also returns expected goals from reports whose full-time probabilities have been withheld. Its form lookup is cut off at kickoff rather than the report's evidence snapshot, extending the first review's evidence problem.

**Reproduction:** marked a fixture's forecasts `STALE` in the isolated database. `find_markets` still returned its 95% market with fair odds 1.05 and no stale label. Demo rows were also returned without `is_synthetic` or `data_mode`; the competition name happened to contain “Demo”, which is not an enforced answer label. `model_performance` likewise supplies no explicit real/synthetic provenance.

**Correction:** use one canonical eligibility policy shared with report publication. Carry quality, period, data-as-of, model version and synthetic status into every tool result and rendered claim. Respect family-specific evidence gates. The system prompt currently describes all percentages as 90-minute outcomes despite exposing first-half markets; make the outcome period explicit per market.

### F-05 — P2: the “internal links” renderer accepts external destinations

**Location:** `src/components/Assistant.tsx:25` and `:30`.

The regular expression accepts any destination starting with `/`, including protocol-relative `//host/path`. React Router renders that as an external link.

**Browser reproduction:** `[Open match](//example.test/outside)` became an anchor whose resolved origin was `http://example.test`. No navigation to the external site was performed. This establishes unsafe destination handling, not script execution.

**Correction:** construct match links from verified fixture IDs. For any remaining parsed links, normalize with `new URL`, enforce same origin and allowed routes, and reject protocol-relative and backslash variants.

### F-06 — P2: an accepted answer can make subsequent chat requests invalid

**Location:** `worker/routes/account.ts:166`; `src/components/Assistant.tsx:95`.

The route limits every historical message, including assistant replies, to 2,000 characters. The response path has no equivalent character limit; a 900-token answer can exceed it. The widget resubmits that response in subsequent history.

**Reproduction:** the route accepted and returned a mocked 2,001-character answer with HTTP 200. Resending that answer with “Continue”, as the widget does, returned **HTTP 422** before another provider call.

**Correction:** define compatible output/history limits and keep canonical history within them. Prefer server-owned conversation state or a validated bounded history representation; do not leave the browser carrying a response that the same API will reject.

### F-07 — P2: “New chat” does not isolate an in-flight answer

**Location:** `src/components/Assistant.tsx:86`, `:96`, `:116`.

Reset clears messages, but the previous asynchronous request still closes over its old conversation and unconditionally replaces state when it finishes.

**Browser reproduction:** send a question, hold the HTTP response, press New chat, then release the response. The old question and answer reappear. The reset also leaves the busy state active until the old request completes.

**Correction:** associate requests with a conversation generation and ignore late results after reset, or disable reset while busy. Add cancellation for UI cleanup where appropriate.

### F-08 — P2: malformed saved history can crash the whole page

**Location:** `src/components/Assistant.tsx:66`, `:128`.

`JSON.parse` only checks JSON syntax. It does not establish that storage holds an array of valid messages.

**Browser reproduction:** set `sessionStorage['asst-msgs']` to `{}`, load the site and open the assistant. The route error boundary replaces the page with “Unexpected Application Error! msgs.map is not a function”. The same problem applies to malformed message objects in an array.

**Correction:** schema-validate and bound persisted history, discard invalid entries, and contain widget rendering failures locally. Document browser persistence accurately: conversation text is stored in sessionStorage even though the Worker does not persist chat content.

### F-09 — P2: the new chart understates expected goals

**Location:** `src/components/charts.tsx:242`; `model-pipeline/src/fip_model/engine.py:502` and `:571`.

The pipeline folds all team scores of six or more into index 6. Computing the mean from those indices treats every tail score as exactly six. The grouped total-goals probabilities remain usable; the displayed expected-goals mean is biased downward.

**Reproduction from the existing real-data artifact:** fixture `fdo:fx:575363` has stored expected goals totaling **4.45615**, but the chart computes **4.31143**. It displays **4.3** instead of **4.5**. Five of 77 reports change their displayed one-decimal mean. A numerical example with rates 6 and 1 produces mean approximately 7.0 before folding and 6.0 through the chart formula.

**Correction:** pass the stored model mean to the chart or store the mean alongside the display matrix. The “6+ grouped” note does not recover the lost tail information.

### F-10 — P2: missing crests do not reliably fall back to monograms

**Location:** `src/components/ui.tsx:46` and `:94`.

By inspection, a team image error mutates a Set and hides the image's parent without triggering a React render. The claimed monogram fallback therefore waits for an unrelated render and can remain blank; the manually hidden parent can also survive reconciliation. Competition emblems have no error fallback. This matters for a clean checkout because the manifest is committed while its image files are ignored.

**Correction:** hold image failure in component state and render a distinct monogram fallback immediately for both components. This finding was identified by inspection; the reference-assets-on build was not exercised in this snapshot.

## Earlier findings: what changed

- **R-01 resolved:** `ModelRecord` now accepts `Stats | null`; the standard build passes.
- **R-02 remains:** dependencies are unchanged and the fresh npm audit still reports two high-severity package findings. An advisory's presence does not establish exploitability of every affected package feature; the first review distinguishes reachable paths from unused SSR/JWT functionality.
- **R-03 reproduced:** a forecast imported after a finished match, with backdated run timestamps, was accepted as `is_pre_kickoff=1`.
- **R-10 reproduced:** “The home team won 9 of its last 10 matches” passed the old summary validator with only a 0.5 probability supplied as evidence. The admin summary import also accepted unsupported text containing an invented 99.9876% figure.
- **R-13 reproduced:** forecast metadata could be updated and a forecast row could be deleted despite the immutability claim.
- **R-15 reproduced:** posting unlock during open access charged one credit, reducing the test balance from 10 to 9.
- **R-16 reproduced:** two concurrent invitations took testers plus pending invites to 6 under a configured cap of 5.
- **R-07/R-18 numerical probes reproduced:** negative Hessian eigenvalues were replaced by 1e-6, missing covariance produced identical parameter draws, and capped score/count distributions renormalized omitted tails. These are the same limitations reported previously; no model source changed.

The remaining first-review findings were not all dynamically re-exercised here. Relevant implementation files are unchanged unless noted above. New indexes and longer caches are performance changes; they do not fix publication integrity, uncertainty or automatic refresh. The clearer five-minute cache notice in Admin corrects part of the previous documentation mismatch. Cross-isolate invalidation and refresh scheduling remain separate issues.

## Recommended order

1. Enforce evidence-backed structured assistant answers and shared quality/freshness rules.
2. Make request/spend reservations atomic and give the assistant an explicit monetary budget.
3. Fix conversation limits, reset handling, saved-state validation and link destinations.
4. Correct the expected-goals display and missing-image fallbacks.
5. Continue the first review's import/publication, immutability, evidence and dependency hardening before automating refresh.

No model-parameter change is justified by this diff or the fresh reproduction.

## Local evidence

Files below are under `.wrangler/review2-snapshot/.wrangler/` and remain ignored:

- `review2-manifest.json`, `review2-changed-files.json`: reviewed source inventory and hashes.
- `review2-unit.log`, `review2-model.log`, `review2-build.log`, `review2-e2e.log`: complete command output.
- `review2-assistant.mjs`, `review2-assistant-result.json`: mocked-provider and real-D1 failure probes.
- `review2-previous-probes.mjs`, `review2-previous-probes.log`: prior finding reproductions.
- `review2-numerics.py`, `review2-numerics.log`: numerical edge cases.
- `review2-browser.mjs`, `review2-browser-result.json`, `review2-assistant-{desktop,mobile}.png`: supplemental widget checks.
- `review2-fit.log`, `review2-fit-result.json`, `review2-real-artifact.json`: fresh model reproduction.
- `review2-chart-result.json`, `review2-dependency-audit.json`: chart comparison and current npm audit.

The full E2E HTML report remains in the snapshot's `playwright-report`; the completed-run state is in `test-results/.last-run.json`. No listing-only Playwright invocation replaced those results.
