#!/usr/bin/env python3
"""
NDSEP Compliance Scan Crawler Worker (Python)
==============================================
Regulator-side web/app compliance scanner (NDPA 2023 ss. 25-26, 28; NDPC
cookie/consent guidance). Claims rows from `scan_runs`, crawls the target
controller's web property over plain HTTP(S), and detects:

  1. Third-party trackers firing pre-consent — script/iframe/img requests to
     known tracker domains (tracker_signatures reference table, ~50 seeds)
     that are NOT gated behind a consent-management stub
     (type="text/plain" + data-cookieconsent / data-cmp-* attributes).
  2. Consent-banner presence / absence on landing pages.
  3. Dark-pattern heuristics:
       - pre-ticked consent/marketing checkboxes,
       - asymmetric choice (prominent "Accept" vs hidden/absent "Reject"),
       - forced account creation walls.
  4. Cookies set before consent — Set-Cookie analysis classifying
     essential vs non-essential (tracker cookie signatures / long expiry).

Evidence capture: SHA-256 of every fetched page/script plus response-header
digests are written to `scan_artifacts`; an event is relayed to the NDSEP
server (WORKER_RELAY_URL) so officers can seal artifacts into the anti-wipe
evidence vault + hash-chained audit ledger via
complianceScanning.attestArtifact. Findings land in `scan_findings`
(suppressed by approved scan_suppressions entries).

Design notes:
  - stdlib + requests + psycopg2 only. No headless browser is required;
    detection is HTML/signature-based. If a headless renderer becomes
    available it can be layered on as an OPTIONAL enhancement — the
    `rendered_html` hook in scan_page() accepts externally-rendered DOM but
    the worker never depends on it.
  - No silent success: if the database is unreachable the worker reports
    status=UNCONFIGURED/degraded on /health and fails runs loudly.

Endpoints:
  GET  /health         — worker status + counters
  POST /scan           — {"run_id": N} execute a scheduled run now
  POST /scan-target    — {"target_id": N} create + execute an ad-hoc run

Technology: Python · requests · psycopg2
Port: 8210 (env SCAN_CRAWLER_PORT, legacy CRAWLER_PORT)
"""
import os
import re
import json
import time
import hashlib
import logging
import threading
import http.server
import socketserver
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

# ── Configuration ──────────────────────────────────────────────────────────────
DB_URL = os.environ.get("WORKER_DATABASE_URL", os.environ.get("DATABASE_URL", ""))
RELAY_URL = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
PORT = int(os.environ.get("SCAN_CRAWLER_PORT", os.environ.get("CRAWLER_PORT", "8210")))
POLL_INTERVAL = float(os.environ.get("SCAN_POLL_INTERVAL_SECONDS", "30"))
REQUEST_TIMEOUT = float(os.environ.get("SCAN_REQUEST_TIMEOUT_SECONDS", "20"))
MAX_PAGE_BYTES = int(os.environ.get("SCAN_MAX_PAGE_BYTES", str(2 * 1024 * 1024)))
MAX_SCRIPT_BYTES = int(os.environ.get("SCAN_MAX_SCRIPT_BYTES", str(1024 * 1024)))
MAX_EXTERNAL_SCRIPTS = int(os.environ.get("SCAN_MAX_EXTERNAL_SCRIPTS", "25"))
USER_AGENT = os.environ.get(
    "SCAN_USER_AGENT",
    "NDSEP-ComplianceScanner/1.0 (+https://ndpc.gov.ng; regulatory compliance scan)",
)

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [NDSEP-ScanCrawler] %(levelname)s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

# ── State ──────────────────────────────────────────────────────────────────────
_worker_start = time.time()
_scans_completed = 0
_scans_failed = 0
_findings_written = 0
_last_error: Optional[str] = None

# ── Heuristic pattern catalogue ────────────────────────────────────────────────
# Markers that indicate a consent-management platform (CMP) banner is present.
CONSENT_BANNER_RE = re.compile(
    r"(?:id|class)\s*=\s*[\"'][^\"']*("
    r"cookie[-_]?(banner|consent|notice|law|yes|bot)|consent[-_]?(banner|modal|manager|popup)|"
    r"onetrust|ot-sdk|cookiebot|cybot|truste|trustarc|quantcast-choice|qc-cmp|"
    r"iubenda|osano|termly|cookieyes|complianz|gdpr[-_]?(banner|consent|notice)|"
    r"ccpa[-_]?banner|sp_message|didomi|usercentrics|sourcepoint"
    r")",
    re.IGNORECASE,
)
CONSENT_TEXT_RE = re.compile(
    r"(we use cookies|this (site|website) uses cookies|accept (all )?cookies|"
    r"cookie (preferences|settings|consent)|manage consent|your privacy choices)",
    re.IGNORECASE,
)
# A script is consent-GATED when a CMP has neutralised it (standard Cookiebot/
# OneTrust pattern) — it cannot execute until consent is given.
GATED_SCRIPT_TYPE_RE = re.compile(r"^(text/plain|text/template|text/x-template)$", re.IGNORECASE)
GATED_SCRIPT_ATTR_RE = re.compile(r"^(data-cookieconsent|data-cmp|data-consent|data-cli-|data-ot-)", re.IGNORECASE)

# Dark patterns
PRETICKED_CONTEXT_RE = re.compile(
    r"(marketing|newsletter|promo|offer|partner|third[-_ ]?party|consent|share|"
    r"personalis|track|analytic|advertis|profil)",
    re.IGNORECASE,
)
ACCEPT_LABEL_RE = re.compile(r"^\s*(accept( all)?|agree( and continue)?|allow all|i agree|ok,? got it|continue)\s*$", re.IGNORECASE)
REJECT_LABEL_RE = re.compile(r"(reject|decline|deny|refuse|opt[- ]?out|necessary only|essential only)", re.IGNORECASE)
HIDDEN_STYLE_RE = re.compile(r"(display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$)|font-size\s*:\s*[0-8]px)", re.IGNORECASE)
FORCED_ACCOUNT_RE = re.compile(
    r"(create (an )?account to (continue|view|access|read)|sign up to (continue|view|access|read)|"
    r"register to (continue|view|access|read)|you must (log ?in|sign ?in|register) to|"
    r"log ?in or sign up to (continue|view|access))",
    re.IGNORECASE,
)

# Cookies that are plausibly strictly-necessary (session / security).
ESSENTIAL_COOKIE_RE = re.compile(
    r"^(PHPSESSID|JSESSIONID|ASP\.NET_SessionId|ARRAffinity|__Host-|__Secure-|"
    r"(.*[_-])?(csrf|xsrf)([_-].*)?|session(id)?$|connect\.sid$|laravel_session$|"
    r"cf_clearance$|__cf_bm$|incap_ses|visid_incap|ak_bmsc$)",
    re.IGNORECASE,
)
# Non-essential if lifetime exceeds this without an essential-name match.
ESSENTIAL_MAX_AGE_SECONDS = 24 * 3600


# ── HTML collection ────────────────────────────────────────────────────────────
class PageModel:
    """Structured facts collected from one HTML document."""

    def __init__(self) -> None:
        self.scripts: List[Dict[str, Any]] = []     # {src, inline, attrs}
        self.iframes: List[Dict[str, Any]] = []
        self.images: List[Dict[str, Any]] = []      # potential tracking pixels
        self.checkboxes: List[Dict[str, Any]] = []  # {name, id, checked, context}
        self.clickables: List[Dict[str, Any]] = []  # {tag, text, hidden, href, in_banner}
        self.forms: List[Dict[str, Any]] = []
        self.title: str = ""


class PageCollector(HTMLParser):
    """stdlib HTMLParser collecting tracker/dark-pattern evidence."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.page = PageModel()
        self._in_script = False
        self._script_attrs: Dict[str, str] = {}
        self._script_buf: List[str] = []
        self._in_title = False
        self._current_label_for: Optional[str] = None
        self._label_buf: List[str] = []
        self._labels: Dict[str, str] = {}  # for-attr -> text (order-independent)
        self._banner_depth = 0
        self._clickable: Optional[Dict[str, Any]] = None

    @staticmethod
    def _attrs(attrs: List[Tuple[str, Optional[str]]]) -> Dict[str, str]:
        return {k.lower(): (v or "") for k, v in attrs}

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        a = self._attrs(attrs)
        if tag == "script":
            self._in_script = True
            self._script_attrs = a
            self._script_buf = []
        elif tag == "iframe":
            self.page.iframes.append({"src": a.get("src", ""), "attrs": a})
        elif tag == "img":
            self.page.images.append({"src": a.get("src", ""), "width": a.get("width", ""), "height": a.get("height", ""), "attrs": a})
        elif tag == "input" and a.get("type", "").lower() == "checkbox":
            self.page.checkboxes.append({
                "name": a.get("name", ""),
                "id": a.get("id", ""),
                "checked": "checked" in a,
                "context": " ".join([a.get("name", ""), a.get("id", ""), a.get("class", ""), a.get("aria-label", "")]),
                "label": self._labels.get(a.get("id", ""), ""),
            })
        elif tag == "form":
            self.page.forms.append({"action": a.get("action", ""), "attrs": a})
        elif tag == "label":
            self._current_label_for = a.get("for")
            self._label_buf = []
        elif tag in ("a", "button"):
            classes = a.get("class", "") + " " + a.get("id", "")
            hidden = bool(HIDDEN_STYLE_RE.search(a.get("style", ""))) or "hidden" in a
            self._clickable = {
                "tag": tag, "text": "", "hidden": hidden,
                "href": a.get("href", ""), "classes": classes.strip(),
                "type": a.get("type", ""),
            }
        if self._clickable is None and CONSENT_BANNER_RE.search(
                " ".join(f'{k}="{v}"' for k, v in attrs)):
            self._banner_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._in_script:
            self.page.scripts.append({
                "src": self._script_attrs.get("src", ""),
                "inline": "".join(self._script_buf),
                "attrs": self._script_attrs,
            })
            self._in_script = False
        elif tag == "label" and self._current_label_for is not None:
            text = " ".join("".join(self._label_buf).split())
            self._labels[self._current_label_for] = text
            for cb in self.page.checkboxes:
                if cb["id"] and cb["id"] == self._current_label_for and not cb["label"]:
                    cb["label"] = text
            self._current_label_for = None
        elif tag in ("a", "button") and self._clickable is not None:
            self._clickable["text"] = " ".join(self._clickable["text"].split())
            self.page.clickables.append(self._clickable)
            self._clickable = None

    def handle_data(self, data: str) -> None:
        if self._in_script:
            self._script_buf.append(data)
        if self._in_title:
            self.page.title += data
        if self._current_label_for is not None:
            self._label_buf.append(data)
        if self._clickable is not None:
            self._clickable["text"] += " " + data

    def handle_startendtag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        # void elements like <img/> <input/>
        if tag in ("img", "input", "iframe"):
            self.handle_starttag(tag, attrs)


def parse_page(html: str) -> PageModel:
    collector = PageCollector()
    try:
        collector.feed(html)
        collector.close()
    except Exception as exc:  # malformed markup must not abort the scan
        log.debug("HTML parse warning: %s", exc)
    return collector.page


# ── Signature matching ─────────────────────────────────────────────────────────
def match_pattern(pattern: Optional[str], value: str) -> bool:
    """Regex-first, substring-fallback matcher (case-insensitive).

    Seeds store regexes in script_url_pattern/inline_pattern/cookie_name_pattern
    and plain substrings in domain_pattern; both work here.
    """
    if not pattern or not value:
        return False
    try:
        if re.search(pattern, value, re.IGNORECASE):
            return True
    except re.error:
        pass
    return pattern.lower() in value.lower()


def match_tracker(signatures: List[Dict[str, Any]], url: str = "",
                  inline_body: str = "", cookie_name: str = "") -> Optional[Dict[str, Any]]:
    host = urlparse(url).netloc.lower() if url else ""
    for sig in signatures:
        if host and sig.get("domain_pattern") and match_pattern(sig["domain_pattern"], host):
            return sig
        if url and sig.get("script_url_pattern") and match_pattern(sig["script_url_pattern"], url):
            return sig
        if inline_body and sig.get("inline_pattern") and match_pattern(sig["inline_pattern"], inline_body):
            return sig
        if cookie_name and sig.get("cookie_name_pattern") and match_pattern(sig["cookie_name_pattern"], cookie_name):
            return sig
    return None


def script_is_gated(attrs: Dict[str, str]) -> bool:
    """True when a CMP has neutralised the tag (cannot fire pre-consent)."""
    s_type = (attrs.get("type") or "").strip()
    if s_type and GATED_SCRIPT_TYPE_RE.match(s_type):
        return True
    return any(GATED_SCRIPT_ATTR_RE.match(k) for k in attrs)


# ── Detection passes ───────────────────────────────────────────────────────────
def detect_trackers(page: PageModel, base_url: str,
                    signatures: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Find third-party trackers and whether they fire pre-consent."""
    found: List[Dict[str, Any]] = []
    seen: set = set()

    def add(sig: Dict[str, Any], url: str, kind: str, gated: bool) -> None:
        key = (sig["tracker_name"], url, kind)
        if key in seen:
            return
        seen.add(key)
        found.append({
            "tracker_name": sig["tracker_name"],
            "vendor": sig.get("vendor"),
            "category": sig.get("category"),
            "severity": sig.get("default_severity", "medium"),
            "url": url, "kind": kind, "gated": gated,
        })

    for script in page.scripts:
        src = script.get("src", "")
        if src:
            full = urljoin(base_url, src)
            sig = match_tracker(signatures, url=full)
            if sig:
                add(sig, full, "script", script_is_gated(script.get("attrs", {})))
        inline = script.get("inline") or ""
        if inline and len(inline) < 200_000:
            sig = match_tracker(signatures, inline_body=inline)
            if sig:
                add(sig, base_url, "inline_script", script_is_gated(script.get("attrs", {})))
    for iframe in page.iframes:
        src = iframe.get("src", "")
        if src:
            full = urljoin(base_url, src)
            sig = match_tracker(signatures, url=full)
            if sig:
                add(sig, full, "iframe", False)
    for img in page.images:
        src = img.get("src", "")
        if not src:
            continue
        full = urljoin(base_url, src)
        sig = match_tracker(signatures, url=full)
        if sig:
            add(sig, full, "pixel", False)
        else:
            # 1x1 invisible pixel heuristic even without a signature match
            try:
                w, h = int(img.get("width") or 0), int(img.get("height") or 0)
            except ValueError:
                w = h = 0
            if (w, h) == (1, 1) and urlparse(full).netloc != urlparse(base_url).netloc:
                found.append({
                    "tracker_name": "unknown-1x1-pixel", "vendor": None,
                    "category": "other", "severity": "low",
                    "url": full, "kind": "pixel", "gated": False,
                })
    return found


def detect_consent_banner(html: str, page: PageModel) -> Dict[str, Any]:
    """Consent banner / CMP presence check."""
    m = CONSENT_BANNER_RE.search(html)
    if m:
        return {"present": True, "via": "markup", "marker": m.group(0)[:120]}
    t = CONSENT_TEXT_RE.search(html)
    if t:
        return {"present": True, "via": "text", "marker": t.group(0)[:120]}
    return {"present": False, "via": None, "marker": None}


def detect_dark_patterns(html: str, page: PageModel) -> List[Dict[str, Any]]:
    """Dark-pattern heuristics: pre-ticked boxes, asymmetric choice, forced account."""
    findings: List[Dict[str, Any]] = []
    for cb in page.checkboxes:
        if not cb["checked"]:
            continue
        context = f"{cb['context']} {cb.get('label', '')}"
        if PRETICKED_CONTEXT_RE.search(context):
            findings.append({
                "finding_type": "dark_pattern_preticked",
                "severity": "high",
                "detail": f"Pre-ticked checkbox '{cb['name'] or cb['id']}' ({(cb.get('label') or '').strip()[:80]})",
                "element": {"name": cb["name"], "id": cb["id"], "label": (cb.get("label") or "")[:160]},
            })
    accepts = [c for c in page.clickables if ACCEPT_LABEL_RE.match(c.get("text", ""))]
    rejects = [c for c in page.clickables if REJECT_LABEL_RE.search(c.get("text", ""))]
    visible_rejects = [c for c in rejects if not c["hidden"]]
    if accepts and (not rejects or not visible_rejects):
        findings.append({
            "finding_type": "dark_pattern_asymmetric_choice",
            "severity": "high",
            "detail": ("Accept control present but reject control "
                       + ("is hidden/visually demoted" if rejects else "is absent")),
            "element": {
                "accept": [{"text": c["text"][:80], "tag": c["tag"]} for c in accepts[:3]],
                "reject": [{"text": c["text"][:80], "tag": c["tag"], "hidden": c["hidden"]} for c in rejects[:3]],
            },
        })
    m = FORCED_ACCOUNT_RE.search(html)
    if m:
        findings.append({
            "finding_type": "dark_pattern_forced_account",
            "severity": "medium",
            "detail": f"Forced account creation wall: '{m.group(0)[:120]}'",
            "element": {"matched_text": m.group(0)[:200]},
        })
    return findings


def analyze_cookies(set_cookie_headers: List[str],
                    signatures: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Classify Set-Cookie headers; non-essential cookies set on the initial
    (pre-consent) response are a finding."""
    results: List[Dict[str, Any]] = []
    for header in set_cookie_headers:
        parts = [p.strip() for p in header.split(";")]
        if not parts or "=" not in parts[0]:
            continue
        name, _, value = parts[0].partition("=")
        attrs = {p.split("=")[0].strip().lower(): (p.split("=", 1)[1] if "=" in p else True)
                 for p in parts[1:]}
        max_age = None
        if "max-age" in attrs:
            try:
                max_age = int(attrs["max-age"])
            except (TypeError, ValueError):
                max_age = None
        sig = match_tracker(signatures, cookie_name=name)
        essential = bool(ESSENTIAL_COOKIE_RE.match(name)) and not sig
        if not essential and max_age is None:
            # long-lived via Expires without essential-name match is still suspect;
            # session cookies with unknown names are treated as low-risk essential
            essential = "expires" not in attrs
        elif not essential and max_age is not None and max_age <= ESSENTIAL_MAX_AGE_SECONDS and not sig:
            essential = True
        results.append({
            "name": name,
            "essential": essential,
            "tracker_name": sig["tracker_name"] if sig else None,
            "category": sig.get("category") if sig else None,
            "max_age": max_age,
            "persistent": "expires" in attrs or max_age is not None,
            "secure": "secure" in attrs,
            "httponly": "httponly" in attrs,
            "samesite": attrs.get("samesite"),
            "value_sha256": hashlib.sha256(value.encode()).hexdigest() if value else None,
        })
    return results


# ── Hashing / fetch helpers ────────────────────────────────────────────────────
def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _fetch(url: str) -> Tuple[bytes, List[str], int, Dict[str, str]]:
    """GET with size cap; returns (body, set_cookie_headers, status, headers)."""
    with requests.get(url, timeout=REQUEST_TIMEOUT, stream=True,
                      headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,*/*"},
                      allow_redirects=True) as resp:
        limit = MAX_PAGE_BYTES
        buf = bytearray()
        for chunk in resp.iter_content(chunk_size=65536):
            buf.extend(chunk)
            if len(buf) >= limit:
                break
        # requests collapses Set-Cookie; pull raw list from the urllib3 response
        raw = getattr(resp.raw, "headers", None)
        if raw is not None and hasattr(raw, "getlist"):
            cookies = list(raw.getlist("Set-Cookie"))
        else:
            cookies = [resp.headers["Set-Cookie"]] if "Set-Cookie" in resp.headers else []
        return bytes(buf), cookies, resp.status_code, dict(resp.headers)


# ── Database (lazy psycopg2 — heuristics stay importable without it) ──────────
def _connect():
    if not DB_URL:
        raise RuntimeError("WORKER_DATABASE_URL/DATABASE_URL not configured")
    import psycopg2  # noqa: WPS433 — lazy by design (see module docstring)
    import psycopg2.extras  # noqa: F401
    return psycopg2.connect(DB_URL)


def db_health() -> Dict[str, Any]:
    if not DB_URL:
        return {"configured": False, "status": "UNCONFIGURED",
                "detail": "WORKER_DATABASE_URL/DATABASE_URL not set"}
    try:
        conn = _connect()
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM tracker_signatures WHERE active = TRUE")
            count = cur.fetchone()[0]
        conn.close()
        return {"configured": True, "status": "ok", "active_signatures": count}
    except Exception as exc:
        return {"configured": True, "status": "unreachable", "detail": str(exc)[:200]}


def load_signatures(conn) -> List[Dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT tracker_name, vendor, category, domain_pattern, script_url_pattern,
                      inline_pattern, cookie_name_pattern, default_severity
                 FROM tracker_signatures WHERE active = TRUE"""
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def load_active_suppressions(conn) -> List[Dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, scope, finding_type, tracker_name, target_id
                 FROM scan_suppressions
                WHERE status = 'approved'
                  AND (expires_at IS NULL OR expires_at > now())"""
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def is_suppressed(finding: Dict[str, Any], target_id: int,
                  suppressions: List[Dict[str, Any]]) -> Optional[int]:
    for s in suppressions:
        if s["scope"] == "finding_type" and s.get("finding_type") == finding["finding_type"]:
            if s.get("target_id") in (None, target_id):
                return s["id"]
        if s["scope"] == "tracker" and finding.get("tracker_name") and \
                s.get("tracker_name") == finding["tracker_name"]:
            if s.get("target_id") in (None, target_id):
                return s["id"]
    return None


def _relay(event: str, data: Dict[str, Any]) -> None:
    """Best-effort event relay to the NDSEP server (vault sealing hook)."""
    try:
        requests.post(RELAY_URL, json={"event": event, "data": data}, timeout=5)
    except Exception as exc:
        log.debug("relay failed (%s): %s", event, exc)


# ── Scan execution ─────────────────────────────────────────────────────────────
def scan_page(url: str, signatures: List[Dict[str, Any]],
              rendered_html: Optional[str] = None) -> Dict[str, Any]:
    """Fetch + analyse one page. `rendered_html` is an OPTIONAL hook for an
    external headless renderer; when absent the raw response body is used —
    the worker never requires a browser."""
    body, set_cookies, status, headers = _fetch(url)
    html = (rendered_html if rendered_html is not None else body).decode("utf-8", errors="replace")
    page = parse_page(html)
    trackers = detect_trackers(page, url, signatures)
    banner = detect_consent_banner(html, page)
    dark = detect_dark_patterns(html, page)
    cookies = analyze_cookies(set_cookies, signatures)
    return {
        "url": url, "http_status": status,
        "page_sha256": sha256_hex(body), "page_bytes": len(body),
        "headers_sha256": sha256_hex(json.dumps(headers, sort_keys=True).encode()),
        "trackers": trackers, "consent_banner": banner,
        "dark_patterns": dark, "cookies": cookies,
        "script_srcs": [urljoin(url, s["src"]) for s in page.scripts if s.get("src")],
    }


def execute_run(run_id: int) -> Dict[str, Any]:
    """Claim and execute one scan_runs row. Raises on DB/config failure —
    no silent success."""
    global _scans_completed, _scans_failed, _findings_written, _last_error
    conn = _connect()
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE scan_runs SET status = 'running', started_at = now()
                    WHERE id = %s AND status = 'scheduled'
                    RETURNING id, target_id, trigger_type""",
                (run_id,),
            )
            row = cur.fetchone()
            if not row:
                conn.rollback()
                return {"run_id": run_id, "status": "skipped", "reason": "not scheduled (already claimed?)"}
            cur.execute(
                """SELECT id, organization_id, controller_name, base_url, crawl_paths, max_pages
                     FROM scan_targets WHERE id = %s""",
                (row[1],),
            )
            target = cur.fetchone()
            if not target:
                conn.rollback()
                return {"run_id": run_id, "status": "failed", "reason": "target missing"}
        conn.commit()

        target_id, org_id, controller_name, base_url, crawl_paths, max_pages = target
        signatures = load_signatures(conn)
        if not signatures:
            raise RuntimeError("tracker_signatures table is empty — run migration 0083 (no silent fallback)")
        suppressions = load_active_suppressions(conn)

        paths = ["/"] + [p for p in (crawl_paths or []) if isinstance(p, str) and p != "/"]
        paths = paths[: max(1, int(max_pages or 5))]

        findings: List[Dict[str, Any]] = []
        artifacts: List[Dict[str, Any]] = []
        pages_scanned = 0
        trackers_total: set = set()

        with conn.cursor() as cur:
            for path in paths:
                page_url = urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))
                try:
                    result = scan_page(page_url, signatures)
                except Exception as exc:
                    findings.append({
                        "finding_type": "fetch_error", "severity": "info",
                        "url": page_url, "tracker_name": None,
                        "evidence": {"error": str(exc)[:400]},
                    })
                    continue
                pages_scanned += 1
                artifacts.append({"artifact_type": "page_html", "url": page_url,
                                  "sha256": result["page_sha256"], "size_bytes": result["page_bytes"],
                                  "metadata": {"http_status": result["http_status"],
                                               "headers_sha256": result["headers_sha256"]}})

                # script evidence hashes (bounded)
                for script_url in result["script_srcs"][:MAX_EXTERNAL_SCRIPTS]:
                    try:
                        sbody, _, sstatus, _ = _fetch(script_url)
                        if len(sbody) > MAX_SCRIPT_BYTES:
                            sbody = sbody[:MAX_SCRIPT_BYTES]
                        artifacts.append({"artifact_type": "script", "url": script_url,
                                          "sha256": sha256_hex(sbody), "size_bytes": len(sbody),
                                          "metadata": {"http_status": sstatus, "page_url": page_url}})
                    except Exception as exc:
                        log.debug("script fetch failed %s: %s", script_url, exc)

                banner = result["consent_banner"]
                pre_consent = [t for t in result["trackers"] if not t["gated"]]
                for t in pre_consent:
                    trackers_total.add(t["tracker_name"])
                if pre_consent and not banner["present"]:
                    for t in pre_consent:
                        findings.append({
                            "finding_type": "pre_consent_tracker", "severity": t["severity"],
                            "url": page_url, "tracker_name": t["tracker_name"],
                            "evidence": {**{k: t[k] for k in ("kind", "category", "vendor", "url") if t.get(k)},
                                         "consent_banner_present": False},
                        })
                elif pre_consent:
                    for t in pre_consent:
                        findings.append({
                            "finding_type": "tracker_detected", "severity": "info",
                            "url": page_url, "tracker_name": t["tracker_name"],
                            "evidence": {"kind": t["kind"], "category": t["category"],
                                         "consent_banner_present": True,
                                         "note": "banner present but tag not CMP-gated in served markup"},
                        })
                if not banner["present"]:
                    findings.append({
                        "finding_type": "missing_consent_banner",
                        "severity": "high" if result["trackers"] else "medium",
                        "url": page_url, "tracker_name": None,
                        "evidence": {"trackers_detected": sorted({t["tracker_name"] for t in result["trackers"]})},
                    })
                non_essential = [c for c in result["cookies"] if not c["essential"]]
                if non_essential:
                    artifacts.append({"artifact_type": "cookie_report", "url": page_url,
                                      "sha256": sha256_hex(json.dumps(result["cookies"], sort_keys=True).encode()),
                                      "size_bytes": None,
                                      "metadata": {"set_cookie_count": len(result["cookies"]),
                                                   "non_essential": len(non_essential)}})
                for c in non_essential:
                    findings.append({
                        "finding_type": "cookie_before_consent",
                        "severity": "high" if c.get("tracker_name") else "medium",
                        "url": page_url, "tracker_name": c.get("tracker_name"),
                        "evidence": {k: c[k] for k in ("name", "category", "persistent", "max_age", "samesite", "value_sha256")},
                    })
                for d in result["dark_patterns"]:
                    findings.append({
                        "finding_type": d["finding_type"], "severity": d["severity"],
                        "url": page_url, "tracker_name": None,
                        "evidence": {"detail": d["detail"], "element": d.get("element", {})},
                    })

            # persist artifacts
            artifact_ids: List[int] = []
            for a in artifacts:
                cur.execute(
                    """INSERT INTO scan_artifacts (run_id, target_id, artifact_type, url, sha256, size_bytes, metadata)
                       VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                       ON CONFLICT (run_id, artifact_type, sha256) DO NOTHING
                       RETURNING id""",
                    (run_id, target_id, a["artifact_type"], a["url"], a["sha256"],
                     a["size_bytes"], json.dumps(a["metadata"])),
                )
                r = cur.fetchone()
                if r:
                    artifact_ids.append(r[0])

            # persist findings (honouring approved suppressions)
            written = 0
            for f in findings:
                sup_id = is_suppressed(f, target_id, suppressions)
                status = "suppressed" if sup_id else "open"
                cur.execute(
                    """INSERT INTO scan_findings
                         (run_id, target_id, finding_type, severity, url, tracker_name, evidence, status, suppression_id)
                       VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)""",
                    (run_id, target_id, f["finding_type"], f["severity"], f["url"],
                     f.get("tracker_name"), json.dumps(f["evidence"]), status, sup_id),
                )
                written += 1

            cur.execute(
                """UPDATE scan_runs
                      SET status = 'completed', finished_at = now(), pages_scanned = %s,
                          trackers_detected = %s, findings_count = %s,
                          run_metadata = run_metadata || %s::jsonb
                    WHERE id = %s""",
                (pages_scanned, len(trackers_total), written,
                 json.dumps({"trackers": sorted(trackers_total), "artifacts": len(artifact_ids)}), run_id),
            )
            cur.execute("UPDATE scan_targets SET last_scanned_at = now(), updated_at = now() WHERE id = %s", (target_id,))
        conn.commit()
        _scans_completed += 1
        _findings_written += written
        _relay("ndsep.scan.completed", {
            "run_id": run_id, "target_id": target_id, "base_url": base_url,
            "pages_scanned": pages_scanned, "findings": written,
            "artifact_ids": artifact_ids[:50],
        })
        return {"run_id": run_id, "status": "completed", "pages_scanned": pages_scanned,
                "findings": written, "artifacts": len(artifact_ids),
                "trackers": sorted(trackers_total)}
    except Exception as exc:
        _scans_failed += 1
        _last_error = str(exc)[:400]
        log.exception("scan run %s failed", run_id)
        try:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE scan_runs SET status = 'failed', finished_at = now(), error = %s
                        WHERE id = %s AND status = 'running'""",
                    (str(exc)[:800], run_id),
                )
            conn.commit()
        except Exception:
            log.exception("failed to mark run %s as failed", run_id)
        raise
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ── Scheduler loop ─────────────────────────────────────────────────────────────
def claim_due_runs(limit: int = 3) -> List[int]:
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT r.id FROM scan_runs r
                     JOIN scan_targets t ON t.id = r.target_id
                    WHERE r.status = 'scheduled' AND r.scheduled_at <= now() AND t.enabled = TRUE
                    ORDER BY r.scheduled_at ASC LIMIT %s""",
                (limit,),
            )
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def schedule_due_targets(batch: int = 20) -> int:
    """Cron-style scheduling: create scan_runs for enabled targets whose
    scan_interval has elapsed and that have no open run."""
    conn = _connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO scan_runs (target_id, trigger_type, scheduled_at)
                   SELECT t.id, 'cron', now()
                     FROM scan_targets t
                    WHERE t.enabled = TRUE
                      AND (t.last_scanned_at IS NULL
                           OR t.last_scanned_at <= now() - (t.scan_interval_hours || ' hours')::interval)
                      AND NOT EXISTS (SELECT 1 FROM scan_runs r
                                       WHERE r.target_id = t.id
                                         AND r.status IN ('scheduled', 'running'))
                    LIMIT %s
                   RETURNING id""",
                (batch,),
            )
            n = len(cur.fetchall())
        conn.commit()
        return n
    finally:
        conn.close()


def _scheduler_loop() -> None:
    while True:
        try:
            if DB_URL:
                schedule_due_targets()
                for run_id in claim_due_runs():
                    try:
                        execute_run(run_id)
                    except Exception:
                        pass  # execute_run already recorded the failure loudly
        except Exception as exc:
            log.warning("scheduler tick failed: %s", exc)
        time.sleep(POLL_INTERVAL)


# ── HTTP surface ───────────────────────────────────────────────────────────────
def health_payload() -> Dict[str, Any]:
    db = db_health()
    status = "ok" if db["status"] == "ok" else ("UNCONFIGURED" if not db["configured"] else "degraded")
    return {
        "worker": "scan_crawler",
        "status": status,
        "uptime_seconds": round(time.time() - _worker_start, 1),
        "database": db,
        "scans_completed": _scans_completed,
        "scans_failed": _scans_failed,
        "findings_written": _findings_written,
        "last_error": _last_error,
        "config": {"poll_interval_s": POLL_INTERVAL, "request_timeout_s": REQUEST_TIMEOUT,
                   "max_page_bytes": MAX_PAGE_BYTES, "user_agent": USER_AGENT},
        "time": utcnow().isoformat(),
    }


class Handler(http.server.BaseHTTPRequestHandler):
    def _json(self, code: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:  # quiet access log
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
        if self.path == "/scan":
            run_id = body.get("run_id")
            if not isinstance(run_id, int):
                self._json(400, {"error": "run_id (int) required"})
                return
            if not DB_URL:
                self._json(503, {"status": "UNCONFIGURED", "error": "database URL not set"})
                return
            threading.Thread(target=self._run_safe, args=(run_id,), daemon=True).start()
            self._json(202, {"run_id": run_id, "status": "accepted"})
        elif self.path == "/scan-target":
            target_id = body.get("target_id")
            if not isinstance(target_id, int):
                self._json(400, {"error": "target_id (int) required"})
                return
            if not DB_URL:
                self._json(503, {"status": "UNCONFIGURED", "error": "database URL not set"})
                return
            try:
                conn = _connect()
                with conn.cursor() as cur:
                    cur.execute(
                        """INSERT INTO scan_runs (target_id, trigger_type, scheduled_at)
                           VALUES (%s, 'manual', now()) RETURNING id""",
                        (target_id,),
                    )
                    run_id = cur.fetchone()[0]
                conn.commit()
                conn.close()
            except Exception as exc:
                self._json(500, {"error": str(exc)[:300]})
                return
            threading.Thread(target=self._run_safe, args=(run_id,), daemon=True).start()
            self._json(202, {"run_id": run_id, "status": "accepted"})
        else:
            self._json(404, {"error": "not found"})

    @staticmethod
    def _run_safe(run_id: int) -> None:
        try:
            execute_run(run_id)
        except Exception:
            pass  # failure state is persisted on the run row


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    log.info("scan crawler worker starting on port %s (db configured: %s)", PORT, bool(DB_URL))
    threading.Thread(target=_scheduler_loop, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
