"""Penalised negative-binomial (NB2) count regression for corners and yellow cards.

Var(Y) = mu + alpha * mu^2. Team/referee effects are L2-shrunk towards the league mean,
which matters because referee and per-team samples are small. Time-decay weights are
applied exactly as in the goals model.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize
from scipy.special import gammaln
from scipy.stats import nbinom

from .goals import _numeric_hessian


@dataclass
class NBFit:
    columns: list[str]
    beta: np.ndarray
    log_alpha: float
    cov: np.ndarray | None
    n_obs: int
    effective_n: float
    converged: bool
    observed_mean: float
    observed_var: float

    @property
    def alpha(self) -> float:
        return float(np.exp(self.log_alpha))

    def mean(self, xrow: np.ndarray, beta: np.ndarray | None = None) -> float:
        b = self.beta if beta is None else beta
        return float(np.exp(xrow @ b))

    def sample(self, n: int, rng: np.random.Generator) -> np.ndarray | None:
        full = np.concatenate([self.beta, [self.log_alpha]])
        if self.cov is None:
            return None  # R-07: no covariance, no draws
        return rng.multivariate_normal(full, self.cov, size=n, check_valid="ignore", method="eigh")


def nb_pmf(k: np.ndarray, mu: float, alpha: float) -> np.ndarray:
    r = 1.0 / alpha
    p = r / (r + mu)
    return nbinom.pmf(k, r, p)


def fit_nb(
    X: np.ndarray,
    y: np.ndarray,
    weights: np.ndarray,
    columns: list[str],
    penalised: np.ndarray,
    ridge: float = 4.0,
    with_uncertainty: bool = True,
) -> NBFit:
    """X includes an intercept column. `penalised` is a boolean mask over columns."""
    y = np.asarray(y, dtype=float)
    w = np.asarray(weights, dtype=float)
    k = X.shape[1]

    def nll(p):
        beta, la = p[:k], p[k]
        alpha = np.exp(la)
        r = 1.0 / alpha
        eta = np.clip(X @ beta, -10, 10)
        mu = np.exp(eta)
        ll = gammaln(y + r) - gammaln(r) - gammaln(y + 1) + r * np.log(r / (r + mu)) + y * np.log(mu / (r + mu))
        pen = 0.5 * ridge * np.sum((beta * penalised) ** 2)
        return -np.sum(w * ll) + pen

    p0 = np.zeros(k + 1)
    p0[0] = np.log(max(np.average(y, weights=w), 0.1))
    p0[k] = np.log(0.1)
    bounds = [(None, None)] * k + [(np.log(1e-4), np.log(5.0))]
    res = minimize(nll, p0, method="L-BFGS-B", bounds=bounds, options={"maxiter": 3000})

    cov = None
    if with_uncertainty:
        free = list(range(k + 1))
        try:
            H = _numeric_hessian(nll, res.x, free)
            cov = np.linalg.inv(H)
            cov = (cov + cov.T) / 2
        except (np.linalg.LinAlgError, ValueError):
            cov = None
        if cov is not None and not np.all(np.isfinite(cov)):
            cov = None

    return NBFit(
        columns=columns,
        beta=res.x[:k],
        log_alpha=float(res.x[k]),
        cov=cov,
        n_obs=len(y),
        effective_n=float(w.sum()),
        converged=bool(res.success),
        observed_mean=float(np.average(y, weights=w)),
        observed_var=float(np.average((y - np.average(y, weights=w)) ** 2, weights=w)),
    )


def fold_tail(pmf: np.ndarray) -> np.ndarray:
    """R-18: put all omitted upper-tail mass into the last bucket ("N or more") instead of renormalising it away, so
    every over/under threshold below the last bucket keeps its exact probability."""
    out = np.clip(np.asarray(pmf, dtype=float), 0, None).copy()
    out[-1] += max(0.0, 1.0 - float(out.sum()))
    return out


def convolve_pmfs(a: np.ndarray, b: np.ndarray, size: int) -> np.ndarray:
    full = np.convolve(fold_tail(a), fold_tail(b))
    out = full[:size].copy()
    out[-1] += float(full[size:].sum())
    return out
