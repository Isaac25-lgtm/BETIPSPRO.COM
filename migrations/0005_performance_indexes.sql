-- Performance (2026-10-20): remove full-table scans found with EXPLAIN QUERY PLAN.
-- League-season history (evidence base rates) and per-competition coverage.
CREATE INDEX IF NOT EXISTS idx_fixtures_comp_season ON fixtures(competition_id, season, status, starts_at_utc);
CREATE INDEX IF NOT EXISTS idx_fixtures_syn_comp_season ON fixtures(is_synthetic, competition_id, season, status);
-- Model statistics page.
CREATE INDEX IF NOT EXISTS idx_model_evaluations_run ON model_evaluations(model_run_id);
CREATE INDEX IF NOT EXISTS idx_model_runs_generated ON model_runs(generated_at);
-- Forecast counts and the archive (backtest vs pre-kick-off rows), newest first.
CREATE INDEX IF NOT EXISTS idx_forecasts_kind_generated ON forecasts(is_pre_kickoff, generated_at);
CREATE INDEX IF NOT EXISTS idx_forecasts_kind_status ON forecasts(is_pre_kickoff, status, settled_outcome);
-- Stored match summaries, newest first.
CREATE INDEX IF NOT EXISTS idx_ai_explanations_lookup ON ai_explanations(fixture_id, market_definition_id, report_version, created_at);
