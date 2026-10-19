# Agent instructions (project-specific)

- Read `MASTER_BUILD_DIRECTIVE.md` (authoritative) and `docs/decisions.md` before changing behaviour.
- The homepage must stay faithful to `design/reference/homepage-reference.png`; check with `node scripts/screenshots.mjs` and `npm run test:e2e`.
- Never fabricate fixtures, odds, probabilities or performance. Demo data is synthetic and must stay labelled (`is_synthetic`, `SIMULATED_DEMO`).
- All upstream sports calls go through `worker/services/sports/budget.ts`. No other code may call API-Football.
- Credits: only via `worker/services/credits.ts` (atomic D1 batch). Ledger is append-only. Never trust client state.
- Forecast rows are immutable; publish a new model run instead of editing.
- Secrets live in `.dev.vars` / `wrangler secret`; never log, return or commit them.
- No deploys, pushes, purchases or paid API/AI usage without explicit owner approval.
- Keep tests green: `npm test`, `npm run test:e2e`, `npm run model:test`, `npx tsc -b`.
- Use the market catalogue generator (`node scripts/build-market-catalog.mjs`) rather than hand-editing `shared/market-catalog.json`.
