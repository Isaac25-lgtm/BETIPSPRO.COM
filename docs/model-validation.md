# Model validation

## Method
- **Rolling origin** over the last 7 completed rounds of the current season, per competition: each round is predicted with models fitted only on matches that kicked off before it (`fit_goals` raises on any post-cut-off row).
- Metrics: log loss and Brier score vs a **league base-rate baseline** (training-period frequency), calibration bins (10). No win-rate, no ROI.
- Invariants tested (`model-pipeline/tests/test_models.py`, 18 tests): 1X2 and HT result sum to 1; O/U complementary; Over-k decreasing in k (goals and corners); double chance = sum of parts; correct-score family sums to 1; leakage guard; INSUFFICIENT → no probability; backtest rows have `data_as_of_at < kickoff`; synthetic labels.
- Uncertainty: Laplace approximation (numerical Hessian), 250 parameter draws → 5th–95th percentile. **Excludes model-specification error.**

## Current results: SYNTHETIC DATA ONLY (pipeline-0.1.0, 126 matches)

| Family | Log loss (model / base) | Brier (model / base) | Beats base rate? |
|---|---|---|---|
| Match result 1X2 | 1.0140 / 1.0004 | 0.6067 / 0.6004 | **No** |
| Over/Under 2.5 | 0.6598 / 0.6775 | 0.2313 / 0.2421 | Yes |
| BTTS | 0.6907 / 0.6969 | 0.2482 / 0.2517 | Marginal |
| First-half over 0.5 | 0.6169 / 0.6166 | 0.2115 / 0.2117 | No (tie) |
| Corners over 9.5 | 0.7045 / 0.7031 | 0.2536 / 0.2549 | No (tie) |
| Yellow cards over 3.5 | 0.6731 / 0.6855 | 0.2362 / 0.2462 | Yes |

These numbers only demonstrate that the evaluation pipeline works. n=126 is small and the data is simulated, so **nothing here is evidence of real predictive skill**. The 1X2 result (worse than the base rate in this sample) is shown publicly as-is.

## Gates before calling any real-data market "validated"
1. ≥ 300 out-of-sample matches per market family per competition group, with chronological splits.
2. Beats the base rate on log loss with a bootstrap 90% CI excluding 0.
3. Calibration slope/intercept reviewed; recalibration fitted only on held-out data, then evaluated on later data.
4. If legally available, compare against margin-normalised closing prices.
5. Record evaluations in `model_evaluations` and flip `validation_status` in a new catalogue version.

## Known limitations
- No line-ups, injuries, xG or event data; no weather or schedule congestion.
- Corners model assumes independence between teams' counts (convolution).
- Rare-event markets (reds, penalties) intentionally absent.
