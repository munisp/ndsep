#!/usr/bin/env python3
"""
NDSEP Privacy-Policy Change Monitor Worker (Python)
====================================================
Polls registered controller privacy-policy URLs on schedule (NDPA 2023
ss. 34-35 transparency obligations). On content change:

  1. Normalises the visible text and SHA-256 hashes it; each distinct hash
     becomes a `policy_versions` row.
  2. Computes a heuristic diff (difflib change ratio + material-keyword
     delta) immediately so a signal is never lost.
  3. Requests a SEMANTIC diff + materiality classification from the
     ollama_llm_worker HTTP API. If the LLM worker is unreachable the
     version is marked diff_status='UNCONFIGURED' with a next_retry_at —
     it stays queued and is retried every cycle, NEVER dropped and never
     silently marked complete.
  4. Material ADVERSE changes automatically open a `policy_reviews` review
     task for NDPC officers (assign/decide/escalate via the policyMonitor
     router) and relay an event for controller notification.

Endpoints:
  GET  /health   — worker status, LLM reachability, queue depth
  POST /check    — {"policy_id": N} force an immediate check
  POST /retry    — re-attempt all UNCONFIGURED/failed diffs now

Technology: Python · requests · psycopg2 (stdlib + requests otherwise)
Port: 8211 (env POLICY_MONITOR_PORT, legacy POLMON_PORT)
"""
import os
import re
import json
import time
import difflib
import hashlib
import logging
import threading
import http.server
import socketserver
from html.parser import HTMLParser
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

# ── Configuration ──────────────────────────────────────────────────────────────
DB_URL = os.environ.get("WORKER_DATABASE_URL", os.environ.get("DATABASE_URL", ""))
RELAY_URL = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
# ollama_llm_worker HTTP API (server/…/workers/python/ollama_llm_worker.py, port 8203)
LLM_WORKER_URL = os.environ.get("OLLAMA_WORKER_URL", "http://localhost:8203").rstrip("/")
LLM_TIMEOUT = float(os.environ.get("POLICY_MONITOR_LLM_TIMEOUT_SECONDS", "60"))
PORT = int(os.environ.get("POLICY_MONITOR_PORT", os.environ.get("POLMON_PORT", "8211")))
POLL_INTERVAL = float(os.environ.get("POLICY_MONITOR_POLL_SECONDS", "60"))
REQUEST_TIMEOUT = float(os.environ.get("POLICY_MONITOR_REQUEST_TIMEOUT_SECONDS", "20"))
RETRY_BACKOFF_BASE_MIN = float(os.environ.get("POLICY_MONITOR_RETRY_BACKOFF_MIN", "15"))
MAX_TEXT_CHARS = int(os.environ.get("POLICY_MONITOR_MAX_TEXT_CHARS", "400000"))
USER_AGENT = os.environ.get(
    "POLICY_MONITOR_USER_AGENT",
    "NDSEP-PolicyMonitor/1.0 (+https://ndpc.gov.ng; privacy notice change monitor)",
)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [NDSEP-PolicyMonitor] %(levelname)s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

# ── State ──────────────────────────────────────────────────────────────────────
_worker_start = time.time()
_checks_completed = 0
_changes_detected = 0
_diffs_classified = 0
_llm_failures = 0
_last_error: Optional[str] = None

# Keywords whose appearance/removal can make a change material & adverse.
MATERIAL_KEYWORDS = {
    "adverse": [
        "sell your", "sale of personal", "share with third parties", "third-party partners",
        "advertising partners", "data broker", "profiling", "automated decision",
        "retain indefinitely", "indefinite retention", "waive", "without notice",
        "cross-border", "transfer outside nigeria", "transfer your data abroad",
        "no longer", "may disclose", "at our sole discretion", "track your location",
        "biometric", "combine your data", "not responsible", "opt out by writing",
    ],
    "beneficial": [
        "you may request deletion", "right to erasure", "right to object", "data protection officer",
        "lodge a complaint", "nigeria data protection commission", "ndpc", "shorter retention",
        "no longer share", "stop sharing", "opt-out", "withdraw consent", "anonymis", "pseudonymis",
    ],
}
MATERIAL_CHANGE_RATIO = float(os.environ.get("POLICY_MONITOR_MATERIAL_RATIO", "0.05"))


# ── Text extraction / normalisation ───────────────────────────────────────────
class _TextExtractor(HTMLParser):
    """Visible-text extraction; drops scripts/styles so template noise and
    embedded JS never produce false change events."""

    SKIP = {"script", "style", "noscript", "template", "svg"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self.parts: List[str] = []

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in self.SKIP:
            self._skip_depth += 1
        elif tag in ("p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "section", "article"):
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self.parts.append(data)


def normalize_policy_text(html_or_text: str) -> str:
    extractor = _TextExtractor()
    try:
        extractor.feed(html_or_text)
    except Exception:
        # not HTML — treat as plain text
        extractor.parts = [html_or_text]
    text = " ".join("".join(extractor.parts).split())
    return text[:MAX_TEXT_CHARS]


def content_hash(normalized_text: str) -> str:
    return hashlib.sha256(normalized_text.encode("utf-8")).hexdigest()


# ── Diff + classification (pure logic — unit tested without network) ──────────
def keyword_delta(old_text: str, new_text: str) -> Dict[str, List[str]]:
    old_l, new_l = old_text.lower(), new_text.lower()
    return {
        "adverse_added": [k for k in MATERIAL_KEYWORDS["adverse"] if k in new_l and k not in old_l],
        "adverse_removed": [k for k in MATERIAL_KEYWORDS["adverse"] if k in old_l and k not in new_l],
        "beneficial_added": [k for k in MATERIAL_KEYWORDS["beneficial"] if k in new_l and k not in old_l],
        "beneficial_removed": [k for k in MATERIAL_KEYWORDS["beneficial"] if k in old_l and k not in new_l],
    }


def change_ratio(old_text: str, new_text: str) -> float:
    if not old_text and not new_text:
        return 0.0
    sm = difflib.SequenceMatcher(a=old_text, b=new_text, autojunk=True)
    return round(1.0 - sm.ratio(), 6)


def heuristic_classify(old_text: str, new_text: str) -> Dict[str, Any]:
    """Deterministic fallback classification. Material-adverse when adverse
    keywords appear, beneficial keywords disappear, or the changed fraction
    exceeds MATERIAL_CHANGE_RATIO with adverse signals present."""
    ratio = change_ratio(old_text, new_text)
    delta = keyword_delta(old_text, new_text)
    if ratio < 0.001 and not any(delta.values()):
        classification = "none"
    elif delta["adverse_added"] or delta["beneficial_removed"]:
        classification = "material_adverse"
    elif delta["beneficial_added"] or delta["adverse_removed"]:
        classification = "material_beneficial"
    elif ratio >= MATERIAL_CHANGE_RATIO:
        classification = "material_neutral"
    else:
        classification = "minor"
    return {"classification": classification, "ratio": ratio, "keyword_delta": delta}


def parse_llm_classification(text: str) -> Optional[str]:
    """Extract a classification token from the LLM response (JSON or prose).
    Returns None when nothing recognisable is present."""
    if not text:
        return None
    valid = {"none", "minor", "material_neutral", "material_beneficial", "material_adverse"}
    try:
        m = re.search(r'"classification"\s*:\s*"([a-z_]+)"', text)
        if m and m.group(1) in valid:
            return m.group(1)
        data = json.loads(text)
        val = str(data.get("classification", "")).lower()
        if val in valid:
            return val
    except (json.JSONDecodeError, AttributeError):
        pass
    lowered = text.lower()
    for token in ("material_adverse", "material_beneficial", "material_neutral"):
        if token.replace("_", " ") in lowered or token in lowered:
            return token
    if re.search(r"\bminor\b", lowered):
        return "minor"
    return None


# ── LLM worker client (explicit UNCONFIGURED path) ────────────────────────────
def llm_worker_health() -> Dict[str, Any]:
    try:
        resp = requests.get(f"{LLM_WORKER_URL}/health", timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            return {"configured": True, "status": "ok", "url": LLM_WORKER_URL,
                    "llm": data.get("status"), "models": data.get("models", data.get("available_models", []))}
        return {"configured": True, "status": "unreachable", "url": LLM_WORKER_URL,
                "detail": f"HTTP {resp.status_code}"}
    except Exception as exc:
        return {"configured": True, "status": "unreachable", "url": LLM_WORKER_URL,
                "detail": str(exc)[:200]}


def llm_semantic_diff(old_text: str, new_text: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Ask ollama_llm_worker for a semantic diff + materiality classification.
    Returns (result, None) on success or (None, reason) when unreachable —
    callers must queue for retry, never fake a result."""
    prompt = (
        "You are comparing two versions of a data controller's privacy notice under the "
        "Nigeria Data Protection Act 2023. Classify the change as exactly one of: "
        "none, minor, material_neutral, material_beneficial, material_adverse. "
        "'material_adverse' means data subjects' rights are reduced (broader sharing, "
        "longer retention, new purposes, cross-border transfers, weaker remedies). "
        "Respond ONLY with JSON: {\"classification\": \"...\", \"summary\": \"...\"}.\n\n"
        f"=== OLD VERSION (truncated) ===\n{old_text[:6000]}\n\n"
        f"=== NEW VERSION (truncated) ===\n{new_text[:6000]}"
    )
    try:
        resp = requests.post(
            f"{LLM_WORKER_URL}/generate",
            json={"prompt": prompt, "max_tokens": 512, "temperature": 0.1},
            timeout=LLM_TIMEOUT,
        )
    except Exception as exc:
        return None, f"llm worker unreachable: {str(exc)[:200]}"
    if resp.status_code != 200:
        return None, f"llm worker HTTP {resp.status_code}: {resp.text[:200]}"
    try:
        data = resp.json()
    except json.JSONDecodeError:
        return None, "llm worker returned non-JSON response"
    text = data.get("response") or data.get("text") or data.get("output") or ""
    classification = parse_llm_classification(str(text))
    if classification is None:
        return None, "llm response did not contain a recognisable classification"
    return {"classification": classification, "summary": str(text)[:1000],
            "model": data.get("model", "unknown")}, None


# ── Database (lazy psycopg2 — pure logic importable without it) ───────────────
def _connect():
    if not DB_URL:
        raise RuntimeError("WORKER_DATABASE_URL/DATABASE_URL not configured")
    import psycopg2  # noqa: WPS433 — lazy by design
    return psycopg2.connect(DB_URL)


def db_health() -> Dict[str, Any]:
    if not DB_URL:
        return {"configured": False, "status": "UNCONFIGURED",
                "detail": "WORKER_DATABASE_URL/DATABASE_URL not set"}
    try:
        conn = _connect()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM monitored_policies WHERE enabled = TRUE")
            policies = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM policy_versions WHERE diff_status IN ('UNCONFIGURED','failed','pending')")
            queued = cur.fetchone()[0]
        conn.close()
        return {"configured": True, "status": "ok", "enabled_policies": policies, "diff_queue_depth": queued}
    except Exception as exc:
        return {"configured": True, "status": "unreachable", "detail": str(exc)[:200]}


def _relay(event: str, data: Dict[str, Any]) -> None:
    try:
        requests.post(RELAY_URL, json={"event": event, "data": data}, timeout=5)
    except Exception as exc:
        log.debug("relay failed (%s): %s", event, exc)


def _next_retry(retry_count: int) -> str:
    """Exponential backoff, capped at 24h. Returned as an interval expression
    evaluated by Postgres (now() + interval)."""
    minutes = min(RETRY_BACKOFF_BASE_MIN * (2 ** min(retry_count, 7)), 24 * 60)
    return f"{int(minutes)} minutes"


# ── Check pipeline ─────────────────────────────────────────────────────────────
def _previous_version_text(cur, policy_id: int, exclude_hash: str) -> Tuple[Optional[int], str]:
    cur.execute(
        """SELECT id, content_text FROM policy_versions
            WHERE policy_id = %s AND content_hash <> %s
            ORDER BY fetched_at DESC LIMIT 1""",
        (policy_id, exclude_hash),
    )
    row = cur.fetchone()
    return (row[0], row[1] or "") if row else (None, "")


def _open_review_task(cur, policy_id: int, version_id: int, classification: str,
                      priority: str) -> Optional[int]:
    """Create an officer review task for material adverse changes (idempotent
    per version)."""
    cur.execute(
        "SELECT id FROM policy_reviews WHERE version_id = %s AND status NOT IN ('closed')",
        (version_id,),
    )
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute(
        """INSERT INTO policy_reviews (policy_id, version_id, priority, status, created_by)
           VALUES (%s, %s, %s, 'open', 'policy-monitor-worker') RETURNING id""",
        (policy_id, version_id, priority),
    )
    return cur.fetchone()[0]


def _classify_and_record(conn, policy_id: int, version_id: int,
                         old_text: str, new_text: str) -> Dict[str, Any]:
    """Heuristic classify immediately; attempt LLM semantic diff; on LLM
    failure mark UNCONFIGURED and queue for retry (never dropped)."""
    global _diffs_classified, _llm_failures
    heuristic = heuristic_classify(old_text, new_text)
    llm_result, llm_error = llm_semantic_diff(old_text, new_text)
    with conn.cursor() as cur:
        if llm_result is not None:
            classification = llm_result["classification"]
            cur.execute(
                """UPDATE policy_versions
                      SET change_classification = %s, diff_status = 'completed',
                          diff_summary = %s, classifier = %s,
                          diff_detail = %s::jsonb, next_retry_at = NULL
                    WHERE id = %s""",
                (classification, llm_result.get("summary", "")[:1000],
                 f"ollama:{llm_result.get('model', 'unknown')}",
                 json.dumps({"llm": llm_result, "heuristic": heuristic}), version_id),
            )
            _diffs_classified += 1
            llm_ok = True
        else:
            # Explicit UNCONFIGURED path: keep the heuristic signal visible,
            # queue the semantic diff for retry — never silently complete.
            classification = heuristic["classification"]
            cur.execute(
                """UPDATE policy_versions
                      SET change_classification = %s, diff_status = 'UNCONFIGURED',
                          diff_summary = %s, classifier = 'heuristic',
                          diff_detail = %s::jsonb,
                          retry_count = retry_count + 1,
                          next_retry_at = now() + %s::interval
                    WHERE id = %s""",
                (classification,
                 f"[heuristic only — LLM diff pending retry] ratio={heuristic['ratio']}; {llm_error}",
                 json.dumps({"heuristic": heuristic, "llm_error": llm_error}),
                 _next_retry(0), version_id),
            )
            _llm_failures += 1
            llm_ok = False
        review_id = None
        if classification == "material_adverse":
            priority = "high" if llm_ok else "medium"
            review_id = _open_review_task(cur, policy_id, version_id, classification, priority)
    conn.commit()
    result = {"classification": classification, "llm_ok": llm_ok, "review_id": review_id}
    if not llm_ok:
        result["llm_error"] = llm_error
    return result


def check_policy(policy_id: int) -> Dict[str, Any]:
    """Fetch one policy, detect change, version + classify it."""
    global _checks_completed, _changes_detected, _last_error
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, controller_name, policy_url, last_content_hash, check_interval_hours
                     FROM monitored_policies WHERE id = %s AND enabled = TRUE""",
                (policy_id,),
            )
            row = cur.fetchone()
        if not row:
            return {"policy_id": policy_id, "status": "skipped", "reason": "not found or disabled"}
        _, controller_name, policy_url, last_hash, interval_hours = row

        try:
            resp = requests.get(policy_url, timeout=REQUEST_TIMEOUT,
                                headers={"User-Agent": USER_AGENT})
            status = resp.status_code
            body = resp.text
        except Exception as exc:
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE monitored_policies
                          SET last_checked_at = now(), consecutive_failures = consecutive_failures + 1,
                              last_error = %s,
                              next_check_at = now() + (LEAST(check_interval_hours, 6) || ' hours')::interval,
                              updated_at = now()
                        WHERE id = %s""",
                    (str(exc)[:400], policy_id),
                )
            conn.commit()
            _last_error = str(exc)[:300]
            return {"policy_id": policy_id, "status": "fetch_error", "error": str(exc)[:300]}

        normalized = normalize_policy_text(body)
        digest = content_hash(normalized)
        _checks_completed += 1

        with conn.cursor() as cur:
            if digest == last_hash:
                cur.execute(
                    """UPDATE monitored_policies
                          SET last_checked_at = now(), last_http_status = %s, consecutive_failures = 0,
                              last_error = NULL,
                              next_check_at = now() + (%s || ' hours')::interval, updated_at = now()
                        WHERE id = %s""",
                    (status, interval_hours, policy_id),
                )
                conn.commit()
                return {"policy_id": policy_id, "status": "unchanged", "content_hash": digest}

            cur.execute(
                """INSERT INTO policy_versions
                     (policy_id, content_hash, http_status, content_length, content_text)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (policy_id, content_hash) DO NOTHING
                   RETURNING id""",
                (policy_id, digest, status, len(body), normalized),
            )
            vrow = cur.fetchone()
            if vrow is None:
                # hash seen before (content reverted) — refresh schedule only
                cur.execute(
                    """UPDATE monitored_policies
                          SET last_checked_at = now(), last_http_status = %s, last_content_hash = %s,
                              consecutive_failures = 0, last_error = NULL,
                              next_check_at = now() + (%s || ' hours')::interval, updated_at = now()
                        WHERE id = %s""",
                    (status, digest, interval_hours, policy_id),
                )
                conn.commit()
                return {"policy_id": policy_id, "status": "reverted_to_known_version",
                        "content_hash": digest}
            version_id = vrow[0]
            cur.execute(
                """UPDATE monitored_policies
                      SET last_checked_at = now(), last_http_status = %s, last_content_hash = %s,
                          consecutive_failures = 0, last_error = NULL,
                          next_check_at = now() + (%s || ' hours')::interval, updated_at = now()
                    WHERE id = %s""",
                (status, digest, interval_hours, policy_id),
            )
            prev_id, prev_text = _previous_version_text(cur, policy_id, digest)
        conn.commit()

        _changes_detected += 1
        outcome = _classify_and_record(conn, policy_id, version_id, prev_text, normalized)
        _relay("ndsep.policy.changed", {
            "policy_id": policy_id, "version_id": version_id,
            "controller_name": controller_name, "policy_url": policy_url,
            "previous_version_id": prev_id, "content_hash": digest,
            **outcome,
        })
        return {"policy_id": policy_id, "status": "changed", "version_id": version_id,
                "content_hash": digest, **outcome}
    except Exception as exc:
        _last_error = str(exc)[:300]
        log.exception("policy check failed for id=%s", policy_id)
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            conn.close()
        except Exception:
            pass


def retry_pending_diffs(limit: int = 10) -> Dict[str, Any]:
    """Re-attempt semantic diffs queued as UNCONFIGURED/failed whose backoff
    has elapsed. Versions are never dropped — on continued failure the
    backoff simply increases."""
    conn = _connect()
    retried = 0
    results: List[Dict[str, Any]] = []
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT v.id, v.policy_id, v.content_text, v.retry_count
                     FROM policy_versions v
                    WHERE v.diff_status IN ('UNCONFIGURED', 'failed')
                      AND v.next_retry_at IS NOT NULL AND v.next_retry_at <= now()
                    ORDER BY v.next_retry_at ASC LIMIT %s""",
                (limit,),
            )
            rows = cur.fetchall()
        for version_id, policy_id, new_text, retry_count in rows:
            with conn.cursor() as cur:
                _, prev_text = _previous_version_text(cur, policy_id, "__none__")
            llm_result, llm_error = llm_semantic_diff(prev_text or "", new_text or "")
            with conn.cursor() as cur:
                if llm_result is not None:
                    cur.execute(
                        """UPDATE policy_versions
                              SET change_classification = %s, diff_status = 'completed',
                                  diff_summary = %s, classifier = %s,
                                  diff_detail = diff_detail || %s::jsonb, next_retry_at = NULL
                            WHERE id = %s""",
                        (llm_result["classification"], llm_result.get("summary", "")[:1000],
                         f"ollama:{llm_result.get('model', 'unknown')}",
                         json.dumps({"llm_retry": llm_result}), version_id),
                    )
                    if llm_result["classification"] == "material_adverse":
                        review_id = _open_review_task(cur, policy_id, version_id,
                                                      "material_adverse", "high")
                        results.append({"version_id": version_id, "status": "completed",
                                        "classification": llm_result["classification"],
                                        "review_id": review_id})
                    else:
                        results.append({"version_id": version_id, "status": "completed",
                                        "classification": llm_result["classification"]})
                else:
                    cur.execute(
                        """UPDATE policy_versions
                              SET retry_count = retry_count + 1,
                                  next_retry_at = now() + %s::interval,
                                  diff_detail = diff_detail || %s::jsonb
                            WHERE id = %s""",
                        (_next_retry(retry_count + 1),
                         json.dumps({"last_llm_error": llm_error}), version_id),
                    )
                    results.append({"version_id": version_id, "status": "still_queued",
                                    "reason": llm_error})
            conn.commit()
            retried += 1
        return {"retried": retried, "results": results}
    finally:
        conn.close()


def due_policies(limit: int = 10) -> List[int]:
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id FROM monitored_policies
                    WHERE enabled = TRUE AND next_check_at <= now()
                    ORDER BY next_check_at ASC LIMIT %s""",
                (limit,),
            )
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def _scheduler_loop() -> None:
    while True:
        try:
            if DB_URL:
                retry_pending_diffs()
                for policy_id in due_policies():
                    try:
                        check_policy(policy_id)
                    except Exception:
                        pass  # failure recorded on the policy row / logs
        except Exception as exc:
            log.warning("scheduler tick failed: %s", exc)
        time.sleep(POLL_INTERVAL)


# ── HTTP surface ───────────────────────────────────────────────────────────────
def health_payload() -> Dict[str, Any]:
    db = db_health()
    llm = llm_worker_health()
    if not db["configured"]:
        status = "UNCONFIGURED"
    elif db["status"] != "ok":
        status = "degraded"
    else:
        # LLM outage is a known, queued degradation — worker still functions.
        status = "ok" if llm["status"] == "ok" else "degraded_llm"
    return {
        "worker": "policy_monitor",
        "status": status,
        "uptime_seconds": round(time.time() - _worker_start, 1),
        "database": db,
        "llm_worker": llm,
        "checks_completed": _checks_completed,
        "changes_detected": _changes_detected,
        "diffs_classified": _diffs_classified,
        "llm_failures": _llm_failures,
        "last_error": _last_error,
        "config": {"poll_interval_s": POLL_INTERVAL, "material_ratio": MATERIAL_CHANGE_RATIO,
                   "llm_worker_url": LLM_WORKER_URL},
        "time": datetime.now(timezone.utc).isoformat(),
    }


class Handler(http.server.BaseHTTPRequestHandler):
    def _json(self, code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:
        log.debug("http: " + fmt, *args)

    def do_GET(self) -> None:
        if self.path.rstrip("/") in ("", "/health"):
            payload = health_payload()
            self._json(200 if payload["status"] == "ok" else 503, payload)
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON"})
            return
        if not DB_URL:
            self._json(503, {"status": "UNCONFIGURED", "error": "database URL not set"})
            return
        if self.path == "/check":
            policy_id = body.get("policy_id")
            if not isinstance(policy_id, int):
                self._json(400, {"error": "policy_id (int) required"})
                return
            try:
                self._json(200, check_policy(policy_id))
            except Exception as exc:
                self._json(500, {"error": str(exc)[:300]})
        elif self.path == "/retry":
            try:
                self._json(200, retry_pending_diffs(limit=int(body.get("limit", 10))))
            except Exception as exc:
                self._json(500, {"error": str(exc)[:300]})
        else:
            self._json(404, {"error": "not found"})


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    log.info("policy monitor worker starting on port %s (db configured: %s, llm: %s)",
             PORT, bool(DB_URL), LLM_WORKER_URL)
    threading.Thread(target=_scheduler_loop, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
