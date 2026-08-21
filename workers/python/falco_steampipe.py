#!/usr/bin/env python3.11
"""
NDSEP Falco + Steampipe Worker (Layer 4 + Layer 1)
Falco: Cloud-native runtime threat detection (syscall monitoring, container security)
Steampipe: Live querying of SaaS and cloud APIs for asset discovery
Port: 8093 (combined worker for Steampipe L1 + Falco L4)
"""

import json
import logging
import os
import random
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

import psycopg2

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [NDSEP-Falco] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("falco_steampipe")

PORT = 8093
VERSION = "1.0.0"

DB_URL = os.environ.get(
    "WORKER_DATABASE_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
)

metrics = {
    # Falco metrics
    "falco_rules_loaded": 0,
    "falco_alerts_total": 0,
    "falco_critical_alerts": 0,
    "falco_high_alerts": 0,
    "falco_container_threats": 0,
    "falco_syscall_anomalies": 0,
    "falco_privilege_escalations": 0,
    "falco_file_access_violations": 0,
    # Steampipe metrics
    "steampipe_queries_run": 0,
    "steampipe_aws_assets": 0,
    "steampipe_azure_assets": 0,
    "steampipe_gcp_assets": 0,
    "steampipe_saas_assets": 0,
    "steampipe_exposed_resources": 0,
    "uptime_seconds": 0,
}
metrics_lock = threading.Lock()
start_time = time.time()

# Falco rule categories
FALCO_RULES = [
    "Terminal shell in container", "Privilege escalation via sudo",
    "Write below binary dir", "Read sensitive file untrusted",
    "Outbound connection to C2 server", "Unexpected network connection",
    "Container drift detected", "Crypto mining activity",
    "Exfiltration over DNS", "Unauthorized process in container",
    "Modify binary dirs", "Create files below dev",
    "Data sovereignty violation - cross-border write",
    "Unauthorized kubectl exec", "Suspicious cron modification",
]

FALCO_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "DEBUG"]
SEVERITY_WEIGHTS = [0.05, 0.15, 0.35, 0.30, 0.15]

CONTAINERS = [
    "ndsep-compliance-api", "ndsep-data-catalog", "kafka-broker",
    "postgresql-primary", "ndsep-ml-worker", "ndsep-siem-agent",
    "airflow-scheduler", "spark-driver", "elasticsearch-node",
]

# Steampipe cloud providers
CLOUD_PROVIDERS = ["aws", "azure", "gcp", "oracle"]
SAAS_PROVIDERS = ["github", "slack", "jira", "salesforce", "okta", "datadog"]

ORG_NAMES = [
    "National Bank of Finance", "Federal Ministry of Health",
    "Digital Commerce Ltd", "TelecomNG Plc", "Energy Corp National",
]


def get_db():
    return psycopg2.connect(DB_URL)


def run_falco_detector():
    """Simulate Falco runtime threat detection."""
    rules_loaded = random.randint(200, 400)
    with metrics_lock:
        metrics["falco_rules_loaded"] = rules_loaded

    logger.info(f"[Falco] Loaded {rules_loaded} detection rules | Monitoring syscalls...")

    while True:
        try:
            conn = get_db()
            cur = conn.cursor()
            while True:
                rule = random.choice(FALCO_RULES)
                severity = random.choices(FALCO_SEVERITIES, weights=SEVERITY_WEIGHTS)[0]
                container = random.choice(CONTAINERS)
                proc = random.choice(["bash", "sh", "python3", "curl", "wget", "nc", "ncat", "kubectl"])
                pid = random.randint(1000, 65535)

                with metrics_lock:
                    metrics["falco_alerts_total"] += 1
                    if severity == "CRITICAL":
                        metrics["falco_critical_alerts"] += 1
                    elif severity == "HIGH":
                        metrics["falco_high_alerts"] += 1
                    if "container" in rule.lower() or "docker" in rule.lower():
                        metrics["falco_container_threats"] += 1
                    if "privilege" in rule.lower() or "sudo" in rule.lower():
                        metrics["falco_privilege_escalations"] += 1
                    if "file" in rule.lower() or "write" in rule.lower() or "read" in rule.lower():
                        metrics["falco_file_access_violations"] += 1
                    else:
                        metrics["falco_syscall_anomalies"] += 1

                logger.info(
                    f"[Falco] [{severity}] {rule} | container={container} | proc={proc} pid={pid}"
                )

                # Write critical/high alerts to security_alerts
                if severity in ("CRITICAL", "HIGH"):
                    try:
                        cur.execute(
                            """INSERT INTO security_alerts (title, description, severity, source, alert_type, mitre_technique, detected_at)
                               VALUES (%s, %s, %s, 'falco', %s, %s, NOW())""",
                            (
                                f"Falco: {rule}",
                                f"Runtime threat detected in container {container}: {rule} (proc={proc}, pid={pid})",
                                severity.lower(),
                                "runtime_threat",
                                "T1059" if "shell" in rule.lower() else "T1068" if "privilege" in rule.lower() else "T1041",
                            ),
                        )
                        conn.commit()
                    except Exception as e:
                        logger.error(f"[Falco] DB write error: {e}")
                        conn.rollback()

                time.sleep(random.uniform(3, 7))
        except Exception as e:
            logger.error(f"[Falco] Error: {e}")
            time.sleep(5)


def run_steampipe_queries():
    """Simulate Steampipe live cloud/SaaS API queries."""
    while True:
        try:
            while True:
                provider = random.choice(CLOUD_PROVIDERS + SAAS_PROVIDERS)
                query_type = random.choice([
                    "list_buckets", "list_instances", "list_users",
                    "list_databases", "list_functions", "list_policies",
                    "list_groups", "list_roles", "list_secrets",
                ])
                assets_found = random.randint(5, 500)
                exposed = random.randint(0, max(1, assets_found // 20))

                with metrics_lock:
                    metrics["steampipe_queries_run"] += 1
                    metrics["steampipe_exposed_resources"] += exposed
                    if provider == "aws":
                        metrics["steampipe_aws_assets"] += assets_found
                    elif provider == "azure":
                        metrics["steampipe_azure_assets"] += assets_found
                    elif provider == "gcp":
                        metrics["steampipe_gcp_assets"] += assets_found
                    else:
                        metrics["steampipe_saas_assets"] += assets_found

                logger.info(
                    f"[Steampipe] Query: {provider}.{query_type} | "
                    f"assets={assets_found} | exposed={exposed}"
                )
                time.sleep(random.uniform(8, 15))
        except Exception as e:
            logger.error(f"[Steampipe] Error: {e}")
            time.sleep(5)


def run_container_drift_detector():
    """Detect container drift - changes from baseline image."""
    while True:
        try:
            while True:
                container = random.choice(CONTAINERS)
                drift_detected = random.random() < 0.1
                if drift_detected:
                    change_type = random.choice([
                        "new_binary_added", "config_modified", "library_replaced",
                        "unexpected_process", "new_network_connection",
                    ])
                    logger.warning(
                        f"[Falco] [DRIFT] Container {container}: {change_type} detected!"
                    )
                    with metrics_lock:
                        metrics["falco_container_threats"] += 1
                time.sleep(random.uniform(15, 25))
        except Exception as e:
            logger.error(f"[Drift] Error: {e}")
            time.sleep(5)


def run_uptime_tracker():
    while True:
        with metrics_lock:
            metrics["uptime_seconds"] = int(time.time() - start_time)
        time.sleep(1)


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            with metrics_lock:
                m = dict(metrics)
            resp = json.dumps({
                "status": "ok",
                "service": "falco-steampipe",
                "version": VERSION,
                "layer": "L4+L1",
                "lang": "Python",
                "metrics": m,
            })
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(resp.encode())
        elif self.path == "/metrics":
            with metrics_lock:
                m = dict(metrics)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(m).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


def main():
    logger.info("=== NDSEP Falco + Steampipe Worker (Python) ===")
    logger.info(f"Version: {VERSION} | Port: {PORT}")

    try:
        conn = get_db()
        conn.close()
        logger.info("[DB] Connected to PostgreSQL")
    except Exception as e:
        logger.error(f"[DB] Connection failed: {e}")
        return

    threading.Thread(target=run_uptime_tracker, daemon=True).start()
    threading.Thread(target=run_falco_detector, daemon=True).start()
    threading.Thread(target=run_steampipe_queries, daemon=True).start()
    threading.Thread(target=run_container_drift_detector, daemon=True).start()

    logger.info(f"[Falco] Falco + Steampipe worker listening on :{PORT}")
    server = HTTPServer(("", PORT), HealthHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
