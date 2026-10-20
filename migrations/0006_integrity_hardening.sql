-- Integrity hardening after the 2026-10-20 code reviews (R-03, R-13, F-03).

-- R-03: the server records when each forecast row was actually stored; "pre-kickoff" means stored before kickoff.
ALTER TABLE forecasts ADD COLUMN published_at TEXT;

-- R-13: forecasts are append-only. Only settlement fields (settled_outcome, settled_at) may change; nothing may be deleted.
CREATE TRIGGER forecasts_immutable_meta BEFORE UPDATE OF is_pre_kickoff, dataset_hash, model_run_id, status, quality_reason, uncertainty_json, published_at ON forecasts
BEGIN SELECT RAISE(ABORT, 'forecasts are immutable; publish a new model version instead'); END;
CREATE TRIGGER forecasts_no_delete BEFORE DELETE ON forecasts
BEGIN SELECT RAISE(ABORT, 'forecasts are append-only and cannot be deleted'); END;

-- F-03: Ask BetTipsPro AI spending ledger. Each provider call reserves its worst-case cost first, then records actual usage.
CREATE TABLE assistant_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  reserved_usd REAL NOT NULL,
  actual_usd REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'settled', 'failed'))
);
CREATE INDEX idx_assistant_spend_created ON assistant_spend(created_at);

-- R-21: imports are keyed on the full logical identity, so re-imports and same-second runs can never duplicate or collide.
CREATE UNIQUE INDEX IF NOT EXISTS uq_forecast_evidence_key ON forecast_evidence(model_run_id, fixture_id, model_family, metric);
CREATE UNIQUE INDEX IF NOT EXISTS uq_model_evaluations_key ON model_evaluations(model_run_id, market_family, IFNULL(competition_id, 'ALL'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookmaker_snapshots_key ON bookmaker_snapshots(fixture_id, market_definition_id, bookmaker_name, collected_at);
