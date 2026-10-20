"""Fast Dixon-Coles fitter (analytic gradient) used by the research harness.

Same likelihood as fip_model.models.goals.fit_goals (weighted DC + ridge + soft sum-to-zero), generalised so
several competitions can be fitted jointly: each competition gets its own intercept and home advantage while
team attack/defence ratings are shared. With a single competition it reproduces fit_goals.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize
from scipy.special import gammaln


@dataclass
class Fit:
    teams: list[str]
    comps: list[str]
    mu: np.ndarray
    ha: np.ndarray
    rho: float
    att: np.ndarray
    dfn: np.ndarray
    idx: dict
    cidx: dict
    converged: bool
    min_tau: float
    q: np.ndarray | None = None
    gidx: dict | None = None
    team_group: dict | None = None

    def offset(self, team: str) -> float:
        if self.q is None:
            return 0.0
        return float(self.q[self.gidx[self.team_group[team]]])

    def rates(self, home: str, away: str, comp: str):
        c = self.cidx[comp]
        h, a = self.idx[home], self.idx[away]
        dq = self.offset(home) - self.offset(away)
        return (float(np.exp(self.mu[c] + self.ha[c] + self.att[h] + self.dfn[a] + dq)),
                float(np.exp(self.mu[c] + self.att[a] + self.dfn[h] - dq)))


def fit(home, away, comp, x, y, days, xi=0.0019, ridge=2.0, fit_rho=True, sz=50.0,
        ridge_s=None, ridge_t=None, rho_bound=0.2,
        team_group=None, ridge_q=1.0) -> Fit:
    """ridge_s / ridge_t (optional): separate shrinkage on team quality s=(att-dfn)/2 and goal propensity
    t=(att+dfn)/2. When unset, the plain ridge on att and dfn is used (identical to fit_goals).
    team_group (optional): team -> home-league group. Adds one quality offset per group (first group fixed at 0).
    It cancels in same-league matches, so it is learned only from cross-league matches."""
    split = ridge_s is not None
    teams = sorted(set(home) | set(away))
    comps = sorted(set(comp))
    idx = {t: i for i, t in enumerate(teams)}
    cidx = {c: i for i, c in enumerate(comps)}
    hi = np.array([idx[t] for t in home]); ai = np.array([idx[t] for t in away])
    ci = np.array([cidx[c] for c in comp])
    x = np.asarray(x, float); y = np.asarray(y, float)
    w = np.exp(-xi * np.asarray(days, float))
    n, C = len(teams), len(comps)
    groups = sorted(set(team_group[t] for t in teams)) if team_group else []
    gidx = {g: i for i, g in enumerate(groups)}
    G = len(groups)
    if G:
        gh = np.array([gidx[team_group[t]] for t in home]); ga_ = np.array([gidx[team_group[t]] for t in away])
    const = gammaln(x + 1) + gammaln(y + 1)
    m00 = (x == 0) & (y == 0); m01 = (x == 0) & (y == 1); m10 = (x == 1) & (y == 0); m11 = (x == 1) & (y == 1)

    K = 2 * C + 1 + 2 * n

    def unpack(p):
        return p[:C], p[C:2 * C], (p[2 * C] if fit_rho else 0.0), p[2 * C + 1:2 * C + 1 + n], p[2 * C + 1 + n:K]

    def f(p):
        mu, ha, rho, att, dfn = unpack(p)
        ll_ = mu[ci] + ha[ci] + att[hi] + dfn[ai]
        lm_ = mu[ci] + att[ai] + dfn[hi]
        if G:
            q = p[K:]
            dq = q[gh] - q[ga_]
            ll_ = ll_ + dq; lm_ = lm_ - dq
        lam, lmu = np.exp(ll_), np.exp(lm_)
        tau = np.ones_like(lam); tl = np.zeros_like(lam); tm = np.zeros_like(lam); tr = np.zeros_like(lam)
        if fit_rho:
            tau[m00] = 1 - lam[m00] * lmu[m00] * rho; tl[m00] = -lam[m00] * lmu[m00] * rho; tm[m00] = tl[m00]; tr[m00] = -lam[m00] * lmu[m00]
            tau[m01] = 1 + lam[m01] * rho; tl[m01] = lam[m01] * rho; tr[m01] = lam[m01]
            tau[m10] = 1 + lmu[m10] * rho; tm[m10] = lmu[m10] * rho; tr[m10] = lmu[m10]
            tau[m11] = 1 - rho; tr[m11] = -1.0
        taus = np.clip(tau, 1e-9, None)
        ll = x * ll_ - lam + y * lm_ - lmu - const + np.log(taus)
        if split:
            sq, tq = (att - dfn) / 2, (att + dfn) / 2
            pen = 0.5 * ridge_s * (sq @ sq) + 0.5 * ridge_t * (tq @ tq)
            ga, gd = 0.5 * ridge_s * sq + 0.5 * ridge_t * tq, -0.5 * ridge_s * sq + 0.5 * ridge_t * tq
        else:
            pen = 0.5 * ridge * (att @ att + dfn @ dfn)
            ga, gd = ridge * att, ridge * dfn
        if G:
            pen = pen + 0.5 * ridge_q * (q @ q)
        val = -np.sum(w * ll) + pen + sz * (att.sum() ** 2 + dfn.sum() ** 2)
        gl = w * (x - lam + tl / taus); gm = w * (y - lmu + tm / taus)
        g = np.zeros_like(p)
        g[:C] = -(np.bincount(ci, gl, C) + np.bincount(ci, gm, C))
        g[C:2 * C] = -np.bincount(ci, gl, C)
        if fit_rho:
            g[2 * C] = -np.sum(w * tr / taus)
        g[2 * C + 1:2 * C + 1 + n] = -(np.bincount(hi, gl, n) + np.bincount(ai, gm, n)) + ga + 2 * sz * att.sum()
        g[2 * C + 1 + n:K] = -(np.bincount(ai, gl, n) + np.bincount(hi, gm, n)) + gd + 2 * sz * dfn.sum()
        if G:
            g[K:] = -(np.bincount(gh, gl, G) - np.bincount(ga_, gl, G) + np.bincount(ga_, gm, G) - np.bincount(gh, gm, G)) + ridge_q * q
        return val, g

    p0 = np.zeros(K + G)
    for c in range(C):
        s = ci == c
        p0[c] = np.log(max((x[s].mean() + y[s].mean()) / 2, 0.1))
        p0[C + c] = 0.2
    bounds = [(None, None)] * C + [(-1, 1)] * C + [(-rho_bound, rho_bound) if fit_rho else (0.0, 0.0)] + [(-2.5, 2.5)] * (2 * n) + ([(0.0, 0.0)] + [(-2.0, 2.0)] * (G - 1) if G else [])
    res = minimize(f, p0, jac=True, method="L-BFGS-B", bounds=bounds, options={"maxiter": 3000})
    mu, ha, rho, att, dfn = unpack(res.x)
    dq = (res.x[K:][gh] - res.x[K:][ga_]) if G else 0.0
    lam = np.exp(mu[ci] + ha[ci] + att[hi] + dfn[ai] + dq); lmu = np.exp(mu[ci] + att[ai] + dfn[hi] - dq)
    taus = [1.0]
    if fit_rho:
        taus = np.concatenate([1 - lam * lmu * rho, 1 + lam * rho, 1 + lmu * rho, [1 - rho]])
    return Fit(teams, comps, mu, ha, float(rho), att, dfn, idx, cidx, bool(res.success), float(np.min(taus)),
               res.x[K:] if G else None, gidx if G else None, team_group if G else None)
