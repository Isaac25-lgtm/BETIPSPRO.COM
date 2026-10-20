"""Model invariants, leakage guards and settlement correctness."""

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

from fip_model import synthetic
from fip_model.engine import Dataset, distributions, fit_competition, forecast_fixture, run
from fip_model.markets import Distributions, load_catalog, probability, settle
from fip_model.models.counts import nb_pmf
from fip_model.models.goals import dc_matrix, fit_goals

CATALOG = load_catalog()
BY_ID = {m["id"]: m for m in CATALOG["markets"]}
ANCHOR = datetime(2026, 10, 20, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def world():
    return synthetic.generate(ANCHOR, seed=11)


@pytest.fixture(scope="module")
def comp_models(world):
    ds = Dataset(world.competitions, world.teams, world.referees, world.fixtures, world.team_stats)
    df = ds.matches()
    cdf = df[df["competition_id"] == "demo:dpd"]
    cutoff = pd.Timestamp(ANCHOR + timedelta(hours=6))
    return cdf, fit_competition(cdf, cutoff, CATALOG, with_uncertainty=True)


def test_dc_matrix_is_a_distribution():
    m = dc_matrix(1.6, 1.1, -0.05)
    assert m.min() >= 0
    assert abs(m.sum() - 1) < 1e-12


def _dist(lam=1.5, mu=1.2, rho=-0.03):
    k = np.arange(31)
    corners = np.convolve(nb_pmf(k, 5.2, 0.1), nb_pmf(k, 4.6, 0.1))[:31]
    cards = nb_pmf(np.arange(16), 4.0, 0.08)
    return Distributions(dc_matrix(lam, mu, rho), dc_matrix(0.7, 0.5, 0), corners / corners.sum(), cards / cards.sum())


def p(mid, d):
    return probability(BY_ID[mid]["predicate"], d)


def test_1x2_sums_to_one():
    d = _dist()
    s = sum(p(f"MATCH_RESULT_{x}_REGULATION", d) for x in ("HOME", "DRAW", "AWAY"))
    assert s == pytest.approx(1.0, abs=1e-9)
    s_ht = sum(p(f"FIRST_HALF_RESULT_{x}", d) for x in ("HOME", "DRAW", "AWAY"))
    assert s_ht == pytest.approx(1.0, abs=1e-9)


@pytest.mark.parametrize("t", ["0_5", "1_5", "2_5", "3_5", "4_5"])
def test_over_under_complementary(t):
    d = _dist()
    assert p(f"TOTAL_GOALS_OVER_{t}_REGULATION", d) + p(f"TOTAL_GOALS_UNDER_{t}_REGULATION", d) == pytest.approx(1.0)


def test_over_monotonic_in_threshold():
    d = _dist()
    overs = [p(f"TOTAL_GOALS_OVER_{t}_REGULATION", d) for t in ("0_5", "1_5", "2_5", "3_5", "4_5")]
    assert all(a > b for a, b in zip(overs, overs[1:]))
    corners = [p(f"TOTAL_CORNERS_OVER_{t}_REGULATION", d) for t in ("8_5", "9_5", "10_5")]
    assert all(a > b for a, b in zip(corners, corners[1:]))


def test_double_chance_consistent_with_1x2():
    d = _dist()
    assert p("DOUBLE_CHANCE_HOME_DRAW_REGULATION", d) == pytest.approx(
        p("MATCH_RESULT_HOME_REGULATION", d) + p("MATCH_RESULT_DRAW_REGULATION", d)
    )


def test_correct_score_family_sums_to_one():
    d = _dist()
    total = sum(p(m["id"], d) for m in CATALOG["markets"] if m["family"] == "CORRECT_SCORE")
    assert total == pytest.approx(1.0, abs=1e-9)


def test_settlement_rules():
    o = {"hg": 2, "ag": 1, "hth": 0, "ath": 1, "corners_total": 10, "yellow_total": 3}
    assert settle(BY_ID["MATCH_RESULT_HOME_REGULATION"]["predicate"], o) == 1
    assert settle(BY_ID["FIRST_HALF_RESULT_AWAY"]["predicate"], o) == 1
    assert settle(BY_ID["TOTAL_GOALS_OVER_2_5_REGULATION"]["predicate"], o) == 1
    assert settle(BY_ID["BTTS_YES_REGULATION"]["predicate"], o) == 1
    assert settle(BY_ID["TOTAL_CORNERS_OVER_9_5_REGULATION"]["predicate"], o) == 1
    assert settle(BY_ID["TOTAL_YELLOW_CARDS_UNDER_3_5_REGULATION"]["predicate"], o) == 1
    assert settle(BY_ID["CORRECT_SCORE_2_1_REGULATION"]["predicate"], o) == 1
    unknown = {**o, "corners_total": None}
    assert settle(BY_ID["TOTAL_CORNERS_OVER_9_5_REGULATION"]["predicate"], unknown) is None


def test_fit_rejects_future_matches():
    with pytest.raises(ValueError, match="leakage"):
        fit_goals(["A", "B"], ["B", "A"], np.array([1, 0]), np.array([0, 2]), np.array([3.0, -1.0]))


def test_fit_uses_only_pre_cutoff_data(comp_models):
    cdf, m = comp_models
    assert m.as_of < m.cutoff
    completed_before = cdf[(cdf["ko"] < m.cutoff) & (cdf["status"] == "FT")]
    assert m.n_train == len(completed_before)


def test_recovers_home_advantage_and_reasonable_rates(comp_models):
    _, m = comp_models
    _mu, ha, rho, _att, _dfn = m.goals.unpack()
    assert 0.05 < ha < 0.5  # synthetic truth is 0.24
    assert -0.2 <= rho <= 0.2
    assert 2.0 < m.goals.league_avg_goals < 4.0


def test_forecast_has_uncertainty_and_statuses(world, comp_models):
    _, m = comp_models
    fx = next(f for f in world.fixtures if f["competition_id"] == "demo:dpd" and f["status"] == "NS")
    _point, rows = forecast_fixture(m, fx, CATALOG, np.random.default_rng(0), demo=True, n_samples=60)
    assert len(rows) == len(CATALOG["markets"])
    for r in rows:
        assert r["status"] == "SIMULATED_DEMO"
        assert 0 <= r["probability"] <= 1
        assert r["uncertainty"]["p05"] <= r["probability"] + 1e-6 or r["uncertainty"]["p05"] <= r["uncertainty"]["p95"]


def test_insufficient_data_yields_no_probability(world):
    ds = Dataset(world.competitions, world.teams, world.referees, world.fixtures, [])  # no corner/card stats
    df = ds.matches()
    cdf = df[df["competition_id"] == "demo:dpd"]
    m = fit_competition(cdf, pd.Timestamp(ANCHOR + timedelta(hours=6)), CATALOG, with_uncertainty=False)
    fx = next(f for f in world.fixtures if f["competition_id"] == "demo:dpd" and f["status"] == "NS")
    _p, rows = forecast_fixture(m, fx, CATALOG, np.random.default_rng(0), demo=False, n_samples=5)
    corner = next(r for r in rows if r["market_id"] == "TOTAL_CORNERS_OVER_9_5_REGULATION")
    assert corner["probability"] is None and corner["status"] == "INSUFFICIENT"
    goals = next(r for r in rows if r["market_id"] == "TOTAL_GOALS_OVER_2_5_REGULATION")
    assert goals["probability"] is not None and goals["status"] == "VERIFIED"


def test_backtest_archive_is_retrospective_and_pre_kickoff_data_only(world):
    ds = Dataset(world.competitions[:1], [t for t in world.teams if t["competition_id"] == "demo:dpd"], world.referees,
                 [f for f in world.fixtures if f["competition_id"] == "demo:dpd"],
                 [s for s in world.team_stats if s["fixture_id"].startswith("demo:dpd")])
    art = run(ds, CATALOG, "SIMULATED_DEMO", ANCHOR + timedelta(hours=6), backtest_rounds=2)
    ko = {f["id"]: f["starts_at_utc"] for f in ds.fixtures}
    assert art["archive_forecasts"]
    for a in art["archive_forecasts"]:
        assert a["data_as_of_at"] < ko[a["fixture_id"]]
    assert all(e["sample_n"] > 0 for e in art["evaluations"])
    featured = [r["summary"]["featured"] for r in art["reports"] if r["summary"]["featured"]]
    assert featured and all(f["deviation"] > 0 for f in featured)


def test_synthetic_world_is_labelled(world):
    assert all(c["is_synthetic"] == 1 for c in world.competitions)
    assert all(t["is_synthetic"] == 1 for t in world.teams)
    assert all(f["is_synthetic"] == 1 for f in world.fixtures)
    assert all("Synthetic" in r["name"] for r in world.referees)


def test_fit_cli_on_worker_export_envelope(tmp_path, world):
    """Real-data path: the CLI accepts the Worker's export envelope and labels forecasts by data quality."""
    import json
    from fip_model.cli import main

    fx = [dict(f, is_synthetic=0, provider="api_football") for f in world.fixtures if f["competition_id"] == "demo:dpd"]
    # Mark the upcoming fixtures as future relative to "now" so they are forecast.
    soon = (datetime.now(timezone.utc) + timedelta(days=3)).strftime("%Y-%m-%dT15:00:00Z")
    for f in fx:
        if f["status"] == "NS":
            f["starts_at_utc"] = soon  # inside the CLI's default 10-day forecast horizon
    export = {"ok": True, "data": {"competitions": world.competitions[:1], "teams": [t for t in world.teams if t["competition_id"] == "demo:dpd"],
                                    "referees": world.referees, "fixtures": fx,
                                    "team_stats": [s for s in world.team_stats if s["fixture_id"].startswith("demo:dpd")]}}
    inp, out = tmp_path / "export.json", tmp_path / "artifact.json"
    inp.write_text(json.dumps(export))
    assert main(["fit", "--input", str(inp), "--out", str(out)]) == 0
    art = json.loads(out.read_text())
    assert art["data_mode"] == "FREE_API"
    statuses = {f["status"] for f in art["forecasts"]}
    assert "SIMULATED_DEMO" not in statuses and "VERIFIED" in statuses and "PARTIAL" in statuses
    assert art["bookmaker_snapshots"] == []  # never synthesises prices outside demo mode


def test_team_without_history_is_insufficient_not_a_crash(world):
    """Real-data edge case: a newcomer with no matches before the cut-off must yield INSUFFICIENT."""
    fixtures = [f for f in world.fixtures if f["competition_id"] == "demo:dpd"]
    template = next(f for f in fixtures if f["status"] == "NS")
    newcomer = dict(template, id="demo:dpd:new", provider_id="new", away_team_id="demo:dpd:newcomer")
    ds = Dataset(world.competitions[:1], world.teams, world.referees, fixtures + [newcomer],
                 [s for s in world.team_stats if s["fixture_id"].startswith("demo:dpd")])
    df = ds.matches()
    m = fit_competition(df, pd.Timestamp(ANCHOR + timedelta(hours=6)), CATALOG, with_uncertainty=False)
    _p, rows = forecast_fixture(m, newcomer, CATALOG, np.random.default_rng(0), demo=False, n_samples=5)
    goals = next(r for r in rows if r["market_id"] == "TOTAL_GOALS_OVER_2_5_REGULATION")
    assert goals["probability"] is None and goals["status"] == "INSUFFICIENT"
