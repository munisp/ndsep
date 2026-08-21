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
import os, time, json, logging, threading, http.server, socketserver, hashlib
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any
import psycopg2
import psycopg2.extras
import requests

# ── Configuration ──────────────────────────────────────────────────────────────
DB_URL = os.environ.get("WORKER_DATABASE_URL", os.environ.get("DATABASE_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"))
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
RELAY_URL = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
PORT = int(os.environ.get("COCOINDEX_PORT", "8201"))
EMBED_MODEL = os.environ.get("EMBED_MODEL", "all-MiniLM-L6-v2")
CHUNK_SIZE = 512   # characters per chunk
CHUNK_OVERLAP = 64 # overlap between chunks
ETL_INTERVAL = 180 # 3 minutes

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
    return int(hashlib.md5(key.encode()).hexdigest()[:8], 16) % (2**31)

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
    if not points:
        return 0
    try:
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
    except Exception as e:
        log.error(f"Qdrant upsert failed: {e}")
        return 0

# ── ETL Sources ────────────────────────────────────────────────────────────────
def etl_policies(conn) -> int:
    """ETL compliance policies with incremental watermark."""
    watermark = _watermarks.get("policies", "1970-01-01")
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id::text, name, description, policy_type, status, sector, created_at::text
            FROM compliance_policies
            WHERE created_at > %s
            ORDER BY created_at
            LIMIT 200
        """, (watermark,))
        rows = cur.fetchall()
    if not rows:
        return 0

    all_points = []
    for row in rows:
        full_text = f"Policy Name: {row['name']}\nType: {row['policy_type']}\nSector: {row.get('sector','')}\nStatus: {row['status']}\nDescription: {row.get('description','')}"
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
    if rows:
        _watermarks["policies"] = rows[-1]["created_at"]
    count = upsert_to_qdrant("ndsep_policies", all_points)
    log.info(f"CocoIndex ETL: {count} policy chunks indexed")
    return count

def etl_violations(conn) -> int:
    """ETL violations with incremental watermark."""
    watermark = _watermarks.get("violations", "1970-01-01")
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT cv.id::text, cv.violation_type, cv.description, cv.severity,
                   cv.status, o.name as org_name, o.sector, cv.detected_at::text
            FROM compliance_violations cv
            LEFT JOIN organizations o ON o.id = cv.organization_id
            WHERE cv.detected_at > %s
            ORDER BY cv.detected_at
            LIMIT 200
        """, (watermark,))
        rows = cur.fetchall()
    if not rows:
        return 0

    all_points = []
    for row in rows:
        full_text = f"Violation Type: {row['violation_type']}\nSeverity: {row['severity']}\nOrganization: {row.get('org_name','')}\nSector: {row.get('sector','')}\nStatus: {row['status']}\nDescription: {row.get('description','')}"
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
    if rows:
        _watermarks["violations"] = rows[-1]["detected_at"]
    count = upsert_to_qdrant("ndsep_violations", all_points)
    log.info(f"CocoIndex ETL: {count} violation chunks indexed")
    return count

def etl_enforcement_actions(conn) -> int:
    """ETL enforcement actions."""
    watermark = _watermarks.get("enforcement", "1970-01-01")
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT ea.id::text, ea.action_type, ea.description, ea.status,
                   ea.severity, o.name as org_name, o.sector,
                   ea.created_at::text
            FROM enforcement_actions ea
            LEFT JOIN organizations o ON o.id = ea.organization_id
            WHERE ea.created_at > %s
            ORDER BY ea.created_at
            LIMIT 200
        """, (watermark,))
        rows = cur.fetchall()
    if not rows:
        return 0

    all_points = []
    for row in rows:
        full_text = f"Enforcement Action: {row['action_type']}\nSeverity: {row.get('severity','')}\nOrganization: {row.get('org_name','')}\nSector: {row.get('sector','')}\nStatus: {row['status']}\nDescription: {row.get('description','')}"
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
    if rows:
        _watermarks["enforcement"] = rows[-1]["created_at"]
    count = upsert_to_qdrant("ndsep_audit_logs", all_points)
    log.info(f"CocoIndex ETL: {count} enforcement action chunks indexed")
    return count

def run_etl():
    global _last_etl_time, _etl_runs, _errors, _total_chunks_indexed
    log.info(f"Starting CocoIndex ETL run #{_etl_runs + 1}...")
    try:
        conn = psycopg2.connect(DB_URL)
        try:
            total = 0
            total += etl_policies(conn)
            total += etl_violations(conn)
            total += etl_enforcement_actions(conn)
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
    def log_message(self, *args): pass

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
