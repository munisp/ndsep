#!/usr/bin/env python3
"""
NDSEP Layer 4 — SIEM Alert Correlator (Python)
================================================
Simulates Wazuh + OpenCTI + OpenSearch integration for threat correlation.
Performs:
  - Wazuh rule-based alert generation with MITRE ATT&CK mapping
  - OpenCTI threat intelligence enrichment (IOC matching)
  - Full alert correlation chains (linking related alerts into incidents)
  - Behavior analysis and anomaly scoring (UEBA)
  - 7-year audit log generation (OpenSearch retention)
  - Incident lifecycle management (open -> investigating -> resolved)
  - Kill chain analysis and attack pattern detection

Writes to security_alerts, audit_logs, threat_intelligence tables.
Technology: Python · Wazuh · OpenCTI · OpenSearch · Elastic SIEM · MITRE ATT&CK
"""

import os
import time
import json
import random
import logging
import threading
import http.server
import socketserver
import collections
from datetime import datetime, timezone

import requests
import psycopg2

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

DB_URL = os.environ.get(
    "WORKER_DATABASE_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
)
RELAY_URL = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
PORT = int(os.environ.get("SIEM_PORT", "8086"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [NDSEP-SIEM] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Global State
# ─────────────────────────────────────────────────────────────────────────────

events_processed = 0
alerts_created = 0
audit_logs_written = 0
ioc_matches = 0
incidents_created = 0
correlations_made = 0
worker_start = time.time()

# Correlation window: track recent alerts per org for chaining
recent_alerts_by_org = collections.defaultdict(list)
recent_alerts_lock = threading.Lock()

# ─────────────────────────────────────────────────────────────────────────────
# Wazuh Rule Definitions with MITRE ATT&CK mapping
# ─────────────────────────────────────────────────────────────────────────────

WAZUH_RULES = [
    {"id": "100001", "name": "Unauthorized Access Attempt", "severity": "high",
     "category": "authentication", "mitre": "T1110", "tactic": "TA0006-Credential Access"},
    {"id": "100002", "name": "Privilege Escalation Detected", "severity": "critical",
     "category": "privilege_escalation", "mitre": "T1068", "tactic": "TA0004-Privilege Escalation"},
    {"id": "100003", "name": "Data Exfiltration Pattern", "severity": "critical",
     "category": "data_exfiltration", "mitre": "T1041", "tactic": "TA0010-Exfiltration"},
    {"id": "100004", "name": "Malware Signature Match", "severity": "high",
     "category": "malware", "mitre": "T1059", "tactic": "TA0002-Execution"},
    {"id": "100005", "name": "Brute Force Attack", "severity": "medium",
     "category": "brute_force", "mitre": "T1110.001", "tactic": "TA0006-Credential Access"},
    {"id": "100006", "name": "SQL Injection Attempt", "severity": "high",
     "category": "injection", "mitre": "T1190", "tactic": "TA0001-Initial Access"},
    {"id": "100007", "name": "Suspicious DNS Query", "severity": "medium",
     "category": "dns", "mitre": "T1071.004", "tactic": "TA0011-Command and Control"},
    {"id": "100008", "name": "C2 Beacon Detected", "severity": "critical",
     "category": "c2", "mitre": "T1071", "tactic": "TA0011-Command and Control"},
    {"id": "100009", "name": "Lateral Movement Detected", "severity": "high",
     "category": "lateral_movement", "mitre": "T1021", "tactic": "TA0008-Lateral Movement"},
    {"id": "100010", "name": "Anomalous User Behavior", "severity": "medium",
     "category": "ueba", "mitre": "T1078", "tactic": "TA0003-Persistence"},
    {"id": "100011", "name": "File Integrity Violation", "severity": "medium",
     "category": "fim", "mitre": "T1565", "tactic": "TA0040-Impact"},
    {"id": "100012", "name": "Rootkit Indicator", "severity": "critical",
     "category": "rootkit", "mitre": "T1014", "tactic": "TA0005-Defense Evasion"},
    {"id": "100013", "name": "Ransomware Behavior", "severity": "critical",
     "category": "ransomware", "mitre": "T1486", "tactic": "TA0040-Impact"},
    {"id": "100014", "name": "Credential Dumping", "severity": "critical",
     "category": "credential_access", "mitre": "T1003", "tactic": "TA0006-Credential Access"},
    {"id": "100015", "name": "Scheduled Task Created", "severity": "medium",
     "category": "persistence", "mitre": "T1053", "tactic": "TA0003-Persistence"},
]

# Kill chain correlation patterns: if these categories appear in sequence for same org,
# create a correlated incident
KILL_CHAIN_PATTERNS = [
    {
        "name": "APT Intrusion Chain",
        "severity": "critical",
        "pattern": ["authentication", "privilege_escalation", "lateral_movement", "data_exfiltration"],
        "description": "Full APT kill chain detected: initial access -> privilege escalation -> lateral movement -> exfiltration"
    },
    {
        "name": "Ransomware Attack Chain",
        "severity": "critical",
        "pattern": ["authentication", "credential_access", "ransomware"],
        "description": "Ransomware attack chain: credential access -> ransomware deployment"
    },
    {
        "name": "C2 Beaconing Chain",
        "severity": "high",
        "pattern": ["dns", "c2", "data_exfiltration"],
        "description": "C2 beaconing chain: suspicious DNS -> C2 beacon -> data exfiltration"
    },
    {
        "name": "Insider Threat Pattern",
        "severity": "high",
        "pattern": ["ueba", "data_exfiltration"],
        "description": "Insider threat pattern: anomalous user behavior followed by data exfiltration"
    },
]

OPENCTI_IOCS = [
    {"type": "ip", "value": "185.220.101.45", "threat": "TOR Exit Node", "confidence": 0.95},
    {"type": "ip", "value": "45.142.212.100", "threat": "Cobalt Strike C2", "confidence": 0.98},
    {"type": "domain", "value": "malicious-exfil.ru", "threat": "Data Exfiltration Domain", "confidence": 0.92},
    {"type": "hash", "value": "d41d8cd98f00b204e9800998ecf8427e", "threat": "Known Ransomware Hash", "confidence": 0.99},
    {"type": "ip", "value": "103.21.244.0", "threat": "APT28 Infrastructure", "confidence": 0.87},
    {"type": "domain", "value": "update-service.xyz", "threat": "Phishing Domain", "confidence": 0.91},
    {"type": "ip", "value": "91.108.4.0", "threat": "Lazarus Group C2", "confidence": 0.93},
    {"type": "hash", "value": "5f4dcc3b5aa765d61d8327deb882cf99", "threat": "Emotet Loader", "confidence": 0.96},
]

THREAT_ACTORS = [
    "APT28 (Fancy Bear)", "APT29 (Cozy Bear)", "Lazarus Group",
    "FIN7", "Carbanak", "DarkSide", "REvil", "Conti",
    "Scattered Spider", "BlackCat/ALPHV", "LockBit", "Cl0p"
]

ALERT_SOURCES = ["wazuh", "zeek", "suricata", "openappSec", "custom_rule", "elastic_siem"]

AUDIT_ACTIONS = [
    "user.login", "user.logout", "data.access", "data.export", "data.delete",
    "policy.update", "enforcement.action", "asset.scan", "report.generate",
    "admin.role_change", "api.key_created", "config.change", "user.password_reset",
    "data.download", "compliance.audit_run", "alert.acknowledge", "incident.create"
]

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_db():
    return psycopg2.connect(DB_URL)

def broadcast(event: str, data: dict):
    try:
        requests.post(RELAY_URL, json={"event": event, "data": data}, timeout=2)
    except Exception:
        pass

def random_ip():
    return f"{random.randint(1,254)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"

def get_org_ids(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT id, name FROM organizations LIMIT 20")
        return cur.fetchall()

def now_iso():
    return datetime.now(timezone.utc).isoformat()

# ─────────────────────────────────────────────────────────────────────────────
# Wazuh Alert Generator with MITRE ATT&CK mapping
# ─────────────────────────────────────────────────────────────────────────────

def run_wazuh_alert_generator():
    """Generates Wazuh-style security alerts with MITRE ATT&CK mapping."""
    global events_processed, alerts_created

    log.info("Starting Wazuh alert generator with MITRE ATT&CK mapping...")

    while True:
        try:
            if random.random() > 0.45:
                time.sleep(10)
                continue

            conn = get_db()
            conn.autocommit = True
            orgs = get_org_ids(conn)

            if not orgs:
                conn.close()
                time.sleep(10)
                continue

            org_id, org_name = random.choice(orgs)
            rule = random.choice(WAZUH_RULES)
            source_ip = random_ip()

            # IOC match check
            ioc_matched = None
            if random.random() < 0.18:
                ioc = random.choice(OPENCTI_IOCS)
                if ioc["type"] == "ip":
                    source_ip = ioc["value"]
                ioc_matched = ioc

            alert_source = random.choice(ALERT_SOURCES)
            title = f"[{alert_source.upper()}] {rule['name']}"
            description = (
                f"Wazuh Rule {rule['id']}: {rule['name']} detected for {org_name}. "
                f"Source IP: {source_ip}. MITRE ATT&CK: {rule['tactic']} ({rule['mitre']}). "
                f"Category: {rule['category']}."
            )
            if ioc_matched:
                description += (
                    f" OpenCTI IOC Match: {ioc_matched['threat']} "
                    f"(confidence: {ioc_matched['confidence']:.0%})"
                )

            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO security_alerts 
                        (organization_id, title, description, severity, source, alert_type, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                    RETURNING id
                """, (org_id, title, description, rule["severity"], alert_source, rule["category"]))
                alert_id = cur.fetchone()[0]

            alerts_created += 1
            events_processed += 1

            # Track for correlation
            with recent_alerts_lock:
                recent_alerts_by_org[org_id].append({
                    "id": alert_id,
                    "category": rule["category"],
                    "severity": rule["severity"],
                    "mitre": rule["mitre"],
                    "tactic": rule["tactic"],
                    "ts": time.time()
                })
                # Keep only last 20 alerts per org
                recent_alerts_by_org[org_id] = recent_alerts_by_org[org_id][-20:]

            broadcast("new_security_alert", {
                "type": "new_security_alert",
                "alertId": alert_id,
                "organizationId": org_id,
                "organizationName": org_name,
                "title": title,
                "description": description,
                "severity": rule["severity"],
                "source": alert_source,
                "wazuhRuleId": rule["id"],
                "mitreTechnique": rule["mitre"],
                "mitreTactic": rule["tactic"],
                "category": rule["category"],
                "sourceIp": source_ip,
                "iocMatch": ioc_matched,
                "timestamp": now_iso()
            })
            log.info(f"Alert [{rule['severity'].upper()}]: {rule['name']} for {org_name} [{rule['mitre']}]")
            conn.close()

        except Exception as e:
            log.error(f"Alert generator error: {e}")

        time.sleep(10)

# ─────────────────────────────────────────────────────────────────────────────
# Alert Correlation Engine — links related alerts into incidents
# ─────────────────────────────────────────────────────────────────────────────

def run_alert_correlator():
    """Correlates recent alerts into incidents using kill chain pattern matching."""
    global incidents_created, correlations_made

    log.info("Starting alert correlation engine (kill chain pattern matching)...")

    while True:
        time.sleep(25)
        try:
            conn = get_db()
            conn.autocommit = True
            orgs = get_org_ids(conn)

            for org_id, org_name in orgs:
                with recent_alerts_lock:
                    org_alerts = list(recent_alerts_by_org.get(org_id, []))

                if len(org_alerts) < 2:
                    continue

                # Get categories seen in the last 5 minutes
                cutoff = time.time() - 300
                recent_cats = [a["category"] for a in org_alerts if a["ts"] > cutoff]

                for pattern in KILL_CHAIN_PATTERNS:
                    matched_steps = [c for c in pattern["pattern"] if c in recent_cats]
                    match_ratio = len(matched_steps) / len(pattern["pattern"])

                    if match_ratio >= 0.6:  # 60% of kill chain steps matched
                        correlations_made += 1
                        incident_title = f"[INCIDENT] {pattern['name']} - {org_name}"
                        incident_desc = (
                            f"{pattern['description']}. "
                            f"Matched steps: {', '.join(matched_steps)} "
                            f"({len(matched_steps)}/{len(pattern['pattern'])} steps). "
                            f"Organization: {org_name}. "
                            f"Correlated {len(org_alerts)} recent alerts."
                        )

                        # Create a high-priority correlated alert
                        with conn.cursor() as cur:
                            cur.execute("""
                                INSERT INTO security_alerts
                                    (organization_id, title, description, severity, source, alert_type, created_at)
                                VALUES (%s, %s, %s, %s, 'SIEM-Correlator', 'incident', NOW())
                                RETURNING id
                            """, (org_id, incident_title, incident_desc, pattern["severity"]))
                            incident_id = cur.fetchone()[0]

                        incidents_created += 1

                        broadcast("incident_created", {
                            "type": "incident_created",
                            "incidentId": incident_id,
                            "organizationId": org_id,
                            "organizationName": org_name,
                            "patternName": pattern["name"],
                            "severity": pattern["severity"],
                            "matchedSteps": matched_steps,
                            "totalSteps": len(pattern["pattern"]),
                            "matchRatio": round(match_ratio, 2),
                            "correlatedAlerts": len(org_alerts),
                            "description": incident_desc,
                            "timestamp": now_iso()
                        })
                        log.info(
                            f"INCIDENT [{pattern['severity'].upper()}]: {pattern['name']} "
                            f"for {org_name} ({len(matched_steps)}/{len(pattern['pattern'])} steps)"
                        )
                        break  # One incident per org per cycle

            conn.close()

        except Exception as e:
            log.warning(f"Correlator error: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# UEBA — User and Entity Behavior Analytics
# ─────────────────────────────────────────────────────────────────────────────

def run_ueba_analyzer():
    """Analyzes user behavior patterns and generates anomaly scores."""
    log.info("Starting UEBA analyzer (User and Entity Behavior Analytics)...")

    while True:
        time.sleep(35)
        try:
            conn = get_db()
            conn.autocommit = True
            orgs = get_org_ids(conn)

            if not orgs:
                conn.close()
                continue

            org_id, org_name = random.choice(orgs)
            user_id = f"user-{random.randint(1, 200)}"
            anomaly_score = round(random.uniform(0, 1), 3)
            risk_level = "low" if anomaly_score < 0.4 else ("medium" if anomaly_score < 0.7 else "high")

            behaviors = []
            if anomaly_score > 0.5:
                behaviors.append(random.choice([
                    "off_hours_login", "unusual_data_volume", "new_geolocation",
                    "rapid_file_access", "privilege_use_spike", "failed_auth_spike"
                ]))
            if anomaly_score > 0.7:
                behaviors.append(random.choice([
                    "bulk_download", "sensitive_data_access", "admin_tool_use",
                    "lateral_movement_attempt", "credential_reuse"
                ]))

            broadcast("ueba_anomaly", {
                "type": "ueba_anomaly",
                "userId": user_id,
                "organizationId": org_id,
                "organizationName": org_name,
                "anomalyScore": anomaly_score,
                "riskLevel": risk_level,
                "behaviors": behaviors,
                "engine": "OpenSearch-UEBA",
                "timestamp": now_iso()
            })

            if anomaly_score > 0.75:
                title = f"[UEBA] High-Risk User Behavior: {user_id}"
                desc = (
                    f"UEBA anomaly score {anomaly_score:.3f} for {user_id} in {org_name}. "
                    f"Detected behaviors: {', '.join(behaviors)}."
                )
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO security_alerts
                            (organization_id, title, description, severity, source, alert_type, created_at)
                        VALUES (%s, %s, %s, 'high', 'UEBA-Engine', 'ueba', NOW())
                    """, (org_id, title, desc))
                log.info(f"UEBA Alert: {user_id} score={anomaly_score:.3f} [{', '.join(behaviors)}]")

            conn.close()

        except Exception as e:
            log.warning(f"UEBA error: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# Audit Log Writer (7-year retention)
# ─────────────────────────────────────────────────────────────────────────────

def run_audit_log_writer():
    """Continuously writes audit log entries (simulating OpenSearch 7-year retention)."""
    global audit_logs_written

    log.info("Starting audit log writer (7-year retention, OpenSearch)...")

    while True:
        try:
            conn = get_db()
            conn.autocommit = True
            orgs = get_org_ids(conn)

            if not orgs:
                conn.close()
                time.sleep(20)
                continue

            for _ in range(random.randint(2, 6)):
                org_id, org_name = random.choice(orgs)
                action = random.choice(AUDIT_ACTIONS)
                user_id = f"user-{random.randint(1, 100)}"
                result = random.choice(["success", "success", "success", "denied"])

                details = {
                    "action": action,
                    "organizationId": org_id,
                    "userId": user_id,
                    "ipAddress": random_ip(),
                    "userAgent": "NDSEP-Agent/1.4.2",
                    "result": result,
                    "resourceId": f"resource-{random.randint(1000, 9999)}",
                    "sessionId": f"sess-{random.randint(100000, 999999)}",
                    "retentionYears": 7
                }

                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO audit_logs 
                            (organization_id, action, details, ip_address, created_at)
                        VALUES (%s, %s, %s, %s, NOW())
                    """, (org_id, action, json.dumps(details), details["ipAddress"]))

                audit_logs_written += 1

            broadcast("audit_log_batch", {
                "type": "audit_log_batch",
                "count": random.randint(2, 6),
                "retention": "7 years",
                "engine": "OpenSearch",
                "timestamp": now_iso()
            })

            conn.close()

        except Exception as e:
            log.warning(f"Audit log writer error: {e}")

        time.sleep(18)

# ─────────────────────────────────────────────────────────────────────────────
# Threat Intelligence Enrichment (OpenCTI)
# ─────────────────────────────────────────────────────────────────────────────

def run_threat_intel_enrichment():
    """Enriches threat intelligence from OpenCTI feeds."""
    global ioc_matches

    log.info("Starting OpenCTI threat intelligence enrichment...")

    while True:
        try:
            conn = get_db()
            conn.autocommit = True
            ioc = random.choice(OPENCTI_IOCS)
            actor = random.choice(THREAT_ACTORS)

            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO threat_intelligence 
                        (indicator_type, indicator_value, threat_actor, confidence,
                         source, metadata, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT DO NOTHING
                """, (
                    ioc["type"],
                    ioc["value"],
                    actor,
                    ioc["confidence"],
                    "opencti",
                    json.dumps({
                        "threat": ioc["threat"],
                        "description": f"{ioc['threat']} associated with {actor}.",
                        "mitre_group": actor
                    })
                ))

            ioc_matches += 1
            broadcast("threat_intel_update", {
                "type": "threat_intel_update",
                "indicatorType": ioc["type"],
                "indicatorValue": ioc["value"],
                "threatActor": actor,
                "threat": ioc["threat"],
                "confidence": ioc["confidence"],
                "source": "OpenCTI",
                "timestamp": now_iso()
            })
            conn.close()

        except Exception as e:
            log.warning(f"Threat intel enrichment error: {e}")

        time.sleep(28)

# ─────────────────────────────────────────────────────────────────────────────
# HTTP Status Server
# ─────────────────────────────────────────────────────────────────────────────

class StatusHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"status": "ok", "worker": "siem_correlator"}).encode()
        elif self.path == "/status":
            body = json.dumps({
                "id": "siem-correlator",
                "name": "SIEM Alert Correlator",
                "layer": "L4",
                "language": "Python",
                "status": "running",
                "lastRun": now_iso(),
                "eventsProcessed": events_processed,
                "description": (
                    "Wazuh rule-based alert generation with MITRE ATT&CK mapping, "
                    "OpenCTI IOC enrichment, kill chain correlation, UEBA anomaly scoring, "
                    "and 7-year audit log retention via OpenSearch."
                ),
                "technology": "Python · Wazuh · OpenCTI · OpenSearch · MITRE ATT&CK · UEBA"
            }).encode()
        elif self.path == "/metrics":
            body = json.dumps({
                "eventsProcessed": events_processed,
                "alertsCreated": alerts_created,
                "auditLogsWritten": audit_logs_written,
                "iocMatches": ioc_matches,
                "incidentsCreated": incidents_created,
                "correlationsMade": correlations_made,
                "uptimeSeconds": round(time.time() - worker_start, 1)
            }).encode()
        else:
            self.send_response(404)
            self.end_headers()
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

def start_status_server():
    with socketserver.TCPServer(("", PORT), StatusHandler) as httpd:
        log.info(f"Status server listening on :{PORT}")
        httpd.serve_forever()

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("=== NDSEP Layer 4 SIEM Alert Correlator (Python) ===")
    log.info(f"Port: {PORT}")

    broadcast("worker_started", {
        "worker": "siem_correlator",
        "layer": "L4",
        "language": "Python",
        "timestamp": now_iso()
    })

    threading.Thread(target=run_wazuh_alert_generator, daemon=True).start()
    threading.Thread(target=run_alert_correlator, daemon=True).start()
    threading.Thread(target=run_ueba_analyzer, daemon=True).start()
    threading.Thread(target=run_audit_log_writer, daemon=True).start()
    threading.Thread(target=run_threat_intel_enrichment, daemon=True).start()

    start_status_server()
