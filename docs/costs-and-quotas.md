# Costs & quotas

**Money spent so far: $0.** No purchases, subscriptions, paid API calls or AI tokens.

| Budget | Limit | Enforcement | Measured |
|---|---|---|---|
| API-Football free plan | 100 req/day, 10/min (re-verify on dashboard) | D1 gateway: 80/day operational + 20 reserve, 10/min | **0 calls** so far (demo mode; no key) |
| Report credits | 5 testers × 10 = 50 unlocks | Atomic ledger | n/a (no real testers yet) |
| Gemini / Vertex | $0 (disabled) | Flag + monthly budget + explicit pricing required | 0 tokens |
| Cloudflare Workers Free | 100k req/day, 10 ms CPU/request | Platform | Not deployed |
| Cloudflare D1 Free | 500 MB/db, daily row read/write caps | Platform | Local DB ≈ 7k rows after seed |

## Local load test (single developer machine, `wrangler dev` on the built Worker; NOT Cloudflare's edge)

Mix: 65% browse, 20% report/evidence, 10% credits, 5% unlocks (with duplicates); think time 0.2–0.8 s; 20 s per level. File: `artifacts/load/*.json`.

| Concurrent users | Throughput | Browse p95 | Report p95 | Evidence p95 | Errors | Provider calls |
|---|---|---|---|---|---|---|
| 1 | 3.8 req/s | 32 ms | 72 ms | 70 ms | 0% | 0 |
| 5 | 17 req/s | 27 ms | 35 ms | 64 ms | 0% | 0 |
| 25 | 80 req/s | 103 ms | 132 ms | 153 ms | 0% | 0 |
| 100 | 120 req/s | 851 ms | 965 ms | 989 ms | 0% | 0 |
| 500 | 160 req/s | 21 s | 18 s | 7.5 s | ~5–8% | 0 |

After the 500-user storm every tester's balance + spends = 10 and unlocks = spends (no double charges).

**Conclusion:** 500 simultaneous users is **not demonstrated**. One local workerd process saturates around 120–160 req/s. Production behaviour differs (many isolates across Cloudflare's network, edge Cache API, remote D1 latency), so the matrix must be re-run against a staging deployment before any capacity claim. Likely bottlenecks there: D1 single-writer for unlock bursts, D1 daily read quotas on the free plan, uncached authenticated report reads.
