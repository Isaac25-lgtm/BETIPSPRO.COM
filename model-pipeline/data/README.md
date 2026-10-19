# Data directory

Nothing in here is committed except this README.

- `raw/` - provider snapshot exports pulled from the Worker admin export endpoint
  (`GET /api/v1/admin/export/history`). The Python pipeline never calls API-Football
  directly; all upstream calls go through the Worker's shared, metered budget gateway.
- `exports/` - generated artifacts for import.

Licensing: API-Football data is licensed for our use under their terms; it may not be
redistributed as a raw feed. Do not commit provider data to Git, and do not publish
bulk records. See `docs/licensing-and-compliance.md`.
