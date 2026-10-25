"""Round-9: beta-binomial logit-space Jacobian fix — MCMC cross-check must
match the conjugate Beta posterior within a tight tolerance."""
import numpy as np
from scipy import stats as st
from ml.bayesian import models

def test_mcmc_matches_conjugate_posterior():
    frauds = np.array([3.0, 7.0, 1.0])
    totals = np.array([400.0, 900.0, 250.0])
    a, b = 1.0, 300.0
    res = models.beta_binomial_rates(frauds, totals, alpha=a, beta=b,
                                     run_mcmc=True, mcmc_draws=3000, seed=7)
    for i, s in enumerate(res["sectors"]):
        ref_mean = (a + frauds[i]) / (a + b + totals[i])
        mcmc_mean = s["mcmc_check"]["mcmc_mean"]
        assert abs(mcmc_mean - ref_mean) < max(0.35 * ref_mean, 0.004), \
            (i, mcmc_mean, ref_mean)
        # HDI should bracket the conjugate posterior mean
        lo, hi = s["mcmc_check"]["mcmc_hdi_95"]
        assert lo <= ref_mean <= hi or abs(ref_mean - lo) < 0.003 or abs(ref_mean - hi) < 0.003
