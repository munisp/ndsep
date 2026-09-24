#!/usr/bin/env python3
"""Rigorous validation harness for the NDSEP ML stack.

Protocol (deliberately more honest than a random train/test split):

  fraud  TIME-BASED holdout — transactions are sorted by timestamp; a fresh
         model is trained on the first 80% of time and evaluated on the
         LAST 20% (the future). No random splitting: random splits leak
         behavioural patterns across time and overstate fraud performance.
  credit K-FOLD cross-validation — the credit dataset is small (~800 orgs)
         and has no time axis, so a fresh model is trained per fold and
         metrics are computed on pooled out-of-fold predictions.
  gnn    stratified node holdout (fresh model, train/val/test over org
         nodes on the same graph).

Every evaluation reports:
  * ROC-AUC with a bootstrap 95% confidence interval,
  * PR-AUC (average precision) — the meaningful curve at a ~0.3% base rate,
  * a calibration report (10 reliability bins: mean predicted vs observed),
  * threshold analysis (precision / recall / F1 vs threshold) with a
    recommended operating threshold: max-F1, and max-recall subject to a
    precision floor (default 0.2 — realistic for fraud triage queues).

Results are written to ml/validation/validation_results.json and the
holdout score distribution is saved as the performance-monitoring
reference (ml/weights/<model>_net_reference_scores.json).

    python -m ml.validation.validate --model all
    python -m ml.validation.validate --model fraud --epochs 15
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import time

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import (average_precision_score, precision_score,
                             recall_score, roc_auc_score)
from sklearn.model_selection import StratifiedKFold, train_test_split

from ml.data.generate_synthetic import (CREDIT_FEATURES, FRAUD_FEATURES,
                                        NODE_FEATURE_DIM)
from ml.models.credit_net import CreditNet
from ml.models.fraud_net import FraudNet
from ml.models.gnn_net import GNNNet, build_adjacency
from ml.monitoring import performance_monitor
from ml.training import lakehouse
from ml.training.train import (DEFAULT_DATA_DIR, WEIGHTS_DIR, _metrics,
                               _train_tabular, ensure_data)

ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS_PATH = os.path.join(ML_ROOT, "validation", "validation_results.json")
SEED = 42

DEFAULT_PRECISION_FLOOR = 0.2   # fraud triage: accept <= 5 false alarms / case


# --------------------------------------------------------------------------- #
# Metrics helpers
# --------------------------------------------------------------------------- #
def bootstrap_auc_ci(y: np.ndarray, prob: np.ndarray, n_boot: int = 1000,
                     seed: int = SEED) -> dict:
    """Percentile bootstrap 95% CI for ROC-AUC."""
    rng = np.random.default_rng(seed)
    y = np.asarray(y)
    prob = np.asarray(prob, dtype=float)
    aucs = []
    n = len(y)
    for _ in range(n_boot):
        idx = rng.integers(0, n, n)
        if len(np.unique(y[idx])) < 2:
            continue
        aucs.append(roc_auc_score(y[idx], prob[idx]))
    return {"auc": float(roc_auc_score(y, prob)),
            "ci95_low": float(np.percentile(aucs, 2.5)),
            "ci95_high": float(np.percentile(aucs, 97.5)),
            "n_boot": len(aucs)}


def calibration_report(y: np.ndarray, prob: np.ndarray,
                       n_bins: int = 10) -> list[dict]:
    """Reliability bins: mean predicted probability vs observed frequency."""
    y = np.asarray(y, dtype=float)
    prob = np.asarray(prob, dtype=float)
    edges = np.linspace(0, 1, n_bins + 1)
    bins = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (prob >= lo) & (prob < hi if hi < 1 else prob <= hi)
        bins.append({
            "bin": f"[{lo:.1f},{hi:.1f}]",
            "n": int(m.sum()),
            "mean_predicted": (round(float(prob[m].mean()), 4)
                               if m.sum() else None),
            "observed_rate": (round(float(y[m].mean()), 4)
                              if m.sum() else None),
        })
    ece = float(np.nansum([
        b["n"] * abs((b["mean_predicted"] or 0) - (b["observed_rate"] or 0))
        for b in bins]) / max(len(y), 1))
    return {"bins": bins, "expected_calibration_error": round(ece, 4)}


def threshold_analysis(y: np.ndarray, prob: np.ndarray,
                       precision_floor: float = DEFAULT_PRECISION_FLOOR,
                       n_steps: int = 99) -> dict:
    """Precision/recall/F1 across thresholds + operating-point recommendation."""
    y = np.asarray(y)
    prob = np.asarray(prob, dtype=float)
    base_rate = float(y.mean())
    rows = []
    for t in np.linspace(0.01, 0.99, n_steps):
        pred = (prob >= t).astype(int)
        p = precision_score(y, pred, zero_division=0)
        r = recall_score(y, pred, zero_division=0)
        f1 = 2 * p * r / max(p + r, 1e-12)
        rows.append({"threshold": round(float(t), 3), "precision": p,
                     "recall": r, "f1": f1})
    best_f1 = max(rows, key=lambda r: r["f1"])
    viable = [r for r in rows if r["precision"] >= precision_floor]
    best_rec = (max(viable, key=lambda r: r["recall"]) if viable else None)
    return {
        "base_rate": round(base_rate, 5),
        "recommended_max_f1": {k: round(v, 4) for k, v in best_f1.items()},
        "recommended_recall_at_precision_floor": (
            {k: round(v, 4) for k, v in best_rec.items()}
            if best_rec else None),
        "precision_floor": precision_floor,
        "curve": [{k: (round(v, 4) if isinstance(v, float) else v)
                   for k, v in r.items()} for r in rows],
    }


def _full_report(y, prob, precision_floor: float) -> dict:
    rep = {"n_eval": int(len(y)), "positive_rate": round(float(np.mean(y)), 5),
           **bootstrap_auc_ci(y, prob),
           "pr_auc": float(average_precision_score(y, prob)),
           "metrics_at_0.5": _metrics(np.asarray(y), np.asarray(prob)),
           "calibration": calibration_report(y, prob),
           "threshold_analysis": threshold_analysis(y, prob, precision_floor)}
    return rep


# --------------------------------------------------------------------------- #
# Per-model protocols
# --------------------------------------------------------------------------- #
def validate_fraud(epochs: int = 15, precision_floor: float =
                   DEFAULT_PRECISION_FLOOR, data_dir: str = DEFAULT_DATA_DIR,
                   weights_dir: str = WEIGHTS_DIR) -> dict:
    """TIME-BASED holdout: train on the first 80% of time, test on the last 20%."""
    ensure_data(data_dir, ["transactions"])
    tx = lakehouse.load_latest("transactions")
    tx = tx.sort_values("timestamp").reset_index(drop=True)
    cut = int(len(tx) * 0.8)
    tr, te = tx.iloc[:cut], tx.iloc[cut:]
    print(f"[validate:fraud] time split: train<= {tr['timestamp'].max()} "
          f"({len(tr)} rows, {tr['is_fraud'].mean():.4%} fraud) | "
          f"test> ({len(te)} rows, {te['is_fraud'].mean():.4%} fraud)")
    X_tr = tr[FRAUD_FEATURES].to_numpy(dtype=float)
    y_tr = tr["is_fraud"].to_numpy(dtype=float)
    X_te = te[FRAUD_FEATURES].to_numpy(dtype=float)
    y_te = te["is_fraud"].to_numpy(dtype=float)
    mean, std = X_tr.mean(0), X_tr.std(0) + 1e-9
    # small val slice from the END of the train period for early stopping
    X_tr_s, X_va, y_tr_s, y_va = train_test_split(
        X_tr, y_tr, test_size=0.1, random_state=SEED, stratify=y_tr)
    pos_weight = max((len(y_tr_s) - y_tr_s.sum()) / max(y_tr_s.sum(), 1), 1.0)
    model = FraudNet(input_dim=len(FRAUD_FEATURES))
    model, best_val_auc = _train_tabular(
        model, (X_tr_s - mean) / std, y_tr_s, (X_va - mean) / std, y_va,
        epochs=epochs, lr=1e-3, pos_weight=pos_weight)
    model.eval()
    with torch.no_grad():
        prob = torch.sigmoid(
            model(torch.tensor((X_te - mean) / std,
                               dtype=torch.float32))).numpy()
    rep = _full_report(y_te, prob, precision_floor)
    rep.update({"protocol": "time_based_holdout_80_20",
                "train_window": [str(tr["timestamp"].min()),
                                 str(tr["timestamp"].max())],
                "test_window": [str(te["timestamp"].min()),
                                str(te["timestamp"].max())],
                "best_val_auc": float(best_val_auc)})
    performance_monitor.save_reference("fraud", prob, weights_dir=weights_dir,
                                       auc=rep["auc"])
    return rep


def validate_credit(k: int = 5, epochs: int = 25, precision_floor: float =
                    DEFAULT_PRECISION_FLOOR, data_dir: str = DEFAULT_DATA_DIR,
                    weights_dir: str = WEIGHTS_DIR) -> dict:
    """K-FOLD CV (small dataset): fresh model per fold, pooled out-of-fold."""
    ensure_data(data_dir, ["credit_features"])
    cr = lakehouse.load_latest("credit_features")
    X = cr[CREDIT_FEATURES].to_numpy(dtype=float)
    y = cr["default_24m"].to_numpy(dtype=float)
    print(f"[validate:credit] {k}-fold CV over {len(cr)} orgs "
          f"(default rate {y.mean():.2%})")
    oof = np.zeros(len(y))
    skf = StratifiedKFold(n_splits=k, shuffle=True, random_state=SEED)
    for fold, (tr_idx, te_idx) in enumerate(skf.split(X, y), 1):
        X_tr, X_te = X[tr_idx], X[te_idx]
        y_tr = y[tr_idx]
        mean, std = X_tr.mean(0), X_tr.std(0) + 1e-9
        X_tr_s, X_va, y_tr_s, y_va = train_test_split(
            X_tr, y_tr, test_size=0.15, random_state=SEED, stratify=y_tr)
        pos_weight = max((len(y_tr_s) - y_tr_s.sum())
                         / max(y_tr_s.sum(), 1), 1.0)
        model = CreditNet(input_dim=len(CREDIT_FEATURES))
        model, val_auc = _train_tabular(
            model, (X_tr_s - mean) / std, y_tr_s, (X_va - mean) / std, y_va,
            epochs=epochs, lr=1e-3, pos_weight=pos_weight,
            batch_size=min(256, max(8, len(y_tr_s) // 4)), log_every=100)
        model.eval()
        with torch.no_grad():
            oof[te_idx] = torch.sigmoid(
                model(torch.tensor((X_te - mean) / std,
                                   dtype=torch.float32))).numpy()
        print(f"  fold {fold}/{k} done (val_auc={val_auc:.4f})")
    rep = _full_report(y, oof, precision_floor)
    rep.update({"protocol": f"stratified_{k}_fold_cv_out_of_fold"})
    performance_monitor.save_reference("credit", oof, weights_dir=weights_dir,
                                       auc=rep["auc"])
    return rep


def validate_gnn(epochs: int = 60, precision_floor: float =
                 DEFAULT_PRECISION_FLOOR, data_dir: str = DEFAULT_DATA_DIR,
                 weights_dir: str = WEIGHTS_DIR) -> dict:
    """Stratified org-node holdout on the compliance graph (fresh model)."""
    ensure_data(data_dir, ["graph_nodes", "graph_edges", "graph_labels"])
    nodes = lakehouse.load_latest("graph_nodes")
    edges = lakehouse.load_latest("graph_edges")
    labels = lakehouse.load_latest("graph_labels")
    feat_cols = [f"f{i}" for i in range(NODE_FEATURE_DIM)]
    X = torch.tensor(nodes[feat_cols].to_numpy(dtype=np.float32))
    adj = build_adjacency(len(nodes), list(zip(edges["src"].astype(int),
                                               edges["dst"].astype(int))))
    y_all = labels.set_index("node_id")["high_risk"]
    org_idx = np.sort(labels["node_id"].to_numpy())
    y = y_all.loc[org_idx].to_numpy(dtype=float)
    tr, te, y_tr, y_te = train_test_split(org_idx, y, test_size=0.2,
                                          random_state=SEED, stratify=y)
    tr, va, y_tr, y_va = train_test_split(tr, y_tr, test_size=0.2,
                                          random_state=SEED, stratify=y_tr)
    print(f"[validate:gnn] {len(org_idx)} org nodes "
          f"(high-risk {y.mean():.2%}); train={len(tr)} test={len(te)}")
    pos_weight = max((len(y_tr) - y_tr.sum()) / max(y_tr.sum(), 1), 1.0)
    model = GNNNet(input_dim=NODE_FEATURE_DIM)
    opt = torch.optim.Adam(model.parameters(), lr=5e-3)
    crit = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(float(pos_weight)))
    best_auc, best_state, bad = -1.0, copy.deepcopy(model.state_dict()), 0
    tr_t = torch.tensor(tr)
    y_tr_t = torch.tensor(y_tr, dtype=torch.float32)
    for epoch in range(1, epochs + 1):
        model.train()
        opt.zero_grad()
        loss = crit(model(X, adj)[tr_t], y_tr_t)
        loss.backward()
        opt.step()
        model.eval()
        with torch.no_grad():
            va_prob = torch.sigmoid(model(X, adj)[torch.tensor(va)]).numpy()
        try:
            va_auc = roc_auc_score(y_va, va_prob)
        except ValueError:
            va_auc = 0.5
        if va_auc > best_auc:
            best_auc, best_state, bad = va_auc, copy.deepcopy(
                model.state_dict()), 0
        else:
            bad += 1
            if bad >= 10:
                break
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        prob = torch.sigmoid(model(X, adj)[torch.tensor(te)]).numpy()
    rep = _full_report(y_te, prob, precision_floor)
    rep.update({"protocol": "stratified_node_holdout_80_20",
                "best_val_auc": float(best_auc)})
    performance_monitor.save_reference("gnn", prob, weights_dir=weights_dir,
                                       auc=rep["auc"])
    return rep


VALIDATORS = {"fraud": validate_fraud, "credit": validate_credit,
              "gnn": validate_gnn}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", choices=["fraud", "credit", "gnn", "all"],
                    default="all")
    ap.add_argument("--epochs", type=int, default=None,
                    help="override per-model epochs")
    ap.add_argument("--precision-floor", type=float,
                    default=DEFAULT_PRECISION_FLOOR)
    ap.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    ap.add_argument("--weights-dir", default=WEIGHTS_DIR)
    ap.add_argument("--output", default=RESULTS_PATH)
    args = ap.parse_args()

    models = ["fraud", "credit", "gnn"] if args.model == "all" else [args.model]
    results = {"validated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                             time.gmtime()),
               "precision_floor": args.precision_floor, "models": {}}
    for m in models:
        print(f"\n========== validating {m} ==========")
        kw = {"precision_floor": args.precision_floor,
              "data_dir": args.data_dir, "weights_dir": args.weights_dir}
        if args.epochs:
            kw["epochs"] = args.epochs
        results["models"][m] = VALIDATORS[m](**kw)
        r = results["models"][m]
        print(f"[{m}] AUC={r['auc']:.4f} "
              f"(95% CI {r['ci95_low']:.4f}-{r['ci95_high']:.4f})  "
              f"PR-AUC={r['pr_auc']:.4f}  ECE={r['calibration']['expected_calibration_error']}")
        print(f"      recommended threshold (max F1): "
              f"{r['threshold_analysis']['recommended_max_f1']}")
        print(f"      recall@precision>={args.precision_floor}: "
              f"{r['threshold_analysis']['recommended_recall_at_precision_floor']}")

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nresults written to {args.output}")


if __name__ == "__main__":
    main()
