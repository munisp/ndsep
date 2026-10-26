#!/usr/bin/env python3
"""
Telegram Breach Watch Worker — NDSEP round 13 (P0.1)
====================================================
Polls OSIRIS's Telegram OSINT layer (GET {OSIRIS_URL}/api/telegram-feed —
public-channel posts scraped from t.me/s/<channel> previews, geoparsed) and
turns breach-signal posts into adverse-media candidate items:

  1. Fetch the feed (defensive parsing; mirrors server/osiris/telegramClient.ts).
  2. Classify each post through a breach-signal classifier:
       a. keyword/regex rules for breach/ransom/leak/hack AND Nigerian entity
          mentions (matched against the organizations registry — names/aliases);
       b. ambiguous posts (breach keywords but no entity, or entity but weak
          keywords) are optionally confirmed by ollama (/classify, with the
          /api/generate JSON prompt as fallback). FAIL-CLOSED: when the LLM is
          unreachable the rules-only verdict stands and the classifier method
          is labelled 'keyword'.
  3. Matched posts are ingested via the EXISTING adverse-media path: a row in
     adverse_media_items under the seeded source_key='osiris_telegram' source
     (migration 0141) with the t.me provenance URL, plus suggested
     adverse_media_entity_matches rows. The raw text is PII-redacted BEFORE
     persistence (keyed-HMAC masks for emails / MSISDN / NIN — same
     convention as case_embedder_worker.redact_pii).
  4. Dedup by post id: telegram_watch_items has UNIQUE(channel, post_id).
  5. Breach-lag detector: when a matched post names an entity and no breach
     self-report (breach_incidents row) exists within 72h of the post
     timestamp, emit a breach_lag_signals row
     (signal_type='breach_notification_overdue', deadline = post_ts + 72h).
  6. Per-channel watermarks in telegram_watch_watermarks.

FAIL-LOUD POLICY (same as adverse_media_worker.py):
  * TELEGRAM_WATCH_DB_API_URL / ADVERSE_MEDIA_DB_API_URL unset -> exit(2).
  * WORKER_AUTH_TOKEN unset outside dev                       -> exit(2).
  * OSIRIS unreachable is NOT fatal: the cycle is skipped and retried
    (graceful degradation); only DB API failures count towards
    MAX_CONSECUTIVE_FAILURES -> exit(3).

HTTP control surface (stdlib http.server):
  * GET  /health -> liveness
  * GET  /status -> liveness + last-cycle stats
  * POST /run    -> trigger one watch cycle (requires X-Worker-Auth header)

CLI: `--once` runs a single cycle and exits (no auth token required).
Stdlib + requests only. Port from env WORKER_PORT (default 8117).
"""

import argparse
import hashlib
import hmac
import json
import logging
import os
import re
import sys
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
logger = logging.getLogger("telegram_breach_watch_worker")

# ─── Configuration (fail loud when absent) ───────────────────────────────────

DB_API_URL = os.environ.get(
    "TELEGRAM_WATCH_DB_API_URL",
    os.environ.get("ADVERSE_MEDIA_DB_API_URL", ""),
).rstrip("/")
WORKER_AUTH_TOKEN = os.environ.get("WORKER_AUTH_TOKEN", "")
ENVIRONMENT = os.environ.get("NDSEP_ENV", os.environ.get("NODE_ENV", "production")).lower()
WORKER_PORT = int(os.environ.get("WORKER_PORT", "8117"))

OSIRIS_URL = os.environ.get("OSIRIS_URL", "https://osirisai.live").rstrip("/")
OSIRIS_SCANNER_KEY = os.environ.get("OSIRIS_SCANNER_KEY", "")
DEFAULT_CHANNELS = [
    c.strip().lstrip("@") for c in os.environ.get("OSIRIS_TELEGRAM_CHANNELS", "").split(",")
    if c.strip()
]

OLLAMA_URL = os.environ.get("OLLAMA_URL", "").rstrip("/")  # optional confirmation
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1")

POLL_INTERVAL_S = float(os.environ.get("TELEGRAM_WATCH_POLL_INTERVAL_S", "300"))
FETCH_TIMEOUT_S = float(os.environ.get("TELEGRAM_WATCH_FETCH_TIMEOUT_S", "20"))
MAX_CONSECUTIVE_FAILURES = int(os.environ.get("TELEGRAM_WATCH_MAX_FAILURES", "12"))
FUZZY_THRESHOLD = float(os.environ.get("TELEGRAM_WATCH_FUZZY_THRESHOLD", "0.6"))
BREACH_LAG_WINDOW_HOURS = int(os.environ.get("BREACH_LAG_WINDOW_HOURS", "72"))

SOURCE_KEY = "osiris_telegram"
SEVERITIES = ("critical", "high", "medium", "low", "info")


def validate_config() -> None:
    if not DB_API_URL:
        logger.critical("FATAL: TELEGRAM_WATCH_DB_API_URL (or ADVERSE_MEDIA_DB_API_URL) "
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
        (PII_HMAC_KEY or "ndsep-telegram-watch-unkeyed").encode(),
        value.encode(), hashlib.sha256).hexdigest()[:12]
    return f"[{kind}:{digest}]"


def redact_pii(text: str | None) -> str:
    """Mask personal emails / phone numbers / 11-digit NIN-BVN runs with
    deterministic keyed-HMAC tokens. Raw substrings never survive; this runs
    BEFORE any persistence of post text."""
    if not text:
        return ""
    out = _EMAIL_RE.sub(lambda m: _mask(m.group(0), "email"), text)
    out = _MSISDN_RE.sub(lambda m: _mask(m.group(0), "phone"), out)
    out = _NIN_RE.sub(lambda m: _mask(m.group(0), "nin"), out)
    return out


# ─── Feed parsing (defensive; mirror of server/osiris/telegramClient.ts) ─────

def normalize_post(raw: object) -> dict | None:
    """Narrow one raw post; None when irreducible fields (id, text) are
    unusable. Tolerates missing geo / ts / url / channel (schema drift)."""
    if not isinstance(raw, dict):
        return None
    pid = raw.get("id")
    if isinstance(pid, (int, float)):
        pid = str(int(pid))
    text = raw.get("text") or raw.get("message") or raw.get("content")
    if not isinstance(pid, str) or not pid or not isinstance(text, str) or not text:
        return None

    geo = None
    g = raw.get("geo")
    if isinstance(g, dict) and isinstance(g.get("lat"), (int, float)) \
            and isinstance(g.get("lng"), (int, float)):
        geo = {"lat": float(g["lat"]), "lng": float(g["lng"]),
               "place": g.get("place") if isinstance(g.get("place"), str) else None}

    channel = raw.get("channel") if isinstance(raw.get("channel"), str) else "unknown"
    url = raw.get("url") if isinstance(raw.get("url"), str) else ""
    if not url and channel != "unknown":
        url = f"https://t.me/s/{channel}/{pid}"

    ts_raw = raw.get("ts") or raw.get("timestamp") or raw.get("date") or ""
    return {
        "id": pid,
        "channel": channel,
        "text": text,
        "ts": ts_raw if isinstance(ts_raw, str) else "",
        "geo": geo,
        "url": url,
    }


def parse_post_ts(ts: str) -> datetime | None:
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


def fetch_feed(channels: list | None = None, since: str | None = None) -> list | None:
    """GET {OSIRIS_URL}/api/telegram-feed. Returns a list of normalized posts,
    or None on ANY failure (unreachable, non-OK, schema drift) — callers treat
    None as 'no feed data this cycle'."""
    params = {}
    ch = channels if channels else DEFAULT_CHANNELS
    if ch:
        params["channels"] = ",".join(ch)
    if since:
        params["since"] = since
    headers = {"Accept": "application/json"}
    if OSIRIS_SCANNER_KEY:
        headers["X-Scanner-Key"] = OSIRIS_SCANNER_KEY
    try:
        resp = requests.get(f"{OSIRIS_URL}/api/telegram-feed", params=params,
                            headers=headers, timeout=10)
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001 — graceful degradation, never fatal
        logger.warning("OSIRIS telegram-feed fetch failed: %s", exc)
        return None
    raw_posts = payload if isinstance(payload, list) else payload.get("posts")
    if not isinstance(raw_posts, list):
        logger.warning("OSIRIS telegram-feed payload missing posts array — schema drift")
        return None
    posts, dropped = [], 0
    for p in raw_posts:
        n = normalize_post(p)
        if n:
            posts.append(n)
        else:
            dropped += 1
    if dropped:
        logger.warning("telegram-feed: dropped %d unparseable posts", dropped)
    return posts


# ─── Breach-signal classifier ────────────────────────────────────────────────

BREACH_KEYWORD_RULES = [
    ("critical", [
        r"\bdata\s*breach\b", r"\bransomware\b", r"\bransom\b.*\bpaid\b",
        r"\bdatabase\b.*\b(dump|leak|exposed|stolen)\b",
        r"\b\d[\d,\s]*\s*(records|customers|subscribers|users)\b.*\b(leaked|exposed|stolen|breached)\b",
        r"\bpersonal data\b.*\b(exposed|stolen|compromised|leaked)\b",
    ]),
    ("high", [
        r"\bhack(ed|ers?)?\b", r"\bbreach\b", r"\bleak(ed|s)?\b", r"\bexfiltrat",
        r"\bcompromised\b", r"\bunauthorized access\b", r"\bcyber\s*attack\b",
        r"\bdata\s*theft\b", r"\bdark\s*web\b.*\b(sale|selling|dump)\b",
    ]),
    ("medium", [
        r"\bsecurity incident\b", r"\bvulnerabilit", r"\bexploit(ed)?\b",
        r"\bdefaced\b", r"\bddos\b",
    ]),
]


def keyword_breach_score(text: str) -> dict:
    """Deterministic rules pass. Returns severity + matched patterns."""
    body = (text or "")[:20000]
    for severity, patterns in BREACH_KEYWORD_RULES:
        hits = [p for p in patterns if re.search(p, body, re.IGNORECASE)]
        if hits:
            return {"is_breach": True, "severity": severity, "matched_keywords": hits}
    return {"is_breach": False, "severity": "info", "matched_keywords": []}


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


def ollama_confirm(text: str) -> bool | None:
    """Optional LLM confirmation for ambiguous posts. Returns True/False when
    ollama answered in-vocabulary, None when unconfigured/unreachable —
    callers FAIL CLOSED to the rules-only verdict."""
    if not OLLAMA_URL:
        return None
    # Preferred: dedicated /classify endpoint.
    try:
        resp = requests.post(
            f"{OLLAMA_URL}/classify",
            json={"model": OLLAMA_MODEL, "text": (text or "")[:4000]},
            timeout=30,
        )
        if resp.ok:
            payload = resp.json()
            verdict = str(payload.get("verdict", payload.get("label", ""))).lower()
            if verdict in ("breach", "true", "yes", "data_breach"):
                return True
            if verdict in ("not_breach", "false", "no", "other", "benign"):
                return False
    except Exception as exc:  # noqa: BLE001
        logger.warning("ollama /classify failed (%s); trying /api/generate", exc)
    # Fallback: /api/generate JSON prompt (adverse_media_worker convention).
    try:
        prompt = (
            "You are classifying Telegram posts for a data-protection regulator. "
            "Reply with JSON only: {\"verdict\": \"breach\" or \"not_breach\"}. "
            "'breach' means the post credibly claims a data breach, ransomware, "
            "hack, or leak of an organisation's data.\n\nPOST:\n" + (text or "")[:4000]
        )
        resp = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            timeout=30,
        )
        resp.raise_for_status()
        payload = json.loads(resp.json().get("response", "{}"))
        verdict = str(payload.get("verdict", "")).lower()
        if verdict == "breach":
            return True
        if verdict == "not_breach":
            return False
        logger.warning("ollama returned out-of-vocabulary verdict; failing closed")
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("ollama confirmation unreachable (%s); failing closed to rules", exc)
        return None


def classify_post(post: dict, registry: list) -> dict:
    """Breach-signal classifier. A post is a breach signal when it carries
    breach keywords AND names a registered Nigerian entity. Ambiguous posts
    (exactly one of the two signals present) go through optional ollama
    confirmation; when the LLM is unreachable the rules-only verdict stands
    (fail-closed) and method stays 'keyword'."""
    text = post.get("text") or ""
    rules = keyword_breach_score(text)
    orgs = match_organizations(text, registry)

    result = {
        "matched_keywords": rules["matched_keywords"],
        "severity": rules["severity"] if rules["is_breach"] else "info",
        "entities": orgs[:10],
        "method": "keyword",
        "is_signal": False,
        "ambiguous": False,
    }
    if rules["is_breach"] and orgs:
        result["is_signal"] = True
        return result
    if not rules["is_breach"] and not orgs:
        return result

    # Ambiguous: one signal present, the other absent.
    result["ambiguous"] = True
    verdict = ollama_confirm(text)
    if verdict is None:
        # Fail closed: rules-only. Breach keywords alone still surface the
        # post (early warning) but at one severity notch lower confidence;
        # entity-only mentions are NOT breach signals.
        result["is_signal"] = rules["is_breach"]
        if result["is_signal"] and result["severity"] in ("critical", "high"):
            result["severity"] = "high" if result["severity"] == "critical" else "medium"
        return result
    result["method"] = "ollama"
    result["is_signal"] = bool(verdict)
    if not verdict:
        result["severity"] = "info"
    elif result["severity"] == "info":
        result["severity"] = "medium"
    return result


# ─── Breach-lag detector ─────────────────────────────────────────────────────

def detect_breach_lag(post_ts: datetime | None, org_incidents: list,
                      now: datetime | None = None,
                      window_hours: int = BREACH_LAG_WINDOW_HOURS) -> dict | None:
    """Returns a breach_notification_overdue signal descriptor when the post
    is older than the 72h NDPA notification window and NO breach self-report
    (breach_incidents row for the org) exists within +/- window of the post
    timestamp. Pure function — incidents are supplied by the caller."""
    if post_ts is None:
        return None
    now = now or datetime.now(timezone.utc)
    deadline = post_ts + timedelta(hours=window_hours)
    if now <= deadline:
        return None  # window still open — not yet overdue
    window_start = post_ts - timedelta(hours=window_hours)
    for inc in org_incidents:
        for field in ("created_at", "detected_at", "ndpc_notified_at"):
            ts = parse_post_ts(str(inc.get(field) or ""))
            if ts and window_start <= ts <= deadline:
                return None  # self-report exists within the window
    return {
        "signal_type": "breach_notification_overdue",
        "post_ts": post_ts.isoformat(),
        "notification_deadline": deadline.isoformat(),
    }


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


def ensure_source() -> int:
    """Return the id of the seeded source_key='osiris_telegram' adverse-media
    source (migration 0141). Creates it if the migration seed is absent."""
    rows = db_get("/adverse_media_sources", {"source_key": f"eq.{SOURCE_KEY}", "select": "id"})
    if rows:
        return rows[0]["id"]
    created = db_post_ignore_duplicates("/adverse_media_sources", [{
        "source_key": SOURCE_KEY,
        "name": "OSIRIS Telegram breach early-warning feed",
        "source_type": "breach_disclosure",
        "enabled": False,
        "created_by": "telegram_breach_watch_worker",
        "config": {"managed_by": "telegram_breach_watch_worker",
                   "feed": "osiris:/api/telegram-feed"},
    }])
    rows = db_get("/adverse_media_sources", {"source_key": f"eq.{SOURCE_KEY}", "select": "id"})
    if not rows:
        raise RuntimeError("failed to ensure osiris_telegram adverse_media_sources row")
    return rows[0]["id"]


def load_registry() -> list:
    return db_get("/organizations", {"select": "id,name", "limit": "5000"})


def load_watermarks() -> dict:
    rows = db_get("/telegram_watch_watermarks", {"select": "channel,last_post_ts"})
    return {r["channel"]: r.get("last_post_ts") for r in rows}


def load_org_incidents(org_id: int, window_start: datetime, window_end: datetime) -> list:
    return db_get("/breach_incidents", {
        "select": "id,created_at,detected_at,ndpc_notified_at",
        "organization_id": f"eq.{org_id}",
        "created_at": f"gte.{window_start.isoformat()}",
    })


def item_hash(channel: str, post_id: str) -> str:
    return hashlib.sha256(f"telegram://{channel}/{post_id}".encode("utf-8")).hexdigest()


# ─── Watch cycle ─────────────────────────────────────────────────────────────

def watch_cycle(channels: list | None = None) -> dict:
    stats = {"posts_seen": 0, "signals_new": 0, "signals_duplicate": 0,
             "items_ingested": 0, "matches_suggested": 0, "lag_signals": 0,
             "feed_ok": False}
    now = datetime.now(timezone.utc)
    watermarks = load_watermarks()
    since = min((ts for ts in watermarks.values() if ts), default=None)

    posts = fetch_feed(channels=channels, since=since)
    if posts is None:
        # Graceful degradation: OSIRIS unreachable is not a DB failure.
        return stats
    stats["feed_ok"] = True
    stats["posts_seen"] = len(posts)
    if not posts:
        return stats

    source_id = ensure_source()
    registry = load_registry()
    retention_days = 365
    source_rows = db_get("/adverse_media_sources",
                         {"id": f"eq.{source_id}", "select": "retention_days"})
    if source_rows and source_rows[0].get("retention_days"):
        retention_days = source_rows[0]["retention_days"]

    watch_rows = []
    classified = []  # (post, result) for matched signals
    latest_per_channel: dict = {}
    for post in posts:
        result = classify_post(post, registry)
        ts_dt = parse_post_ts(post.get("ts", ""))
        if post["channel"] not in latest_per_channel or (
                ts_dt and (latest_per_channel[post["channel"]][0] is None
                           or ts_dt > latest_per_channel[post["channel"]][0])):
            latest_per_channel[post["channel"]] = (ts_dt, post["id"])
        if not result["is_signal"]:
            continue
        redacted = redact_pii(post["text"])
        post["text_redacted"] = redacted
        post["ts_dt"] = ts_dt
        classified.append((post, result))
        watch_rows.append({
            "post_id": post["id"][:256],
            "channel": post["channel"][:256],
            "post_ts": ts_dt.isoformat() if ts_dt else None,
            "post_url": (post.get("url") or None),
            "text_redacted": redacted[:20000],
            "geo": post.get("geo"),
            "classifier": {"keywords": result["matched_keywords"],
                           "method": result["method"],
                           "ambiguous": result["ambiguous"],
                           "entities": result["entities"]},
            "severity": result["severity"] if result["severity"] in SEVERITIES else "medium",
        })

    inserted_watch = db_post_ignore_duplicates("/telegram_watch_items", watch_rows)
    stats["signals_new"] = len(inserted_watch)
    stats["signals_duplicate"] = len(watch_rows) - len(inserted_watch)

    # ── Existing adverse-media ingestion path (source='osiris_telegram') ──
    am_rows = []
    for post, result in classified:
        redacted = post["text_redacted"]
        title = redacted.split("\n", 1)[0][:120] or f"Telegram post {post['id']}"
        am_rows.append({
            "source_id": source_id,
            "url": post.get("url") or None,
            "url_hash": item_hash(post["channel"], post["id"]),
            "title": f"[telegram/{post['channel']}] {title}"[:512],
            "summary": redacted[:20000],
            "published_at": post["ts_dt"].isoformat() if post["ts_dt"] else None,
            "severity": result["severity"] if result["severity"] in SEVERITIES else "medium",
            "triage_method": "ollama" if result["method"] == "ollama" else "keyword",
            "triage_label": "data_breach",
            "retention_expires_at": (now + timedelta(days=retention_days)).isoformat(),
        })
    stats["items_ingested"] = len(db_post_ignore_duplicates("/adverse_media_items", am_rows))

    # Link watch rows to their adverse_media_items + suggest entity matches.
    if am_rows:
        hashes = [r["url_hash"] for r in am_rows]
        stored = db_get("/adverse_media_items",
                        {"select": "id,url_hash",
                         "url_hash": f"in.({','.join(hashes)})"}) if len(hashes) <= 50 else []
        by_hash = {r["url_hash"]: r["id"] for r in stored}
        match_rows = []
        for post, result in classified:
            item_id = by_hash.get(item_hash(post["channel"], post["id"]))
            if not item_id:
                continue
            # Link telegram_watch_items.adverse_media_item_id (best-effort).
            try:
                requests.patch(
                    f"{DB_API_URL}/telegram_watch_items"
                    f"?channel=eq.{post['channel']}&post_id=eq.{post['id']}",
                    json={"adverse_media_item_id": item_id},
                    timeout=FETCH_TIMEOUT_S,
                ).raise_for_status()
            except Exception as exc:  # noqa: BLE001
                logger.warning("watch-item link patch failed: %s", exc)
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

    # ── Breach-lag detector ──
    watch_index = {r["post_id"]: r.get("id") for r in inserted_watch}
    lag_rows = []
    for post, result in classified:
        watch_id = watch_index.get(post["id"])
        if not watch_id or not post["ts_dt"]:
            continue
        window_start = post["ts_dt"] - timedelta(hours=BREACH_LAG_WINDOW_HOURS)
        window_end = post["ts_dt"] + timedelta(hours=BREACH_LAG_WINDOW_HOURS)
        for m in result["entities"]:
            org_id = m["organization_id"]
            incidents = load_org_incidents(org_id, window_start, window_end)
            lag = detect_breach_lag(post["ts_dt"], incidents, now=now,
                                    window_hours=BREACH_LAG_WINDOW_HOURS)
            if lag:
                lag_rows.append({
                    "signal_type": "breach_notification_overdue",
                    "organization_id": org_id,
                    "telegram_watch_item_id": watch_id,
                    "post_ts": lag["post_ts"],
                    "notification_deadline": lag["notification_deadline"],
                })
    stats["lag_signals"] = len(db_post_ignore_duplicates("/breach_lag_signals", lag_rows))

    # ── Watermarks + source observability ──
    wm_rows = [{
        "channel": ch,
        "last_post_id": pid,
        "last_post_ts": ts.isoformat() if ts else None,
        "last_run_at": now.isoformat(),
        "stats": {"posts_seen": stats["posts_seen"], "signals_new": stats["signals_new"]},
    } for ch, (ts, pid) in latest_per_channel.items()]
    if wm_rows:
        db_upsert("/telegram_watch_watermarks", wm_rows, "channel")
    db_patch_source(source_id, {"last_status": "ok", "last_error": None,
                                "last_polled_at": now.isoformat()})
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
            self._json(200, {"status": "ok", "worker": "telegram_breach_watch",
                             "ollama_configured": bool(OLLAMA_URL),
                             "ts": datetime.now(timezone.utc).isoformat()})
        elif self.path == "/status":
            self._json(200, {"status": "ok", "worker": "telegram_breach_watch",
                             "channels": DEFAULT_CHANNELS,
                             "ollama_configured": bool(OLLAMA_URL),
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
        try:
            stats = watch_cycle()
            _last_stats.clear()
            _last_stats.update(stats)
            self._json(200, {"status": "ok", "stats": stats})
        except Exception as exc:  # noqa: BLE001
            logger.exception("manual run failed")
            self._json(500, {"error": str(exc)[:500]})

    def log_message(self, fmt, *args):  # quiet access log
        logger.debug("http " + fmt, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Telegram breach watch worker")
    parser.add_argument("--once", action="store_true",
                        help="run a single watch cycle and exit (no auth token required)")
    args = parser.parse_args()

    if not DB_API_URL:
        logger.critical("FATAL: TELEGRAM_WATCH_DB_API_URL (or ADVERSE_MEDIA_DB_API_URL) "
                        "is not set — refusing to run without a real DB API endpoint.")
        raise SystemExit(2)

    if args.once:
        stats = watch_cycle()
        print(json.dumps({"status": "ok", "stats": stats}))
        return

    validate_config()
    server = ThreadingHTTPServer(("0.0.0.0", WORKER_PORT), Handler)
    logger.info("telegram_breach_watch_worker listening on :%d (db_api=%s, osiris=%s, ollama=%s)",
                WORKER_PORT, DB_API_URL, OSIRIS_URL,
                OLLAMA_URL or "UNCONFIGURED (rules-only, fail-closed)")
    threading.Thread(target=server.serve_forever, daemon=True).start()

    failures = 0
    while True:
        try:
            stats = watch_cycle()
            _last_stats.clear()
            _last_stats.update(stats)
            if stats.get("feed_ok") is False and stats.get("posts_seen") == 0:
                # OSIRIS degraded — do not count against DB failure budget.
                logger.warning("watch cycle skipped: OSIRIS feed unavailable")
            failures = 0
            logger.info("watch cycle: %s", stats)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            logger.error("watch cycle failed (%d/%d): %s", failures, MAX_CONSECUTIVE_FAILURES, exc)
            if failures >= MAX_CONSECUTIVE_FAILURES:
                logger.critical("DB failures exceeded threshold — exiting for supervisor restart")
                raise SystemExit(3)
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
