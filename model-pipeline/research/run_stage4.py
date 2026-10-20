"""Stage 4: with the chosen split shrinkage (s=6, t=64, per competition): rho bound, independent Poisson, decay."""

import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
BASE = dict(ridge_s=6.0, ridge_t=64.0)
JOBS = {
    "s6t64_rho0.35": dict(xi=np.log(2) / 365, rho_bound=0.35, rho_mode="admissible"),
    "s6t64_norho": dict(xi=np.log(2) / 365, fit_rho=False),
    "s6t64_hl180": dict(xi=np.log(2) / 180),
    "s6t64_hl730": dict(xi=np.log(2) / 730),
    "s6t64_hl365_adm": dict(xi=np.log(2) / 365, rho_mode="admissible"),
}


def job(tag):
    p = harness.predict(harness.load(), **BASE, **JOBS[tag])
    p.to_pickle(OUT / f"pred_{tag}.pkl")
    return tag


def report():
    ref = pd.read_pickle(OUT / "pred_comp_split_s6.0_t64.0.pkl")
    fmt = lambda r, k: f"{k} {r[k]['delta']*1000:+.1f} [{r[k]['ci95'][0]*1000:+.1f},{r[k]['ci95'][1]*1000:+.1f}]"
    for tag in JOBS:
        p = pd.read_pickle(OUT / f"pred_{tag}.pkl")
        for nm, mask in (("tune", ref.season == "2025"), ("holdout", ref.season == "2026")):
            a = ref[mask]
            r = harness.paired(a, p[p.fixture_id.isin(a.fixture_id)], n_boot=1000)
            print(f"{tag:<18} vs chosen | {nm:<7} n={r['n']:<5} " + " ".join(fmt(r, k) for k in ("1x2", "ou25", "btts")))


if __name__ == "__main__":
    if "--report" not in sys.argv:
        with ProcessPoolExecutor() as ex:
            for t in ex.map(job, list(JOBS)):
                print("done", t, flush=True)
    report()
