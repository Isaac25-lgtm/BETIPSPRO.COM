-- Testing phase: every report is open to everyone (no credits needed). Admins can switch this off in
-- Admin > Config, which restores the credit unlock flow unchanged. See docs/decisions.md D-026.
INSERT OR IGNORE INTO app_config (key, value_json, updated_at, updated_by)
VALUES ('access', '{"open":true}', '2026-10-20T00:00:00Z', NULL);
