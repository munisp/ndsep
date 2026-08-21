#!/usr/bin/env python3
"""
NDSEP Permify RBAC Sync Worker — Python
Port 8164 | Synchronizes NDSEP roles/permissions to Permify authorization engine
Implements: tenant-aware RBAC, sector-based permissions, dynamic policy updates
"""

import os
import json
import time
import logging
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.error import URLError
from urllib.parse import urlparse
import urllib.request
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] [permify-rbac-sync] %(message)s')
logger = logging.getLogger(__name__)

# ─── Config ────────────────────────────────────────────────────────────────

PORT = int(os.getenv("PERMIFY_SYNC_PORT", "8164"))
PERMIFY_URL = os.getenv("PERMIFY_URL", "http://localhost:3476")
PERMIFY_TENANT = os.getenv("PERMIFY_TENANT", "ndsep")
DB_URL = os.getenv("DATABASE_URL", "")
SYNC_INTERVAL = int(os.getenv("PERMIFY_SYNC_INTERVAL", "60"))

# ─── NDSEP Permission Schema ────────────────────────────────────────────────

NDSEP_SCHEMA = """
entity user {}

entity tenant {
    relation admin @user
    relation compliance_officer @user
    relation analyst @user
    relation auditor @user
    relation readonly @user

    permission view_dashboard = admin or compliance_officer or analyst or auditor or readonly
    permission manage_institutions = admin or compliance_officer
    permission manage_aml = admin or compliance_officer or analyst
    permission manage_kyc = admin or compliance_officer or analyst
    permission manage_fines = admin or compliance_officer
    permission manage_accreditation = admin or compliance_officer
    permission view_audit_trail = admin or auditor
    permission manage_users = admin
    permission export_reports = admin or compliance_officer or auditor
    permission manage_watchlist = admin or compliance_officer
    permission view_breach_notifications = admin or compliance_officer or auditor
    permission manage_breach_notifications = admin or compliance_officer
    permission cross_agency_share = admin or compliance_officer
    permission manage_sectors = admin or compliance_officer
    permission view_analytics = admin or compliance_officer or analyst or auditor
}

entity sector {
    relation regulator @user
    relation operator @user
    relation viewer @user

    permission manage = regulator
    permission operate = regulator or operator
    permission view = regulator or operator or viewer
    permission file_complaint = regulator or operator
    permission view_metrics = regulator or operator or viewer
}

entity institution {
    relation owner @user
    relation compliance_officer @user
    relation readonly @user

    permission manage = owner
    permission view_compliance = owner or compliance_officer or readonly
    permission submit_reports = owner or compliance_officer
    permission view_fines = owner or compliance_officer or readonly
}

entity aml_case {
    relation investigator @user
    relation supervisor @user
    relation readonly @user

    permission investigate = investigator or supervisor
    permission close = supervisor
    permission view = investigator or supervisor or readonly
    permission escalate = supervisor
}
"""

# ─── Metrics ───────────────────────────────────────────────────────────────

metrics = {
    "schema_pushes": 0,
    "relationship_writes": 0,
    "permission_checks": 0,
    "sync_cycles": 0,
    "errors": 0,
    "start_time": time.time(),
}

# ─── Permify Client ────────────────────────────────────────────────────────

def permify_request(method: str, path: str, body: dict = None) -> dict:
    url = f"{PERMIFY_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req = Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Tenant-Id", PERMIFY_TENANT)
    try:
        with urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except URLError as e:
        logger.warning(f"Permify not available ({url}): {e}")
        return {"degraded": True, "error": str(e)}
    except Exception as e:
        metrics["errors"] += 1
        logger.error(f"Permify request error: {e}")
        return {"error": str(e)}

def push_schema():
    """Push NDSEP RBAC schema to Permify"""
    result = permify_request("POST", f"/v1/tenants/{PERMIFY_TENANT}/schemas/write", {
        "schema": NDSEP_SCHEMA
    })
    if not result.get("degraded"):
        metrics["schema_pushes"] += 1
        logger.info(f"Schema pushed to Permify: {result.get('schema_version', 'unknown')}")
    return result

def write_relationship(entity_type: str, entity_id: str, relation: str, subject_type: str, subject_id: str):
    """Write a relationship tuple to Permify"""
    result = permify_request("POST", f"/v1/tenants/{PERMIFY_TENANT}/relationships/write", {
        "metadata": {"snap_token": ""},
        "tuples": [{
            "entity": {"type": entity_type, "id": entity_id},
            "relation": relation,
            "subject": {"type": subject_type, "id": subject_id},
        }]
    })
    if not result.get("degraded"):
        metrics["relationship_writes"] += 1
    return result

def check_permission(entity_type: str, entity_id: str, permission: str, subject_id: str) -> bool:
    """Check if a subject has a permission on an entity"""
    result = permify_request("POST", f"/v1/tenants/{PERMIFY_TENANT}/permissions/check", {
        "metadata": {"snap_token": "", "depth": 20},
        "entity": {"type": entity_type, "id": entity_id},
        "permission": permission,
        "subject": {"type": "user", "id": subject_id},
    })
    metrics["permission_checks"] += 1
    if result.get("degraded"):
        return True  # Fail open in degraded mode
    return result.get("can") == "CHECK_RESULT_ALLOWED"

def seed_default_relationships():
    """Seed default NDSEP relationships"""
    default_relationships = [
        # System admin has all permissions on default tenant
        ("tenant", "ndsep-default", "admin", "user", "system-admin"),
        # Sector regulators
        ("sector", "energy", "regulator", "user", "energy-regulator"),
        ("sector", "fintech", "regulator", "user", "fintech-regulator"),
        ("sector", "healthcare", "regulator", "user", "healthcare-regulator"),
        ("sector", "insurance", "regulator", "user", "insurance-regulator"),
        ("sector", "telecom", "regulator", "user", "telecom-regulator"),
        ("sector", "banking", "regulator", "user", "banking-regulator"),
    ]
    for entity_type, entity_id, relation, subject_type, subject_id in default_relationships:
        write_relationship(entity_type, entity_id, relation, subject_type, subject_id)
    logger.info(f"Seeded {len(default_relationships)} default relationships")

def sync_cycle():
    """Periodic sync cycle"""
    metrics["sync_cycles"] += 1
    logger.info(f"Sync cycle #{metrics['sync_cycles']} starting")
    push_schema()
    if metrics["sync_cycles"] == 1:
        seed_default_relationships()

def start_sync_thread():
    def run():
        while True:
            try:
                sync_cycle()
            except Exception as e:
                metrics["errors"] += 1
                logger.error(f"Sync cycle error: {e}")
            time.sleep(SYNC_INTERVAL)
    t = threading.Thread(target=run, daemon=True)
    t.start()

# ─── HTTP Handler ──────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json(self, data: dict, status: int = 200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        if self.path == "/health":
            self.send_json({
                "status": "healthy",
                "service": "ndsep-permify-rbac-sync",
                "version": "1.0.0",
                "uptime": time.time() - metrics["start_time"],
                "permify_url": PERMIFY_URL,
                "tenant": PERMIFY_TENANT,
                "sync_interval": SYNC_INTERVAL,
                "metrics": metrics,
            })
        elif self.path == "/metrics":
            lines = [
                f"ndsep_permify_schema_pushes_total {metrics['schema_pushes']}",
                f"ndsep_permify_relationship_writes_total {metrics['relationship_writes']}",
                f"ndsep_permify_permission_checks_total {metrics['permission_checks']}",
                f"ndsep_permify_sync_cycles_total {metrics['sync_cycles']}",
                f"ndsep_permify_errors_total {metrics['errors']}",
                f"ndsep_permify_uptime_seconds {time.time() - metrics['start_time']:.2f}",
            ]
            body = "\n".join(lines).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/schema":
            self.send_json({"schema": NDSEP_SCHEMA, "tenant": PERMIFY_TENANT})
        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        body = self.read_body()
        if self.path == "/relationships/write":
            result = write_relationship(
                body.get("entityType", "tenant"),
                body.get("entityId", ""),
                body.get("relation", ""),
                body.get("subjectType", "user"),
                body.get("subjectId", ""),
            )
            self.send_json({"success": True, "result": result})
        elif self.path == "/permissions/check":
            allowed = check_permission(
                body.get("entityType", "tenant"),
                body.get("entityId", "ndsep-default"),
                body.get("permission", ""),
                body.get("subjectId", ""),
            )
            self.send_json({"allowed": allowed, "permission": body.get("permission")})
        elif self.path == "/schema/push":
            result = push_schema()
            self.send_json({"success": True, "result": result})
        elif self.path == "/sync":
            sync_cycle()
            self.send_json({"success": True, "cycle": metrics["sync_cycles"]})
        else:
            self.send_json({"error": "not found"}, 404)

# ─── Main ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info(f"NDSEP Permify RBAC Sync starting on port {PORT}")
    logger.info(f"Permify URL: {PERMIFY_URL} | Tenant: {PERMIFY_TENANT}")
    start_sync_thread()
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
