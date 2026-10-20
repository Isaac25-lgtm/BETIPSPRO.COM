"""Dixon-Coles goals model with exponential time decay and ridge shrinkage.

log(lambda_home) = mu + home_adv + attack[home] + defence[away]
log(lambda_away) = mu +            attack[away] + defence[home]
with the Dixon-Coles low-score correction tau(x, y; rho).

The same class (rho fixed to 0, stronger shrinkage) is reused for first-half goals.
Uncertainty: Laplace approximation (numerical Hessian at the MAP), parameter sampling.

Shrinkage (v0.2, D-025): optionally split into team QUALITY s=(att-dfn)/2, which drives 1X2, and goal
PROPENSITY t=(att+dfn)/2, which drives totals/BTTS. A rolling-origin study on 1,781 real matches showed totals
and BTTS overfit under a single ridge while 1X2 did not; shrinking t harder fixed that without hurting 1X2.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import minimize
from scipy.special import gammaln
from scipy.stats import poisson

MAX_GOALS = 10  # minimum scoreline grid 0..10 per side
TAIL_TOL = 1e-10  # the grid grows until each side's Poisson tail beyond it is below this
GRID_CAP = 60  # if the tolerance still is not met here, the distribution is refused (R-18)


class InvalidCurvature(ValueError):
    """The Hessian at the optimum is materially non-positive-definite: no valid Laplace covariance exists (R-07)."""


@dataclass
class GoalsFit:
    teams: list[str]
    params: np.ndarray
    cov: np.ndarray | None
    n_matches: int
    effective_n: float
    xi: float
    ridge: float
    fit_rho: bool
    converged: bool
    nll: float
    league_avg_goals: float
    team_index: dict[str, int] = field(default_factory=dict)
    ridge_s: float | None = None
    ridge_t: float | None = None
    cov_reason: str | None = None
    finite: bool = True

    @property
    def usable(self) -> bool:
        """R-06: only a converged fit with finite parameters may publish."""
        return self.converged and self.finite

    # parameter layout: [mu, home_adv, rho, attack(n), defence(n)]
    @property
    def n_teams(self) -> int:
        return len(self.teams)

    def unpack(self, p: np.ndarray | None = None):
        p = self.params if p is None else p
        n = self.n_teams
        return p[0], p[1], p[2], p[3 : 3 + n], p[3 + n : 3 + 2 * n]

    def rates(self, home: str, away: str, p: np.ndarray | None = None) -> tuple[float, float]:
        mu, ha, _rho, att, dfn = self.unpack(p)
        h, a = self.team_index[home], self.team_index[away]
        return float(np.exp(mu + ha + att[h] + dfn[a])), float(np.exp(mu + att[a] + dfn[h]))

    def score_matrix(self, home: str, away: str, p: np.ndarray | None = None) -> np.ndarray:
        lam, mu_ = self.rates(home, away, p)
        rho = self.unpack(p)[2]
        return dc_matrix(lam, mu_, rho)

    def sample_params(self, n: int, rng: np.random.Generator) -> np.ndarray | None:
        # R-07: without a valid covariance there are no parameter draws (never repeat the point estimate).
        if self.cov is None:
            return None
        return rng.multivariate_normal(self.params, self.cov, size=n, check_valid="ignore", method="eigh")


def admissible_rho(lam: float, mu: float, rho: float) -> float:
    """Clamp rho into the range where all four Dixon-Coles factors are non-negative for these rates:
    max(-1/lam, -1/mu) <= rho <= min(1/(lam*mu), 1). Inside the range rho is returned unchanged."""
    lo = max(-1.0 / lam, -1.0 / mu)
    hi = min(1.0 / (lam * mu), 1.0)
    return float(min(max(rho, lo), hi))


def grid_size(lam: float, mu: float, max_goals: int = MAX_GOALS) -> int:
    """Smallest grid (>= max_goals) whose per-side Poisson tail mass is below TAIL_TOL."""
    k = max_goals
    while k < GRID_CAP and max(poisson.sf(k, lam), poisson.sf(k, mu)) > TAIL_TOL:
        k += 1
    if max(poisson.sf(k, lam), poisson.sf(k, mu)) > TAIL_TOL:
        raise ValueError(f"scoreline tail above tolerance even at {GRID_CAP} goals (rates {lam:.2f}, {mu:.2f})")
    return k


def dc_matrix(lam: float, mu: float, rho: float, max_goals: int = MAX_GOALS) -> np.ndarray:
    """Scoreline probability matrix M[h, a] with the Dixon-Coles correction.

    Rho is kept inside its admissible range (so no factor is negative and nothing is silently clipped), and
    the grid grows until the omitted tail is < TAIL_TOL per side, so the final renormalisation only removes
    numerically negligible mass."""
    rho = admissible_rho(lam, mu, rho)
    g = np.arange(grid_size(lam, mu, max_goals) + 1)
    m = np.outer(poisson.pmf(g, lam), poisson.pmf(g, mu))
    m[0, 0] *= 1 - lam * mu * rho
    m[0, 1] *= 1 + lam * rho
    m[1, 0] *= 1 + mu * rho
    m[1, 1] *= 1 - rho
    return m / m.sum()


def fit_goals(
    home: list[str],
    away: list[str],
    hg: np.ndarray,
    ag: np.ndarray,
    days_before_cutoff: np.ndarray,
    xi: float = 0.0019,
    ridge: float = 2.0,
    fit_rho: bool = True,
    with_uncertainty: bool = True,
    ridge_s: float | None = None,
    ridge_t: float | None = None,
) -> GoalsFit:
    """Fit by penalised weighted maximum likelihood (analytic gradient).

    days_before_cutoff >= 0 for every training match (leakage guard enforced by caller and asserted here).
    ridge_s/ridge_t: when given, replace the single ridge with separate shrinkage on quality (att-dfn)/2 and
    propensity (att+dfn)/2. ridge_s = ridge_t = 2*ridge reproduces the single-ridge fit exactly.
    """
    days = np.asarray(days_before_cutoff, dtype=float)
    if np.any(days < 0):
        raise ValueError("training data contains matches after the forecast cut-off (leakage)")
    teams = sorted(set(home) | set(away))
    idx = {t: i for i, t in enumerate(teams)}
    hi = np.array([idx[t] for t in home])
    ai = np.array([idx[t] for t in away])
    x = np.asarray(hg, dtype=float)
    y = np.asarray(ag, dtype=float)
    w = np.exp(-xi * days)
    n = len(teams)
    const = gammaln(x + 1) + gammaln(y + 1)
    split = ridge_s is not None and ridge_t is not None
    m00, m01, m10, m11 = (x == 0) & (y == 0), (x == 0) & (y == 1), (x == 1) & (y == 0), (x == 1) & (y == 1)

    def nll_grad(p):
        mu, ha, rho = p[0], p[1], p[2] if fit_rho else 0.0
        att, dfn = p[3 : 3 + n], p[3 + n :]
        log_lam = mu + ha + att[hi] + dfn[ai]
        log_lmu = mu + att[ai] + dfn[hi]
        lam, lmu = np.exp(log_lam), np.exp(log_lmu)
        tau = np.ones_like(lam)
        d_lam = np.zeros_like(lam); d_lmu = np.zeros_like(lam); d_rho = np.zeros_like(lam)  # d tau / d(log rate), d rho
        if fit_rho:
            tau[m00] = 1 - lam[m00] * lmu[m00] * rho
            d_lam[m00] = d_lmu[m00] = -lam[m00] * lmu[m00] * rho
            d_rho[m00] = -lam[m00] * lmu[m00]
            tau[m01] = 1 + lam[m01] * rho; d_lam[m01] = lam[m01] * rho; d_rho[m01] = lam[m01]
            tau[m10] = 1 + lmu[m10] * rho; d_lmu[m10] = lmu[m10] * rho; d_rho[m10] = lmu[m10]
            tau[m11] = 1 - rho; d_rho[m11] = -1.0
        # R-08: where a factor is clipped the objective is flat in it, so its derivative must be zero too.
        clipped = tau <= 1e-9
        if clipped.any():
            d_lam = np.where(clipped, 0.0, d_lam); d_lmu = np.where(clipped, 0.0, d_lmu); d_rho = np.where(clipped, 0.0, d_rho)
        tau = np.clip(tau, 1e-9, None)
        ll = x * log_lam - lam + y * log_lmu - lmu - const + np.log(tau)
        if split:
            q, t = (att - dfn) / 2, (att + dfn) / 2
            pen = 0.5 * ridge_s * (q @ q) + 0.5 * ridge_t * (t @ t)
            g_att, g_dfn = 0.5 * (ridge_s * q + ridge_t * t), 0.5 * (-ridge_s * q + ridge_t * t)
        else:
            pen = 0.5 * ridge * (att @ att + dfn @ dfn)
            g_att, g_dfn = ridge * att, ridge * dfn
        # soft sum-to-zero identifiability constraint
        pen += 50.0 * (att.sum() ** 2 + dfn.sum() ** 2)
        gl = w * (x - lam + d_lam / tau)
        gm = w * (y - lmu + d_lmu / tau)
        g = np.zeros_like(p)
        g[0] = -(gl.sum() + gm.sum())
        g[1] = -gl.sum()
        if fit_rho:
            g[2] = -np.sum(w * d_rho / tau)
        g[3 : 3 + n] = -(np.bincount(hi, gl, n) + np.bincount(ai, gm, n)) + g_att + 100.0 * att.sum()
        g[3 + n :] = -(np.bincount(ai, gl, n) + np.bincount(hi, gm, n)) + g_dfn + 100.0 * dfn.sum()
        return -np.sum(w * ll) + pen, g

    def nll(p):
        return nll_grad(p)[0]

    p0 = np.zeros(3 + 2 * n)
    p0[0] = np.log(max((x.mean() + y.mean()) / 2, 0.1))
    p0[1] = 0.2
    bounds = [(None, None), (-1, 1), (-0.2, 0.2) if fit_rho else (0.0, 0.0)] + [(-2.5, 2.5)] * (2 * n)
    res = minimize(nll_grad, p0, jac=True, method="L-BFGS-B", bounds=bounds, options={"maxiter": 3000})

    cov = None
    cov_reason: str | None = None if with_uncertainty else "uncertainty not requested"
    if with_uncertainty:
        free = [i for i in range(len(p0)) if not (i == 2 and not fit_rho)]
        H = _numeric_hessian(nll, res.x, free)
        try:
            cov_free = np.linalg.inv(H)
            cov_free = (cov_free + cov_free.T) / 2
            cov = np.zeros((len(p0), len(p0)))
            cov[np.ix_(free, free)] = cov_free
        except (np.linalg.LinAlgError, InvalidCurvature) as e:
            cov = None
            cov_reason = str(e) or "covariance unavailable"
        if cov is not None and not np.all(np.isfinite(cov)):
            cov, cov_reason = None, "covariance not finite"

    return GoalsFit(
        teams=teams,
        params=res.x,
        cov=cov,
        n_matches=len(x),
        effective_n=float(w.sum()),
        xi=xi,
        ridge=ridge,
        fit_rho=fit_rho,
        converged=bool(res.success),
        nll=float(res.fun),
        league_avg_goals=float(np.average(x + y, weights=w)),
        team_index=idx,
        ridge_s=ridge_s,
        ridge_t=ridge_t,
        cov_reason=cov_reason,
        finite=bool(np.all(np.isfinite(res.x))),
    )


def _numeric_hessian(f, x0: np.ndarray, free: list[int], eps: float = 1e-4) -> np.ndarray:
    k = len(free)
    H = np.zeros((k, k))
    fx = f(x0)
    for a in range(k):
        i = free[a]
        for b in range(a, k):
            j = free[b]
            xpp = x0.copy(); xpp[i] += eps; xpp[j] += eps
            xpm = x0.copy(); xpm[i] += eps; xpm[j] -= eps
            xmp = x0.copy(); xmp[i] -= eps; xmp[j] += eps
            xmm = x0.copy(); xmm[i] -= eps; xmm[j] -= eps
            if i == j:
                xp = x0.copy(); xp[i] += eps
                xm = x0.copy(); xm[i] -= eps
                H[a, a] = (f(xp) - 2 * fx + f(xm)) / eps**2
            else:
                H[a, b] = H[b, a] = (f(xpp) - f(xpm) - f(xmp) + f(xmm)) / (4 * eps**2)
    # R-07: floor only tiny eigenvalues (finite-difference noise); a materially negative one means no valid covariance.
    vals, vecs = np.linalg.eigh(H)
    scale = max(float(np.max(np.abs(vals))), 1e-12)
    if float(np.min(vals)) < -1e-4 * scale:
        raise InvalidCurvature(f"Hessian not positive definite (min eigenvalue {float(np.min(vals)):.3g})")
    vals = np.clip(vals, 1e-6, None)
    return vecs @ np.diag(vals) @ vecs.T
