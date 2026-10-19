"""CLI.

  python run.py demo --out ../fixtures/demo/demo-artifact.json
      Generate the SYNTHETIC demo world, fit all models, backtest, export artifact.

  python run.py fit --input data/raw/export.json --out data/exports/artifact.json [--mode FREE_API]
      Fit on a normalised export produced by the Worker (GET /api/v1/admin/export/history).
      The pipeline never calls API-Football itself: upstream quota is owned by the Worker gateway.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import synthetic
from .engine import Dataset, run
from .markets import load_catalog


def _write(artifact: dict, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(artifact, separators=(",", ":"), default=str), encoding="utf-8")


def _summary(a: dict, secs: float) -> str:
    probs = [f for f in a["forecasts"] if f["probability"] is not None]
    lines = [
        f"data_mode={a['data_mode']} run={a['model_run']['id']}",
        f"fixtures={len(a['fixtures'])} upcoming_reports={len(a['reports'])} forecasts={len(a['forecasts'])} (with probability: {len(probs)})",
        f"archive_backtest_forecasts={len(a['archive_forecasts'])} evaluations={len(a['evaluations'])} odds={len(a['bookmaker_snapshots'])}",
    ]
    for e in a["evaluations"]:
        if e["competition_id"] is None:
            lines.append(f"  backtest {e['market_family']:<24} n={e['sample_n']:<4} logloss={e['log_loss']:.4f} (baseline {e['baseline_log_loss']:.4f}) brier={e['brier']:.4f} (baseline {e['baseline_brier']:.4f})")
    lines.append(f"elapsed={secs:.1f}s")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="fip_model")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("demo")
    d.add_argument("--out", type=Path, required=True)
    d.add_argument("--anchor", type=str, default=None, help="UTC date YYYY-MM-DD; default today")
    d.add_argument("--seed", type=int, default=20261020)
    f = sub.add_parser("fit")
    f.add_argument("--input", type=Path, required=True)
    f.add_argument("--out", type=Path, required=True)
    f.add_argument("--mode", choices=["FREE_API", "PRODUCTION"], default="FREE_API")
    args = ap.parse_args(argv)

    catalog = load_catalog()
    t0 = time.time()
    if args.cmd == "demo":
        day = datetime.strptime(args.anchor, "%Y-%m-%d").replace(tzinfo=timezone.utc) if args.anchor else datetime.now(timezone.utc)
        day = day.replace(hour=0, minute=0, second=0, microsecond=0)
        world = synthetic.generate(day, seed=args.seed)
        ds = Dataset(world.competitions, world.teams, world.referees, world.fixtures, world.team_stats)
        # Model cut-off is 06:00 UTC on the anchor day, before the first synthetic kickoff.
        artifact = run(ds, catalog, "SIMULATED_DEMO", day + timedelta(hours=6), synthetic_odds=True)
    else:
        raw = json.loads(args.input.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and "data" in raw and "ok" in raw:  # Worker API envelope
            raw = raw["data"]
        ds = Dataset(raw["competitions"], raw["teams"], raw.get("referees", []), raw["fixtures"], raw.get("team_stats", []))
        artifact = run(ds, catalog, args.mode, datetime.now(timezone.utc))
    _write(artifact, args.out)
    print(_summary(artifact, time.time() - t0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
