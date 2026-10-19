"""Dixon-Coles goals model with exponential time decay and ridge shrinkage.

log(lambda_home) = mu + home_adv + attack[home] + defence[away]
log(lambda_away) = mu +            attack[away] + defence[home]
with the Dixon-Coles low-score correction tau(x, y; rho).

The same class (rho fixed to 0, stronger shrinkage) is reused for first-half goals.
Uncertainty: Laplace approximation (numerical Hessian at the MAP), parameter sampling.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import minimize
from scipy.special import gammaln
from scipy.stats import poisson

MAX_GOALS = 10  # scoreline grid 0..10 per side; mass beyond is negligible for football rates


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

    def sample_params(self, n: int, rng: np.random.Generator) -> np.ndarray:
        if self.cov is None:
            return np.repeat(self.params[None, :], n, axis=0)
        return rng.multivariate_normal(self.params, self.cov, size=n, check_valid="ignore", method="eigh")


def dc_matrix(lam: float, mu: float, rho: float, max_goals: int = MAX_GOALS) -> np.ndarray:
    """Scoreline probability matrix M[h, a] with Dixon-Coles correction, normalised to sum 1."""
    g = np.arange(max_goals + 1)
    m = np.outer(poisson.pmf(g, lam), poisson.pmf(g, mu))
    m[0, 0] *= max(1 - lam * mu * rho, 1e-9)
    m[0, 1] *= max(1 + lam * rho, 1e-9)
    m[1, 0] *= max(1 + mu * rho, 1e-9)
    m[1, 1] *= max(1 - rho, 1e-9)
    return m / m.sum()


def _tau_log(x, y, lam, mu, rho):
    t = np.ones_like(lam)
    t = np.where((x == 0) & (y == 0), 1 - lam * mu * rho, t)
    t = np.where((x == 0) & (y == 1), 1 + lam * rho, t)
    t = np.where((x == 1) & (y == 0), 1 + mu * rho, t)
    t = np.where((x == 1) & (y == 1), 1 - rho, t)
    return np.log(np.clip(t, 1e-9, None))


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
) -> GoalsFit:
    """Fit by penalised weighted maximum likelihood.

    days_before_cutoff >= 0 for every training match (leakage guard enforced by caller and asserted here).
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

    def nll(p):
        mu, ha, rho = p[0], p[1], p[2] if fit_rho else 0.0
        att, dfn = p[3 : 3 + n], p[3 + n :]
        lam = np.exp(mu + ha + att[hi] + dfn[ai])
        lmu = np.exp(mu + att[ai] + dfn[hi])
        ll = x * np.log(lam) - lam + y * np.log(lmu) - lmu - const
        if fit_rho:
            ll = ll + _tau_log(x, y, lam, lmu, rho)
        pen = 0.5 * ridge * (np.sum(att**2) + np.sum(dfn**2))
        # soft sum-to-zero identifiability constraint
        pen += 50.0 * (att.sum() ** 2 + dfn.sum() ** 2)
        return -np.sum(w * ll) + pen

    p0 = np.zeros(3 + 2 * n)
    p0[0] = np.log(max((x.mean() + y.mean()) / 2, 0.1))
    p0[1] = 0.2
    bounds = [(None, None), (-1, 1), (-0.2, 0.2) if fit_rho else (0.0, 0.0)] + [(-2.5, 2.5)] * (2 * n)
    res = minimize(nll, p0, method="L-BFGS-B", bounds=bounds, options={"maxiter": 2000})

    cov = None
    if with_uncertainty:
        free = [i for i in range(len(p0)) if not (i == 2 and not fit_rho)]
        H = _numeric_hessian(nll, res.x, free)
        try:
            cov_free = np.linalg.inv(H)
            cov_free = (cov_free + cov_free.T) / 2
            cov = np.zeros((len(p0), len(p0)))
            cov[np.ix_(free, free)] = cov_free
        except np.linalg.LinAlgError:
            cov = None

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
    # Regularise tiny negative eigenvalues from numerical noise
    vals, vecs = np.linalg.eigh(H)
    vals = np.clip(vals, 1e-6, None)
    return vecs @ np.diag(vals) @ vecs.T
