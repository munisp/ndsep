#!/usr/bin/env python3
"""
NDSEP Qdrant Vector Worker (Python)
====================================
Embeds compliance documents, policies, violations, and audit logs into Qdrant
vector collections using sentence-transformers. Provides semantic search and
RAG (Retrieval-Augmented Generation) pipeline for the AI Compliance Advisor.

Collections:
  - ndsep_policies       : compliance policies + NDPA articles
  - ndsep_violations     : violation records with context
  - ndsep_audit_logs     : audit trail entries
  - ndsep_organizations  : org profiles + sector context
  - ndsep_knowledge_base : NDPA 2023 full text, CBN guidelines, NITDA frameworks

Technology: Python · sentence-transformers · qdrant-client · psycopg2
Port: 8200
"""
import os, time, json, logging, threading, http.server, socketserver, hashlib
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import psycopg2
import psycopg2.extras
import requests

# ── Configuration ──────────────────────────────────────────────────────────────
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "")
DB_URL = os.environ.get("WORKER_DATABASE_URL", os.environ.get("DATABASE_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"))
RELAY_URL = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
PORT = int(os.environ.get("QDRANT_WORKER_PORT", "8200"))
EMBED_MODEL = os.environ.get("EMBED_MODEL", "all-MiniLM-L6-v2")
VECTOR_DIM = 384  # all-MiniLM-L6-v2 output dimension
BATCH_SIZE = 32
REINDEX_INTERVAL = 300  # 5 minutes

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [NDSEP-Qdrant] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

# ── State ──────────────────────────────────────────────────────────────────────
_worker_start = time.time()
_qdrant_connected = False
_total_vectors = 0
_last_index_time = None
_errors = 0
_model = None
_qdrant_client = None

COLLECTIONS = [
    "ndsep_policies",
    "ndsep_violations",
    "ndsep_audit_logs",
    "ndsep_organizations",
    "ndsep_knowledge_base",
]

# ── NDPA 2023 Knowledge Base ───────────────────────────────────────────────────
NDPA_KNOWLEDGE_BASE = [
    {
        "id": "ndpa-s1", "title": "NDPA 2023 Section 1 — Objectives",
        "text": "The Nigeria Data Protection Act 2023 establishes a comprehensive framework for the protection of personal data in Nigeria. It creates the Nigeria Data Protection Commission (NDPC) as the supervisory authority and sets out the rights of data subjects and obligations of data controllers and processors.",
        "source": "NDPA 2023", "category": "legislation"
    },
    {
        "id": "ndpa-s24", "title": "NDPA 2023 Section 24 — Lawful Basis",
        "text": "Processing of personal data is lawful only if at least one of the following applies: (a) the data subject has given consent; (b) processing is necessary for performance of a contract; (c) processing is necessary for compliance with a legal obligation; (d) processing is necessary to protect vital interests; (e) processing is necessary for a task in the public interest; (f) processing is necessary for legitimate interests.",
        "source": "NDPA 2023", "category": "lawful_basis"
    },
    {
        "id": "ndpa-s40", "title": "NDPA 2023 Section 40 — Data Breach Notification",
        "text": "A data controller shall notify the Commission of a personal data breach without undue delay and, where feasible, not later than 72 hours after becoming aware of it. The notification shall describe the nature of the breach, categories of data subjects affected, likely consequences, and measures taken.",
        "source": "NDPA 2023", "category": "breach_notification"
    },
    {
        "id": "ndpa-s43", "title": "NDPA 2023 Section 43 — Data Protection Impact Assessment",
        "text": "Where processing is likely to result in a high risk to the rights and freedoms of natural persons, the data controller shall carry out a Data Protection Impact Assessment (DPIA). The DPIA shall include a systematic description of the processing operations, assessment of necessity and proportionality, and measures to address the risks.",
        "source": "NDPA 2023", "category": "dpia"
    },
    {
        "id": "ndpa-s58", "title": "NDPA 2023 Section 58 — Cross-Border Transfers",
        "text": "A data controller shall not transfer personal data to a foreign country unless the Commission has determined that the country ensures an adequate level of protection, or appropriate safeguards are in place such as standard contractual clauses, binding corporate rules, or explicit consent of the data subject.",
        "source": "NDPA 2023", "category": "cross_border"
    },
    {
        "id": "ndpa-s65", "title": "NDPA 2023 Section 65 — Administrative Fines",
        "text": "The Commission may impose administrative fines for violations. For serious infringements, fines up to 2% of annual global turnover or 10 million Naira (whichever is higher). For less serious infringements, fines up to 1% of annual global turnover or 2 million Naira (whichever is higher).",
        "source": "NDPA 2023", "category": "penalties"
    },
    {
        "id": "cbn-data-2022", "title": "CBN Data Governance Framework 2022",
        "text": "The Central Bank of Nigeria requires all financial institutions to maintain data governance frameworks that include data classification, data quality management, data lineage tracking, and regular data audits. Financial data must be stored within Nigeria except where cross-border transfer approval has been obtained.",
        "source": "CBN", "category": "financial_regulation"
    },
    {
        "id": "nitda-audit-2021", "title": "NITDA Data Protection Audit Framework",
        "text": "NITDA requires organizations processing personal data of more than 1000 data subjects annually to conduct annual data protection audits through licensed Data Protection Compliance Organizations (DPCOs). Audit reports must be filed with NITDA within 60 days of completion.",
        "source": "NITDA", "category": "audit_requirement"
    },
    {
        "id": "ndpc-guidance-dpo", "title": "NDPC Guidance on Data Protection Officers",
        "text": "Organizations that process personal data on a large scale, or process special categories of data, must designate a Data Protection Officer (DPO). The DPO must be registered with the NDPC and must have expert knowledge of data protection law. The DPO cannot be dismissed or penalized for performing their tasks.",
        "source": "NDPC", "category": "dpo"
    },
    {
        "id": "ndpc-guidance-consent", "title": "NDPC Guidance on Consent",
        "text": "Consent must be freely given, specific, informed, and unambiguous. Pre-ticked boxes or silence do not constitute consent. Data subjects must be able to withdraw consent at any time, and withdrawal must be as easy as giving consent. Consent obtained before NDPA 2023 must be refreshed if it does not meet these standards.",
        "source": "NDPC", "category": "consent"
    },
]

# ── Database helpers ───────────────────────────────────────────────────────────
def get_db():
    return psycopg2.connect(DB_URL)

def fetch_policies(conn) -> List[Dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id::text, name, description, policy_type, status, sector,
                   created_at::text
            FROM compliance_policies
            WHERE status = 'active'
            LIMIT 500
        """)
        return [dict(r) for r in cur.fetchall()]

def fetch_violations(conn) -> List[Dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT cv.id::text, cv.violation_type, cv.description, cv.severity,
                   cv.status, o.name as org_name, o.sector,
                   cv.detected_at::text
            FROM compliance_violations cv
            LEFT JOIN organizations o ON o.id = cv.organization_id
            LIMIT 500
        """)
        return [dict(r) for r in cur.fetchall()]

def fetch_organizations(conn) -> List[Dict]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id::text, name, sector, registration_number,
                   compliance_score, status, state, created_at::text
            FROM organizations
            LIMIT 200
        """)
        return [dict(r) for r in cur.fetchall()]

# ── Embedding ──────────────────────────────────────────────────────────────────
def load_model():
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            log.info(f"Loading embedding model: {EMBED_MODEL}")
            _model = SentenceTransformer(EMBED_MODEL)
            log.info("Embedding model loaded successfully")
        except Exception as e:
            log.error(f"Failed to load embedding model: {e}")
            _model = None
    return _model

def embed_texts(texts: List[str]) -> Optional[List[List[float]]]:
    model = load_model()
    if model is None:
        return None
    try:
        embeddings = model.encode(texts, batch_size=BATCH_SIZE, show_progress_bar=False)
        return embeddings.tolist()
    except Exception as e:
        log.error(f"Embedding failed: {e}")
        return None

# ── Qdrant helpers ─────────────────────────────────────────────────────────────
def get_qdrant():
    global _qdrant_client, _qdrant_connected
    if _qdrant_client is not None:
        return _qdrant_client
    try:
        from qdrant_client import QdrantClient
        from qdrant_client.models import Distance, VectorParams
        client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY or None, timeout=10)
        # Ensure all collections exist
        existing = {c.name for c in client.get_collections().collections}
        for name in COLLECTIONS:
            if name not in existing:
                client.create_collection(
                    collection_name=name,
                    vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE)
                )
                log.info(f"Created Qdrant collection: {name}")
        _qdrant_client = client
        _qdrant_connected = True
        log.info("Qdrant connected and collections ready")
        return client
    except Exception as e:
        log.warning(f"Qdrant not available: {e}")
        _qdrant_connected = False
        return None

def upsert_vectors(collection: str, points: List[Dict]) -> int:
    client = get_qdrant()
    if client is None or not points:
        return 0
    try:
        from qdrant_client.models import PointStruct
        qdrant_points = [
            PointStruct(id=p["id"], vector=p["vector"], payload=p["payload"])
            for p in points
        ]
        client.upsert(collection_name=collection, points=qdrant_points)
        return len(points)
    except Exception as e:
        log.error(f"Qdrant upsert failed for {collection}: {e}")
        return 0

def semantic_search(collection: str, query: str, limit: int = 5) -> List[Dict]:
    client = get_qdrant()
    if client is None:
        return []
    try:
        vectors = embed_texts([query])
        if not vectors:
            return []
        results = client.search(
            collection_name=collection,
            query_vector=vectors[0],
            limit=limit,
            with_payload=True
        )
        return [{"score": r.score, "payload": r.payload} for r in results]
    except Exception as e:
        log.error(f"Semantic search failed: {e}")
        return []

# ── Indexing pipeline ──────────────────────────────────────────────────────────
def index_knowledge_base():
    global _total_vectors
    texts = [f"{d['title']}\n{d['text']}" for d in NDPA_KNOWLEDGE_BASE]
    vectors = embed_texts(texts)
    if not vectors:
        return 0
    points = []
    for i, (doc, vec) in enumerate(zip(NDPA_KNOWLEDGE_BASE, vectors)):
        doc_id = int(hashlib.md5(doc["id"].encode()).hexdigest()[:8], 16) % (2**31)
        points.append({
            "id": doc_id,
            "vector": vec,
            "payload": {
                "doc_id": doc["id"],
                "title": doc["title"],
                "text": doc["text"][:500],
                "source": doc["source"],
                "category": doc["category"],
                "indexed_at": datetime.now(timezone.utc).isoformat()
            }
        })
    count = upsert_vectors("ndsep_knowledge_base", points)
    _total_vectors += count
    log.info(f"Indexed {count} knowledge base documents")
    return count

def index_policies(conn):
    global _total_vectors
    policies = fetch_policies(conn)
    if not policies:
        return 0
    texts = [f"Policy: {p['name']}\nType: {p['policy_type']}\nSector: {p.get('sector','')}\n{p.get('description','')}" for p in policies]
    vectors = embed_texts(texts)
    if not vectors:
        return 0
    points = []
    for policy, vec in zip(policies, vectors):
        pid = int(hashlib.md5(f"policy-{policy['id']}".encode()).hexdigest()[:8], 16) % (2**31)
        points.append({
            "id": pid,
            "vector": vec,
            "payload": {
                "type": "policy",
                "db_id": policy["id"],
                "name": policy["name"],
                "policy_type": policy["policy_type"],
                "sector": policy.get("sector", ""),
                "status": policy["status"],
                "indexed_at": datetime.now(timezone.utc).isoformat()
            }
        })
    count = upsert_vectors("ndsep_policies", points)
    _total_vectors += count
    log.info(f"Indexed {count} policies")
    return count

def index_violations(conn):
    global _total_vectors
    violations = fetch_violations(conn)
    if not violations:
        return 0
    texts = [
        f"Violation: {v['violation_type']}\nSeverity: {v['severity']}\nOrg: {v.get('org_name','')}\nSector: {v.get('sector','')}\n{v.get('description','')}"
        for v in violations
    ]
    vectors = embed_texts(texts)
    if not vectors:
        return 0
    points = []
    for violation, vec in zip(violations, vectors):
        vid = int(hashlib.md5(f"violation-{violation['id']}".encode()).hexdigest()[:8], 16) % (2**31)
        points.append({
            "id": vid,
            "vector": vec,
            "payload": {
                "type": "violation",
                "db_id": violation["id"],
                "violation_type": violation["violation_type"],
                "severity": violation["severity"],
                "org_name": violation.get("org_name", ""),
                "sector": violation.get("sector", ""),
                "status": violation["status"],
                "indexed_at": datetime.now(timezone.utc).isoformat()
            }
        })
    count = upsert_vectors("ndsep_violations", points)
    _total_vectors += count
    log.info(f"Indexed {count} violations")
    return count

def index_organizations(conn):
    global _total_vectors
    orgs = fetch_organizations(conn)
    if not orgs:
        return 0
    texts = [
        f"Organization: {o['name']}\nSector: {o['sector']}\nRegistration: {o.get('registration_number','')}\nCompliance Score: {o.get('compliance_score', 0)}\nStatus: {o['status']}\nState: {o.get('state','')}"
        for o in orgs
    ]
    vectors = embed_texts(texts)
    if not vectors:
        return 0
    points = []
    for org, vec in zip(orgs, vectors):
        oid = int(hashlib.md5(f"org-{org['id']}".encode()).hexdigest()[:8], 16) % (2**31)
        points.append({
            "id": oid,
            "vector": vec,
            "payload": {
                "type": "organization",
                "db_id": org["id"],
                "name": org["name"],
                "sector": org["sector"],
                "compliance_score": org.get("compliance_score", 0),
                "status": org["status"],
                "state": org.get("state", ""),
                "indexed_at": datetime.now(timezone.utc).isoformat()
            }
        })
    count = upsert_vectors("ndsep_organizations", points)
    _total_vectors += count
    log.info(f"Indexed {count} organizations")
    return count

def run_full_index():
    global _last_index_time, _errors
    log.info("Starting full vector index run...")
    try:
        # Always index knowledge base (static)
        index_knowledge_base()
        # Index from DB
        conn = get_db()
        try:
            index_policies(conn)
            index_violations(conn)
            index_organizations(conn)
        finally:
            conn.close()
        _last_index_time = datetime.now(timezone.utc).isoformat()
        log.info(f"Full index complete. Total vectors: {_total_vectors}")
        # Notify relay
        try:
            requests.post(RELAY_URL, json={
                "workerId": "qdrant_vector_worker",
                "event": "index_complete",
                "total_vectors": _total_vectors,
                "timestamp": _last_index_time
            }, timeout=3)
        except Exception:
            pass
    except Exception as e:
        _errors += 1
        log.error(f"Index run failed: {e}")

# ── RAG Pipeline ───────────────────────────────────────────────────────────────
def rag_retrieve(query: str, collections: Optional[List[str]] = None, limit: int = 5) -> List[Dict]:
    """Retrieve relevant context from Qdrant for RAG."""
    if collections is None:
        collections = ["ndsep_knowledge_base", "ndsep_policies", "ndsep_violations"]
    results = []
    for col in collections:
        hits = semantic_search(col, query, limit=limit)
        for hit in hits:
            hit["collection"] = col
            results.append(hit)
    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:limit * 2]

# ── HTTP Health Server ─────────────────────────────────────────────────────────
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({
                "status": "healthy",
                "worker": "qdrant_vector_worker",
                "qdrant_connected": _qdrant_connected,
                "total_vectors": _total_vectors,
                "last_index_time": _last_index_time,
                "embed_model": EMBED_MODEL,
                "vector_dim": VECTOR_DIM,
                "collections": COLLECTIONS,
                "errors": _errors,
                "uptime_seconds": round(time.time() - _worker_start, 1)
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/search"):
            # Simple search endpoint: /search?q=<query>&collection=<col>
            from urllib.parse import urlparse, parse_qs
            params = parse_qs(urlparse(self.path).query)
            query = params.get("q", [""])[0]
            collection = params.get("collection", ["ndsep_knowledge_base"])[0]
            results = semantic_search(collection, query, limit=5) if query else []
            body = json.dumps({"results": results, "query": query}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/rag":
            body = json.dumps({"error": "Use POST /rag with {query}"}).encode()
            self.send_response(405)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/rag":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            query = body.get("query", "")
            results = rag_retrieve(query) if query else []
            resp = json.dumps({"results": results, "query": query}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(resp)
        elif self.path == "/reindex":
            threading.Thread(target=run_full_index, daemon=True).start()
            self.send_response(202)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"reindex_started"}')
        else:
            self.send_response(404)
            self.end_headers()

def start_http_server():
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.allow_reuse_address = True
        log.info(f"Qdrant Vector Worker HTTP server on port {PORT}")
        httpd.serve_forever()

# ── Background indexing loop ───────────────────────────────────────────────────
def indexing_loop():
    time.sleep(10)  # Wait for DB to be ready
    run_full_index()
    while True:
        time.sleep(REINDEX_INTERVAL)
        run_full_index()

# ── Main ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    log.info("Starting NDSEP Qdrant Vector Worker...")
    # Pre-load model
    threading.Thread(target=load_model, daemon=True).start()
    # Start indexing loop
    threading.Thread(target=indexing_loop, daemon=True).start()
    # Start HTTP server (blocking)
    start_http_server()
