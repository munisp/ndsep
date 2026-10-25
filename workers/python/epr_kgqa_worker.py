#!/usr/bin/env python3
"""
NDSEP EPR-KGQA Worker (Python)
================================
Implements Knowledge Graph Question Answering (KGQA) over NDSEP compliance
entities using the EPR (Entity-Predicate-Relation) framework.

The knowledge graph encodes:
  - Organizations → violations → policies → enforcement actions
  - Officers → cases → organizations → sectors
  - Regulations → articles → obligations → penalties

KGQA pipeline:
  1. Parse natural language question
  2. Extract entities (org names, regulation references, dates)
  3. Map to graph nodes via Qdrant semantic search
  4. Execute graph traversal queries
  5. Generate natural language answer via Ollama/LLM

Technology: Python · sentence-transformers · qdrant-client · psycopg2 · ollama
Port: 8202
"""
import os
import time
import json
import logging
import http.server
import socketserver
import re
import threading
from datetime import datetime, timezone
from typing import List, Dict, Any
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
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
RELAY_URL = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
# workerManager sets EPR_KGQA_PORT; KGQA_PORT is the legacy/standalone name.
PORT = int(os.environ.get("EPR_KGQA_PORT", os.environ.get("KGQA_PORT", "8214")))  # canonical workerManager port (was 8202, collided with bgp-live-monitor)
EMBED_MODEL = os.environ.get("EMBED_MODEL", "all-MiniLM-L6-v2")
LLM_MODEL = os.environ.get("OLLAMA_MODEL", "mistral")
MAX_BODY_BYTES = int(os.environ.get("KGQA_MAX_BODY_BYTES", str(64 * 1024)))
MAX_QUESTION_CHARS = int(os.environ.get("KGQA_MAX_QUESTION_CHARS", "4000"))
# Shared-secret guard for POST endpoints (round-9): when WORKER_AUTH_TOKEN is
# set, callers must present it via X-Worker-Token (or Bearer). Outside
# development/test, POSTs fail closed when the token is NOT configured.
WORKER_AUTH_TOKEN = os.environ.get("WORKER_AUTH_TOKEN")
_IS_DEV = os.environ.get("NODE_ENV", os.environ.get("NDSEP_ENV", "production")) in ("development", "test")

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [NDSEP-KGQA] %(levelname)s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

# ── State ──────────────────────────────────────────────────────────────────────
_worker_start = time.time()
_questions_answered = 0
_errors = 0
_kg_nodes = 0
_kg_edges = 0

# ── Embedding model: loaded ONCE at startup (round-9) ─────────────────────────
# Previously every request constructed a new SentenceTransformer (multi-second
# model load per query). The model is now a process-level singleton, warmed at
# startup; requests fail fast when it is unavailable.
_embed_model = None
_embed_model_error = None


def load_embed_model():
    """Load the SentenceTransformer singleton (idempotent)."""
    global _embed_model, _embed_model_error
    if _embed_model is not None:
        return _embed_model
    try:
        from sentence_transformers import SentenceTransformer
        _embed_model = SentenceTransformer(EMBED_MODEL)
        _embed_model_error = None
        log.info(f"Loaded embedding model: {EMBED_MODEL}")
    except Exception as e:
        _embed_model_error = str(e)
        log.error(f"Embedding model load failed: {e}")
    return _embed_model


def get_embed_model():
    return _embed_model

# ── Entity types for KGQA ──────────────────────────────────────────────────────
ENTITY_PATTERNS = {
    "organization": [
        r"(?:organization|org|company|bank|telecom|institution)\s+(?:called\s+)?[\"']?([A-Z][a-zA-Z\s]+)[\"']?",
        r"([A-Z][a-zA-Z\s]+(?:Bank|Telecom|Insurance|Finance|Limited|Ltd|Plc))",
    ],
    "regulation": [
        r"(NDPA\s*\d{4})",
        r"(Section\s+\d+(?:\s+of\s+NDPA)?)",
        r"(CBN\s+[A-Z][a-zA-Z\s]+)",
        r"(NITDA\s+[A-Z][a-zA-Z\s]+)",
    ],
    "violation_type": [
        r"(data\s+breach|unauthorized\s+access|consent\s+violation|cross.border\s+transfer|retention\s+violation)",
    ],
    "sector": [
        r"(banking|telecom|healthcare|government|fintech|energy|insurance)\s+sector",
    ],
    "date": [
        r"(\d{4}-\d{2}-\d{2})",
        r"(last\s+\d+\s+(?:days?|months?|years?))",
        r"(Q[1-4]\s+\d{4})",
    ]
}

# ── Knowledge Graph Queries ────────────────────────────────────────────────────
KG_QUERIES = {
    "org_violations": """
        SELECT o.name as org_name, o.sector,
               COUNT(cv.id) as violation_count,
               MAX(cv.severity) as max_severity,
               STRING_AGG(DISTINCT cv.violation_type, ', ') as violation_types
        FROM organizations o
        LEFT JOIN compliance_violations cv ON cv.organization_id = o.id
        WHERE LOWER(o.name) LIKE LOWER(%s)
        GROUP BY o.id, o.name, o.sector
        LIMIT 5
    """,
    "sector_compliance": """
        SELECT sector,
               ROUND(AVG(compliance_score)::numeric, 1) as avg_score,
               COUNT(*) as org_count,
               COUNT(CASE WHEN compliance_score >= 80 THEN 1 END) as compliant_count
        FROM organizations
        WHERE sector = %s
        GROUP BY sector
    """,
    "policy_by_type": """
        SELECT name, policy_type, status, sector, description
        FROM compliance_policies
        WHERE policy_type ILIKE %s OR name ILIKE %s
        LIMIT 5
    """,
    "recent_violations": """
        SELECT cv.violation_type, cv.severity, cv.status,
               o.name as org_name, o.sector,
               cv.detected_at
        FROM compliance_violations cv
        LEFT JOIN organizations o ON o.id = cv.organization_id
        ORDER BY cv.detected_at DESC
        LIMIT 10
    """,
    "enforcement_by_org": """
        SELECT ea.action_type, ea.status, ea.severity,
               ea.description, ea.created_at
        FROM enforcement_actions ea
        LEFT JOIN organizations o ON o.id = ea.organization_id
        WHERE LOWER(o.name) LIKE LOWER(%s)
        ORDER BY ea.created_at DESC
        LIMIT 5
    """,
    "penalty_summary": """
        SELECT o.name as org_name, o.sector,
               COUNT(fp.id) as penalty_count,
               SUM(fp.amount) as total_amount,
               MAX(fp.amount) as max_penalty
        FROM financial_penalties fp
        LEFT JOIN organizations o ON o.id = fp.organization_id
        GROUP BY o.id, o.name, o.sector
        ORDER BY total_amount DESC
        LIMIT 10
    """,
}

# ── Entity extraction ──────────────────────────────────────────────────────────


def extract_entities(question: str) -> Dict[str, List[str]]:
    """Extract named entities from a question using regex patterns."""
    entities: Dict[str, List[str]] = {}
    for entity_type, patterns in ENTITY_PATTERNS.items():
        matches = []
        for pattern in patterns:
            found = re.findall(pattern, question, re.IGNORECASE)
            matches.extend(found)
        if matches:
            entities[entity_type] = list(set(matches))
    return entities

# ── Semantic entity linking ────────────────────────────────────────────────────


def link_entities_to_graph(entities: Dict[str, List[str]]) -> Dict[str, List[Dict]]:
    """Link extracted entities to graph nodes via Qdrant semantic search."""
    linked = {}
    try:
        from qdrant_client import QdrantClient
        model = get_embed_model()
        if model is None:
            log.warning(f"Entity linking skipped: embedding model unavailable ({_embed_model_error})")
            return linked
        client = QdrantClient(url=QDRANT_URL, timeout=5)

        for entity_type, entity_values in entities.items():
            linked[entity_type] = []
            collection_map = {
                "organization": "ndsep_organizations",
                "violation_type": "ndsep_violations",
                "regulation": "ndsep_knowledge_base",
                "sector": "ndsep_organizations",
            }
            collection = collection_map.get(entity_type)
            if not collection:
                continue
            for value in entity_values:
                try:
                    vec = model.encode([value]).tolist()[0]
                    results = client.search(
                        collection_name=collection,
                        query_vector=vec,
                        limit=3,
                        with_payload=True
                    )
                    for r in results:
                        if r.score > 0.5:
                            linked[entity_type].append({
                                "entity": value,
                                "matched": r.payload,
                                "score": r.score
                            })
                except Exception:
                    pass
    except Exception as e:
        log.warning(f"Entity linking failed: {e}")
    return linked

# ── Graph traversal ────────────────────────────────────────────────────────────


def traverse_graph(question: str, entities: Dict[str, List[str]]) -> List[Dict]:
    """Execute graph traversal queries based on extracted entities."""
    results = []
    try:
        conn = psycopg2.connect(_require_dsn(DB_URL))
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Determine query intent
        q_lower = question.lower()

        if any(w in q_lower for w in ["violation", "breach", "non-compliant", "infringement"]):
            if "organization" in entities:
                for org in entities["organization"][:2]:
                    cur.execute(KG_QUERIES["org_violations"], (f"%{org}%",))
                    rows = cur.fetchall()
                    results.extend([dict(r) for r in rows])
            else:
                cur.execute(KG_QUERIES["recent_violations"])
                results.extend([dict(r) for r in cur.fetchall()])

        elif any(w in q_lower for w in ["sector", "industry", "banking", "telecom"]):
            sector = None
            if "sector" in entities:
                sector = entities["sector"][0]
            elif "banking" in q_lower:
                sector = "banking"
            elif "telecom" in q_lower:
                sector = "telecom"
            elif "healthcare" in q_lower:
                sector = "healthcare"
            if sector:
                cur.execute(KG_QUERIES["sector_compliance"], (sector,))
                results.extend([dict(r) for r in cur.fetchall()])

        elif any(w in q_lower for w in ["policy", "policies", "regulation", "rule"]):
            policy_type = "data_protection"
            if "consent" in q_lower:
                policy_type = "consent"
            elif "retention" in q_lower:
                policy_type = "retention"
            elif "transfer" in q_lower:
                policy_type = "cross_border"
            cur.execute(KG_QUERIES["policy_by_type"], (f"%{policy_type}%", f"%{policy_type}%"))
            results.extend([dict(r) for r in cur.fetchall()])

        elif any(w in q_lower for w in ["penalty", "fine", "sanction", "enforcement"]):
            if "organization" in entities:
                for org in entities["organization"][:2]:
                    cur.execute(KG_QUERIES["enforcement_by_org"], (f"%{org}%",))
                    results.extend([dict(r) for r in cur.fetchall()])
            else:
                cur.execute(KG_QUERIES["penalty_summary"])
                results.extend([dict(r) for r in cur.fetchall()])

        cur.close()
        conn.close()
    except Exception as e:
        log.error(f"Graph traversal failed: {e}")
    return results

# ── Qdrant semantic retrieval ──────────────────────────────────────────────────


def semantic_retrieve(question: str, limit: int = 5) -> List[Dict]:
    """Retrieve semantically relevant context from Qdrant."""
    try:
        from qdrant_client import QdrantClient
        model = get_embed_model()
        if model is None:
            log.warning(f"Semantic retrieval skipped: embedding model unavailable ({_embed_model_error})")
            return []
        client = QdrantClient(url=QDRANT_URL, timeout=5)
        vec = model.encode([question]).tolist()[0]
        all_results = []
        for collection in ["ndsep_knowledge_base", "ndsep_policies", "ndsep_violations"]:
            try:
                results = client.search(
                    collection_name=collection,
                    query_vector=vec,
                    limit=limit,
                    with_payload=True
                )
                for r in results:
                    all_results.append({
                        "score": r.score,
                        "collection": collection,
                        "payload": r.payload
                    })
            except Exception:
                pass
        all_results.sort(key=lambda x: x["score"], reverse=True)
        return all_results[:limit]
    except Exception as e:
        log.warning(f"Semantic retrieval failed: {e}")
        return []

# ── LLM answer generation ──────────────────────────────────────────────────────


def generate_answer_with_llm(question: str, context: List[Dict], graph_data: List[Dict]) -> str:
    """Generate a natural language answer using Ollama LLM with retrieved context."""
    # Build context string
    context_parts = []
    for item in context[:5]:
        payload = item.get("payload", {})
        text = payload.get("text") or payload.get("chunk_text") or payload.get("name", "")
        if text:
            source = payload.get("source", payload.get("source_type", ""))
            context_parts.append(f"[{source}] {text[:300]}")

    for item in graph_data[:5]:
        context_parts.append(f"[Graph Data] {json.dumps(item, default=str)[:300]}")

    context_str = "\n\n".join(context_parts) if context_parts else "No specific context found."

    prompt = f"""You are an expert NDPA (Nigeria Data Protection Act 2023) compliance advisor for the National Data Sovereignty Enforcement Platform (NDSEP).

Answer the following question based on the provided context. Be precise, cite relevant sections where applicable, and provide actionable guidance.

Context:
{context_str}

Question: {question}

Answer:"""

    # Try Ollama first
    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": LLM_MODEL, "prompt": prompt, "stream": False},
            timeout=30
        )
        if resp.status_code == 200:
            return resp.json().get("response", "")
    except Exception:
        pass

    # Fallback: rule-based answer from context
    if context_parts:
        return "Based on the available compliance data:\n\n" + "\n".join(context_parts[:3])

    return "I could not find specific information to answer this question. Please consult the NDPA 2023 directly or contact the NDPC."

# ── Main KGQA pipeline ─────────────────────────────────────────────────────────


def answer_question(question: str) -> Dict[str, Any]:
    """Full KGQA pipeline: question → entities → graph → context → answer."""
    global _questions_answered, _errors
    start_time = time.time()
    try:
        # Step 1: Extract entities
        entities = extract_entities(question)
        log.info(f"Extracted entities: {entities}")

        # Step 2: Semantic retrieval from Qdrant
        context = semantic_retrieve(question)

        # Step 3: Graph traversal
        graph_data = traverse_graph(question, entities)

        # Step 4: Generate answer
        answer = generate_answer_with_llm(question, context, graph_data)

        _questions_answered += 1
        elapsed = round(time.time() - start_time, 2)

        return {
            "question": question,
            "answer": answer,
            "entities": entities,
            "context_sources": [
                {
                    "collection": c.get("collection"),
                    "score": round(c.get("score", 0), 3),
                    "source": c.get("payload", {}).get("source", c.get("payload", {}).get("source_type", "")),
                    "title": c.get("payload", {}).get("title", c.get("payload", {}).get("name", ""))
                }
                for c in context[:5]
            ],
            "graph_results": graph_data[:5],
            "elapsed_seconds": elapsed,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        _errors += 1
        log.error(f"KGQA failed: {e}")
        return {
            "question": question,
            "answer": f"An error occurred while processing your question: {str(e)}",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

# ── HTTP Server ────────────────────────────────────────────────────────────────


def _check_dependencies() -> Dict[str, Any]:
    """Probe PostgreSQL, Qdrant and Ollama with short timeouts."""
    deps: Dict[str, Any] = {}
    try:
        conn = psycopg2.connect(_require_dsn(DB_URL), connect_timeout=3)
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        cur.close()
        conn.close()
        deps["postgres"] = "ok"
    except Exception as e:
        deps["postgres"] = f"unavailable: {str(e)[:120]}"
    try:
        resp = requests.get(f"{QDRANT_URL}/collections", timeout=3)
        deps["qdrant"] = "ok" if resp.status_code == 200 else f"http_{resp.status_code}"
    except Exception as e:
        deps["qdrant"] = f"unavailable: {str(e)[:120]}"
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
        deps["ollama"] = "ok" if resp.status_code == 200 else f"http_{resp.status_code}"
    except Exception as e:
        deps["ollama"] = f"unavailable: {str(e)[:120]}"
    deps["embedding_model"] = "ok" if _embed_model is not None else f"unavailable: {_embed_model_error}"
    return deps


def _auth_ok(headers) -> tuple[bool, str]:
    """Shared-secret check for POST endpoints (fail closed outside dev)."""
    import hmac
    presented = headers.get("X-Worker-Token", "")
    if not presented:
        auth = headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            presented = auth[7:]
    if WORKER_AUTH_TOKEN:
        ok = hmac.compare_digest(presented.encode(), WORKER_AUTH_TOKEN.encode())
        return ok, "unauthorized" if not ok else ""
    if _IS_DEV:
        return True, ""
    return False, "WORKER_AUTH_TOKEN not configured — refusing POST outside development"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send_json(self, data: Any, status: int = 200):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            deps = _check_dependencies()
            healthy = all(v == "ok" for v in deps.values())
            self._send_json({
                "status": "healthy" if healthy else "unhealthy",
                "worker": "epr_kgqa_worker",
                "dependencies": deps,
                "questions_answered": _questions_answered,
                "kg_nodes": _kg_nodes,
                "kg_edges": _kg_edges,
                "errors": _errors,
                "uptime_seconds": round(time.time() - _worker_start, 1),
                "capabilities": ["entity_extraction", "semantic_retrieval", "graph_traversal", "llm_generation"]
            }, status=200 if healthy else 503)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/ask":
            self.send_response(404)
            self.end_headers()
            return
        ok, reason = _auth_ok(self.headers)
        if not ok:
            status = 401 if reason == "unauthorized" else 503
            self._send_json({"error": reason}, status=status)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send_json({"error": f"request body must be 1..{MAX_BODY_BYTES} bytes"}, status=413)
            return
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json({"error": "invalid JSON body"}, status=400)
            return
        question = str(body.get("question", ""))
        if not question:
            self._send_json({"error": "question required"}, status=400)
            return
        if len(question) > MAX_QUESTION_CHARS:
            self._send_json({"error": f"question exceeds {MAX_QUESTION_CHARS} chars"}, status=413)
            return
        result = answer_question(question)
        self._send_json(result)


if __name__ == "__main__":
    log.info("Starting NDSEP EPR-KGQA Worker...")
    # Warm the embedding model ONCE at startup (not per request).
    threading.Thread(target=load_embed_model, daemon=True).start()
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.allow_reuse_address = True
        log.info(f"EPR-KGQA Worker HTTP server on port {PORT}")
        httpd.serve_forever()
