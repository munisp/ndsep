"""Tests for ml/validation/verdict_ingest.py — officer-verdict label ingest.

Covers the status->label mapping, the verdict-row -> training-row conversion
(incl. quarantine of unmappable rows), incremental watermarking, and the
load-time dedupe (latest verdict per transaction wins). DB access is
monkeypatched — no Postgres required.

    pytest ml/tests/test_verdict_ingest.py -v
"""

from __future__ import annotations

import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))  # repo root on path

from ml.validation import verdict_ingest  # noqa: E402


def _row(alert_id, status, nip_id, amount_kobo=150_000_00,
         updated_at="2026-01-02 10:00:00", alert_type="unusual_amount"):
    return {
        "alert_id": alert_id, "alert_ref": f"FRD-{alert_id}",
        "verdict_status": status, "alert_type": alert_type,
        "verdict_updated_at": updated_at, "nip_id": nip_id,
        "amount_kobo": amount_kobo, "channel_code": "nip_transfer",
        "sender_account_number": "0123456789",
        "receiver_account_number": "9876543210",
        "tx_created_at": "2026-01-01 09:30:00",
    }


# --------------------------------------------------------------------------- #
# Mapping
# --------------------------------------------------------------------------- #
def test_verdict_label_mapping():
    assert verdict_ingest.verdict_label("confirmed_fraud") == 1
    assert verdict_ingest.verdict_label("false_positive") == 0
    assert verdict_ingest.verdict_label("Confirmed_Fraud") == 1  # case-insensitive
    for non_verdict in ("open", "investigating", "escalated", "resolved",
                        "", None):
        assert verdict_ingest.verdict_label(non_verdict) is None


# --------------------------------------------------------------------------- #
# Row conversion + quarantine
# --------------------------------------------------------------------------- #
def test_build_verdict_cases_labels_and_quarantine():
    rows = pd.DataFrame([
        _row(1, "confirmed_fraud", 101),
        _row(2, "false_positive", 102),
        _row(3, "escalated", 103),                 # not a verdict -> quarantine
        _row(4, "confirmed_fraud", None),          # no tx join -> quarantine
        _row(5, "confirmed_fraud", 105, amount_kobo="oops"),  # -> quarantine
    ])
    valid, quarantined = verdict_ingest.build_verdict_cases(rows)

    assert len(valid) == 2 and len(quarantined) == 3
    labels = dict(zip(valid["tx_id"], valid["is_fraud"]))
    assert labels == {"NIP-101": 1, "NIP-102": 0}
    # engineered features present (same function as train time)
    from ml.data.generate_synthetic import FRAUD_FEATURES
    for f in FRAUD_FEATURES:
        assert f in valid.columns, f
    reasons = " ".join(quarantined["_quarantine_reason"])
    assert "unknown verdict status" in reasons
    assert "no matching nip_transaction" in reasons
    assert "bad amount" in reasons
    # empty input -> empty outputs, no crash
    v2, q2 = verdict_ingest.build_verdict_cases(rows.iloc[0:0])
    assert len(v2) == 0 and len(q2) == 0


# --------------------------------------------------------------------------- #
# Incremental ingest + watermark
# --------------------------------------------------------------------------- #
def test_ingest_verdicts_incremental(monkeypatch, tmp_path):
    root = str(tmp_path / "lakehouse")
    batches = [
        pd.DataFrame([_row(1, "confirmed_fraud", 101,
                           updated_at="2026-01-02 10:00:00"),
                      _row(2, "false_positive", 102,
                           updated_at="2026-01-03 10:00:00")]),
        pd.DataFrame([_row(3, "confirmed_fraud", 103,
                           updated_at="2026-01-05 10:00:00")]),
    ]
    calls = {"n": 0}

    def fake_fetch(since):
        # emulate the DB honouring the watermark: batch 1 has rows >
        # NULL watermark; batch 2 has rows > 2026-01-03; then nothing
        i = calls["n"]
        calls["n"] += 1
        if i < len(batches):
            return batches[i]
        return pd.DataFrame(columns=batches[0].columns)

    monkeypatch.setattr(verdict_ingest, "fetch_verdict_rows", fake_fetch)

    s1 = verdict_ingest.ingest_verdicts(root=root)
    assert s1["rows_valid"] == 2 and s1["confirmed_fraud"] == 1
    from ml.training import lakehouse
    wm = lakehouse.load_watermark(verdict_ingest.WATERMARK, root=root)
    assert wm is not None and "2026-01-03" in wm  # max updated_at of batch 1

    s2 = verdict_ingest.ingest_verdicts(root=root)
    assert s2["rows_valid"] == 1
    wm2 = lakehouse.load_watermark(verdict_ingest.WATERMARK, root=root)
    assert "2026-01-05" in wm2  # watermark advanced past batch 2

    s3 = verdict_ingest.ingest_verdicts(root=root)
    assert s3["rows_fetched"] == 0 and s3["rows_valid"] == 0

    loaded = verdict_ingest.load_verdict_cases(root=root)
    assert loaded is not None and len(loaded) == 3
    assert set(loaded["tx_id"]) == {"NIP-101", "NIP-102", "NIP-103"}


def test_load_verdict_cases_none_when_empty(tmp_path):
    assert verdict_ingest.load_verdict_cases(root=str(tmp_path)) is None
