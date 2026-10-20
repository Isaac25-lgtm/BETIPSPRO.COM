import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness
OUT = Path(__file__).resolve().parent / "out"

def job(a):
    hl, r, pooled = a
    p = harness.predict(harness.load(), xi=np.log(2) / hl, ridge=r, pooled=pooled)
    tag = f"{'pool' if pooled else 'comp'}_hl{hl}_r{r}"
    p.to_pickle(OUT / f"pred_{tag}.pkl"); return tag

if __name__ == "__main__":
    jobs = [(365, r, pl) for pl in (False, True) for r in (12.0, 16.0, 24.0, 32.0, 48.0)]
    with ProcessPoolExecutor() as ex:
        for t in ex.map(job, jobs): print("done", t, flush=True)
