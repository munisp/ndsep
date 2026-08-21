"""
NDSEP Python Workers — Shared PostgreSQL DB Helper
===================================================
Provides a connection factory for all Python workers using psycopg2.
"""
import os
import logging
import psycopg2
import psycopg2.extras

log = logging.getLogger(__name__)
_DEFAULT_DSN = "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"

def _build_dsn():
    """
    Priority: WORKER_DATABASE_URL > LOCAL_DATABASE_URL > DATABASE_URL > _DEFAULT_DSN
    """
    dsn = (
        os.environ.get("WORKER_DATABASE_URL")
        or os.environ.get("LOCAL_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
        or _DEFAULT_DSN
    )
    return dsn

def get_connection(autocommit=False):
    dsn = _build_dsn()
    try:
        conn = psycopg2.connect(dsn, cursor_factory=psycopg2.extras.RealDictCursor)
        conn.autocommit = autocommit
        return conn
    except psycopg2.OperationalError as e:
        log.error("[DB] Connection failed: %s", e)
        raise

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
                row = cur.fetchone()
                return {"status": "healthy", "db": "postgresql"}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}
