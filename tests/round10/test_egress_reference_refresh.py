"""
pytest suite for the egress_monitor_worker reference-data update path
(Round-10, migration 0120): ReferenceDB.refresh must
  - request only status='active' rows from PostgREST,
  - fall back to an unfiltered read on pre-0120 schemas (HTTP 400),
  - defensively drop superseded/revoked rows client-side even if the server
    returns them.

No network: SESSION.get is monkeypatched with a canned responder.
"""
import importlib.util
import os
import sys

import pytest

WORKER_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "workers", "python", "egress_monitor_worker.py"
)
spec = importlib.util.spec_from_file_location("egress_monitor_worker", WORKER_PATH)
emw = importlib.util.module_from_spec(spec)
sys.modules["egress_monitor_worker"] = emw
spec.loader.exec_module(emw)


class _Resp:
    def __init__(self, rows, status_code=200):
        self._rows = rows
        self.status_code = status_code

    def json(self):
        return self._rows

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


ROWS = [
    {"id": 1, "cidr": "41.58.0.0/16", "is_nigerian": True, "status": "active"},
    {"id": 2, "cidr": "8.8.8.0/24", "is_nigerian": False, "status": "superseded"},
    {"id": 3, "cidr": "102.88.0.0/13", "is_nigerian": True, "status": "revoked"},
    {"id": 4, "cidr": "197.210.0.0/16", "is_nigerian": True},  # legacy row without status
    {"id": 5, "cidr": None, "asn": 29465, "status": "active"},  # ASN-only row: no CIDR
]


def test_refresh_requests_active_only(monkeypatch):
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append((url, params))
        return _Resp(ROWS)

    monkeypatch.setattr(emw.SESSION, "get", fake_get)
    db = emw.ReferenceDB()
    db.refresh()

    assert calls[0][1].get("status") == "eq.active"
    # active + legacy-no-status rows kept; superseded/revoked dropped
    cidrs = {str(e[0]) for e in db.entries}
    assert cidrs == {"41.58.0.0/16", "197.210.0.0/16"}
    assert db.classify("41.58.0.1")["verdict"] == "domestic"


def test_refresh_falls_back_when_status_column_missing(monkeypatch):
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(params)
        if params and "status" in params:
            return _Resp({"message": "column not found"}, status_code=400)
        return _Resp([{"id": 9, "cidr": "105.112.0.0/12", "is_nigerian": True}])

    monkeypatch.setattr(emw.SESSION, "get", fake_get)
    db = emw.ReferenceDB()
    db.refresh()

    assert len(calls) == 2  # first filtered (400), then unfiltered fallback
    assert "status" not in calls[1]
    assert {str(e[0]) for e in db.entries} == {"105.112.0.0/12"}
