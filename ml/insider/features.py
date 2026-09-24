"""Insider-risk behavioral feature extraction for NDSEP.

Builds one row per staff/officer subject with behavioral features derived
from the platform audit trail:

    actions_per_day           total audit-trail actions / active days
    after_hours_ratio         share of actions outside 07:00-19:00 local
    sensitive_access_ratio    share of actions touching sensitive resources
                              (personal data stores, penalties, payments,
                              vault, user roles — see SENSITIVE_RESOURCES)
    approval_velocity         approval-type actions per active day
    self_approval_attempts    count of self-approval attempts in window
    export_volume             bulk-export / download actions in window
    role_change_count         role/privilege changes affecting the subject
    failed_auth_ratio         failed-auth events / total auth events

Two provenance paths, same output schema:

  * Postgres  — when a reachable DATABASE_URL (or explicit db_url) with
    psycopg2/psycopg installed is provided, features are aggregated from
    ``audit_logs`` (falling back to ``audit_ledger`` payload actors).
  * Synthetic — deterministic fallback (seeded) so detection, tests and
    demos run with no database. A planted minority of subjects exhibits
    insider-typology behavior (after-hours bulk export, self-approval,
    sensitive-table snooping, failed-auth bursts).

Each row also carries ``risk_event_count`` and ``exposure_days`` — the
count/exposure pair consumed by the Gamma-Poisson shrinkage component
(ml.bayesian.models.gamma_poisson_shrinkage) in the fusion scorer.
"""

from __future__ import annotations

import logging
import os
from typing import Iterable, Optional

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

INSIDER_FEATURES = [
    "actions_per_day",
    "after_hours_ratio",
    "sensitive_access_ratio",
    "approval_velocity",
    "self_approval_attempts",
    "export_volume",
    "role_change_count",
    "failed_auth_ratio",
]

# resource_type values in audit_logs that count as sensitive for insider
# risk: personal-data stores, money movement, enforcement decisions,
# evidence vault, and privilege management.
SENSITIVE_RESOURCES = (
    "personal_data", "data_catalog", "consent_records", "dsar",
    "financial_penalty", "payment", "ledger", "evidence_vault",
    "user", "role", "audit_log", "audit_ledger", "dpco_accreditation",
)

# audit action patterns feeding the shrinkage-model event count
RISKY_ACTION_PATTERNS = (
    "%self%approv%", "%bulk%export%", "%export%", "%download%",
    "%vault%unseal%", "%role%grant%", "%after%hours%",
)

DEFAULT_WINDOW_DAYS = 30
DEFAULT_N_SUBJECTS = 48
DEFAULT_SEED = 42


# --------------------------------------------------------------------------- #
# Postgres extraction (best-effort; optional drivers)
# --------------------------------------------------------------------------- #
def _connect(db_url: str):
    try:
        import psycopg2  # type: ignore
        return psycopg2.connect(db_url)
    except ImportError:
        pass
    try:
        import psycopg  # type: ignore
        return psycopg.connect(db_url)
    except ImportError:
        pass
    raise RuntimeError("no Postgres driver installed (psycopg2 / psycopg)")


def _frame_from_db(db_url: str, window_days: int) -> pd.DataFrame:
    """Aggregate per-user behavioral features from audit_logs."""
    sensitive = list(SENSITIVE_RESOURCES)
    risky = list(RISKY_ACTION_PATTERNS)
    sql = """
        SELECT
          user_id::text                                   AS subject_id,
          COUNT(*)::float
            / GREATEST(1, COUNT(DISTINCT created_at::date)) AS actions_per_day,
          AVG(CASE WHEN EXTRACT(hour FROM created_at) < 7
                    OR EXTRACT(hour FROM created_at) >= 19
                   THEN 1.0 ELSE 0.0 END)                 AS after_hours_ratio,
          AVG(CASE WHEN resource_type = ANY(%s)
                   THEN 1.0 ELSE 0.0 END)                 AS sensitive_access_ratio,
          COUNT(*) FILTER (WHERE action ILIKE '%%approv%%')::float
            / GREATEST(1, COUNT(DISTINCT created_at::date)) AS approval_velocity,
          COUNT(*) FILTER (WHERE action ILIKE '%%self%%approv%%')::float
                                                          AS self_approval_attempts,
          COUNT(*) FILTER (WHERE action ILIKE '%%export%%'
                            OR action ILIKE '%%download%%')::float AS export_volume,
          COUNT(*) FILTER (WHERE action ILIKE '%%role%%')::float
                                                          AS role_change_count,
          COUNT(*) FILTER (WHERE action ILIKE '%%fail%%')::float
            / GREATEST(1, COUNT(*) FILTER (
                            WHERE action ILIKE '%%login%%'
                               OR action ILIKE '%%auth%%'
                               OR action ILIKE '%%fail%%')) AS failed_auth_ratio,
          COUNT(*) FILTER (WHERE action ILIKE ANY(%s))::float AS risk_event_count,
          GREATEST(1, COUNT(DISTINCT created_at::date))::float AS exposure_days
        FROM audit_logs
        WHERE created_at >= now() - make_interval(days => %s)
          AND user_id IS NOT NULL
        GROUP BY user_id
    """
    conn = _connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (sensitive, risky, int(window_days)))
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
    finally:
        conn.close()
    df = pd.DataFrame(rows, columns=cols)
    df["subject_type"] = "user"
    return df


# --------------------------------------------------------------------------- #
# Deterministic synthetic fallback
# --------------------------------------------------------------------------- #
def _synthetic_subjects(n: int) -> list[str]:
    return [f"OFF-{k:06d}" for k in range(n)]


def _frame_synthetic(subjects: list[str], window_days: int,
                     seed: int) -> pd.DataFrame:
    """Deterministic per-subject behavioral features.

    ~10% of subjects (at least 2) are planted with insider-typology
    behavior; the rest are benign. Same (subjects, seed) -> same frame.
    """
    rng = np.random.default_rng(seed)
    n = len(subjects)
    n_bad = max(2, n // 10)
    bad_idx = set(rng.choice(n, size=n_bad, replace=False).tolist())

    rows = []
    for i, sid in enumerate(subjects):
        insider = i in bad_idx
        active_days = int(rng.integers(max(5, window_days // 3),
                                       window_days + 1))
        if insider:
            actions_per_day = float(rng.uniform(30, 90))
            after_hours = float(rng.uniform(0.35, 0.75))
            sensitive_ratio = float(rng.uniform(0.45, 0.9))
            approval_velocity = float(rng.uniform(4, 12))
            self_approval = float(rng.integers(2, 7))
            export_volume = float(rng.integers(8, 30))
            role_changes = float(rng.integers(1, 5))
            failed_auth = float(rng.uniform(0.15, 0.5))
        else:
            actions_per_day = float(rng.uniform(5, 35))
            after_hours = float(rng.beta(1.2, 9.0))
            sensitive_ratio = float(rng.beta(1.5, 8.0))
            approval_velocity = float(rng.uniform(0.2, 3.0))
            self_approval = float(rng.poisson(0.05))
            export_volume = float(rng.poisson(0.6))
            role_changes = float(rng.poisson(0.1))
            failed_auth = float(rng.beta(1.0, 25.0))

        # risk events feed the Gamma-Poisson shrinkage component:
        # self-approvals + bulk exports + anomalous after-hours sensitive
        # sessions + failed-auth bursts, over active days of exposure.
        after_hours_sessions = round(
            after_hours * actions_per_day * active_days * sensitive_ratio * 0.1)
        risk_events = int(self_approval + min(export_volume, 20)
                          + after_hours_sessions
                          + round(failed_auth * 10))
        rows.append({
            "subject_id": sid,
            "subject_type": "officer",
            "actions_per_day": round(actions_per_day, 4),
            "after_hours_ratio": round(after_hours, 4),
            "sensitive_access_ratio": round(sensitive_ratio, 4),
            "approval_velocity": round(approval_velocity, 4),
            "self_approval_attempts": self_approval,
            "export_volume": export_volume,
            "role_change_count": role_changes,
            "failed_auth_ratio": round(failed_auth, 4),
            "risk_event_count": risk_events,
            "exposure_days": float(active_days),
            "planted_insider": insider,  # ground truth for tests/eval
        })
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def build_officer_features(db_url: Optional[str] = None,
                           window_days: int = DEFAULT_WINDOW_DAYS,
                           subjects: Optional[Iterable[str]] = None,
                           n_subjects: int = DEFAULT_N_SUBJECTS,
                           seed: int = DEFAULT_SEED) -> pd.DataFrame:
    """Return the per-subject insider-risk feature frame.

    Tries Postgres first (``db_url`` arg or DATABASE_URL env); on any
    failure falls back to the deterministic synthetic generator. The
    returned frame always has columns:

        subject_id, subject_type, *INSIDER_FEATURES,
        risk_event_count, exposure_days, source
    """
    url = db_url or os.environ.get("DATABASE_URL")
    if url:
        try:
            df = _frame_from_db(url, window_days)
            if not df.empty:
                df["source"] = "postgres"
                log.info("insider features from Postgres: %d subjects", len(df))
                return df
            log.warning("audit_logs empty for window; using synthetic fallback")
        except Exception as exc:  # DB-less operation must never crash
            log.warning("Postgres feature extraction failed (%s); "
                        "using synthetic fallback", exc)

    subject_list = list(subjects) if subjects else _synthetic_subjects(n_subjects)
    df = _frame_synthetic(subject_list, window_days, seed)
    df["source"] = "synthetic"
    return df


if __name__ == "__main__":  # smoke test
    frame = build_officer_features()
    print(frame.describe().round(3).to_string())
    print("\nPlanted insiders:",
          frame.loc[frame["planted_insider"], "subject_id"].tolist())
