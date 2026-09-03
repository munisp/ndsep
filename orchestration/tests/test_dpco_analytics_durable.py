"""Contract tests for durable DPCO analytics persistence.

The test double implements the narrow psycopg connection protocol used by the
service. It validates SQL parameterization and transaction sequencing without
requiring a live database in source CI; protected staging separately validates
the actual PostgreSQL migration and runtime connectivity.
"""
from __future__ import annotations

import importlib.util
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest

SERVICE_PATH = Path(__file__).parents[1] / "python" / "dpco_analytics" / "service.py"
SPEC = importlib.util.spec_from_file_location("dpco_analytics_service_under_test", SERVICE_PATH)
assert SPEC and SPEC.loader
service = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(service)


class Result:
    def __init__(self, row: dict[str, Any] | None = None, rows: list[dict[str, Any]] | None = None):
        self.row = row
        self.rows = rows or []

    def fetchone(self):
        return self.row

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self):
        self.statements: list[tuple[str, tuple[Any, ...]]] = []
        self.transactions = 0
        self.duplicate = False

    @contextmanager
    def transaction(self):
        self.transactions += 1
        yield self

    def execute(self, sql: str, params: tuple[Any, ...] = ()):  # psycopg-compatible narrow protocol
        self.statements.append((" ".join(sql.split()), params))
        if "INSERT INTO dpco_analytics_events" in sql:
            return Result(None if self.duplicate else {"id": "durable-event"})
        if "COUNT(*)" in sql:
            return Result({"count": 0})
        return Result()


class FakePool:
    def __init__(self):
        self.connection_object = FakeConnection()
        self.closed = False

    @contextmanager
    def connection(self):
        yield self.connection_object

    def close(self):
        self.closed = True


def build_store(monkeypatch: pytest.MonkeyPatch) -> tuple[Any, FakePool]:
    fake_pool = FakePool()
    monkeypatch.setattr(service, "ConnectionPool", lambda **_kwargs: fake_pool)
    return service.DurableAnalyticsStore("postgresql://durable-test"), fake_pool


def valid_event(**overrides: Any) -> dict[str, Any]:
    event = {
        "event_type": "dpco.audit.control_assessed",
        "dpco_id": "dpco-test-001",
        "timestamp": "2026-09-01T12:00:00+00:00",
        "compliance_score": 88.5,
    }
    event.update(overrides)
    return event


def test_event_is_persisted_before_aggregate_and_duplicate_does_not_increment(monkeypatch: pytest.MonkeyPatch):
    store, fake_pool = build_store(monkeypatch)
    assert store.ingest_event(valid_event(), "api") is True
    statements = fake_pool.connection_object.statements
    assert fake_pool.connection_object.transactions == 1
    assert len(statements) == 2
    assert "INSERT INTO dpco_analytics_events" in statements[0][0]
    assert "ON CONFLICT (source, payload_sha256) DO NOTHING" in statements[0][0]
    assert "INSERT INTO dpco_analytics_dpco_stats" in statements[1][0]
    assert statements[0][1][3] == "api"
    assert statements[0][1][5] == 88.5

    fake_pool.connection_object.duplicate = True
    assert store.ingest_event(valid_event(), "api") is False
    assert fake_pool.connection_object.transactions == 2
    assert len(fake_pool.connection_object.statements) == 3
    assert "INSERT INTO dpco_analytics_events" in fake_pool.connection_object.statements[-1][0]


def test_invalid_event_is_rejected_before_any_database_statement(monkeypatch: pytest.MonkeyPatch):
    store, fake_pool = build_store(monkeypatch)
    with pytest.raises(ValueError, match="UTC offset"):
        store.ingest_event(valid_event(timestamp="2026-09-01T12:00:00"), "api")
    with pytest.raises(ValueError, match="between 0 and 100"):
        store.ingest_event(valid_event(compliance_score=101), "api")
    with pytest.raises(ValueError, match="source is not permitted"):
        store.ingest_event(valid_event(), "untrusted")
    assert fake_pool.connection_object.statements == []


def test_production_configuration_has_no_memory_or_credential_fallback(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(service, "APP_ENV", "production")
    monkeypatch.setattr(service, "DATABASE_URL", None)
    monkeypatch.setattr(service, "SERVICE_TOKEN", "")
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        service.require_configuration()

    monkeypatch.setattr(service, "DATABASE_URL", "postgresql://analytics.example.internal/ndsep")
    with pytest.raises(RuntimeError, match="SERVICE_TOKEN"):
        service.require_configuration()
