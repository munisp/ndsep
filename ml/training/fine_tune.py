#!/usr/bin/env python3
"""Continuous-training (fine-tuning) entry point for the NDSEP ML stack.

Flow:
  1. Load NEW data. If DATABASE_URL is set and reachable, extract real
     platform tables with read-only SELECTs (organizations,
     compliance_violations, enforcement_actions, financial_penalties,
     breach_incidents) and aggregate them into per-org credit features.
     If the DB is unreachable (or yields too few rows), fall back to a
     freshly generated synthetic batch (different seed = "new" data).
  2. Run a drift check (ml.monitoring.drift) of the new batch against the
     training-time feature statistics saved next to the weights, and log it.
  3. Load existing weights from ml/weights/<model>_net.pt and fine-tune
     with a lower learning rate for a few epochs.
  4. Save a VERSIONED weights file ml/weights/<model>_net_<version>.pt
     (the canonical <model>_net.pt is left untouched; promote explicitly
     after reviewing the metrics), write metrics, register the run.

Scheduling (pick one):
  * Temporal:  schedule a Workflow that runs
      `python -m ml.training.fine_tune --model all`
    on a cron (e.g. nightly 02:00 WAT) in the workers-python container.
  * Plain cron:
      0 2 * * *  cd /app && python -m ml.training.fine_tune --model all \
                 >> /var/log/ndsep/fine_tune.log 2>&1
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

from ml.data.generate_synthetic import (CREDIT_FEATURES, FRAUD_FEATURES,
                                        NODE_FEATURE_DIM, generate)
from ml.monitoring.drift import drift_report, load_feature_stats
from ml.models.credit_net import CreditNet
from ml.models.fraud_net import FraudNet
from ml.models.gnn_net import GNNNet, build_adjacency
from ml.registry import register_run
from ml.tracking import track_run
from ml.training import lakehouse
from ml.training.train import (DEFAULT_DATA_DIR, WEIGHTS_DIR, _metrics,
                               _split, ensure_data, get_dataset)

SEED = 42

# Confirmed real fraud cases (ml/validation/real_case_ingest.py, lakehouse
# dataset 'real_cases') are up-weighted relative to synthetic rows during
# fine-tuning: real labels are scarcer and more informative.
REAL_CASE_WEIGHT = 3.0


def _merge_real_cases(tx: pd.DataFrame) -> pd.DataFrame:
    """Merge ingested real fraud cases into a training batch.

    Adds a `sample_weight` column: REAL_CASE_WEIGHT for real cases, 1.0
    for the rest. No-op (weight 1.0 everywhere) when no real cases have
    been ingested yet."""
    tx = tx.copy()
    tx["sample_weight"] = 1.0
    try:
        from ml.validation.real_case_ingest import load_real_cases
        real = load_real_cases()
    except Exception as e:
        print(f"[fine_tune] real-case load skipped: {e}")
        return tx
    if real is None or not len(real):
        return tx
    keep = [c for c in ["timestamp", "is_fraud", *FRAUD_FEATURES]
            if c in real.columns]
    real = real[keep].copy()
    real["sample_weight"] = REAL_CASE_WEIGHT
    for col in ["timestamp", "is_fraud", *FRAUD_FEATURES]:
        if col not in tx.columns:
            tx[col] = np.nan
    merged = pd.concat([tx[["timestamp", "is_fraud", *FRAUD_FEATURES,
                            "sample_weight"]], real], ignore_index=True)
    print(f"[fine_tune] merged {len(real)} REAL fraud cases "
          f"(weight={REAL_CASE_WEIGHT}x) into the training batch")
    return merged


# --------------------------------------------------------------------------- #
# 1. Data acquisition
# --------------------------------------------------------------------------- #
def fetch_credit_from_db() -> pd.DataFrame | None:
    """Aggregate real platform tables into per-org credit features.

    READ-ONLY. Returns None if the DB is unreachable or has too few rows.
    """
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("[fine_tune] DATABASE_URL not set — using synthetic batch")
        return None
    try:
        import psycopg2
        conn = psycopg2.connect(dsn, connect_timeout=3)
    except Exception as e:
        print(f"[fine_tune] DB unreachable ({e}) — using synthetic batch")
        return None
    try:
        with conn, conn.cursor() as cur:
            cur.execute("""
                SELECT o.id::text, o.sector,
                       COALESCE(v.cnt, 0)  AS violations_count_24m,
                       COALESCE(p.cnt, 0)  AS penalties_count_24m,
                       COALESCE(p.total, 0) AS total_fines,
                       COALESCE(b.cnt, 0)  AS breach_incidents_24m
                FROM organizations o
                LEFT JOIN (SELECT organization_id, COUNT(*) cnt
                           FROM compliance_violations
                           WHERE created_at >= NOW() - INTERVAL '24 months'
                           GROUP BY organization_id) v ON v.organization_id = o.id
                LEFT JOIN (SELECT organization_id, COUNT(*) cnt, SUM(amount) total
                           FROM financial_penalties
                           WHERE created_at >= NOW() - INTERVAL '24 months'
                           GROUP BY organization_id) p ON p.organization_id = o.id
                LEFT JOIN (SELECT organization_id, COUNT(*) cnt
                           FROM breach_incidents
                           WHERE created_at >= NOW() - INTERVAL '24 months'
                           GROUP BY organization_id) b ON b.organization_id = o.id
            """)
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
        df = pd.DataFrame(rows, columns=cols)
        if len(df) < 30:
            print(f"[fine_tune] only {len(df)} orgs in DB — too few, "
                  "using synthetic batch")
            return None
        df["default_24m"] = (df["penalties_count_24m"] > 2).astype(int)  # proxy label
        # The platform tables do not carry every model feature; unmapped
        # features are zero-filled and logged (they are standardised at
        # train time, so 0 ~ train-mean — a neutral, documented default).
        missing = [f for f in CREDIT_FEATURES if f not in df.columns]
        if missing:
            print(f"[fine_tune] features not mapped from DB (zero-filled): "
                  f"{missing}")
            for f in missing:
                df[f] = 0.0
        print(f"[fine_tune] loaded {len(df)} orgs from production DB")
        return df
    except Exception as e:
        print(f"[fine_tune] DB query failed ({e}) — using synthetic batch")
        return None
    finally:
        conn.close()


def get_new_batch(model: str, data_dir: str, batch_seed: int) -> tuple[dict, str]:
    """Return dict of DataFrames for the requested model + source label."""
    if model == "credit":
        db_df = fetch_credit_from_db()
        if db_df is not None:
            return {"credit_features": db_df}, "postgres"
    # synthetic "new" batch: same generator, different seed
    tmp_dir = os.path.join(data_dir, f"_ft_{batch_seed}")
    generate(tmp_dir, n_transactions=40_000, n_orgs=600, seed=batch_seed)
    out = {}
    need = {"fraud": ["transactions"],
            "credit": ["credit_features"],
            "gnn": ["graph_nodes", "graph_edges", "graph_labels"]}[model]
    for name in need:
        out[name] = pd.read_parquet(os.path.join(tmp_dir, f"{name}.parquet")) \
            if os.path.exists(os.path.join(tmp_dir, f"{name}.parquet")) \
            else pd.read_csv(os.path.join(tmp_dir, f"{name}.csv"))
    if model == "fraud" and "transactions" in out:
        out["transactions"] = _merge_real_cases(out["transactions"])
    return out, f"synthetic_batch_seed_{batch_seed}"


# --------------------------------------------------------------------------- #
# 2/3. Drift check + fine-tune loops
# --------------------------------------------------------------------------- #
def _log_drift(model: str, stats_path: str, df: pd.DataFrame,
               features: list[str]) -> dict:
    if not os.path.exists(stats_path):
        print(f"[fine_tune] no feature stats at {stats_path} — skipping drift check")
        return {}
    rep = drift_report(load_feature_stats(stats_path), df, features)
    print(f"[fine_tune] drift check ({model}): "
          f"{rep['n_drifted']}/{rep['n_features']} features drifted")
    for f, r in rep["features"].items():
        if r.get("status") == "drifted":
            print(f"    DRIFT  {f}: psi={r['psi']} ks_p={r['ks_pvalue']}")
    return rep


def fine_tune_tabular(model, X, y, epochs, lr, pos_weight, batch_size=256,
                      sample_weight=None):
    if sample_weight is not None:
        idx = np.arange(len(y))
        X_tr, X_va, y_tr, y_va, w_tr, _w_va = train_test_split_safe(
            X, y, idx)
        w_tr = np.asarray(sample_weight, dtype=float)[w_tr]
    else:
        X_tr, X_va, y_tr, y_va = train_test_split_safe(X, y)
        w_tr = None
    mean, std = X_tr.mean(0), X_tr.std(0) + 1e-9
    X_tr_t = torch.tensor((X_tr - mean) / std, dtype=torch.float32)
    y_tr_t = torch.tensor(y_tr, dtype=torch.float32)
    w_tr_t = (torch.tensor(w_tr, dtype=torch.float32)
              if w_tr is not None else None)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    crit = nn.BCEWithLogitsLoss(
        pos_weight=torch.tensor(float(pos_weight)), reduction="none")
    model.train()
    for epoch in range(1, epochs + 1):
        perm = torch.randperm(len(X_tr_t))
        tot = 0.0
        for i in range(0, len(X_tr_t), batch_size):
            idx = perm[i:i + batch_size]
            if len(idx) < 2:
                continue
            opt.zero_grad()
            loss = crit(model(X_tr_t[idx]), y_tr_t[idx])
            if w_tr_t is not None:
                loss = loss * w_tr_t[idx]
            loss = loss.mean()
            loss.backward()
            opt.step()
            tot += loss.item() * len(idx)
        print(f"  ft epoch {epoch}  loss={tot / max(len(X_tr_t), 1):.4f}")
    model.eval()
    with torch.no_grad():
        prob = torch.sigmoid(
            model(torch.tensor((X_va - mean) / std, dtype=torch.float32))).numpy()
    return _metrics(np.asarray(y_va), prob)


def train_test_split_safe(X, y, *arrays, test_size=0.25):
    """Stratified split when possible; extra arrays are split alongside X/y."""
    from sklearn.model_selection import train_test_split
    try:
        return train_test_split(X, y, *arrays, test_size=test_size,
                                random_state=SEED, stratify=y)
    except ValueError:
        return train_test_split(X, y, *arrays, test_size=test_size,
                                random_state=SEED)


def fine_tune_fraud(batch: dict, source: str, epochs: int, lr: float,
                    weights_dir: str) -> dict:
    tx = batch["transactions"]
    stats_path = os.path.join(weights_dir, "fraud_net_feature_stats.json")
    drift = _log_drift("fraud", stats_path, tx, FRAUD_FEATURES)
    model = FraudNet.load(os.path.join(weights_dir, "fraud_net.pt"))
    X = tx[FRAUD_FEATURES].to_numpy(dtype=float)
    y = tx["is_fraud"].to_numpy(dtype=float)
    pos_weight = max((len(y) - y.sum()) / max(y.sum(), 1), 1.0)
    sw = (tx["sample_weight"].to_numpy(dtype=float)
          if "sample_weight" in tx.columns else None)
    metrics = fine_tune_tabular(model, X, y, epochs, lr, pos_weight,
                                sample_weight=sw)
    return _save_versioned(model, "fraud", metrics, source, drift, weights_dir)


def fine_tune_credit(batch: dict, source: str, epochs: int, lr: float,
                     weights_dir: str) -> dict:
    cr = batch["credit_features"]
    stats_path = os.path.join(weights_dir, "credit_net_feature_stats.json")
    drift = _log_drift("credit", stats_path, cr,
                       [f for f in CREDIT_FEATURES if f in cr.columns])
    model = CreditNet.load(os.path.join(weights_dir, "credit_net.pt"))
    X = cr[CREDIT_FEATURES].to_numpy(dtype=float)
    y = cr["default_24m"].to_numpy(dtype=float)
    pos_weight = max((len(y) - y.sum()) / max(y.sum(), 1), 1.0)
    metrics = fine_tune_tabular(model, X, y, epochs, lr, pos_weight,
                                batch_size=min(128, max(8, len(y) // 4)))
    return _save_versioned(model, "credit", metrics, source, drift, weights_dir)


def fine_tune_gnn(batch: dict, source: str, epochs: int, lr: float,
                  weights_dir: str) -> dict:
    nodes, edges, labels = (batch["graph_nodes"], batch["graph_edges"],
                            batch["graph_labels"])
    feat_cols = [f"f{i}" for i in range(NODE_FEATURE_DIM)]
    org_feats = nodes[nodes["node_type"] == "organization"]
    stats_path = os.path.join(weights_dir, "gnn_net_feature_stats.json")
    drift = _log_drift("gnn", stats_path, org_feats, feat_cols)
    model = GNNNet.load(os.path.join(weights_dir, "gnn_net.pt"))
    X = torch.tensor(nodes[feat_cols].to_numpy(dtype=np.float32))
    adj = build_adjacency(len(nodes), list(zip(edges["src"].astype(int),
                                               edges["dst"].astype(int))))
    y_all = labels.set_index("node_id")["high_risk"]
    org_idx = np.sort(labels["node_id"].to_numpy())
    y = y_all.loc[org_idx].to_numpy(dtype=float)
    tr, va, y_tr, y_va = train_test_split_safe(org_idx, y)
    pos_weight = max((len(y_tr) - y_tr.sum()) / max(y_tr.sum(), 1), 1.0)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    crit = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(float(pos_weight)))
    tr_t = torch.tensor(tr)
    y_tr_t = torch.tensor(y_tr, dtype=torch.float32)
    for epoch in range(1, epochs + 1):
        model.train()
        opt.zero_grad()
        loss = crit(model(X, adj)[tr_t], y_tr_t)
        loss.backward()
        opt.step()
        print(f"  ft epoch {epoch}  loss={loss.item():.4f}")
    model.eval()
    with torch.no_grad():
        prob = torch.sigmoid(model(X, adj)[torch.tensor(va)]).numpy()
    metrics = _metrics(y_va, prob)
    return _save_versioned(model, "gnn", metrics, source, drift, weights_dir)


def _save_versioned(model, name: str, metrics: dict, source: str,
                    drift: dict, weights_dir: str) -> dict:
    version = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    wpath = os.path.join(weights_dir, f"{name}_net_{version}.pt")
    model.save(wpath)
    payload = {"model": name, "version": version, "mode": "fine_tune",
               "data_source": source, "metrics": metrics,
               "drift_summary": {k: v for k, v in drift.items()
                                 if k != "features"} if drift else None,
               "weights_path": wpath,
               "note": ("Canonical <model>_net.pt NOT overwritten; promote "
                        "this version explicitly after review.")}
    mpath = os.path.join(weights_dir, f"{name}_net_{version}_metrics.json")
    with open(mpath, "w") as f:
        json.dump(payload, f, indent=2)
    lakehouse.save_metrics_snapshot(metrics, name)
    register_run(name, metrics, wpath, data_snapshot_id=source,
                 version=version,
                 registry_path=os.path.join(weights_dir, "registry.json"),
                 notes="fine_tune run; drift=" +
                       (json.dumps(payload["drift_summary"])
                        if payload["drift_summary"] else "skipped"))
    print(f"[fine_tune] {name}: saved {wpath}  metrics={metrics}")
    return payload


FINE_TUNERS = {"fraud": fine_tune_fraud, "credit": fine_tune_credit,
               "gnn": fine_tune_gnn}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", choices=["fraud", "credit", "gnn", "all"],
                    required=True)
    ap.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    ap.add_argument("--weights-dir", default=WEIGHTS_DIR)
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--lr", type=float, default=1e-4,
                    help="lower LR for fine-tuning (default 1e-4)")
    ap.add_argument("--batch-seed", type=int, default=777,
                    help="seed for the synthetic 'new batch' fallback")
    args = ap.parse_args()

    models = ["fraud", "credit", "gnn"] if args.model == "all" else [args.model]
    for m in models:
        print(f"\n[fine_tune] === {m} ===")
        wpath = os.path.join(args.weights_dir, f"{m}_net.pt")
        if not os.path.exists(wpath):
            print(f"[fine_tune] no base weights at {wpath} — run "
                  f"`python -m ml.training.train --model {m}` first; skipping")
            continue
        batch, source = get_new_batch(m, args.data_dir, args.batch_seed)
        # MLflow tracking: no-op unless mlflow installed + MLFLOW_TRACKING_URI
        with track_run(m, params={"mode": "fine_tune", "epochs": args.epochs,
                                  "lr": args.lr, "data_source": source},
                       tags={"mode": "fine_tune"}) as run:
            payload = FINE_TUNERS[m](batch, source, args.epochs, args.lr,
                                     args.weights_dir)
            run.log_metrics(payload["metrics"])
            run.log_artifact(payload["weights_path"])


if __name__ == "__main__":
    main()
