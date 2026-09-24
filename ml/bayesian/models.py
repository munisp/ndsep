"""Platform-relevant Bayesian models for NDSEP (Nigeria NDPC).

Three models, each answering a concrete regulatory question with
credible intervals rather than point estimates:

A. ``beta_binomial_rates`` — per-sector fraud base-rate estimation.
   "Which sectors have genuinely elevated fraud?" Conjugate Beta
   posterior is analytic; the adaptive-MH sampler cross-checks it.

B. ``poisson_changepoint`` — single change-point detection on a
   compliance-violation count series. "Did the violation regime shift
   (e.g. after an enforcement campaign)?" Poisson rates before/after,
   discrete uniform prior on the change location; the tau posterior is
   computed exactly on a grid (conjugate rate marginals), with MH
   cross-checking the rate posteriors.

C. ``gamma_poisson_shrinkage`` — hierarchical-ish insider-risk model.
   Per-unit event counts with exposures; empirical-Bayes Gamma
   population prior shrinks low-count units toward the population mean.
   "Which officers/units have genuinely elevated event rates?" Flags
   units whose posterior mean exceeds the 99% population bound.

All functions are pure numpy/scipy and seedable.
"""

from __future__ import annotations

import numpy as np
from scipy.special import gammaln
from scipy.stats import beta as beta_dist
from scipy.stats import gamma as gamma_dist

from ml.bayesian import mcmc


# --------------------------------------------------------------------------- #
# A. Beta-Binomial fraud base rate
# --------------------------------------------------------------------------- #
def beta_binomial_rates(frauds, totals, alpha: float = 1.0, beta: float = 300.0,
                        run_mcmc: bool = True, seed: int = 42,
                        mcmc_draws: int = 4000) -> dict:
    """Posterior fraud rate per sector given observed frauds/transactions.

    frauds, totals : array-like per-sector counts.
    alpha, beta : prior Beta(a, b) on each sector rate. Default
        Beta(1, 300) — weakly informative around a ~0.3% base rate,
        matching the generator's fraud_rate and Nigeria's observed
        order of magnitude.

    Returns per-sector analytic posterior (Beta params, mean, 95% HDI)
    plus an MCMC cross-check (sampled mean, R-hat, ESS) on logit(p).
    """
    frauds = np.asarray(frauds, dtype=float)
    totals = np.asarray(totals, dtype=float)
    if np.any(frauds > totals):
        raise ValueError("frauds cannot exceed totals")
    a_post = alpha + frauds
    b_post = beta + (totals - frauds)

    rng = np.random.default_rng(seed)
    sectors = []
    for i in range(len(frauds)):
        # HDI from a large seeded draw of the analytic Beta posterior
        # (the equal-tail interval is nearly identical here but HDI is
        # what we report everywhere else, so keep the definition uniform)
        draws = rng.beta(a_post[i], b_post[i], size=200_000)
        lo, hi = mcmc.hdi(draws, 0.95)
        entry = {
            "n_transactions": int(totals[i]),
            "n_fraud": int(frauds[i]),
            "alpha_post": float(a_post[i]),
            "beta_post": float(b_post[i]),
            "posterior_mean": float(a_post[i] / (a_post[i] + b_post[i])),
            "posterior_median": float(beta_dist.median(a_post[i], b_post[i])),
            "hdi_95": [float(lo), float(hi)],
            "raw_rate": float(frauds[i] / totals[i]) if totals[i] else None,
        }
        sectors.append(entry)

    result = {"prior": {"alpha": alpha, "beta": beta}, "sectors": sectors}

    if run_mcmc:
        # Cross-check on logit scale: logit p ~ N via adaptive MH.
        checks = []
        for i in range(len(frauds)):
            def logpost_eta(eta, k=frauds[i], n=totals[i]):
                e = float(eta[0])
                if not np.isfinite(e):
                    return -np.inf
                # log posterior of eta=logit(p): binomial likelihood
                # k*eta - n*log1p(exp(eta)) + beta prior on p + Jacobian
                ll = k * e - n * np.logaddexp(0.0, e)
                # prior Beta(a,b) on p -> density in eta: p^a (1-p)^b * p(1-p) / B
                lp = -np.logaddexp(0.0, -e)        # log p
                lq = -np.logaddexp(0.0, e)         # log (1-p)
                return ll + alpha * lp + beta * lq + lp + lq

            eta0 = np.log((frauds[i] + 0.5) / (totals[i] - frauds[i] + 0.5))
            res = mcmc.adaptive_mh(logpost_eta, np.array([eta0]),
                                   n_samples=mcmc_draws, n_chains=4,
                                   burn_in=2000, seed=seed + i,
                                   param_names=["logit_p"])
            p_samples = 1.0 / (1.0 + np.exp(-res.flat()[:, 0]))
            checks.append({
                "mcmc_mean": float(p_samples.mean()),
                "mcmc_hdi_95": list(mcmc.hdi(p_samples, 0.95)),
                "rhat": float(res.rhat[0]),
                "ess": float(res.ess[0]),
                "accept_rate": float(res.accept_rate.mean()),
            })
        for s, c in zip(sectors, checks):
            s["mcmc_check"] = c
    return result


# --------------------------------------------------------------------------- #
# B. Poisson change-point on a violation count series
# --------------------------------------------------------------------------- #
def _log_marginal_poisson(y: np.ndarray, a: float, b: float) -> float:
    """log p(y) with lambda ~ Gamma(a, b) (b = rate) marginalized out."""
    n = y.size
    s = y.sum()
    return float(gammaln(a + s) - gammaln(a) + a * np.log(b)
                 - (a + s) * np.log(b + n) - gammaln(y + 1).sum())


def poisson_changepoint(counts, a: float = 1.0, b: float = 0.2,
                        seed: int = 42, n_rate_draws: int = 20000) -> dict:
    """Single change-point in a Poisson count series.

    counts : 1-D array-like of per-period event counts (e.g. weekly
        compliance violations).
    Model: y_t ~ Poisson(lam1) for t <= tau, Poisson(lam2) for t > tau.
    Priors: tau ~ DiscreteUniform{1..T-1}, lam_i ~ Gamma(a, b).

    The tau posterior is exact: p(tau | y) ∝ p(y_1:tau) * p(y_tau+1:T)
    with conjugate Gamma-Poisson marginals. Rate posteriors are sampled
    by drawing tau from its grid posterior then lam_i | tau, y from the
    conditional Gammas.

    Returns posterior over tau (full grid), MAP change-point, posterior
    mean/median tau, P(lam2 > lam1), and rate summaries.
    """
    y = np.asarray(counts, dtype=float).ravel()
    T = y.size
    if T < 4:
        raise ValueError("need at least 4 periods for a change-point")
    taus = np.arange(1, T)  # change after index tau-1 (1..T-1)
    log_m1 = np.array([_log_marginal_poisson(y[:t], a, b) for t in taus])
    log_m2 = np.array([_log_marginal_poisson(y[t:], a, b) for t in taus])
    log_post = log_m1 + log_m2  # uniform prior on tau -> constant offset
    log_post -= np.max(log_post)
    post = np.exp(log_post)
    post /= post.sum()

    map_tau = int(taus[int(np.argmax(post))])
    mean_tau = float((taus * post).sum())
    cdf = np.cumsum(post)
    median_tau = int(taus[int(np.searchsorted(cdf, 0.5))])
    ci_lo = int(taus[int(np.searchsorted(cdf, 0.025))])
    ci_hi = int(taus[min(int(np.searchsorted(cdf, 0.975)), T - 2)])

    # Draw rates conditional on tau drawn from the grid posterior
    rng = np.random.default_rng(seed)
    tau_draws = rng.choice(taus, size=n_rate_draws, p=post)
    lam1 = np.empty(n_rate_draws)
    lam2 = np.empty(n_rate_draws)
    for i, t in enumerate(tau_draws):
        y1, y2 = y[:t], y[t:]
        lam1[i] = rng.gamma(a + y1.sum(), 1.0 / (b + y1.size))
        lam2[i] = rng.gamma(a + y2.sum(), 1.0 / (b + y2.size))

    return {
        "T": T,
        "taus": taus.tolist(),
        "tau_posterior": post.tolist(),
        "map_tau": map_tau,
        "mean_tau": mean_tau,
        "median_tau": median_tau,
        "tau_hdi_95_grid": [ci_lo, ci_hi],
        "p_lam2_gt_lam1": float((lam2 > lam1).mean()),
        "lam1": {"mean": float(lam1.mean()),
                 "hdi_95": list(mcmc.hdi(lam1, 0.95))},
        "lam2": {"mean": float(lam2.mean()),
                 "hdi_95": list(mcmc.hdi(lam2, 0.95))},
        "prior": {"rate_gamma_a": a, "rate_gamma_b": b,
                  "tau": "discrete-uniform"},
    }


# --------------------------------------------------------------------------- #
# C. Gamma-Poisson shrinkage (insider-risk style)
# --------------------------------------------------------------------------- #
def _fit_population_gamma(counts: np.ndarray, exposures: np.ndarray
                          ) -> tuple[float, float]:
    """Empirical-Bayes Gamma(a, b) population prior via method of moments.

    y_i ~ Poisson(lam_i * t_i), lam_i ~ Gamma(a, b) (b = rate).
    E[r_i] = a/b and Var[r_i] = a/b^2 + (a/b)/t_i for r_i = y_i/t_i,
    so the between-unit rate variance is the sample variance of r_i
    minus the average Poisson noise floor mu/t_i (floored to keep the
    prior proper when counts are Poisson-homogeneous).
    """
    mu_hat = counts.sum() / exposures.sum()          # pooled mean rate
    r = counts / exposures
    var_raw = float(r.var(ddof=1)) if r.size > 1 else 0.0
    noise = float((mu_hat / exposures).mean())
    var_between = max(var_raw - noise, 0.01 * mu_hat ** 2 + 1e-12)
    a = mu_hat ** 2 / var_between
    b = mu_hat / var_between
    return float(a), float(b)


def gamma_poisson_shrinkage(counts, exposures, alpha0: float | None = None,
                            beta0: float | None = None,
                            flag_quantile: float = 0.99) -> dict:
    """Shrink per-unit event rates toward the population mean.

    counts : per-unit event counts (e.g. insider-risk events per officer).
    exposures : per-unit exposure (transactions handled, months active).
    alpha0/beta0 : optional fixed population Gamma(a, b) prior; if None,
        estimated by empirical Bayes (method of moments).

    Posterior per unit: lam_i | y_i ~ Gamma(a + y_i, b + t_i).
    A unit is flagged when its posterior mean exceeds the
    `flag_quantile` quantile of the *population* Gamma(a, b) — i.e. it
    sits above the 99% credible bound for a typical officer.
    """
    counts = np.asarray(counts, dtype=float)
    exposures = np.asarray(exposures, dtype=float)
    if counts.shape != exposures.shape:
        raise ValueError("counts and exposures must align")
    if np.any(exposures <= 0):
        raise ValueError("exposures must be positive")
    if alpha0 is None or beta0 is None:
        a, b = _fit_population_gamma(counts, exposures)
    else:
        a, b = float(alpha0), float(beta0)

    a_post = a + counts
    b_post = b + exposures
    post_mean = a_post / b_post
    pop_bound = float(gamma_dist.ppf(flag_quantile, a, scale=1.0 / b))
    raw_rate = counts / exposures
    pop_mean = a / b

    units = []
    for i in range(len(counts)):
        lo, hi = gamma_dist.ppf([0.025, 0.975], a_post[i],
                                scale=1.0 / b_post[i])
        units.append({
            "events": int(counts[i]),
            "exposure": float(exposures[i]),
            "raw_rate": float(raw_rate[i]),
            "posterior_mean": float(post_mean[i]),
            "hdi_95": [float(lo), float(hi)],
            "shrinkage": float(post_mean[i] - raw_rate[i]),
            "flagged": bool(post_mean[i] > pop_bound),
        })
    return {
        "population": {"gamma_a": a, "gamma_b": b,
                       "mean_rate": float(pop_mean),
                       f"bound_{int(flag_quantile * 100)}pct": pop_bound},
        "units": units,
        "n_flagged": int(sum(u["flagged"] for u in units)),
    }
