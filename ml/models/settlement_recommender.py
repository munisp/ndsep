#!/usr/bin/env python3
"""Settlement-terms recommender trainer (round 12, wave 8 — roadmap P2).

Learns P(fulfilled) for a proposed settlement term sheet from the Wave-5
settlement outcome labels (ml/lakehouse/labels/settlement_outcome — built
by ml/labels/case_outcome_labels.py from terminal settlements +
settlement_terms).

Features (all derivable from a PROPOSED term sheet at serve time, so the
serving path — server/services/settlementRecommender.ts, pure TS over the
exported JSON artifact — can reproduce them exactly):

    log_monetary_amount   log1p of the agreed monetary amount (NGN)
    n_instalments         instalment count of the proposed schedule
    n_obligations         non-monetary obligation count
    confidential          confidentiality flag (0/1)
    reduction_ratio       reduction_amount / original_amount in [0,1]
    duration_days         first-to-last instalment due-date span (0 if n/a)
    org_size_score        declared data-volume class ordinal (0.1..1.0)
    sector=<level>        one-hot over observed org sectors (+ 'unknown')

Org sector/size are OPTIONAL enrichments: the trainer joins the label
frame's pseudonymous org_hash back to organizations (via the same salted
pseudonym, org:<id>) when a DB is reachable; without a DB the model trains
on the terms-derived features only and the artifact records which feature
set was used. The TS scorer reads the artifact's feature list — a feature
absent from the artifact is simply not computed at serve time.

PRIVACY (fail-closed): the label frame is already pseudonymized; this
trainer additionally REFUSES any frame carrying raw identifier columns
(ml/models/hgb_json.assert_no_raw_identifiers) and never emits org ids —
only hashed joins and aggregate metrics.

    python -m ml.models.settlement_recommender          # train from lakehouse
"""

from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

from ml.labels.case_outcome_labels import pseudonymize
from ml.models import hgb_json
from ml.training import lakehouse

MODEL_NAME = "settlement_recommender"
ARTIFACT_NAME = "settlement_recommender.json"
LABEL_DATASET = "labels/settlement_outcome"

# Base features always derivable from settlement_terms / the labels frame.
BASE_FEATURES = [
    "log_monetary_amount",
    "n_instalments",
    "n_obligations",
    "confidential",
    "reduction_ratio",
]
# Optional enrichments (require a DB join through org_hash).
ENRICHED_FEATURES = ["duration_days", "org_size_score"]
SECTOR_COL = "sector"

DATA_VOLUME_SCORE = {"low": 0.1, "medium": 0.4, "high": 0.7,
                     "very_high": 1.0}
MIN_SAMPLES = 20  # below this the artifact is written but flagged unusable


def weights_dir() -> str:
    return os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "weights")


# --------------------------------------------------------------------------- #
# Feature building
# --------------------------------------------------------------------------- #
def build_base_features(labels: pd.DataFrame) -> pd.DataFrame:
    """Terms-derived features from a settlement outcome label frame."""
    df = pd.DataFrame(index=labels.index)
    df["log_monetary_amount"] = np.log1p(
        pd.to_numeric(labels.get("monetary_amount"), errors="coerce")
        .fillna(0.0).clip(lower=0))
    df["n_instalments"] = pd.to_numeric(
        labels.get("n_instalments"), errors="coerce").fillna(0).clip(0, 36)
    df["n_obligations"] = pd.to_numeric(
        labels.get("n_obligations"), errors="coerce").fillna(0).clip(0, 50)
    df["confidential"] = pd.to_numeric(
        labels.get("confidential"), errors="coerce").fillna(0).clip(0, 1)
    df["reduction_ratio"] = pd.to_numeric(
        labels.get("reduction_ratio"), errors="coerce").fillna(0).clip(0, 1)
    return df


def _db_connect():
    dsn = (os.environ.get("DATABASE_URL") or os.environ.get("WORKER_DATABASE_URL"))
    if not dsn:
        return None
    import psycopg2
    return psycopg2.connect(dsn, connect_timeout=3)


def enrich_from_db(labels: pd.DataFrame) -> pd.DataFrame:
    """Optional org sector/size + schedule-duration enrichment.

    Joins on the PSEUDONYMIZED org_hash (sha256(salt:org:<id>)) — the same
    pseudonym ml/labels/case_outcome_labels.py emitted — so no raw org
    identifier ever enters the training frame. Returns None when the DB is
    unreachable or the join yields nothing (trainer then falls back to base
    features and the artifact records the reduced feature set).
    """
    conn = _db_connect()
    if conn is None or "org_hash" not in labels.columns:
        return None
    try:
        with conn.cursor() as cur:
            # Duration: span of the CURRENT terms version's instalment dates.
            cur.execute(
                """SELECT s.id AS settlement_pk, s.org_id, s.settlement_ref,
                          o.sector, o.data_volume_class
                   FROM settlements s
                   LEFT JOIN organizations o ON o.id = s.org_id""")
            org_rows = cur.fetchall()
            cur.execute(
                """SELECT DISTINCT ON (t.settlement_id)
                          t.settlement_id, t.instalment_schedule
                   FROM settlement_terms t
                   ORDER BY t.settlement_id, t.version DESC""")
            term_rows = cur.fetchall()
    except Exception as e:
        print(f"[settlement_recommender] enrichment skipped: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass

    org_by_hash = {}
    for pk, org_id, _ref, sector, dvc in org_rows:
        org_by_hash[pseudonymize(f"org:{org_id}")] = {
            "sector": (str(sector).strip().lower() if sector else "unknown"),
            "org_size_score": DATA_VOLUME_SCORE.get(
                str(dvc).strip().lower(), 0.4) if dvc else 0.4,
            "settlement_pk": pk,
        }
    dur_by_pk = {}
    for sid, schedule in term_rows:
        days = 0.0
        try:
            sched = schedule if isinstance(schedule, list) \
                else json.loads(schedule or "[]")
            dates = sorted(pd.to_datetime(
                [i.get("dueDate") or i.get("due_date") for i in sched],
                errors="coerce").dropna())
            if len(dates) >= 2:
                days = float((dates[-1] - dates[0]).days)
        except Exception:
            days = 0.0
        dur_by_pk[sid] = days

    out = labels.copy()
    meta = out["org_hash"].map(org_by_hash)
    out["sector"] = meta.map(
        lambda m: m["sector"] if isinstance(m, dict) else "unknown")
    out["org_size_score"] = meta.map(
        lambda m: m["org_size_score"] if isinstance(m, dict) else 0.4)
    out["duration_days"] = meta.map(
        lambda m: dur_by_pk.get(m["settlement_pk"], 0.0)
        if isinstance(m, dict) else 0.0)
    matched = int(meta.map(lambda m: isinstance(m, dict)).sum())
    print(f"[settlement_recommender] DB enrichment matched {matched}/"
          f"{len(out)} label rows")
    return out if matched else None


def design_matrix(df: pd.DataFrame, sector_levels: list[str] | None = None):
    """Build (X, feature_names, levels) with one-hot sector expansion."""
    parts = []
    names = []
    for col in BASE_FEATURES:
        parts.append(pd.to_numeric(df[col], errors="coerce")
                     .fillna(0.0).to_numpy(dtype=float))
        names.append(col)
    for col in ENRICHED_FEATURES:
        if col in df.columns:
            parts.append(pd.to_numeric(df[col], errors="coerce")
                         .fillna(0.0).to_numpy(dtype=float))
            names.append(col)
    levels: list[str] = []
    if SECTOR_COL in df.columns:
        sec = df[SECTOR_COL].fillna("unknown").astype(str).str.lower()
        levels = sector_levels or sorted(sec.unique().tolist())
        if "unknown" not in levels:
            levels = [*levels, "unknown"]
        for level in levels:
            parts.append((sec == level).astype(float).to_numpy())
            names.append(f"sector={level}")
    X = np.column_stack(parts) if parts else np.empty((len(df), 0))
    return X, names, levels


# --------------------------------------------------------------------------- #
# Training
# --------------------------------------------------------------------------- #
def train(frame: pd.DataFrame, min_samples: int = MIN_SAMPLES,
          seed: int = 42) -> dict:
    """Train on a prepared label frame (base cols, optionally enriched).

    Pure-function entry point (tests use synthetic frames — no DB, no
    lakehouse). Fail-closed: refuses frames with raw identifier columns and
    frames without the settled_fulfilled label.
    """
    hgb_json.assert_no_raw_identifiers(frame.columns, MODEL_NAME)
    if "settled_fulfilled" not in frame.columns:
        raise RuntimeError(f"[{MODEL_NAME}] frame lacks settled_fulfilled label")
    df = frame[frame["settled_fulfilled"].notna()].copy()
    y = df["settled_fulfilled"].astype(int).to_numpy()
    if len(df) < 2 or len(np.unique(y)) < 2:
        raise RuntimeError(
            f"[{MODEL_NAME}] need >=2 rows with both classes, got "
            f"{len(df)} rows / {len(np.unique(y))} class(es)")

    base = build_base_features(df)
    for col in (*ENRICHED_FEATURES, SECTOR_COL):
        if col in df.columns:
            base[col] = df[col]
    X, feature_names, sector_levels = design_matrix(base)
    clf = hgb_json.fit_hgb(X, y, seed=seed)

    # Holdout metrics when the frame is large enough, else in-sample
    # (flagged) — a tiny synthetic/early-production frame must never block
    # artifact production, but the metrics must say what they are.
    metrics: dict = {"n_samples": int(len(df)),
                     "n_positive": int(y.sum()),
                     "class_balance": float(y.mean())}
    from sklearn.metrics import log_loss, roc_auc_score
    proba = clf.predict_proba(X)[:, 1]
    metrics["logloss_insample"] = float(log_loss(y, proba, labels=[0, 1]))
    metrics["auc_insample"] = float(roc_auc_score(y, proba))
    if len(df) >= 40:
        from sklearn.model_selection import train_test_split
        Xtr, Xte, ytr, yte = train_test_split(
            X, y, test_size=0.25, random_state=seed, stratify=y)
        hold = hgb_json.fit_hgb(Xtr, ytr, seed=seed)
        pte = hold.predict_proba(Xte)[:, 1]
        metrics["auc_holdout"] = float(roc_auc_score(yte, pte))
        metrics["logloss_holdout"] = float(log_loss(yte, pte, labels=[0, 1]))

    artifact = hgb_json.build_artifact(
        MODEL_NAME, clf, feature_names,
        {SECTOR_COL: sector_levels} if SECTOR_COL in base.columns else {},
        metrics, sample_size=len(df))
    artifact["usable"] = bool(len(df) >= min_samples)
    if not artifact["usable"]:
        artifact["warning"] = (
            f"trained on {len(df)} samples (< {min_samples}) — treat "
            "probabilities as provisional until more outcomes land")
    return artifact


def save_artifact_to(artifact: dict, artifact_name: str, model_name: str,
                     out_dir: str | None = None) -> str:
    """Write any wave-8 HGB artifact into ml/weights/."""
    out_dir = out_dir or weights_dir()
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, artifact_name)
    with open(path, "w") as f:
        json.dump(artifact, f, indent=1)
    print(f"[{model_name}] artifact -> {path} "
          f"({artifact['sample_size']} samples, "
          f"{len(artifact['features'])} features)")
    return path


def save_artifact(artifact: dict, out_dir: str | None = None) -> str:
    return save_artifact_to(artifact, ARTIFACT_NAME, MODEL_NAME, out_dir)


def train_from_lakehouse(root: str = lakehouse.DEFAULT_ROOT,
                         seed: int = 42) -> dict | None:
    """Production path: latest settlement labels snapshot -> artifact."""
    try:
        labels = lakehouse.load_latest(LABEL_DATASET, root=root)
    except FileNotFoundError:
        print(f"[{MODEL_NAME}] no {LABEL_DATASET} snapshot — run "
              "ml.labels.case_outcome_labels first")
        return None
    enriched = enrich_from_db(labels)
    frame = enriched if enriched is not None else labels
    artifact = train(frame, seed=seed)
    artifact["enriched"] = enriched is not None
    save_artifact(artifact)
    return artifact


def main() -> int:
    return 0 if train_from_lakehouse() is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
