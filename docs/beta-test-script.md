# Beta test script: 5 testers × 10 report credits

## Operator setup
1. `npm run setup:local`, `npm run dev`, `npm run setup:local` again → admin credentials printed once.
2. (Optional, real data) connect API-Football per `setup-free-api-football.md` and prepare ~10 pilot fixtures. Otherwise testers use the synthetic demo.
3. Admin → Testers & invites → create 5 invitations (one per adult tester). Send each code privately with the `/join` link. Codes expire in 14 days.

## Tester guide (send this)
> Thanks for testing! This is a research tool, not a betting tip service. Demo data is fictional.
> 1. Open the join link, enter your code, the invited email, a password, confirm 18+.
> 2. Browse **Matches** (try the date strip, search and filters) on your phone and computer.
> 3. Open the free sample report first. Then unlock up to 10 matches you are curious about (1 credit each).
> 4. In an unlocked match, open several markets (goals, BTTS, corners, cards). Exploring never costs extra.
> 5. Check the evidence tables: do the past matches and numbers make sense? Is anything confusing?
> 6. Fill in **Feedback** (menu → account → Feedback): design, mobile, usefulness, trust, missing features, price (would you pay about USD 3 for 10 reports?), speed and confusing wording.

## What the operator reviews afterwards
Admin → Overview: activated testers, weekly actives, credits granted/spent, distinct fixtures unlocked, feedback average; Ingestion: provider calls by endpoint (target ≤ 80/day), cached-read share; Forecasts & coverage; Feedback triage.

Decide afterwards: is the free data tier enough, is the $19 Pro plan justified, and are rights/legal ready? (directive §22.10)
