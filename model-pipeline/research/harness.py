"""Leakage-free rolling-origin research harness for the goals models (Consensus v1.2 review).

Protocol (fixed before looking at results):
  * Cut-offs every Monday and Thursday 00:00 UTC. Each completed match is predicted from the most recent
    cut-off strictly before its kickoff, using only matches that kicked off before that cut-off.
  * TUNE period  = season 2025 (2025/26), used to choose hyperparameters.
  * HOLDOUT      = season 2026 (2026/27 to date), scored once with the frozen choice.
  * Candidates are compared on the SAME fixtures (intersection of each model's coverage); paired
    differences get a block bootstrap CI (blocks = cut-off windows, so same-weekend matches move together).
  * League base rates are recomputed from each fold's training data only.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fip_model.engine import Dataset, MIN_LEAGUE_MATCHES, MIN_TEAM_MATCHES  # noqa: E402
from fip_model.models.goals import dc_matrix  # noqa: E402
import dcfast  # noqa: E402

EPS = 1e-6


def load(path: Path | None = None) -> pd.DataFrame:
    path = path or ROOT / "data" / "raw" / "fdo-export.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw = raw.get("data", raw)
    ds = Dataset(raw["competitions"], raw["teams"], raw.get("referees", []), raw["fixtures"], raw.get("team_stats", []))
    df = ds.matches()
    df["done"] = df["status"].isin(["FT", "AET", "PEN"]) & df["home_goals"].notna()
    return df


def cutoffs(df: pd.DataFrame) -> list[pd.Timestamp]:
    start = df["ko"].min().normalize()
    end = df.loc[df["done"], "ko"].max() + pd.Timedelta(days=1)
    days = pd.date_range(start, end, freq="D", tz="UTC")
    return [d for d in days if d.dayofweek in (0, 3)]


def markets_from_matrix(m: np.ndarray) -> dict:
    g = np.arange(m.shape[0])
    tot = g[:, None] + g[None, :]
    return {"ph": float(np.tril(m, -1).sum()), "pd": float(np.trace(m)), "pa": float(np.triu(m, 1).sum()),
            "o25": float(m[tot >= 3].sum()), "btts": float(m[1:, 1:].sum())}


def outcomes(r) -> dict:
    hg, ag = int(r.home_goals), int(r.away_goals)
    return {"yh": int(hg > ag), "yd": int(hg == ag), "ya": int(hg < ag), "yo25": int(hg + ag >= 3), "ybtts": int(hg > 0 and ag > 0)}


def base_rates(train: pd.DataFrame) -> dict:
    hg, ag = train["home_goals"].to_numpy(), train["away_goals"].to_numpy()
    return {"bh": float(np.mean(hg > ag)), "bd": float(np.mean(hg == ag)), "ba": float(np.mean(hg < ag)),
            "bo25": float(np.mean(hg + ag >= 3)), "bbtts": float(np.mean((hg > 0) & (ag > 0)))}


CROSS_LEAGUE = {"apif:2"}  # competitions whose teams come from different domestic leagues


def team_groups(train: pd.DataFrame) -> dict:
    """Home-league group per team = the domestic competition it played most often in the training data."""
    dom = train[~train["competition_id"].isin(CROSS_LEAGUE)]
    long = pd.concat([dom[["home_team_id", "competition_id"]].rename(columns={"home_team_id": "t"}),
                      dom[["away_team_id", "competition_id"]].rename(columns={"away_team_id": "t"})])
    g = long.groupby("t")["competition_id"].agg(lambda s: s.value_counts().index[0]).to_dict()
    teams = set(train["home_team_id"]) | set(train["away_team_id"])
    return {t: g.get(t, "other") for t in teams}


def predict(df: pd.DataFrame, xi=0.0019, ridge=2.0, pooled=False, fit_rho=True, comps=None,
            min_team=MIN_TEAM_MATCHES, rho_mode="clip", ridge_s=None, ridge_t=None, rho_bound=0.2,
            league_offsets=False, ridge_q=1.0) -> pd.DataFrame:
    """Return one row per scored completed match with model probabilities, base rates and outcomes."""
    cuts = cutoffs(df)
    done = df[df["done"]]
    comps = comps or sorted(df["competition_id"].unique())
    rows = []
    for k, cut in enumerate(cuts):
        nxt = cuts[k + 1] if k + 1 < len(cuts) else cut + pd.Timedelta(days=4)
        test = done[(done["ko"] >= cut) & (done["ko"] < nxt) & done["competition_id"].isin(comps)]
        if test.empty:
            continue
        train_all = done[done["ko"] < cut]
        groups = [(None, train_all)] if pooled else [(c, train_all[train_all["competition_id"] == c]) for c in test["competition_id"].unique()]
        for c, train in groups:
            if c is not None and len(train) < MIN_LEAGUE_MATCHES:
                continue
            if c is None:  # pooled: every competition must still meet the league minimum to be predicted
                ok = train["competition_id"].value_counts()
                ok = set(ok[ok >= MIN_LEAGUE_MATCHES].index)
            days = (cut - train["ko"]).dt.total_seconds().to_numpy() / 86400.0
            tg = team_groups(train) if (league_offsets and c is None) else None
            f = dcfast.fit(list(train["home_team_id"]), list(train["away_team_id"]), list(train["competition_id"]),
                           train["home_goals"], train["away_goals"], days, xi=xi, ridge=ridge, fit_rho=fit_rho,
                           ridge_s=ridge_s, ridge_t=ridge_t, rho_bound=rho_bound,
                           team_group=tg, ridge_q=ridge_q)
            counts = pd.concat([train["home_team_id"], train["away_team_id"]]).value_counts()
            tt = test if c is None else test[test["competition_id"] == c]
            for r in tt.itertuples():
                comp_ok = (c is not None) or (r.competition_id in ok)
                if not comp_ok or counts.get(r.home_team_id, 0) < min_team or counts.get(r.away_team_id, 0) < min_team:
                    continue
                lam, lmu = f.rates(r.home_team_id, r.away_team_id, r.competition_id)
                rho = f.rho
                if rho_mode == "admissible":  # keep every DC factor >= 0 for this match's own rates
                    lo, hi = max(-1 / lam, -1 / lmu), min(1 / (lam * lmu), 1.0)
                    rho = float(np.clip(rho, lo * 0.999, hi * 0.999))
                m = dc_matrix(lam, lmu, rho)
                b = base_rates(train[train["competition_id"] == r.competition_id])
                rows.append({"fixture_id": r.id, "comp": r.competition_id, "season": r.season, "ko": r.ko, "block": k,
                             "lam": lam, "lmu": lmu, **markets_from_matrix(m), **b, **outcomes(r)})
    return pd.DataFrame(rows)


def losses(p: pd.DataFrame, prefix: str = "") -> pd.DataFrame:
    """Per-match log losses for model (or base rates when prefix='b')."""
    if prefix == "b":
        s = p["bh"] + p["bd"] + p["ba"]
        ph, pd_, pa, po, pb = p["bh"] / s, p["bd"] / s, p["ba"] / s, p["bo25"], p["bbtts"]
    else:
        ph, pd_, pa, po, pb = p["ph"], p["pd"], p["pa"], p["o25"], p["btts"]
    clip = lambda v: np.clip(v, EPS, 1 - EPS)
    out = pd.DataFrame(index=p.index)
    out["1x2"] = -np.log(clip(ph * p["yh"] + pd_ * p["yd"] + pa * p["ya"]))
    out["ou25"] = -(p["yo25"] * np.log(clip(po)) + (1 - p["yo25"]) * np.log(clip(1 - po)))
    out["btts"] = -(p["ybtts"] * np.log(clip(pb)) + (1 - p["ybtts"]) * np.log(clip(1 - pb)))
    return out


def paired(a: pd.DataFrame, b: pd.DataFrame, n_boot: int = 2000, seed: int = 1) -> dict:
    """a = incumbent predictions, b = candidate predictions. Positive delta favours the candidate."""
    common = a.merge(b[["fixture_id"]], on="fixture_id")["fixture_id"]
    A = a.set_index("fixture_id").loc[common]; B = b.set_index("fixture_id").loc[common]
    la, lb = losses(A.reset_index()), losses(B.reset_index())
    d = la.values - lb.values
    blocks = A["block"].to_numpy()
    ub = np.unique(blocks)
    rng = np.random.default_rng(seed)
    bi = {u: np.where(blocks == u)[0] for u in ub}
    boots = []
    for _ in range(n_boot):
        pick = rng.choice(ub, size=len(ub), replace=True)
        ii = np.concatenate([bi[u] for u in pick])
        boots.append(d[ii].mean(axis=0))
    boots = np.array(boots)
    out = {"n": int(len(common))}
    for j, col in enumerate(la.columns):
        out[col] = {"incumbent": round(float(la[col].mean()), 5), "candidate": round(float(lb[col].mean()), 5),
                    "delta": round(float(d[:, j].mean()), 5),
                    "ci95": [round(float(np.percentile(boots[:, j], 2.5)), 5), round(float(np.percentile(boots[:, j], 97.5)), 5)]}
    return out


def summary(p: pd.DataFrame) -> dict:
    lm, lb = losses(p), losses(p, "b")
    return {"n": len(p), **{c: {"model": round(float(lm[c].mean()), 5), "base": round(float(lb[c].mean()), 5)} for c in lm.columns}}
