#!/usr/bin/env python3
"""
NDSEP Watchlist Screener - Python Fallback v2.0
================================================
Python fallback for the Rust watchlist_screener binary.
Screens entities against watchlist_entries table with:
  - Fuzzy name matching (Levenshtein similarity)
  - Date of birth (DOB) matching for higher accuracy
  - Nationality/country matching to reduce false positives
  - Composite risk scoring (name + DOB + nationality)
  - Batch KYC screening with auto-flagging

HTTP endpoints:
  GET  /health   — liveness probe with metrics
  GET  /metrics  — Prometheus metrics
  POST /screen   — screen a single entity (JSON: {entity_name, dob?, nationality?, entity_type?})
  POST /screen/batch — screen multiple entities

Port: 8130 (WATCHLIST_SCREENER_PORT env)
"""

import os
import sys
import json
import time
import logging
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] watchlist_screener: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("watchlist_screener")

DB_DSN = os.environ.get(
    "DATABASE_URL",
    os.environ.get("LOCAL_DATABASE_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db")
)
WORKER_PORT = int(os.environ.get("WATCHLIST_SCREENER_PORT", "8130"))
SCREEN_INTERVAL = int(os.environ.get("SCREEN_INTERVAL_SECONDS", "45"))
FUZZY_THRESHOLD = float(os.environ.get("FUZZY_MATCH_THRESHOLD", "0.85"))
DOB_WEIGHT = float(os.environ.get("DOB_WEIGHT", "0.25"))        # extra weight when DOB matches
NATIONALITY_WEIGHT = float(os.environ.get("NATIONALITY_WEIGHT", "0.15"))  # extra weight when nationality matches

metrics = {
    "screens_total": 0,
    "matches_found": 0,
    "false_positives": 0,
    "dob_matches": 0,
    "nationality_matches": 0,
    "db_errors": 0,
    "last_screen_at": None,
    "uptime_start": datetime.now(timezone.utc).isoformat(),
    "status": "starting",
    "version": "2.0.0-python-fallback",
}


# ─── Fuzzy name matching ──────────────────────────────────────────────────────

def levenshtein(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return levenshtein(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr = [i + 1]
        for j, c2 in enumerate(s2):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (c1 != c2)))
        prev = curr
    return prev[len(s2)]


def similarity(s1: str, s2: str) -> float:
    """Alias for name_similarity — used by tests."""
    return name_similarity(s1, s2)


def name_similarity(s1: str, s2: str) -> float:
    s1, s2 = s1.lower().strip(), s2.lower().strip()
    if not s1 or not s2:
        return 0.0
    max_len = max(len(s1), len(s2))
    return 1.0 - levenshtein(s1, s2) / max_len


def normalize_name(name: str) -> str:
    """Normalize name: lowercase, remove punctuation, sort tokens for order-independent matching."""
    import re
    name = re.sub(r"[^\w\s]", "", name.lower().strip())
    tokens = sorted(name.split())
    return " ".join(tokens)


def best_name_score(candidate: str, watchlist_name: str, aliases: Optional[List[str]] = None) -> float:
    """Return the best similarity score across primary name and all aliases."""
    names = [watchlist_name] + (aliases or [])
    # Also try normalized (token-sorted) comparison
    norm_candidate = normalize_name(candidate)
    scores = []
    for n in names:
        scores.append(name_similarity(candidate, n))
        scores.append(name_similarity(norm_candidate, normalize_name(n)))
    return max(scores)


# ─── DOB matching ─────────────────────────────────────────────────────────────

def parse_dob(dob_str: Optional[str]) -> Optional[str]:
    """Normalize DOB to YYYY-MM-DD. Accepts YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY."""
    if not dob_str:
        return None
    dob_str = dob_str.strip()
    import re
    # Already YYYY-MM-DD
    if re.match(r"^\d{4}-\d{2}-\d{2}$", dob_str):
        return dob_str
    # DD/MM/YYYY
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", dob_str)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    # MM/DD/YYYY
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", dob_str)
    if m:
        return f"{m.group(3)}-{m.group(1)}-{m.group(2)}"
    # Year only
    m = re.match(r"^(\d{4})$", dob_str)
    if m:
        return f"{m.group(1)}-00-00"
    return None


def dob_match_score(candidate_dob: Optional[str], watchlist_dob: Optional[str]) -> float:
    """
    Returns a DOB match score:
      1.0 — exact full match (YYYY-MM-DD)
      0.7 — year-only match
      0.0 — no match or missing data
    """
    c = parse_dob(candidate_dob)
    w = parse_dob(watchlist_dob)
    if not c or not w:
        return 0.0
    if c == w:
        return 1.0
    # Year-only match
    if c[:4] == w[:4] and (c[5:] == "00-00" or w[5:] == "00-00"):
        return 0.7
    if c[:4] == w[:4]:
        return 0.5
    return 0.0


# ─── Nationality matching ─────────────────────────────────────────────────────

def nationality_match_score(candidate_nat: Optional[str], watchlist_nat: Optional[str]) -> float:
    """Returns 1.0 if nationalities match, 0.0 otherwise."""
    if not candidate_nat or not watchlist_nat:
        return 0.0
    return 1.0 if candidate_nat.strip().lower() == watchlist_nat.strip().lower() else 0.0


# ─── Composite screening ──────────────────────────────────────────────────────

def compute_composite_score(
    name_score: float,
    dob_score: float,
    nat_score: float,
) -> float:
    """
    Composite score = name_score + dob_bonus + nationality_bonus
    DOB and nationality provide additive bonuses to push borderline cases over threshold.
    """
    score = name_score
    if dob_score > 0:
        score += dob_score * DOB_WEIGHT
        metrics["dob_matches"] += 1
    if nat_score > 0:
        score += nat_score * NATIONALITY_WEIGHT
        metrics["nationality_matches"] += 1
    return min(score, 1.0)


def screen_entity(
    entity_name: str,
    entity_type: str = "individual",
    dob: Optional[str] = None,
    nationality: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Screen an entity against the watchlist_entries table.
    Applies fuzzy name matching + DOB matching + nationality matching.
    """
    result: Dict[str, Any] = {
        "entity_name": entity_name,
        "entity_type": entity_type,
        "dob": dob,
        "nationality": nationality,
        "screened_at": datetime.now(timezone.utc).isoformat(),
        "matches": [],
        "risk_level": "low",
        "requires_review": False,
        "screening_method": "fuzzy_name_dob_nationality",
        "version": "2.0.0",
    }
    try:
        import psycopg2
        conn = psycopg2.connect(DB_DSN)
        cur = conn.cursor()
        cur.execute("""
            SELECT id, primary_name, aliases, category, source, nationality,
                   date_of_birth
            FROM watchlist_entries WHERE is_active = TRUE LIMIT 5000
        """)
        for row in cur.fetchall():
            entry_id, primary_name, aliases_json, category, source, wl_nationality, wl_dob = row
            aliases: List[str] = []
            if aliases_json:
                try:
                    aliases = json.loads(aliases_json) if isinstance(aliases_json, str) else aliases_json
                except Exception:
                    pass

            # 1. Name similarity
            n_score = best_name_score(entity_name, primary_name, aliases)

            # 2. DOB matching
            d_score = dob_match_score(dob, wl_dob)

            # 3. Nationality matching
            nat_score = nationality_match_score(nationality, wl_nationality)

            # 4. Composite score
            composite = compute_composite_score(n_score, d_score, nat_score)

            # Only include if name score alone meets threshold OR composite meets threshold
            if n_score >= FUZZY_THRESHOLD or composite >= FUZZY_THRESHOLD:
                result["matches"].append({
                    "watchlist_id": str(entry_id),
                    "primary_name": primary_name,
                    "category": category,
                    "list_source": source,
                    "name_similarity": round(n_score, 4),
                    "dob_match_score": round(d_score, 4),
                    "nationality_match_score": round(nat_score, 4),
                    "composite_score": round(composite, 4),
                    "watchlist_nationality": wl_nationality,
                    "watchlist_dob": str(wl_dob) if wl_dob else None,
                    "match_factors": {
                        "name": n_score >= FUZZY_THRESHOLD,
                        "dob": d_score > 0,
                        "nationality": nat_score > 0,
                    },
                })

        cur.close()
        conn.close()

        if result["matches"]:
            # Sort by composite score descending
            result["matches"].sort(key=lambda m: m["composite_score"], reverse=True)
            cats = [m["category"] for m in result["matches"]]
            if any(c in ("sanctions", "terrorism", "proliferation") for c in cats):
                result["risk_level"] = "critical"
            elif any(c in ("pep", "adverse_media") for c in cats):
                result["risk_level"] = "high"
            else:
                result["risk_level"] = "medium"
            result["requires_review"] = True
            metrics["matches_found"] += 1

        metrics["screens_total"] += 1
        metrics["last_screen_at"] = datetime.now(timezone.utc).isoformat()

    except ImportError as e:
        logger.error("psycopg2 is required for authoritative watchlist screening")
        metrics["db_errors"] += 1
        raise RuntimeError("authoritative watchlist screening is unavailable") from e
    except Exception as e:
        logger.error(f"DB error during screening: {e}")
        metrics["db_errors"] += 1
        raise RuntimeError("authoritative watchlist screening failed") from e

    return result


# ─── Batch KYC screening ──────────────────────────────────────────────────────

def run_batch_screening() -> None:
    """Screen all pending/in_review KYC records, including DOB and nationality from DB."""
    logger.info("Starting batch screening cycle (v2 with DOB + nationality)")
    screened = 0
    try:
        import psycopg2
        conn = psycopg2.connect(DB_DSN)
        cur = conn.cursor()
        # Fetch KYC records with DOB and nationality if available
        cur.execute("""
            SELECT id, full_name, reference_id,
                   date_of_birth, nationality
            FROM kyc_records
            WHERE status IN ('pending', 'in_review') LIMIT 100
        """)
        rows = cur.fetchall()
        for row in rows:
            kyc_id = row[0]
            full_name = row[1]
            ref_id = row[2]
            dob = str(row[3]) if row[3] else None
            nationality = row[4] if len(row) > 4 else None

            if not full_name:
                continue

            result = screen_entity(full_name, "individual", dob=dob, nationality=nationality)

            if result["requires_review"]:
                cur.execute("""
                    UPDATE kyc_records
                    SET status = 'in_review',
                        notes = %s
                    WHERE id = %s
                """, (
                    json.dumps({
                        "watchlist_matches": result["matches"],
                        "screened_at": result["screened_at"],
                        "risk_level": result["risk_level"],
                        "dob_used": dob is not None,
                        "nationality_used": nationality is not None,
                    }),
                    kyc_id,
                ))
                logger.info(
                    f"Flagged KYC {ref_id} — risk={result['risk_level']} "
                    f"matches={len(result['matches'])} "
                    f"dob={'yes' if dob else 'no'} nat={'yes' if nationality else 'no'}"
                )
            screened += 1

        conn.commit()
        cur.close()
        conn.close()
    except ImportError:
        logger.warning("psycopg2 not available - batch screening skipped")
    except Exception as e:
        logger.error(f"Batch screening error: {e}")
        metrics["db_errors"] += 1

    logger.info(f"Batch screening complete: {screened} entities screened")
    metrics["status"] = "running"


# ─── HTTP server ──────────────────────────────────────────────────────────────

class HealthHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress default access log

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({
                **metrics,
                "worker": "watchlist_screener_fallback",
                "lang": "python",
                "fuzzy_threshold": FUZZY_THRESHOLD,
                "dob_weight": DOB_WEIGHT,
                "nationality_weight": NATIONALITY_WEIGHT,
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif self.path == "/metrics":
            lines = [
                "# HELP ndsep_watchlist_screens_total Total watchlist screens",
                "# TYPE ndsep_watchlist_screens_total counter",
                f"ndsep_watchlist_screens_total {metrics['screens_total']}",
                "# HELP ndsep_watchlist_matches_found Total matches found",
                "# TYPE ndsep_watchlist_matches_found counter",
                f"ndsep_watchlist_matches_found {metrics['matches_found']}",
                "# HELP ndsep_watchlist_dob_matches_total Matches with DOB confirmation",
                "# TYPE ndsep_watchlist_dob_matches_total counter",
                f"ndsep_watchlist_dob_matches_total {metrics['dob_matches']}",
                "# HELP ndsep_watchlist_nationality_matches_total Matches with nationality confirmation",
                "# TYPE ndsep_watchlist_nationality_matches_total counter",
                f"ndsep_watchlist_nationality_matches_total {metrics['nationality_matches']}",
                "# HELP ndsep_watchlist_db_errors_total DB errors",
                "# TYPE ndsep_watchlist_db_errors_total counter",
                f"ndsep_watchlist_db_errors_total {metrics['db_errors']}",
            ]
            body = "\n".join(lines).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            payload = json.loads(self.rfile.read(length))
        except Exception:
            self.send_response(400)
            self.end_headers()
            return

        if self.path == "/screen":
            result = screen_entity(
                entity_name=payload.get("entity_name", ""),
                entity_type=payload.get("entity_type", "individual"),
                dob=payload.get("dob"),
                nationality=payload.get("nationality"),
            )
            body = json.dumps(result).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif self.path == "/screen/batch":
            entities = payload.get("entities", [])
            results = []
            for e in entities[:50]:  # cap at 50 per batch request
                r = screen_entity(
                    entity_name=e.get("entity_name", ""),
                    entity_type=e.get("entity_type", "individual"),
                    dob=e.get("dob"),
                    nationality=e.get("nationality"),
                )
                results.append(r)
            body = json.dumps({"results": results, "count": len(results)}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        else:
            self.send_response(404)
            self.end_headers()


def start_http_server() -> None:
    server = HTTPServer(("0.0.0.0", WORKER_PORT), HealthHandler)
    logger.info(f"Health server listening on port {WORKER_PORT}")
    server.serve_forever()


def main() -> None:
    logger.info("NDSEP Watchlist Screener v2.0 (Python Fallback) starting...")
    logger.info(
        f"Config: fuzzy_threshold={FUZZY_THRESHOLD} dob_weight={DOB_WEIGHT} "
        f"nationality_weight={NATIONALITY_WEIGHT} screen_interval={SCREEN_INTERVAL}s"
    )
    metrics["status"] = "starting"

    http_thread = threading.Thread(target=start_http_server, daemon=True)
    http_thread.start()

    run_batch_screening()

    while True:
        try:
            time.sleep(SCREEN_INTERVAL)
            run_batch_screening()
        except KeyboardInterrupt:
            logger.info("Watchlist screener shutting down")
            sys.exit(0)
        except Exception as e:
            logger.error(f"Main loop error: {e}")
            metrics["status"] = "error"
            time.sleep(10)
            metrics["status"] = "running"


if __name__ == "__main__":
    main()
