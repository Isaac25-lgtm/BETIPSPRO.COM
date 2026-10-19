# Connecting the free API-Football plan (owner action)

Everything that does not need a key is already built and tested. Do this only when you want real data.

## 1. Create ONE free account

1. Open https://dashboard.api-football.com/register and create **one** account (do not create several accounts to get more quota; that breaks their terms).
2. Choose the **Free** plan. Do **not** buy Pro ($19) or anything else without deciding to.
3. Re-read the current limits on the dashboard and at https://www.api-football.com/pricing. At the time of writing: 100 requests/day, 10 requests/minute, reset at 00:00 UTC, **restricted seasons** (historically the free plan only exposed some past seasons).
4. Copy your API key from the dashboard.

## 2. Store the key locally (never in chat, never in Git)

Edit `.dev.vars` (gitignored):

```dotenv
API_FOOTBALL_KEY=paste-your-key-here
SPORTS_PROVIDER=api_football
```

Restart `npm run dev`. The banner/admin overview should now show data mode `FREE_API`.

## 3. Test the connection (1 request from the reserve)

Admin → *Ingestion & API budget* → "Connection test (/status)". This calls `GET /status`, which we **count** against the budget. The result shows your plan, today's usage and limit. The key is never displayed.

## 4. Load a pilot (budgeted)

Suggested first pilot (≈ 25–30 calls total, within the 80/day operational budget):

| Step | Job | Calls |
|---|---|---|
| Season results for one league (goals model needs ≥ 60 matches) | `league_season` league=39 season=<an allowed season> | 1 |
| Statistics (corners/cards/HT) for recent completed fixtures | `fixture_details` with up to 20 provider ids per call | ~10 for 200 fixtures |
| Upcoming fixtures for the pilot dates | `fixtures_by_date` | 1–3 |
| Odds for up to 10 pilot fixtures (if your plan returns them) | `odds` | ≤ 10 |

Then export and fit:

```bash
curl -b cookies.txt http://localhost:5173/api/v1/admin/export/history > model-pipeline/data/raw/export.json   # or download from the admin while logged in
python model-pipeline/run.py fit --input model-pipeline/data/raw/export.json --out model-pipeline/data/exports/artifact.json
```

Import it through the authenticated admin API:

```bash
node scripts/import-artifact.mjs --file model-pipeline/data/exports/artifact.json --admin-email <admin> --admin-password <pw>
```

## Known free-plan limitations to expect

- **Season restrictions:** if the current season is not available, the platform will show *no* real fixtures rather than invent them. That is a data limitation to record, not a bug.
- **Odds** may be missing or limited; betPawa is very unlikely to be in the feed. Missing prices are shown as "no licensed price".
- **Statistics** (corners/cards) cost one call per 20 fixtures; history is the main budget consumer.

## Safety rails already in place

- Daily operational budget 80, reserve 20 (admin `reserve` priority only), hard cap 100; per-minute cap 10, all in an atomic D1 counter shared by every isolate, the cron job and admin actions.
- Snapshot reuse (no repeat calls for the same query within the TTL), one retry for network/5xx only, a 60s back-off on 429, and a circuit breaker after 3 consecutive failures.
- Report views never call the provider (verified by tests).
