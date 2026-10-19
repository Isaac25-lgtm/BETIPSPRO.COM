"""Market catalogue loading, probability derivation and settlement.

All goal markets derive jointly from ONE scoreline distribution, so 1X2 sums to 1,
Over/Under pairs are complementary and Over-k probabilities fall as k rises.
The same predicates are mirrored in worker/services/markets.ts for evidence hit-rates.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

CATALOG_PATH = Path(__file__).resolve().parents[3] / "shared" / "market-catalog.json"


def load_catalog(path: Path = CATALOG_PATH) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


@dataclass
class Distributions:
    ft: np.ndarray | None          # scoreline matrix [home, away]
    ht: np.ndarray | None          # first-half scoreline matrix
    corners_total: np.ndarray | None
    cards_total: np.ndarray | None


def _side_mask(m: np.ndarray, side: str) -> np.ndarray:
    h = np.arange(m.shape[0])[:, None]
    a = np.arange(m.shape[1])[None, :]
    if side == "HOME":
        return h > a
    if side == "AWAY":
        return h < a
    return h == a


def probability(pred: dict, d: Distributions) -> float | None:
    t = pred["type"]
    period = pred.get("period", "FT")
    m = d.ft if period == "FT" else d.ht
    if t == "result":
        if m is None:
            return None
        mask = np.zeros_like(m, dtype=bool)
        for s in pred["sides"]:
            mask |= _side_mask(m, s)
        return float(m[mask].sum())
    if t == "total":
        stat = pred["stat"]
        if stat == "goals":
            if m is None:
                return None
            tot = np.add.outer(np.arange(m.shape[0]), np.arange(m.shape[1]))
            p_over = float(m[tot > pred["threshold"]].sum())
        else:
            pmf = d.corners_total if stat == "corners" else d.cards_total
            if pmf is None:
                return None
            k = np.arange(len(pmf))
            p_over = float(pmf[k > pred["threshold"]].sum())
        return p_over if pred["dir"] == "OVER" else 1.0 - p_over
    if t == "btts":
        if m is None:
            return None
        p_yes = float(m[1:, 1:].sum())
        return p_yes if pred["value"] else 1.0 - p_yes
    if t == "team_total":
        if m is None:
            return None
        g = np.arange(m.shape[0])
        if pred["side"] == "HOME":
            p_over = float(m[g > pred["threshold"], :].sum())
        else:
            p_over = float(m[:, g > pred["threshold"]].sum())
        return p_over if pred["dir"] == "OVER" else 1.0 - p_over
    if t == "correct_score":
        if m is None:
            return None
        return float(m[pred["home"], pred["away"]])
    if t == "correct_score_other":
        if m is None:
            return None
        k = pred["max"] + 1
        return float(1.0 - m[:k, :k].sum())
    raise ValueError(f"unknown predicate type {t}")


def settle(pred: dict, outcome: dict) -> int | None:
    """outcome: hg, ag, hth, ath, corners_total, yellow_total (None when unknown)."""
    t = pred["type"]
    period = pred.get("period", "FT")
    h = outcome["hg"] if period == "FT" else outcome["hth"]
    a = outcome["ag"] if period == "FT" else outcome["ath"]
    if t in ("result", "btts", "team_total", "correct_score", "correct_score_other") or (
        t == "total" and pred["stat"] == "goals"
    ):
        if h is None or a is None:
            return None
    if t == "result":
        side = "HOME" if h > a else "AWAY" if h < a else "DRAW"
        return int(side in pred["sides"])
    if t == "total":
        v = {"goals": None if h is None else h + a, "corners": outcome.get("corners_total"), "yellow_cards": outcome.get("yellow_total")}[pred["stat"]]
        if v is None:
            return None
        return int(v > pred["threshold"]) if pred["dir"] == "OVER" else int(v < pred["threshold"])
    if t == "btts":
        return int((h > 0 and a > 0) == pred["value"])
    if t == "team_total":
        v = h if pred["side"] == "HOME" else a
        return int(v > pred["threshold"]) if pred["dir"] == "OVER" else int(v < pred["threshold"])
    if t == "correct_score":
        return int(h == pred["home"] and a == pred["away"])
    if t == "correct_score_other":
        return int(h > pred["max"] or a > pred["max"])
    raise ValueError(t)
