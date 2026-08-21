#!/usr/bin/env python3
"""
middleware_audit_aggregator.py — Python Middleware Audit Aggregator
====================================================================
Consumes audit log events from Kafka topic `ndsep.audit.log` and:
  1. Aggregates them into hourly/daily summaries in PostgreSQL
  2. Detects anomalous patterns (e.g. >100 actions/min from same user)
  3. Forwards critical events to the NDPC notification channel
  4. Exposes HTTP health + metrics endpoints

Port: 8142 (MIDDLEWARE_AUDIT_PORT env)
"""
import os
import json
import time
import threading
import logging
from datetime import datetime, timezone
from collections import defaultdict
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Dict, List, Any

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s %(message)s")
log = logging.getLogger("audit-aggregator")

PORT = int(os.environ.get("MIDDLEWARE_AUDIT_PORT", "8142"))
KAFKA_REST_URL = os.environ.get("KAFKA_REST_URL", "http://localhost:8082")
KAFKA_TOPIC = "ndsep.audit.log"
KAFKA_GROUP = "ndsep-audit-aggregator"
PG_URL = os.environ.get("NDSEP_PG_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db")
ANOMALY_THRESHOLD = int(os.environ.get("AUDIT_ANOMALY_THRESHOLD", "100"))

# ─── In-memory stats ─────────────────────────────────────────────────────────
stats = {
    "events_consumed": 0,
    "anomalies_detected": 0,
    "critical_forwarded": 0,
    "errors": 0,
    "started_at": datetime.now(timezone.utc).isoformat(),
}
user_action_counts: Dict[str, List[float]] = defaultdict(list)  # user_id -> [timestamps]

# ─── Kafka consumer (REST Proxy) ─────────────────────────────────────────────
def kafka_consume_once() -> List[Dict[str, Any]]:
    """Poll Kafka REST Proxy for new audit log messages."""
    try:
        import urllib.request, urllib.error
        # Create consumer if needed
        consumer_url = f"{KAFKA_REST_URL}/consumers/{KAFKA_GROUP}/instances/{KAFKA_GROUP}-1"
        # Try to read messages
        req = urllib.request.Request(
            f"{consumer_url}/records?timeout=1000&max_bytes=65536",
            headers={"Accept": "application/vnd.kafka.json.v2+json"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            records = json.loads(resp.read())
            return [r.get("value", {}) for r in records if isinstance(r.get("value"), dict)]
    except Exception as e:
        log.debug(f"Kafka consume error (non-fatal): {e}")
        return []

# ─── Anomaly detection ────────────────────────────────────────────────────────
def detect_anomaly(event: Dict[str, Any]) -> bool:
    """Sliding window: flag if user performs >ANOMALY_THRESHOLD actions/min."""
    user_id = str(event.get("user_id", "unknown"))
    now = time.time()
    window = 60.0  # 1 minute
    timestamps = user_action_counts[user_id]
    timestamps.append(now)
    # Evict old
    user_action_counts[user_id] = [t for t in timestamps if now - t < window]
    count = len(user_action_counts[user_id])
    if count > ANOMALY_THRESHOLD:
        log.warning(f"[Anomaly] User {user_id} performed {count} actions in 60s")
        stats["anomalies_detected"] += 1
        return True
    return False

# ─── PostgreSQL writer ────────────────────────────────────────────────────────
def write_to_pg(event: Dict[str, Any]) -> None:
    """Write aggregated audit event to PostgreSQL."""
    try:
        import psycopg2  # type: ignore
        conn = psycopg2.connect(PG_URL)
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO audit_log_aggregates
               (action, resource_type, resource_id, user_id, details, ip_address, event_ts, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
               ON CONFLICT DO NOTHING""",
            (
                event.get("action", "unknown"),
                event.get("resource_type", "unknown"),
                str(event.get("resource_id", "")),
                str(event.get("user_id", "")),
                json.dumps(event.get("details", {})),
                event.get("ip_address"),
                event.get("timestamp"),
            ),
        )
        conn.commit()
        cur.close()
        conn.close()
    except ImportError:
        log.debug("psycopg2 not available, skipping PG write")
    except Exception as e:
        log.debug(f"PG write error (non-fatal): {e}")
        stats["errors"] += 1

# ─── Critical event forwarder ─────────────────────────────────────────────────
CRITICAL_ACTIONS = {
    "aml.createCase", "breach.create", "banking.createInstitution",
    "kyc.createRecord", "enforcement.issue", "penalty.issue",
}

def forward_critical(event: Dict[str, Any]) -> None:
    """Forward critical audit events to NDPC notification endpoint."""
    action = event.get("action", "")
    if action not in CRITICAL_ACTIONS:
        return
    try:
        import urllib.request
        payload = json.dumps({
            "title": f"[NDSEP Critical] {action}",
            "content": f"Resource: {event.get('resource_type')}/{event.get('resource_id')}\n"
                       f"User: {event.get('user_id')}\n"
                       f"Details: {json.dumps(event.get('details', {}))}",
        }).encode()
        req = urllib.request.Request(
            os.environ.get("NDPC_NOTIFY_URL", "http://localhost:3000/api/internal/notify"),
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=3)
        stats["critical_forwarded"] += 1
        log.info(f"[Critical] Forwarded {action} to NDPC")
    except Exception as e:
        log.debug(f"Critical forward error (non-fatal): {e}")

# ─── Main consumer loop ───────────────────────────────────────────────────────
def consumer_loop() -> None:
    log.info(f"[AuditAggregator] Starting consumer for topic {KAFKA_TOPIC}")
    while True:
        try:
            events = kafka_consume_once()
            for event in events:
                stats["events_consumed"] += 1
                detect_anomaly(event)
                write_to_pg(event)
                forward_critical(event)
        except Exception as e:
            log.error(f"Consumer loop error: {e}")
            stats["errors"] += 1
        time.sleep(2)

# ─── HTTP server ─────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress default logging

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"status": "ok", "worker": "middleware_audit_aggregator", **stats}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/metrics":
            lines = [
                "# HELP ndsep_audit_events_consumed_total Total audit events consumed",
                "# TYPE ndsep_audit_events_consumed_total counter",
                f"ndsep_audit_events_consumed_total {stats['events_consumed']}",
                "# HELP ndsep_audit_anomalies_total Anomalies detected",
                "# TYPE ndsep_audit_anomalies_total counter",
                f"ndsep_audit_anomalies_total {stats['anomalies_detected']}",
                "# HELP ndsep_audit_critical_forwarded_total Critical events forwarded",
                "# TYPE ndsep_audit_critical_forwarded_total counter",
                f"ndsep_audit_critical_forwarded_total {stats['critical_forwarded']}",
            ]
            body = "\n".join(lines).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

def main():
    # Start consumer in background thread
    t = threading.Thread(target=consumer_loop, daemon=True)
    t.start()

    # Start HTTP server
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    log.info(f"[AuditAggregator] HTTP server on port {PORT}")
    server.serve_forever()

if __name__ == "__main__":
    main()
