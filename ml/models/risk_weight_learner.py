#!/usr/bin/env python3
"""Learned supervision risk weights (round 12, wave 8 — roadmap P2).

Learns the six supervisionRisk factor weights
(complaint_volume, complaint_surge, scan_findings, prior_sanctions,
filing_delinquency, data_volume_class) from prior outcomes instead of the
hand-seeded constants in server/services/supervisionRiskScoring.ts.

Training frame (DB, defensive): every risk_score_inputs row (the inputs
jsonb captured by supervisionRisk.scoreOrganization / computeRiskScores)
labelled by whether the same org attracted a NEW published/remediated
enforcement_notices row within `window_days` AFTER the inputs were
collected. Features = the inputs normalised EXACTLY as
supervisionRiskScoring.normalizeInputs does (same caps / class scores) —
the learned weights only make sense against that normalisation, and the
serving path (server/services/riskWeights.ts) swaps weights only, never
the normalisation.

Model: plain logistic regression. The learned weight for factor i is
|coef_i| renormalised to sum to 1 (with a small floor so a factor whose
source exists is never silently zeroed by the learner; zeroing on missing
SOURCES stays the router's job — renormalizeWeightsForAvailability).

Outputs:
  1. ml/weights/learned_risk_weights.json (version, weights, metrics,
     sample_size) — the artifact server/services/riskWeights.ts falls back
     to when no ACTIVE DB row exists.
  2. A row in learned_risk_weights (migration 0137) with active=false.
     Activation is deliberate, via SQL only (no admin UI):
         UPDATE learned_risk_weights SET active = true
         WHERE version = '<version>';
     server/services/riskWeights.getActiveWeights() honours an active row
     only when it is fresh (< 30 days) and complete — otherwise it fails
     closed to the hand-seeded DEFAULT_RISK_WEIGHTS.

PRIVACY (fail-closed): refuses frames with raw identifier columns; org ids
never leave the frame (only per-org feature/label rows are kept).
"""

from __future__ import annotations

import json
import os
from datetime import datetime

import numpy as np
import pandas as pd

from ml.models import hgb_json
from ml.models.settlement_recommender import weights_dir

MODEL_NAME = "learned_risk_weights"
ARTIFACT_NAME = "learned_risk_weights.json"
TABLE = "learned_risk_weights"

# Factor keys — MUST stay in sync with RISK_FACTOR_KEYS in
# server/services/supervisionRiskScoring.ts (the TS service validates the
# learned vector covers exactly these keys before honouring it).
RISK_FACTOR_KEYS = [
    "complaint_volume",
    "complaint_surge",
    "scan_findings",
    "prior_sanctions",
    "filing_delinquency",
    "data_volume_class",
]

# Mirror of NORMALIZATION_CAPS / DATA_VOLUME_CLASS_SCORE in
# server/services/supervisionRiskScoring.ts.
NORMALIZATION_CAPS = {
    "complaintVolume": 50.0,
    "scanFindingsWeighted": 25.0,
    "priorSanctions": 5.0,
    "filingDelinquencyDays": 180.0,
}
DATA_VOLUME_CLASS_SCORE = {"low": 0.1, "medium": 0.4, "high": 0.7,
                           "very_high": 1.0}

DEFAULT_WINDOW_DAYS = 180
WEIGHT_FLOOR = 0.02  # a sourced factor is never learned to dead zero
MIN_SAMPLES = 30


# --------------------------------------------------------------------------- #
# Normalisation (mirrors supervisionRiskScoring.normalizeInputs)
# --------------------------------------------------------------------------- #
def normalize_inputs(frame: pd.DataFrame) -> pd.DataFrame:
    """raw inputs jsonb columns -> [0,1] factor columns (router semantics)."""
    def col(name):
        if name in frame.columns:
            return pd.to_numeric(frame[name], errors="coerce").fillna(0.0)
        return pd.Series(np.zeros(len(frame)), index=frame.index)

    out = pd.DataFrame(index=frame.index)
    out["complaint_volume"] = (
        col("complaintVolume") / NORMALIZATION_CAPS["complaintVolume"]
    ).clip(0, 1)
    surge = frame.get("complaintSurge")
    out["complaint_surge"] = (surge.fillna(False).astype(bool).astype(float)
                              if surge is not None else 0.0)
    out["scan_findings"] = (
        col("scanFindingsWeighted") / NORMALIZATION_CAPS["scanFindingsWeighted"]
    ).clip(0, 1)
    out["prior_sanctions"] = (
        col("priorSanctions") / NORMALIZATION_CAPS["priorSanctions"]
    ).clip(0, 1)
    out["filing_delinquency"] = (
        col("filingDelinquencyDays") / NORMALIZATION_CAPS["filingDelinquencyDays"]
    ).clip(0, 1)
    dvc = frame.get("dataVolumeClass")
    if dvc is not None:
        out["data_volume_class"] = (
            dvc.fillna("medium").astype(str).str.lower()
            .map(DATA_VOLUME_CLASS_SCORE).fillna(0.4))
    else:
        out["data_volume_class"] = 0.4
    return out[RISK_FACTOR_KEYS].astype(float)


def labels_to_frame(labels: pd.DataFrame) -> pd.DataFrame:
    """Explode the inputs jsonb column into flat raw-input columns."""
    rows = []
    for _, r in labels.iterrows():
        inputs = r.get("inputs")
        if isinstance(inputs, str):
            try:
                inputs = json.loads(inputs)
            except ValueError:
                inputs = {}
        inputs = inputs if isinstance(inputs, dict) else {}
        rows.append({**inputs,
                     "subsequent_enforcement": r["subsequent_enforcement"]})
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# Training
# --------------------------------------------------------------------------- #
def train(frame: pd.DataFrame, window_days: int = DEFAULT_WINDOW_DAYS,
          seed: int = 42) -> dict:
    """Train on a frame with raw input columns + subsequent_enforcement.

    Pure-function entry point (tests pass synthetic frames). Returns the
    artifact dict: {version, trained_at, window_days, weights{6}, metrics,
    sample_size}.
    """
    hgb_json.assert_no_raw_identifiers(frame.columns, MODEL_NAME)
    if "subsequent_enforcement" not in frame.columns:
        raise RuntimeError(
            f"[{MODEL_NAME}] frame lacks subsequent_enforcement label")
    df = frame[frame["subsequent_enforcement"].notna()].copy()
    if "inputs" in df.columns:
        df = labels_to_frame(df)
    y = df["subsequent_enforcement"].astype(int).to_numpy()
    if len(df) < 2 or len(np.unique(y)) < 2:
        raise RuntimeError(
            f"[{MODEL_NAME}] need >=2 org-snapshots with both classes, got "
            f"{len(df)} rows / {len(np.unique(y))} class(es)")

    X = normalize_inputs(df).to_numpy(dtype=float)
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import log_loss, roc_auc_score
    clf = LogisticRegression(max_iter=2000, random_state=seed)
    clf.fit(X, y)

    coefs = np.abs(clf.coef_[0]).astype(float)
    coefs = np.maximum(coefs, 0.0)
    total = coefs.sum()
    raw_w = coefs / total if total > 0 else np.full(len(coefs), 1 / len(coefs))
    # Floor then renormalize so no sourced factor is silently zeroed.
    floored = np.maximum(raw_w, WEIGHT_FLOOR)
    weights_arr = floored / floored.sum()
    weights = {k: round(float(w), 6)
               for k, w in zip(RISK_FACTOR_KEYS, weights_arr)}

    proba = clf.predict_proba(X)[:, 1]
    metrics = {"n_samples": int(len(df)),
               "n_positive": int(y.sum()),
               "class_balance": float(y.mean()),
               "logloss_insample": float(log_loss(y, proba, labels=[0, 1])),
               "auc_insample": float(roc_auc_score(y, proba)),
               "coefs": {k: round(float(c), 6)
                         for k, c in zip(RISK_FACTOR_KEYS, clf.coef_[0])}}
    artifact = {
        "model": MODEL_NAME,
        "model_type": "logistic_weight_vector",
        "version": hgb_json.new_version(),
        "trained_at": hgb_json.utcnow_iso(),
        "window_days": int(window_days),
        "weights": weights,
        "metrics": metrics,
        "sample_size": int(len(df)),
        "usable": bool(len(df) >= MIN_SAMPLES),
    }
    if not artifact["usable"]:
        artifact["warning"] = (
            f"trained on {len(df)} org-snapshots (< {MIN_SAMPLES}) — keep "
            "active=false until more outcomes accumulate")
    return artifact


# --------------------------------------------------------------------------- #
# DB extraction + persistence
# --------------------------------------------------------------------------- #
def extract_training_frame(window_days: int = DEFAULT_WINDOW_DAYS
                           ) -> pd.DataFrame | None:
    """risk_score_inputs x subsequent enforcement_notices within the window.

    Latest inputs snapshot per org per day is kept (a same-day re-sweep is
    not a new observation). Returns None when the DB is unreachable.
    """
    dsn = (os.environ.get("DATABASE_URL") or os.environ.get("WORKER_DATABASE_URL"))
    if not dsn:
        return None
    import psycopg2
    conn = psycopg2.connect(dsn, connect_timeout=3)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT i.org_id, i.inputs, i.collected_at,
                          EXISTS (
                            SELECT 1 FROM enforcement_notices en
                            WHERE en.organization_id = i.org_id
                              AND en.status IN ('published', 'remediated')
                              AND en.created_at > i.collected_at
                              AND en.created_at <= i.collected_at
                                    + make_interval(days => %s)
                          ) AS subsequent_enforcement
                   FROM risk_score_inputs i
                   ORDER BY i.collected_at DESC
                   LIMIT 500000""",
                (int(window_days),))
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    except Exception as e:
        print(f"[{MODEL_NAME}] extraction failed: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
        return None
    finally:
        conn.close()
    df = pd.DataFrame(rows, columns=cols)
    if not len(df):
        return df
    df["day"] = pd.to_datetime(df["collected_at"]).dt.floor("D")
    df = (df.sort_values("collected_at")
            .drop_duplicates(["org_id", "day"], keep="last"))
    return df[["inputs", "subsequent_enforcement"]]


def persist_to_db(artifact: dict) -> bool:
    """Insert an INACTIVE row into learned_risk_weights (migration 0137).

    Best-effort: returns False (never raises) when the DB is unreachable.
    Activation is a deliberate SQL step — see module docstring.
    """
    dsn = (os.environ.get("DATABASE_URL") or os.environ.get("WORKER_DATABASE_URL"))
    if not dsn:
        return False
    import psycopg2
    try:
        conn = psycopg2.connect(dsn, connect_timeout=3)
        with conn.cursor() as cur:
            cur.execute(
                f"""INSERT INTO {TABLE}
                        (version, weights, trained_at, sample_size, metrics,
                         active)
                    VALUES (%s, %s::jsonb, %s::timestamptz, %s, %s::jsonb,
                            false)""",
                (artifact["version"], json.dumps(artifact["weights"]),
                 artifact["trained_at"], artifact["sample_size"],
                 json.dumps(artifact["metrics"])))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[{MODEL_NAME}] DB persist skipped: {e}")
        return False


def train_from_db(window_days: int = DEFAULT_WINDOW_DAYS,
                  seed: int = 42) -> dict | None:
    frame = extract_training_frame(window_days)
    if frame is None or not len(frame):
        print(f"[{MODEL_NAME}] no training frame (DB unreachable or no "
              "risk_score_inputs history)")
        return None
    artifact = train(frame, window_days=window_days, seed=seed)
    out_dir = weights_dir()
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, ARTIFACT_NAME)
    with open(path, "w") as f:
        json.dump(artifact, f, indent=1)
    print(f"[{MODEL_NAME}] artifact -> {path}")
    persisted = persist_to_db(artifact)
    print(f"[{MODEL_NAME}] learned_risk_weights row inserted: {persisted} "
          "(active=false — activate deliberately via SQL)")
    return artifact


def main() -> int:
    return 0 if train_from_db() is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
