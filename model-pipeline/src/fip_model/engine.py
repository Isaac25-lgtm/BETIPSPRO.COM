"""Source-agnostic modelling engine.

Input: a normalised dataset (synthetic world OR a Worker admin export of provider snapshots).
Output: a versioned artifact dict ready for authenticated import into D1.

Leakage rules enforced here:
  * every model is fitted only on matches with kickoff < cut-off (asserted in fit_goals);
  * forecasts carry data_as_of_at = latest kickoff in the training set;
  * backtest forecasts are flagged is_pre_kickoff=0 (they were computed retrospectively,
    using only pre-kickoff data) so they can never be passed off as published predictions.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import (
    CARDS_MODEL_VERSION,
    CORNERS_MODEL_VERSION,
    FIRST_HALF_MODEL_VERSION,
    GOALS_MODEL_VERSION,
    MODEL_VERSION,
    PIPELINE_VERSION,
)
from .markets import Distributions, probability, settle
from .models.counts import NBFit, convolve_pmfs, fit_nb, nb_pmf
from .models.goals import GoalsFit, dc_matrix, fit_goals

MIN_TEAM_MATCHES = 6
MIN_LEAGUE_MATCHES = 60
MIN_COUNT_MATCHES = 40
CORNER_PMF_SIZE = 31
CARD_PMF_SIZE = 16
UNCERTAINTY_SAMPLES = 250

ARCHIVE_MARKETS = [
    "MATCH_RESULT_HOME_REGULATION",
    "MATCH_RESULT_DRAW_REGULATION",
    "MATCH_RESULT_AWAY_REGULATION",
    "TOTAL_GOALS_OVER_2_5_REGULATION",
    "TOTAL_GOALS_UNDER_2_5_REGULATION",
    "BTTS_YES_REGULATION",
    "BTTS_NO_REGULATION",
    "FIRST_HALF_GOALS_OVER_0_5",
    "TOTAL_CORNERS_OVER_9_5_REGULATION",
    "TOTAL_CORNERS_UNDER_9_5_REGULATION",
    "TOTAL_YELLOW_CARDS_OVER_3_5_REGULATION",
    "TOTAL_YELLOW_CARDS_UNDER_3_5_REGULATION",
]
FEATURE_CANDIDATES = [
    "MATCH_RESULT_HOME_REGULATION",
    "MATCH_RESULT_DRAW_REGULATION",
    "MATCH_RESULT_AWAY_REGULATION",
    "TOTAL_GOALS_OVER_1_5_REGULATION",
    "TOTAL_GOALS_OVER_2_5_REGULATION",
    "TOTAL_GOALS_UNDER_2_5_REGULATION",
    "TOTAL_GOALS_OVER_3_5_REGULATION",
    "BTTS_YES_REGULATION",
    "BTTS_NO_REGULATION",
]
EVAL_FAMILIES = {
    "MATCH_RESULT": ["MATCH_RESULT_HOME_REGULATION", "MATCH_RESULT_DRAW_REGULATION", "MATCH_RESULT_AWAY_REGULATION"],
    "TOTAL_GOALS_2_5": ["TOTAL_GOALS_OVER_2_5_REGULATION"],
    "BTTS": ["BTTS_YES_REGULATION"],
    "FIRST_HALF_GOALS_0_5": ["FIRST_HALF_GOALS_OVER_0_5"],
    "TOTAL_CORNERS_9_5": ["TOTAL_CORNERS_OVER_9_5_REGULATION"],
    "TOTAL_YELLOW_CARDS_3_5": ["TOTAL_YELLOW_CARDS_OVER_3_5_REGULATION"],
}


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ts(s: str) -> pd.Timestamp:
    return pd.Timestamp(s).tz_convert("UTC") if pd.Timestamp(s).tzinfo else pd.Timestamp(s, tz="UTC")


@dataclass
class Dataset:
    competitions: list[dict]
    teams: list[dict]
    referees: list[dict]
    fixtures: list[dict]
    team_stats: list[dict]

    def matches(self) -> pd.DataFrame:
        fx = pd.DataFrame(self.fixtures)
        fx["ko"] = pd.to_datetime(fx["starts_at_utc"], utc=True)
        st = pd.DataFrame(self.team_stats) if self.team_stats else pd.DataFrame(
            columns=["fixture_id", "team_id", "corners", "yellow_cards"]
        )
        h = st.rename(columns={"team_id": "home_team_id", "corners": "home_corners", "yellow_cards": "home_yc"})[
            ["fixture_id", "home_team_id", "home_corners", "home_yc"]
        ]
        a = st.rename(columns={"team_id": "away_team_id", "corners": "away_corners", "yellow_cards": "away_yc"})[
            ["fixture_id", "away_team_id", "away_corners", "away_yc"]
        ]
        df = fx.merge(h, left_on=["id", "home_team_id"], right_on=["fixture_id", "home_team_id"], how="left").drop(
            columns=["fixture_id"]
        )
        df = df.merge(a, left_on=["id", "away_team_id"], right_on=["fixture_id", "away_team_id"], how="left").drop(
            columns=["fixture_id"]
        )
        return df.sort_values(["ko", "id"]).reset_index(drop=True)

    def hash(self) -> str:
        payload = json.dumps(
            {"fixtures": self.fixtures, "team_stats": self.team_stats}, sort_keys=True, separators=(",", ":"), default=str
        )
        return "sha256:" + hashlib.sha256(payload.encode()).hexdigest()


@dataclass
class CompModels:
    competition_id: str
    cutoff: pd.Timestamp
    as_of: pd.Timestamp | None
    goals: GoalsFit | None
    ht: GoalsFit | None
    corners: NBFit | None
    cards: NBFit | None
    team_counts: dict[str, int]
    referee_counts: dict[str, int]
    referee_cols: list[str]
    team_cols: list[str]
    baselines: dict[str, float]
    n_train: int
    n_corners: int
    n_cards: int
    goals_reason: str | None
    corners_reason: str | None
    cards_reason: str | None


def _completed(df: pd.DataFrame) -> pd.DataFrame:
    return df[df["status"].isin(["FT", "AET", "PEN"]) & df["home_goals"].notna()]


def fit_competition(df: pd.DataFrame, cutoff: pd.Timestamp, catalog: dict, with_uncertainty: bool = True) -> CompModels:
    train = _completed(df[df["ko"] < cutoff])
    comp_id = df["competition_id"].iloc[0]
    days = (cutoff - train["ko"]).dt.total_seconds().to_numpy() / 86400.0
    teams = sorted(set(df["home_team_id"]) | set(df["away_team_id"]))
    team_counts = {t: int(((train["home_team_id"] == t) | (train["away_team_id"] == t)).sum()) for t in teams}

    goals = ht = None
    goals_reason = None
    if len(train) < MIN_LEAGUE_MATCHES:
        goals_reason = f"Only {len(train)} completed league matches before cut-off (minimum {MIN_LEAGUE_MATCHES})."
    else:
        goals = fit_goals(
            list(train["home_team_id"]), list(train["away_team_id"]),
            train["home_goals"].to_numpy(), train["away_goals"].to_numpy(), days,
            with_uncertainty=with_uncertainty,
        )
        ht_rows = train["home_goals_ht"].notna()
        if ht_rows.sum() >= MIN_LEAGUE_MATCHES:
            ht = fit_goals(
                list(train.loc[ht_rows, "home_team_id"]), list(train.loc[ht_rows, "away_team_id"]),
                train.loc[ht_rows, "home_goals_ht"].to_numpy(), train.loc[ht_rows, "away_goals_ht"].to_numpy(),
                days[ht_rows.to_numpy()], ridge=6.0, fit_rho=False, with_uncertainty=with_uncertainty,
            )

    # Corners: one observation per team per match
    corners = None
    corners_reason = None
    cmask = train["home_corners"].notna() & train["away_corners"].notna()
    ctrain = train[cmask]
    cdays = days[cmask.to_numpy()]
    team_cols = teams
    if len(ctrain) < MIN_COUNT_MATCHES:
        corners_reason = f"Only {len(ctrain)} matches with corner counts before cut-off (minimum {MIN_COUNT_MATCHES})."
    else:
        n = len(teams)
        ti = {t: i for i, t in enumerate(teams)}
        rows, ys, ws = [], [], []
        for (_, r), d in zip(ctrain.iterrows(), cdays):
            for is_home, tm, opp, y in ((1, r.home_team_id, r.away_team_id, r.home_corners), (0, r.away_team_id, r.home_team_id, r.away_corners)):
                x = np.zeros(2 + 2 * n)
                x[0], x[1] = 1, is_home
                x[2 + ti[tm]] = 1
                x[2 + n + ti[opp]] = 1
                rows.append(x); ys.append(y); ws.append(np.exp(-0.0019 * d))
        X = np.array(rows)
        pen = np.array([0, 0] + [1] * (2 * n), dtype=float)
        corners = fit_nb(X, np.array(ys), np.array(ws), ["intercept", "home"] + [f"for:{t}" for t in teams] + [f"against:{t}" for t in teams], pen, with_uncertainty=with_uncertainty)

    # Cards: one observation per match (total yellows), team + referee effects
    cards = None
    cards_reason = None
    kmask = train["home_yc"].notna() & train["away_yc"].notna()
    ktrain = train[kmask]
    kdays = days[kmask.to_numpy()]
    refs = sorted(ktrain["referee_id"].dropna().unique().tolist())
    referee_counts = {r: int((ktrain["referee_id"] == r).sum()) for r in refs}
    if len(ktrain) < MIN_COUNT_MATCHES:
        cards_reason = f"Only {len(ktrain)} matches with card counts before cut-off (minimum {MIN_COUNT_MATCHES})."
    else:
        n = len(teams)
        ti = {t: i for i, t in enumerate(teams)}
        ri = {r: i for i, r in enumerate(refs)}
        X = np.zeros((len(ktrain), 1 + n + len(refs)))
        X[:, 0] = 1
        for j, r in enumerate(ktrain.itertuples()):
            X[j, 1 + ti[r.home_team_id]] = 1
            X[j, 1 + ti[r.away_team_id]] = 1
            if isinstance(r.referee_id, str) and r.referee_id in ri:
                X[j, 1 + n + ri[r.referee_id]] = 1
        y = (ktrain["home_yc"] + ktrain["away_yc"]).to_numpy()
        pen = np.array([0] + [1] * (n + len(refs)), dtype=float)
        cards = fit_nb(X, y, np.exp(-0.0019 * kdays), ["intercept"] + [f"team:{t}" for t in teams] + [f"ref:{r}" for r in refs], pen, ridge=6.0, with_uncertainty=with_uncertainty)

    # League base rates (historical frequencies, NOT model output) for baselines and featured-market logic
    baselines = {}
    by_id = {m["id"]: m for m in catalog["markets"]}
    for mid in set(ARCHIVE_MARKETS + FEATURE_CANDIDATES):
        outcomes = [settle(by_id[mid]["predicate"], _outcome(r)) for r in train.itertuples()]
        vals = [o for o in outcomes if o is not None]
        if vals:
            baselines[mid] = float(np.mean(vals))

    return CompModels(
        competition_id=comp_id, cutoff=cutoff, as_of=train["ko"].max() if len(train) else None,
        goals=goals, ht=ht, corners=corners, cards=cards, team_counts=team_counts,
        referee_counts=referee_counts, referee_cols=refs, team_cols=team_cols, baselines=baselines,
        n_train=len(train), n_corners=len(ctrain), n_cards=len(ktrain),
        goals_reason=goals_reason, corners_reason=corners_reason, cards_reason=cards_reason,
    )


def _outcome(r) -> dict:
    def num(v):
        return None if v is None or (isinstance(v, float) and np.isnan(v)) else int(v)
    hc, ac, hy, ay = num(getattr(r, "home_corners", None)), num(getattr(r, "away_corners", None)), num(getattr(r, "home_yc", None)), num(getattr(r, "away_yc", None))
    return {
        "hg": num(r.home_goals), "ag": num(r.away_goals),
        "hth": num(r.home_goals_ht), "ath": num(r.away_goals_ht),
        "corners_total": None if hc is None or ac is None else hc + ac,
        "yellow_total": None if hy is None or ay is None else hy + ay,
    }


def _corner_rows(m: CompModels, home: str, away: str) -> tuple[np.ndarray, np.ndarray]:
    n = len(m.team_cols)
    ti = {t: i for i, t in enumerate(m.team_cols)}
    xh = np.zeros(2 + 2 * n); xa = np.zeros(2 + 2 * n)
    xh[0] = xa[0] = 1; xh[1] = 1
    xh[2 + ti[home]] = 1; xh[2 + n + ti[away]] = 1
    xa[2 + ti[away]] = 1; xa[2 + n + ti[home]] = 1
    return xh, xa


def _card_row(m: CompModels, home: str, away: str, ref: str | None) -> np.ndarray:
    n = len(m.team_cols)
    ti = {t: i for i, t in enumerate(m.team_cols)}
    x = np.zeros(1 + n + len(m.referee_cols))
    x[0] = 1; x[1 + ti[home]] = 1; x[1 + ti[away]] = 1
    if ref in m.referee_cols:
        x[1 + n + m.referee_cols.index(ref)] = 1
    return x


def distributions(m: CompModels, home: str, away: str, ref: str | None, gp=None, hp=None, cp=None, kp=None) -> Distributions:
    ft = m.goals.score_matrix(home, away, gp) if m.goals else None
    ht = m.ht.score_matrix(home, away, hp) if m.ht else None
    corners_total = cards_total = None
    k = np.arange(CORNER_PMF_SIZE)
    if m.corners:
        beta, alpha = (m.corners.beta, m.corners.alpha) if cp is None else (cp[:-1], float(np.exp(cp[-1])))
        xh, xa = _corner_rows(m, home, away)
        corners_total = convolve_pmfs(nb_pmf(k, float(np.exp(xh @ beta)), alpha), nb_pmf(k, float(np.exp(xa @ beta)), alpha), CORNER_PMF_SIZE)
    if m.cards:
        beta, alpha = (m.cards.beta, m.cards.alpha) if kp is None else (kp[:-1], float(np.exp(kp[-1])))
        x = _card_row(m, home, away, ref)
        kk = np.arange(CARD_PMF_SIZE)
        pmf = nb_pmf(kk, float(np.exp(x @ beta)), alpha)
        cards_total = pmf / pmf.sum()
    return Distributions(ft, ht, corners_total, cards_total)


def _market_quality(mdef: dict, m: CompModels, home: str, away: str, demo: bool) -> tuple[str, str | None]:
    fam = mdef["model_family"]
    if fam == "goals_dixon_coles":
        if m.goals is None:
            return "INSUFFICIENT", m.goals_reason
        low = [t for t in (home, away) if m.team_counts.get(t, 0) < MIN_TEAM_MATCHES]
        if low:
            return "INSUFFICIENT", f"Fewer than {MIN_TEAM_MATCHES} completed matches for {len(low)} team(s) before cut-off."
    elif fam == "first_half_poisson":
        if m.ht is None:
            return "INSUFFICIENT", "Half-time scores unavailable or below minimum sample."
    elif fam == "corners_negative_binomial":
        if m.corners is None:
            return "INSUFFICIENT", m.corners_reason
    elif fam == "cards_negative_binomial":
        if m.cards is None:
            return "INSUFFICIENT", m.cards_reason
    if demo:
        return "SIMULATED_DEMO", "Synthetic demo data: not a real forecast."
    if fam in ("corners_negative_binomial", "cards_negative_binomial", "first_half_poisson"):
        return "PARTIAL", "Tier B market: experimental, pending out-of-sample validation."
    return "VERIFIED", None


def forecast_fixture(m: CompModels, fx: dict, catalog: dict, rng: np.random.Generator, demo: bool, n_samples: int = UNCERTAINTY_SAMPLES):
    home, away, ref = fx["home_team_id"], fx["away_team_id"], fx.get("referee_id")
    point = distributions(m, home, away, ref)
    # Laplace-approximation samples for uncertainty intervals
    gs = m.goals.sample_params(n_samples, rng) if m.goals else [None] * n_samples
    hs = m.ht.sample_params(n_samples, rng) if m.ht else [None] * n_samples
    cs = m.corners.sample(n_samples, rng) if m.corners else [None] * n_samples
    ks = m.cards.sample(n_samples, rng) if m.cards else [None] * n_samples
    sampled = [distributions(m, home, away, ref, gs[i], hs[i], cs[i], ks[i]) for i in range(n_samples)]

    rows = []
    for mdef in catalog["markets"]:
        status, reason = _market_quality(mdef, m, home, away, demo)
        p = probability(mdef["predicate"], point) if status != "INSUFFICIENT" else None
        unc = {}
        if p is not None:
            draws = np.array([probability(mdef["predicate"], s) for s in sampled], dtype=float)
            unc = {
                "p05": round(float(np.nanpercentile(draws, 5)), 4),
                "p95": round(float(np.nanpercentile(draws, 95)), 4),
                "method": f"Laplace approximation, {n_samples} parameter draws",
                "note": "Parameter uncertainty only; excludes model-specification error.",
            }
        rows.append({
            "fixture_id": fx["id"], "market_id": mdef["id"],
            "data_as_of_at": iso(m.as_of.to_pydatetime()) if m.as_of is not None else None,
            "probability": None if p is None else round(p, 5),
            "status": status, "quality_reason": reason, "uncertainty": unc,
        })
    return point, rows


def drivers(m: CompModels, fx: dict) -> list[dict]:
    home, away, ref = fx["home_team_id"], fx["away_team_id"], fx.get("referee_id")
    out = []

    def add(family, metric, value=None, value_json=None, window=None, ref_=None):
        out.append({"fixture_id": fx["id"], "model_family": family, "metric": metric,
                    "value": None if value is None else round(float(value), 5),
                    "value_json": value_json, "sample_window": window, "source_ref": ref_})

    if m.goals:
        mu, ha, rho, att, dfn = m.goals.unpack()
        hi, ai = m.goals.team_index[home], m.goals.team_index[away]
        lh, la = m.goals.rates(home, away)
        add("goals_dixon_coles", "expected_goals_home", lh)
        add("goals_dixon_coles", "expected_goals_away", la)
        add("goals_dixon_coles", "rho_low_score_correction", rho)
        add("goals_dixon_coles", "home_advantage_multiplier", np.exp(ha))
        add("goals_dixon_coles", "attack_multiplier_home", np.exp(att[hi]))
        add("goals_dixon_coles", "defence_multiplier_home", np.exp(dfn[hi]))
        add("goals_dixon_coles", "attack_multiplier_away", np.exp(att[ai]))
        add("goals_dixon_coles", "defence_multiplier_away", np.exp(dfn[ai]))
        add("goals_dixon_coles", "league_avg_goals_weighted", m.goals.league_avg_goals)
        add("goals_dixon_coles", "training_matches", m.goals.n_matches, window="ALL_COMPLETED_BEFORE_CUTOFF")
        add("goals_dixon_coles", "effective_sample_after_decay", m.goals.effective_n)
        add("goals_dixon_coles", "time_decay_half_life_days", np.log(2) / m.goals.xi)
        add("goals_dixon_coles", "matches_home_team", m.team_counts.get(home, 0))
        add("goals_dixon_coles", "matches_away_team", m.team_counts.get(away, 0))
    if m.ht:
        lh, la = m.ht.rates(home, away)
        add("first_half_poisson", "expected_ht_goals_home", lh)
        add("first_half_poisson", "expected_ht_goals_away", la)
        add("first_half_poisson", "training_matches", m.ht.n_matches)
    if m.corners:
        xh, xa = _corner_rows(m, home, away)
        add("corners_negative_binomial", "expected_corners_home", m.corners.mean(xh))
        add("corners_negative_binomial", "expected_corners_away", m.corners.mean(xa))
        add("corners_negative_binomial", "dispersion_alpha", m.corners.alpha)
        add("corners_negative_binomial", "observed_variance_to_mean_per_team", m.corners.observed_var / max(m.corners.observed_mean, 1e-9))
        add("corners_negative_binomial", "training_matches", m.n_corners)
    if m.cards:
        x = _card_row(m, home, away, ref)
        n = len(m.team_cols)
        ti = {t: i for i, t in enumerate(m.team_cols)}
        add("cards_negative_binomial", "expected_total_yellows", m.cards.mean(x))
        add("cards_negative_binomial", "league_avg_total_yellows_weighted", m.cards.observed_mean)
        add("cards_negative_binomial", "home_team_multiplier", np.exp(m.cards.beta[1 + ti[home]]))
        add("cards_negative_binomial", "away_team_multiplier", np.exp(m.cards.beta[1 + ti[away]]))
        if ref in m.referee_cols:
            add("cards_negative_binomial", "referee_multiplier_shrunk", np.exp(m.cards.beta[1 + n + m.referee_cols.index(ref)]))
        add("cards_negative_binomial", "referee_training_matches", m.referee_counts.get(ref, 0))
        add("cards_negative_binomial", "dispersion_alpha", m.cards.alpha)
        add("cards_negative_binomial", "training_matches", m.n_cards)
    return out


# ------------------------------------------------------------------ evaluation

def log_loss_binary(p: np.ndarray, y: np.ndarray) -> float:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def calibration_bins(p: np.ndarray, y: np.ndarray, bins: int = 10) -> list[dict]:
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for i in range(bins):
        mask = (p >= edges[i]) & (p < edges[i + 1] if i < bins - 1 else p <= edges[i + 1])
        if mask.sum():
            out.append({"bin": f"{edges[i]:.1f}-{edges[i+1]:.1f}", "n": int(mask.sum()),
                        "mean_predicted": round(float(p[mask].mean()), 4), "observed_rate": round(float(y[mask].mean()), 4)})
    return out


def evaluate(records: list[dict], comp_ids: list[str | None]) -> list[dict]:
    """records: {competition_id, market_id, probability, baseline, outcome}."""
    df = pd.DataFrame(records)
    evals = []
    for comp in comp_ids:
        sub = df if comp is None else df[df["competition_id"] == comp]
        for fam, mids in EVAL_FAMILIES.items():
            s = sub[sub["market_id"].isin(mids) & sub["outcome"].notna() & sub["probability"].notna()]
            if s.empty:
                continue
            if fam == "MATCH_RESULT":
                piv_p = s.pivot_table(index="fixture_id", columns="market_id", values="probability")
                piv_b = s.pivot_table(index="fixture_id", columns="market_id", values="baseline")
                piv_y = s.pivot_table(index="fixture_id", columns="market_id", values="outcome")
                piv_p, piv_b, piv_y = piv_p[mids].dropna(), piv_b[mids].dropna(), piv_y[mids].dropna()
                common = piv_p.index.intersection(piv_y.index).intersection(piv_b.index)
                P, B, Y = piv_p.loc[common].to_numpy(), piv_b.loc[common].to_numpy(), piv_y.loc[common].to_numpy()
                B = B / B.sum(axis=1, keepdims=True)
                n = len(common)
                brier = float(np.mean(np.sum((P - Y) ** 2, axis=1)))
                bbrier = float(np.mean(np.sum((B - Y) ** 2, axis=1)))
                ll = float(-np.mean(np.log(np.clip(np.sum(P * Y, axis=1), 1e-6, 1))))
                bll = float(-np.mean(np.log(np.clip(np.sum(B * Y, axis=1), 1e-6, 1))))
                cal = calibration_bins(P.ravel(), Y.ravel())
            else:
                P, B, Y = s["probability"].to_numpy(), s["baseline"].to_numpy(), s["outcome"].to_numpy().astype(float)
                n = len(s)
                brier, bbrier = float(np.mean((P - Y) ** 2)), float(np.mean((B - Y) ** 2))
                ll, bll = log_loss_binary(P, Y), log_loss_binary(B, Y)
                cal = calibration_bins(P, Y)
            evals.append({"market_family": fam, "competition_id": comp, "sample_n": int(n),
                          "brier": round(brier, 5), "log_loss": round(ll, 5),
                          "baseline_brier": round(bbrier, 5), "baseline_log_loss": round(bll, 5),
                          "calibration": cal})
    return evals


# ------------------------------------------------------------------ orchestration

def run(dataset: Dataset, catalog: dict, data_mode: str, now: datetime, seed: int = 7,
        backtest_rounds: int = 7, synthetic_odds: bool = False) -> dict:
    rng = np.random.default_rng(seed)
    demo = data_mode == "SIMULATED_DEMO"
    df = dataset.matches()
    now_ts = pd.Timestamp(now).tz_convert("UTC") if pd.Timestamp(now).tzinfo else pd.Timestamp(now, tz="UTC")
    by_id = {m["id"]: m for m in catalog["markets"]}
    dataset_hash = dataset.hash()
    run_id = f"run:{MODEL_VERSION}:{now_ts.strftime('%Y%m%dT%H%M%SZ')}"
    backtest_run_id = run_id + ":backtest"

    forecasts, driver_rows, reports, archive, eval_records, odds = [], [], [], [], [], []
    as_of_overall = None
    for comp in dataset.competitions:
        cdf = df[df["competition_id"] == comp["id"]]
        if cdf.empty:
            continue
        # ---- live forecasts for upcoming fixtures (cut-off = now)
        upcoming = cdf[(cdf["status"].isin(["NS", "TBD"])) & (cdf["ko"] > now_ts)]
        if not upcoming.empty:
            models = fit_competition(cdf, now_ts, catalog, with_uncertainty=True)
            if models.as_of is not None:
                as_of_overall = max(as_of_overall, models.as_of) if as_of_overall is not None else models.as_of
            for fx in upcoming.to_dict("records"):
                point, rows = forecast_fixture(models, fx, catalog, rng, demo)
                forecasts.extend(rows)
                driver_rows.extend(drivers(models, fx))
                probs = {r["market_id"]: r["probability"] for r in rows}
                featured = _featured(probs, models.baselines)
                reports.append({
                    "fixture_id": fx["id"],
                    "featured_market_id": featured["market_id"] if featured else None,
                    "summary": {"featured": featured, "baselines": {k: round(v, 4) for k, v in models.baselines.items()},
                                "competition_training_matches": models.n_train,
                                "data_as_of_at": iso(models.as_of) if models.as_of is not None else None},
                    "analysis": {
                        "scoreline_matrix": None if point.ft is None else np.round(point.ft[:7, :7], 5).tolist(),
                        "ht_matrix": None if point.ht is None else np.round(point.ht[:5, :5], 5).tolist(),
                        "corners_total_pmf": None if point.corners_total is None else np.round(point.corners_total[:21], 5).tolist(),
                        "cards_total_pmf": None if point.cards_total is None else np.round(point.cards_total[:12], 5).tolist(),
                    },
                })
                if synthetic_odds:
                    odds.extend(_synthetic_odds(fx["id"], probs, by_id, rng))

        # ---- rolling-origin backtest on the most recent completed rounds
        done = _completed(cdf)
        cur_season = comp.get("current_season")
        sdone = done[done["season"] == cur_season] if cur_season else done
        season_rounds = sorted(sdone["round"].dropna().unique(), key=lambda r: sdone[sdone["round"] == r]["ko"].min())
        test_rounds = season_rounds[-backtest_rounds:]
        for rnd in test_rounds:
            rdf = done[(done["round"] == rnd) & (done["season"] == cur_season)] if cur_season else done[done["round"] == rnd]
            cutoff = rdf["ko"].min() - pd.Timedelta(hours=1)
            models = fit_competition(cdf, cutoff, catalog, with_uncertainty=False)
            for fx in rdf.to_dict("records"):
                point = distributions(models, fx["home_team_id"], fx["away_team_id"], fx.get("referee_id"))
                outcome = _outcome(pd.Series(fx))
                for mid in ARCHIVE_MARKETS:
                    mdef = by_id[mid]
                    status, reason = _market_quality(mdef, models, fx["home_team_id"], fx["away_team_id"], demo)
                    p = probability(mdef["predicate"], point) if status != "INSUFFICIENT" else None
                    o = settle(mdef["predicate"], outcome)
                    archive.append({"fixture_id": fx["id"], "market_id": mid, "probability": None if p is None else round(p, 5),
                                    "status": status, "quality_reason": reason, "settled_outcome": o,
                                    "data_as_of_at": iso(models.as_of) if models.as_of is not None else iso(cutoff)})
                    if p is not None and mid in models.baselines:
                        eval_records.append({"competition_id": comp["id"], "fixture_id": fx["id"], "market_id": mid,
                                             "probability": p, "baseline": models.baselines[mid], "outcome": o})

    evaluations = evaluate(eval_records, [None] + [c["id"] for c in dataset.competitions]) if eval_records else []
    generated_at = iso(now_ts.to_pydatetime())
    return {
        "artifact_version": 1,
        "data_mode": data_mode,
        "anchor_utc": generated_at,
        "display_notice": "SYNTHETIC DEMO DATA: NOT REAL FOOTBALL INFORMATION" if demo else None,
        "model_run": {
            "id": run_id, "model_version": MODEL_VERSION, "pipeline_version": PIPELINE_VERSION,
            "dataset_hash": dataset_hash, "generated_at": generated_at,
            "data_as_of_at": iso(as_of_overall.to_pydatetime()) if as_of_overall is not None else generated_at,
            "calibration_version": None, "market_catalog_version": catalog["version"],
            "config": {"component_versions": {"goals": GOALS_MODEL_VERSION, "first_half": FIRST_HALF_MODEL_VERSION,
                                              "corners": CORNERS_MODEL_VERSION, "cards": CARDS_MODEL_VERSION},
                       "time_decay_xi_per_day": 0.0019, "min_team_matches": MIN_TEAM_MATCHES,
                       "min_league_matches": MIN_LEAGUE_MATCHES, "min_count_matches": MIN_COUNT_MATCHES,
                       "uncertainty_samples": UNCERTAINTY_SAMPLES, "calibration": "none (raw model probabilities)"},
        },
        "backtest_run": {"id": backtest_run_id, "description": f"Rolling-origin backtest over the last {backtest_rounds} completed rounds per competition; each round predicted using only matches that kicked off before it. Computed retrospectively (is_pre_kickoff=0)."},
        "competitions": dataset.competitions,
        "teams": dataset.teams,
        "referees": dataset.referees,
        "fixtures": dataset.fixtures,
        "team_stats": dataset.team_stats,
        "forecasts": forecasts,
        "drivers": driver_rows,
        "reports": reports,
        "archive_forecasts": archive,
        "evaluations": evaluations,
        "bookmaker_snapshots": odds,
    }


def _featured(probs: dict, baselines: dict) -> dict | None:
    best = None
    for mid in FEATURE_CANDIDATES:
        p, b = probs.get(mid), baselines.get(mid)
        if p is None or b is None:
            continue
        dev = p - b
        if dev <= 0:  # present the side of each market that sits above its base rate
            continue
        if best is None or abs(dev) > abs(best["deviation"]):
            best = {"market_id": mid, "probability": round(p, 4), "league_base_rate": round(b, 4), "deviation": round(dev, 4)}
    if best:
        best["rule"] = "Featured = Tier A market whose model probability differs most from the league's historical base rate. It is NOT a recommendation."
    return best


ODDS_GROUPS = [
    ["MATCH_RESULT_HOME_REGULATION", "MATCH_RESULT_DRAW_REGULATION", "MATCH_RESULT_AWAY_REGULATION"],
    ["TOTAL_GOALS_OVER_1_5_REGULATION", "TOTAL_GOALS_UNDER_1_5_REGULATION"],
    ["TOTAL_GOALS_OVER_2_5_REGULATION", "TOTAL_GOALS_UNDER_2_5_REGULATION"],
    ["TOTAL_GOALS_OVER_3_5_REGULATION", "TOTAL_GOALS_UNDER_3_5_REGULATION"],
    ["BTTS_YES_REGULATION", "BTTS_NO_REGULATION"],
    ["TOTAL_CORNERS_OVER_9_5_REGULATION", "TOTAL_CORNERS_UNDER_9_5_REGULATION"],
    ["TOTAL_YELLOW_CARDS_OVER_3_5_REGULATION", "TOTAL_YELLOW_CARDS_UNDER_3_5_REGULATION"],
]


def _synthetic_odds(fixture_id: str, probs: dict, by_id: dict, rng: np.random.Generator) -> list[dict]:
    """SYNTHETIC DEMO prices: model probability perturbed on the logit scale plus a 6% margin.
    They exist only to exercise the price panel UI and are flagged is_synthetic=1."""
    out = []
    for group in ODDS_GROUPS:
        ps = [probs.get(m) for m in group]
        if any(p is None for p in ps):
            continue
        q = np.array([1 / (1 + np.exp(-(np.log(p / (1 - p)) + rng.normal(0, 0.18)))) for p in np.clip(ps, 0.01, 0.99)])
        q = q / q.sum() * 1.06
        for mid, qi in zip(group, q):
            out.append({"fixture_id": fixture_id, "market_id": mid, "bookmaker_name": "SYNTHETIC DEMO BOOK",
                        "odds_decimal": round(max(1.01, 1 / qi), 2), "provider_source": "synthetic-demo"})
    return out
