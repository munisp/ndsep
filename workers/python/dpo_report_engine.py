#!/usr/bin/env python3.11
"""
NDSEP DPO Report Template Engine (Python)
============================================
Generates semi-annual DPO report templates per GAID Art. 11-14.
Pre-populates report sections with data from the platform:
  - Privacy notices reviewed
  - DPIAs conducted
  - Rights exercises handled
  - Breach notifications filed
  - Training activities completed
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

logging.basicConfig(level=logging.INFO, format='[dpo-report-engine] %(message)s')
log = logging.getLogger(__name__)

WORKER_ID = "dpo-report-engine"
PORT = int(os.environ.get("DPO_REPORT_ENGINE_PORT", "8125"))
SCAN_INTERVAL = 120

DB_URL = os.environ.get(
    "WORKER_DATABASE_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
)

stats = {"reports_populated": 0, "sections_filled": 0, "last_run": None}


def get_db():
    if not HAS_DB:
        return None
    try:
        return psycopg2.connect(DB_URL)
    except Exception as e:
        log.warning(f"DB connection failed: {e}")
        return None


def populate_report_data(cur, report):
    """Pre-populate a DPO report with platform data for the reporting period."""
    org_id = report["organization_id"]
    period_start = report.get("period_start")
    period_end = report.get("period_end")
    sections_filled = 0

    if not period_start or not period_end:
        return 0

    # Privacy notices count
    cur.execute("""
        SELECT COUNT(*) FROM privacy_notices
        WHERE organization_id = %s AND created_at BETWEEN %s AND %s
    """, (org_id, period_start, period_end))
    privacy_count = cur.fetchone()[0]
    sections_filled += 1

    # DPIAs conducted
    cur.execute("""
        SELECT COUNT(*) FROM dpia_assessments
        WHERE organization_id = %s AND created_at BETWEEN %s AND %s
    """, (org_id, period_start, period_end))
    dpia_count = cur.fetchone()[0]
    sections_filled += 1

    # Breach notifications
    cur.execute("""
        SELECT COUNT(*) FROM data_breach_incidents
        WHERE organization_id = %s AND detected_at BETWEEN %s AND %s
    """, (org_id, period_start, period_end))
    breach_count = cur.fetchone()[0]
    sections_filled += 1

    # Training activities
    cur.execute("""
        SELECT COUNT(*), COALESCE(SUM(participant_count), 0)
        FROM staff_training
        WHERE organization_id = %s AND created_at BETWEEN %s AND %s
    """, (org_id, period_start, period_end))
    training_row = cur.fetchone()
    training_count = training_row[0]
    training_participants = training_row[1]
    sections_filled += 1

    # Rights exercises (from consent records as proxy)
    cur.execute("""
        SELECT COUNT(*) FROM consent_records
        WHERE organization_id = %s AND created_at BETWEEN %s AND %s
    """, (org_id, period_start, period_end))
    rights_count = cur.fetchone()[0]
    sections_filled += 1

    # Build auto-populated metadata
    auto_data = {
        "auto_populated": True,
        "populated_at": datetime.now(timezone.utc).isoformat(),
        "privacy_notices_count": privacy_count,
        "dpias_conducted": dpia_count,
        "breach_notifications": breach_count,
        "training_programs": training_count,
        "training_participants": training_participants,
        "rights_exercises": rights_count,
    }

    cur.execute("""
        UPDATE dpo_reports
        SET metadata = COALESCE(metadata, '{}') || %s::jsonb,
            privacy_notices_review = COALESCE(privacy_notices_review,
                %s),
            dpia_review = COALESCE(dpia_review,
                %s),
            breach_notifications = COALESCE(breach_notifications,
                %s),
            training_activities = COALESCE(training_activities,
                %s),
            updated_at = NOW()
        WHERE id = %s
    """, (
        json.dumps(auto_data),
        f"{privacy_count} privacy notices reviewed during reporting period.",
        f"{dpia_count} DPIAs conducted during reporting period.",
        f"{breach_count} breach incidents reported during period.",
        f"{training_count} training programs conducted with {training_participants} total participants.",
        report["id"],
    ))

    return sections_filled


def process_reports():
    conn = get_db()
    if not conn:
        return

    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Find draft reports that haven't been auto-populated
        cur.execute("""
            SELECT id, organization_id, period_start, period_end, report_status
            FROM dpo_reports
            WHERE report_status = 'draft'
            AND (metadata IS NULL OR NOT (metadata ? 'auto_populated'))
            ORDER BY created_at ASC
            LIMIT 20
        """)
        reports = cur.fetchall()

        for report in reports:
            sections = populate_report_data(cur, report)
            stats["sections_filled"] += sections
            stats["reports_populated"] += 1
            log.info(f"Auto-populated DPO report {report['id']} with {sections} sections")

        conn.commit()
        stats["last_run"] = datetime.now(timezone.utc).isoformat()

        if reports:
            log.info(f"Populated {len(reports)} DPO reports")

    except Exception as e:
        log.error(f"Error processing reports: {e}")
        conn.rollback()
    finally:
        conn.close()


def run_scanner():
    while True:
        try:
            process_reports()
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
    log.info(f"Starting DPO Report Engine on port {PORT}")
    threading.Thread(target=run_scanner, daemon=True).start()
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
