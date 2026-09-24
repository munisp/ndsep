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

    python -m ml.inference        # smoke test
"""

from __future__ import annotations

import json
import os
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


@lru_cache(maxsize=4)
def _load(name: str, weights_dir: str = WEIGHTS_DIR):
    path = os.path.join(weights_dir, f"{name}_net.pt")
    cls = {"fraud": FraudNet, "credit": CreditNet, "gnn": GNNNet}[name]
    model = cls.load(path, device=DEVICE)
    stats_path = os.path.join(weights_dir, f"{name}_net_feature_stats.json")
    stats = json.load(open(stats_path)) if os.path.exists(stats_path) else {}
    return model, stats, _version(weights_dir, name)


def _standardize(values: np.ndarray, features: list[str], stats: dict) -> np.ndarray:
    means = np.array([stats.get("feature_means", {}).get(f, 0.0)
                      for f in features])
    stds = np.array([stats.get("feature_stds", {}).get(f, 1.0)
                     for f in features])
    return (values - means) / np.where(stds == 0, 1.0, stds)


def score_transaction(features: dict | list[float],
                      weights_dir: str = WEIGHTS_DIR) -> dict:
    """Score one NIP transaction for fraud.

    `features` may be a dict keyed by FRAUD_FEATURES names or an ordered
    list/np.ndarray of len(FRAUD_FEATURES).
    """
    model, stats, version = _load("fraud", weights_dir)
    x = _as_vector(features, FRAUD_FEATURES)
    x = _standardize(x, FRAUD_FEATURES, stats)
    with torch.no_grad():
        logit = model(torch.tensor(x[None, :], dtype=torch.float32))
        prob = float(torch.sigmoid(logit).item())
    return {"model": "fraud_net", "model_version": version,
            "probability": prob, "score": prob}


def score_credit(features: dict | list[float],
                 weights_dir: str = WEIGHTS_DIR) -> dict:
    """Score one organization for 24-month credit/compliance default risk."""
    model, stats, version = _load("credit", weights_dir)
    x = _as_vector(features, CREDIT_FEATURES)
    x = _standardize(x, CREDIT_FEATURES, stats)
    with torch.no_grad():
        logit = model(torch.tensor(x[None, :], dtype=torch.float32))
        prob = float(torch.sigmoid(logit).item())
    return {"model": "credit_net", "model_version": version,
            "probability": prob, "score": prob}


def score_graph_node(node_features: dict | list[float],
                     neighbor_features: list[dict | list[float]] | None = None,
                     weights_dir: str = WEIGHTS_DIR) -> dict:
    """Score one compliance-graph node (e.g. an organization) for high risk.

    Builds a local star graph (the node + its 1-hop neighbours) and runs
    the trained GraphSAGE GNN. With no neighbours supplied, the node's
    self-features still flow through (self-loop via W_self).
    """
    model, stats, version = _load("gnn", weights_dir)
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
    return {"model": "gnn_net", "model_version": version,
            "probability": prob, "score": prob}


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
