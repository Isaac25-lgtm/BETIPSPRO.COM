# GitHub + Cloudflare runbook (NOT executed, requires owner approval at each ★ step)

GitHub is source control only; Cloudflare Workers (static assets + API) + D1 is the host.

## A. GitHub ★
1. Decide repository visibility (recommend **private**). The reference screenshot and `.dev.vars` are gitignored.
2. `gh repo create <org>/football-research-platform --private --source . --push` (or create in the web UI and `git remote add origin … && git push -u origin main`).
3. CI (`.github/workflows/ci.yml`) runs typecheck, unit/integration/security tests, Python tests and a build on every push/PR. No secrets required.

## B. Cloudflare account ★
1. Free Workers plan is enough to start (100k requests/day, 10 ms CPU per request). **Do not** subscribe to Workers Paid ($5/month) without approval; check current pricing at https://developers.cloudflare.com/workers/platform/pricing/.
2. `npx wrangler login`.
3. Create the database: `npx wrangler d1 create fip-beta` → paste the returned `database_id` into `wrangler.jsonc`.
4. Apply migrations remotely: `npx wrangler d1 migrations apply DB --remote`.

## C. Secrets ★ (never committed)
```bash
npx wrangler secret put SESSION_SECRET          # long random
npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN   # long random, used once
npx wrangler secret put API_FOOTBALL_KEY        # only when using real data
npx wrangler secret put TURNSTILE_SECRET_KEY    # if enabling Turnstile (set TURNSTILE_ENABLED=true)
```
Set `APP_ENV` and other non-secret flags per environment (add an `env.staging` / `env.production` block to `wrangler.jsonc`).

## D. Preview / staging ★
1. `npm run build && npx wrangler versions upload` (preview URL) or `npx wrangler deploy --env staging`.
2. Smoke: `/api/v1/health`, homepage, login, unlock with a test account, admin protected, HTTPS + HSTS header present, `Set-Cookie` has `Secure`.
3. Bootstrap admin once via `POST /api/v1/setup/admin`, then rotate/remove `ADMIN_BOOTSTRAP_TOKEN`.
4. Seed: real-data imports via the admin import endpoint. **Do not seed synthetic demo data into production** unless clearly intended as a demo environment.

## E. Production ★★ (also requires legal/data-rights sign-off)
- `npx wrangler deploy`; custom domain via Workers → Settings → Domains (domain purchase is an owner decision).
- Optional Git integration: Workers → your Worker → Settings → Builds → connect GitHub (https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/). `preview-deploy.yml` is provided **disabled** (manual dispatch + `CLOUDFLARE_DEPLOY_APPROVED` variable gate).

## F. Post-deploy checks
WAF rate-limit rules for `/api/v1/auth/*` and `/api/v1/feedback`; Turnstile on `/join`; Logpush/observability; D1 backups (Time Travel); re-run `npm run test:load` against **staging** with a measured target before claiming capacity.
