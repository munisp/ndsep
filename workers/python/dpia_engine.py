#!/usr/bin/env python3.11
"""
NDSEP DPIA Risk Assessment Engine (Python)
=============================================
Automated Data Protection Impact Assessment scoring engine.
Evaluates DPIA submissions against risk criteria per GAID Art. 28:
  - AI profiling, health data, financial services, children's data
  - Cross-border transfers, large-scale processing
  - Calculates composite risk score and recommends NDPC consultation
"""
import os
import time
import json
import logging
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timezone

try:
    import psycopg2
    import psycopg2.extras
    HAS_DB = True
except ImportError:
    HAS_DB = False

logging.basicConfig(level=logging.INFO, format='[dpia-engine] %(message)s')
log = logging.getLogger(__name__)

WORKER_ID = "dpia-engine"
PORT = int(os.environ.get("DPIA_ENGINE_PORT", "8123"))
SCAN_INTERVAL = 45

DB_URL = os.environ.get(
    "WORKER_DATABASE_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
)

stats = {"dpias_scored": 0, "ndpc_referrals": 0, "last_run": None}

# Risk weights per trigger category (GAID Art. 28)
TRIGGER_WEIGHTS = {
    "ai_profiling": 30,
    "health_data": 25,
    "financial_services": 20,
    "children_data": 35,
    "biometric_data": 25,
    "large_scale_processing": 15,
    "systematic_monitoring": 20,
    "cross_border": 15,
    "new_technology": 10,
    "vulnerable_subjects": 25,
}

RISK_THRESHOLDS = {"low": 20, "medium": 40, "high": 65, "critical": 80}


def get_db():
    if not HAS_DB:
        return None
    try:
        return psycopg2.connect(DB_URL)
    except Exception as e:
        log.warning(f"DB connection failed: {e}")
        return None


def calculate_risk_score(trigger_categories, processing_description, cross_border=False):
    """Calculate composite DPIA risk score (0-100)."""
    score = 0
    if not trigger_categories:
        trigger_categories = []

    for trigger in trigger_categories:
        score += TRIGGER_WEIGHTS.get(trigger, 5)

    if cross_border:
        score += 15

    # Text-based heuristics on processing description
    desc_lower = (processing_description or "").lower()
    high_risk_keywords = ["profiling", "automated", "scoring", "surveillance", "biometric", "genetic", "children", "minor"]
    for kw in high_risk_keywords:
        if kw in desc_lower:
            score += 5

    return min(score, 100)


def determine_risk_level(score):
    if score >= RISK_THRESHOLDS["critical"]:
        return "critical"
    elif score >= RISK_THRESHOLDS["high"]:
        return "high"
    elif score >= RISK_THRESHOLDS["medium"]:
        return "medium"
    return "low"


def process_dpias():
    conn = get_db()
    if not conn:
        return

    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Find DPIAs in draft or in_review that need scoring
        cur.execute("""
            SELECT id, organization_id, assessment_title, trigger_categories,
                   processing_description, dpia_status, risk_level
            FROM dpia_assessments
            WHERE dpia_status IN ('draft', 'in_review')
            ORDER BY created_at ASC
            LIMIT 50
        """)
        dpias = cur.fetchall()

        for dpia in dpias:
            triggers = dpia.get("trigger_categories") or []
            if isinstance(triggers, str):
                try:
                    triggers = json.loads(triggers)
                except Exception:
                    triggers = []

            score = calculate_risk_score(
                triggers,
                dpia.get("processing_description", ""),
                cross_border=False
            )
            risk_level = determine_risk_level(score)

            # If critical risk, recommend NDPC consultation
            new_status = dpia["dpia_status"]
            if risk_level == "critical" and dpia["dpia_status"] != "requires_ndpc_consultation":
                new_status = "requires_ndpc_consultation"
                stats["ndpc_referrals"] += 1
                log.info(f"DPIA {dpia['id']} ({dpia['assessment_title']}) — CRITICAL risk ({score}), referred to NDPC")

            cur.execute("""
                UPDATE dpia_assessments
                SET risk_level = %s, dpia_status = %s,
                    metadata = jsonb_set(COALESCE(metadata, '{}'), '{risk_score}', %s::jsonb),
                    updated_at = NOW()
                WHERE id = %s
            """, (risk_level, new_status, json.dumps(score), dpia["id"]))

            stats["dpias_scored"] += 1

        conn.commit()
        stats["last_run"] = datetime.now(timezone.utc).isoformat()

        if dpias:
            log.info(f"Scored {len(dpias)} DPIAs")

    except Exception as e:
        log.error(f"Error processing DPIAs: {e}")
        conn.rollback()
    finally:
        conn.close()


def run_scanner():
    while True:
        try:
            process_dpias()
        except Exception as e:
            log.error(f"Scanner error: {e}")
        time.sleep(SCAN_INTERVAL)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            self._json({"status": "ok", "worker": WORKER_ID, **stats})
        elif self.path == "/metrics":
            self._json(stats)
        else:
            self.send_error(404)

    def _json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    log.info(f"Starting DPIA Risk Assessment Engine on port {PORT}")
    threading.Thread(target=run_scanner, daemon=True).start()
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
