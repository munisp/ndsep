#!/usr/bin/env python3
"""
Adverse-Media / OSINT Intelligence Worker — NDSEP round 9 (FEAT-E)
==================================================================
Ingests configured news/RSS/breach-disclosure sources from the
``adverse_media_sources`` table (migration 0112), dedupes items by URL hash,
extracts mentioned registered-controller names from the organizations
registry (exact / alias / fuzzy with confidence), triages severity via the
ollama worker when OLLAMA_URL is configured (otherwise a deterministic
keyword classifier, explicitly labelled triage_method='keyword'), and writes
items + suggested entity matches back through the PostgREST DB API.

FAIL-LOUD POLICY (hard rule — no silent mocks):
  * ADVERSE_MEDIA_DB_API_URL unset        -> exit(2) at startup.
  * WORKER_AUTH_TOKEN unset outside dev   -> exit(2) at startup.
  * A source with no feed_url is skipped and reported 'UNCONFIGURED'
    (never silently substituted).
  * DB API unreachable after MAX_CONSECUTIVE_FAILURES poll cycles -> exit(3).

HTTP control surface (stdlib http.server):
  * GET  /health -> {"status": "ok", ...}   (unauthenticated, liveness only)
  * POST /run    -> trigger one ingest cycle (requires X-Worker-Auth header)

Stdlib + requests only. Port from env WORKER_PORT (default 8112).
"""

import hashlib
import json
import logging
import os
import re
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("adverse_media_worker")

# ─── Configuration (fail loud when absent) ───────────────────────────────────

DB_API_URL = os.environ.get("ADVERSE_MEDIA_DB_API_URL", "").rstrip("/")
WORKER_AUTH_TOKEN = os.environ.get("WORKER_AUTH_TOKEN", "")
ENVIRONMENT = os.environ.get("NDSEP_ENV", os.environ.get("NODE_ENV", "production")).lower()
WORKER_PORT = int(os.environ.get("WORKER_PORT", "8112"))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "").rstrip("/")  # optional NLP triage
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1")
POLL_INTERVAL_S = float(os.environ.get("ADVERSE_MEDIA_POLL_INTERVAL_S", "300"))
FETCH_TIMEOUT_S = float(os.environ.get("ADVERSE_MEDIA_FETCH_TIMEOUT_S", "20"))
MAX_CONSECUTIVE_FAILURES = int(os.environ.get("ADVERSE_MEDIA_MAX_FAILURES", "12"))
FUZZY_THRESHOLD = float(os.environ.get("ADVERSE_MEDIA_FUZZY_THRESHOLD", "0.6"))

SEVERITIES = ("critical", "high", "medium", "low", "info")
TRIAGE_LABELS = ("data_breach", "sanction", "lawsuit", "insolvency", "fraud", "other")


def validate_config() -> None:
    """Fail closed: refuse to run without a real DB API, and require the
    shared-secret token outside development."""
    if not DB_API_URL:
        logger.critical("FATAL: ADVERSE_MEDIA_DB_API_URL is not set — refusing to run "
                        "without a real DB API endpoint.")
        raise SystemExit(2)
    if not WORKER_AUTH_TOKEN and ENVIRONMENT not in ("development", "dev", "test"):
        logger.critical("FATAL: WORKER_AUTH_TOKEN is not set — refusing to run outside "
                        "development without the shared-secret control token.")
        raise SystemExit(2)


def check_auth(header_token: str | None) -> bool:
    """Shared-secret check. In dev with no token configured, allow (explicitly
    logged); everywhere else fail closed."""
    if not WORKER_AUTH_TOKEN:
        return ENVIRONMENT in ("development", "dev", "test")
    return bool(header_token) and header_token == WORKER_AUTH_TOKEN


# ─── URL normalisation + dedupe hash (mirror of adverseMediaLogic.ts) ────────

_TRACKING_RE = re.compile(r"^utm_|^fbclid$|^gclid$|^mc_cid$|^mc_eid$", re.IGNORECASE)


def normalize_url(raw: str) -> str:
    if not raw:
        return ""
    try:
        u = urlparse(raw.strip())
    except Exception:
        return ""
    if not u.scheme or not u.netloc:
        return ""
    q = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if not _TRACKING_RE.match(k)]
    path = u.path
    if len(path) > 1:
        path = path.rstrip("/")
    norm = urlunparse((u.scheme.lower(), u.netloc.lower(), path, u.params, urlencode(q), ""))
    return norm.rstrip("/")


def url_hash(url: str | None, title: str = "", published_at: str = "") -> str:
    norm = normalize_url(url) if url else ""
    anchor = norm or f"{title.strip().lower()}|{published_at}"
    return hashlib.sha256(anchor.encode("utf-8")).hexdigest()


# ─── Keyword severity classifier (explicit fallback; mirror of TS logic) ─────

KEYWORD_RULES = [
    ("data_breach", "critical", [
        r"\bdata breach\b", r"\bransomware\b", r"\bleaked\b", r"\bexfiltrat",
        r"\bpersonal data\b.*\b(exposed|stolen|compromised)\b",
    ]),
    ("sanction", "high", [
        r"\bsanction", r"\bregulator\b.*\bfine", r"\benforcement action\b", r"\bpenal(ty|ise|ised|ize|ized)\b",
    ]),
    ("lawsuit", "medium", [
        r"\blawsuit\b", r"\bsued\b", r"\bclass action\b", r"\bcourt\b.*\bdata protection\b",
    ]),
    ("insolvency", "medium", [
        r"\binsolven", r"\bbankrupt", r"\bliquidat", r"\breceivership\b",
    ]),
    ("fraud", "high", [
        r"\bfraud\b", r"\bscam\b", r"\bponzi\b", r"\bembezzl",
    ]),
]


def keyword_classify(text: str) -> dict:
    body = (text or "")[:20000]
    for label, severity, patterns in KEYWORD_RULES:
        hits = [p for p in patterns if re.search(p, body, re.IGNORECASE)]
        if hits:
            return {"label": label, "severity": severity, "method": "keyword", "matched_keywords": hits}
    return {"label": "other", "severity": "info", "method": "keyword", "matched_keywords": []}


def ollama_classify(text: str) -> dict | None:
    """NLP triage via ollama when configured. Returns None when ollama is not
    configured or fails — caller falls back to the keyword classifier and the
    triage_method label stays honest."""
    if not OLLAMA_URL:
        return None
    prompt = (
        "Classify this news item for a data-protection regulator's adverse-media feed. "
        "Reply with JSON only: {\"label\": one of " + ", ".join(TRIAGE_LABELS) +
        ", \"severity\": one of " + ", ".join(SEVERITIES) + "}.\n\nITEM:\n" + (text or "")[:4000]
    )
    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            timeout=30,
        )
        resp.raise_for_status()
        payload = json.loads(resp.json().get("response", "{}"))
        label = payload.get("label")
        severity = payload.get("severity")
        if label in TRIAGE_LABELS and severity in SEVERITIES:
            return {"label": label, "severity": severity, "method": "ollama", "matched_keywords": []}
        logger.warning("ollama returned out-of-vocabulary classification; falling back to keyword")
        return None
    except Exception as exc:  # noqa: BLE001 — fail over, never silently mislabel
        logger.warning("ollama triage failed (%s); falling back to keyword classifier", exc)
        return None


def triage(text: str) -> dict:
    return ollama_classify(text) or keyword_classify(text)


# ─── Entity matching (exact / alias / fuzzy; mirror of adverseMediaLogic.ts) ─

def normalise_name(name: str) -> str:
    n = unicodedata.normalize("NFKD", (name or "").lower())
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    n = re.sub(r"\b(ltd|limited|plc|llc|inc|ng|nigeria|company|co)\b", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def name_similarity(a: str, b: str) -> float:
    na, nb = normalise_name(a), normalise_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0

    def bigrams(s: str) -> dict:
        t = s.replace(" ", "")
        out: dict = {}
        for i in range(len(t) - 1):
            g = t[i:i + 2]
            out[g] = out.get(g, 0) + 1
        return out

    A, B = bigrams(na), bigrams(nb)
    overlap = sum(min(c, B.get(g, 0)) for g, c in A.items())
    total = len(na.replace(" ", "")) - 1 + len(nb.replace(" ", "")) - 1
    return 0.0 if total <= 0 else (2 * overlap) / total


def match_organizations(text: str, registry: list, fuzzy_threshold: float = FUZZY_THRESHOLD) -> list:
    body = normalise_name(text)
    if not body:
        return []
    out = []
    for entry in registry:
        norm = normalise_name(entry.get("name", ""))
        if not norm:
            continue
        if norm in body:
            out.append({"organization_id": entry["id"], "matched_name": entry["name"],
                        "match_method": "exact", "confidence": 1.0})
            continue
        alias_hit = next((a for a in entry.get("aliases", []) if normalise_name(a) and normalise_name(a) in body), None)
        if alias_hit:
            out.append({"organization_id": entry["id"], "matched_name": alias_hit,
                        "match_method": "alias", "confidence": 0.9})
            continue
        words = body.split(" ")
        nw = len(norm.split(" "))
        best = 0.0
        for i in range(0, len(words) - nw + 1):
            best = max(best, name_similarity(" ".join(words[i:i + nw]), norm))
        if best >= fuzzy_threshold:
            out.append({"organization_id": entry["id"], "matched_name": entry["name"],
                        "match_method": "fuzzy", "confidence": round(best, 3)})
    return sorted(out, key=lambda m: -m["confidence"])


# ─── RSS/Atom parsing (stdlib) ───────────────────────────────────────────────

def parse_feed(xml_bytes: bytes) -> list:
    """Parse RSS 2.0 or Atom into [{title, url, summary, published_at}]."""
    root = ET.fromstring(xml_bytes)
    items = []
    # RSS 2.0
    for item in root.findall(".//item"):
        def t(tag):
            el = item.find(tag)
            return (el.text or "").strip() if el is not None and el.text else ""
        items.append({
            "title": t("title"),
            "url": t("link"),
            "summary": t("description"),
            "published_at": t("pubDate"),
        })
    if items:
        return [i for i in items if i["title"]]
    # Atom
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for entry in root.findall(".//a:entry", ns):
        link = entry.find("a:link", ns)
        items.append({
            "title": (entry.findtext("a:title", default="", namespaces=ns) or "").strip(),
            "url": link.get("href", "") if link is not None else "",
            "summary": (entry.findtext("a:summary", default="", namespaces=ns) or "").strip(),
            "published_at": (entry.findtext("a:updated", default="", namespaces=ns) or "").strip(),
        })
    return [i for i in items if i["title"]]


def retention_expiry(fetched_at: datetime, retention_days: int) -> str:
    return (fetched_at + timedelta(days=retention_days)).isoformat()


# ─── DB API (PostgREST) access ───────────────────────────────────────────────

def db_get(path: str, params: dict | None = None) -> list:
    resp = requests.get(f"{DB_API_URL}{path}", params=params or {}, timeout=FETCH_TIMEOUT_S)
    resp.raise_for_status()
    return resp.json()


def db_post_ignore_duplicates(path: str, rows: list) -> int:
    if not rows:
        return 0
    resp = requests.post(
        f"{DB_API_URL}{path}",
        json=rows,
        headers={"Prefer": "resolution=ignore-duplicates,return=representation"},
        timeout=FETCH_TIMEOUT_S,
    )
    resp.raise_for_status()
    body = resp.json()
    return len(body) if isinstance(body, list) else 0


def db_patch_source(source_id: int, fields: dict) -> None:
    resp = requests.patch(
        f"{DB_API_URL}/adverse_media_sources?id=eq.{source_id}",
        json=fields,
        timeout=FETCH_TIMEOUT_S,
    )
    resp.raise_for_status()


def load_registry() -> list:
    return db_get("/organizations", {"select": "id,name", "limit": "5000"})


# ─── Ingest cycle ────────────────────────────────────────────────────────────

def ingest_cycle() -> dict:
    stats = {"sources_ok": 0, "sources_unconfigured": 0, "sources_failed": 0,
             "items_new": 0, "items_duplicate": 0, "matches_suggested": 0}
    sources = db_get("/adverse_media_sources", {"enabled": "is.true", "select": "*"})
    registry = load_registry()
    now = datetime.now(timezone.utc)

    for source in sources:
        feed_url = source.get("feed_url")
        if not feed_url:
            # Fail closed: never substitute a mock feed.
            stats["sources_unconfigured"] += 1
            db_patch_source(source["id"], {"last_status": "UNCONFIGURED",
                                           "last_error": "feed_url not configured"})
            continue
        try:
            resp = requests.get(feed_url, timeout=FETCH_TIMEOUT_S,
                                headers={"User-Agent": "ndsep-adverse-media/1.0"})
            resp.raise_for_status()
            entries = parse_feed(resp.content)
        except Exception as exc:  # noqa: BLE001
            stats["sources_failed"] += 1
            db_patch_source(source["id"], {"last_status": "fetch_error", "last_error": str(exc)[:500]})
            logger.warning("source %s fetch/parse failed: %s", source.get("source_key"), exc)
            continue

        rows = []
        for e in entries:
            tri = triage(f"{e['title']}\n{e.get('summary', '')}")
            rows.append({
                "source_id": source["id"],
                "url": normalize_url(e["url"]) or None,
                "url_hash": url_hash(e["url"], e["title"], e.get("published_at", "")),
                "title": e["title"][:512],
                "summary": (e.get("summary") or "")[:20000],
                "published_at": None,  # raw pub strings vary; parser keeps it simple
                "severity": tri["severity"],
                "triage_method": tri["method"],
                "triage_label": tri["label"],
                "retention_expires_at": retention_expiry(now, source.get("retention_days", 365)),
            })
        inserted = db_post_ignore_duplicates("/adverse_media_items", rows)
        stats["items_new"] += inserted
        stats["items_duplicate"] += len(rows) - inserted

        # Suggest entity matches for newly inserted items (re-select by hash).
        if rows and registry:
            hashes = [r["url_hash"] for r in rows]
            stored = db_get("/adverse_media_items",
                            {"select": "id,title,summary", "url_hash": f"in.({','.join(hashes)})"}) \
                if len(hashes) <= 50 else []
            match_rows = []
            for item in stored:
                for m in match_organizations(f"{item['title']} {item.get('summary') or ''}", registry)[:10]:
                    match_rows.append({
                        "item_id": item["id"],
                        "organization_id": m["organization_id"],
                        "matched_name": m["matched_name"][:256],
                        "match_method": m["match_method"],
                        "confidence": m["confidence"],
                    })
            stats["matches_suggested"] += db_post_ignore_duplicates("/adverse_media_entity_matches", match_rows)

        db_patch_source(source["id"], {"last_status": "ok", "last_error": None,
                                       "last_polled_at": now.isoformat()})
        stats["sources_ok"] += 1
    return stats


# ─── HTTP control surface (/health + authenticated /run) ─────────────────────

class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            self._json(200, {"status": "ok", "worker": "adverse_media",
                             "ollama_configured": bool(OLLAMA_URL),
                             "ts": datetime.now(timezone.utc).isoformat()})
        else:
            self._json(404, {"error": "not_found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/run":
            self._json(404, {"error": "not_found"})
            return
        if not check_auth(self.headers.get("X-Worker-Auth")):
            self._json(401, {"error": "unauthorized"})
            return
        try:
            self._json(200, {"status": "ok", "stats": ingest_cycle()})
        except Exception as exc:  # noqa: BLE001
            logger.exception("manual run failed")
            self._json(500, {"error": str(exc)[:500]})

    def log_message(self, fmt, *args):  # quiet access log
        logger.debug("http " + fmt, *args)


def main() -> None:
    validate_config()
    server = ThreadingHTTPServer(("0.0.0.0", WORKER_PORT), Handler)
    logger.info("adverse_media_worker listening on :%d (db_api=%s, ollama=%s)",
                WORKER_PORT, DB_API_URL, OLLAMA_URL or "UNCONFIGURED (keyword fallback)")

    import threading
    threading.Thread(target=server.serve_forever, daemon=True).start()

    failures = 0
    while True:
        try:
            stats = ingest_cycle()
            failures = 0
            logger.info("ingest cycle: %s", stats)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            logger.error("ingest cycle failed (%d/%d): %s", failures, MAX_CONSECUTIVE_FAILURES, exc)
            if failures >= MAX_CONSECUTIVE_FAILURES:
                logger.critical("DB/feed failures exceeded threshold — exiting for supervisor restart")
                raise SystemExit(3)
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
