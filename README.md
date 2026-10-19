# Football Match Intelligence Platform (beta)

Football evidence and probability research platform. Owner: **Motion Imprints Technologies**.
Public brand **not yet approved**: "BetTipsPro" is a placeholder (see `shared/brand.ts`, `docs/decisions.md` D-001).

- Screenshot-faithful homepage plus mobile-first match centre, per-market evidence pages, archive and statistics.
- Cloudflare Worker (Hono) + D1 + React SPA served as one unit; invite-only auth; atomic credit ledger.
- Offline Python models (Dixon-Coles, first-half Poisson, negative-binomial corners/cards) with uncertainty and backtests.
- API-Football free-plan adapter behind a hard, shared request budget. **Runs fully in `DEMO` mode with no secrets.**
- Optional Gemini/Vertex summaries, off by default and budget-gated.

> Demo mode shows **SYNTHETIC DEMO DATA** only: fictional clubs, results, prices and probabilities.

## Quick start (fresh machine)

Requirements: Node ≥ 20.19 (tested 24.11), Python 3.12 with numpy/pandas/scipy/statsmodels/pytest (only for the model pipeline), Git.

```bash
npm install
npm run setup:local          # creates .dev.vars with random secrets, migrates and seeds local D1 (synthetic)
npm run dev                  # http://localhost:5173  (SPA + Worker + local D1)
# in a second terminal, once the server is up:
npm run setup:local          # bootstraps the admin and prints the password ONCE
npm run beta:bootstrap -- --admin-email admin@localhost.test --admin-password <printed> --invite a@x.com,b@y.com
```

Testers open `/join`, enter their code + invited email + password, confirm 18+, and receive 10 report credits.

The demo re-anchors synthetic fixtures to "today" (EAT) at seed time. Run `npm run db:reset` on a later day to refresh.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite + Worker (workerd) + local D1 with HMR |
| `npm run build` / `npm run preview` | Production build; serve the built Worker with `wrangler dev` on :8787 |
| `npm run db:migrate` / `db:seed` / `db:reset` | Local D1 only (never remote) |
| `npm test` | Unit + integration + security tests (real local D1 via miniflare) |
| `npm run test:e2e` | Playwright walkthrough + visual/overflow suite (isolated DB on :5174) |
| `npm run test:load` | Local load matrix 1/5/25/100/500 users (run `npm run build` first) |
| `npm run model:test` | Python model invariants (pytest) |
| `npm run model:demo` | Regenerate the synthetic artifact `fixtures/demo/demo-artifact.json` |
| `npm run brand:render` | Re-render original hero/tile artwork |
| `node scripts/screenshots.mjs` | Visual-review screenshots to `artifacts/visual-review/` |

## Repository map

`src/` React app · `worker/` API (routes, middleware, services, providers) · `shared/` brand + market catalogue (single source for TS and Python) · `migrations/` D1 SQL · `model-pipeline/` Python models · `fixtures/demo/` synthetic artifact · `tests/` unit/integration/security/e2e/performance · `design/` reference + brand directions + art scripts · `docs/` everything else.

Start with `docs/status.md` (what works / what's pending), then `docs/technical-architecture.md`.

## Owner actions still required

1. Approve a brand name/logo (nothing purchased or registered).
2. When ready to test real data: create **one** free API-Football account and put the key in `.dev.vars` (`docs/setup-free-api-football.md`). Never paste it in chat or Git.
3. Legal/data-rights review before any public or paid launch (`docs/release-checklist.md`).
4. Approve GitHub repository visibility and Cloudflare deployment (`docs/cloudflare-deploy-runbook.md`). Nothing has been pushed or deployed.
