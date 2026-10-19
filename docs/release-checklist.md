# Release checklist & gates

## Gates (all OPEN; each needs explicit owner sign-off)
- [ ] **Brand**: name, logo, domain and trademark availability approved (nothing purchased).
- [ ] **Data rights**: API-Football / rights-holder confirmation for paid report presentation (`licensing-and-compliance.md`).
- [ ] **Regulatory**: Ugandan classification of a paid odds/analysis service; NLGRB advertising guidelines reviewed by counsel.
- [ ] **Legal pages**: privacy, terms, refund/dispute, cookie notice reviewed (currently labelled draft).
- [ ] **Payments**: licensed provider (incl. Mobile Money), UGX display, signed webhooks, refunds, reconciliation; `PAYMENTS_ENABLED` stays false until then.
- [ ] **Models**: real-data validation per `model-validation.md` before describing markets as validated.
- [ ] **Capacity**: staging load test at the target concurrency (`costs-and-quotas.md`).
- [ ] **Security**: items in `security-review.md` "residual risks".
- [ ] **Deployment**: GitHub visibility + Cloudflare steps approved (`cloudflare-deploy-runbook.md`).

## Per-release
- [ ] `npx tsc -b`, `npm test`, `npm run model:test`, `npm run test:e2e` green
- [ ] Screenshots reviewed at 1536×1024, 390×844, 360, 768
- [ ] Migrations applied to staging; backups confirmed
- [ ] `/api/v1/health` OK; admin protected; demo banner correct for the environment
- [ ] Provider budget configured; no secrets in logs
