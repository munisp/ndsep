"""Correctness tests for the Bayesian/MCMC layer (ml/bayesian/).

    pytest ml/tests/test_bayesian.py -v

Coverage:
- MCMC Beta-Binomial posterior mean ~= conjugate analytic mean
- Change-point detector recovers a planted change in a synthetic
  Poisson series
- R-hat ~= 1 on a converged Gaussian target
- Gamma-Poisson shrinkage pulls small-sample units toward the
  population mean while leaving high-count units near their raw rate
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))  # repo root on path

from ml.bayesian import mcmc, models


# --------------------------------------------------------------------------- #
# Sampler core
# --------------------------------------------------------------------------- #
def test_rhat_near_one_on_converged_gaussian():
    """4 chains on a standard normal: R-hat ~ 1, healthy ESS, sane mean/sd."""
    res = mcmc.adaptive_mh(lambda x: -0.5 * float(x[0] ** 2), np.array([0.0]),
                           n_samples=4000, n_chains=4, burn_in=2000, seed=7)
    assert abs(res.rhat[0] - 1.0) < 0.02
    assert res.ess[0] > 1000
    flat = res.flat()[:, 0]
    assert abs(flat.mean()) < 0.06
    assert abs(flat.std() - 1.0) < 0.06
    # adaptive acceptance should land in a sane MH band around the target
    assert 0.1 < res.accept_rate.mean() < 0.5


def test_hdi_of_gaussian_matches_theory():
    rng = np.random.default_rng(0)
    x = rng.normal(0.0, 1.0, size=200_000)
    lo, hi = mcmc.hdi(x, 0.95)
    assert abs(lo - (-1.96)) < 0.03
    assert abs(hi - 1.96) < 0.03


def test_sampler_is_seedable():
    f = lambda x: -0.5 * float(x[0] ** 2)  # noqa: E731
    a = mcmc.adaptive_mh(f, np.array([0.0]), n_samples=200, n_chains=2,
                         burn_in=200, seed=123)
    b = mcmc.adaptive_mh(f, np.array([0.0]), n_samples=200, n_chains=2,
                         burn_in=200, seed=123)
    np.testing.assert_array_equal(a.samples, b.samples)


# --------------------------------------------------------------------------- #
# A. Beta-Binomial
# --------------------------------------------------------------------------- #
def test_beta_binomial_mcmc_matches_conjugate():
    k, n, a0, b0 = 45, 10_000, 1.0, 300.0
    res = models.beta_binomial_rates([k], [n], alpha=a0, beta=b0, seed=3)
    entry = res["sectors"][0]
    analytic_mean = (a0 + k) / (a0 + b0 + n)
    assert entry["posterior_mean"] == pytest.approx(analytic_mean, rel=1e-9)
    # MCMC cross-check agrees with the conjugate answer
    assert entry["mcmc_check"]["mcmc_mean"] == pytest.approx(
        analytic_mean, abs=2e-4)
    assert entry["mcmc_check"]["rhat"] < 1.05
    # HDI brackets the analytic mean
    lo, hi = entry["hdi_95"]
    assert lo < analytic_mean < hi


def test_beta_binomial_prior_pulls_sparse_sector():
    """A sector with 0 frauds in 50 tx should sit far below its prior mean
    but must not collapse to a hard zero."""
    res = models.beta_binomial_rates([0], [50], run_mcmc=False)
    pm = res["sectors"][0]["posterior_mean"]
    assert 0.0 < pm < 1.0 / 301.0  # below prior mean, still positive


# --------------------------------------------------------------------------- #
# B. Poisson change-point
# --------------------------------------------------------------------------- #
def test_changepoint_recovers_planted_location():
    rng = np.random.default_rng(11)
    T, planted = 60, 30
    y = np.concatenate([rng.poisson(3.0, planted),
                        rng.poisson(8.0, T - planted)])
    res = models.poisson_changepoint(y, seed=5)
    assert abs(res["map_tau"] - planted) <= 3
    assert abs(res["mean_tau"] - planted) <= 3
    assert res["p_lam2_gt_lam1"] > 0.99
    assert res["lam1"]["mean"] == pytest.approx(3.0, abs=1.0)
    assert res["lam2"]["mean"] == pytest.approx(8.0, abs=1.5)
    # tau posterior is a proper distribution over the grid
    assert np.sum(res["tau_posterior"]) == pytest.approx(1.0)
    assert len(res["taus"]) == T - 1


def test_changepoint_no_planted_change_is_diffuse():
    """Pure-homogeneous series: detector should not be confident about
    any single location or a direction."""
    rng = np.random.default_rng(2)
    y = rng.poisson(5.0, 50)
    res = models.poisson_changepoint(y, seed=6)
    assert 0.3 < res["p_lam2_gt_lam1"] < 0.7
    # posterior mass on the single MAP location stays modest
    assert max(res["tau_posterior"]) < 0.3


# --------------------------------------------------------------------------- #
# C. Gamma-Poisson shrinkage
# --------------------------------------------------------------------------- #
def test_shrinkage_pulls_small_samples_toward_population():
    """Population rate ~0.2/event exposure; a unit with 1 event in 2
    exposure (raw 0.5) must shrink toward 0.2, while a unit with 20 in
    100 (raw 0.2) stays put."""
    rng = np.random.default_rng(9)
    n_units = 40
    exposure = np.full(n_units + 2, 50.0)
    true_rates = rng.gamma(4.0, 1.0 / 20.0, n_units)  # mean 0.2
    counts = rng.poisson(true_rates * exposure[:n_units]).astype(float)
    counts = np.concatenate([counts, [1.0], [20.0]])
    exposure[-2:] = [2.0, 100.0]

    res = models.gamma_poisson_shrinkage(counts, exposure)
    pop_mean = res["population"]["mean_rate"]
    small, large = res["units"][-2], res["units"][-1]
    # small-sample unit: posterior strictly between raw rate and pop mean
    assert pop_mean < small["posterior_mean"] < small["raw_rate"]
    # high-count unit: posterior close to its raw rate
    assert large["posterior_mean"] == pytest.approx(large["raw_rate"],
                                                    rel=0.25)


def test_shrinkage_flags_genuine_outlier():
    rng = np.random.default_rng(13)
    exposure = np.full(31, 50.0)
    rates = np.concatenate([rng.gamma(4.0, 1.0 / 20.0, 30), [1.5]])
    counts = rng.poisson(rates * exposure)
    res = models.gamma_poisson_shrinkage(counts, exposure)
    assert res["units"][-1]["flagged"] is True
    assert res["n_flagged"] >= 1
    assert res["population"]["bound_99pct"] > res["population"]["mean_rate"]
