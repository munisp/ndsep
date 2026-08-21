"""
NDSEP Python Worker Base Library
=================================
Production-grade base utilities for all NDSEP Python workers:
  - Structured JSON logging
  - PostgreSQL connection with retry/backoff
  - HTTP event broadcaster with retry
  - Graceful shutdown via SIGTERM/SIGINT
  - Health check HTTP server (GET /health, GET /status)
  - Exponential backoff decorator
"""

import json
import logging
import os
import signal
import sys
import threading
import time
from datetime import datetime, timezone
from functools import wraps
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Callable, Dict, Optional

import psycopg2
import psycopg2.pool
import requests

# ─── Structured JSON Logger ───────────────────────────────────────────────────

class JSONFormatter(logging.Formatter):
    """Formats log records as single-line JSON for production log aggregation."""

    def __init__(self, worker_id: str):
        super().__init__()
        self.worker_id = worker_id

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "worker": self.worker_id,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            entry["error"] = self.formatException(record.exc_info)
        if hasattr(record, "data"):
            entry["data"] = record.data
        return json.dumps(entry)


def get_logger(worker_id: str) -> logging.Logger:
    """Returns a structured JSON logger for the given worker ID."""
    logger = logging.getLogger(worker_id)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JSONFormatter(worker_id))
        logger.addHandler(handler)
    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logger.setLevel(getattr(logging, level, logging.INFO))
    return logger


# ─── Database Connection Pool ─────────────────────────────────────────────────

_pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None
_pool_lock = threading.Lock()

def get_db_url() -> str:
    return os.environ.get(
        "WORKER_DATABASE_URL",
        "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
    )


def init_db(
    worker_id: str,
    min_conn: int = 1,
    max_conn: int = 5,
    max_retries: int = 5,
) -> psycopg2.pool.ThreadedConnectionPool:
    """
    Initialises a threaded connection pool with exponential backoff retry.
    Returns the pool on success; raises RuntimeError after max_retries.
    """
    global _pool
    log = get_logger(worker_id)
    url = get_db_url()

    for attempt in range(1, max_retries + 1):
        try:
            pool = psycopg2.pool.ThreadedConnectionPool(
                min_conn, max_conn, url,
                connect_timeout=5,
                options="-c statement_timeout=30000",  # 30s per query
                application_name=f"ndsep-{worker_id}",
            )
            # Verify connectivity
            conn = pool.getconn()
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
            pool.putconn(conn)
            _pool = pool
            log.info(f"Connected to PostgreSQL (attempt {attempt}/{max_retries})")
            return pool
        except Exception as exc:
            delay = 0.5 * (2 ** (attempt - 1))
            log.warning(
                f"DB connect failed (attempt {attempt}/{max_retries}): {exc} — "
                f"retrying in {delay:.1f}s"
            )
            time.sleep(delay)

    raise RuntimeError(f"[{worker_id}] Failed to connect to PostgreSQL after {max_retries} attempts")


def get_conn(pool: psycopg2.pool.ThreadedConnectionPool):
    """Context manager: acquire a connection from the pool, auto-return on exit."""
    class _Ctx:
        def __enter__(self):
            self.conn = pool.getconn()
            return self.conn
        def __exit__(self, exc_type, exc_val, exc_tb):
            if exc_type:
                self.conn.rollback()
            pool.putconn(self.conn)
    return _Ctx()


# ─── Retry Decorator ─────────────────────────────────────────────────────────

def with_retry(
    max_attempts: int = 3,
    base_delay: float = 0.2,
    exceptions: tuple = (Exception,),
    logger: Optional[logging.Logger] = None,
):
    """
    Decorator: retries the wrapped function with exponential backoff.
    Only retries on the specified exception types.
    """
    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except exceptions as exc:
                    last_exc = exc
                    if attempt < max_attempts:
                        delay = base_delay * (2 ** (attempt - 1))
                        if logger:
                            logger.warning(
                                f"{fn.__name__} failed (attempt {attempt}/{max_attempts}): "
                                f"{exc} — retrying in {delay:.2f}s"
                            )
                        time.sleep(delay)
            raise last_exc
        return wrapper
    return decorator


# ─── Event Broadcaster ────────────────────────────────────────────────────────

_relay_url: str = ""
_http_session: Optional[requests.Session] = None


def init_relay(worker_id: str) -> None:
    global _relay_url, _http_session
    _relay_url = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
    _http_session = requests.Session()
    _http_session.headers.update({"Content-Type": "application/json"})
    adapter = requests.adapters.HTTPAdapter(max_retries=2)
    _http_session.mount("http://", adapter)
    get_logger(worker_id).info(f"Relay URL: {_relay_url}")


def broadcast(event: str, data: Dict[str, Any]) -> None:
    """Posts an event to the Node.js WebSocket relay. Silently fails if unavailable."""
    if not _relay_url or not _http_session:
        return
    try:
        _http_session.post(
            _relay_url,
            json={"event": event, "data": data},
            timeout=3,
        )
    except Exception:
        pass  # Relay may be temporarily unavailable


# ─── Graceful Shutdown ────────────────────────────────────────────────────────

_shutdown_event = threading.Event()


def setup_shutdown(worker_id: str, cleanup: Optional[Callable] = None) -> threading.Event:
    """
    Registers SIGTERM/SIGINT handlers that set a shutdown event.
    Returns the event so the main loop can poll it.
    """
    log = get_logger(worker_id)

    def _handler(signum, _frame):
        sig_name = signal.Signals(signum).name
        log.info(f"Received {sig_name} — initiating graceful shutdown")
        _shutdown_event.set()
        if cleanup:
            try:
                cleanup()
            except Exception as exc:
                log.error(f"Cleanup error: {exc}")

    signal.signal(signal.SIGTERM, _handler)
    signal.signal(signal.SIGINT, _handler)
    return _shutdown_event


def is_shutting_down() -> bool:
    return _shutdown_event.is_set()


# ─── Health Check HTTP Server ─────────────────────────────────────────────────

class _HealthState:
    def __init__(self, worker_id: str):
        self.worker_id = worker_id
        self.start_time = time.time()
        self.cycles_run = 0
        self.last_run_at: Optional[float] = None
        self.extra: Dict[str, Any] = {}
        self._lock = threading.Lock()

    def increment_cycle(self):
        with self._lock:
            self.cycles_run += 1
            self.last_run_at = time.time()

    def set_extra(self, key: str, value: Any):
        with self._lock:
            self.extra[key] = value

    def to_dict(self, db_ok: bool) -> Dict[str, Any]:
        with self._lock:
            status = "healthy" if db_ok else "degraded"
            d = {
                "status": status,
                "worker": self.worker_id,
                "uptime_sec": int(time.time() - self.start_time),
                "cycles_run": self.cycles_run,
                "last_run": (
                    datetime.fromtimestamp(self.last_run_at, tz=timezone.utc).isoformat()
                    if self.last_run_at else None
                ),
                "database": {"ok": db_ok},
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            d.update(self.extra)
            return d


def _make_health_handler(state: _HealthState, pool):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path not in ("/health", "/status"):
                self.send_response(404)
                self.end_headers()
                return
            db_ok = False
            if pool:
                try:
                    conn = pool.getconn()
                    with conn.cursor() as cur:
                        cur.execute("SELECT 1")
                    pool.putconn(conn)
                    db_ok = True
                except Exception:
                    pass
            data = state.to_dict(db_ok)
            body = json.dumps(data).encode()
            code = 200 if db_ok else 503
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            pass  # Suppress default access log noise
    return Handler


def start_health_server(
    port: int,
    worker_id: str,
    pool=None,
) -> _HealthState:
    """
    Starts a background HTTP health server on the given port.
    Returns a HealthState object that the worker should update each cycle.
    """
    state = _HealthState(worker_id)
    handler = _make_health_handler(state, pool)
    server = HTTPServer(("", port), handler)
    server.timeout = 1

    def _run():
        while not _shutdown_event.is_set():
            server.handle_request()
        server.server_close()

    t = threading.Thread(target=_run, daemon=True, name=f"{worker_id}-health")
    t.start()
    get_logger(worker_id).info(f"Health server started on port {port}")
    return state
