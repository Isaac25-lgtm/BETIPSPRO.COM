"""SYNTHETIC DEMO world generator.

Everything produced here is fictional: competitions, clubs, referees, venues and every
score/statistic. It exists so the product can be exercised end-to-end before a real
provider key is configured. All records carry is_synthetic=1 and the run is tagged
data_mode=SIMULATED_DEMO. Nothing here may be presented as real football information.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np

COMPETITIONS = [
    {
        "id": "demo:dpd",
        "provider_id": "dpd",
        "name": "Demo Premier Division",
        "short_name": "Demo Premier",
        "base_goal_log": 0.30,
        "weekday_offset": 0,  # round played on the anchor day
        "teams": [
            ("Northbridge Rovers", "NBR", "#c8102e", "#ffffff"),
            ("Kestrel Bay FC", "KBF", "#1d4ed8", "#ffffff"),
            ("Ironvale United", "IVU", "#334155", "#f59e0b"),
            ("Lakeside Athletic", "LKA", "#0ea5e9", "#0f172a"),
            ("Redmoor Town", "RMT", "#b91c1c", "#111827"),
            ("Ashford Harriers", "AFH", "#065f46", "#fde68a"),
            ("Silverport City", "SPC", "#94a3b8", "#0f172a"),
            ("Thornbury Wanderers", "TBW", "#7c3aed", "#ffffff"),
            ("Eastmere Albion", "EMA", "#f97316", "#1e293b"),
            ("Gladeworth FC", "GWF", "#16a34a", "#ffffff"),
            ("Copperfield United", "CFU", "#b45309", "#ffffff"),
            ("Westholm Rangers", "WHR", "#1e3a8a", "#facc15"),
        ],
    },
    {
        "id": "demo:dlp",
        "provider_id": "dlp",
        "name": "Demo Liga Primera",
        "short_name": "Demo Primera",
        "base_goal_log": 0.22,
        "weekday_offset": 1,
        "teams": [
            ("Real Costaverde", "RCV", "#ffffff", "#7c3aed"),
            ("Atletico Montebrisa", "AMB", "#dc2626", "#ffffff"),
            ("CD Puerto Lumen", "PLU", "#0284c7", "#fef08a"),
            ("Sierra Alta CF", "SAC", "#15803d", "#ffffff"),
            ("UD Valleoro", "UDV", "#ca8a04", "#1f2937"),
            ("Deportivo Marisal", "DMA", "#1e40af", "#ffffff"),
            ("CF Torreluz", "CTL", "#9f1239", "#fde68a"),
            ("Racing Arenal", "RAR", "#065f46", "#ffffff"),
            ("SD Campobello", "SDC", "#f43f5e", "#111827"),
            ("Union Brisamar", "UBM", "#06b6d4", "#0f172a"),
            ("CD Rocanegra", "CDR", "#111827", "#f8fafc"),
            ("Atletico Solvera", "ASV", "#ea580c", "#ffffff"),
        ],
    },
    {
        "id": "demo:dcl",
        "provider_id": "dcl",
        "name": "Demo Continental League",
        "short_name": "Demo Continental",
        "base_goal_log": 0.36,
        "weekday_offset": 2,
        "teams": [
            ("FC Nordhavn", "NDH", "#1d4ed8", "#f8fafc"),
            ("AS Montclair", "ASM", "#be123c", "#111827"),
            ("Sporting Vilaterra", "SVT", "#16a34a", "#f8fafc"),
            ("Dynamo Kaltberg", "DKB", "#0369a1", "#ffffff"),
            ("Olympic Belcastro", "OBC", "#a21caf", "#ffffff"),
            ("SK Rivenhof", "SKR", "#b91c1c", "#f8fafc"),
            ("Inter Aldoria", "IAL", "#1e293b", "#38bdf8"),
            ("FC Lunebourg", "FLB", "#facc15", "#1e293b"),
            ("Rapid Ostwald", "ROW", "#15803d", "#fef9c3"),
            ("AC Serravalle", "ACS", "#dc2626", "#0f172a"),
            ("Vardholm SK", "VSK", "#0f766e", "#ffffff"),
            ("Athletic Pirenne", "APR", "#4338ca", "#fde047"),
        ],
    },
]

N_REFEREES = 14
KICKOFF_SLOTS_UTC = ["13:30", "14:30", "16:00", "16:45", "18:00", "18:45"]
PREV_SEASON = "2025-26"
CURR_SEASON = "2026-27"
PLAYED_ROUNDS_CURRENT = 10
UPCOMING_ROUNDS = 2


GENERIC_WORDS = {"FC", "CF", "SD", "UD", "CD", "SK", "AC", "AS", "United", "Athletic", "Rovers", "Rangers", "Wanderers",
                 "Town", "City", "Harriers", "Albion", "Real", "Atletico", "Deportivo", "Sporting", "Racing", "Union",
                 "Dynamo", "Olympic", "Inter", "Rapid"}


def short_name(name: str) -> str:
    """Distinctive short label for tables ("Northbridge Rovers" -> "Northbridge", "Kestrel Bay FC" -> "Kestrel Bay")."""
    words = [w for w in name.split() if w not in GENERIC_WORDS]
    return " ".join(words) if words else name


@dataclass
class World:
    competitions: list[dict]
    teams: list[dict]
    referees: list[dict]
    fixtures: list[dict]
    team_stats: list[dict]
    anchor: datetime


def round_robin(n: int) -> list[list[tuple[int, int]]]:
    """Circle-method double round robin: 2*(n-1) rounds of n/2 matches."""
    idx = list(range(n))
    rounds = []
    for r in range(n - 1):
        pairs = []
        for i in range(n // 2):
            a, b = idx[i], idx[n - 1 - i]
            pairs.append((a, b) if (r + i) % 2 == 0 else (b, a))
        rounds.append(pairs)
        idx = [idx[0]] + [idx[-1]] + idx[1:-1]
    second = [[(b, a) for (a, b) in rnd] for rnd in rounds]
    return rounds + second


def _nb(rng: np.random.Generator, mu: float, alpha: float) -> int:
    # NB2 via gamma-Poisson mixture: Var = mu + alpha*mu^2
    lam = rng.gamma(shape=1.0 / alpha, scale=mu * alpha)
    return int(rng.poisson(lam))


def generate(anchor: datetime, seed: int = 20261020) -> World:
    """Generate the synthetic world. `anchor` is 'now' for the demo (upcoming round 11 day 0)."""
    rng = np.random.default_rng(seed)
    anchor_day = anchor.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    referees = [
        {"id": f"demo:ref{r + 1:02d}", "name": f"Synthetic Referee {r + 1:02d}", "is_synthetic": 1}
        for r in range(N_REFEREES)
    ]
    ref_effect = rng.normal(0, 0.16, N_REFEREES)

    competitions, teams, fixtures, team_stats = [], [], [], []
    for comp in COMPETITIONS:
        competitions.append(
            {
                "id": comp["id"],
                "provider": "demo",
                "provider_id": comp["provider_id"],
                "name": comp["name"],
                "short_name": comp["short_name"],
                "country": "Synthetic (demo)",
                "is_synthetic": 1,
                "current_season": CURR_SEASON,
            }
        )
        n = len(comp["teams"])
        attack = rng.normal(0, 0.24, n)
        defence = rng.normal(0, 0.20, n)  # positive = concedes more
        attack -= attack.mean()
        defence -= defence.mean()
        corner_style = rng.normal(0, 0.12, n)
        discipline = rng.normal(0, 0.14, n)
        home_adv = 0.24
        team_ids = []
        for i, (name, code, c1, c2) in enumerate(comp["teams"]):
            tid = f"{comp['id']}:t{i + 1:02d}"
            team_ids.append(tid)
            teams.append(
                {
                    "id": tid,
                    "provider": "demo",
                    "provider_id": f"{comp['provider_id']}-t{i + 1:02d}",
                    "name": name,
                    "short_name": short_name(name),
                    "code": code,
                    "country": "Synthetic (demo)",
                    "primary_color": c1,
                    "secondary_color": c2,
                    "competition_id": comp["id"],
                    "venue": f"{max(name.split(' '), key=len)} Park",
                    "is_synthetic": 1,
                }
            )

        schedule = round_robin(n)
        # Season-level drift so the previous season is informative but not identical.
        drift_att = rng.normal(0, 0.06, n)
        drift_def = rng.normal(0, 0.05, n)

        def match_day(season: str, rnd: int) -> datetime:
            # Current season: round 11 is on anchor_day + weekday_offset; rounds weekly.
            if season == CURR_SEASON:
                return anchor_day + timedelta(days=comp["weekday_offset"] + 7 * (rnd - (PLAYED_ROUNDS_CURRENT + 1)))
            # Previous season ended 16 weeks before current round 1.
            curr_r1 = anchor_day + timedelta(days=comp["weekday_offset"] - 7 * PLAYED_ROUNDS_CURRENT)
            return curr_r1 - timedelta(weeks=16) - timedelta(days=7 * (len(schedule) - rnd))

        for season, rounds_to_make in ((PREV_SEASON, len(schedule)), (CURR_SEASON, PLAYED_ROUNDS_CURRENT + UPCOMING_ROUNDS)):
            att = attack - (drift_att if season == PREV_SEASON else 0)
            dfn = defence - (drift_def if season == PREV_SEASON else 0)
            for rnd in range(1, rounds_to_make + 1):
                pairs = schedule[(rnd - 1) % len(schedule)]
                day = match_day(season, rnd)
                for m, (h, a) in enumerate(pairs):
                    slot = KICKOFF_SLOTS_UTC[m % len(KICKOFF_SLOTS_UTC)]
                    hh, mm = (int(x) for x in slot.split(":"))
                    ko = day.replace(hour=hh, minute=mm)
                    fid = f"{comp['id']}:{season}:r{rnd:02d}:m{m + 1}"
                    ref_idx = int(rng.integers(0, N_REFEREES))
                    upcoming = season == CURR_SEASON and rnd > PLAYED_ROUNDS_CURRENT
                    fx = {
                        "id": fid,
                        "provider": "demo",
                        "provider_id": fid.replace("demo:", ""),
                        "competition_id": comp["id"],
                        "season": season,
                        "round": f"Round {rnd}",
                        "home_team_id": team_ids[h],
                        "away_team_id": team_ids[a],
                        "starts_at_utc": ko.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "status": "NS" if upcoming else "FT",
                        "venue_name": next(t["venue"] for t in teams if t["id"] == team_ids[h]) + " (synthetic)",
                        "venue_city": "Synthetic",
                        "referee_id": referees[ref_idx]["id"],
                        "is_synthetic": 1,
                        "home_goals": None,
                        "away_goals": None,
                        "home_goals_ht": None,
                        "away_goals_ht": None,
                    }
                    if not upcoming:
                        lam_h = np.exp(comp["base_goal_log"] + home_adv + att[h] + dfn[a])
                        lam_a = np.exp(comp["base_goal_log"] + att[a] + dfn[h])
                        gh, ga = int(rng.poisson(lam_h)), int(rng.poisson(lam_a))
                        # Mild low-score dependence (Dixon-Coles style): occasionally convert 1-1 -> 0-0
                        if gh == 1 and ga == 1 and rng.random() < 0.06:
                            gh, ga = 0, 0
                        hth = int(rng.binomial(gh, 0.44))
                        hta = int(rng.binomial(ga, 0.44))
                        fx.update(home_goals=gh, away_goals=ga, home_goals_ht=hth, away_goals_ht=hta)
                        for side, ti, oi, is_home in ((0, h, a, 1), (1, a, h, 0)):
                            corners_mu = np.exp(1.58 + 0.10 * is_home + 0.55 * att[ti] - 0.35 * att[oi] + corner_style[ti])
                            yc_mu = np.exp(0.62 + 0.08 * (1 - is_home) + discipline[ti] + ref_effect[ref_idx])
                            shots_mu = 11.5 * np.exp(0.12 * is_home + 0.7 * att[ti] + 0.4 * dfn[oi])
                            shots = int(rng.poisson(shots_mu))
                            team_stats.append(
                                {
                                    "fixture_id": fid,
                                    "team_id": team_ids[ti],
                                    "corners": _nb(rng, corners_mu, 0.10),
                                    "yellow_cards": _nb(rng, yc_mu, 0.08),
                                    "red_cards": int(rng.random() < 0.045),
                                    "shots": shots,
                                    "shots_on_target": int(rng.binomial(shots, 0.35)),
                                    "possession_pct": None,
                                    "xg": None,
                                }
                            )
                        # Possession: complementary pair
                        poss = float(np.clip(50 + 18 * (att[h] - att[a]) + 2.5 + rng.normal(0, 5), 28, 72))
                        team_stats[-2]["possession_pct"] = round(poss, 1)
                        team_stats[-1]["possession_pct"] = round(100 - poss, 1)
                    fixtures.append(fx)

    fixtures.sort(key=lambda f: (f["starts_at_utc"], f["id"]))
    for t in teams:
        t.pop("venue", None)
    return World(competitions, teams, referees, fixtures, team_stats, anchor)
