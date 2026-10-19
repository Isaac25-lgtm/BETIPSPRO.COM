# Database schema (Cloudflare D1)

Migrations: `migrations/0001_initial_schema.sql` (core), `0002_payments_stub.sql` (disabled payment tables + inactive plan hypotheses), `0003_reference_competitions.sql` (real competition metadata only, no data).

## Identity & access
- `users`: role `admin|tester|customer`, status, `age_confirmed_at`, `privacy_consent_at`.
- `auth_accounts(provider, provider_subject) UNIQUE`: `password` rows hold PBKDF2 hashes; OAuth providers can be added.
- `sessions`: id = SHA-256(token + pepper); raw tokens never stored. Expiry 14 days; revocable.
- `auth_attempts`: hashed rate-limit buckets (login per email, per IP; invite redemption; feedback; admin bootstrap).
- `beta_invites`: email-bound, `code_hash UNIQUE`, `max_uses = 1`, 14-day expiry, statuses issued/used/revoked.

## Credits
- `wallets.balance CHECK (balance >= 0)`.
- `credit_ledger`: append-only (UPDATE/DELETE triggers abort), `idempotency_key UNIQUE` (`beta_grant:<user>`, `unlock:<user>:<fixture>:<scope>`, `admin_grant:<key>`).
- `report_unlocks UNIQUE(user_id, fixture_id, entitlement_scope)`, links to its ledger row.

## Football data
- `competitions`, `teams`, `referees`, `fixtures` (UTC kick-off, regulation scores + HT, referee, `is_synthetic`, `is_public_sample`), `fixture_team_stats` (corners, cards, shots, possession, xG nullable), `fixture_events`, `provider_snapshots` (raw checksummed bodies for the pipeline), `team_stats_snapshots`.

## Models & reports
- `market_definitions` (from the shared catalogue, versioned).
- `model_runs` (dataset hash, data mode, generated/as-of, config). Backtest runs carry `config.kind = backtest`.
- `forecasts`: immutable (trigger blocks changes to probability/timestamps); `is_pre_kickoff`; `settled_outcome`; `UNIQUE(fixture, market, model_version, generated_at)`.
- `forecast_evidence`: model drivers per fixture/model family (not historical evidence).
- `match_reports(fixture_id, report_version) UNIQUE`: summary (featured market, base rates), analysis (score matrices, pmfs), evidence manifest.
- `model_evaluations`: log loss, Brier, baselines, calibration bins.
- `bookmaker_snapshots`: bookmaker, decimal price, collected/stale times, `is_synthetic`.
- `ai_explanations`: cached LLM output + token/cost metadata.

## Operations
- `provider_quota(provider, utc_day)`, `provider_rate_windows(provider, minute)`, `provider_api_usage`, `ingestion_jobs`, `beta_feedback`, `saved_fixtures`, `admin_audit_log`, `app_config`, `data_requests`.

## Indexes
Required by directive §11: `fixtures(starts_at_utc, competition_id)`, `forecasts(fixture_id, market_definition_id, generated_at)`, `report_unlocks(user_id, fixture_id)`, `bookmaker_snapshots(fixture_id, collected_at)`, `credit_ledger(user_id, created_at)`, `provider_api_usage(utc_day, provider)`, plus team/referee history indexes used by the evidence engine.
