#!/usr/bin/env python3
"""
NDSEP Case Embedder Worker (Python) — round 12, wave 6 (roadmap §4.3)
======================================================================
Incremental embedder for the Commission's OWN closed case history. Builds a
redacted "text card" per decided case, embeds it with the same
sentence-transformers path as qdrant_vector_worker.py, and upserts into the
Qdrant collection `ndsep_cases` so the casePrecedents tRPC router can surface
"similar precedents" panels in triage, settlement, and penalty screens.

Sources (decided/closed rows only — nothing in-flight is ever embedded):
  - public_complaints      status IN ('resolved', 'closed')
  - enforcement_cases      status IN ('settled', 'closed')
  - settlements            status IN ('fulfilled', 'defaulted')
  - tribunal_escalations   status = 'decided'

PRIVACY (hard constraint): the text card NEVER contains raw data-subject or
respondent PII. Complainant/respondent name, email, and phone columns are
never SELECTed; free-text fields that may incidentally carry PII (subject,
description, resolution notes, tribunal decision summary) are passed through
redact_pii(), which strips/HMAC-masks emails, MSISDN/phone numbers, NIN (11
digit), and BVN-style identifiers before embedding. Payloads carry only
structural metadata: {case_type, case_id, sector, outcome, penalty_band,
decided_at, category, reference}.

Incrementality: per-source watermarks live in the Postgres table
case_embedding_watermarks (migration 0134_case_embeddings.sql):
  (source_table text PK, last_id text, last_run_at timestamptz)
Each run processes rows with id > last_id in ascending id order and advances
the watermark only after a successful Qdrant upsert, so a crash mid-run is
safe to retry (Qdrant upserts are idempotent on the deterministic point id).

Operation: long-running HTTP worker (port 8202) with /health, /status and
POST /run (trigger an incremental pass); also runs one pass on boot and then
every REINDEX_INTERVAL seconds. A cron/Temporal schedule can instead invoke
`python3 case_embedder_worker.py --once` for a single pass. See
docs/round12_w6_report.md.

Technology: Python · sentence-transformers (shared model config with
qdrant_vector_worker) · qdrant-client · psycopg2
Port: 8202
"""
import os
import re
import sys
import time
import json
import hmac
import logging
import hashlib
import threading
import http.server
import socketserver
from datetime import datetime, timezone
from typing import Optional, List, Dict, Tuple

# Heavy third-party deps (psycopg2, qdrant-client, sentence-transformers) are
# imported lazily inside functions so this module stays importable — and the
# redaction/card builders stay unit-testable — on hosts without them.

# ── Configuration ─────────────────────────────────────────────────────────────
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "")
DB_URL = os.environ.get("WORKER_DATABASE_URL", os.environ.get("DATABASE_URL"))
PORT = int(os.environ.get("CASE_EMBEDDER_PORT", "8202"))
EMBED_MODEL = os.environ.get("EMBED_MODEL", "all-MiniLM-L6-v2")
VECTOR_DIM = 384  # all-MiniLM-L6-v2 output dimension (same as qdrant worker)
BATCH_SIZE = 32
REINDEX_INTERVAL = int(os.environ.get("CASE_EMBEDDER_INTERVAL", "600"))
RUN_BATCH_LIMIT = int(os.environ.get("CASE_EMBEDDER_BATCH", "200"))
# Keyed-HMAC secret for masking anything that looks like an identifier in
# free text. Fail-closed to a fixed non-secret key with a loud warning when
# unset so embeddings never contain raw identifiers by accident.
PII_HMAC_KEY = os.environ.get("NDSEP_PII_HMAC_KEY", "")

COLLECTION = "ndsep_cases"
WATERMARK_TABLE = "case_embedding_watermarks"

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [NDSEP-CaseEmbedder] %(levelname)s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

if not PII_HMAC_KEY:
    log.warning("NDSEP_PII_HMAC_KEY not set — using a fixed non-secret masking "
                "key. Masking is still irreversible in practice (the original "
                "value is discarded) but is not keyed; set the env var in "
                "production.")

# ── State ─────────────────────────────────────────────────────────────────────
_worker_start = time.time()
_qdrant_connected = False
_total_upserts = 0
_last_run_at: Optional[str] = None
_last_run_counts: Dict[str, int] = {}
_errors = 0

# ── PII redaction ─────────────────────────────────────────────────────────────
# Patterns target the identifier shapes seen across NDSEP tables:
#   emails              standard addr-spec
#   MSISDN / phones     +234..., 234..., 0[789]... Nigerian formats and generic
#                       10-15 digit international numbers with separators
#   NIN                 exactly 11 digits (Nigeria National Identification No.)
#   BVN                 exactly 11 digits following a bvn-ish label is also
#                       caught by the NIN rule; standalone 11-digit runs are
#                       treated as NIN/BVN regardless of label (conservative).
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_NIN_RE = re.compile(r"(?<!\d)\d{11}(?!\d)")
_MSISDN_RE = re.compile(
    r"(?<![\w])(?:\+?234[\s\-]?[789][01]\d[\s\-]?\d{3}[\s\-]?\d{4}"
    r"|0[789][01]\d[\s\-]?\d{3}[\s\-]?\d{4}"
    r"|\+[1-9]\d{1,2}[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4})(?![\w])")
# Generic long digit runs (account numbers, card-ish) that are not NIN-length.
_LONGNUM_RE = re.compile(r"(?<!\d)\d{8,16}(?!\d)")


def _mask(value: str, kind: str) -> str:
    """Keyed-HMAC mask: irreversible, deterministic, non-enumerable."""
    digest = hmac.new(
        (PII_HMAC_KEY or "ndsep-case-embedder-unkeyed").encode(),
        value.encode(), hashlib.sha256).hexdigest()[:12]
    return f"[{kind}:{digest}]"


def redact_pii(text: Optional[str]) -> str:
    """Strip/HMAC-mask raw PII from free text before embedding.

    Emails, MSISDN/phone numbers, and 11-digit NIN/BVN runs are replaced with
    deterministic HMAC masks (never the raw value). Long digit runs are
    masked conservatively as identifiers. None of the raw substrings survive.
    """
    if not text:
        return ""
    out = _EMAIL_RE.sub(lambda m: _mask(m.group(0), "email"), text)
    out = _MSISDN_RE.sub(lambda m: _mask(m.group(0), "phone"), out)
    out = _NIN_RE.sub(lambda m: _mask(m.group(0), "nin"), out)
    out = _LONGNUM_RE.sub(lambda m: _mask(m.group(0), "id"), out)
    return out


def truncate(text: str, limit: int = 400) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


# ── Penalty bands ─────────────────────────────────────────────────────────────
# Bands (NGN) mirror the NDPA s.65 fine structure: sub-2M "less serious",
# 2M–10M mid, 10M+ "serious" headline band, plus an open-ended top band.
def penalty_band(amount: Optional[float], currency: str = "NGN") -> str:
    if amount is None:
        return "none"
    try:
        amt = float(amount)
    except (TypeError, ValueError):
        return "unknown"
    if amt <= 0:
        return "none"
    if currency and currency.upper() != "NGN":
        return "non_ngn"
    if amt < 2_000_000:
        return "under_2m"
    if amt < 10_000_000:
        return "2m_10m"
    if amt < 50_000_000:
        return "10m_50m"
    return "over_50m"


# ── Text cards ────────────────────────────────────────────────────────────────
def build_text_card(card: Dict) -> str:
    """Render the redacted text card that gets embedded.

    `card` must already be PII-free at the structural level; free-text fields
    are redacted here as a second line of defence.
    """
    lines = [
        f"Case type: {card['case_type']}",
        f"Category: {card.get('category') or 'unspecified'}",
        f"Sector: {card.get('sector') or 'unknown'}",
        f"Violation types: {card.get('violation_types') or card.get('category') or 'unspecified'}",
        f"Outcome: {card['outcome']}",
        f"Penalty band: {card.get('penalty_band') or 'none'}",
        f"Decided at: {card.get('decided_at') or 'unknown'}",
    ]
    summary = truncate(redact_pii(card.get("summary", "")))
    if summary:
        lines.append(f"Summary: {summary}")
    return "\n".join(lines)


def point_id(case_type: str, case_id) -> int:
    """Deterministic Qdrant point id (same md5 pattern as qdrant_vector_worker)."""
    return int(hashlib.md5(f"case-{case_type}-{case_id}".encode(),
                           usedforsecurity=False).hexdigest()[:8], 16) % (2**31)


# ── Embedding (same path as qdrant_vector_worker) ─────────────────────────────
_embed_model = None


def load_model():
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer
        log.info(f"Loading embedding model: {EMBED_MODEL}")
        _embed_model = SentenceTransformer(EMBED_MODEL)
        log.info("Embedding model loaded")
    return _embed_model


def embed_texts(texts: List[str]) -> Optional[List[List[float]]]:
    """Identical embedding path to qdrant_vector_worker.embed_texts()."""
    try:
        model = load_model()
    except Exception as e:
        log.error(f"Failed to load embedding model: {e}")
        return None
    try:
        embeddings = model.encode(texts, batch_size=BATCH_SIZE, show_progress_bar=False)
        return embeddings.tolist()
    except Exception as e:
        log.error(f"Embedding failed: {e}")
        return None


# ── Qdrant helpers ────────────────────────────────────────────────────────────
_qdrant_client = None


def get_qdrant():
    global _qdrant_client, _qdrant_connected
    if _qdrant_client is not None:
        return _qdrant_client
    try:
        from qdrant_client import QdrantClient
        from qdrant_client.models import Distance, VectorParams
        client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY or None, timeout=10)
        existing = {c.name for c in client.get_collections().collections}
        if COLLECTION not in existing:
            client.create_collection(
                collection_name=COLLECTION,
                vectors_config=VectorParams(size=VECTOR_DIM, distance=Distance.COSINE))
            log.info(f"Created Qdrant collection: {COLLECTION}")
        _qdrant_client = client
        _qdrant_connected = True
        log.info("Qdrant connected; ndsep_cases ready")
        return client
    except Exception as e:
        log.warning(f"Qdrant not available: {e}")
        _qdrant_connected = False
        return None


def upsert_points(points: List[Dict]) -> int:
    client = get_qdrant()
    if client is None or not points:
        return 0
    try:
        from qdrant_client.models import PointStruct
        client.upsert(collection_name=COLLECTION, points=[
            PointStruct(id=p["id"], vector=p["vector"], payload=p["payload"])
            for p in points])
        return len(points)
    except Exception as e:
        global _errors
        _errors += 1
        log.error(f"Qdrant upsert failed for {COLLECTION}: {e}")
        return 0


# ── DB helpers + source queries ───────────────────────────────────────────────
def get_db():
    import psycopg2
    if not DB_URL:
        raise RuntimeError(
            "PostgreSQL DSN not configured: set WORKER_DATABASE_URL or "
            "DATABASE_URL (embedded default credentials removed in round-9).")
    return psycopg2.connect(DB_URL)


def _dicts(cur) -> List[Dict]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def get_watermark(conn, source_table: str) -> str:
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT last_id FROM {WATERMARK_TABLE} WHERE source_table = %s",
            (source_table,))
        row = cur.fetchone()
    return row[0] if row and row[0] is not None else "0"


def set_watermark(conn, source_table: str, last_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            f"""INSERT INTO {WATERMARK_TABLE} (source_table, last_id, last_run_at)
                VALUES (%s, %s, now())
                ON CONFLICT (source_table) DO UPDATE
                SET last_id = EXCLUDED.last_id, last_run_at = EXCLUDED.last_run_at""",
            (source_table, str(last_id)))


# NOTE on PII: none of these queries SELECT complainant_name /
# complainant_email / complainant_phone / respondent_name / respondent_email /
# created_by. Only structural metadata + free text that is redacted in
# redact_pii() before embedding.
SOURCE_QUERIES: Dict[str, Dict] = {
    "public_complaints": {
        "sql": """
            SELECT pc.id::text AS case_id,
                   pc.reference_code AS reference,
                   pc.category,
                   COALESCE(o.sector, '') AS sector,
                   pc.status AS outcome,
                   COALESCE(pc.closed_at, pc.resolved_at, pc.updated_at)::text AS decided_at,
                   (pc.subject || E'\\n' || pc.description
                       || E'\\n' || COALESCE(pc.resolution_notes, '')) AS summary
            FROM public_complaints pc
            LEFT JOIN organizations o ON o.id = pc.controller_id
            WHERE pc.status IN ('resolved', 'closed')
              AND pc.id > %s::bigint
            ORDER BY pc.id ASC
            LIMIT %s
        """,
        "case_type": "complaint",
        "penalty_amount": None,
    },
    "enforcement_cases": {
        "sql": """
            SELECT ec.id::text AS case_id,
                   ec.case_reference AS reference,
                   COALESCE(v.violation_type, 'enforcement') AS category,
                   COALESCE(o.sector, '') AS sector,
                   ec.status AS outcome,
                   fp.amount AS penalty_amount,
                   fp.currency AS penalty_currency,
                   COALESCE(ec.closed_at, ec.updated_at)::text AS decided_at,
                   (COALESCE(ec.escalation_reason, '') || E'\\n'
                       || COALESCE(ec.resolution_notes, '')) AS summary
            FROM enforcement_cases ec
            LEFT JOIN financial_penalties fp ON fp.id = ec.penalty_id
            LEFT JOIN compliance_violations v ON v.id = fp.violation_id
            LEFT JOIN organizations o ON o.id = ec.organization_id
            WHERE ec.status IN ('settled', 'closed')
              AND ec.id > %s::bigint
            ORDER BY ec.id ASC
            LIMIT %s
        """,
        "case_type": "enforcement",
    },
    "settlements": {
        "sql": """
            SELECT s.id::text AS case_id,
                   s.settlement_ref AS reference,
                   'settlement' AS category,
                   COALESCE(o.sector, '') AS sector,
                   s.status AS outcome,
                   st.monetary_amount AS penalty_amount,
                   st.currency AS penalty_currency,
                   COALESCE(s.fulfilled_at, s.defaulted_at, s.updated_at)::text AS decided_at,
                   COALESCE(s.default_reason, '') AS summary
            FROM settlements s
            LEFT JOIN organizations o ON o.id = s.org_id
            LEFT JOIN LATERAL (
                SELECT monetary_amount, currency FROM settlement_terms t
                WHERE t.settlement_id = s.id
                ORDER BY t.version DESC LIMIT 1
            ) st ON true
            WHERE s.status IN ('fulfilled', 'defaulted')
              AND s.id > %s::bigint
            ORDER BY s.id ASC
            LIMIT %s
        """,
        "case_type": "settlement",
    },
    "tribunal_escalations": {
        "sql": """
            SELECT te.id::text AS case_id,
                   COALESCE(te.case_number, 'TRIB-' || te.id::text) AS reference,
                   'tribunal' AS category,
                   COALESCE(o.sector, '') AS sector,
                   te.status AS outcome,
                   fp.amount AS penalty_amount,
                   fp.currency AS penalty_currency,
                   te.decided_at::text AS decided_at,
                   COALESCE(te.decision, '') AS summary
            FROM tribunal_escalations te
            LEFT JOIN financial_penalties fp ON fp.id = te.penalty_id
            LEFT JOIN organizations o ON o.id = fp.organization_id
            WHERE te.status = 'decided'
              AND te.id > %s::bigint
            ORDER BY te.id ASC
            LIMIT %s
        """,
        "case_type": "tribunal",
    },
}


def fetch_source_batch(conn, source_table: str, last_id: str) -> List[Dict]:
    src = SOURCE_QUERIES[source_table]
    with conn.cursor() as cur:
        cur.execute(src["sql"], (last_id, RUN_BATCH_LIMIT))
        return _dicts(cur)


def card_from_row(source_table: str, row: Dict) -> Dict:
    src = SOURCE_QUERIES[source_table]
    amount = row.get("penalty_amount")
    return {
        "case_type": src["case_type"],
        "case_id": row["case_id"],
        "reference": row.get("reference") or "",
        "category": row.get("category") or "",
        "sector": row.get("sector") or "",
        "outcome": row.get("outcome") or "",
        "penalty_band": penalty_band(amount, row.get("penalty_currency") or "NGN"),
        "decided_at": (row.get("decided_at") or "")[:10],
        "summary": row.get("summary") or "",
    }


def payload_from_card(card: Dict) -> Dict:
    """Qdrant payload — structural metadata only, no free text, no PII."""
    return {
        "case_type": card["case_type"],
        "case_id": card["case_id"],
        "reference": card["reference"],
        "category": card["category"],
        "sector": card["sector"],
        "outcome": card["outcome"],
        "penalty_band": card["penalty_band"],
        "decided_at": card["decided_at"],
        "indexed_at": datetime.now(timezone.utc).isoformat(),
    }


def process_source(conn, source_table: str) -> int:
    """One incremental pass over a single source. Returns upserted count."""
    global _total_upserts
    last_id = get_watermark(conn, source_table)
    rows = fetch_source_batch(conn, source_table, last_id)
    if not rows:
        set_watermark(conn, source_table, last_id)  # touch last_run_at
        conn.commit()
        return 0

    cards = [card_from_row(source_table, r) for r in rows]
    vectors = embed_texts([build_text_card(c) for c in cards])
    if not vectors:
        log.warning(f"{source_table}: embedding unavailable — watermark NOT advanced")
        conn.rollback()
        return 0

    points = [{"id": point_id(c["case_type"], c["case_id"]),
               "vector": v, "payload": payload_from_card(c)}
              for c, v in zip(cards, vectors)]
    upserted = upsert_points(points)
    if upserted != len(points):
        # Partial/zero upsert: do not advance the watermark (safe retry).
        conn.rollback()
        return upserted

    set_watermark(conn, source_table, rows[-1]["case_id"])
    conn.commit()
    _total_upserts += upserted
    log.info(f"{source_table}: embedded {upserted} case cards (last_id={rows[-1]['case_id']})")
    return upserted


def run_incremental() -> Dict[str, int]:
    """Full incremental pass over all sources; returns per-source counts."""
    global _last_run_at, _last_run_counts, _errors
    counts: Dict[str, int] = {}
    try:
        conn = get_db()
    except Exception as e:
        _errors += 1
        log.error(f"DB unavailable: {e}")
        return counts
    try:
        for source_table in SOURCE_QUERIES:
            try:
                counts[source_table] = process_source(conn, source_table)
            except Exception as e:
                _errors += 1
                counts[source_table] = 0
                log.error(f"{source_table}: pass failed: {e}")
                try:
                    conn.rollback()
                except Exception:
                    pass
        _last_run_at = datetime.now(timezone.utc).isoformat()
        _last_run_counts = counts
        log.info(f"Incremental pass complete: {counts}")
        return counts
    finally:
        conn.close()


# ── HTTP server ───────────────────────────────────────────────────────────────
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, code: int, body: Dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {
                "status": "healthy",
                "worker": "case_embedder_worker",
                "qdrant_connected": _qdrant_connected,
                "collection": COLLECTION,
                "total_upserts": _total_upserts,
                "last_run_at": _last_run_at,
                "errors": _errors,
                "uptime_seconds": round(time.time() - _worker_start, 1),
            })
        elif self.path == "/status":
            self._json(200, {
                "collection": COLLECTION,
                "sources": list(SOURCE_QUERIES.keys()),
                "last_run_at": _last_run_at,
                "last_run_counts": _last_run_counts,
                "total_upserts": _total_upserts,
                "embed_model": EMBED_MODEL,
            })
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/run":
            threading.Thread(target=run_incremental, daemon=True).start()
            self._json(202, {"status": "run_started"})
        else:
            self.send_response(404)
            self.end_headers()


def start_http_server():
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.allow_reuse_address = True
        log.info(f"Case Embedder Worker HTTP server on port {PORT}")
        httpd.serve_forever()


def _indexing_loop():
    time.sleep(10)  # wait for DB/Qdrant to be ready
    run_incremental()
    while True:
        time.sleep(REINDEX_INTERVAL)
        run_incremental()


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    log.info("Starting NDSEP Case Embedder Worker...")
    if "--once" in sys.argv:
        # Cron/Temporal-friendly single pass; exit code reflects hard failure.
        counts = run_incremental()
        print(json.dumps({"counts": counts, "errors": _errors}))
        sys.exit(0 if _errors == 0 else 1)
    threading.Thread(target=_indexing_loop, daemon=True).start()
    start_http_server()
