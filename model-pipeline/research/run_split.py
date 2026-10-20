import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness
OUT = Path(__file__).resolve().parent / "out"

def job(a):
    rs, rt, pooled = a
    p = harness.predict(harness.load(), xi=np.log(2) / 365, pooled=pooled, ridge_s=rs, ridge_t=rt)
    tag = f"{'pool' if pooled else 'comp'}_split_s{rs}_t{rt}"
    p.to_pickle(OUT / f"pred_{tag}.pkl"); return tag

if __name__ == "__main__":
    jobs = [(rs, rt, pl) for pl in (False, True) for rs in (4.0, 6.0) for rt in (48.0, 64.0, 96.0, 192.0)]
    with ProcessPoolExecutor() as ex:
        for t in ex.map(job, jobs): print("done", t, flush=True)
