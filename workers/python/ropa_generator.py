#!/usr/bin/env python3.11
"""
NDSEP ROPA Report Generator (Python)
=======================================
Generates Records of Processing Activities reports per NDPA S.44.
Aggregates processing activities by organization, validates completeness,
and flags missing fields required by the NDPA.
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

logging.basicConfig(level=logging.INFO, format='[ropa-generator] %(message)s')
log = logging.getLogger(__name__)

WORKER_ID = "ropa-generator"
PORT = int(os.environ.get("ROPA_GENERATOR_PORT", "8124"))
SCAN_INTERVAL = 90

DB_URL = os.environ.get(
    "WORKER_DATABASE_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
)

stats = {"reports_generated": 0, "completeness_checks": 0, "last_run": None}

REQUIRED_FIELDS = [
    "purpose", "ropa_lawful_basis", "data_categories",
    "data_subject_categories", "recipients", "retention_period",
    "security_measures",
]


def get_db():
    if not HAS_DB:
        return None
    try:
        return psycopg2.connect(DB_URL)
    except Exception as e:
        log.warning(f"DB connection failed: {e}")
        return None


def check_completeness(record):
    """Check ROPA record completeness against NDPA S.44 required fields."""
    missing = []
    for field in REQUIRED_FIELDS:
        val = record.get(field)
        if val is None or val == "" or val == [] or val == "[]":
            missing.append(field)
    completeness = ((len(REQUIRED_FIELDS) - len(missing)) / len(REQUIRED_FIELDS)) * 100
    return completeness, missing


def process_ropa_records():
    conn = get_db()
    if not conn:
        return

    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Get active ROPA records that need completeness validation
        cur.execute("""
            SELECT id, organization_id, activity_name, purpose,
                   ropa_lawful_basis, data_categories, data_subject_categories,
                   recipients, retention_period, security_measures,
                   cross_border_transfers, dpia_required, is_active
            FROM ropa_records
            WHERE is_active = true
            ORDER BY created_at DESC
            LIMIT 100
        """)
        records = cur.fetchall()

        for record in records:
            completeness, missing = check_completeness(record)
            stats["completeness_checks"] += 1

            # Update metadata with completeness score
            metadata = {
                "completeness_score": round(completeness, 1),
                "missing_fields": missing,
                "last_validated": datetime.now(timezone.utc).isoformat(),
            }

            cur.execute("""
                UPDATE ropa_records
                SET metadata = COALESCE(metadata, '{}') || %s::jsonb,
                    updated_at = NOW()
                WHERE id = %s
            """, (json.dumps(metadata), record["id"]))

            if completeness < 100:
                log.info(
                    f"ROPA {record['id']} ({record['activity_name']}): "
                    f"{completeness:.0f}% complete — missing: {', '.join(missing)}"
                )

        conn.commit()
        stats["reports_generated"] += 1
        stats["last_run"] = datetime.now(timezone.utc).isoformat()

        if records:
            log.info(f"Validated {len(records)} ROPA records")

    except Exception as e:
        log.error(f"Error processing ROPA records: {e}")
        conn.rollback()
    finally:
        conn.close()


def run_scanner():
    while True:
        try:
            process_ropa_records()
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
    log.info(f"Starting ROPA Report Generator on port {PORT}")
    threading.Thread(target=run_scanner, daemon=True).start()
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
