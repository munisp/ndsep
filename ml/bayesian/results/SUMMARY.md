# Bayesian/MCMC analysis — NDSEP

Data source: generator fallback, seed=42 (lakehouse unreadable: Unable to find a usable engine; tried using: 'pyarrow', 'fastparquet'.)

## 1. Per-sector fraud base rates (Beta-Binomial)

| sector | tx | fraud | raw rate | posterior mean | 95% HDI | P(rate > pooled) | R-hat | ESS |
|---|---|---|---|---|---|---|---|---|
| insurance | 2659 | 9 | 0.3385% | 0.3378% | [0.1458%, 0.5508%] | 0.603 | 1.002 | 2411 |
| mfb | 9623 | 30 | 0.3118% | 0.3124% | [0.2077%, 0.4250%] | 0.564 | 1.001 | 2471 |
| fintech | 33145 | 103 | 0.3108% | 0.3109% | [0.2518%, 0.3708%] | 0.628 | 1.001 | 2639 |
| bank | 56033 | 171 | 0.3052% | 0.3053% | [0.2602%, 0.3512%] | 0.582 | 1.002 | 2415 |
| psp | 3753 | 10 | 0.2665% | 0.2713% | [0.1241%, 0.4352%] | 0.329 | 1.001 | 2684 |
| telco | 14787 | 37 | 0.2502% | 0.2519% | [0.1753%, 0.3342%] | 0.124 | 1.001 | 2441 |

Pooled raw fraud rate: 0.3000%. Prior: Beta(1, 300) per sector.

## 2. Change-point on weekly flagged-violation series

- Series length T = 26 weeks.
- MAP change-point: after week index 11 (tau = 12); posterior mean tau = 14.0; 95% grid interval [5, 21].
- Rate before: 11.91/week (95% HDI [9.77, 14.19]); after: 15.86/week (95% HDI [13.10, 18.68]).
- P(rate increased after change) = 0.968.

## 3. Insider-risk event-rate shrinkage (Gamma-Poisson, EB)

- Population prior Gamma(a=99.97, b=166620); mean rate 0.00060/tx; 99% population bound 0.00075/tx.
- Units flagged above the bound: 0.

---
Honest limits: synthetic labels; random-walk MH (no NUTS) — check R-hat/ESS before trusting tails; tau posterior is exact (grid), not MCMC. See ml/README.md.
