#!/usr/bin/env python3
"""
NDSEP Regulatory-Intelligence Ingest Worker (Python)
====================================================
Ingests legal instruments (NDPA 2023 sections, GAID 2025, subsidiary
legislation, tribunal / Federal High Court precedents) from admin-uploaded
text and prepares them for the regulatory-intelligence knowledge base
(server/routers/regIntel.ts, migration 0091).

Pipeline:
  1. Chunk the instrument text by section ("Section 44(2)", "Article 5",
     "Regulation 3", "PART IV" headings are kept with their chunks).
  2. Embed each chunk via the Ollama embeddings HTTP API
     (EMBED_URL, default $OLLAMA_URL/api/embeddings). The ollama_llm_worker
     (port 8203) exposes no embedding endpoint, so this worker calls the
     Ollama-native API directly but honours the same OLLAMA_URL config.
     When embedding is disabled/unreachable the worker returns
     embed_status = "EMBED_UNCONFIGURED" — it NEVER fabricates vectors.
  3. Upsert vectors + section payloads to the Qdrant collection
     `legal_corpus`, gated on REGINTEL_QDRANT_ENABLED=1 (and QDRANT_URL
     reachable). Otherwise qdrant_status = "QDRANT_UNCONFIGURED".
  4. Instrument versioning / supersession chains are persisted by the
     server router (regIntel.addVersion) — this worker is intentionally
     stdlib+requests only and does not write Postgres. It returns the
     structured chunks so the caller can persist them.

Gazette watch (stub interface):
  POST /gazette-check performs a scheduled-change check against
  GAZETTE_SOURCE_URL. Without a configured source URL it returns
  {"status": "UNCONFIGURED"} — an explicit no-op, not a fake success.
  When configured it fetches the source, hashes it (SHA-256) and reports
  whether the digest changed since the last check (state file
  GAZETTE_STATE_FILE).

Endpoints:
  GET  /health         — worker status + embed/qdrant/gazette configuration
  POST /chunk          — chunk instrument text (no embedding)
  POST /ingest         — chunk + embed + qdrant upsert; returns structured chunks
  POST /gazette-check  — gazette change-detection check (UNCONFIGURED-safe)

Technology: Python stdlib + requests only.
Port: 8210 (REGINTEL_PORT)
"""
import hashlib
import http.server
import json
import logging
import os
import re
import socketserver
import time
import uuid
from typing import Any, Dict, List, Optional

import requests

# ── Configuration ──────────────────────────────────────────────────────────────
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
EMBED_URL = os.environ.get("EMBED_URL", f"{OLLAMA_URL}/api/embeddings")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")
EMBED_ENABLED = os.environ.get("REGINTEL_EMBED_ENABLED", "0") == "1"
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "")
QDRANT_ENABLED = os.environ.get("REGINTEL_QDRANT_ENABLED", "0") == "1"
QDRANT_COLLECTION = os.environ.get("REGINTEL_QDRANT_COLLECTION", "legal_corpus")
GAZETTE_SOURCE_URL = os.environ.get("GAZETTE_SOURCE_URL", "")
GAZETTE_STATE_FILE = os.environ.get("GAZETTE_STATE_FILE", "/tmp/ndsep_gazette_digest.txt")
RELAY_URL = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
PORT = int(os.environ.get("REGINTEL_PORT", "8210"))
HTTP_TIMEOUT = int(os.environ.get("REGINTEL_HTTP_TIMEOUT", "20"))

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [NDSEP-RegIntel] %(levelname)s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

# ── State ──────────────────────────────────────────────────────────────────────
_worker_start = time.time()
_instruments_ingested = 0
_chunks_embedded = 0
_errors = 0

# ── Section chunking ───────────────────────────────────────────────────────────
# Matches "Section 44", "SECTION 44(2)(a)", "Article 5", "Regulation 3",
# "Rule 12", "Clause 7" at the start of a line (legal-instrument convention).
SECTION_RE = re.compile(
    r"^\s*(Section|SECTION|Article|ARTICLE|Regulation|REGULATION|Rule|RULE|Clause|CLAUSE)"
    r"\s+([0-9]+(?:\([0-9a-z]+\))*)",
    re.MULTILINE,
)
PART_RE = re.compile(r"^\s*(PART|Part)\s+([IVXLC0-9]+)\b", re.MULTILINE)
MAX_CHUNK_CHARS = 4000


def _normalize_section_ref(kind: str, num: str) -> str:
    kind_norm = kind.strip().capitalize()
    return f"{kind_norm} {num}"


def _split_oversize(section_ref: str, heading: Optional[str], body: str) -> List[Dict[str, Any]]:
    """Split an oversized section body into <=MAX_CHUNK_CHARS chunks on
    paragraph boundaries, preserving the section ref with chunk_index > 0."""
    paragraphs = re.split(r"\n\s*\n", body)
    chunks: List[Dict[str, Any]] = []
    current = ""
    for para in paragraphs:
        if current and len(current) + len(para) + 2 > MAX_CHUNK_CHARS:
            chunks.append({"section_ref": section_ref, "heading": heading,
                           "body": current.strip(), "chunk_index": len(chunks)})
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current.strip():
        chunks.append({"section_ref": section_ref, "heading": heading,
                       "body": current.strip(), "chunk_index": len(chunks)})
    return chunks


def chunk_by_section(text: str) -> List[Dict[str, Any]]:
    """Chunk a legal instrument into section-level chunks.

    Returns a list of {section_ref, heading, body, chunk_index}. Preamble text
    before the first section marker is preserved as section_ref 'Preamble'.
    Every chunk of the input text is retained — nothing is dropped.
    """
    if not text or not text.strip():
        return []
    matches = list(SECTION_RE.finditer(text))
    chunks: List[Dict[str, Any]] = []
    if not matches:
        # No recognizable section markers: treat the whole text as one chunk.
        return _split_oversize("Unsectioned", None, text.strip())

    preamble = text[: matches[0].start()].strip()
    if preamble:
        chunks.extend(_split_oversize("Preamble", None, preamble))

    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        block = text[start:end].strip()
        section_ref = _normalize_section_ref(m.group(1), m.group(2))
        # First non-empty line after the section number is treated as the heading.
        lines = block.splitlines()
        heading: Optional[str] = None
        first_line = lines[0].strip()
        heading_tail = first_line[m.end() - m.start():].strip(" .—:-")
        if heading_tail and len(heading_tail) <= 200:
            heading = heading_tail
        chunks.extend(_split_oversize(section_ref, heading, block))
    return chunks

# ── Embedding (Ollama HTTP API) ────────────────────────────────────────────────


def embed_status() -> Dict[str, Any]:
    """Report embedding configuration honestly; never pretend to embed."""
    if not EMBED_ENABLED:
        return {"status": "EMBED_UNCONFIGURED",
                "reason": "REGINTEL_EMBED_ENABLED is not set to '1'"}
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        if resp.status_code != 200:
            return {"status": "EMBED_UNCONFIGURED",
                    "reason": f"ollama at {OLLAMA_URL} returned HTTP {resp.status_code}"}
        return {"status": "configured", "embed_url": EMBED_URL, "model": EMBED_MODEL}
    except Exception as e:  # noqa: BLE001 - surface, don't swallow
        return {"status": "EMBED_UNCONFIGURED", "reason": f"ollama unreachable: {e}"}


def embed_texts(texts: List[str]) -> Optional[List[List[float]]]:
    """Embed texts via the Ollama embeddings API. Returns None when embedding
    is unconfigured/unavailable — callers must degrade explicitly."""
    if not EMBED_ENABLED:
        return None
    vectors: List[List[float]] = []
    try:
        for text in texts:
            resp = requests.post(
                EMBED_URL,
                json={"model": EMBED_MODEL, "prompt": text},
                timeout=HTTP_TIMEOUT,
            )
            if resp.status_code != 200:
                log.warning("embed HTTP %s: %s", resp.status_code, resp.text[:200])
                return None
            vec = resp.json().get("embedding")
            if not vec:
                log.warning("embed response missing 'embedding' field")
                return None
            vectors.append(vec)
        return vectors
    except Exception as e:  # noqa: BLE001
        log.warning("embedding failed: %s", e)
        return None

# ── Qdrant upsert (config-gated) ───────────────────────────────────────────────


def qdrant_status() -> Dict[str, Any]:
    if not QDRANT_ENABLED:
        return {"status": "QDRANT_UNCONFIGURED",
                "reason": "REGINTEL_QDRANT_ENABLED is not set to '1'",
                "collection": QDRANT_COLLECTION}
    try:
        headers = {"api-key": QDRANT_API_KEY} if QDRANT_API_KEY else {}
        resp = requests.get(f"{QDRANT_URL}/collections", headers=headers, timeout=5)
        if resp.status_code != 200:
            return {"status": "QDRANT_UNCONFIGURED",
                    "reason": f"qdrant at {QDRANT_URL} returned HTTP {resp.status_code}",
                    "collection": QDRANT_COLLECTION}
        return {"status": "configured", "collection": QDRANT_COLLECTION}
    except Exception as e:  # noqa: BLE001
        return {"status": "QDRANT_UNCONFIGURED", "reason": f"qdrant unreachable: {e}",
                "collection": QDRANT_COLLECTION}


def ensure_collection(vector_size: int) -> bool:
    """Create the legal_corpus collection if missing. Returns False on failure."""
    headers = {"api-key": QDRANT_API_KEY} if QDRANT_API_KEY else {}
    resp = requests.put(
        f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}",
        headers=headers,
        json={"vectors": {"size": vector_size, "distance": "Cosine"}},
        timeout=HTTP_TIMEOUT,
    )
    # 200 = created, 409/400-with-exists = already present
    return resp.status_code in (200, 201, 409)


def upsert_chunks(chunks: List[Dict[str, Any]], vectors: List[List[float]],
                  meta: Dict[str, Any]) -> Dict[str, Any]:
    """Upsert chunk vectors into legal_corpus. Returns per-chunk point ids.
    Only called when QDRANT is configured and vectors are real."""
    headers = {"api-key": QDRANT_API_KEY} if QDRANT_API_KEY else {}
    if not ensure_collection(len(vectors[0])):
        return {"status": "QDRANT_UNCONFIGURED",
                "reason": f"could not ensure collection {QDRANT_COLLECTION}"}
    points = []
    for chunk, vec in zip(chunks, vectors):
        point_id = str(uuid.uuid4())
        chunk["qdrant_point_id"] = point_id
        points.append({
            "id": point_id,
            "vector": vec,
            "payload": {
                "instrument_code": meta.get("instrument_code"),
                "instrument_title": meta.get("instrument_title"),
                "version_label": meta.get("version_label"),
                "effective_date": meta.get("effective_date"),
                "section_ref": chunk["section_ref"],
                "heading": chunk.get("heading"),
                "chunk_index": chunk["chunk_index"],
                "body": chunk["body"],
            },
        })
    resp = requests.put(
        f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points?wait=true",
        headers=headers, json={"points": points}, timeout=HTTP_TIMEOUT,
    )
    if resp.status_code != 200:
        return {"status": "error",
                "reason": f"qdrant upsert HTTP {resp.status_code}: {resp.text[:200]}"}
    return {"status": "upserted", "points": len(points), "collection": QDRANT_COLLECTION}

# ── Gazette watch (stub interface, explicit UNCONFIGURED) ─────────────────────


def gazette_check() -> Dict[str, Any]:
    """Scheduled gazette-change check. Explicitly UNCONFIGURED without a
    source URL; when configured, detects content changes by SHA-256 digest."""
    if not GAZETTE_SOURCE_URL:
        return {
            "status": "UNCONFIGURED",
            "reason": "GAZETTE_SOURCE_URL is not set; gazette watch is a stub "
                      "interface and performs no fetching until configured",
        }
    try:
        resp = requests.get(GAZETTE_SOURCE_URL, timeout=HTTP_TIMEOUT)
        if resp.status_code != 200:
            return {"status": "error",
                    "reason": f"gazette source HTTP {resp.status_code}"}
        digest = hashlib.sha256(resp.content).hexdigest()
        previous = None
        if os.path.exists(GAZETTE_STATE_FILE):
            with open(GAZETTE_STATE_FILE, "r", encoding="utf-8") as fh:
                previous = fh.read().strip() or None
        changed = previous is not None and previous != digest
        with open(GAZETTE_STATE_FILE, "w", encoding="utf-8") as fh:
            fh.write(digest)
        return {"status": "checked", "source": GAZETTE_SOURCE_URL,
                "digest": digest, "changed": changed,
                "first_check": previous is None}
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "reason": f"gazette check failed: {e}"}

# ── Ingest pipeline ────────────────────────────────────────────────────────────


def ingest(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Chunk + embed + qdrant-upsert an instrument version. Degrades
    explicitly at every stage; the caller (server router) persists rows."""
    global _instruments_ingested, _chunks_embedded, _errors
    text = payload.get("text", "")
    if not text.strip():
        return {"status": "error", "reason": "text is required"}
    meta = {
        "instrument_code": payload.get("instrument_code"),
        "instrument_title": payload.get("instrument_title"),
        "version_label": payload.get("version_label"),
        "effective_date": payload.get("effective_date"),
    }
    chunks = chunk_by_section(text)
    if not chunks:
        _errors += 1
        return {"status": "error", "reason": "no sections could be parsed from text"}

    result: Dict[str, Any] = {
        "status": "ok",
        "chunks": chunks,
        "chunk_count": len(chunks),
        **meta,
        "supersedes_version_label": payload.get("supersedes_version_label"),
    }

    # Embedding — explicit UNCONFIGURED path.
    vectors = embed_texts([c["body"] for c in chunks])
    if vectors is None:
        result["embed_status"] = embed_status()
        result["qdrant_status"] = {"status": "QDRANT_SKIPPED",
                                   "reason": "no vectors to upsert (embedding unconfigured/failed)"}
        _instruments_ingested += 1
        return result
    result["embed_status"] = {"status": "embedded", "model": EMBED_MODEL,
                              "vectors": len(vectors)}
    _chunks_embedded += len(vectors)

    # Qdrant — config-gated upsert.
    if not QDRANT_ENABLED:
        result["qdrant_status"] = qdrant_status()
    else:
        try:
            result["qdrant_status"] = upsert_chunks(chunks, vectors, meta)
        except Exception as e:  # noqa: BLE001
            log.warning("qdrant upsert failed: %s", e)
            result["qdrant_status"] = {"status": "error", "reason": str(e)}
    _instruments_ingested += 1
    return result


def health() -> Dict[str, Any]:
    return {
        "status": "healthy",
        "worker": "regintel_ingest_worker",
        "instruments_ingested": _instruments_ingested,
        "chunks_embedded": _chunks_embedded,
        "errors": _errors,
        "embed": embed_status(),
        "qdrant": qdrant_status(),
        "gazette": ({"status": "configured", "source": GAZETTE_SOURCE_URL}
                    if GAZETTE_SOURCE_URL else {"status": "UNCONFIGURED"}),
        "uptime_seconds": round(time.time() - _worker_start, 1),
        "capabilities": ["section_chunking", "ollama_embedding",
                         "qdrant_upsert", "gazette_watch_stub"],
    }

# ── HTTP server ────────────────────────────────────────────────────────────────


def _json(handler: http.server.BaseHTTPRequestHandler, code: int, body: Dict[str, Any]) -> None:
    data = json.dumps(body).encode()
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.end_headers()
    handler.wfile.write(data)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args: Any) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            _json(self, 200, health())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            _json(self, 400, {"status": "error", "reason": "invalid JSON body"})
            return
        if self.path == "/chunk":
            chunks = chunk_by_section(body.get("text", ""))
            _json(self, 200, {"status": "ok", "chunks": chunks, "chunk_count": len(chunks)})
        elif self.path == "/ingest":
            _json(self, 200, ingest(body))
        elif self.path == "/gazette-check":
            _json(self, 200, gazette_check())
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    log.info("Starting NDSEP RegIntel Ingest Worker...")
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.allow_reuse_address = True
        log.info("RegIntel Ingest Worker HTTP server on port %s", PORT)
        httpd.serve_forever()
