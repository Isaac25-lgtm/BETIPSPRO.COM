-- Football research platform: initial schema (Cloudflare D1 / SQLite).
-- All timestamps are ISO-8601 UTC strings. Money is never stored for the beta.

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'tester' CHECK (role IN ('admin', 'tester', 'customer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  age_confirmed_at TEXT,
  privacy_consent_at TEXT,
  created_at TEXT NOT NULL
);

-- Credential store. provider='password' rows hold a PBKDF2 hash in secret_hash.
-- OAuth providers (later) store provider_subject only.
CREATE TABLE auth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  secret_hash TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_subject)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,             -- SHA-256 of the cookie token; raw token never stored
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,            -- e.g. 'login:<email-hash>' or 'ip:<ip-hash>'
  created_at TEXT NOT NULL
);
CREATE INDEX idx_auth_attempts_bucket ON auth_attempts(bucket, created_at);

CREATE TABLE beta_invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'used', 'revoked', 'expired')),
  issued_by TEXT REFERENCES users(id),
  issued_at TEXT NOT NULL,
  used_at TEXT,
  used_by TEXT REFERENCES users(id),
  expires_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses = 1)
);
CREATE INDEX idx_beta_invites_email ON beta_invites(email);

-- ---------------------------------------------------------------- credits
CREATE TABLE wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);

-- Append-only. Corrections are new rows (refund/reversal/adjustment), never UPDATEs.
CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  amount_signed INTEGER NOT NULL CHECK (amount_signed <> 0),
  kind TEXT NOT NULL CHECK (kind IN ('beta_grant', 'admin_grant', 'spend', 'refund', 'reversal', 'expiry', 'adjustment', 'purchase')),
  reason TEXT NOT NULL,
  actor_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_credit_ledger_user ON credit_ledger(user_id, created_at);

CREATE TRIGGER credit_ledger_no_update BEFORE UPDATE ON credit_ledger
BEGIN SELECT RAISE(ABORT, 'credit_ledger is append-only'); END;
CREATE TRIGGER credit_ledger_no_delete BEFORE DELETE ON credit_ledger
BEGIN SELECT RAISE(ABORT, 'credit_ledger is append-only'); END;

-- ---------------------------------------------------------------- football reference data
CREATE TABLE competitions (
  id TEXT PRIMARY KEY,                 -- internal id e.g. 'apif:39' or 'demo:dpd'
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  country TEXT NOT NULL,
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  current_season TEXT,
  coverage_json TEXT NOT NULL DEFAULT '{}',
  rights_status TEXT NOT NULL DEFAULT 'review_required',
  display_order INTEGER NOT NULL DEFAULT 100,
  source_updated_at TEXT,
  UNIQUE (provider, provider_id)
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  code TEXT,
  country TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  competition_id TEXT REFERENCES competitions(id),
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  source_updated_at TEXT,
  UNIQUE (provider, provider_id)
);
CREATE INDEX idx_teams_competition ON teams(competition_id);

CREATE TABLE referees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_synthetic INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE fixtures (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  season TEXT NOT NULL,
  round TEXT,
  home_team_id TEXT NOT NULL REFERENCES teams(id),
  away_team_id TEXT NOT NULL REFERENCES teams(id),
  starts_at_utc TEXT NOT NULL,
  kickoff_confirmed INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('NS', 'TBD', 'LIVE', 'HT', 'FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO')),
  home_goals INTEGER,
  away_goals INTEGER,
  home_goals_ht INTEGER,
  away_goals_ht INTEGER,
  score_json TEXT NOT NULL DEFAULT '{}',
  venue_name TEXT,
  venue_city TEXT,
  referee_id TEXT REFERENCES referees(id),
  is_synthetic INTEGER NOT NULL DEFAULT 0,
  is_public_sample INTEGER NOT NULL DEFAULT 0,
  provider_last_updated TEXT,
  ingested_at TEXT NOT NULL,
  UNIQUE (provider, provider_id)
);
CREATE INDEX idx_fixtures_start_comp ON fixtures(starts_at_utc, competition_id);
CREATE INDEX idx_fixtures_home ON fixtures(home_team_id, starts_at_utc);
CREATE INDEX idx_fixtures_away ON fixtures(away_team_id, starts_at_utc);
CREATE INDEX idx_fixtures_referee ON fixtures(referee_id, starts_at_utc);
CREATE INDEX idx_fixtures_status ON fixtures(status, starts_at_utc);

-- Normalized per-team match statistics (only columns we actually source).
CREATE TABLE fixture_team_stats (
  fixture_id TEXT NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id),
  corners INTEGER,
  yellow_cards INTEGER,
  red_cards INTEGER,
  shots INTEGER,
  shots_on_target INTEGER,
  possession_pct REAL,
  xg REAL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (fixture_id, team_id)
);

CREATE TABLE fixture_events (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  provider_event_id TEXT,
  period TEXT,
  minute INTEGER,
  kind TEXT NOT NULL,
  team_id TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  source_version TEXT
);
CREATE INDEX idx_fixture_events_fixture ON fixture_events(fixture_id);

-- Raw provider snapshots (checksummed) consumed by the offline Python pipeline.
CREATE TABLE provider_snapshots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  params_key TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  checksum TEXT NOT NULL,
  results INTEGER NOT NULL DEFAULT 0,
  body_json TEXT NOT NULL,
  UNIQUE (provider, endpoint, params_key, checksum)
);
CREATE INDEX idx_provider_snapshots_key ON provider_snapshots(provider, endpoint, params_key, fetched_at);

CREATE TABLE team_stats_snapshots (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  season TEXT,
  scope TEXT NOT NULL,
  data_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  checksum TEXT NOT NULL
);

-- ---------------------------------------------------------------- markets & forecasts
CREATE TABLE market_definitions (
  id TEXT PRIMARY KEY,                 -- e.g. TOTAL_GOALS_UNDER_2_5_REGULATION
  family TEXT NOT NULL,
  category TEXT NOT NULL,
  settlement_period TEXT NOT NULL,
  label TEXT NOT NULL,
  short_label TEXT NOT NULL,
  selection TEXT NOT NULL,
  threshold REAL,
  tier TEXT NOT NULL CHECK (tier IN ('A', 'B', 'C')),
  model_family TEXT NOT NULL,
  required_data TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'unvalidated',
  licensing_status TEXT NOT NULL DEFAULT 'review_required',
  active_for_beta INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 100,
  version TEXT NOT NULL
);

CREATE TABLE model_runs (
  id TEXT PRIMARY KEY,
  model_version TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,
  data_mode TEXT NOT NULL CHECK (data_mode IN ('SIMULATED_DEMO', 'FREE_API', 'PRODUCTION')),
  generated_at TEXT NOT NULL,
  data_as_of_at TEXT NOT NULL,
  calibration_version TEXT,
  market_catalog_version TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  imported_at TEXT NOT NULL,
  imported_by TEXT
);

-- Immutable forecast archive: a new model version produces NEW rows.
CREATE TABLE forecasts (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES fixtures(id),
  market_definition_id TEXT NOT NULL REFERENCES market_definitions(id),
  model_run_id TEXT NOT NULL REFERENCES model_runs(id),
  probability REAL CHECK (probability IS NULL OR (probability >= 0 AND probability <= 1)),
  model_version TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  data_as_of_at TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('VERIFIED', 'PARTIAL', 'INSUFFICIENT', 'STALE', 'SIMULATED_DEMO', 'RESEARCH')),
  quality_reason TEXT,
  uncertainty_json TEXT NOT NULL DEFAULT '{}',
  is_pre_kickoff INTEGER NOT NULL DEFAULT 1,
  settled_outcome INTEGER,             -- 1 hit / 0 miss / NULL unsettled or void
  settled_at TEXT,
  UNIQUE (fixture_id, market_definition_id, model_version, generated_at)
);
CREATE INDEX idx_forecasts_fixture_market ON forecasts(fixture_id, market_definition_id, generated_at);
CREATE INDEX idx_forecasts_run ON forecasts(model_run_id);

CREATE TRIGGER forecasts_immutable BEFORE UPDATE OF probability, generated_at, data_as_of_at, model_version, fixture_id, market_definition_id ON forecasts
BEGIN SELECT RAISE(ABORT, 'forecasts are immutable; publish a new model version instead'); END;

-- Model drivers (not historical evidence) for each forecast: lambdas, ratings, dispersion, sample sizes.
CREATE TABLE forecast_evidence (
  id TEXT PRIMARY KEY,
  forecast_id TEXT REFERENCES forecasts(id),
  fixture_id TEXT NOT NULL REFERENCES fixtures(id),
  model_run_id TEXT NOT NULL REFERENCES model_runs(id),
  model_family TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL,
  value_json TEXT,
  sample_window TEXT,
  source_ref TEXT,
  captured_at TEXT NOT NULL
);
CREATE INDEX idx_forecast_evidence_fixture ON forecast_evidence(fixture_id, model_run_id, model_family);

CREATE TABLE bookmaker_snapshots (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES fixtures(id),
  market_definition_id TEXT NOT NULL REFERENCES market_definitions(id),
  bookmaker_name TEXT NOT NULL,
  odds_decimal REAL NOT NULL CHECK (odds_decimal > 1),
  collected_at TEXT NOT NULL,
  stale_after TEXT NOT NULL,
  provider_source TEXT NOT NULL,
  is_synthetic INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_bookmaker_snapshots_fixture ON bookmaker_snapshots(fixture_id, collected_at);

CREATE TABLE match_reports (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES fixtures(id),
  report_version TEXT NOT NULL,
  model_run_id TEXT NOT NULL REFERENCES model_runs(id),
  report_status TEXT NOT NULL,
  featured_market_id TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  analysis_json TEXT NOT NULL DEFAULT '{}',
  evidence_manifest_json TEXT NOT NULL DEFAULT '{}',
  generated_at TEXT NOT NULL,
  UNIQUE (fixture_id, report_version)
);
CREATE INDEX idx_match_reports_fixture ON match_reports(fixture_id, generated_at);

CREATE TABLE report_unlocks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  fixture_id TEXT NOT NULL REFERENCES fixtures(id),
  entitlement_scope TEXT NOT NULL,
  ledger_id TEXT NOT NULL,
  client_idempotency_key TEXT,
  unlocked_at TEXT NOT NULL,
  UNIQUE (user_id, fixture_id, entitlement_scope)
);
CREATE INDEX idx_report_unlocks_user ON report_unlocks(user_id, fixture_id);

CREATE TABLE model_evaluations (
  id TEXT PRIMARY KEY,
  model_run_id TEXT NOT NULL REFERENCES model_runs(id),
  model_version TEXT NOT NULL,
  market_family TEXT NOT NULL,
  competition_id TEXT,
  period TEXT NOT NULL,
  sample_n INTEGER NOT NULL,
  brier REAL,
  log_loss REAL,
  baseline_brier REAL,
  baseline_log_loss REAL,
  calibration_json TEXT NOT NULL DEFAULT '[]',
  data_mode TEXT NOT NULL,
  evaluated_at TEXT NOT NULL
);

CREATE TABLE ai_explanations (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES fixtures(id),
  market_definition_id TEXT,
  report_version TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text_json TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (fixture_id, market_definition_id, report_version, evidence_hash)
);

-- ---------------------------------------------------------------- operations
CREATE TABLE provider_quota (
  provider TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  provider_reported_limit INTEGER,
  provider_reported_remaining INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, utc_day)
);

CREATE TABLE provider_rate_windows (
  provider TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, minute_bucket)
);

CREATE TABLE provider_api_usage (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  params_key TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  latency_ms INTEGER,
  credits_consumed INTEGER NOT NULL DEFAULT 1,
  job_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_provider_api_usage_day ON provider_api_usage(utc_day, provider);

CREATE TABLE ingestion_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_calls INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  error_code TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ingestion_jobs_created ON ingestion_jobs(created_at);

CREATE TABLE beta_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  fixture_id TEXT REFERENCES fixtures(id),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  category TEXT NOT NULL,
  text TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  triage_status TEXT NOT NULL DEFAULT 'new' CHECK (triage_status IN ('new', 'triaged', 'resolved', 'wontfix'))
);
CREATE INDEX idx_beta_feedback_created ON beta_feedback(created_at);

CREATE TABLE saved_fixtures (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fixture_id TEXT NOT NULL REFERENCES fixtures(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, fixture_id)
);

CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_admin_audit_created ON admin_audit_log(created_at);

CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

-- Data-subject requests (export/delete) recorded for manual processing during beta.
CREATE TABLE data_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('export', 'delete')),
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
