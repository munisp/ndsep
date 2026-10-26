#!/usr/bin/env python3
"""Shared HistGradientBoosting JSON artifact export + pure-python scorer.

Round 12, wave 8 (roadmap P2): the settlement-terms recommender and the
penalty-calibration model are trained with sklearn's
HistGradientBoostingClassifier but SERVED from TypeScript
(server/services/*) with no Python runtime call — the platform convention
(see server/services/complaintSurgeMath.ts: "pure TS, no python runtime
call"). To make TS serving exact, this module exports the fitted ensemble
into a self-describing JSON artifact under ml/weights/ and ships a pure
numpy reference scorer (`predict_proba`) which the pytest suite asserts
matches `clf.predict_proba` to 1e-9, pinning the traversal semantics the
TS evaluator implements:

    raw(node-row)   = baseline + SUM over trees of leaf_value(row)
                      (leaf values already carry the learning rate;
                       adding learning_rate again is the classic bug —
                       the pytest parity check guards it)
    p               = sigmoid(raw)
    traversal       = start at node 0; while not is_leaf:
                      left  iff row[feature_idx] <= num_threshold
                      (NaN  iff missing_go_to_left)
                      else  right

Artifact schema (all HGB-backed wave-8 models):

    {
      "model":            str,     # e.g. "settlement_recommender"
      "model_type":       "hist_gradient_boosting",
      "version":          str,     # v<yyyymmddTHHMMSS>Z
      "trained_at":       str,     # ISO-8601 UTC
      "features":         [str],   # final (post one-hot expansion) order
      "categorical_levels": {col: [level, ...]},   # one-hot order, per col
      "baseline":         float,
      "trees":            [ [node, ...], ... ],   # one node array per tree
      "metrics":          {...},   # trainer-defined (auc/logloss/...)
      "sample_size":      int
    }

node = {"value": float, "count": int, "feature_idx": int,
        "num_threshold": float, "missing_go_to_left": bool,
        "left": int, "right": int, "is_leaf": bool}

Fail-closed: `train_hgb` refuses frames carrying raw data-subject
identifier columns (same denylist philosophy as
server/routers/decisionFeedback.ts) so a mislabeled extraction can never
bake PII into a model artifact.
"""

from __future__ import annotations

import math
from datetime import datetime

import numpy as np

# Conservative denylist of column names that indicate raw data-subject
# identifiers. Mirrors server/routers/decisionFeedback.ts RAW_IDENTIFIER_KEYS.
RAW_IDENTIFIER_COLUMNS = frozenset({
    "nin", "bvn", "subject_ref", "subjectref", "data_subject_ref",
    "national_id", "passport_number", "phone_number", "msisdn",
    "email", "email_address", "contact_email", "submitted_by",
    "org_name", "name", "respondent_name", "respondent_email",
})


def assert_no_raw_identifiers(columns, context: str) -> None:
    """Raise (fail-closed) when a training frame carries raw identifier cols."""
    hits = [c for c in columns if str(c).lower() in RAW_IDENTIFIER_COLUMNS]
    if hits:
        raise RuntimeError(
            f"[{context}] training frame carries raw identifier columns "
            f"{hits} — pseudonymize (keyed hash) before training; refusing "
            "to bake identifiers into a model artifact")


def utcnow_iso() -> str:
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def new_version() -> str:
    return "v" + datetime.utcnow().strftime("%Y%m%dT%H%M%S") + "Z"


def export_trees(clf) -> list[list[dict]]:
    """Export every iteration's tree as a plain list of node dicts."""
    trees: list[list[dict]] = []
    for iteration in clf._predictors:  # noqa: SLF001 (stable across sklearn 1.4-1.7)
        for predictor in iteration:
            nodes = []
            for n in predictor.nodes:
                nodes.append({
                    "value": float(n["value"]),
                    "count": int(n["count"]),
                    "feature_idx": int(n["feature_idx"]),
                    "num_threshold": float(n["num_threshold"]),
                    "missing_go_to_left": bool(n["missing_go_to_left"]),
                    "left": int(n["left"]),
                    "right": int(n["right"]),
                    "is_leaf": bool(n["is_leaf"]),
                })
            trees.append(nodes)
    return trees


def _traverse(nodes: list[dict], row) -> float:
    idx = 0
    while True:
        n = nodes[idx]
        if n["is_leaf"]:
            return float(n["value"])
        v = row[int(n["feature_idx"])]
        if v is None or (isinstance(v, float) and math.isnan(v)):
            idx = int(n["left"] if n["missing_go_to_left"] else n["right"])
        else:
            idx = int(n["left"] if v <= float(n["num_threshold"]) else n["right"])


def predict_proba_artifact(artifact: dict, rows) -> np.ndarray:
    """Reference scorer for an exported artifact (mirrors the TS evaluator)."""
    X = np.asarray(rows, dtype=float)
    if X.ndim == 1:
        X = X.reshape(1, -1)
    base = float(artifact["baseline"])
    out = np.empty(X.shape[0], dtype=float)
    for i in range(X.shape[0]):
        raw = base
        for nodes in artifact["trees"]:
            raw += _traverse(nodes, X[i])
        raw = max(-500.0, min(500.0, raw))  # exp overflow guard
        out[i] = 1.0 / (1.0 + math.exp(-raw))
    return out


def fit_hgb(X: np.ndarray, y: np.ndarray, seed: int = 42):
    """Fit the wave-8 binary HGB. Small-data-safe settings."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    n = X.shape[0]
    clf = HistGradientBoostingClassifier(
        max_iter=min(200, max(30, n // 4)),
        max_leaf_nodes=15,
        learning_rate=0.08,
        early_stopping=(n >= 200),
        random_state=seed,
    )
    clf.fit(X, y)
    return clf


def build_artifact(model: str, clf, features: list[str],
                   categorical_levels: dict, metrics: dict,
                   sample_size: int) -> dict:
    """Assemble the JSON-serializable artifact for a fitted HGB."""
    return {
        "model": model,
        "model_type": "hist_gradient_boosting",
        "version": new_version(),
        "trained_at": utcnow_iso(),
        "features": list(features),
        "categorical_levels": {k: list(v) for k, v in
                               (categorical_levels or {}).items()},
        "baseline": float(clf._baseline_prediction[0][0]),  # noqa: SLF001
        "trees": export_trees(clf),
        "metrics": metrics,
        "sample_size": int(sample_size),
    }
