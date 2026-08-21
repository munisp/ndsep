"""
NDSEP Evidence Expiry Cron Worker
===================================
Runs every 5 minutes. Marks evidence packages as 'expired' when their
expiresAt date has passed. Optionally logs expiry events to audit_logs.
"""
import os
import time
import logging
import threading
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import psycopg2
import psycopg2.extras

logging.basicConfig(level=logging.INFO, format="%(asctime)s [evidence-expiry-cron] %(message)s")
log = logging.getLogger(__name__)

DB_URL = os.environ.get("WORKER_DATABASE_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db")
PORT = int(os.environ.get("EXPIRY_CRON_PORT", "8116"))
INTERVAL_SECONDS = 300  # 5 minutes

expired_count = 0
last_run_at = None
last_run_expired = 0


def get_conn():
    return psycopg2.connect(DB_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def run_expiry_check():
    global expired_count, last_run_at, last_run_expired
    try:
        conn = get_conn()
        cur = conn.cursor()
        now = datetime.now(timezone.utc)

        # Mark packages as expired
        cur.execute(
            """
            UPDATE evidence_packages
            SET status = 'expired'
            WHERE status = 'ready'
              AND expires_at IS NOT NULL
              AND expires_at < %s
            RETURNING id, package_type, organization_id
            """,
            (now,)
        )
        rows = cur.fetchall()
        count = len(rows)

        if count > 0:
            log.info(f"Marked {count} evidence package(s) as expired")
            # Write audit log entries for each expiry
            for row in rows:
                try:
                    cur.execute(
                        """
                        INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at)
                        VALUES (NULL, 'evidence.expired', 'evidence_package', %s, %s, %s)
                        """,
                        (
                            row["id"],
                            f"Evidence package #{row['id']} (type: {row['package_type']}) automatically expired",
                            now,
                        )
                    )
                except Exception as e:
                    log.warning(f"Could not write audit log for package #{row['id']}: {e}")

        conn.commit()
        cur.close()
        conn.close()

        expired_count += count
        last_run_at = now.isoformat()
        last_run_expired = count

    except Exception as e:
        log.error(f"Expiry check failed: {e}")


def cron_loop():
    log.info(f"Evidence expiry cron started — checking every {INTERVAL_SECONDS}s")
    while True:
        run_expiry_check()
        time.sleep(INTERVAL_SECONDS)


class HealthHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress access logs

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({
                "status": "ok",
                "worker": "evidence-expiry-cron",
                "total_expired": expired_count,
                "last_run_at": last_run_at,
                "last_run_expired": last_run_expired,
                "interval_seconds": INTERVAL_SECONDS,
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/metrics":
            body = json.dumps({
                "total_expired": expired_count,
                "worker": "evidence-expiry-cron",
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/run":
            # Manual trigger
            run_expiry_check()
            body = json.dumps({"triggered": True, "expired": last_run_expired}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    # Start cron in background thread
    t = threading.Thread(target=cron_loop, daemon=True)
    t.start()

    # Start HTTP health server
    server = HTTPServer(("0.0.0.0", PORT), HealthHandler)
    log.info(f"Evidence expiry cron HTTP server on port {PORT}")
    server.serve_forever()
