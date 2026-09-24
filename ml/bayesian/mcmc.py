"""Core MCMC sampler library (pure numpy/scipy, CPU-only, seedable).

Implements adaptive random-walk Metropolis-Hastings:

- Multiple chains (>= 2) run jointly; per-chain Gaussian proposal scales.
- Robbins-Monro scale adaptation during burn-in targeting ~0.234
  acceptance (optimal for random-walk Metropolis in high dim; a sane
  default in low dim too).
- Burn-in and thinning.
- Convergence diagnostics: split-R-hat (Gelman-Rubin) and effective
  sample size (ESS) via autocorrelation with an initial-positive-sequence
  cutoff.
- Posterior summaries: mean, median, sd, and 95% highest-density
  intervals (HDI).

Design notes
------------
``logpost`` must accept a 1-D float array of length ``dim`` and return a
scalar log-posterior (up to an additive constant); return ``-np.inf``
outside the support. Chains are stepped together so per-iteration RNG is
vectorized; the per-chain ``logpost`` calls are Python loops (cheap for
the small models in ``ml/bayesian/models.py``).

No NUTS/HMC here: numpyro is optional and absent in this environment.
Correlated posteriors mix slowly under random-walk MH — reparameterize
(e.g. log-transform rates) and check R-hat/ESS before trusting results.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

TARGET_ACCEPT = 0.234


@dataclass
class MCMCResult:
    """Container for a sampling run.

    samples: (n_kept, n_chains, dim) post-burn-in, thinned draws.
    accept_rate: per-chain acceptance over the whole run.
    proposal_scale: final per-chain proposal scales.
    rhat / ess: per-dimension convergence diagnostics.
    """
    samples: np.ndarray
    accept_rate: np.ndarray
    proposal_scale: np.ndarray
    rhat: np.ndarray = field(default=None)
    ess: np.ndarray = field(default=None)
    param_names: list = field(default=None)

    def flat(self) -> np.ndarray:
        """All chains flattened: (n_kept * n_chains, dim)."""
        n, c, d = self.samples.shape
        return self.samples.reshape(n * c, d)

    def summary(self, prob: float = 0.95) -> list[dict]:
        return summarize(self.samples, prob=prob, names=self.param_names)


def adaptive_mh(logpost, x0, n_samples: int = 4000, n_chains: int = 4,
                burn_in: int = 2000, thin: int = 1, proposal_scale=None,
                target_accept: float = TARGET_ACCEPT, adapt_window: int = 50,
                seed: int | None = None, param_names: list | None = None,
                jitter: float = 1.0) -> MCMCResult:
    """Adaptive random-walk Metropolis-Hastings with multiple chains.

    Parameters
    ----------
    logpost : callable(x: (dim,) float) -> float
    x0 : (dim,) array-like starting point (chains are jittered around it)
    n_samples : kept draws per chain after burn-in/thinning
    n_chains : number of independent chains (>= 2 recommended)
    burn_in : iterations discarded per chain (adaptation active here)
    thin : keep every `thin`-th post-burn-in draw
    proposal_scale : scalar or (dim,) initial proposal std; default 0.1*|x0|+0.1
    target_accept : Robbins-Monro target acceptance (default 0.234)
    adapt_window : iterations between scale updates during burn-in
    seed : RNG seed (numpy default_rng)
    jitter : multiplicative spread of chain starting points around x0
    """
    rng = np.random.default_rng(seed)
    x0 = np.asarray(x0, dtype=float)
    dim = x0.size
    if proposal_scale is None:
        scale0 = 0.1 * np.abs(x0) + 0.1
    else:
        scale0 = np.broadcast_to(np.asarray(proposal_scale, dtype=float), (dim,))
    # Over-dispersed starting points across chains
    state = x0[None, :] * np.exp(rng.normal(0.0, 0.1 * jitter,
                                            size=(n_chains, dim)))
    scale = np.tile(scale0, (n_chains, 1))
    logp = np.array([logpost(state[c]) for c in range(n_chains)])

    total_iters = burn_in + n_samples * thin
    kept = np.empty((n_samples, n_chains, dim))
    accepts = np.zeros(n_chains)
    window_accepts = np.zeros(n_chains)
    keep_i = 0
    adapt_step = 0

    for it in range(total_iters):
        prop = state + scale * rng.standard_normal((n_chains, dim))
        prop_logp = np.array([logpost(prop[c]) for c in range(n_chains)])
        log_alpha = prop_logp - logp
        accept = np.log(rng.random(n_chains)) < np.minimum(0.0, log_alpha)
        # -inf - (-inf) -> nan comparisons are False, so stale -inf chains
        # would freeze; force-move them to any finite proposal.
        nan_mask = np.isnan(log_alpha) & np.isfinite(prop_logp)
        accept |= nan_mask
        state[accept] = prop[accept]
        logp[accept] = prop_logp[accept]
        accepts += accept
        window_accepts += accept

        # Robbins-Monro scale adaptation during burn-in only
        if it < burn_in and (it + 1) % adapt_window == 0:
            adapt_step += 1
            gamma = min(1.0, 2.0 * adapt_step ** -0.6)  # decays ~ t^-0.6
            rate = (window_accepts / adapt_window)[:, None]
            log_scale = np.log(scale) + gamma * (rate - target_accept)
            scale = np.exp(np.clip(log_scale, -12.0, 5.0))
            window_accepts[:] = 0.0

        if it >= burn_in and (it - burn_in + 1) % thin == 0:
            kept[keep_i] = state
            keep_i += 1

    result = MCMCResult(samples=kept, accept_rate=accepts / total_iters,
                        proposal_scale=scale, param_names=param_names)
    result.rhat = rhat(kept)
    result.ess = ess(kept)
    return result


# --------------------------------------------------------------------------- #
# Diagnostics
# --------------------------------------------------------------------------- #
def rhat(samples: np.ndarray) -> np.ndarray:
    """Split-R-hat (Gelman-Rubin) per dimension.

    samples: (n, chains, dim). Values near 1.0 (< 1.01 ideal, < 1.1 ok)
    indicate convergence; larger means chains disagree.
    """
    n, c, d = samples.shape
    half = n // 2
    if half < 2:
        return np.full(d, np.nan)
    split = np.concatenate([samples[:half], samples[half:2 * half]], axis=1)
    n2, c2, _ = split.shape
    chain_means = split.mean(axis=0)          # (c2, d)
    chain_vars = split.var(axis=0, ddof=1)    # (c2, d)
    W = chain_vars.mean(axis=0)
    B = n2 * chain_means.var(axis=0, ddof=1)
    var_hat = (n2 - 1) / n2 * W + B / n2
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.sqrt(var_hat / W)
    r[W == 0] = np.nan
    return r


def _autocorr_1d(x: np.ndarray) -> np.ndarray:
    """Biased autocorrelation via FFT, lags 0..n-1."""
    n = x.size
    x = x - x.mean()
    nfft = 1 << (2 * n - 1).bit_length()
    f = np.fft.rfft(x, nfft)
    ac = np.fft.irfft(f * np.conjugate(f), nfft)[:n]
    ac /= ac[0] * np.arange(n, 0, -1) / n
    return ac


def ess(samples: np.ndarray) -> np.ndarray:
    """Effective sample size per dimension.

    samples: (n, chains, dim). Uses the mean autocorrelation across
    chains with Geyer's initial positive-sequence cutoff.
    """
    n, c, d = samples.shape
    if n < 4:
        return np.full(d, np.nan)
    out = np.empty(d)
    for j in range(d):
        rho = np.mean([_autocorr_1d(samples[:, k, j]) for k in range(c)],
                      axis=0)
        # initial positive sequence: sum pairs until a pair goes negative
        t = 0.0
        for lag in range(1, n - 1, 2):
            pair = rho[lag] + rho[lag + 1]
            if pair < 0:
                break
            t += pair
        tau = max(1.0, 1.0 + 2.0 * t)
        out[j] = min(n * c, n * c / tau)
    return out


def hdi(x: np.ndarray, prob: float = 0.95) -> tuple[float, float]:
    """Highest-density interval of a 1-D sample (shortest prob-mass span)."""
    x = np.sort(np.asarray(x).ravel())
    n = x.size
    k = int(np.floor(prob * n))
    k = min(max(k, 1), n - 1)
    widths = x[k:] - x[:n - k]
    i = int(np.argmin(widths))
    return float(x[i]), float(x[i + k])


def summarize(samples: np.ndarray, prob: float = 0.95,
              names: list | None = None) -> list[dict]:
    """Posterior mean/median/sd/HDI per dimension.

    samples: (n, chains, dim) or (n, dim).
    """
    if samples.ndim == 3:
        n, c, d = samples.shape
        flat = samples.reshape(n * c, d)
    else:
        flat = np.atleast_2d(samples.T).T if samples.ndim == 1 else samples
        d = flat.shape[1]
    names = names or [f"theta[{j}]" for j in range(d)]
    out = []
    for j in range(d):
        col = flat[:, j]
        lo, hi = hdi(col, prob)
        out.append({
            "param": names[j],
            "mean": float(col.mean()),
            "median": float(np.median(col)),
            "sd": float(col.std(ddof=1)),
            f"hdi_{int(prob * 100)}": [lo, hi],
        })
    return out
