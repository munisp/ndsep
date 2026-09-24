"""Tests for the pure-stdlib Poisson change-point port in
workers/python/egress_monitor_worker.py (ported from ml/bayesian/models.py).

Covers:
  * injected step-UP shift is detected, with MAP tau near the true change
  * steady (Poisson-homogeneous) series raises NO alarm (no false positive)
  * posterior over tau is a valid distribution
  * short series raises loudly instead of returning a bogus verdict

Run: pytest workers/python/tests/test_changepoint.py
(stdlib + the worker's own module only; no numpy required.)
"""

import math
import os
import random
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from egress_monitor_worker import (  # noqa: E402
    _log_marginal_poisson,
    foreign_egress_shift,
    poisson_changepoint,
)


def _poisson_series(lam: float, n: int, seed: int) -> list[int]:
    """Deterministic Poisson draws via stdlib (Knuth algorithm)."""
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        threshold = math.exp(-lam)
        k, p = 0, 1.0
        while p > threshold:
            k += 1
            p *= rng.random()
        out.append(k - 1)
    return out


class TestPoissonChangepoint:
    def test_detects_injected_shift(self):
        # 24 windows at lam=3 MiB, then 24 windows at lam=15 MiB.
        series = _poisson_series(3, 24, seed=7) + _poisson_series(15, 24, seed=8)
        res = poisson_changepoint(series)
        assert res["p_lam2_gt_lam1"] > 0.95
        assert res["rate_ratio"] > 3.0
        # MAP change-point close to the true tau=24 (allow Poisson wobble).
        assert abs(res["map_tau"] - 24) <= 4

    def test_no_false_alarm_on_steady_series(self):
        # 48 windows at a constant lam=5 MiB.
        series = _poisson_series(5, 48, seed=123)
        shift = foreign_egress_shift(series, p_min=0.95, rate_ratio_min=3.0)
        assert shift["detected"] is False

    def test_steady_series_rate_ratio_near_one(self):
        series = _poisson_series(5, 48, seed=321)
        res = poisson_changepoint(series)
        assert 0.5 < res["rate_ratio"] < 2.0

    def test_tau_posterior_is_valid_distribution(self):
        series = _poisson_series(3, 12, seed=1) + _poisson_series(12, 12, seed=2)
        res = poisson_changepoint(series)
        assert len(res["tau_posterior"]) == len(series) - 1
        assert all(p >= 0 for p in res["tau_posterior"])
        assert math.isclose(sum(res["tau_posterior"]), 1.0, rel_tol=1e-9)

    def test_short_series_raises_loudly(self):
        with pytest.raises(ValueError):
            poisson_changepoint([1, 2, 3])

    def test_log_marginal_matches_closed_form(self):
        # p(y) for y = [2] with a=1, b=0.2:
        #   lgamma(3) - lgamma(1) + 1*ln(0.2) - 3*ln(1.2) - lgamma(3)
        expected = -math.lgamma(1) + 1 * math.log(0.2) - 3 * math.log(1.2)
        assert math.isclose(_log_marginal_poisson([2.0], 1.0, 0.2), expected, rel_tol=1e-12)

    def test_shift_down_is_not_a_violation(self):
        # Step DOWN in foreign egress (remediation) must not alarm.
        series = _poisson_series(15, 24, seed=11) + _poisson_series(3, 24, seed=12)
        shift = foreign_egress_shift(series, p_min=0.95, rate_ratio_min=3.0)
        assert shift["detected"] is False

    def test_ancient_shift_does_not_realarm(self):
        # Shift happens early in the window; by the time we look, the new
        # rate is baseline — recency guard must suppress re-alarming.
        series = _poisson_series(3, 6, seed=21) + _poisson_series(15, 42, seed=22)
        shift = foreign_egress_shift(series, p_min=0.95, rate_ratio_min=3.0, recency=10)
        assert shift["recent"] is False
        assert shift["detected"] is False
