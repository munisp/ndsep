"""Real PostgreSQL integration coverage for durable DPCO analytics.

This test is intentionally skipped unless DPCO_ANALYTICS_DATABASE_URL identifies a
CI-owned disposable database. It never falls back to SQLite, memory, a fixture
file, staging, or production.
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

ROOT = Path(__file__).parents[2]
DSN = os.environ.get("DPCO_ANALYTICS_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="DPCO_ANALYTICS_DATABASE_URL is required for real PostgreSQL integration coverage")


def load_service():
    source = ROOT / "orchestration" / "python" / "dpco_analytics" / "service.py"
    spec = importlib.util.spec_from_file_location("dpco_analytics_real_postgres", source)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def apply_active_analytics_migration() -> None:
    migration = ROOT / "drizzle" / "0036_dpco_analytics_durable_events.sql"
    with psycopg.connect(DSN, autocommit=True) as connection:
        connection.execute(migration.read_text(encoding="utf-8"))
        connection.execute("TRUNCATE TABLE dpco_analytics_events, dpco_analytics_dpco_stats RESTART IDENTITY")


def event(event_type: str, **extra):
    payload = {
        "event_type": event_type,
        "dpco_id": "dpco-ci-postgres-001",
        "timestamp": "2026-09-01T12:00:00+00:00",
    }
    payload.update(extra)
    return payload


def test_durable_analytics_persists_idempotent_events_and_postgresql_aggregates():
    apply_active_analytics_migration()
    service = load_service()
    store = service.DurableAnalyticsStore(DSN)
    try:
        assert store.ingest_event(event("dpco.audit.initiated"), "api") is True
        assert store.ingest_event(event("dpco.audit.control_assessed", compliance_score=91.5), "api") is True
        assert store.ingest_event(event("dpco.sla.breached"), "api") is True
        assert store.ingest_event(event("dpco.audit.control_assessed", compliance_score=91.5), "api") is False

        with psycopg.connect(DSN, row_factory=dict_row) as connection:
            event_count = connection.execute("SELECT COUNT(*)::int AS count FROM dpco_analytics_events").fetchone()
            stats = connection.execute(
                """
                SELECT audits_initiated, audits_completed, statements_issued,
                       score_total, score_count, sla_breaches
                FROM dpco_analytics_dpco_stats WHERE dpco_id = %s
                """,
                ("dpco-ci-postgres-001",),
            ).fetchone()
            outbox = connection.execute(
                "SELECT to_regclass('public.domain_event_outbox') IS NOT NULL AS exists"
            ).fetchone()

        assert event_count == {"count": 3}
        assert stats == {
            "audits_initiated": 1,
            "audits_completed": 0,
            "statements_issued": 0,
            "score_total": 91.5,
            "score_count": 1,
            "sla_breaches": 1,
        }
        assert outbox == {"exists": True}
        assert store.trends()["source"] == "postgresql"
    finally:
        store.close()
