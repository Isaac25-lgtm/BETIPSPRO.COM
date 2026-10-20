# Model review against the Consensus v1.2 proposal

Date: 2026-10-20. Scope: the goals models (full-time Dixon-Coles and the first-half model). Only changes that measurably
improved held-out forecasts, or that are free correctness guards, were integrated. Everything else is recorded with
the reason it was not adopted.

## Outcome

Model `fip-v0.2` (goals `goals-dc-v0.2`) replaces `fip-v0.1`. One modelling change: the full-time goals model now
shrinks each team's **goal propensity** (how many goals its matches produce) much harder than its **quality** (how
much better it is than opponents). Quality shrinkage, which drives 1X2, is unchanged.

Paired comparison against v0.1 on the same 1,781 real matches (rolling origin, every match predicted only from
earlier matches). Units: log loss per match; Δ = v0.1 − v0.2, positive means v0.2 is better; 95% block-bootstrap CI.

| Market | v0.1 | v0.2 | League base rate | Δ (×1000) | 95% CI (×1000) |
|---|---|---|---|---|---|
| 1X2 | 1.0052 | 1.0030 | 1.0729 | +2.2 | −0.5 to +4.9 |
| Over/Under 2.5 | 0.7020 | 0.6821 | 0.6845 | **+20.0** | +12.2 to +28.0 |
| BTTS | 0.7010 | 0.6879 | 0.6853 | **+13.2** | +8.1 to +18.3 |

Split by period:

| Period | n | 1X2 Δ | O/U 2.5 Δ | BTTS Δ |
|---|---|---|---|---|
| Tuning season 2025/26 | 1,517 | +2.7 [−0.5, +5.7] | +22.8 [+14.6, +31.8] | +14.0 [+8.3, +20.2] |
| Holdout 2026/27 to date | 264 | −0.6 [−5.2, +2.7] | +3.8 [−8.5, +16.9] | +8.4 [+2.2, +16.1] |

O/U 2.5 and BTTS improve in every league (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League).
The production pipeline's own 250-match backtest moves the same way: BTTS 0.6790 → 0.6718, O/U 0.6523 → 0.6510,
1X2 0.9564 → 0.9568, first half unchanged at 0.6018.

### What this does and does not show

- v0.1's reported gains on O/U and BTTS did **not** replicate on the larger sample: over the full 2025/26 season v0.1
  was worse than the league base rate on both. v0.2 now roughly matches the base rate on O/U and BTTS. It has no
  demonstrated edge over it on those markets. The 1X2 edge over the base rate (about 0.07 per match) is real and
  consistent.
- All of this is retrospective. No forecast has yet been settled live, and nothing has been compared with bookmaker
  prices, so it says nothing about betting value.
- The holdout was viewed during the search (stage 2 onward), so it is not perfectly untouched. The choice made was
  the most conservative one on a flat optimum. The real confirmation will be the forecasts archived before kickoff.

## Protocol

- Data: football-data.org export of 2025/26 and 2026/27 for six competitions (2,306 completed matches; 90-minute
  scores, including for the three AET/PEN matches, verified).
- Cut-offs every Monday and Thursday 00:00 UTC. Each completed match is predicted from the latest cut-off before
  kickoff, using only matches that kicked off before that cut-off. League base rates are recomputed per fold.
- Same gates as production: 60 league matches, 6 per team.
- Candidates are scored on the same fixtures as the incumbent. Paired differences use a block bootstrap with
  cut-off windows as blocks.
- Code: `model-pipeline/research/` (`harness.py`, `dcfast.py`, `run_*.py`). The research fitter reproduces
  `fit_goals` to 4 decimal places and is about 20 times faster.

## Decision matrix

| Candidate (proposal §) | Finding | Status |
|---|---|---|
| Valid Dixon-Coles factors (§4) | Factors were clipped at 1e-9. On all real fits the smallest factor was about 0.44, so clipping never fired. `dc_matrix` now keeps rho inside its admissible range for each match's rates, and no factor is clipped. No forecast changed. | ADOPT_NOW (correctness guard) |
| Scoreline tail (§4.1) | Fixed 0..10 grid. The grid now grows until each side's tail is below 1e-10 (cap 25). Correct-score "other" is already the true complement. | ADOPT_NOW (correctness guard) |
| Time-decay tuning (A1) | Half-lives 90 to 730 days and no decay were tested. The surface is flat; 365 days stays. A 180-day half-life was significantly worse for 1X2 on the holdout. | ALREADY_PRESENT_VERIFIED |
| Single ridge tuning (A2) | Heavier ridge helped totals and BTTS a lot but hurt holdout 1X2. One ridge cannot serve both. | Superseded by split shrinkage |
| Split shrinkage, quality vs propensity (A2) | See outcome above. Quality ridge 4 (equal to the old ridge 2), propensity ridge 48. | **ADOPT_NOW** |
| Wider rho bound (±0.35) | No change in any market. | REJECT (no effect) |
| Independent Poisson comparator (H2) | Mixed: BTTS significantly worse in tuning, 1X2 mixed. Dixon-Coles stays. | Comparator recorded |
| Pooled cross-competition fit (D5) | Unlocks 23 more Champions League matches. On the 92 matches both cover, 1X2 is significantly worse (Δ −62 [−115, −7]). On the extra 23 it is worse than the base rate. Domestic results do not carry over to Europe in this model. | REJECT |
| Pooled fit with league-strength offsets (D5) | Same result (Δ about −60 on Champions League 1X2). | REJECT |
| First-half model: heavier shrinkage (E) | Better in tuning (+8 to +10) but worse on the holdout (−4 to −7). Inconsistent. | DEFER_NO_EVIDENCE |
| First half derived from full-time rates (E) | Holdout significantly worse (−11.9 [−19.6, −4.6]). | REJECT |
| Analytic gradient in `fit_goals` | Same estimates, faster fits (full pipeline about 86 s). Gradient checked against finite differences in tests. | ADOPT_NOW |
| Dynamic strengths, bivariate Poisson, ensembles (B, C) | Not built. The data covers only two seasons, and simpler changes are not yet exhausted. With 264 holdout matches, a small gain could not be told apart from noise. | DEFER_NO_EVIDENCE |
| xG, line-ups, odds, corners, cards (D, F, I) | No legal timestamped source on the free tier. | DEFER_NO_DATA |
| Quality labels VERIFIED vs VALIDATED (§20.1) | Worthwhile, but changes the API and UI rather than performance. | Deferred (out of scope for this pass) |

## Rollback

Set `GOALS_RIDGE_QUALITY = 4.0` and `GOALS_RIDGE_PROPENSITY = 4.0` in `engine.py` (this equals the old single ridge
of 2), bump the version, refit and import. The v0.1 artifact and its forecasts stay in D1 untouched; forecasts are
immutable and the newest model run is served.
