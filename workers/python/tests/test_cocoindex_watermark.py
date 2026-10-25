"""Watermark safety tests for cocoindex_etl_worker (round-9).

Invariant under test: an ETL source's watermark may ONLY advance after the
Qdrant upsert for that batch has succeeded — a failed (or skipped) upsert
must leave the watermark untouched so the rows are retried next run.

    pytest workers/python/tests/test_cocoindex_watermark.py -v
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import cocoindex_etl_worker as w  # noqa: E402


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def execute(self, _sql, _params=None):
        return None

    def fetchall(self):
        return self._rows


class _FakeConn:
    def __init__(self, rows):
        self._rows = rows

    def cursor(self, **_kw):
        return _FakeCursor(self._rows)


POLICY_ROW = {
    "id": "42", "name": "Data Retention Policy", "description": "keep 5y",
    "policy_type": "retention", "status": "active", "sector": "banking",
    "last_modified": "2026-02-01 10:00:00",
}


@pytest.fixture(autouse=True)
def _reset_watermarks():
    saved = dict(w._watermarks)
    w._watermarks.clear()
    yield
    w._watermarks.clear()
    w._watermarks.update(saved)


def _patch_embed(monkeypatch):
    monkeypatch.setattr(w, "embed",
                        lambda texts: [[0.1] * 384 for _ in texts])


def test_watermark_not_advanced_when_upsert_fails(monkeypatch):
    """Upsert raising => watermark stays at the default; error propagates to
    run_etl's per-source guard."""
    _patch_embed(monkeypatch)

    def boom(_collection, _points):
        raise RuntimeError("qdrant unavailable")

    monkeypatch.setattr(w, "upsert_to_qdrant", boom)
    with pytest.raises(RuntimeError, match="qdrant unavailable"):
        w.etl_policies(_FakeConn([POLICY_ROW]))
    assert w._watermarks.get("policies", "1970-01-01") == "1970-01-01"


def test_watermark_advances_after_successful_upsert(monkeypatch):
    _patch_embed(monkeypatch)
    calls = []
    monkeypatch.setattr(w, "upsert_to_qdrant",
                        lambda coll, pts: calls.append((coll, pts)) or len(pts))
    count = w.etl_policies(_FakeConn([POLICY_ROW]))
    assert count == len(calls[0][1]) > 0
    assert calls[0][0] == "ndsep_policies"
    assert w._watermarks["policies"] == POLICY_ROW["last_modified"]


def test_watermark_not_advanced_when_embedding_fails(monkeypatch):
    """All rows failing to embed => no upsert attempted, no advance."""
    monkeypatch.setattr(w, "embed", lambda texts: None)
    upsert_called = []
    monkeypatch.setattr(w, "upsert_to_qdrant",
                        lambda *a: upsert_called.append(a) or 0)
    count = w.etl_policies(_FakeConn([POLICY_ROW]))
    assert count == 0
    assert upsert_called == []
    assert w._watermarks.get("policies", "1970-01-01") == "1970-01-01"


def test_upsert_raises_when_qdrant_client_unavailable():
    """upsert_to_qdrant must not swallow sink errors (previous version
    returned 0, letting the watermark advance past un-indexed rows)."""
    pytest.importorskip("sys")
    if "qdrant_client" in sys.modules:
        pytest.skip("qdrant_client installed — failure path is the raise itself")
    with pytest.raises(Exception):
        w.upsert_to_qdrant("ndsep_policies",
                           [{"id": 1, "vector": [0.0] * 384, "payload": {}}])
