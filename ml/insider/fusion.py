"""Fraud-fusion scorer for insider risk (NDSEP).

Combines four independent components into one explainable score per
subject. All components are mapped to [0, 1] ("probability-ish" risk
signals) and combined with FIXED, documented weights:

    gnn_structural  0.25  structural risk of the officer node in the
                          compliance graph (score_graph_node through the
                          trained GNN when weights+graph are available;
                          deterministic feature-proxy otherwise)
    bayesian_rate   0.25  Gamma-Poisson shrinkage posterior event rate
                          (ml.bayesian.models model C), normalised by the
                          99% population bound — a subject AT the bound
                          scores 1.0
    behavioral      0.30  IsolationForest anomaly score over the
                          INSIDER_FEATURES behavioral frame (batch
                          min-max normalised; seeded => deterministic)
    process         0.20  codified process-control violations touching
                          the subject, severity-weighted and capped

Rationale for the weights: behavioral anomaly is the most direct insider
signal and gets the largest weight; the two statistical signals (GNN
structure, Bayesian rate) are strong but noisier/proxied, so each gets a
quarter; process violations are rare but high-precision, so their weight
is lowest while a single high-severity violation still moves the fused
score by 0.14 (0.20 * 0.7).

Everything is CPU-only and deterministic given the same inputs (fixed
seeds, no wall-clock reads, stable sort orders).

``fuse_scores`` returns a DataFrame with one row per subject:
    subject_id, fused_score, recommended_action, bayesian_flagged,
    components (dict), explanation (list of top contributing signals)

Recommended action bands:
    fused >= 0.75  investigate
    fused >= 0.55  suspend_privileges
    fused >= 0.35  require_dual_approval
    else           monitor
"""

from __future__ import annotations

import logging
import math
from typing import Optional

import numpy as np
import pandas as pd

from ml.bayesian.models import gamma_poisson_shrinkage
from ml.insider.features import INSIDER_FEATURES
from ml.insider.process_controls import SEVERITY_WEIGHT

log = logging.getLogger(__name__)

FUSION_WEIGHTS = {
    "gnn_structural": 0.25,
    "bayesian_rate": 0.25,
    "behavioral": 0.30,
    "process": 0.20,
}

ACTION_BANDS = [
    (0.75, "investigate"),
    (0.55, "suspend_privileges"),
    (0.35, "require_dual_approval"),
    (0.0, "monitor"),
]

IFOREST_PARAMS = {"n_estimators": 100, "contamination": 0.10,
                  "random_state": 42}

# feature-proxy coefficients for the GNN component when weights/graph are
# unavailable (documented degraded mode; deterministic)
_PROXY_FEATURES = ["sensitive_access_ratio", "role_change_count",
                   "failed_auth_ratio", "after_hours_ratio"]
_PROXY_COEFS = np.array([3.0, 0.6, 2.0, 1.5])
_PROXY_INTERCEPT = -2.5


# --------------------------------------------------------------------------- #
# Component: behavioral anomaly (IsolationForest)
# --------------------------------------------------------------------------- #
def behavioral_scores(df: pd.DataFrame) -> np.ndarray:
    """IsolationForest anomaly score in [0, 1]; higher = more anomalous.

    Deterministic: fixed seed and batch min-max normalisation.
    """
    from sklearn.ensemble import IsolationForest

    X = df[INSIDER_FEATURES].to_numpy(dtype=float)
    if len(df) == 1:  # a single row has no anomaly context
        return np.zeros(1)
    clf = IsolationForest(**IFOREST_PARAMS).fit(X)
    raw = -clf.score_samples(X)  # higher = more anomalous
    span = raw.max() - raw.min()
    if span <= 1e-12:
        return np.zeros(len(df))
    return (raw - raw.min()) / span


# --------------------------------------------------------------------------- #
# Component: Bayesian shrinkage event-rate posterior
# --------------------------------------------------------------------------- #
def bayesian_scores(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, dict]:
    """Return (scores, flagged, population stats).

    Score = posterior mean event rate / 99% population bound, clipped to
    [0, 1]; ``flagged`` is the shrinkage model's own flag.
    """
    counts = df["risk_event_count"].to_numpy(dtype=float)
    exposures = df["exposure_days"].to_numpy(dtype=float)
    exposures = np.where(exposures <= 0, 1.0, exposures)
    res = gamma_poisson_shrinkage(counts, exposures)
    bound = res["population"]["bound_99pct"]
    post = np.array([u["posterior_mean"] for u in res["units"]])
    flagged = np.array([u["flagged"] for u in res["units"]])
    scores = np.clip(post / max(bound, 1e-9), 0.0, 1.0)
    return scores, flagged, res["population"]


# --------------------------------------------------------------------------- #
# Component: GNN structural risk
# --------------------------------------------------------------------------- #
def _graph_for_subjects(subjects: list[str]):
    """Load the compliance graph (Neo4j -> lakehouse -> synthetic)."""
    from ml.graph.graph_source import load_training_graph
    nodes, edges, _labels, source = load_training_graph()
    return nodes, edges, source


def gnn_scores(df: pd.DataFrame) -> tuple[np.ndarray, list[str], str]:
    """Per-subject structural risk in [0, 1].

    For each subject found in the compliance graph, build its 1-hop
    neighbourhood and call ml.inference.score_graph_node. Subjects not in
    the graph — or all subjects when weights/graph are unavailable — get
    a documented deterministic feature-proxy score (degraded mode).
    Returns (scores, origins, source) where origins[i] is "gnn" or
    "feature_proxy".
    """
    subjects = df["subject_id"].astype(str).tolist()
    scores = np.zeros(len(df))
    origins = ["feature_proxy"] * len(df)
    proxy = _proxy_scores(df)

    nodes = edges = None
    source = "unavailable"
    try:
        nodes, edges, source = _graph_for_subjects(subjects)
    except Exception as exc:
        log.warning("graph unavailable (%s); GNN component uses proxy", exc)

    if nodes is not None:
        try:
            from ml.inference import score_graph_node
            feat_cols = [c for c in nodes.columns
                         if c.startswith("f") and c[1:].isdigit()]
            by_ref = {str(r["ref_id"]): int(r["node_id"])
                      for _, r in nodes.iterrows()}
            # adjacency (undirected 1-hop)
            neigh: dict[int, list[int]] = {}
            for _, e in edges.iterrows():
                s, d = int(e["src"]), int(e["dst"])
                neigh.setdefault(s, []).append(d)
                neigh.setdefault(d, []).append(s)
            node_feats = nodes.set_index("node_id")[feat_cols]
            for i, sid in enumerate(subjects):
                nid = by_ref.get(sid)
                if nid is None or nid not in node_feats.index:
                    scores[i] = proxy[i]
                    continue
                try:
                    x0 = node_feats.loc[nid].to_numpy(dtype=float)
                    nbrs = [node_feats.loc[j].to_numpy(dtype=float)
                            for j in neigh.get(nid, [])[:8]
                            if j in node_feats.index]
                    r = score_graph_node(list(x0), [list(v) for v in nbrs])
                    scores[i] = float(r["probability"])
                    origins[i] = "gnn"
                except Exception as exc:
                    log.debug("score_graph_node failed for %s (%s)", sid, exc)
                    scores[i] = proxy[i]
        except Exception as exc:
            log.warning("GNN weights unavailable (%s); component uses proxy",
                        exc)
            scores = proxy.copy()
    else:
        scores = proxy.copy()
    return scores, origins, source


def _proxy_scores(df: pd.DataFrame) -> np.ndarray:
    """Deterministic feature-proxy for the structural component.

    Used only when the GNN weights or the compliance graph are
    unavailable (or the subject is absent from the graph). Combines the
    behavior features most correlated with collusion/insider structure.
    """
    X = df[_PROXY_FEATURES].to_numpy(dtype=float)
    z = _PROXY_INTERCEPT + X @ _PROXY_COEFS
    return 1.0 / (1.0 + np.exp(-z))


# --------------------------------------------------------------------------- #
# Component: process-control violations
# --------------------------------------------------------------------------- #
def process_scores(df: pd.DataFrame, violations: list[dict]) -> np.ndarray:
    """Severity-weighted, capped process-violation score per subject."""
    per_subject: dict[str, float] = {}
    for v in violations:
        w = SEVERITY_WEIGHT.get(v.get("severity", "low"), 0.2)
        subs = v.get("subjects", {})
        ids = {str(subs.get("actor_id", ""))}
        if subs.get("target_user_id"):
            ids.add(str(subs["target_user_id"]))
        for sid in ids:
            if sid:
                per_subject[sid] = per_subject.get(sid, 0.0) + w
    return np.array([min(1.0, per_subject.get(str(s), 0.0))
                     for s in df["subject_id"]])


# --------------------------------------------------------------------------- #
# Explanation helpers
# --------------------------------------------------------------------------- #
def _robust_z(df: pd.DataFrame) -> pd.DataFrame:
    """Median/MAD robust z-scores of the behavioral features (batch-wide)."""
    X = df[INSIDER_FEATURES].astype(float)
    med = X.median()
    mad = (X - med).abs().median().replace(0.0, np.nan)
    scale = (1.4826 * mad).fillna(X.std()).replace(0.0, 1.0)
    return (X - med) / scale


def recommended_action(score: float) -> str:
    for thresh, action in ACTION_BANDS:
        if score >= thresh:
            return action
    return "monitor"


# --------------------------------------------------------------------------- #
# Fusion
# --------------------------------------------------------------------------- #
def fuse_scores(df: pd.DataFrame, violations: Optional[list[dict]] = None,
                weights: Optional[dict] = None,
                use_gnn: bool = True) -> pd.DataFrame:
    """Fuse all components into an explainable insider-risk register.

    ``df`` is the feature frame from ml.insider.features
    (build_officer_features). ``violations`` is the output of
    ml.insider.process_controls.run_all_rules. ``use_gnn=False`` forces
    the documented feature-proxy for the structural component (used in
    tests and offline runs).
    """
    w = dict(FUSION_WEIGHTS if weights is None else weights)
    total = sum(w.values())
    if not math.isclose(total, 1.0, abs_tol=1e-6):
        raise ValueError(f"fusion weights must sum to 1.0, got {total}")
    violations = violations or []

    beh = behavioral_scores(df)
    bay, bay_flagged, pop = bayesian_scores(df)
    if use_gnn:
        gnn, gnn_origin, gnn_source = gnn_scores(df)
    else:
        gnn = _proxy_scores(df)
        gnn_origin = ["feature_proxy"] * len(df)
        gnn_source = "proxy-forced"
    proc = process_scores(df, violations)
    z = _robust_z(df)

    comp_mat = {"gnn_structural": gnn, "bayesian_rate": bay,
                "behavioral": beh, "process": proc}
    fused = sum(w[k] * comp_mat[k] for k in w)
    fused = np.clip(fused, 0.0, 1.0)

    rows = []
    for i, (_, r) in enumerate(df.iterrows()):
        sid = str(r["subject_id"])
        components = {k: round(float(comp_mat[k][i]), 4) for k in w}
        # ranked contributing signals: components first...
        signals = [{
            "signal": f"component:{k}",
            "contribution": round(w[k] * components[k], 4),
            "detail": _component_detail(k, components[k], gnn_origin[i],
                                        bool(bay_flagged[i])),
        } for k in w]
        # ...then the top behavioral feature deviations
        zrow = z.iloc[i].sort_values(ascending=False)
        for feat in zrow.index[:2]:
            if zrow[feat] > 1.0:  # only material deviations are explanatory
                signals.append({
                    "signal": f"feature:{feat}",
                    "contribution": round(w["behavioral"] * min(
                        float(zrow[feat]) / 5.0, 1.0), 4),
                    "detail": (f"{feat}={r[feat]:.3f} is {zrow[feat]:.1f} "
                               f"robust-z above the staff median"),
                })
        signals.sort(key=lambda s: (-s["contribution"], s["signal"]))
        score = round(float(fused[i]), 4)
        rows.append({
            "subject_id": sid,
            "subject_type": r.get("subject_type", "officer"),
            "fused_score": score,
            "recommended_action": recommended_action(score),
            "bayesian_flagged": bool(bay_flagged[i]),
            "gnn_origin": gnn_origin[i],
            "components": components,
            "explanation": signals[:5],
        })
    out = pd.DataFrame(rows).sort_values(
        ["fused_score", "subject_id"], ascending=[False, True]
    ).reset_index(drop=True)
    out.attrs["weights"] = w
    out.attrs["bayesian_population"] = pop
    out.attrs["gnn_source"] = gnn_source
    return out


def _component_detail(name: str, value: float, gnn_origin: str,
                      bay_flagged: bool) -> str:
    if name == "gnn_structural":
        src = ("GNN compliance-graph neighbourhood score"
               if gnn_origin == "gnn" else
               "feature-proxy (GNN weights/graph unavailable)")
        return f"{src}: {value:.3f}"
    if name == "bayesian_rate":
        return (f"shrunk event-rate posterior {value:.3f} of the 99% "
                f"population bound" + (" — FLAGGED" if bay_flagged else ""))
    if name == "behavioral":
        return f"IsolationForest anomaly percentile (batch): {value:.3f}"
    return f"severity-weighted process-control violations: {value:.3f}"
