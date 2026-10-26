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
                                        NODE_FEATURE_DIM, SECTORS, generate)
from ml.monitoring.drift import (compute_feature_stats, drift_report,
                                 load_feature_stats, persist_drift_alerts,
                                 save_feature_stats)
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

# Officer verdicts on fraud_alerts (ml/validation/verdict_ingest.py, dataset
# 'verdict_cases') override the raw fraud_flagged heuristic: they outrank it
# (weight 2.0) but stay below externally adjudicated real cases (3.0), so a
# single verdict never dominates a batch.
VERDICT_CASE_WEIGHT = 2.0


def _verdict_labels_enabled() -> bool:
    return os.environ.get("VERDICT_LABELS_ENABLED", "1").lower() \
        not in ("0", "false", "no")


def _maybe_ingest_verdicts() -> None:
    """Incrementally ingest new fraud_alerts verdicts (fail-open).

    Called at the top of the fraud branch, BEFORE the batch is assembled, so
    freshly-resolved verdicts are merged in the same cycle. Training must
    never hard-fail because verdicts are absent or the DB is down.
    """
    if not _verdict_labels_enabled():
        return
    try:
        from ml.validation.verdict_ingest import ingest_verdicts
        ingest_verdicts()
    except Exception as e:
        print(f"[fine_tune] WARNING: verdict ingest failed ({e}) — "
              "continuing without new verdict labels")


def _merge_verdict_cases(tx: pd.DataFrame) -> pd.DataFrame:
    """Merge officer-verdict-labeled cases into a training batch.

    Mirrors _merge_real_cases: sample_weight VERDICT_CASE_WEIGHT for verdict
    rows, existing weight (real cases stay at 3.0) otherwise. No-op when the
    flag is off or no verdicts have been ingested yet.
    """
    if not _verdict_labels_enabled():
        return tx
    if "sample_weight" not in tx.columns:
        tx = tx.copy()
        tx["sample_weight"] = 1.0
    try:
        from ml.validation.verdict_ingest import load_verdict_cases
        verdicts = load_verdict_cases()
    except Exception as e:
        print(f"[fine_tune] WARNING: verdict-case load skipped: {e}")
        return tx
    if verdicts is None or not len(verdicts):
        return tx
    keep = [c for c in ["timestamp", "is_fraud", *FRAUD_FEATURES]
            if c in verdicts.columns]
    verdicts = verdicts[keep].copy()
    verdicts["sample_weight"] = VERDICT_CASE_WEIGHT
    for col in ["timestamp", "is_fraud", *FRAUD_FEATURES]:
        if col not in tx.columns:
            tx[col] = np.nan
    merged = pd.concat([tx[["timestamp", "is_fraud", *FRAUD_FEATURES,
                            "sample_weight"]], verdicts], ignore_index=True)
    print(f"[fine_tune] merged {len(verdicts)} officer-verdict fraud cases "
          f"(weight={VERDICT_CASE_WEIGHT}x) into the training batch")
    return merged


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
            # LABEL LEAKAGE FIX (round-9): the previous label
            #   default_24m = (penalties_count_24m > 2)
            # was a deterministic function of an INPUT FEATURE — the model
            # "learned" the threshold and evaluation metrics were meaningless.
            # Now the windows are DISJOINT: all input features are computed on
            # the PRIOR window (24–48 months ago) and the label on the OUTCOME
            # window (most recent 24 months). The label can never be derived
            # from any feature because the feature set contains no
            # outcome-window aggregates.
            cur.execute("""
                SELECT o.id::text, o.sector,
                       COALESCE(v.cnt, 0)     AS violations_count_24m,
                       COALESCE(p_feat.cnt, 0)  AS penalties_count_24m,
                       COALESCE(p_feat.total, 0) AS total_fines,
                       COALESCE(b.cnt, 0)     AS breach_incidents_24m,
                       COALESCE(p_out.cnt, 0) AS outcome_penalties_24m
                FROM organizations o
                -- feature window: 24–48 months ago (prior behaviour)
                LEFT JOIN (SELECT organization_id, COUNT(*) cnt
                           FROM compliance_violations
                           WHERE created_at >= NOW() - INTERVAL '48 months'
                             AND created_at <  NOW() - INTERVAL '24 months'
                           GROUP BY organization_id) v ON v.organization_id = o.id
                LEFT JOIN (SELECT organization_id, COUNT(*) cnt, SUM(amount) total
                           FROM financial_penalties
                           WHERE created_at >= NOW() - INTERVAL '48 months'
                             AND created_at <  NOW() - INTERVAL '24 months'
                           GROUP BY organization_id) p_feat ON p_feat.organization_id = o.id
                LEFT JOIN (SELECT organization_id, COUNT(*) cnt
                           FROM breach_incidents
                           WHERE created_at >= NOW() - INTERVAL '48 months'
                             AND created_at <  NOW() - INTERVAL '24 months'
                           GROUP BY organization_id) b ON b.organization_id = o.id
                -- outcome window: most recent 24 months (the label source)
                LEFT JOIN (SELECT organization_id, COUNT(*) cnt
                           FROM financial_penalties
                           WHERE created_at >= NOW() - INTERVAL '24 months'
                           GROUP BY organization_id) p_out ON p_out.organization_id = o.id
            """)
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
        df = pd.DataFrame(rows, columns=cols)
        if len(df) < 30:
            print(f"[fine_tune] only {len(df)} orgs in DB — too few, "
                  "using synthetic batch")
            return None
        # Outcome label from the disjoint future window — NOT derivable from
        # any input feature (features are all prior-window aggregates).
        df["default_24m"] = (df["outcome_penalties_24m"] > 2).astype(int)
        df = df.drop(columns=["outcome_penalties_24m"])  # never feed label source as a feature
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


MIN_ROWS_REAL_BATCH = 30  # below this a real extract is not trainable


def _db_connect():
    """Connect to the platform DB (fail closed — no embedded credentials)."""
    dsn = (os.environ.get("DATABASE_URL") or os.environ.get("WORKER_DATABASE_URL"))
    if not dsn:
        return None
    import psycopg2
    return psycopg2.connect(dsn, connect_timeout=3)


def fetch_fraud_from_db() -> tuple[pd.DataFrame, int] | None:
    """Extract NEW NIP transactions (id > watermark) as a fraud batch.

    READ-ONLY, incremental via the lakehouse watermark 'nip_transactions'
    (max id already extracted). Features are engineered with the SAME
    function used at train time (engineer_fraud_features) so distributions
    match training. Labels come from the platform's fraud_flagged column.

    Returns (df, new_watermark) — the caller advances the watermark ONLY
    after the fine-tune run has been persisted successfully. Returns None
    when the DB is unreachable or yields too few new rows (caller falls
    back to a labelled synthetic batch).
    """
    from ml.data.generate_synthetic import engineer_fraud_features
    watermark = lakehouse.load_watermark("nip_transactions") or 0
    try:
        conn = _db_connect()
        if conn is None:
            print("[fine_tune] DATABASE_URL not set — fraud: synthetic batch")
            return None
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, amount, channel_code, fraud_flagged, status,
                           sender_account_number, receiver_account_number,
                           created_at
                    FROM nip_transactions
                    WHERE id > %s
                    ORDER BY id
                    LIMIT 50000
                """, (int(watermark),))
                rows = cur.fetchall()
                cols = [d[0] for d in cur.description]
        finally:
            conn.close()
    except Exception as e:
        print(f"[fine_tune] fraud DB extract failed ({e}) — synthetic batch")
        return None
    if len(rows) < MIN_ROWS_REAL_BATCH:
        print(f"[fine_tune] only {len(rows)} new nip_transactions since "
              f"watermark {watermark} — too few, synthetic batch")
        return None
    df = pd.DataFrame(rows, columns=cols)
    new_watermark = int(df["id"].max())
    tx = pd.DataFrame({
        "tx_id": df["id"].astype(str).map(lambda s: f"NIP-{s}"),
        "timestamp": pd.to_datetime(df["created_at"]),
        "sender_org": df["sender_account_number"].fillna("unknown"),
        "receiver_org": df["receiver_account_number"].fillna("unknown"),
        "amount_naira": df["amount"].astype(float) / 100.0,  # kobo → naira
        "channel": df["channel_code"].fillna("other"),
        "is_fraud": df["fraud_flagged"].fillna(False).astype(int),
    })
    tx = engineer_fraud_features(tx)
    # Features with no platform source are zero-filled (≈ train-mean after
    # standardisation — documented neutral default).
    for f in ["new_device", "new_location", "mule_hop", "is_insider_ring"]:
        if f not in tx.columns:
            tx[f] = 0.0
    print(f"[fine_tune] fraud: {len(tx)} real NIP transactions "
          f"(id {watermark}..{new_watermark}, "
          f"fraud rate={tx['is_fraud'].mean():.4%})")
    return tx, new_watermark


_SECTOR_MAP = {"bank": "bank", "fintech": "fintech", "telco": "telco",
               "telecom": "telco", "insurance": "insurance", "mfb": "mfb",
               "microfinance": "mfb", "psp": "psp", "payment": "psp"}
_SEVERITY_NUM = {"critical": 2.0, "high": 1.4, "medium": 1.0, "low": 0.5}


def _map_sector(sector: str | None) -> str | None:
    s = (sector or "").lower()
    for key, canon in _SECTOR_MAP.items():
        if key in s:
            return canon
    return None


def fetch_gnn_from_db() -> tuple[dict, str] | str | None:
    """Build graph_nodes/graph_edges/graph_labels frames from real platform
    tables (organizations, compliance_violations, enforcement_actions).

    Feature semantics mirror generate_synthetic.gen_graph:
      f0..f3   node-type one-hot (org / violation / enforcement / officer)
      f4..f13  standardised CREDIT_FEATURES (org nodes); severity otherwise
      f14..f19 sector one-hot over SECTORS

    Watermark 'graph_tables' = max created_at across the source tables;
    when nothing changed since the last extract, returns the string
    "no_new_data" so the caller can SKIP the cycle instead of retraining
    on identical data. Returns None on DB failure (synthetic fallback).
    """
    try:
        conn = _db_connect()
        if conn is None:
            print("[fine_tune] DATABASE_URL not set — gnn: synthetic batch")
            return None
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT GREATEST(
                        (SELECT MAX(created_at) FROM organizations),
                        (SELECT MAX(created_at) FROM compliance_violations),
                        (SELECT MAX(created_at) FROM enforcement_actions)
                    )::text
                """)
                max_ts = cur.fetchone()[0]
                if max_ts is None:
                    return None
                watermark = lakehouse.load_watermark("graph_tables")
                if watermark and str(max_ts) <= str(watermark):
                    print(f"[fine_tune] gnn: no new graph data since "
                          f"{watermark} — skipping extract")
                    return "no_new_data"

                # Org credit features (same aggregates as fetch_credit_from_db,
                # 24-month window — these are FEATURES here, not labels).
                cur.execute("""
                    SELECT o.id, o.sector, o.compliance_score,
                           COALESCE(v.cnt, 0) AS violations_count_24m,
                           COALESCE(p.cnt, 0) AS penalties_count_24m,
                           COALESCE(p.total, 0) AS total_fines,
                           COALESCE(b.cnt, 0) AS breach_incidents_24m
                    FROM organizations o
                    LEFT JOIN (SELECT organization_id, COUNT(*) cnt
                               FROM compliance_violations
                               WHERE created_at >= NOW() - INTERVAL '24 months'
                               GROUP BY organization_id) v
                        ON v.organization_id = o.id
                    LEFT JOIN (SELECT organization_id, COUNT(*) cnt, SUM(amount) total
                               FROM financial_penalties
                               WHERE created_at >= NOW() - INTERVAL '24 months'
                               GROUP BY organization_id) p
                        ON p.organization_id = o.id
                    LEFT JOIN (SELECT organization_id, COUNT(*) cnt
                               FROM breach_incidents
                               WHERE created_at >= NOW() - INTERVAL '24 months'
                               GROUP BY organization_id) b
                        ON b.organization_id = o.id
                    ORDER BY o.id LIMIT 20000
                """)
                orgs = cur.fetchall()

                cur.execute("""
                    SELECT id, organization_id, severity, created_at::text
                    FROM compliance_violations ORDER BY id LIMIT 50000
                """)
                violations = cur.fetchall()
                cur.execute("""
                    SELECT id, organization_id, created_at::text
                    FROM enforcement_actions ORDER BY id LIMIT 50000
                """)
                enforcements = cur.fetchall()
        finally:
            conn.close()
    except Exception as e:
        print(f"[fine_tune] gnn DB extract failed ({e}) — synthetic batch")
        return None

    if len(orgs) < MIN_ROWS_REAL_BATCH:
        print(f"[fine_tune] only {len(orgs)} orgs in DB — gnn: synthetic batch")
        return None

    org_ids = [o[0] for o in orgs]
    org_idx = {oid: i for i, oid in enumerate(org_ids)}
    # Standardised credit-style features per org (f4..f13)
    Xc = np.zeros((len(orgs), 10))
    for i, (_oid, _sec, cscore, vcnt, pcnt, ptotal, bcnt) in enumerate(orgs):
        Xc[i] = [np.log1p(max(vcnt, 0)), pcnt, np.log1p(max(ptotal or 0, 0)),
                 float(cscore or 50), vcnt, bcnt, 0.0, 0.0, 0.0, 0.0]
    Xc = (Xc - Xc.mean(axis=0)) / (Xc.std(axis=0) + 1e-9)

    nodes, edges, labels = [], [], []
    for i, (oid, sector, *_rest) in enumerate(orgs):
        feat = np.zeros(NODE_FEATURE_DIM)
        feat[0] = 1.0
        feat[4:14] = Xc[i]
        canon = _map_sector(sector)
        if canon in SECTORS:
            feat[14 + SECTORS.index(canon)] = 1.0
        nodes.append({"node_id": i, "ref_id": f"ORG-{oid}",
                      "node_type": "organization",
                      **{f"f{j}": float(feat[j]) for j in range(NODE_FEATURE_DIM)}})

    node_idx = len(orgs)
    risk_latent = np.zeros(len(orgs))
    for vid, oid, severity, _ts in violations:
        if oid not in org_idx:
            continue
        feat = np.zeros(NODE_FEATURE_DIM)
        feat[1] = 1.0
        feat[4] = _SEVERITY_NUM.get((severity or "medium").lower(), 1.0)
        nodes.append({"node_id": node_idx, "ref_id": f"VIO-{vid}",
                      "node_type": "violation",
                      **{f"f{j}": float(feat[j]) for j in range(NODE_FEATURE_DIM)}})
        edges.append({"src": org_idx[oid], "dst": node_idx,
                      "edge_type": "HAS_VIOLATION"})
        risk_latent[org_idx[oid]] += 1.0
        node_idx += 1
    for eid, oid, _ts in enforcements:
        if oid not in org_idx:
            continue
        feat = np.zeros(NODE_FEATURE_DIM)
        feat[2] = 1.0
        feat[4] = 1.4
        nodes.append({"node_id": node_idx, "ref_id": f"ENF-{eid}",
                      "node_type": "enforcement_action",
                      **{f"f{j}": float(feat[j]) for j in range(NODE_FEATURE_DIM)}})
        edges.append({"src": node_idx, "dst": org_idx[oid],
                      "edge_type": "ENFORCED_BY"})
        risk_latent[org_idx[oid]] += 2.5
        node_idx += 1

    for i, oid in enumerate(org_ids):
        # Label from the org's OWN recorded enforcement/violation burden —
        # the same neighbourhood-derived signal the synthetic generator uses.
        labels.append({"org_id": f"ORG-{oid}", "node_id": i,
                       "high_risk": int(risk_latent[i] >= 2.5),
                       "risk_latent": float(risk_latent[i])})

    print(f"[fine_tune] gnn: real graph from platform tables — "
          f"{len(nodes)} nodes, {len(edges)} edges, "
          f"high-risk rate={np.mean([l['high_risk'] for l in labels]):.2%}")
    return {"graph_nodes": pd.DataFrame(nodes),
            "graph_edges": pd.DataFrame(edges),
            "graph_labels": pd.DataFrame(labels)}, str(max_ts)


def _advance_watermark(model: str, batch: dict) -> None:
    """Persist extraction watermarks AFTER a successful fine-tune run, so a
    failed run re-reads the same rows next cycle (no data loss)."""
    wm = batch.get("_watermark")
    if not wm:
        return
    name, value = wm
    lakehouse.save_watermark(name, value)
    print(f"[fine_tune] watermark advanced: {name} -> {value}")


def get_new_batch(model: str, data_dir: str, batch_seed: int) -> tuple[dict | None, str]:
    """Return dict of DataFrames for the requested model + source label.

    Real platform tables (PostgreSQL) are preferred, extracted incrementally
    via lakehouse watermarks. Returns (None, "no_new_data") when the real
    source has not changed since the last extract. Only when the real source
    is UNREACHABLE (or too small) does it fall back to a synthetic batch —
    always explicitly labelled synthetic_batch_seed_<seed> and flagged via
    the `synthetic_fallback` key so metrics consumers can tell.
    """
    if model == "credit":
        db_df = fetch_credit_from_db()
        if db_df is not None:
            return {"credit_features": db_df,
                    "synthetic_fallback": False}, "postgres:compliance_tables"
    elif model == "fraud":
        # Ingest newly-resolved officer verdicts FIRST, so they are merged
        # into this same batch (fail-open; see _maybe_ingest_verdicts).
        _maybe_ingest_verdicts()
        res = fetch_fraud_from_db()
        if res is not None:
            df, wm = res
            return {"transactions": _merge_verdict_cases(_merge_real_cases(df)),
                    "synthetic_fallback": False,
                    "_watermark": ("nip_transactions", wm)}, "postgres:nip_transactions"
    elif model == "gnn":
        res = fetch_gnn_from_db()
        if res == "no_new_data":
            return None, "no_new_data"
        if res is not None:
            batch, max_ts = res
            batch["synthetic_fallback"] = False
            batch["_watermark"] = ("graph_tables", max_ts)
            return batch, "postgres:graph_tables"
    # synthetic "new" batch: same generator, different seed
    tmp_dir = os.path.join(data_dir, f"_ft_{batch_seed}")
    generate(tmp_dir, n_transactions=40_000, n_orgs=600, seed=batch_seed)
    out = {"synthetic_fallback": True}
    need = {"fraud": ["transactions"],
            "credit": ["credit_features"],
            "gnn": ["graph_nodes", "graph_edges", "graph_labels"]}[model]
    for name in need:
        out[name] = pd.read_parquet(os.path.join(tmp_dir, f"{name}.parquet")) \
            if os.path.exists(os.path.join(tmp_dir, f"{name}.parquet")) \
            else pd.read_csv(os.path.join(tmp_dir, f"{name}.csv"))
    if model == "fraud" and "transactions" in out:
        out["transactions"] = _merge_verdict_cases(
            _merge_real_cases(out["transactions"]))
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
    # Persist drift alerts (migration 0109); continuous.py consumes them as
    # retraining triggers via consume_retrain_trigger().
    for f, r in rep["features"].items():
        if r.get("status") == "drifted":
            print(f"    DRIFT  {f}: psi={r['psi']} ks_p={r['ks_pvalue']}")
    n_alerts = persist_drift_alerts(model, rep)
    if n_alerts:
        print(f"[fine_tune] persisted {n_alerts} drift alert(s) to compliance_drift_alerts")
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
    payload = _save_versioned(model, "fraud", metrics, source, drift, weights_dir,
                              stats_df=tx, stats_features=FRAUD_FEATURES,
                              synthetic_fallback=bool(batch.get("synthetic_fallback")))
    _advance_watermark("fraud", batch)
    return payload


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
    payload = _save_versioned(model, "credit", metrics, source, drift, weights_dir,
                              stats_df=cr, stats_features=[f for f in CREDIT_FEATURES if f in cr.columns],
                              synthetic_fallback=bool(batch.get("synthetic_fallback")))
    _advance_watermark("credit", batch)
    return payload


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
    feat_cols = [f"f{i}" for i in range(NODE_FEATURE_DIM)]
    org_feats = nodes[nodes["node_type"] == "organization"]
    payload = _save_versioned(model, "gnn", metrics, source, drift, weights_dir,
                              stats_df=org_feats, stats_features=feat_cols,
                              synthetic_fallback=bool(batch.get("synthetic_fallback")))
    _advance_watermark("gnn", batch)
    return payload


def _save_versioned(model, name: str, metrics: dict, source: str,
                    drift: dict, weights_dir: str,
                    stats_df: pd.DataFrame | None = None,
                    stats_features: list[str] | None = None,
                    synthetic_fallback: bool | None = None) -> dict:
    version = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    wpath = os.path.join(weights_dir, f"{name}_net_{version}.pt")
    model.save(wpath)
    # Per-version feature stats (round-9): inference must standardise with the
    # stats of the version actually serving, not the (possibly stale) canonical
    # stats — A/B challengers previously inherited the champion's stats.
    if stats_df is not None and stats_features:
        vstats = compute_feature_stats(stats_df, stats_features)
        for f in stats_features:
            col = pd.to_numeric(stats_df[f], errors="coerce").dropna()
            if len(col):
                vstats.setdefault("feature_means", {})[f] = float(col.mean())
                vstats.setdefault("feature_stds", {})[f] = float(col.std() + 1e-9)
        save_feature_stats(vstats, os.path.join(
            weights_dir, f"{name}_net_{version}_feature_stats.json"))
    payload = {"model": name, "version": version, "mode": "fine_tune",
               "data_source": source,
               # Explicit synthetic-fallback flag (round-9): metrics consumers
               # must be able to tell a real platform batch from a synthetic
               # one without parsing the source label.
               "synthetic_fallback": (bool(synthetic_fallback)
                                      if synthetic_fallback is not None
                                      else source.startswith("synthetic")),
               "metrics": metrics,
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
