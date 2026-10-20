"""Stage 5: first-half 'a goal before half-time' (HT over 0.5) candidates, same rolling protocol.

  inc      : current production model (separate HT Poisson fit, ridge 6, no rho, per competition)
  ht_split : separate HT fit with split shrinkage
  derived  : HT rates = full-time DC rates (chosen config) x league half-time share of goals (home / away)
"""

import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dcfast  # noqa: E402
import harness  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
XI = 0.0019


def predict_ht(df, mode, rs=None, rt=None, ridge=6.0):
    cuts = harness.cutoffs(df)
    done = df[df["done"] & df["home_goals_ht"].notna()]
    rows = []
    for k, cut in enumerate(cuts):
        nxt = cuts[k + 1] if k + 1 < len(cuts) else cut + pd.Timedelta(days=4)
        test = done[(done["ko"] >= cut) & (done["ko"] < nxt)]
        for c in test["competition_id"].unique():
            train = done[(done["ko"] < cut) & (done["competition_id"] == c)]
            if len(train) < harness.MIN_LEAGUE_MATCHES:
                continue
            days = (cut - train["ko"]).dt.total_seconds().to_numpy() / 86400.0
            args = (list(train["home_team_id"]), list(train["away_team_id"]), [c] * len(train))
            if mode == "derived":
                f = dcfast.fit(*args, train["home_goals"], train["away_goals"], days, xi=XI, ridge_s=6.0, ridge_t=64.0)
                w = np.exp(-XI * days)
                sh = np.sum(w * train["home_goals_ht"]) / np.sum(w * train["home_goals"])
                sa = np.sum(w * train["away_goals_ht"]) / np.sum(w * train["away_goals"])
            else:
                f = dcfast.fit(*args, train["home_goals_ht"], train["away_goals_ht"], days, xi=XI, fit_rho=False,
                               ridge=ridge, ridge_s=rs, ridge_t=rt)
                sh = sa = 1.0
            counts = pd.concat([train["home_team_id"], train["away_team_id"]]).value_counts()
            base = float(np.mean(train["home_goals_ht"] + train["away_goals_ht"] >= 1))
            for r in test[test["competition_id"] == c].itertuples():
                if counts.get(r.home_team_id, 0) < 1 or counts.get(r.away_team_id, 0) < 1:
                    continue  # production HT model has no per-team minimum; it needs a rating to exist
                lh, la = f.rates(r.home_team_id, r.away_team_id, c)
                p = 1 - np.exp(-(lh * sh + la * sa))
                rows.append({"fixture_id": r.id, "season": r.season, "block": k, "p": p, "b": base,
                             "y": int(r.home_goals_ht + r.away_goals_ht >= 1)})
    return pd.DataFrame(rows)


def ll(p, y):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


JOBS = {"inc": ("sep", None, None), "ht_split_s12_t64": ("sep", 12.0, 64.0), "ht_split_s12_t200": ("sep", 12.0, 200.0),
        "ht_split_s24_t200": ("sep", 24.0, 200.0), "derived": ("derived", None, None)}


def job(tag):
    mode, rs, rt = JOBS[tag]
    p = predict_ht(harness.load(), mode, rs, rt)
    p.to_pickle(OUT / f"ht_{tag}.pkl")
    return tag


def report():
    inc = pd.read_pickle(OUT / "ht_inc.pkl").set_index("fixture_id")
    rng = np.random.default_rng(1)
    for tag in JOBS:
        c = pd.read_pickle(OUT / f"ht_{tag}.pkl").set_index("fixture_id")
        for season in ("2025", "2026"):
            ids = inc.index[inc.season == season].intersection(c.index)
            a, b = inc.loc[ids], c.loc[ids]
            d = ll(a.p, a.y).to_numpy() - ll(b.p, b.y).to_numpy()
            blocks = a.block.to_numpy(); ub = np.unique(blocks); bi = {u: np.where(blocks == u)[0] for u in ub}
            boots = [d[np.concatenate([bi[u] for u in rng.choice(ub, len(ub))])].mean() for _ in range(1000)]
            print(f"{tag:<20} {season} n={len(ids):<5} model {ll(b.p, b.y).mean():.4f} base {ll(b.b, b.y).mean():.4f} "
                  f"delta vs inc {d.mean()*1000:+.1f} [{np.percentile(boots, 2.5)*1000:+.1f},{np.percentile(boots, 97.5)*1000:+.1f}]")


if __name__ == "__main__":
    if "--report" not in sys.argv:
        with ProcessPoolExecutor() as ex:
            for t in ex.map(job, list(JOBS)):
                print("done", t, flush=True)
    report()
