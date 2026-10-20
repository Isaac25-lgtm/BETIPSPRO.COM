"""Stage 3: pooled model with league-strength offsets (Champions League bridge)."""

import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"


def job(a):
    rs, rt, rq = a
    p = harness.predict(harness.load(), xi=np.log(2) / 365, pooled=True, ridge_s=rs, ridge_t=rt, league_offsets=True, ridge_q=rq)
    tag = f"poolq_split_s{rs}_t{rt}_q{rq}"
    p.to_pickle(OUT / f"pred_{tag}.pkl")
    return tag


def report():
    inc = pd.read_pickle(OUT / "pred_comp_hl364.8_r2.0.pkl")
    cmp_ = pd.read_pickle(OUT / "pred_comp_split_s6.0_t64.0.pkl")
    a = inc[inc.comp == "apif:2"]
    for tag in ["pool_split_s6.0_t64.0"] + [f"poolq_split_s6.0_t64.0_q{q}" for q in (0.1, 1.0, 4.0)]:
        p = pd.read_pickle(OUT / f"pred_{tag}.pkl")
        c = p[p.comp == "apif:2"]
        r = harness.paired(a, c, n_boot=1000)
        extra = c[~c.fixture_id.isin(a.fixture_id)]
        rd = harness.paired(cmp_[cmp_.comp != "apif:2"], p[p.comp != "apif:2"], n_boot=500)
        fmt = lambda r, k: f"{k} {r[k]['delta']*1000:+.1f} [{r[k]['ci95'][0]*1000:+.1f},{r[k]['ci95'][1]*1000:+.1f}]"
        print(f"{tag:<30} CL same {r['n']}: " + " ".join(fmt(r, k) for k in ("1x2", "ou25", "btts")))
        print(f"{'':<30} CL extra {len(extra)}: {harness.summary(extra)}")
        print(f"{'':<30} domestic vs comp-split: " + " ".join(fmt(rd, k) for k in ("1x2", "ou25", "btts")))


if __name__ == "__main__":
    if "--report" not in sys.argv:
        jobs = [(6.0, 64.0, rq) for rq in (0.1, 1.0, 4.0)]
        with ProcessPoolExecutor() as ex:
            for t in ex.map(job, jobs):
                print("done", t, flush=True)
    report()
