"""Tests for ml/labels/case_outcome_labels.py — platform-outcome label builders.

Covers the three builders (triage / settlement / penalty-survival), the
outcome-text normalization, and the fail-closed pseudonymization. Pure
DataFrames in, DataFrames out — no DB required.

    pytest ml/tests/test_case_outcome_labels.py -v
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))  # repo root on path

from ml.labels import case_outcome_labels as col  # noqa: E402


@pytest.fixture(autouse=True)
def salt(monkeypatch):
    monkeypatch.setenv("NDSEP_LABEL_HASH_SALT", "test-salt-round12")
    yield


# --------------------------------------------------------------------------- #
# Pseudonymization
# --------------------------------------------------------------------------- #
def test_pseudonymize_fail_closed(monkeypatch):
    monkeypatch.delenv("NDSEP_LABEL_HASH_SALT", raising=False)
    monkeypatch.delenv("ANONYMIZATION_SALT", raising=False)
    with pytest.raises(RuntimeError, match="salt"):
        col.pseudonymize("NDPC-CMP-2026-000001")


def test_pseudonymize_deterministic_and_unlinked():
    a = col.pseudonymize("NDPC-CMP-2026-000001")
    b = col.pseudonymize("NDPC-CMP-2026-000001")
    c = col.pseudonymize("NDPC-CMP-2026-000002")
    assert a == b and a != c
    assert len(a) == 64 and "NDPC" not in a
    assert col.pseudonymize(None) is None


# --------------------------------------------------------------------------- #
# (a) Triage labels
# --------------------------------------------------------------------------- #
def test_build_triage_labels():
    complaints = pd.DataFrame([
        {"id": 1, "reference_code": "NDPC-CMP-2026-000001", "category": "consent",
         "resolution_notes": "Warned controller.", "updated_at": "2026-02-01"},
        {"id": 2, "reference_code": "NDPC-CMP-2026-000002", "category": "breach",
         "resolution_notes": None, "updated_at": "2026-02-02"},
        {"id": 3, "reference_code": "NDPC-CMP-2026-000003", "category": "minors",
         "resolution_notes": "   ", "updated_at": "2026-02-03"},
    ])
    events = pd.DataFrame([
        # complaint 1: first assignment (triage proposal) then a reassignment
        {"complaint_id": 1, "event_type": "assigned",
         "details": {"predicted_category": "consent", "team": "intake"},
         "created_at": "2026-01-10T09:00:00"},
        {"complaint_id": 1, "event_type": "assigned",
         "details": {"category": "consent", "team": "legal"},
         "created_at": "2026-01-11T09:00:00"},
        # complaint 2: single assignment, category corrected by the officer
        {"complaint_id": 2, "event_type": "assigned",
         "details": {"predicted_category": "other", "category": "breach",
                     "team": "investigations"},
         "created_at": "2026-01-12T09:00:00"},
        # complaint 3: no assignment events at all
        {"complaint_id": 1, "event_type": "status_change",
         "details": {}, "created_at": "2026-01-12T10:00:00"},
    ])
    out = col.build_triage_labels(complaints, events)
    assert len(out) == 3
    # no raw identifiers anywhere
    assert "reference_code" not in out.columns
    assert out["complaint_ref_hash"].str.len().eq(64).all()

    r1 = out[out["complaint_ref_hash"] ==
             col.pseudonymize("NDPC-CMP-2026-000001")].iloc[0]
    assert r1["predicted_category"] == "consent"
    assert r1["final_category"] == "consent"      # latest assignment wins
    assert r1["final_team"] == "legal"
    assert r1["has_resolution_notes"] == 1
    assert r1["triage_correct"] == 1.0

    r2 = out[out["complaint_ref_hash"] ==
             col.pseudonymize("NDPC-CMP-2026-000002")].iloc[0]
    assert r2["triage_correct"] == 0.0            # predicted 'other' != 'breach'
    assert r2["has_resolution_notes"] == 0

    r3 = out[out["complaint_ref_hash"] ==
             col.pseudonymize("NDPC-CMP-2026-000003")].iloc[0]
    assert pd.isna(r3["triage_correct"])          # no prediction recorded
    assert r3["final_category"] == "minors"       # falls back to complaint row
    assert r3["has_resolution_notes"] == 0        # whitespace-only notes


# --------------------------------------------------------------------------- #
# (b) Settlement outcome labels
# --------------------------------------------------------------------------- #
def test_build_settlement_labels():
    settlements = pd.DataFrame([
        {"id": 11, "settlement_ref": "NDPC-SET-2026-0001", "org_id": 7,
         "status": "fulfilled", "original_amount": 10_000_000.0,
         "reduction_amount": 2_000_000.0, "current_terms_version": 2,
         "updated_at": "2026-03-01"},
        {"id": 12, "settlement_ref": "NDPC-SET-2026-0002", "org_id": 8,
         "status": "defaulted", "original_amount": 5_000_000.0,
         "reduction_amount": 0.0, "current_terms_version": 1,
         "updated_at": "2026-03-02"},
        {"id": 13, "settlement_ref": "NDPC-SET-2026-0003", "org_id": 9,
         "status": "void", "original_amount": 1.0, "reduction_amount": 0.0,
         "current_terms_version": 1, "updated_at": "2026-03-03"},
        {"id": 14, "settlement_ref": "NDPC-SET-2026-0004", "org_id": 10,
         "status": "active", "original_amount": 1.0, "reduction_amount": 0.0,
         "current_terms_version": 1, "updated_at": "2026-03-04"},
    ])
    terms = pd.DataFrame([
        {"settlement_id": 11, "version": 1, "monetary_amount": 10_000_000.0,
         "non_monetary_obligations": [], "instalment_schedule": [],
         "confidentiality_flag": False},
        {"settlement_id": 11, "version": 2, "monetary_amount": 8_000_000.0,
         "non_monetary_obligations": ["appoint DPO", "staff training"],
         "instalment_schedule": [{"seq": 1}, {"seq": 2}, {"seq": 3}],
         "confidentiality_flag": True},
        {"settlement_id": 12, "version": 1, "monetary_amount": 5_000_000.0,
         "non_monetary_obligations": "[]",
         "instalment_schedule": [{"seq": 1}], "confidentiality_flag": False},
    ])
    out = col.build_settlement_labels(settlements, terms)

    # void and in-flight statuses excluded
    assert len(out) == 2
    by_ref = {h: r for h, r in zip(out["settlement_ref_hash"],
                                   out.to_dict("records"))}
    fulfilled = by_ref[col.pseudonymize("NDPC-SET-2026-0001")]
    defaulted = by_ref[col.pseudonymize("NDPC-SET-2026-0002")]
    assert fulfilled["settled_fulfilled"] == 1
    assert defaulted["settled_fulfilled"] == 0
    # terms features come from the LATEST version (v2)
    assert fulfilled["monetary_amount"] == 8_000_000.0
    assert fulfilled["n_instalments"] == 3
    assert fulfilled["n_obligations"] == 2
    assert fulfilled["confidential"] == 1
    assert fulfilled["reduction_ratio"] == pytest.approx(0.2)
    # identifiers pseudonymized, raw refs/org ids absent
    assert "settlement_ref" not in out.columns
    assert "org_id" not in out.columns


def test_settlement_labels_empty():
    out = col.build_settlement_labels(
        pd.DataFrame(columns=["id", "status"]), pd.DataFrame())
    assert len(out) == 0


# --------------------------------------------------------------------------- #
# (c) Penalty-survival labels
# --------------------------------------------------------------------------- #
def test_normalize_adjudication():
    assert col.normalize_adjudication("Penalty upheld in full") == 1
    assert col.normalize_adjudication("appeal dismissed") == 1
    assert col.normalize_adjudication("Penalty reduced to N2m") == 0
    assert col.normalize_adjudication("appeal allowed; fine quashed") == 0
    assert col.normalize_adjudication("partially upheld — amount varied") == 0
    assert col.normalize_adjudication("adjourned sine die") is None
    assert col.normalize_adjudication(None) is None
    assert col.normalize_adjudication("") is None


def test_build_penalty_survival_labels():
    hearings = pd.DataFrame([
        {"appeal_id": 21, "status": "held", "outcome": "upheld",
         "updated_at": "2026-04-01"},
        {"appeal_id": 22, "status": "held", "outcome": "penalty reduced",
         "updated_at": "2026-04-02"},
        {"appeal_id": 23, "status": "scheduled", "outcome": None,
         "updated_at": "2026-04-03"},                       # not adjudicated
        {"appeal_id": 24, "status": "held", "outcome": "see minutes",
         "updated_at": "2026-04-04"},                       # unmappable
    ])
    escalations = pd.DataFrame([
        {"appeal_id": 22, "penalty_id": 900, "status": "decided",
         "decision": "tribunal affirmed the penalty",
         "decided_at": "2026-05-01", "updated_at": "2026-05-01"},
        {"appeal_id": 25, "penalty_id": 901, "status": "withdrawn",
         "decision": None, "decided_at": None,
         "updated_at": "2026-05-02"},                       # not decided
    ])
    out = col.build_penalty_survival_labels(hearings, escalations)

    # appeal 22 was reduced at hearing but AFFIRMED at tribunal (latest wins)
    assert len(out) == 2
    by_appeal = {h: r for h, r in zip(out["appeal_hash"],
                                      out.to_dict("records"))}
    a21 = by_appeal[col.pseudonymize("appeal:21")]
    a22 = by_appeal[col.pseudonymize("appeal:22")]
    assert a21["penalty_upheld"] == 1 and a21["source"] == "appeal_hearing"
    assert a22["penalty_upheld"] == 1 and a22["source"] == "tribunal"
    assert a22["penalty_hash"] == col.pseudonymize("penalty:900")
    # raw appeal/penalty ids absent
    assert "appeal_id" not in out.columns and "penalty_id" not in out.columns


def test_penalty_survival_empty():
    out = col.build_penalty_survival_labels(pd.DataFrame(), pd.DataFrame())
    assert len(out) == 0
    assert list(out.columns) == ["appeal_hash", "penalty_hash", "source",
                                 "penalty_upheld", "decided_at"]
