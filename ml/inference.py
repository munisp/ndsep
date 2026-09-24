#!/usr/bin/env python3
"""CPU inference for the NDSEP ML stack.

Loads trained weights from ml/weights/ and exposes:

    score_transaction(features)   -> fraud probability for one transaction
    score_credit(features)        -> 24-month default probability for one org
    score_graph_node(features, neighbor_features)
                                  -> high-risk probability using a 1-hop
                                     local neighbourhood through the GNN

Each returns {"probability": float in [0,1], "model_version": str,
"model": str}. Feature standardisation uses the train-time means/stds
saved in ml/weights/<model>_net_feature_stats.json, so scoring matches
training exactly.

Optional keyword arguments on every score_* function:

    experiment="name", subject_id="..."   champion/challenger A/B routing
        (ml/ab_testing.py): the subject is deterministically assigned to a
        variant, scored with that variant's weight version, and the result
        (prediction + latency) is logged to ml/lakehouse/ab_results/.
        The returned dict gains "variant" and "experiment" keys.

Performance monitoring (ml/monitoring/performance_monitor.py) logs every
score (distribution, latency, volume) to the lakehouse unless
NDSEP_ML_MONITOR=0. Logging is failure-safe: it can never break scoring.

    python -m ml.inference        # smoke test
"""

from __future__ import annotations

import json
import os
import time
from functools import lru_cache

import numpy as np
import torch

from ml.data.generate_synthetic import (CREDIT_FEATURES, FRAUD_FEATURES,
                                        NODE_FEATURE_DIM)
from ml.models.credit_net import CreditNet
from ml.models.fraud_net import FraudNet
from ml.models.gnn_net import GNNNet, build_adjacency

DEVICE = "cpu"
WEIGHTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "weights")


def _version(weights_dir: str, name: str) -> str:
    mpath = os.path.join(weights_dir, f"{name}_net_metrics.json")
    if os.path.exists(mpath):
        with open(mpath) as f:
            return json.load(f).get("version", "unknown")
    return "unknown"


@lru_cache(maxsize=16)
def _load(name: str, weights_dir: str = WEIGHTS_DIR,
          version: str | None = None):
    """Load model + feature stats. `version` selects a versioned weights
    file (<name>_net_<version>.pt, e.g. a challenger); None = canonical."""
    if version:
        path = os.path.join(weights_dir, f"{name}_net_{version}.pt")
        if not os.path.exists(path):  # fall back to canonical weights
            path = os.path.join(weights_dir, f"{name}_net.pt")
            version = _version(weights_dir, name)
    else:
        path = os.path.join(weights_dir, f"{name}_net.pt")
        version = _version(weights_dir, name)
    cls = {"fraud": FraudNet, "credit": CreditNet, "gnn": GNNNet}[name]
    model = cls.load(path, device=DEVICE)
    stats_path = os.path.join(weights_dir, f"{name}_net_feature_stats.json")
    stats = json.load(open(stats_path)) if os.path.exists(stats_path) else {}
    return model, stats, version


def _standardize(values: np.ndarray, features: list[str], stats: dict) -> np.ndarray:
    means = np.array([stats.get("feature_means", {}).get(f, 0.0)
                      for f in features])
    stds = np.array([stats.get("feature_stds", {}).get(f, 1.0)
                     for f in features])
    return (values - means) / np.where(stds == 0, 1.0, stds)


# --------------------------------------------------------------------------- #
# A/B routing + performance logging hooks (both failure-safe)
# --------------------------------------------------------------------------- #
def _resolve_variant(name: str, weights_dir: str,
                     experiment: str | None, subject_id: str | None):
    """Return (version_override, variant) for an A/B experiment, else (None, None)."""
    if not experiment:
        return None, None
    from ml import ab_testing
    exp = ab_testing.get_experiment(
        experiment, path=os.path.join(weights_dir, "experiments.json"))
    if exp is None or exp.get("model") != name:
        return None, None
    variant = ab_testing.assign_variant(exp, str(subject_id or "anonymous"))
    return ab_testing.version_for_variant(exp, variant), variant


def _observe(name: str, result: dict, latency_ms: float,
             weights_dir: str, experiment: str | None,
             subject_id: str | None) -> None:
    """Log the scored request to A/B results and the performance monitor.
    Never raises — observability must not break scoring."""
    try:
        if experiment and result.get("variant"):
            from ml import ab_testing
            ab_testing.log_result(experiment, {
                "experiment": experiment,
                "subject_id": str(subject_id or "anonymous"),
                "model": name,
                "variant": result["variant"],
                "model_version": result["model_version"],
                "probability": result["probability"],
                "latency_ms": round(latency_ms, 3)})
    except Exception:
        pass
    try:
        if os.environ.get("NDSEP_ML_MONITOR", "1") != "0":
            from ml.monitoring import performance_monitor
            performance_monitor.log_inference(
                name, result["model_version"], result["probability"],
                latency_ms, subject_id=subject_id,
                variant=result.get("variant"),
                weights_dir=weights_dir)
    except Exception:
        pass


def score_transaction(features: dict | list[float],
                      weights_dir: str = WEIGHTS_DIR,
                      experiment: str | None = None,
                      subject_id: str | None = None) -> dict:
    """Score one NIP transaction for fraud.

    `features` may be a dict keyed by FRAUD_FEATURES names or an ordered
    list/np.ndarray of len(FRAUD_FEATURES).
    """
    t0 = time.perf_counter()
    ver, variant = _resolve_variant("fraud", weights_dir, experiment, subject_id)
    model, stats, version = _load("fraud", weights_dir, ver)
    x = _as_vector(features, FRAUD_FEATURES)
    x = _standardize(x, FRAUD_FEATURES, stats)
    with torch.no_grad():
        logit = model(torch.tensor(x[None, :], dtype=torch.float32))
        prob = float(torch.sigmoid(logit).item())
    latency_ms = (time.perf_counter() - t0) * 1000
    result = {"model": "fraud_net", "model_version": version,
              "probability": prob, "score": prob}
    if variant:
        result["variant"] = variant
        result["experiment"] = experiment
    _observe("fraud", result, latency_ms, weights_dir, experiment, subject_id)
    return result


def score_credit(features: dict | list[float],
                 weights_dir: str = WEIGHTS_DIR,
                 experiment: str | None = None,
                 subject_id: str | None = None) -> dict:
    """Score one organization for 24-month credit/compliance default risk."""
    t0 = time.perf_counter()
    ver, variant = _resolve_variant("credit", weights_dir, experiment, subject_id)
    model, stats, version = _load("credit", weights_dir, ver)
    x = _as_vector(features, CREDIT_FEATURES)
    x = _standardize(x, CREDIT_FEATURES, stats)
    with torch.no_grad():
        logit = model(torch.tensor(x[None, :], dtype=torch.float32))
        prob = float(torch.sigmoid(logit).item())
    latency_ms = (time.perf_counter() - t0) * 1000
    result = {"model": "credit_net", "model_version": version,
              "probability": prob, "score": prob}
    if variant:
        result["variant"] = variant
        result["experiment"] = experiment
    _observe("credit", result, latency_ms, weights_dir, experiment, subject_id)
    return result


def score_graph_node(node_features: dict | list[float],
                     neighbor_features: list[dict | list[float]] | None = None,
                     weights_dir: str = WEIGHTS_DIR,
                     experiment: str | None = None,
                     subject_id: str | None = None) -> dict:
    """Score one compliance-graph node (e.g. an organization) for high risk.

    Builds a local star graph (the node + its 1-hop neighbours) and runs
    the trained GraphSAGE GNN. With no neighbours supplied, the node's
    self-features still flow through (self-loop via W_self).
    """
    t0 = time.perf_counter()
    ver, variant = _resolve_variant("gnn", weights_dir, experiment, subject_id)
    model, stats, version = _load("gnn", weights_dir, ver)
    feat_cols = [f"f{i}" for i in range(NODE_FEATURE_DIM)]
    x0 = _as_vector(node_features, feat_cols)
    rows = [x0]
    for nb in (neighbor_features or []):
        rows.append(_as_vector(nb, feat_cols))
    X = torch.tensor(np.stack(rows), dtype=torch.float32)
    edges = [(0, i) for i in range(1, len(rows))]
    adj = build_adjacency(len(rows), edges) if edges else torch.sparse_coo_tensor(
        (len(rows), len(rows)))
    with torch.no_grad():
        logit = model(X, adj)[0]
        prob = float(torch.sigmoid(logit).item())
    latency_ms = (time.perf_counter() - t0) * 1000
    result = {"model": "gnn_net", "model_version": version,
              "probability": prob, "score": prob}
    if variant:
        result["variant"] = variant
        result["experiment"] = experiment
    _observe("gnn", result, latency_ms, weights_dir, experiment, subject_id)
    return result


# --------------------------------------------------------------------------- #
# Batch scoring (used by A/B evaluation and the validation harness)
# --------------------------------------------------------------------------- #
def score_batch(name: str, df, weights_dir: str = WEIGHTS_DIR,
                version: str | None = None) -> np.ndarray:
    """Vectorised scoring of a lakehouse-style DataFrame.

    fraud  — df needs the FRAUD_FEATURES columns (engineered transactions)
    credit — df needs the CREDIT_FEATURES columns
    gnn    — ignored `df`; loads latest graph_nodes/edges/labels snapshots
             and returns probabilities for nodes in graph_labels order
    """
    import pandas as pd  # noqa: F401  (df is a DataFrame)
    model, stats, _ver = _load(name, weights_dir, version)
    if name in ("fraud", "credit"):
        feats = FRAUD_FEATURES if name == "fraud" else CREDIT_FEATURES
        X = df[feats].to_numpy(dtype=float)
        X = _standardize(X, feats, stats)
        with torch.no_grad():
            return torch.sigmoid(
                model(torch.tensor(X, dtype=torch.float32))).numpy()
    if name == "gnn":
        from ml.training import lakehouse
        nodes = lakehouse.load_latest("graph_nodes")
        edges = lakehouse.load_latest("graph_edges")
        labels = lakehouse.load_latest("graph_labels")
        feat_cols = [f"f{i}" for i in range(NODE_FEATURE_DIM)]
        X = torch.tensor(nodes[feat_cols].to_numpy(dtype=np.float32))
        adj = build_adjacency(len(nodes), list(zip(edges["src"].astype(int),
                                                   edges["dst"].astype(int))))
        org_idx = np.sort(labels["node_id"].to_numpy())
        with torch.no_grad():
            return torch.sigmoid(model(X, adj)[torch.tensor(org_idx)]).numpy()
    raise ValueError(f"unknown model '{name}'")


def _as_vector(features, names: list[str]) -> np.ndarray:
    if isinstance(features, dict):
        return np.array([float(features.get(f, 0.0)) for f in names])
    arr = np.asarray(features, dtype=float)
    if arr.shape[0] != len(names):
        raise ValueError(f"expected {len(names)} features, got {arr.shape[0]}")
    return arr


# --------------------------------------------------------------------------- #
# Smoke test
# --------------------------------------------------------------------------- #
if __name__ == "__main__":
    print("NDSEP ML inference smoke test (CPU)\n" + "-" * 40)

    r = score_transaction({f: 0.0 for f in FRAUD_FEATURES} |
                          {"amount_log": 16.0, "is_night": 1,
                           "just_below_threshold": 1, "new_device": 1,
                           "sender_tx_count_1h": 12})
    print(f"score_transaction (structuring-like): {r['probability']:.4f} "
          f"(version {r['model_version']})")
    r2 = score_transaction({f: 0.0 for f in FRAUD_FEATURES} |
                           {"amount_log": 10.5, "hour_of_day": 11,
                            "salary_window": 1})
    print(f"score_transaction (benign-looking):   {r2['probability']:.4f}")

    c = score_credit({f: 0.0 for f in CREDIT_FEATURES} |
                     {"compliance_score": 35, "penalties_count_24m": 5,
                      "violations_count_24m": 8, "breach_incidents_24m": 2})
    print(f"score_credit (poor compliance org):   {c['probability']:.4f} "
          f"(version {c['model_version']})")

    org_feat = {f"f{i}": 0.0 for i in range(NODE_FEATURE_DIM)}
    org_feat["f0"] = 1.0  # node_type=organization
    risky_neighbour = {f"f{i}": 0.0 for i in range(NODE_FEATURE_DIM)}
    risky_neighbour["f1"] = 1.0  # violation node
    risky_neighbour["f4"] = 1.5  # severity
    g = score_graph_node(org_feat, [risky_neighbour] * 4)
    print(f"score_graph_node (org w/ 4 violations): {g['probability']:.4f} "
          f"(version {g['model_version']})")

    for name, res in [("fraud", r), ("credit", c), ("gnn", g)]:
        assert 0.0 <= res["probability"] <= 1.0, name
    print("\nOK — all probabilities in [0, 1]")
