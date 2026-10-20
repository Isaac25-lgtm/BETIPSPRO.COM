"""Stage 1: time-decay x ridge grid, per-competition and pooled. Writes research/out/grid.json and predictions."""

from __future__ import annotations

import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import harness  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
HALF_LIVES = [90, 180, 270, 365, 540, 730, 100000]
RIDGES = [0.5, 1.0, 2.0, 4.0, 8.0]


def job(args):
    hl, ridge, pooled = args
    df = harness.load()
    xi = np.log(2) / hl
    p = harness.predict(df, xi=xi, ridge=ridge, pooled=pooled)
    tag = f"{'pool' if pooled else 'comp'}_hl{hl}_r{ridge}"
    p.to_pickle(OUT / f"pred_{tag}.pkl")
    return tag


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    jobs = [(hl, r, pooled) for pooled in (False, True) for hl in HALF_LIVES for r in RIDGES]
    jobs.insert(0, (364.8, 2.0, False))  # incumbent: xi=0.0019 -> half-life 364.8 days
    with ProcessPoolExecutor() as ex:
        for tag in ex.map(job, jobs):
            print("done", tag, flush=True)
