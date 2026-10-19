# Security review (beta)

| Area | Control | Verified by |
|---|---|---|
| Secrets | `.dev.vars`/`wrangler secret` only; never logged or returned; admin config shows presence booleans only | `tests/security` "no response ever contains a secret value" |
| Passwords | PBKDF2-SHA256 100k (Workers max), 16-byte salt, constant-time compare, dummy hash on unknown user | unit tests |
| Sessions | 256-bit random token; DB stores SHA-256(token+pepper); HttpOnly, SameSite=Lax, Secure on HTTPS; 14-day expiry; logout + revoke-all | security tests |
| CSRF | Required `x-requested-with: fip` on mutations + Origin host check + SameSite | security tests |
| Brute force | D1 throttles: login 8/15 min per email, 40/15 min per IP hash; invite redemption 15/30 min; bootstrap 5/h | security tests |
| Invites | Email-bound, one-use, hashed, expiring, max 5 testers server-side | integration tests |
| RBAC | Whole admin router guarded server-side; tester 403, anon 401 | security tests |
| Credits | Server-side only; atomic batch; append-only ledger; idempotency keys; CHECK ≥ 0 | concurrency tests + load test integrity table |
| Reports | Entitlement check before any cache lookup; caches hold only shared data; public preview omits probabilities | security tests |
| Provider | Key only server-side; metered gateway; usage log has no key | budget tests |
| Input validation | Zod on all bodies/queries; LIKE wildcards escaped; parameterised SQL only | code review |
| Headers | nosniff, DENY framing, referrer policy, permissions policy, HSTS on HTTPS | code |
| Bot protection | Turnstile server-side verification wired for `/join` and feedback (off until a key exists) | code |

## Residual risks / to do before public launch
- No email verification beyond possession of the invite code; add OAuth or a verified email flow for open sign-up.
- Add a CSP header once all asset origins are fixed.
- Configure Cloudflare WAF rate-limit rules (per-IP) in addition to D1 throttles.
- Data export/deletion requests are recorded but processed manually.
- Run a dependency audit (`npm audit`) and an external pen test before monetisation.
