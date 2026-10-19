-- Reference metadata for real competitions we intend to cover via API-Football (league ids from
-- the provider's public documentation). NO fixtures, statistics or results are seeded here.
-- Names are used descriptively; NO competition logos/emblems are used (rights not cleared).
INSERT INTO competitions (id, provider, provider_id, name, short_name, country, is_synthetic, current_season, coverage_json, rights_status, display_order, source_updated_at) VALUES
  ('apif:39',  'api_football', '39',  'Premier League',         'Premier League',   'England', 0, NULL, '{"loaded":false}', 'review_required', 1, NULL),
  ('apif:140', 'api_football', '140', 'La Liga',                'La Liga',          'Spain',   0, NULL, '{"loaded":false}', 'review_required', 2, NULL),
  ('apif:2',   'api_football', '2',   'UEFA Champions League',  'Champions League', 'Europe',  0, NULL, '{"loaded":false}', 'review_required', 3, NULL),
  ('apif:78',  'api_football', '78',  'Bundesliga',             'Bundesliga',       'Germany', 0, NULL, '{"loaded":false}', 'review_required', 4, NULL),
  ('apif:135', 'api_football', '135', 'Serie A',                'Serie A',          'Italy',   0, NULL, '{"loaded":false}', 'review_required', 5, NULL),
  ('apif:61',  'api_football', '61',  'Ligue 1',                'Ligue 1',          'France',  0, NULL, '{"loaded":false}', 'review_required', 6, NULL);

INSERT INTO app_config (key, value_json, updated_at, updated_by) VALUES
  ('beta', '{"period_end":null,"credits_expire":false,"entitlement_scope":"FIXTURE_ALL_VERSIONS"}', '2026-10-20T00:00:00Z', NULL),
  ('ingestion', '{"pilot_fixture_ids":[],"daily_budget_override":null,"paused":false}', '2026-10-20T00:00:00Z', NULL);
