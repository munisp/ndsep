#!/usr/bin/env python3.11
"""
NDSEP AI Governance Worker (Python)
=====================================
Monitors AI systems registered by organizations, performs risk assessments,
and flags systems that process personal data without proper governance.
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

logging.basicConfig(level=logging.INFO, format='[ai-governance] %(message)s')
log = logging.getLogger(__name__)

WORKER_ID = "ai-governance"
PORT = 8115
SCAN_INTERVAL = 120

DB_URL = os.environ.get(
    "WORKER_DATABASE_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
)

stats = {"systems_assessed": 0, "high_risk_flagged": 0, "last_run": None}

RISK_FACTORS = {
    "facial_recognition": 40,
    "biometric": 35,
    "credit_scoring": 30,
    "hiring": 25,
    "healthcare": 30,
    "surveillance": 35,
    "profiling": 20,
    "sentiment": 15,
    "recommendation": 10,
    "classification": 10,
    "nlp": 5,
    "analytics": 5,
}

def compute_ai_risk_score(system_name: str, purpose: str, data_types: list) -> int:
    score = 20  # base score
    combined = (system_name + " " + purpose).lower()
    for keyword, weight in RISK_FACTORS.items():
        if keyword in combined:
            score += weight
    if "personal" in str(data_types).lower():
        score += 15
    if "sensitive" in str(data_types).lower():
        score += 20
    return min(score, 100)

def assess_ai_systems():
    if not HAS_DB:
        return
    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        cur.execute("""
            SELECT id, organization_id, name as system_name, purpose, training_data_description as data_types, risk_level
            FROM ai_systems
            WHERE status IN ('registered', 'approved')
            AND (last_audit_at IS NULL OR last_audit_at < NOW() - INTERVAL '1 hour')
            LIMIT 20
        """)
        systems = cur.fetchall()
        
        for s in systems:
            data_types = s.get('data_types') or []
            risk_score = compute_ai_risk_score(
                s.get('system_name', ''),
                s.get('purpose', ''),
                data_types
            )
            
            # Map score to ai_risk_level enum: minimal | limited | high | unacceptable
            risk_level = 'minimal'
            if risk_score >= 80:
                risk_level = 'unacceptable'
                stats["high_risk_flagged"] += 1
            elif risk_score >= 60:
                risk_level = 'high'
                stats["high_risk_flagged"] += 1
            elif risk_score >= 30:
                risk_level = 'limited'
            # Map to security_alerts severity (different scale)
            alert_severity = 'critical' if risk_score >= 80 else 'high' if risk_score >= 60 else 'medium'
            
            cur.execute("""
                UPDATE ai_systems 
                SET risk_level = %s, risk_score = %s, last_assessed_at = NOW(), updated_at = NOW()
                WHERE id = %s
            """, (risk_level, risk_score, s['id']))
            
            # Create security alert for high-risk unregistered AI systems
            if risk_level in ('high', 'unacceptable') and not s.get('is_registered'):
                cur.execute("""
                    INSERT INTO security_alerts (organization_id, alert_type, severity, title, description, is_resolved, detected_at)
                    VALUES (%s, 'ai_governance', %s, %s, %s, false, NOW())
                """, (
                    s['organization_id'], alert_severity,
                    f"High-Risk AI System Detected: {s['system_name']}",
                    f"AI system '{s['system_name']}' has risk score {risk_score}/100 and is not properly registered with NDSEP"
                ))
            
            stats["systems_assessed"] += 1
        
        conn.commit()
        stats["last_run"] = datetime.now(timezone.utc).isoformat()
        
        if systems:
            log.info(f"Assessed {len(systems)} AI systems")
    
    except Exception as e:
        log.error(f"Error assessing AI systems: {e}")
    finally:
        try:
            conn.close()
        except:
            pass

def run_scanner():
    while True:
        try:
            assess_ai_systems()
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
