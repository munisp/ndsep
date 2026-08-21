#!/usr/bin/env python3.11
"""
NDSEP Remediation Engine Worker (Python)
==========================================
Monitors compliance violations and automatically assigns remediation actions.
Integrates with the LLM to generate remediation guidance.
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

logging.basicConfig(level=logging.INFO, format='[remediation-engine] %(message)s')
log = logging.getLogger(__name__)

WORKER_ID = "remediation-engine"
PORT = 8114
SCAN_INTERVAL = 60  # seconds

DB_URL = os.environ.get(
    "WORKER_DATABASE_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
)

stats = {"remediations_created": 0, "violations_processed": 0, "last_run": None}

REMEDIATION_RULES = {
    "data_residency": {
        "action": "localize_data",
        "priority": "critical",
        "description": "Move data to approved local storage within jurisdiction",
        "deadline_days": 7
    },
    "transfer_violation": {
        "action": "block_transfer",
        "priority": "high",
        "description": "Suspend cross-border transfer pending DPA approval",
        "deadline_days": 3
    },
    "encryption_missing": {
        "action": "encrypt_data",
        "priority": "high",
        "description": "Apply AES-256 encryption to all data at rest and in transit",
        "deadline_days": 14
    },
    "consent_missing": {
        "action": "obtain_consent",
        "priority": "medium",
        "description": "Collect valid data subject consent before processing",
        "deadline_days": 30
    },
    "retention_exceeded": {
        "action": "delete_data",
        "priority": "medium",
        "description": "Delete data that has exceeded its retention period",
        "deadline_days": 14
    },
    "access_control": {
        "action": "restrict_access",
        "priority": "high",
        "description": "Implement role-based access controls and audit logging",
        "deadline_days": 7
    },
}

def get_db():
    if not HAS_DB:
        return None
    try:
        conn = psycopg2.connect(DB_URL)
        return conn
    except Exception as e:
        log.warning(f"DB connection failed: {e}")
        return None

def process_violations():
    conn = get_db()
    if not conn:
        return
    
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        # Get unresolved violations without remediation workflows
        cur.execute("""
            SELECT cv.id, cv.organization_id, cv.title as violation_type, cv.severity, cv.description
            FROM compliance_violations cv
            WHERE cv.status IN ('non_compliant', 'under_review')
            AND NOT EXISTS (
                SELECT 1 FROM remediation_workflows rw 
                WHERE rw.violation_id = cv.id
            )
            LIMIT 20
        """)
        violations = cur.fetchall()
        
        for v in violations:
            vtype = v.get('violation_type', 'unknown')
            rule = REMEDIATION_RULES.get(vtype, {
                "action": "manual_review",
                "priority": "medium",
                "description": f"Manual review required for violation type: {vtype}",
                "deadline_days": 30
            })
            
            from datetime import timedelta
            deadline = datetime.now(timezone.utc) + timedelta(days=rule["deadline_days"])
            
            cur.execute("""
                INSERT INTO remediation_workflows 
                (violation_id, org_id, action_type, priority, description, status, deadline, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, 'pending', %s, NOW(), NOW())
                ON CONFLICT DO NOTHING
            """, (
                v['id'], v['organization_id'], rule['action'], rule['priority'],
                rule['description'], deadline
            ))
            
            stats["remediations_created"] += 1
        
        # Auto-close old resolved violations
        cur.execute("""
            UPDATE compliance_violations 
            SET status = 'resolved'
            WHERE status = 'non_compliant' 
            AND created_at < NOW() - INTERVAL '30 days'
            AND id IN (
                SELECT violation_id FROM remediation_workflows 
                WHERE status = 'completed'
            )
        """)
        
        conn.commit()
        stats["violations_processed"] += len(violations)
        stats["last_run"] = datetime.now(timezone.utc).isoformat()
        
        if violations:
            log.info(f"Processed {len(violations)} violations, created {len(violations)} remediation workflows")
    
    except Exception as e:
        log.error(f"Error processing violations: {e}")
        conn.rollback()
    finally:
        conn.close()

def run_scanner():
    while True:
        try:
            process_violations()
        except Exception as e:
            log.error(f"Scanner error: {e}")
        time.sleep(SCAN_INTERVAL)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
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
    log.info(f"Starting on port {PORT}")
    threading.Thread(target=run_scanner, daemon=True).start()
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
