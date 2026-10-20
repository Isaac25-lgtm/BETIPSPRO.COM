# Agent instructions (project-specific)

- **Start with `docs/HANDOFF.md`**: full system context, current state, owner preferences and runbooks.

- Read `MASTER_BUILD_DIRECTIVE.md` (authoritative) and `docs/decisions.md` before changing behaviour.
- The homepage must stay faithful to `design/reference/homepage-reference.png`; check with `node scripts/screenshots.mjs` and `npm run test:e2e`.
- Never fabricate fixtures, odds, probabilities or performance. Demo data is synthetic and must stay labelled (`is_synthetic`, `SIMULATED_DEMO`).
- All upstream sports calls go through `worker/services/sports/budget.ts`. No other code may call API-Football.
- Credits: only via `worker/services/credits.ts` (atomic D1 batch). Ledger is append-only. Never trust client state.
- Forecast rows are immutable; publish a new model run instead of editing.
- Secrets live in `.dev.vars` / `wrangler secret`; never log, return or commit them.
- The owner has authorised GitHub pushes and Cloudflare deploys (see docs/HANDOFF.md section 12). Purchases, new paid services and AI usage beyond the $10/month Gemini cap still need explicit approval.
- Keep tests green: `npm test`, `npm run test:e2e`, `npm run model:test`, `npx tsc -b`.
- Use the market catalogue generator (`node scripts/build-market-catalog.mjs`) rather than hand-editing `shared/market-catalog.json`.
