"""
NDSEP Python Workers — Shared PostgreSQL DB Helper
===================================================
Provides a connection factory for all Python workers using psycopg2.

Fail-closed (round-9): the embedded default DSN (hardcoded
``ndsep_user`` credentials) was removed. A DSN MUST
come from the environment — WORKER_DATABASE_URL > LOCAL_DATABASE_URL >
DATABASE_URL > NDSEP_PG_URL — or ``require_dsn`` raises a clear error and
no connection is attempted.
"""
import json
import logging
import os

import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)

DSN_ENV_VARS = ("WORKER_DATABASE_URL", "LOCAL_DATABASE_URL", "DATABASE_URL",
                "NDSEP_PG_URL")


def require_dsn(dsn: str | None = None) -> str:
    """Return a configured PostgreSQL DSN or raise a clear error.

    Resolution order (when ``dsn`` is not given): WORKER_DATABASE_URL,
    LOCAL_DATABASE_URL, DATABASE_URL, NDSEP_PG_URL. No embedded default:
    refuses to connect with implicit/empty credentials.
    """
    dsn = dsn or next((os.environ.get(v) for v in DSN_ENV_VARS
                       if os.environ.get(v)), None)
    if not dsn:
        raise RuntimeError(
            "PostgreSQL DSN not configured: set WORKER_DATABASE_URL "
            "(or LOCAL_DATABASE_URL / DATABASE_URL / NDSEP_PG_URL). "
            "Embedded default credentials were removed in round-9 — "
            "refusing to connect with implicit libpq defaults.")
    return dsn


def _build_dsn():
    """Backward-compatible alias for require_dsn()."""
    return require_dsn()


def get_connection(autocommit=False):
    dsn = require_dsn()
    try:
        conn = psycopg2.connect(dsn, cursor_factory=psycopg2.extras.RealDictCursor)
        conn.autocommit = autocommit
        return conn
    except psycopg2.OperationalError as e:
        log.error("[DB] Connection failed: %s", e)
        raise


def get_db_connection():
    """Plain (tuple-cursor) connection — used by the sector/banking workers."""
    dsn = require_dsn()
    try:
        return psycopg2.connect(dsn)
    except psycopg2.OperationalError as e:
        log.error("[DB] Connection failed: %s", e)
        raise


def publish_event(event_type: str, payload: dict):
    """Relay a worker event to the NDSEP event relay; falls back to logs.

    Never raises: event delivery must not break worker loops.
    """
    relay = os.environ.get("WORKER_RELAY_URL") or os.environ.get(
        "RELAY_URL") or "http://localhost:3000/api/workers/event"
    body = {"workerId": "python-worker", "event": event_type,
            "data": payload}
    try:
        import requests
        requests.post(relay, json=body, timeout=3)
        return
    except Exception:
        pass
    log.info("[EVENT] %s: %s", event_type, json.dumps(payload, default=str))


def execute_query(sql, params=None, fetch=True):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            if fetch:
                return cur.fetchall()
            conn.commit()
            return cur.rowcount


def health_check():
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                cur.fetchone()
                return {"status": "healthy", "db": "postgresql"}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}
