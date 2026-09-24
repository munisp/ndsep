#!/usr/bin/env python3
"""
Pytest suite for regintel_ingest_worker.

Covers: section chunking (NDPA/GAID style), oversize splitting, explicit
UNCONFIGURED degradation for embedding / Qdrant / gazette watch, and the
ingest pipeline's honest status reporting. No live Ollama/Qdrant required —
the tests assert the explicit-degradation contract (no silent mocks).
"""
import os
import sys

# Ensure the worker module is importable regardless of pytest invocation dir.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import regintel_ingest_worker as w  # noqa: E402

NDPA_SAMPLE = """NIGERIA DATA PROTECTION ACT, 2023

ARRANGEMENT OF SECTIONS

Section 1. Establishment of the Commission
There is established the Nigeria Data Protection Commission (in this Act referred to as "the Commission").

Section 2. Objectives of the Commission
The objectives of the Commission are to safeguard the fundamental rights and freedoms of data subjects.

Section 44. Registration of data controllers
A data controller of major importance shall register with the Commission within six months.
"""

LONG_SECTION_BODY = "Section 99. Transitional provisions\n" + ("\n\n" + "x" * 1500) * 6


def test_chunk_by_section_basic():
    chunks = w.chunk_by_section(NDPA_SAMPLE)
    refs = [c["section_ref"] for c in chunks]
    assert "Section 1" in refs
    assert "Section 2" in refs
    assert "Section 44" in refs
    # Preamble before the first section marker is retained.
    assert "Preamble" in refs
    # No text is dropped: every chunk body is non-empty.
    assert all(c["body"].strip() for c in chunks)
    # Headings parsed from the section line.
    s1 = next(c for c in chunks if c["section_ref"] == "Section 1")
    assert s1["heading"] == "Establishment of the Commission"


def test_chunk_normalizes_case_and_subsections():
    text = "SECTION 44(2)(a) Data processing\nBody text here.\nArticle 5 Principles\nMore text."
    chunks = w.chunk_by_section(text)
    refs = [c["section_ref"] for c in chunks]
    assert "Section 44(2)(a)" in refs
    assert "Article 5" in refs


def test_chunk_empty_and_unsectioned():
    assert w.chunk_by_section("") == []
    chunks = w.chunk_by_section("Just a blob of legal text with no markers.")
    assert len(chunks) >= 1
    assert chunks[0]["section_ref"] == "Unsectioned"


def test_chunk_oversize_split():
    chunks = w.chunk_by_section(LONG_SECTION_BODY)
    assert len(chunks) > 1
    assert all(c["section_ref"] == "Section 99" for c in chunks)
    assert [c["chunk_index"] for c in chunks] == list(range(len(chunks)))
    assert all(len(c["body"]) <= w.MAX_CHUNK_CHARS for c in chunks)


def test_embed_unconfigured_without_flag(monkeypatch):
    monkeypatch.setattr(w, "EMBED_ENABLED", False)
    status = w.embed_status()
    assert status["status"] == "EMBED_UNCONFIGURED"
    assert w.embed_texts(["hello"]) is None


def test_qdrant_unconfigured_without_flag(monkeypatch):
    monkeypatch.setattr(w, "QDRANT_ENABLED", False)
    status = w.qdrant_status()
    assert status["status"] == "QDRANT_UNCONFIGURED"
    assert status["collection"] == "legal_corpus"


def test_gazette_unconfigured_without_url(monkeypatch, tmp_path):
    monkeypatch.setattr(w, "GAZETTE_SOURCE_URL", "")
    monkeypatch.setattr(w, "GAZETTE_STATE_FILE", str(tmp_path / "digest.txt"))
    result = w.gazette_check()
    assert result["status"] == "UNCONFIGURED"
    # State file must not be created when unconfigured (no fake checks).
    assert not (tmp_path / "digest.txt").exists()


def test_ingest_degrades_explicitly(monkeypatch):
    monkeypatch.setattr(w, "EMBED_ENABLED", False)
    monkeypatch.setattr(w, "QDRANT_ENABLED", False)
    result = w.ingest({
        "instrument_code": "NDPA-2023",
        "instrument_title": "Nigeria Data Protection Act 2023",
        "version_label": "2023-original",
        "effective_date": "2023-06-12",
        "text": NDPA_SAMPLE,
    })
    assert result["status"] == "ok"
    assert result["chunk_count"] >= 3
    # Explicit degradation — never a fake "embedded"/"upserted".
    assert result["embed_status"]["status"] == "EMBED_UNCONFIGURED"
    assert result["qdrant_status"]["status"] == "QDRANT_SKIPPED"
    # No chunk claims a qdrant point when nothing was upserted.
    assert all("qdrant_point_id" not in c for c in result["chunks"])


def test_ingest_requires_text():
    result = w.ingest({"text": "   "})
    assert result["status"] == "error"


def test_health_reports_configuration_honestly(monkeypatch):
    monkeypatch.setattr(w, "EMBED_ENABLED", False)
    monkeypatch.setattr(w, "QDRANT_ENABLED", False)
    monkeypatch.setattr(w, "GAZETTE_SOURCE_URL", "")
    h = w.health()
    assert h["embed"]["status"] == "EMBED_UNCONFIGURED"
    assert h["qdrant"]["status"] == "QDRANT_UNCONFIGURED"
    assert h["gazette"]["status"] == "UNCONFIGURED"
