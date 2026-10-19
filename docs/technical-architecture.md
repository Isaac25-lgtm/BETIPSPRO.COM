# Technical architecture

```
Browser (React SPA, code-split routes)
   │ same-origin fetch /api/v1/*  (no keys in the client)
   ▼
Cloudflare Worker (Hono)  ── static assets (dist/client) for everything else (SPA fallback)
   ├─ middleware: request id + security headers → CSRF (custom header + Origin) → session (hashed cookie lookup)
   ├─ public routes  (fixtures, previews, competitions, stats, archive)   ← public response cache (memo + Cache API, 60s)
   ├─ account routes (auth, me, unlock, report, evidence, feedback)       ← entitlement check, then shared evidence cache
   ├─ admin routes   (server-side admin guard on the whole router)
   ├─ services: credits (atomic batch) · evidence (computed from tables at the forecast cut-off) · explain (templates)
   │            importer (validated, chunked, idempotent) · sports/budget (single metered gateway) · ingestion · ai/gemini (off)
   └─ cron (every 3h): scheduledRefresh → no-op unless key + pilot leagues configured
   ▼
Cloudflare D1 (SQLite): users/sessions/invites · wallets/credit_ledger/report_unlocks · competitions/teams/fixtures/stats
                        · market_definitions/model_runs/forecasts/forecast_evidence/match_reports/model_evaluations
                        · provider_quota/provider_rate_windows/provider_api_usage/provider_snapshots/ingestion_jobs · audit

Offline (owner machine): model-pipeline (Python)
   input:  synthetic world OR GET /api/v1/admin/export/history (normalised provider snapshots)
   output: versioned artifact JSON → POST /api/v1/admin/forecasts/import (sectioned) or scripts/seed-demo.mjs
```

## Request paths and their cost

| Path | D1 work | Upstream calls |
|---|---|---|
| Fixture board / preview (anonymous) | 0 when cached (60s); else 2–4 indexed queries | 0 |
| Report / evidence (entitled) | 1–2 entitlement queries + cached evidence (10 min, keyed by report version) | 0 |
| Unlock | 2 reads + 1 transactional batch + 2 reads | 0 |
| Admin ingestion | metered | 1 per job (≤20 fixtures per `ids` call) |

## Data modes

`DEMO` (no key or `SPORTS_PROVIDER != api_football`) · `FREE_API` (key + free mode) · `PRODUCTION`. The mode is shown in the UI banner, the admin overview and `/api/v1/health`.

## Single source of truth for markets

`scripts/build-market-catalog.mjs` → `shared/market-catalog.json` → consumed by Python (`markets.py`: probability derivation + settlement) and TypeScript (`shared/markets.ts`: settlement for evidence hit-rates). Unit tests check both settle identically on the same cases.

## Key files

- Atomic credits: `worker/services/credits.ts`
- Budget gateway: `worker/services/sports/budget.ts`
- Evidence engine: `worker/services/evidence.ts`, `worker/services/explain.ts`
- Importer and leakage guards: `worker/services/importer.ts`
- Models: `model-pipeline/src/fip_model/engine.py`, `models/goals.py`, `models/counts.py`
