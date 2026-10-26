#!/usr/bin/env python3
"""
GDELT + Live-News Adverse-Media Worker — NDSEP round 13 (P1.5)
==============================================================
Polls OSIRIS's GDELT events layer (GET {OSIRIS_URL}/api/gdelt — geocoded
global events) and its 23-broadcaster live-news layer
(GET {OSIRIS_URL}/api/news — broadcast headlines) and turns Nigeria-relevant
adverse items into adverse-media candidates:

  1. Fetch both sources (defensive parsing; mirrors server/osiris/gdeltClient.ts
     and server/osiris/newsClient.ts).
  2. Keep an event/headline only when it carries ADVERSE SIGNALS (data breach,
     outage, fraud, sanction, lawsuit, regulator, fine, hack — configurable
     keyword set, see OSIRIS_INTEL_EXTRA_KEYWORDS) AND is Nigeria-relevant:
       a. geolocated in Nigeria (GDELT lat/lng inside the NG bounding box, or
          country field naming Nigeria), OR
       b. naming a registered organization (exact / alias / fuzzy matching
          against the organizations registry, mirroring
          adverse_media_worker.py).
     Keyword-only items (adverse keywords but no NG geo and no entity match)
     are DROPPED. Confidence per item: geolocated+entity-match highest (0.9),
     entity-match-only medium (0.6), NG-geo-only low (0.5).
  3. Matched items are ingested via the EXISTING adverse-media path: rows in
     adverse_media_items under the seeded source_key='osiris_gdelt' /
     'osiris_news' sources (migration 0146) with the provenance URL, plus
     suggested adverse_media_entity_matches rows. The raw text is PII-redacted
     BEFORE persistence (keyed-HMAC masks for emails / MSISDN / NIN — same
     convention as case_embedder_worker.redact_pii).
  4. Dedup by source-native id: adverse_media_items.url_hash is derived from
     the source-native id, and osiris_intel_watermarks keeps per-source
     high-water marks (migration 0146).

FAIL-LOUD POLICY (same as adverse_media_worker.py):
  * GDELT_WATCH_DB_API_URL / ADVERSE_MEDIA_DB_API_URL unset -> exit(2).
  * WORKER_AUTH_TOKEN unset outside dev                       -> exit(2).
  * OSIRIS unreachable is NOT fatal: the affected source is skipped and
    retried (graceful degradation); only DB API failures count towards
    MAX_CONSECUTIVE_FAILURES -> exit(3).

HTTP control surface (stdlib http.server):
  * GET  /health -> liveness
  * GET  /status -> liveness + last-cycle stats
  * POST /run    -> trigger one poll cycle (requires X-Worker-Auth header;
                    optional JSON body {"sources": ["gdelt"|"news"]})

CLI: `--once` runs a single cycle and exits (no auth token required).
Stdlib + requests only. Port from env WORKER_PORT (default 8118).
"""

import argparse
import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("gdelt_adverse_media_worker")

# ─── Configuration (fail loud when absent) ───────────────────────────────────

DB_API_URL = os.environ.get(
    "GDELT_WATCH_DB_API_URL",
    os.environ.get("ADVERSE_MEDIA_DB_API_URL", ""),
).rstrip("/")
WORKER_AUTH_TOKEN = os.environ.get("WORKER_AUTH_TOKEN", "")
ENVIRONMENT = os.environ.get("NDSEP_ENV", os.environ.get("NODE_ENV", "production")).lower()
WORKER_PORT = int(os.environ.get("WORKER_PORT", "8118"))

OSIRIS_URL = os.environ.get("OSIRIS_URL", "https://osirisai.live").rstrip("/")
OSIRIS_SCANNER_KEY = os.environ.get("OSIRIS_SCANNER_KEY", "")
GDELT_COUNTRY_FILTER = os.environ.get("OSIRIS_GDELT_COUNTRY", "Nigeria")
GDELT_QUERY = os.environ.get("OSIRIS_GDELT_QUERY", "")
NEWS_QUERY = os.environ.get("OSIRIS_NEWS_QUERY", "")

POLL_INTERVAL_S = float(os.environ.get("OSIRIS_INTEL_POLL_INTERVAL_S", "300"))
FETCH_TIMEOUT_S = float(os.environ.get("OSIRIS_INTEL_FETCH_TIMEOUT_S", "20"))
MAX_CONSECUTIVE_FAILURES = int(os.environ.get("OSIRIS_INTEL_MAX_FAILURES", "12"))
FUZZY_THRESHOLD = float(os.environ.get("OSIRIS_INTEL_FUZZY_THRESHOLD", "0.6"))

SOURCE_KEY_GDELT = "osiris_gdelt"
SOURCE_KEY_NEWS = "osiris_news"
SOURCE_KEYS = (SOURCE_KEY_GDELT, SOURCE_KEY_NEWS)
SEVERITIES = ("critical", "high", "medium", "low", "info")

# Nigeria bounding box (approximate): lat 4.0–14.0, lng 2.6–15.0.
NG_LAT_MIN, NG_LAT_MAX = 4.0, 14.0
NG_LNG_MIN, NG_LNG_MAX = 2.6, 15.0


def validate_config() -> None:
    if not DB_API_URL:
        logger.critical("FATAL: GDELT_WATCH_DB_API_URL (or ADVERSE_MEDIA_DB_API_URL) "
                        "is not set — refusing to run without a real DB API endpoint.")
        raise SystemExit(2)
    if not WORKER_AUTH_TOKEN and ENVIRONMENT not in ("development", "dev", "test"):
        logger.critical("FATAL: WORKER_AUTH_TOKEN is not set — refusing to run outside "
                        "development without the shared-secret control token.")
        raise SystemExit(2)


def check_auth(header_token: str | None) -> bool:
    if not WORKER_AUTH_TOKEN:
        return ENVIRONMENT in ("development", "dev", "test")
    return bool(header_token) and hmac.compare_digest(header_token, WORKER_AUTH_TOKEN)


# ─── PII redaction (mirror of case_embedder_worker.redact_pii) ───────────────

PII_HMAC_KEY = os.environ.get("NDSEP_PII_HMAC_KEY", "")

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_NIN_RE = re.compile(r"(?<!\d)\d{11}(?!\d)")
_MSISDN_RE = re.compile(
    r"(?<![\w])(?:\+?234[\s\-]?[789][01]\d[\s\-]?\d{3}[\s\-]?\d{4}"
    r"|0[789][01]\d[\s\-]?\d{3}[\s\-]?\d{4}"
    r"|\+[1-9]\d{1,2}[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4})(?![\w])")


def _mask(value: str, kind: str) -> str:
    """Keyed-HMAC mask: irreversible, deterministic, non-enumerable."""
    digest = hmac.new(
        (PII_HMAC_KEY or "ndsep-osiris-intel-unkeyed").encode(),
        value.encode(), hashlib.sha256).hexdigest()[:12]
    return f"[{kind}:{digest}]"


def redact_pii(text: str | None) -> str:
    """Mask personal emails / phone numbers / 11-digit NIN-BVN runs with
    deterministic keyed-HMAC tokens. Raw substrings never survive; this runs
    BEFORE any persistence of item text."""
    if not text:
        return ""
    out = _EMAIL_RE.sub(lambda m: _mask(m.group(0), "email"), text)
    out = _MSISDN_RE.sub(lambda m: _mask(m.group(0), "phone"), out)
    out = _NIN_RE.sub(lambda m: _mask(m.group(0), "nin"), out)
    return out


# ─── OSIRIS fetchers (defensive; mirror gdeltClient.ts / newsClient.ts) ──────

def _osiris_get(path: str, params: dict) -> object | None:
    headers = {"Accept": "application/json"}
    if OSIRIS_SCANNER_KEY:
        headers["X-Scanner-Key"] = OSIRIS_SCANNER_KEY
    try:
        resp = requests.get(f"{OSIRIS_URL}{path}", params=params,
                            headers=headers, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:  # noqa: BLE001 — graceful degradation, never fatal
        logger.warning("OSIRIS %s fetch failed: %s", path, exc)
        return None


def _num(v: object) -> float | None:
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str) and v.strip():
        try:
            return float(v)
        except ValueError:
            return None
    return None


def normalize_event(raw: object) -> dict | None:
    """Narrow one raw GDELT event; None when irreducible fields (id, title)
    are unusable. Tolerates missing geo / ts / url / source / country /
    actors / tone (schema drift)."""
    if not isinstance(raw, dict):
        return None
    eid = raw.get("id") or raw.get("event_id") or raw.get("guid")
    if isinstance(eid, (int, float)):
        eid = str(int(eid))
    title = raw.get("title") or raw.get("headline") or raw.get("name")
    if not isinstance(eid, str) or not eid or not isinstance(title, str) or not title:
        return None
    actors = raw.get("actors")
    return {
        "id": eid,
        "title": title,
        "url": raw.get("url") if isinstance(raw.get("url"), str) else "",
        "source": raw.get("source") if isinstance(raw.get("source"), str) else "",
        "ts": raw.get("ts") if isinstance(raw.get("ts"), str) else "",
        "lat": _num(raw.get("lat")),
        "lng": _num(raw.get("lng") if raw.get("lng") is not None else raw.get("lon")),
        "country": raw.get("country") if isinstance(raw.get("country"), str) else "",
        "actors": [a for a in actors if isinstance(a, str)] if isinstance(actors, list) else [],
        "tone": _num(raw.get("tone")),
    }


def fetch_gdelt_events(country: str | None = None, query: str | None = None,
                       since: str | None = None) -> list | None:
    """GET {OSIRIS_URL}/api/gdelt. Returns a list of normalized events, or
    None on ANY failure (unreachable, non-OK, schema drift) — callers treat
    None as 'no event data this cycle'."""
    params = {}
    c = country if country is not None else GDELT_COUNTRY_FILTER
    q = query if query is not None else GDELT_QUERY
    if c:
        params["country"] = c
    if q:
        params["query"] = q
    if since:
        params["since"] = since
    payload = _osiris_get("/api/gdelt", params)
    if payload is None:
        return None
    raw_events = payload if isinstance(payload, list) else (
        payload.get("events") if isinstance(payload, dict) else None)
    if not isinstance(raw_events, list):
        logger.warning("OSIRIS gdelt payload missing events array — schema drift")
        return None
    events, dropped = [], 0
    for ev in raw_events:
        n = normalize_event(ev)
        if n:
            events.append(n)
        else:
            dropped += 1
    if dropped:
        logger.warning("gdelt: dropped %d unparseable events", dropped)
    return events


def normalize_headline(raw: object, channel: str) -> dict | None:
    """Narrow one raw broadcast headline; None when the irreducible field
    (title) is unusable."""
    if not isinstance(raw, dict):
        return None
    title = raw.get("title") or raw.get("headline") or raw.get("text")
    if not isinstance(title, str) or not title:
        return None
    ch = raw.get("channel") if isinstance(raw.get("channel"), str) else channel
    return {
        "channel": ch or "unknown",
        "title": title,
        "url": raw.get("url") if isinstance(raw.get("url"), str) else "",
        "ts": raw.get("ts") if isinstance(raw.get("ts"), str) else "",
    }


def headline_native_id(mention: dict) -> str:
    """Source-native dedupe key for broadcast headlines (which carry no id):
    sha256(channel|title|ts)."""
    anchor = f"{mention['channel']}|{mention['title']}|{mention['ts']}"
    return hashlib.sha256(anchor.encode("utf-8")).hexdigest()[:32]


def fetch_news_mentions(query: str | None = None) -> list | None:
    """GET {OSIRIS_URL}/api/news. Returns a flat list of normalized mentions
    {channel,title,url,ts}, or None on ANY failure. Tolerates the grouped
    {channels:[{name, headlines:[...]}]} shape, a flat {headlines:[...]},
    or a bare array (schema drift)."""
    params = {}
    q = query if query is not None else NEWS_QUERY
    if q:
        params["query"] = q
    payload = _osiris_get("/api/news", params)
    if payload is None:
        return None

    pairs: list = []  # (channel, raw_headline)
    if isinstance(payload, list):
        pairs = [("unknown", h) for h in payload]
    elif isinstance(payload, dict):
        groups = payload.get("channels") or payload.get("streams")
        if isinstance(groups, list):
            for ch in groups:
                if not isinstance(ch, dict):
                    continue
                name = ch.get("name") if isinstance(ch.get("name"), str) else "unknown"
                headlines = ch.get("headlines") or ch.get("items")
                if isinstance(headlines, list):
                    pairs.extend((name, h) for h in headlines)
        elif isinstance(payload.get("headlines"), list):
            pairs = [("unknown", h) for h in payload["headlines"]]
        else:
            logger.warning("OSIRIS news payload has no recognisable shape — schema drift")
            return None
    else:
        return None

    mentions, dropped = [], 0
    for channel, h in pairs:
        n = normalize_headline(h, channel)
        if n:
            mentions.append(n)
        else:
            dropped += 1
    if dropped:
        logger.warning("news: dropped %d unparseable headlines", dropped)
    return mentions


def parse_ts(ts: str) -> datetime | None:
    """Parse an ISO-8601-ish timestamp defensively; None when unparseable."""
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


def is_nigeria_geo(event: dict) -> bool:
    """True when the event is geolocated inside the Nigeria bounding box, or
    its country field names Nigeria."""
    country = (event.get("country") or "").strip().lower()
    if country in ("nigeria", "ng", "nga"):
        return True
    lat, lng = event.get("lat"), event.get("lng")
    if lat is None or lng is None:
        return False
    return NG_LAT_MIN <= lat <= NG_LAT_MAX and NG_LNG_MIN <= lng <= NG_LNG_MAX


# ─── Adverse-signal keyword classifier (configurable keyword set) ────────────

ADVERSE_KEYWORD_RULES = [
    ("data_breach", "critical", [
        r"\bdata\s*breach\b", r"\bransomware\b", r"\bleaked\b", r"\bexfiltrat",
        r"\bhack(ed|ers?)?\b", r"\bpersonal data\b.*\b(exposed|stolen|compromised)\b",
    ]),
    ("sanction", "high", [
        r"\bsanction", r"\bregulator\b", r"\bregulatory\b.*\b(action|order|ban)\b",
        r"\benforcement action\b", r"\bfine[sd]?\b", r"\bpenal(ty|ise|ised|ize|ized)\b",
    ]),
    ("fraud", "high", [
        r"\bfraud\b", r"\bscam\b", r"\bponzi\b", r"\bembezzl",
    ]),
    ("outage", "medium", [
        r"\boutage\b", r"\bservice disruption\b", r"\bsystem(s)? down\b",
        r"\bdowntime\b",
    ]),
    ("lawsuit", "medium", [
        r"\blawsuit\b", r"\bsued\b", r"\bclass action\b", r"\bcourt\b.*\bdata protection\b",
    ]),
]

# Configurable extra keywords: comma-separated, appended as a medium-severity
# 'custom' rule so deployments can broaden/narrow coverage without a rebuild.
_EXTRA_KEYWORDS = [k.strip() for k in os.environ.get("OSIRIS_INTEL_EXTRA_KEYWORDS", "").split(",") if k.strip()]
if _EXTRA_KEYWORDS:
    ADVERSE_KEYWORD_RULES.append(("custom", "medium", [re.escape(k) for k in _EXTRA_KEYWORDS]))


def keyword_adverse_score(text: str) -> dict:
    """Deterministic adverse-signal rules pass. Returns label/severity/hits."""
    body = (text or "")[:20000]
    for label, severity, patterns in ADVERSE_KEYWORD_RULES:
        hits = [p for p in patterns if re.search(p, body, re.IGNORECASE)]
        if hits:
            return {"is_adverse": True, "label": label, "severity": severity,
                    "matched_keywords": hits}
    return {"is_adverse": False, "label": "other", "severity": "info",
            "matched_keywords": []}


# ─── Entity matching (mirror of adverse_media_worker.py) ─────────────────────

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


def match_organizations(text: str, registry: list,
                        fuzzy_threshold: float = FUZZY_THRESHOLD) -> list:
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
        alias_hit = next(
            (a for a in entry.get("aliases", []) or []
             if normalise_name(a) and normalise_name(a) in body), None)
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


# Confidence tiers: geolocated+entity-match highest; entity-match-only medium;
# NG-geo-only low; keyword-only dropped (no Nigeria relevance).
CONFIDENCE_GEO_AND_ENTITY = 0.9
CONFIDENCE_ENTITY_ONLY = 0.6
CONFIDENCE_GEO_ONLY = 0.5


def classify_item(text: str, ng_geo: bool, registry: list) -> dict:
    """Adverse-signal classifier. An item is a candidate ONLY when it carries
    adverse keywords AND is Nigeria-relevant (NG geolocation OR a registered
    organization mention). Keyword-only items are dropped."""
    rules = keyword_adverse_score(text)
    orgs = match_organizations(text, registry) if rules["is_adverse"] else []

    result = {
        "matched_keywords": rules["matched_keywords"],
        "triage_label": rules["label"],
        "severity": rules["severity"] if rules["is_adverse"] else "info",
        "entities": orgs[:10],
        "ng_geo": bool(ng_geo),
        "method": "keyword",
        "is_signal": False,
        "confidence": 0.0,
        "confidence_tier": "dropped",
    }
    if not rules["is_adverse"]:
        return result
    if ng_geo and orgs:
        result.update(is_signal=True, confidence=CONFIDENCE_GEO_AND_ENTITY,
                      confidence_tier="geo+entity")
    elif orgs:
        result.update(is_signal=True, confidence=CONFIDENCE_ENTITY_ONLY,
                      confidence_tier="entity")
    elif ng_geo:
        result.update(is_signal=True, confidence=CONFIDENCE_GEO_ONLY,
                      confidence_tier="geo")
    # else: keyword-only — dropped.
    return result


# ─── DB API (PostgREST) access ───────────────────────────────────────────────

def db_get(path: str, params: dict | None = None) -> list:
    resp = requests.get(f"{DB_API_URL}{path}", params=params or {}, timeout=FETCH_TIMEOUT_S)
    resp.raise_for_status()
    return resp.json()


def db_post_ignore_duplicates(path: str, rows: list) -> list:
    if not rows:
        return []
    resp = requests.post(
        f"{DB_API_URL}{path}",
        json=rows,
        headers={"Prefer": "resolution=ignore-duplicates,return=representation"},
        timeout=FETCH_TIMEOUT_S,
    )
    resp.raise_for_status()
    body = resp.json()
    return body if isinstance(body, list) else []


def db_upsert(path: str, rows: list, on_conflict: str) -> None:
    resp = requests.post(
        f"{DB_API_URL}{path}?on_conflict={on_conflict}",
        json=rows,
        headers={"Prefer": "resolution=merge-duplicates"},
        timeout=FETCH_TIMEOUT_S,
    )
    resp.raise_for_status()


def db_patch_source(source_id: int, fields: dict) -> None:
    resp = requests.patch(
        f"{DB_API_URL}/adverse_media_sources?id=eq.{source_id}",
        json=fields,
        timeout=FETCH_TIMEOUT_S,
    )
    resp.raise_for_status()


_SOURCE_SEEDS = {
    SOURCE_KEY_GDELT: {
        "name": "OSIRIS GDELT geocoded events feed",
        "feed": "osiris:/api/gdelt",
    },
    SOURCE_KEY_NEWS: {
        "name": "OSIRIS 23-broadcaster live-news feed",
        "feed": "osiris:/api/news",
    },
}


def ensure_source(source_key: str) -> int:
    """Return the id of the seeded adverse-media source row (migration 0146).
    Creates it if the migration seed is absent."""
    rows = db_get("/adverse_media_sources", {"source_key": f"eq.{source_key}", "select": "id"})
    if rows:
        return rows[0]["id"]
    seed = _SOURCE_SEEDS[source_key]
    db_post_ignore_duplicates("/adverse_media_sources", [{
        "source_key": source_key,
        "name": seed["name"],
        "source_type": "news_api",
        "enabled": False,
        "created_by": "gdelt_adverse_media_worker",
        "config": {"managed_by": "gdelt_adverse_media_worker", "feed": seed["feed"]},
    }])
    rows = db_get("/adverse_media_sources", {"source_key": f"eq.{source_key}", "select": "id"})
    if not rows:
        raise RuntimeError(f"failed to ensure {source_key} adverse_media_sources row")
    return rows[0]["id"]


def load_registry() -> list:
    return db_get("/organizations", {"select": "id,name", "limit": "5000"})


def load_watermarks() -> dict:
    rows = db_get("/osiris_intel_watermarks", {"select": "source,last_seen_id"})
    return {r["source"]: r.get("last_seen_id") for r in rows}


def item_hash(source_key: str, native_id: str) -> str:
    """Dedupe key derived from the source-native id (never the raw text)."""
    return hashlib.sha256(f"{source_key}://{native_id}".encode("utf-8")).hexdigest()


def retention_expiry(fetched_at: datetime, retention_days: int) -> str:
    return (fetched_at + timedelta(days=retention_days)).isoformat()


# ─── Poll cycle ──────────────────────────────────────────────────────────────

def _source_retention_days(source_id: int) -> int:
    rows = db_get("/adverse_media_sources",
                  {"id": f"eq.{source_id}", "select": "retention_days"})
    if rows and rows[0].get("retention_days"):
        return rows[0]["retention_days"]
    return 365


def _ingest_classified(source_key: str, source_id: int, classified: list,
                       registry_unused: None, now: datetime,
                       retention_days: int) -> dict:
    """Ingest classified items via the existing adverse-media path:
    adverse_media_items rows (deduped by source-native-id hash) plus
    suggested adverse_media_entity_matches. classified entries are
    (native_id, title, url, ts_dt, redacted_text, result)."""
    stats = {"items_ingested": 0, "matches_suggested": 0}
    am_rows = []
    for native_id, title, url, ts_dt, redacted, result in classified:
        am_rows.append({
            "source_id": source_id,
            "url": url or None,
            "url_hash": item_hash(source_key, native_id),
            "title": f"[{source_key}] {redacted.split(chr(10), 1)[0][:120] or title[:120]}"[:512],
            "summary": redacted[:20000],
            "published_at": ts_dt.isoformat() if ts_dt else None,
            "severity": result["severity"] if result["severity"] in SEVERITIES else "medium",
            "triage_method": "keyword",
            "triage_label": result["triage_label"],
            "retention_expires_at": retention_expiry(now, retention_days),
        })
    stats["items_ingested"] = len(db_post_ignore_duplicates("/adverse_media_items", am_rows))

    if am_rows:
        hashes = [r["url_hash"] for r in am_rows]
        stored = db_get("/adverse_media_items",
                        {"select": "id,url_hash",
                         "url_hash": f"in.({','.join(hashes)})"}) if len(hashes) <= 50 else []
        by_hash = {r["url_hash"]: r["id"] for r in stored}
        match_rows = []
        for (native_id, _t, _u, _ts, _r, result) in classified:
            item_id = by_hash.get(item_hash(source_key, native_id))
            if not item_id:
                continue
            for m in result["entities"][:10]:
                match_rows.append({
                    "item_id": item_id,
                    "organization_id": m["organization_id"],
                    "matched_name": m["matched_name"][:256],
                    "match_method": m["match_method"],
                    "confidence": m["confidence"],
                })
        stats["matches_suggested"] = len(
            db_post_ignore_duplicates("/adverse_media_entity_matches", match_rows))
    return stats


def poll_cycle(sources: list | None = None) -> dict:
    """One poll cycle over the requested sources (default: both). Returns
    per-source stats; OSIRIS failures degrade gracefully (source skipped)."""
    wanted = sources or list(SOURCE_KEYS)
    stats = {
        "sources": {},
        "gdelt_ok": False, "news_ok": False,
        "items_ingested": 0, "matches_suggested": 0,
    }
    now = datetime.now(timezone.utc)
    watermarks = load_watermarks()

    gdelt_events = news_mentions = None
    if SOURCE_KEY_GDELT in wanted:
        gdelt_events = fetch_gdelt_events()
        stats["gdelt_ok"] = gdelt_events is not None
    if SOURCE_KEY_NEWS in wanted:
        news_mentions = fetch_news_mentions()
        stats["news_ok"] = news_mentions is not None
    if gdelt_events is None and news_mentions is None:
        # Both sources unavailable (or none requested produced data) — degrade
        # gracefully; this does not consume the DB-failure budget.
        return stats

    registry = load_registry()
    wm_rows = []

    # ── GDELT events ──
    if gdelt_events is not None:
        source_id = ensure_source(SOURCE_KEY_GDELT)
        retention_days = _source_retention_days(source_id)
        seen = classified = None
        classified = []
        seen_ids = set()
        latest: tuple = (None, None)  # (ts_dt, native_id) high-water candidate
        for ev in gdelt_events:
            if ev["id"] in seen_ids:
                continue
            seen_ids.add(ev["id"])
            if watermarks.get(SOURCE_KEY_GDELT) and ev["id"] == watermarks[SOURCE_KEY_GDELT]:
                continue  # already ingested in a previous cycle
            text = " ".join([ev["title"], ev.get("source") or "",
                             " ".join(ev.get("actors") or [])])
            ts_dt = parse_ts(ev.get("ts", ""))
            if ts_dt and (latest[0] is None or ts_dt > latest[0]):
                latest = (ts_dt, ev["id"])
            result = classify_item(text, is_nigeria_geo(ev), registry)
            if not result["is_signal"]:
                continue
            redacted = redact_pii(text)
            classified.append((ev["id"], ev["title"], ev.get("url") or "", ts_dt,
                               redacted, result))
        ing = _ingest_classified(SOURCE_KEY_GDELT, source_id, classified, None,
                                 now, retention_days)
        stats["items_ingested"] += ing["items_ingested"]
        stats["matches_suggested"] += ing["matches_suggested"]
        stats["sources"][SOURCE_KEY_GDELT] = {
            "events_seen": len(gdelt_events), "candidates": len(classified),
            **ing,
        }
        wm_rows.append({
            "source": SOURCE_KEY_GDELT,
            "last_seen_id": latest[1] or watermarks.get(SOURCE_KEY_GDELT),
            "last_run_at": now.isoformat(),
            "stats": stats["sources"][SOURCE_KEY_GDELT],
        })
        db_patch_source(source_id, {"last_status": "ok", "last_error": None,
                                    "last_polled_at": now.isoformat()})

    # ── Live-news broadcast mentions ──
    if news_mentions is not None:
        source_id = ensure_source(SOURCE_KEY_NEWS)
        retention_days = _source_retention_days(source_id)
        classified = []
        seen_ids = set()
        latest = (None, None)
        for m in news_mentions:
            native_id = headline_native_id(m)
            if native_id in seen_ids:
                continue
            seen_ids.add(native_id)
            if watermarks.get(SOURCE_KEY_NEWS) and native_id == watermarks[SOURCE_KEY_NEWS]:
                continue
            ts_dt = parse_ts(m.get("ts", ""))
            if ts_dt and (latest[0] is None or ts_dt > latest[0]):
                latest = (ts_dt, native_id)
            # Broadcast headlines carry no geocode — Nigeria relevance comes
            # from the entity match alone (ng_geo=False).
            result = classify_item(m["title"], False, registry)
            if not result["is_signal"]:
                continue
            redacted = redact_pii(m["title"])
            classified.append((native_id, m["title"], m.get("url") or "", ts_dt,
                               redacted, result))
        ing = _ingest_classified(SOURCE_KEY_NEWS, source_id, classified, None,
                                 now, retention_days)
        stats["items_ingested"] += ing["items_ingested"]
        stats["matches_suggested"] += ing["matches_suggested"]
        stats["sources"][SOURCE_KEY_NEWS] = {
            "mentions_seen": len(news_mentions), "candidates": len(classified),
            **ing,
        }
        wm_rows.append({
            "source": SOURCE_KEY_NEWS,
            "last_seen_id": latest[1] or watermarks.get(SOURCE_KEY_NEWS),
            "last_run_at": now.isoformat(),
            "stats": stats["sources"][SOURCE_KEY_NEWS],
        })
        db_patch_source(source_id, {"last_status": "ok", "last_error": None,
                                    "last_polled_at": now.isoformat()})

    if wm_rows:
        db_upsert("/osiris_intel_watermarks", wm_rows, "source")
    return stats


# ─── HTTP control surface (/health + /status + authenticated /run) ───────────

_last_stats: dict = {}


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
            self._json(200, {"status": "ok", "worker": "gdelt_adverse_media",
                             "ts": datetime.now(timezone.utc).isoformat()})
        elif self.path == "/status":
            self._json(200, {"status": "ok", "worker": "gdelt_adverse_media",
                             "sources": list(SOURCE_KEYS),
                             "extra_keywords": _EXTRA_KEYWORDS,
                             "last_stats": _last_stats,
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
        sources = None
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                if isinstance(body, dict) and isinstance(body.get("sources"), list):
                    sources = [s for s in body["sources"] if s in SOURCE_KEYS]
        except Exception:  # noqa: BLE001 — malformed body = run everything
            sources = None
        try:
            stats = poll_cycle(sources=sources)
            _last_stats.clear()
            _last_stats.update(stats)
            self._json(200, {"status": "ok", "stats": stats})
        except Exception as exc:  # noqa: BLE001
            logger.exception("manual run failed")
            self._json(500, {"error": str(exc)[:500]})

    def log_message(self, fmt, *args):  # quiet access log
        logger.debug("http " + fmt, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description="GDELT + live-news adverse-media worker")
    parser.add_argument("--once", action="store_true",
                        help="run a single poll cycle and exit (no auth token required)")
    args = parser.parse_args()

    if not DB_API_URL:
        logger.critical("FATAL: GDELT_WATCH_DB_API_URL (or ADVERSE_MEDIA_DB_API_URL) "
                        "is not set — refusing to run without a real DB API endpoint.")
        raise SystemExit(2)

    if args.once:
        stats = poll_cycle()
        print(json.dumps({"status": "ok", "stats": stats}))
        return

    validate_config()
    server = ThreadingHTTPServer(("0.0.0.0", WORKER_PORT), Handler)
    logger.info("gdelt_adverse_media_worker listening on :%d (db_api=%s, osiris=%s)",
                WORKER_PORT, DB_API_URL, OSIRIS_URL)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    failures = 0
    while True:
        try:
            stats = poll_cycle()
            _last_stats.clear()
            _last_stats.update(stats)
            if not stats.get("gdelt_ok") and not stats.get("news_ok"):
                # OSIRIS degraded — do not count against DB failure budget.
                logger.warning("poll cycle skipped: OSIRIS sources unavailable")
            failures = 0
            logger.info("poll cycle: %s", stats)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            logger.error("poll cycle failed (%d/%d): %s", failures, MAX_CONSECUTIVE_FAILURES, exc)
            if failures >= MAX_CONSECUTIVE_FAILURES:
                logger.critical("DB failures exceeded threshold — exiting for supervisor restart")
                raise SystemExit(3)
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
