"""Bayesian inference layer for the NDSEP ML stack.

Pure numpy/scipy MCMC (adaptive Metropolis-Hastings) plus three
platform-relevant Bayesian models:

- Beta-Binomial per-sector fraud base-rate estimation
- Single change-point detection on compliance-violation count series
- Gamma-Poisson shrinkage for per-unit insider-risk event rates

This is *posterior inference* (what do we believe about latent rates
given observed data?), distinct from the Rust `workers/rust/monte_carlo`
engine, which is *forward scenario simulation* (what could happen under
assumed inputs?).
"""

from ml.bayesian import mcmc, models  # noqa: F401
