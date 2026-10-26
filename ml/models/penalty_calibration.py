#!/usr/bin/env python3
"""Penalty-calibration trainer (round 12, wave 8 — roadmap P2).

Learns P(upheld | penalty_band, violation_type, org_size, legal_basis_section)
from the Wave-5 penalty-survival labels (ml/lakehouse/labels/penalty_survival —
built by ml/labels/case_outcome_labels.py from appeal_hearings +
tribunal_escalations).

ADVISORY ONLY. The NDPA 2023 s.48 computation (server/services/penaltyEngine.ts)
is authoritative and is NEVER touched by this model; the artifact feeds a
calibration badge ({upholdProbability, similarMedian}) that tells the officer
how similar penalties fared on appeal — it cannot alter a computed amount.

Features are ALL categorical (one-hot with recorded levels, 'unknown'
always a level so unseen values degrade gracefully at serve time):

    penalty_band         from financial_penalties.amount:
                         under_floor (<2m) | 2m_10m | 10m_100m | over_100m
    violation_type       compliance_violations.metadata->>'violation_type',
                         falling back to severity, then 'unknown'
    org_size             organizations.data_volume_class (else 'unknown')
    legal_basis_section  section token parsed from
                         enforcement_notices.legal_instrument_ref
                         (e.g. "NDPA 2023 s.48(2)" -> "s.48"), else 'unknown'

Join path (fail-closed, pseudonymous): the DB extraction pulls
penalty_appeals joined to financial_penalties / compliance_violations /
organizations / enforcement_notices, then joins the lakehouse label frame
on appeal_hash = sha256(salt || ':appeal:' || appeal_id) — the SAME keyed
pseudonym ml/labels/case_outcome_labels.py emitted. Without
NDSEP_LABEL_HASH_SALT (or ANONYMIZATION_SALT) the join RAISES (better no
model than an unjoined/privacy-unsafe one).

    python -m ml.models.penalty_calibration           # train from lakehouse
"""

from __future__ import annotations

import os
import re

import numpy as np
import pandas as pd

from ml.labels.case_outcome_labels import pseudonymize
from ml.models import hgb_json
from ml.training import lakehouse

MODEL_NAME = "penalty_calibration"
ARTIFACT_NAME = "penalty_calibration.json"
LABEL_DATASET = "labels/penalty_survival"

CATEGORICAL_FEATURES = [
    "penalty_band",
    "violation_type",
    "org_size",
    "legal_basis_section",
]

PENALTY_BANDS = ["under_floor", "2m_10m", "10m_100m", "over_100m"]
MIN_SAMPLES = 20

_SECTION_RE = re.compile(r"s\.\s*\d+", re.IGNORECASE)


def penalty_band(amount) -> str:
    """Band an NGN penalty amount by the s.48 statutory floors."""
    try:
        a = float(amount)
    except (TypeError, ValueError):
        return "unknown"
    if not np.isfinite(a):
        return "unknown"
    if a < 2_000_000:
        return "under_floor"
    if a < 10_000_000:
        return "2m_10m"
    if a < 100_000_000:
        return "10m_100m"
    return "over_100m"


def legal_basis_section(instrument_ref) -> str:
    """Extract the NDPA section token ("s.48") from a legal instrument ref."""
    if not instrument_ref:
        return "unknown"
    m = _SECTION_RE.search(str(instrument_ref))
    return m.group(0).replace(" ", "").lower() if m else "unknown"


# --------------------------------------------------------------------------- #
# Design matrix (all-categorical one-hot)
# --------------------------------------------------------------------------- #
def design_matrix(df: pd.DataFrame,
                  levels: dict[str, list[str]] | None = None):
    levels = levels or {}
    parts, names, out_levels = [], [], {}
    for col in CATEGORICAL_FEATURES:
        vals = (df[col] if col in df.columns else pd.Series(["unknown"] * len(df)))
        vals = vals.fillna("unknown").astype(str).str.strip().str.lower()
        vals = vals.replace("", "unknown")
        lv = levels.get(col) or sorted(vals.unique().tolist())
        if "unknown" not in lv:
            lv = [*lv, "unknown"]
        out_levels[col] = lv
        for level in lv:
            parts.append((vals == level).astype(float).to_numpy())
            names.append(f"{col}={level}")
    X = (np.column_stack(parts) if parts else np.empty((len(df), 0)))
    return X, names, out_levels


# --------------------------------------------------------------------------- #
# Training
# --------------------------------------------------------------------------- #
def train(frame: pd.DataFrame, min_samples: int = MIN_SAMPLES,
          seed: int = 42) -> dict:
    """Train on a frame with the four categorical features + penalty_upheld.

    Pure-function entry point (tests pass synthetic frames). Fail-closed on
    raw identifier columns and on a missing label column.
    """
    hgb_json.assert_no_raw_identifiers(frame.columns, MODEL_NAME)
    if "penalty_upheld" not in frame.columns:
        raise RuntimeError(f"[{MODEL_NAME}] frame lacks penalty_upheld label")
    df = frame[frame["penalty_upheld"].notna()].copy()
    y = df["penalty_upheld"].astype(int).to_numpy()
    if len(df) < 2 or len(np.unique(y)) < 2:
        raise RuntimeError(
            f"[{MODEL_NAME}] need >=2 rows with both classes, got "
            f"{len(df)} rows / {len(np.unique(y))} class(es)")

    X, feature_names, levels = design_matrix(df)
    clf = hgb_json.fit_hgb(X, y, seed=seed)

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
        MODEL_NAME, clf, feature_names, levels, metrics, sample_size=len(df))
    artifact["usable"] = bool(len(df) >= min_samples)
    if not artifact["usable"]:
        artifact["warning"] = (
            f"trained on {len(df)} adjudicated appeals (< {min_samples}) — "
            "calibration badge is provisional until more outcomes land")
    return artifact


# --------------------------------------------------------------------------- #
# DB extraction + lakehouse join
# --------------------------------------------------------------------------- #
def extract_appeal_features() -> pd.DataFrame | None:
    """Pull per-appeal penalty context from the platform DB.

    Returns a frame keyed by appeal_hash (pseudonymous) or None when the DB
    is unreachable. No raw org/officer identifiers leave this function.
    """
    dsn = (os.environ.get("DATABASE_URL") or os.environ.get("WORKER_DATABASE_URL"))
    if not dsn:
        return None
    import psycopg2
    conn = psycopg2.connect(dsn, connect_timeout=3)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT pa.id AS appeal_id,
                          fp.amount AS penalty_amount,
                          COALESCE(cv.metadata->>'violation_type',
                                   cv.severity::text, 'unknown') AS violation_type,
                          o.data_volume_class AS org_size,
                          (SELECT en.legal_instrument_ref
                             FROM enforcement_notices en2
                            WHERE en2.organization_id = pa.organization_id
                              AND en2.notice_type = 'administrative_fine'
                              AND en2.legal_instrument_ref IS NOT NULL
                            ORDER BY en2.published_at DESC NULLS LAST
                            LIMIT 1) AS legal_instrument_ref
                   FROM penalty_appeals pa
                   JOIN financial_penalties fp ON fp.id = pa.penalty_id
                   LEFT JOIN compliance_violations cv
                          ON cv.id = fp.violation_id
                   LEFT JOIN organizations o
                          ON o.id = pa.organization_id
                   LIMIT 200000""")
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
    finally:
        conn.close()
    df = pd.DataFrame(rows, columns=cols)
    if not len(df):
        return df
    # Fail-closed join key: raises when no salt is configured.
    df["appeal_hash"] = df["appeal_id"].map(
        lambda v: pseudonymize(f"appeal:{v}"))
    df["penalty_band"] = df["penalty_amount"].map(penalty_band)
    df["org_size"] = df["org_size"].fillna("unknown").astype(str).str.lower()
    df["legal_basis_section"] = df["legal_instrument_ref"].map(
        legal_basis_section)
    return df[["appeal_hash", *CATEGORICAL_FEATURES]]


def train_from_lakehouse(root: str = lakehouse.DEFAULT_ROOT,
                         seed: int = 42) -> dict | None:
    """Production path: penalty-survival labels JOIN appeal features."""
    try:
        labels = lakehouse.load_latest(LABEL_DATASET, root=root)
    except FileNotFoundError:
        print(f"[{MODEL_NAME}] no {LABEL_DATASET} snapshot — run "
              "ml.labels.case_outcome_labels first")
        return None
    feats = extract_appeal_features()
    if feats is None or not len(feats):
        print(f"[{MODEL_NAME}] appeal feature extraction unavailable "
              "(no DB or no appeals)")
        return None
    frame = feats.merge(labels[["appeal_hash", "penalty_upheld"]],
                        on="appeal_hash", how="inner")
    if not len(frame):
        print(f"[{MODEL_NAME}] label join produced 0 rows — check the "
              "label hash salt matches label production")
        return None
    artifact = train(frame, seed=seed)
    path = _save_to_weights(artifact)
    print(f"[{MODEL_NAME}] artifact -> {path}")
    return artifact


def _save_to_weights(artifact: dict) -> str:
    from ml.models.settlement_recommender import save_artifact_to
    return save_artifact_to(artifact, ARTIFACT_NAME, MODEL_NAME)


def main() -> int:
    return 0 if train_from_lakehouse() is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
