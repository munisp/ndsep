#!/usr/bin/env python3
"""
NDSEP CocoIndex ETL Worker (Python)
=====================================
Uses CocoIndex for incremental ETL of compliance documents into the vector store.
CocoIndex provides change-data-capture semantics: only new/modified documents
are re-embedded and upserted into Qdrant, avoiding full re-indexing.

Pipeline:
  PostgreSQL (source) → CocoIndex (transform + chunk) → Qdrant (sink)

Sources:
  - compliance_policies table
  - compliance_violations table
  - audit_logs table
  - enforcement_actions table
  - organizations table

Technology: Python · cocoindex · sentence-transformers · qdrant-client · psycopg2
Port: 8201
"""
import os
import time
import json
import logging
import threading
import http.server
import socketserver
import hashlib
from datetime import datetime, timezone
from typing import List, Dict, Optional
import psycopg2
import psycopg2.extras
import requests


def _require_dsn(dsn):
    """Fail closed (round-9): embedded default DB credentials were removed.
    A DSN must come from WORKER_DATABASE_URL / DATABASE_URL / NDSEP_PG_URL."""
    if not dsn:
        raise RuntimeError(
            "PostgreSQL DSN not configured: set WORKER_DATABASE_URL or "
            "DATABASE_URL (embedded default credentials removed in round-9) — "
            "refusing to connect with implicit defaults.")
    return dsn

# ── Configuration ──────────────────────────────────────────────────────────────
DB_URL = os.environ.get("WORKER_DATABASE_URL", os.environ.get(
    "DATABASE_URL"))
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
RELAY_URL = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
PORT = int(os.environ.get("COCOINDEX_PORT", "8205"))  # canonical workerManager port (was 8201, collided with apisix-manager)
EMBED_MODEL = os.environ.get("EMBED_MODEL", "all-MiniLM-L6-v2")
CHUNK_SIZE = 512   # characters per chunk
CHUNK_OVERLAP = 64  # overlap between chunks
ETL_INTERVAL = 180  # 3 minutes
# Watermarks are persisted to a JSON file so ETL progress survives restarts.
WATERMARK_FILE = os.environ.get(
    "COCOINDEX_WATERMARK_FILE",
    os.path.join(os.environ.get("COCOINDEX_DATA_DIR", "./data/cocoindex"),
                 "watermarks.json"))

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [NDSEP-CocoIndex] %(levelname)s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

# ── State ──────────────────────────────────────────────────────────────────────
_worker_start = time.time()
_cocoindex_available = False
_total_chunks_indexed = 0
_last_etl_time = None
_etl_runs = 0
_errors = 0
_watermarks: Dict[str, str] = {}  # table → last_processed_at
_watermark_lock = threading.Lock()


def load_watermarks() -> None:
    """Load persisted watermarks from the JSON watermark file (if present)."""
    global _watermarks
    try:
        if os.path.exists(WATERMARK_FILE):
            with open(WATERMARK_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                with _watermark_lock:
                    _watermarks = {str(k): str(v) for k, v in data.items()}
                log.info(f"Loaded {len(_watermarks)} watermarks from {WATERMARK_FILE}")
    except Exception as e:
        log.warning(f"Could not load watermarks from {WATERMARK_FILE}: {e}")


def save_watermarks() -> None:
    """Atomically persist watermarks to the JSON watermark file."""
    try:
        os.makedirs(os.path.dirname(WATERMARK_FILE) or ".", exist_ok=True)
        tmp_path = WATERMARK_FILE + ".tmp"
        with _watermark_lock:
            snapshot = dict(_watermarks)
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=2)
        os.replace(tmp_path, WATERMARK_FILE)
    except Exception as e:
        log.warning(f"Could not persist watermarks to {WATERMARK_FILE}: {e}")

# ── CocoIndex integration ──────────────────────────────────────────────────────


def init_cocoindex():
    """Initialize CocoIndex flow for incremental ETL."""
    global _cocoindex_available
    try:
        import cocoindex
        _cocoindex_available = True
        log.info("CocoIndex available and initialized")
        return cocoindex
    except ImportError as e:
        log.warning(f"CocoIndex not available: {e}. Falling back to manual ETL.")
        _cocoindex_available = False
        return None

# ── Text chunking ──────────────────────────────────────────────────────────────


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Split text into overlapping chunks for embedding."""
    if not text or len(text) <= chunk_size:
        return [text] if text else []
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        # Try to break at sentence boundary
        if end < len(text):
            last_period = chunk.rfind('. ')
            if last_period > chunk_size // 2:
                chunk = chunk[:last_period + 1]
                end = start + last_period + 1
        chunks.append(chunk.strip())
        start = end - overlap
    return [c for c in chunks if c]


def make_chunk_id(source_id: str, chunk_idx: int) -> int:
    """Generate deterministic integer ID for a chunk."""
    key = f"{source_id}:chunk:{chunk_idx}"
    return int(hashlib.md5(key.encode(), usedforsecurity=False).hexdigest()[:8], 16) % (2**31)


# ── Embedding ──────────────────────────────────────────────────────────────────
_model = None


def get_model():
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer(EMBED_MODEL)
            log.info(f"Loaded embedding model: {EMBED_MODEL}")
        except Exception as e:
            log.error(f"Model load failed: {e}")
    return _model


def embed(texts: List[str]) -> Optional[List[List[float]]]:
    model = get_model()
    if model is None:
        return None
    try:
        return model.encode(texts, batch_size=32, show_progress_bar=False).tolist()
    except Exception as e:
        log.error(f"Embed failed: {e}")
        return None

# ── Qdrant upsert ──────────────────────────────────────────────────────────────


def upsert_to_qdrant(collection: str, points: List[Dict]) -> int:
    """Upsert points into Qdrant. Raises on failure (round-9): callers must
    NOT advance their watermark when the sink write did not happen — the
    previous version swallowed errors and advanced anyway, silently losing
    documents from the index."""
    if not points:
        return 0
    from qdrant_client import QdrantClient
    from qdrant_client.models import PointStruct, Distance, VectorParams
    client = QdrantClient(url=QDRANT_URL, timeout=10)
    # Ensure collection exists
    existing = {c.name for c in client.get_collections().collections}
    if collection not in existing:
        client.create_collection(
            collection_name=collection,
            vectors_config=VectorParams(size=384, distance=Distance.COSINE)
        )
    qdrant_points = [
        PointStruct(id=p["id"], vector=p["vector"], payload=p["payload"])
        for p in points
    ]
    client.upsert(collection_name=collection, points=qdrant_points)
    return len(points)

# ── ETL Sources ────────────────────────────────────────────────────────────────


def etl_policies(conn) -> int:
    """ETL compliance policies with incremental watermark on
    GREATEST(created_at, updated_at); the watermark advances ONLY after a
    successful Qdrant upsert."""
    watermark = _watermarks.get("policies", "1970-01-01")
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id::text, name, description, policy_type, status, sector,
                   GREATEST(created_at, COALESCE(updated_at, created_at))::text AS last_modified
            FROM compliance_policies
            WHERE GREATEST(created_at, COALESCE(updated_at, created_at)) > %s
            ORDER BY last_modified
            LIMIT 200
        """, (watermark,))
        rows = cur.fetchall()
    if not rows:
        return 0

    all_points = []
    for row in rows:
        full_text = f"Policy Name: {
            row['name']}\nType: {
            row['policy_type']}\nSector: {
            row.get(
                'sector',
                '')}\nStatus: {
                    row['status']}\nDescription: {
                        row.get(
                            'description',
                            '')}"
        chunks = chunk_text(full_text)
        texts_to_embed = chunks
        vectors = embed(texts_to_embed)
        if not vectors:
            continue
        for idx, (chunk, vec) in enumerate(zip(chunks, vectors)):
            all_points.append({
                "id": make_chunk_id(f"policy-{row['id']}", idx),
                "vector": vec,
                "payload": {
                    "source_type": "policy",
                    "source_id": row["id"],
                    "chunk_index": idx,
                    "chunk_text": chunk,
                    "name": row["name"],
                    "policy_type": row["policy_type"],
                    "sector": row.get("sector", ""),
                    "etl_timestamp": datetime.now(timezone.utc).isoformat()
                }
            })
    if not all_points:
        # Every row failed to embed — do NOT advance the watermark so the
        # rows are retried next run.
        log.warning(f"CocoIndex ETL: 0/{len(rows)} policy rows embedded — watermark NOT advanced")
        return 0
    count = upsert_to_qdrant("ndsep_policies", all_points)  # raises on failure
    _watermarks["policies"] = rows[-1]["last_modified"]  # advance ONLY after successful upsert
    log.info(f"CocoIndex ETL: {count} policy chunks indexed")
    return count


def etl_violations(conn) -> int:
    """ETL violations with incremental watermark."""
    watermark = _watermarks.get("violations", "1970-01-01")
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT cv.id::text, cv.title AS violation_type, cv.description, cv.severity,
                   cv.status, o.name as org_name, o.sector,
                   GREATEST(cv.detected_at, cv.created_at)::text AS last_modified
            FROM compliance_violations cv
            LEFT JOIN organizations o ON o.id = cv.organization_id
            WHERE GREATEST(cv.detected_at, cv.created_at) > %s
            ORDER BY last_modified
            LIMIT 200
        """, (watermark,))
        rows = cur.fetchall()
    if not rows:
        return 0

    all_points = []
    for row in rows:
        full_text = f"Violation Type: {
            row['violation_type']}\nSeverity: {
            row['severity']}\nOrganization: {
            row.get(
                'org_name',
                '')}\nSector: {
                    row.get(
                        'sector',
                        '')}\nStatus: {
                            row['status']}\nDescription: {
                                row.get(
                                    'description',
                                    '')}"
        chunks = chunk_text(full_text)
        vectors = embed(chunks)
        if not vectors:
            continue
        for idx, (chunk, vec) in enumerate(zip(chunks, vectors)):
            all_points.append({
                "id": make_chunk_id(f"violation-{row['id']}", idx),
                "vector": vec,
                "payload": {
                    "source_type": "violation",
                    "source_id": row["id"],
                    "chunk_index": idx,
                    "chunk_text": chunk,
                    "violation_type": row["violation_type"],
                    "severity": row["severity"],
                    "org_name": row.get("org_name", ""),
                    "sector": row.get("sector", ""),
                    "etl_timestamp": datetime.now(timezone.utc).isoformat()
                }
            })
    if not all_points:
        log.warning(f"CocoIndex ETL: 0/{len(rows)} violation rows embedded — watermark NOT advanced")
        return 0
    count = upsert_to_qdrant("ndsep_violations", all_points)
    _watermarks["violations"] = rows[-1]["last_modified"]
    log.info(f"CocoIndex ETL: {count} violation chunks indexed")
    return count


def etl_enforcement_actions(conn) -> int:
    """ETL enforcement actions."""
    watermark = _watermarks.get("enforcement", "1970-01-01")
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT ea.id::text, ea.action_type, ea.description, ea.status,
                   ea.severity, o.name as org_name, o.sector,
                   GREATEST(ea.created_at, COALESCE(ea.updated_at, ea.created_at))::text AS last_modified
            FROM enforcement_actions ea
            LEFT JOIN organizations o ON o.id = ea.organization_id
            WHERE GREATEST(ea.created_at, COALESCE(ea.updated_at, ea.created_at)) > %s
            ORDER BY last_modified
            LIMIT 200
        """, (watermark,))
        rows = cur.fetchall()
    if not rows:
        return 0

    all_points = []
    for row in rows:
        full_text = f"Enforcement Action: {
            row['action_type']}\nSeverity: {
            row.get(
                'severity',
                '')}\nOrganization: {
                row.get(
                    'org_name',
                    '')}\nSector: {
                        row.get(
                            'sector',
                            '')}\nStatus: {
                                row['status']}\nDescription: {
                                    row.get(
                                        'description',
                                        '')}"
        chunks = chunk_text(full_text)
        vectors = embed(chunks)
        if not vectors:
            continue
        for idx, (chunk, vec) in enumerate(zip(chunks, vectors)):
            all_points.append({
                "id": make_chunk_id(f"enforcement-{row['id']}", idx),
                "vector": vec,
                "payload": {
                    "source_type": "enforcement_action",
                    "source_id": row["id"],
                    "chunk_index": idx,
                    "chunk_text": chunk,
                    "action_type": row["action_type"],
                    "org_name": row.get("org_name", ""),
                    "sector": row.get("sector", ""),
                    "etl_timestamp": datetime.now(timezone.utc).isoformat()
                }
            })
    if not all_points:
        log.warning(f"CocoIndex ETL: 0/{len(rows)} enforcement rows embedded — watermark NOT advanced")
        return 0
    count = upsert_to_qdrant("ndsep_enforcement_actions", all_points)
    _watermarks["enforcement"] = rows[-1]["last_modified"]
    log.info(f"CocoIndex ETL: {count} enforcement action chunks indexed")
    return count


def etl_audit_logs(conn) -> int:
    """ETL audit logs with incremental watermark."""
    watermark = _watermarks.get("audit_logs", "1970-01-01")
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT al.id::text, al.action, al.resource_type, al.details,
                   al.ip_address, o.name as org_name, al.created_at::text
            FROM audit_logs al
            LEFT JOIN organizations o ON o.id = al.organization_id
            WHERE al.created_at > %s
            ORDER BY al.created_at
            LIMIT 200
        """, (watermark,))
        rows = cur.fetchall()
    if not rows:
        return 0

    all_points = []
    for row in rows:
        full_text = (f"Audit Action: {row['action']}\n"
                     f"Resource: {row.get('resource_type', '')}\n"
                     f"Organization: {row.get('org_name', '')}\n"
                     f"Details: {row.get('details', '')}")
        chunks = chunk_text(full_text)
        vectors = embed(chunks)
        if not vectors:
            continue
        for idx, (chunk, vec) in enumerate(zip(chunks, vectors)):
            all_points.append({
                "id": make_chunk_id(f"audit-{row['id']}", idx),
                "vector": vec,
                "payload": {
                    "source_type": "audit_log",
                    "source_id": row["id"],
                    "chunk_index": idx,
                    "chunk_text": chunk,
                    "action": row["action"],
                    "resource_type": row.get("resource_type", ""),
                    "org_name": row.get("org_name", ""),
                    "etl_timestamp": datetime.now(timezone.utc).isoformat()
                }
            })
    if not all_points:
        log.warning(f"CocoIndex ETL: 0/{len(rows)} audit log rows embedded — watermark NOT advanced")
        return 0
    count = upsert_to_qdrant("ndsep_audit_logs", all_points)
    _watermarks["audit_logs"] = rows[-1]["created_at"]
    log.info(f"CocoIndex ETL: {count} audit log chunks indexed")
    return count


def etl_organizations(conn) -> int:
    """ETL organizations with incremental watermark on updated_at."""
    watermark = _watermarks.get("organizations", "1970-01-01")
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id::text, name, sector, country, city,
                   compliance_score::text, compliance_status, risk_score::text,
                   GREATEST(updated_at, created_at)::text AS last_modified
            FROM organizations
            WHERE GREATEST(updated_at, created_at) > %s
            ORDER BY last_modified
            LIMIT 200
        """, (watermark,))
        rows = cur.fetchall()
    if not rows:
        return 0

    all_points = []
    for row in rows:
        full_text = (f"Organization: {row['name']}\n"
                     f"Sector: {row.get('sector', '')}\n"
                     f"Country: {row.get('country', '')}\n"
                     f"City: {row.get('city', '')}\n"
                     f"Compliance Status: {row.get('compliance_status', '')}\n"
                     f"Compliance Score: {row.get('compliance_score', '')}\n"
                     f"Risk Score: {row.get('risk_score', '')}")
        chunks = chunk_text(full_text)
        vectors = embed(chunks)
        if not vectors:
            continue
        for idx, (chunk, vec) in enumerate(zip(chunks, vectors)):
            all_points.append({
                "id": make_chunk_id(f"org-{row['id']}", idx),
                "vector": vec,
                "payload": {
                    "source_type": "organization",
                    "source_id": row["id"],
                    "chunk_index": idx,
                    "chunk_text": chunk,
                    "name": row["name"],
                    "sector": row.get("sector", ""),
                    "compliance_status": row.get("compliance_status", ""),
                    "etl_timestamp": datetime.now(timezone.utc).isoformat()
                }
            })
    if not all_points:
        log.warning(f"CocoIndex ETL: 0/{len(rows)} organization rows embedded — watermark NOT advanced")
        return 0
    count = upsert_to_qdrant("ndsep_organizations", all_points)
    _watermarks["organizations"] = rows[-1]["last_modified"]
    log.info(f"CocoIndex ETL: {count} organization chunks indexed")
    return count


def run_etl():
    global _last_etl_time, _etl_runs, _errors, _total_chunks_indexed
    log.info(f"Starting CocoIndex ETL run #{_etl_runs + 1}...")
    try:
        conn = psycopg2.connect(_require_dsn(DB_URL))
        try:
            total = 0
            # Per-source isolation: a failed upsert must neither advance that
            # source's watermark (handled inside etl_*) nor abort the others.
            for source_etl in (etl_policies, etl_violations,
                               etl_enforcement_actions, etl_audit_logs,
                               etl_organizations):
                try:
                    total += source_etl(conn)
                except Exception as e:
                    _errors += 1
                    log.error(f"{source_etl.__name__} failed (watermark NOT advanced): {e}")
            save_watermarks()
            _total_chunks_indexed += total
            _etl_runs += 1
            _last_etl_time = datetime.now(timezone.utc).isoformat()
            log.info(f"ETL run complete: {total} new chunks. Total: {_total_chunks_indexed}")
            try:
                requests.post(RELAY_URL, json={
                    "workerId": "cocoindex_etl_worker",
                    "event": "etl_complete",
                    "chunks_this_run": total,
                    "total_chunks": _total_chunks_indexed,
                    "etl_run": _etl_runs,
                    "timestamp": _last_etl_time
                }, timeout=3)
            except Exception:
                pass
        finally:
            conn.close()
    except Exception as e:
        _errors += 1
        log.error(f"ETL run failed: {e}")

# ── HTTP Server ────────────────────────────────────────────────────────────────


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({
                "status": "healthy",
                "worker": "cocoindex_etl_worker",
                "cocoindex_available": _cocoindex_available,
                "total_chunks_indexed": _total_chunks_indexed,
                "etl_runs": _etl_runs,
                "last_etl_time": _last_etl_time,
                "watermarks": _watermarks,
                "errors": _errors,
                "uptime_seconds": round(time.time() - _worker_start, 1)
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/etl":
            threading.Thread(target=run_etl, daemon=True).start()
            self.send_response(202)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"etl_started"}')
        else:
            self.send_response(404)
            self.end_headers()


def etl_loop():
    time.sleep(15)
    load_watermarks()
    init_cocoindex()
    run_etl()
    while True:
        time.sleep(ETL_INTERVAL)
        run_etl()


if __name__ == "__main__":
    log.info("Starting NDSEP CocoIndex ETL Worker...")
    threading.Thread(target=etl_loop, daemon=True).start()
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.allow_reuse_address = True
        log.info(f"CocoIndex ETL Worker HTTP server on port {PORT}")
        httpd.serve_forever()
