#!/usr/bin/env python3
"""Ingest HUMAN FRAUD VERDICTS (officer dispositions on fraud_alerts) into
the NDSEP ML lakehouse as labeled training rows.

Source of truth: fraud_alerts rows whose status has been resolved by an
officer to 'confirmed_fraud' or 'false_positive', joined back to the scored
NIP transaction they were raised on (fraud_alerts.transaction_ref is matched
against nip_transactions.session_id, then 'NIP-<id>', then the raw id).

Label mapping (pure, unit-tested):
    confirmed_fraud  -> is_fraud = 1
    false_positive   -> is_fraud = 0

These OFFICER verdicts outrank the raw nip_transactions.fraud_flagged
heuristic labels, so fine_tune.py merges them with sample weight
VERDICT_CASE_WEIGHT (2.0) — above synthetic (1.0) but below externally
adjudicated real cases (3.0), so a single verdict never dominates a batch.

Incrementality: watermarked on fraud_alerts.updated_at (lakehouse watermark
'fraud_alert_verdicts'); re-runs only read newly-resolved/re-resolved
alerts. Re-resolution is handled by load_verdict_cases() deduping on tx_id
(keep='last').

    python -m ml.validation.verdict_ingest            # incremental ingest
    python -m ml.validation.verdict_ingest --dry-run  # report only
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime

import numpy as np
import pandas as pd

from ml.data.generate_synthetic import engineer_fraud_features
from ml.training import lakehouse

DATASET = "verdict_cases"
QUARANTINE_DATASET = "verdict_cases_quarantine"
WATERMARK = "fraud_alert_verdicts"

# fraud_alerts.status values that constitute a final human verdict.
VERDICT_STATUSES = ("confirmed_fraud", "false_positive")

# Officer verdict -> training label.
VERDICT_LABELS = {"confirmed_fraud": 1, "false_positive": 0}

# alert_type -> the fraud_type tag real_case_ingest uses for confirmed cases.
VERDICT_FRAUD_TYPE = {
    "velocity_breach": "velocity",
    "unusual_amount": "amount_anomaly",
    "geo_anomaly": "geo_anomaly",
    "device_fingerprint": "device_anomaly",
    "account_takeover": "account_takeover",
    "synthetic_identity": "synthetic_identity",
    "card_not_present": "card_not_present",
    "social_engineering": "social_engineering",
    "insider_threat": "insider_threat",
    "ml_anomaly": "ml_flagged",
}

# Candidate keys linking fraud_alerts.transaction_ref to a NIP transaction.
# The alert UI stores a free-form reference; in practice it is the NIP
# session id, the lakehouse-style "NIP-<id>" tag, or the bare numeric id.
_REF_SQL = """(
    t.session_id = a.transaction_ref
    OR 'NIP-' || t.id::text = a.transaction_ref
    OR t.id::text = a.transaction_ref
)"""

VERDICT_QUERY = f"""
    SELECT a.id              AS alert_id,
           a.alert_ref       AS alert_ref,
           a.status          AS verdict_status,
           a.alert_type      AS alert_type,
           a.updated_at      AS verdict_updated_at,
           t.id              AS nip_id,
           t.amount          AS amount_kobo,
           t.channel_code    AS channel_code,
           t.sender_account_number   AS sender_account_number,
           t.receiver_account_number AS receiver_account_number,
           t.created_at      AS tx_created_at
    FROM fraud_alerts a
    JOIN nip_transactions t ON {_REF_SQL}
    WHERE a.status IN ('confirmed_fraud', 'false_positive')
      AND (%s::timestamptz IS NULL OR a.updated_at > %s::timestamptz)
    ORDER BY a.updated_at, a.id
    LIMIT 50000
"""


def verdict_label(status: str) -> int | None:
    """Map a fraud_alerts status to a training label (None = not a verdict)."""
    return VERDICT_LABELS.get((status or "").strip().lower())


def build_verdict_cases(rows: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Convert fetched verdict+transaction rows into labeled training rows.

    Returns (valid_featured, quarantined). Valid rows are feature-engineered
    with the SAME engineer_fraud_features() used for synthetic and real-case
    data, carry tx_id 'NIP-<nip id>' (matching fine_tune's real batch), and
    the officer-verdict label. Rows with an unmappable status, missing
    transaction join, or bad amount/timestamp are quarantined with a reason.
    """
    df = rows.copy()
    reasons = pd.Series("", index=df.index, dtype=object)

    labels = df["verdict_status"].map(verdict_label)
    reasons[labels.isna()] += "unknown verdict status;"
    reasons[df["nip_id"].isna()] += "no matching nip_transaction;"

    amt = pd.to_numeric(df["amount_kobo"], errors="coerce")
    reasons[amt.isna() | (amt <= 0)] += "bad amount;"
    ts = pd.to_datetime(df["tx_created_at"], errors="coerce")
    reasons[ts.isna()] += "bad timestamp;"

    bad = reasons != ""
    quarantine = df[bad].copy()
    quarantine["_quarantine_reason"] = reasons[bad]
    df = df[~bad].copy()
    if not len(df):
        return df, quarantine

    tx = pd.DataFrame({
        # NIP-<id> matches the tx_id convention in fine_tune.fetch_fraud_from_db
        "tx_id": df["nip_id"].astype("int64").astype(str).map(lambda s: f"NIP-{s}"),
        "timestamp": ts[~bad],
        "sender_org": df["sender_account_number"].fillna("unknown"),
        "receiver_org": df["receiver_account_number"].fillna("unknown"),
        "amount_naira": amt[~bad].astype(float) / 100.0,  # kobo -> naira
        "channel": df["channel_code"].fillna("other"),
        # THE VERDICT IS THE LABEL — overrides the raw fraud_flagged heuristic.
        "is_fraud": labels[~bad].astype(int),
        "fraud_type": [VERDICT_FRAUD_TYPE.get(str(a), "confirmed")
                       if lab == 1 else "none"
                       for a, lab in zip(df["alert_type"], labels[~bad])],
    })
    # Features with no platform source: neutral 0 (train-mean after
    # standardisation — same documented default as fetch_fraud_from_db).
    for f in ("new_device", "new_location", "mule_hop", "is_insider_ring"):
        tx[f] = 0.0
    return engineer_fraud_features(tx), quarantine


def _db_connect():
    """Connect to the platform DB (fail closed — no embedded credentials)."""
    dsn = (os.environ.get("DATABASE_URL") or os.environ.get("WORKER_DATABASE_URL"))
    if not dsn:
        return None
    import psycopg2
    return psycopg2.connect(dsn, connect_timeout=3)


def fetch_verdict_rows(since: str | None) -> pd.DataFrame | None:
    """Fetch verdict rows newer than the watermark (None on DB failure)."""
    try:
        conn = _db_connect()
        if conn is None:
            print("[verdict_ingest] DATABASE_URL not set — nothing to ingest")
            return None
        try:
            with conn.cursor() as cur:
                cur.execute(VERDICT_QUERY, (since, since))
                rows = cur.fetchall()
                cols = [d[0] for d in cur.description]
        finally:
            conn.close()
    except Exception as e:
        print(f"[verdict_ingest] DB fetch failed ({e})")
        return None
    return pd.DataFrame(rows, columns=cols)


def ingest_verdicts(root: str = lakehouse.DEFAULT_ROOT,
                    dry_run: bool = False) -> dict | None:
    """Incrementally ingest newly-resolved fraud verdicts into the lakehouse.

    Watermark ('fraud_alert_verdicts') advances ONLY after the snapshot has
    been persisted, so a failed run re-reads the same rows next time.
    Returns a summary dict, or None when the DB was unreachable.
    """
    watermark = lakehouse.load_watermark(WATERMARK, root=root)
    raw = fetch_verdict_rows(watermark)
    if raw is None:
        return None
    summary = {"watermark_before": watermark, "rows_fetched": int(len(raw)),
               "dry_run": dry_run}
    if not len(raw):
        summary.update(rows_valid=0, rows_quarantined=0)
        print(f"[verdict_ingest] no new verdicts since {watermark}")
        return summary

    valid, quarantined = build_verdict_cases(raw)
    new_watermark = str(pd.to_datetime(raw["verdict_updated_at"]).max())
    summary.update(rows_valid=int(len(valid)),
                   rows_quarantined=int(len(quarantined)),
                   confirmed_fraud=int((valid["is_fraud"] == 1).sum())
                   if len(valid) else 0,
                   false_positive=int((valid["is_fraud"] == 0).sum())
                   if len(valid) else 0,
                   watermark_after=new_watermark)
    print(json.dumps(summary, indent=2, default=str))
    if dry_run:
        return summary

    if len(valid):
        entry = lakehouse.save_snapshot(
            valid, DATASET, root=root,
            # microseconds: two ingests within the same second must not
            # collide on the snapshot filename and silently overwrite
            snapshot_id="v" + datetime.utcnow().strftime("%Y%m%dT%H%M%S%f"),
            meta={"kind": "officer_verdict_labels", "watermark": new_watermark})
        print(f"[verdict_ingest] {len(valid)} verdict-labeled cases -> "
              f"'{DATASET}' ({entry['snapshot_id']})")
    if len(quarantined):
        entry = lakehouse.save_snapshot(
            quarantined, QUARANTINE_DATASET, root=root,
            meta={"kind": "officer_verdict_labels_quarantine"})
        print(f"[verdict_ingest] {len(quarantined)} quarantined rows -> "
              f"'{QUARANTINE_DATASET}' ({entry['snapshot_id']}) — REVIEW")
    lakehouse.save_watermark(WATERMARK, new_watermark, root=root)
    return summary


def load_verdict_cases(root: str = lakehouse.DEFAULT_ROOT) -> pd.DataFrame | None:
    """All ingested verdict cases (latest verdict per tx_id), None if none."""
    snaps = lakehouse.list_snapshots(DATASET, root=root)
    if not snaps:
        return None
    frames = [lakehouse.load_snapshot(DATASET, s["snapshot_id"], root=root)
              for s in snaps]
    df = pd.concat(frames, ignore_index=True)
    return df.drop_duplicates("tx_id", keep="last")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch and report only; write nothing")
    args = ap.parse_args()
    summary = ingest_verdicts(dry_run=args.dry_run)
    if summary and summary.get("rows_quarantined"):
        print(f"WARNING: {summary['rows_quarantined']} rows quarantined")


if __name__ == "__main__":
    main()
