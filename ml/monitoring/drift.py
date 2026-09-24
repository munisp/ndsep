"""Feature-drift detection for the NDSEP ML stack.

Compares the training-time feature distributions (stats JSON written at
train time next to the weights) against a new batch of data, per feature:

  * PSI  (Population Stability Index) over decile bins learned from the
         training data.  psi < 0.1 stable | 0.1-0.25 watch | > 0.25 drift.
  * KS   two-sample Kolmogorov-Smirnov test (scipy), p < 0.01 = drift.

A feature is flagged DRIFTED when psi > PSI_THRESHOLD or the KS test
rejects. fine_tune.py runs this check before training and logs the report
(alongside the run in the registry) so retraining decisions are auditable.
"""

from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

PSI_THRESHOLD = 0.25
KS_P_THRESHOLD = 0.01
N_BINS = 10


# --------------------------------------------------------------------------- #
# Training-time stats
# --------------------------------------------------------------------------- #
REF_SAMPLE_SIZE = 500


def compute_feature_stats(df: pd.DataFrame, features: list[str]) -> dict:
    """Quantile-bin edges + per-bin proportions, mean/std per feature,
    plus a deterministic reference subsample (sorted values at evenly
    spaced ranks) for exact two-sample KS tests at drift-check time."""
    stats = {}
    for f in features:
        x = pd.to_numeric(df[f], errors="coerce").dropna().to_numpy(dtype=float)
        if len(x) == 0:
            continue
        edges = np.unique(np.quantile(x, np.linspace(0, 1, N_BINS + 1)))
        if len(edges) < 3:                      # constant-ish feature
            edges = np.array([x.min() - 1e-6, x.min() + 1e-6, x.max() + 1e-6])
        edges[0], edges[-1] = -np.inf, np.inf
        counts, _ = np.histogram(x, bins=edges)
        xs = np.sort(x)
        ranks = np.linspace(0, len(xs) - 1,
                            min(REF_SAMPLE_SIZE, len(xs))).astype(int)
        stats[f] = {
            "mean": float(np.mean(x)), "std": float(np.std(x)),
            "min": float(np.min(x)), "max": float(np.max(x)),
            "bin_edges": [float(e) for e in edges],
            "bin_probs": (counts / max(counts.sum(), 1)).tolist(),
            "ref_sample": [round(float(v), 6) for v in xs[ranks]],
        }
    return {"n_rows": int(len(df)), "features": stats}


def save_feature_stats(stats: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(stats, f, indent=2)


def load_feature_stats(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


# --------------------------------------------------------------------------- #
# Drift metrics
# --------------------------------------------------------------------------- #
def psi(expected: np.ndarray, actual: np.ndarray, eps: float = 1e-6) -> float:
    """Population Stability Index between two bin-probability vectors."""
    e = np.clip(np.asarray(expected, dtype=float), eps, None)
    a = np.clip(np.asarray(actual, dtype=float), eps, None)
    e, a = e / e.sum(), a / a.sum()
    return float(np.sum((a - e) * np.log(a / e)))


def drift_report(train_stats: dict, new_df: pd.DataFrame,
                 features: list[str] | None = None) -> dict:
    """Per-feature PSI + KS report between training stats and a new batch."""
    fstats = train_stats["features"]
    features = features or list(fstats.keys())
    report, n_drifted = {}, 0
    for f in features:
        if f not in fstats or f not in new_df.columns:
            report[f] = {"status": "missing"}
            continue
        ref = fstats[f]
        x = pd.to_numeric(new_df[f], errors="coerce").dropna().to_numpy(float)
        if len(x) < 30:
            report[f] = {"status": "insufficient_data", "n": int(len(x))}
            continue
        edges = np.array(ref["bin_edges"], dtype=float)
        counts, _ = np.histogram(x, bins=edges)
        new_probs = counts / max(counts.sum(), 1)
        psi_val = psi(np.array(ref["bin_probs"]), new_probs)
        # exact two-sample KS against the stored training reference sample
        ref_sample = np.array(ref.get("ref_sample") or [ref["mean"]])
        ks = scipy_stats.ks_2samp(ref_sample, x)
        # flag on significant PSI, or KS significant AND non-trivial effect
        # (with large batches KS alone flags negligible shifts)
        drifted = bool(psi_val > PSI_THRESHOLD
                       or (ks.pvalue < KS_P_THRESHOLD and ks.statistic > 0.1))
        n_drifted += drifted
        report[f] = {
            "psi": round(psi_val, 4),
            "ks_stat": round(float(ks.statistic), 4),
            "ks_pvalue": float(f"{ks.pvalue:.3e}"),
            "train_mean": round(ref["mean"], 4),
            "new_mean": round(float(np.mean(x)), 4),
            "status": "drifted" if drifted else "stable",
        }
    return {
        "n_features": len(report),
        "n_drifted": n_drifted,
        "drift_detected": n_drifted > 0,
        "psi_threshold": PSI_THRESHOLD,
        "ks_p_threshold": KS_P_THRESHOLD,
        "features": report,
    }


if __name__ == "__main__":
    import sys
    stats_path, batch_csv = sys.argv[1], sys.argv[2]
    rep = drift_report(load_feature_stats(stats_path), pd.read_csv(batch_csv))
    print(json.dumps(rep, indent=2))
