#!/usr/bin/env python3
"""Ingest REAL fraud cases (e.g. provided by NDPC / partner institutions)
into the NDSEP ML lakehouse.

INPUT FORMAT — CSV or parquet with ONE ROW PER LABELED TRANSACTION.

Required columns (aliases in parentheses are accepted and renamed):
    tx_id         (id, transaction_id)         unique transaction id
    timestamp     (ts, time, datetime)         ISO-8601 transaction time
    amount_naira  (amount, amt, value)         transaction amount in naira
    channel       ()                           one of: nip_transfer,
                                               mobile_app, ussd, pos, web,
                                               atm, agent
    sender_org    (sender, src)                sender institution id
    receiver_org  (receiver, dst)              receiver institution id
    is_fraud      (label, fraud, target)       0/1 confirmed-fraud label

Optional columns (default 0 / 'unknown' when absent):
    fraud_type, new_device, new_location, mule_hop, is_insider_ring

Rows that cannot be mapped (missing required fields, unparseable
timestamp/amount, unknown channel, label not in {0,1}) are QUARANTINED
with a per-row reason — they never silently enter training.

Valid rows are feature-engineered with the SAME function used for
synthetic data (ml.data.generate_synthetic.engineer_fraud_features) and
appended to the lakehouse as dataset `real_cases`. fine_tune.py
automatically merges `real_cases` into its fraud training batches with a
higher sample weight (REAL_CASE_WEIGHT, default 3.0) — confirmed real
fraud is scarcer and more valuable than synthetic rows.

    python -m ml.validation.real_case_ingest cases.csv
    python -m ml.validation.real_case_ingest cases.parquet --dry-run
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
import pandas as pd

from ml.data.generate_synthetic import CHANNELS, engineer_fraud_features
from ml.training import lakehouse

REQUIRED = {
    "tx_id": ["tx_id", "id", "transaction_id"],
    "timestamp": ["timestamp", "ts", "time", "datetime"],
    "amount_naira": ["amount_naira", "amount", "amt", "value"],
    "channel": ["channel"],
    "sender_org": ["sender_org", "sender", "src"],
    "receiver_org": ["receiver_org", "receiver", "dst"],
    "is_fraud": ["is_fraud", "label", "fraud", "target"],
}
OPTIONAL_DEFAULTS = {"fraud_type": "confirmed", "new_device": 0,
                     "new_location": 0, "mule_hop": 0, "is_insider_ring": 0}

DATASET = "real_cases"
QUARANTINE_DATASET = "real_cases_quarantine"


def _read(path: str) -> pd.DataFrame:
    if path.endswith(".parquet"):
        return pd.read_parquet(path)
    return pd.read_csv(path)


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Rename accepted aliases to the canonical schema."""
    lower = {c.lower().strip(): c for c in df.columns}
    ren = {}
    for canon, aliases in REQUIRED.items():
        for a in aliases:
            if a in lower:
                ren[lower[a]] = canon
                break
    return df.rename(columns=ren)


def validate_rows(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split into (valid, quarantined-with-reasons)."""
    df = df.copy()
    reasons = pd.Series("", index=df.index, dtype=object)

    for col in REQUIRED:
        if col not in df.columns:
            # whole-file failure: no row is mappable
            df["_quarantine_reason"] = f"missing required column '{col}'"
            return df.iloc[0:0], df

    ts = pd.to_datetime(df["timestamp"], errors="coerce", utc=False)
    bad = ts.isna()
    reasons[bad] += "unparseable timestamp;"
    df["timestamp"] = ts

    amt = pd.to_numeric(df["amount_naira"], errors="coerce")
    bad = amt.isna() | (amt <= 0)
    reasons[bad] += "bad amount_naira;"
    df["amount_naira"] = amt

    bad = ~df["channel"].astype(str).isin(CHANNELS)
    reasons[bad] += "unknown channel;"

    lab = pd.to_numeric(df["is_fraud"], errors="coerce")
    bad = ~lab.isin([0, 1])
    reasons[bad] += "label not in {0,1};"
    df["is_fraud"] = lab

    for col in ("tx_id", "sender_org", "receiver_org"):
        bad = df[col].isna() | (df[col].astype(str).str.strip() == "")
        reasons[bad] += f"empty {col};"

    bad_mask = reasons != ""
    quarantine = df[bad_mask].copy()
    quarantine["_quarantine_reason"] = reasons[bad_mask]
    valid = df[~bad_mask].copy()
    valid["is_fraud"] = valid["is_fraud"].astype(int)
    for col, default in OPTIONAL_DEFAULTS.items():
        if col not in valid.columns:
            valid[col] = default
    return valid, quarantine


def ingest(path: str, root: str = lakehouse.DEFAULT_ROOT,
           dry_run: bool = False) -> dict:
    """Validate, quarantine, feature-engineer, and lakehouse-ingest a file
    of real labeled fraud cases."""
    raw = _read(path)
    df = normalize_columns(raw)
    valid, quarantined = validate_rows(df)
    summary = {
        "source_file": path,
        "rows_total": int(len(df)),
        "rows_valid": int(len(valid)),
        "rows_quarantined": int(len(quarantined)),
        "fraud_rate_valid": (round(float(valid["is_fraud"].mean()), 5)
                             if len(valid) else None),
        "quarantine_reasons": (quarantined["_quarantine_reason"]
                               .value_counts().to_dict()
                               if len(quarantined) else {}),
        "dry_run": dry_run,
    }
    print(json.dumps(summary, indent=2))
    if dry_run:
        return summary

    if len(valid):
        feat = engineer_fraud_features(valid)
        entry = lakehouse.save_snapshot(feat, DATASET, root=root,
                                        meta={"source_file": path,
                                              "kind": "real_labeled_cases"})
        print(f"[ingest] {len(valid)} valid cases -> lakehouse "
              f"'{DATASET}' ({entry['snapshot_id']})")
    if len(quarantined):
        entry = lakehouse.save_snapshot(quarantined, QUARANTINE_DATASET,
                                        root=root,
                                        meta={"source_file": path})
        print(f"[ingest] {len(quarantined)} quarantined rows -> "
              f"'{QUARANTINE_DATASET}' ({entry['snapshot_id']}) — REVIEW")
    return summary


def load_real_cases(root: str = lakehouse.DEFAULT_ROOT) -> pd.DataFrame | None:
    """All ingested real cases, concatenated across snapshots (None if none)."""
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
    ap.add_argument("path", help="CSV or parquet file of real fraud cases")
    ap.add_argument("--dry-run", action="store_true",
                    help="validate and report only; write nothing")
    args = ap.parse_args()
    summary = ingest(args.path, dry_run=args.dry_run)
    if summary["rows_quarantined"]:
        print(f"WARNING: {summary['rows_quarantined']} rows quarantined")


if __name__ == "__main__":
    main()
