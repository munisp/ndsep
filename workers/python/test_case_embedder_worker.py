#!/usr/bin/env python3
"""
Pytest suite for case_embedder_worker (round 12, wave 6 — roadmap §4.3).

Focus: the PII-redaction contract. Text cards embedded into Qdrant must NEVER
carry raw data-subject or respondent identifiers — emails, MSISDN/phone
numbers, NIN/BVN (11-digit) runs, and long identifier digit runs are
HMAC-masked. Also covers penalty banding, text-card assembly, payload shape,
and point-id determinism.

No Postgres / Qdrant / sentence-transformers required: the worker imports its
heavy deps lazily so the redaction path is unit-testable in isolation.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import case_embedder_worker as w  # noqa: E402


# ── redact_pii ────────────────────────────────────────────────────────────────

def test_redact_email():
    out = w.redact_pii("Complainant amina.bello@example.com reported spam.")
    assert "amina.bello@example.com" not in out
    assert "@" not in out
    assert "[email:" in out


def test_redact_nigerian_msisdn_variants():
    for raw in ("08031234567", "+2348031234567", "234 803 123 4567",
                "+234 803 123 4567", "0901 234 5678"):
        out = w.redact_pii(f"call me on {raw} anytime")
        assert raw not in out, f"raw MSISDN survived: {raw}"
        assert "[phone:" in out


def test_redact_nin_and_bvn_11_digit():
    out = w.redact_pii("NIN 12345678901 and BVN 22223334444 were exposed.")
    assert "12345678901" not in out
    assert "22223334444" not in out
    assert out.count("[nin:") == 2


def test_redact_long_identifier_runs():
    out = w.redact_pii("account 0123456789 referenced in the complaint")
    assert "0123456789" not in out
    assert "[id:" in out


def test_redact_preserves_non_pii():
    out = w.redact_pii("Breach affected marketing consents across 3 products.")
    assert "marketing consents" in out
    # Short numbers (not identifier-shaped) survive.
    assert "3 products" in out


def test_redact_empty_and_none():
    assert w.redact_pii(None) == ""
    assert w.redact_pii("") == ""


def test_redact_masks_are_deterministic_and_keyed_shape():
    a = w.redact_pii("mail a@b.co")
    b = w.redact_pii("mail a@b.co")
    assert a == b  # deterministic HMAC mask
    # Mask is a truncated hex digest, not the raw value or a trivial reversal.
    assert "a@b.co" not in a


def test_redact_combined_pii_text():
    raw = ("Subject: Musa Ibrahim, musa.ibrahim@yahoo.ng, +2347012345678, "
           "NIN 98765432109 complained about a fintech breach.")
    out = w.redact_pii(raw)
    for pii in ("musa.ibrahim@yahoo.ng", "+2347012345678", "98765432109"):
        assert pii not in out
    assert "fintech breach" in out  # substance preserved


# ── build_text_card ───────────────────────────────────────────────────────────

def _card(**over):
    card = {
        "case_type": "complaint",
        "case_id": "77",
        "reference": "NDPC-CMP-2025-000077",
        "category": "breach",
        "sector": "fintech",
        "outcome": "resolved",
        "penalty_band": "none",
        "decided_at": "2025-11-02",
        "summary": "Controller emailed the complainant at victim@mail.ng from 08031234567.",
    }
    card.update(over)
    return card


def test_text_card_structure():
    text = w.build_text_card(_card())
    assert "Case type: complaint" in text
    assert "Category: breach" in text
    assert "Sector: fintech" in text
    assert "Outcome: resolved" in text
    assert "Penalty band: none" in text
    assert "Decided at: 2025-11-02" in text


def test_text_card_redacts_summary_pii():
    text = w.build_text_card(_card())
    assert "victim@mail.ng" not in text
    assert "08031234567" not in text


def test_payload_has_required_metadata_and_no_free_text():
    card = _card()
    payload = w.payload_from_card(card)
    for key in ("case_type", "case_id", "sector", "outcome", "penalty_band", "decided_at"):
        assert key in payload
    # No free text in the payload — summaries are embedded, not stored raw.
    assert "summary" not in payload
    assert "victim@mail.ng" not in str(payload)
    assert payload["case_type"] == "complaint"


# ── penalty_band ─────────────────────────────────────────────────────────────

def test_penalty_band_buckets():
    assert w.penalty_band(None) == "none"
    assert w.penalty_band(0) == "none"
    assert w.penalty_band(500_000) == "under_2m"
    assert w.penalty_band(1_999_999.99) == "under_2m"
    assert w.penalty_band(2_000_000) == "2m_10m"
    assert w.penalty_band(9_999_999) == "2m_10m"
    assert w.penalty_band(10_000_000) == "10m_50m"
    assert w.penalty_band(49_999_999) == "10m_50m"
    assert w.penalty_band(50_000_000) == "over_50m"
    assert w.penalty_band(1000, currency="USD") == "non_ngn"
    assert w.penalty_band("not-a-number") == "unknown"


# ── point_id determinism ─────────────────────────────────────────────────────

def test_point_id_deterministic_and_in_range():
    a = w.point_id("complaint", "77")
    b = w.point_id("complaint", "77")
    c = w.point_id("settlement", "77")
    assert a == b
    assert a != c
    assert 0 <= a < 2**31


# ── source registry ──────────────────────────────────────────────────────────

def test_sources_cover_mission_scope():
    assert set(w.SOURCE_QUERIES.keys()) == {
        "public_complaints", "enforcement_cases", "settlements", "tribunal_escalations"}
    # Decided/closed rows only.
    assert "('resolved', 'closed')" in w.SOURCE_QUERIES["public_complaints"]["sql"]
    assert "('settled', 'closed')" in w.SOURCE_QUERIES["enforcement_cases"]["sql"]
    assert "('fulfilled', 'defaulted')" in w.SOURCE_QUERIES["settlements"]["sql"]
    assert "'decided'" in w.SOURCE_QUERIES["tribunal_escalations"]["sql"]


def test_source_queries_never_select_pii_columns():
    """Hard guarantee: PII columns are not even SELECTed from the DB."""
    pii_columns = ("complainant_name", "complainant_email", "complainant_phone",
                   "respondent_name", "respondent_email", "data_subject_email",
                   "data_subject_name", "data_subject_nin", "submitter_ip_hash")
    for name, src in w.SOURCE_QUERIES.items():
        sql = src["sql"].lower()
        for col in pii_columns:
            assert col not in sql, f"{name} selects PII column {col}"
