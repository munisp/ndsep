#!/usr/bin/env python3
"""Train NDSEP ML models (fraud / credit / gnn) — real training loops.

    python -m ml.training.train --model fraud   [--data-dir ml/data/output]
    python -m ml.training.train --model credit  [--epochs 40]
    python -m ml.training.train --model gnn
    python -m ml.training.train --model all --use-ray   # Ray if installed

Data resolution order per dataset:  1) latest lakehouse snapshot
(ml/lakehouse), 2) parquet/CSV files under --data-dir, 3) freshly
generated synthetic data (ml.data.generate_synthetic).

Every run: Adam + BCEWithLogitsLoss (class-weighted for fraud imbalance),
stratified train/val/test split, early stopping on val ROC-AUC, held-out
test metrics (accuracy / precision / recall / F1 / ROC-AUC) written to
ml/weights/<model>_metrics.json, weights to ml/weights/<model>.pt,
feature stats (for drift monitoring) to ml/weights/<model>_feature_stats.json,
a lakehouse metrics snapshot, and a registry entry (ml/registry.py).
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
from sklearn.metrics import (accuracy_score, f1_score, precision_score,
                             recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split

from ml.data.generate_synthetic import (CREDIT_FEATURES, FRAUD_FEATURES,
                                        NODE_FEATURE_DIM, generate)
from ml.monitoring.drift import compute_feature_stats, save_feature_stats
from ml.models.credit_net import CreditNet
from ml.models.fraud_net import FraudNet
from ml.models.gnn_net import GNNNet, build_adjacency
from ml.registry import register_run
from ml.training import lakehouse

DEVICE = "cpu"
ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DATA_DIR = os.path.join(ML_ROOT, "data", "output")
WEIGHTS_DIR = os.path.join(ML_ROOT, "weights")

try:
    import ray  # noqa: F401
    HAS_RAY = True
except Exception:
    HAS_RAY = False

SEED = 42


# --------------------------------------------------------------------------- #
# Data loading
# --------------------------------------------------------------------------- #
def _read_dataset_file(data_dir: str, name: str) -> pd.DataFrame:
    pq = os.path.join(data_dir, f"{name}.parquet")
    csv = os.path.join(data_dir, f"{name}.csv")
    if os.path.exists(pq):
        return pd.read_parquet(pq)
    if os.path.exists(csv):
        return pd.read_csv(csv)
    raise FileNotFoundError(name)


def get_dataset(name: str, data_dir: str) -> tuple[pd.DataFrame, str]:
    """Lakehouse first, then raw data dir. Returns (df, source_id)."""
    try:
        snaps = lakehouse.list_snapshots(name)
        if snaps:
            return lakehouse.load_latest(name), f"lakehouse:{snaps[-1]['snapshot_id']}"
    except Exception:
        pass
    df = _read_dataset_file(data_dir, name)
    return df, f"file:{data_dir}/{name}"


ALL_DATASETS = ["organizations", "transactions", "credit_features",
                "graph_nodes", "graph_edges", "graph_labels"]


def ingest_data_dir(data_dir: str) -> None:
    """Ingest any data-dir datasets that lack a lakehouse snapshot, so
    training reads from the lakehouse rather than regenerating."""
    for ds in ALL_DATASETS:
        if lakehouse.list_snapshots(ds):
            continue
        try:
            entry = lakehouse.save_snapshot(_read_dataset_file(data_dir, ds), ds)
            print(f"[lakehouse] ingested {ds}: {entry['rows']} rows "
                  f"-> {entry['snapshot_id']}")
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"[train] lakehouse ingest skipped for {ds}: {e}")


def ensure_data(data_dir: str, needed: list[str], n_transactions: int = 120_000,
                n_orgs: int = 800, seed: int = SEED) -> None:
    missing = [n for n in needed
               if not (os.path.exists(os.path.join(data_dir, f"{n}.parquet"))
                       or os.path.exists(os.path.join(data_dir, f"{n}.csv")))]
    if missing and not lakehouse.list_snapshots(missing[0]):
        print(f"[train] datasets {missing} not found — generating synthetic data")
        generate(data_dir, n_transactions=n_transactions, n_orgs=n_orgs,
                 seed=seed)
    ingest_data_dir(data_dir)


# --------------------------------------------------------------------------- #
# Generic helpers
# --------------------------------------------------------------------------- #
def _split(X, y, seed=SEED):
    try:
        X_tr, X_tmp, y_tr, y_tmp = train_test_split(
            X, y, test_size=0.4, random_state=seed, stratify=y)
        X_va, X_te, y_va, y_te = train_test_split(
            X_tmp, y_tmp, test_size=0.5, random_state=seed, stratify=y_tmp)
    except ValueError:  # too few positives to stratify
        X_tr, X_tmp, y_tr, y_tmp = train_test_split(
            X, y, test_size=0.4, random_state=seed)
        X_va, X_te, y_va, y_te = train_test_split(
            X_tmp, y_tmp, test_size=0.5, random_state=seed)
    return X_tr, X_va, X_te, y_tr, y_va, y_te


def _metrics(y_true, prob) -> dict:
    pred = (prob >= 0.5).astype(int)
    out = {
        "accuracy": float(accuracy_score(y_true, pred)),
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "f1": float(f1_score(y_true, pred, zero_division=0)),
    }
    try:
        out["roc_auc"] = float(roc_auc_score(y_true, prob))
    except ValueError:
        out["roc_auc"] = float("nan")
    return out


def _train_tabular(model, X_tr, y_tr, X_va, y_va, epochs, lr, pos_weight,
                   batch_size=512, patience=6, log_every=5):
    torch.manual_seed(SEED)
    X_tr_t = torch.tensor(X_tr, dtype=torch.float32)
    y_tr_t = torch.tensor(y_tr, dtype=torch.float32)
    X_va_t = torch.tensor(X_va, dtype=torch.float32)
    y_va_np = np.asarray(y_va)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    crit = nn.BCEWithLogitsLoss(
        pos_weight=torch.tensor(float(pos_weight)))
    best_auc, best_state, bad = -1.0, copy.deepcopy(model.state_dict()), 0
    n = len(X_tr_t)
    for epoch in range(1, epochs + 1):
        model.train()
        perm = torch.randperm(n)
        tot = 0.0
        for i in range(0, n, batch_size):
            idx = perm[i:i + batch_size]
            if len(idx) < 2:      # BatchNorm guard
                continue
            opt.zero_grad()
            loss = crit(model(X_tr_t[idx]), y_tr_t[idx])
            loss.backward()
            opt.step()
            tot += loss.item() * len(idx)
        model.eval()
        with torch.no_grad():
            va_prob = torch.sigmoid(model(X_va_t)).numpy()
        try:
            va_auc = roc_auc_score(y_va_np, va_prob)
        except ValueError:
            va_auc = 0.5
        if epoch % log_every == 0 or epoch == 1:
            print(f"  epoch {epoch:3d}  loss={tot / n:.4f}  val_auc={va_auc:.4f}")
        if va_auc > best_auc:
            best_auc, best_state, bad = va_auc, copy.deepcopy(model.state_dict()), 0
        else:
            bad += 1
            if bad >= patience:
                print(f"  early stop at epoch {epoch} (best val_auc={best_auc:.4f})")
                break
    model.load_state_dict(best_state)
    return model, best_auc


def _finalize(model, model_name, X_tr, X_te, y_te, feature_names, mean, std,
              best_val_auc, epochs_ran_note, data_source, weights_dir,
              df_for_stats):
    model.eval()
    with torch.no_grad():
        prob = torch.sigmoid(
            model(torch.tensor((X_te - mean) / std, dtype=torch.float32))).numpy()
    m = _metrics(np.asarray(y_te), prob)
    version = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    wpath = os.path.join(weights_dir, f"{model_name}_net.pt")
    model.save(wpath)
    stats = compute_feature_stats(df_for_stats, feature_names)
    stats["feature_means"] = dict(zip(feature_names, mean.tolist()))
    stats["feature_stds"] = dict(zip(feature_names, std.tolist()))
    stats_path = os.path.join(weights_dir, f"{model_name}_net_feature_stats.json")
    save_feature_stats(stats, stats_path)
    payload = {
        "model": model_name, "version": version,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "data_source": data_source, "device": DEVICE,
        "n_train": int(len(X_tr)), "n_test": int(len(y_te)),
        "positive_rate_test": float(np.mean(y_te)),
        "best_val_auc": float(best_val_auc), **m,
        "feature_stats_path": stats_path, "weights_path": wpath,
    }
    with open(os.path.join(weights_dir, f"{model_name}_net_metrics.json"), "w") as f:
        json.dump(payload, f, indent=2)
    lakehouse.save_metrics_snapshot(m, model_name)
    register_run(model_name, m, wpath, data_snapshot_id=data_source,
                 version=version,
                 registry_path=os.path.join(weights_dir, "registry.json"))
    return payload


# --------------------------------------------------------------------------- #
# Per-model training
# --------------------------------------------------------------------------- #
def train_fraud(data_dir: str = DEFAULT_DATA_DIR, epochs: int = 40,
                weights_dir: str = WEIGHTS_DIR, lr: float = 1e-3) -> dict:
    ensure_data(data_dir, ["transactions"])
    tx, src = get_dataset("transactions", data_dir)
    print(f"[fraud] {len(tx)} transactions from {src}; "
          f"fraud rate={tx['is_fraud'].mean():.4%}")
    X = tx[FRAUD_FEATURES].to_numpy(dtype=float)
    y = tx["is_fraud"].to_numpy(dtype=float)
    X_tr, X_va, X_te, y_tr, y_va, y_te = _split(X, y)
    mean, std = X_tr.mean(0), X_tr.std(0) + 1e-9
    Xs_tr, Xs_va = (X_tr - mean) / std, (X_va - mean) / std
    pos_weight = max((len(y_tr) - y_tr.sum()) / max(y_tr.sum(), 1), 1.0)
    print(f"[fraud] pos_weight={pos_weight:.1f}  train={len(y_tr)}")
    model = FraudNet(input_dim=len(FRAUD_FEATURES)).to(DEVICE)
    model, best_auc = _train_tabular(model, Xs_tr, y_tr, Xs_va, y_va,
                                     epochs=epochs, lr=lr, pos_weight=pos_weight)
    return _finalize(model, "fraud", X_tr, X_te, y_te, FRAUD_FEATURES,
                     mean, std, best_auc, epochs, src, weights_dir, tx)


def train_credit(data_dir: str = DEFAULT_DATA_DIR, epochs: int = 40,
                 weights_dir: str = WEIGHTS_DIR, lr: float = 1e-3) -> dict:
    ensure_data(data_dir, ["credit_features"])
    cr, src = get_dataset("credit_features", data_dir)
    print(f"[credit] {len(cr)} organizations from {src}; "
          f"default rate={cr['default_24m'].mean():.2%}")
    X = cr[CREDIT_FEATURES].to_numpy(dtype=float)
    y = cr["default_24m"].to_numpy(dtype=float)
    X_tr, X_va, X_te, y_tr, y_va, y_te = _split(X, y)
    mean, std = X_tr.mean(0), X_tr.std(0) + 1e-9
    pos_weight = max((len(y_tr) - y_tr.sum()) / max(y_tr.sum(), 1), 1.0)
    model = CreditNet(input_dim=len(CREDIT_FEATURES)).to(DEVICE)
    model, best_auc = _train_tabular(model, (X_tr - mean) / std, y_tr,
                                     (X_va - mean) / std, y_va, epochs=epochs,
                                     lr=lr, pos_weight=pos_weight,
                                     batch_size=min(256, max(8, len(y_tr) // 4)))
    return _finalize(model, "credit", X_tr, X_te, y_te, CREDIT_FEATURES,
                     mean, std, best_auc, epochs, src, weights_dir, cr)


def train_gnn(data_dir: str = DEFAULT_DATA_DIR, epochs: int = 60,
              weights_dir: str = WEIGHTS_DIR, lr: float = 5e-3) -> dict:
    ensure_data(data_dir, ["graph_nodes", "graph_edges", "graph_labels"])
    nodes, src_n = get_dataset("graph_nodes", data_dir)
    edges, _ = get_dataset("graph_edges", data_dir)
    labels, _ = get_dataset("graph_labels", data_dir)
    n_nodes = len(nodes)
    feat_cols = [f"f{i}" for i in range(NODE_FEATURE_DIM)]
    X = torch.tensor(nodes[feat_cols].to_numpy(dtype=np.float32))
    edge_list = list(zip(edges["src"].astype(int), edges["dst"].astype(int)))
    adj = build_adjacency(n_nodes, edge_list)
    y_all = labels.set_index("node_id")["high_risk"]
    org_idx = np.sort(labels["node_id"].to_numpy())
    y = y_all.loc[org_idx].to_numpy(dtype=float)
    print(f"[gnn] graph: {n_nodes} nodes, {len(edge_list)} edges from {src_n}; "
          f"high-risk org rate={y.mean():.2%}")
    tr, va, te, y_tr, y_va, y_te = _split(org_idx, y)
    pos_weight = max((len(y_tr) - y_tr.sum()) / max(y_tr.sum(), 1), 1.0)
    model = GNNNet(input_dim=NODE_FEATURE_DIM).to(DEVICE)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    crit = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(float(pos_weight)))
    best_auc, best_state, bad = -1.0, copy.deepcopy(model.state_dict()), 0
    tr_t = torch.tensor(tr)
    y_tr_t = torch.tensor(y_tr, dtype=torch.float32)
    for epoch in range(1, epochs + 1):
        model.train()
        opt.zero_grad()
        logits = model(X, adj)
        loss = crit(logits[tr_t], y_tr_t)
        loss.backward()
        opt.step()
        model.eval()
        with torch.no_grad():
            va_prob = torch.sigmoid(model(X, adj)[torch.tensor(va)]).numpy()
        try:
            va_auc = roc_auc_score(y_va, va_prob)
        except ValueError:
            va_auc = 0.5
        if epoch % 10 == 0 or epoch == 1:
            print(f"  epoch {epoch:3d}  loss={loss.item():.4f}  val_auc={va_auc:.4f}")
        if va_auc > best_auc:
            best_auc, best_state, bad = va_auc, copy.deepcopy(model.state_dict()), 0
        else:
            bad += 1
            if bad >= 10:
                print(f"  early stop at epoch {epoch} (best val_auc={best_auc:.4f})")
                break
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        prob = torch.sigmoid(model(X, adj)[torch.tensor(te)]).numpy()
    m = _metrics(y_te, prob)

    version = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    wpath = os.path.join(weights_dir, "gnn_net.pt")
    model.save(wpath)
    # feature stats over ORG node features (drift reference)
    org_feats = nodes[nodes["node_type"] == "organization"]
    stats = compute_feature_stats(org_feats, feat_cols)
    stats_path = os.path.join(weights_dir, "gnn_net_feature_stats.json")
    save_feature_stats(stats, stats_path)
    payload = {
        "model": "gnn", "version": version,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "data_source": src_n, "device": DEVICE,
        "n_train": int(len(y_tr)), "n_test": int(len(y_te)),
        "positive_rate_test": float(np.mean(y_te)),
        "best_val_auc": float(best_auc), **m,
        "feature_stats_path": stats_path, "weights_path": wpath,
        "graph": {"n_nodes": int(n_nodes), "n_edges": int(len(edge_list))},
    }
    with open(os.path.join(weights_dir, "gnn_net_metrics.json"), "w") as f:
        json.dump(payload, f, indent=2)
    lakehouse.save_metrics_snapshot(m, "gnn")
    register_run("gnn", m, wpath, data_snapshot_id=src_n, version=version,
                 registry_path=os.path.join(weights_dir, "registry.json"))
    return payload


TRAINERS = {"fraud": train_fraud, "credit": train_credit, "gnn": train_gnn}


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _run_all_ray(models, kwargs):
    """Parallel per-model training via Ray (optional dependency)."""
    import ray
    ray.init(ignore_reinit_error=True, include_dashboard=False,
             log_to_driver=False)
    remote = {m: ray.remote(num_cpus=1)(TRAINERS[m]).remote(**kwargs)
              for m in models}
    results = {m: ray.get(ref) for m, ref in remote.items()}
    ray.shutdown()
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", choices=["fraud", "credit", "gnn", "all"],
                    required=True)
    ap.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    ap.add_argument("--weights-dir", default=WEIGHTS_DIR)
    ap.add_argument("--epochs", type=int, default=None,
                    help="override default epochs per model")
    ap.add_argument("--lr", type=float, default=None)
    ap.add_argument("--use-ray", action="store_true",
                    help="train models in parallel with Ray when installed")
    args = ap.parse_args()

    os.makedirs(args.weights_dir, exist_ok=True)
    models = ["fraud", "credit", "gnn"] if args.model == "all" else [args.model]

    def _kwargs(m):
        kw = {"data_dir": args.data_dir, "weights_dir": args.weights_dir}
        if args.epochs is not None:
            kw["epochs"] = args.epochs
        if args.lr is not None:
            kw["lr"] = args.lr
        return kw

    results = {}
    if len(models) > 1 and args.use_ray:
        if HAS_RAY:
            print("[train] training models in parallel with Ray")
            merged = {}
            for m in models:
                merged.update(_kwargs(m))
            results = _run_all_ray(models, {k: v for k, v in merged.items()})
        else:
            print("[train] Ray not installed — falling back to sequential local training")
    if not results:
        for m in models:
            results[m] = TRAINERS[m](**_kwargs(m))

    print("\n================ TEST METRICS ================")
    for m, r in results.items():
        print(f"{m:7s}  acc={r['accuracy']:.4f}  prec={r['precision']:.4f}  "
              f"rec={r['recall']:.4f}  f1={r['f1']:.4f}  auc={r['roc_auc']:.4f}  "
              f"(val_auc={r['best_val_auc']:.4f})")
    print("==============================================")


if __name__ == "__main__":
    main()
