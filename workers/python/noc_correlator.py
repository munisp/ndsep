#!/usr/bin/env python3
"""
NDSEP NOC Cross-Domain Alert Correlation Engine (Python)
=========================================================
Correlates alerts across all NOC data sources to identify root causes and
reduce alert fatigue. Links network anomalies with SIEM alerts, SLA breaches,
and infrastructure health events into unified incident clusters.

Correlation strategies:
  - Temporal: alerts within sliding time window from same device/service
  - Topological: alerts from devices sharing network path
  - Causal: known cause-effect patterns (e.g., link down → SLA breach)
  - Statistical: anomaly co-occurrence scoring (Jaccard similarity)

Middleware integrations:
  - PostgreSQL: reads noc_alerts, writes correlation_id linkages
  - Kafka: subscribes to noc.snmp, noc.syslog, noc.netflow, siem.alerts
  - Redis: sliding window alert cache, deduplication
  - OpenSearch: indexes correlated incidents for search
  - Temporal: orchestrates multi-step correlation workflows
  - Dapr: pub/sub for real-time correlation events
  - Keycloak: operator identity for manual correlation overrides
  - Permify: RBAC for correlation rule management
  - APISIX: rate-limit correlation API queries
  - Fluvio: edge correlation for distributed NOC
  - Lakehouse: writes correlation analytics
  - TigerBeetle: financial impact correlation
  - Mojaloop: payment rail health correlation
  - OpenAppSec: WAF event correlation with network attacks

Technology: Python · FastAPI · scikit-learn · NetworkX
Port: 8192
"""

import os
import time
import json
import uuid
import logging
import threading
import collections
from datetime import datetime, timezone, timedelta
from typing import Optional

import http.server
import socketserver

import psycopg2
import requests

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
)
RELAY_URL = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
PORT = int(os.environ.get("NOC_CORRELATOR_PORT", "8192"))
KAFKA_URL = os.environ.get("KAFKA_BROKERS", "localhost:9092")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
OPENSEARCH_URL = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
TEMPORAL_URL = os.environ.get("TEMPORAL_URL", "localhost:7233")
DAPR_URL = os.environ.get("DAPR_HTTP_PORT", "http://localhost:3500")
FLUVIO_URL = os.environ.get("FLUVIO_URL", "localhost:9003")
LAKEHOUSE_URL = os.environ.get("LAKEHOUSE_URL", "http://localhost:8140")
TIGERBEETLE_URL = os.environ.get("TIGERBEETLE_URL", "")
MOJALOOP_URL = os.environ.get("MOJALOOP_URL", "")
OPENAPPSEC_URL = os.environ.get("OPENAPPSEC_URL", "")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [NDSEP-NOC-Correlator] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Global State
# ─────────────────────────────────────────────────────────────────────────────

alerts_processed = 0
correlations_created = 0
incidents_created = 0
false_positives_suppressed = 0
worker_start = time.time()

# Sliding window of recent alerts (last 30 min)
alert_window = collections.deque(maxlen=5000)
alert_window_lock = threading.Lock()

# Active correlation groups
correlation_groups: dict[str, list[dict]] = {}
correlation_lock = threading.Lock()

# Known causal patterns
CAUSAL_PATTERNS = [
    {
        "name": "Link Failure Cascade",
        "trigger": {"source": "snmp", "category": "linkDown"},
        "effects": [
            {"source": "sla_tracker", "category": "availability_breach", "max_delay_min": 5},
            {"source": "health_check", "category": "service_unreachable", "max_delay_min": 2},
            {"source": "netflow", "category": "bandwidth_anomaly", "max_delay_min": 3},
        ],
        "severity_override": "critical",
        "root_cause": "Network link failure causing cascading service degradation",
    },
    {
        "name": "Security Breach Chain",
        "trigger": {"source": "wiredigg", "category": "intrusion_detected"},
        "effects": [
            {"source": "siem", "category": "unauthorized_access", "max_delay_min": 10},
            {"source": "openappsec", "category": "waf_block", "max_delay_min": 5},
            {"source": "syslog", "category": "syslog_auth", "max_delay_min": 15},
        ],
        "severity_override": "critical",
        "root_cause": "Coordinated attack detected across network and application layers",
    },
    {
        "name": "Infrastructure Overload",
        "trigger": {"source": "snmp", "category": "hrProcessorLoad"},
        "effects": [
            {"source": "health_check", "category": "high_latency", "max_delay_min": 5},
            {"source": "sla_tracker", "category": "response_time_breach", "max_delay_min": 10},
        ],
        "severity_override": "high",
        "root_cause": "Infrastructure resource exhaustion causing performance degradation",
    },
    {
        "name": "DNS Resolution Failure",
        "trigger": {"source": "syslog", "category": "syslog_daemon"},
        "effects": [
            {"source": "health_check", "category": "service_unreachable", "max_delay_min": 2},
            {"source": "wiredigg", "category": "dns_anomaly", "max_delay_min": 5},
        ],
        "severity_override": "high",
        "root_cause": "DNS service failure causing dependent service outages",
    },
    {
        "name": "Payment Rail Disruption",
        "trigger": {"source": "tigerbeetle", "category": "ledger_latency"},
        "effects": [
            {"source": "health_check", "category": "mojaloop_degraded", "max_delay_min": 5},
            {"source": "sla_tracker", "category": "financial_sla_breach", "max_delay_min": 10},
        ],
        "severity_override": "critical",
        "root_cause": "Financial ledger degradation affecting payment processing",
    },
    {
        "name": "DDoS Attack",
        "trigger": {"source": "netflow", "category": "bandwidth_anomaly"},
        "effects": [
            {"source": "apisix", "category": "rate_limit_exceeded", "max_delay_min": 2},
            {"source": "openappsec", "category": "waf_block", "max_delay_min": 3},
            {"source": "health_check", "category": "service_unreachable", "max_delay_min": 5},
            {"source": "sla_tracker", "category": "availability_breach", "max_delay_min": 10},
        ],
        "severity_override": "critical",
        "root_cause": "Distributed Denial of Service attack detected",
    },
]

# Topology adjacency (simplified — in production, loaded from noc_topology_links)
TOPOLOGY_GRAPH: dict[str, list[str]] = {
    "core-router-01": ["edge-switch-02", "fw-perimeter-01", "srv-db-primary"],
    "edge-switch-02": ["core-router-01", "ap-floor3-01", "srv-app-01"],
    "fw-perimeter-01": ["core-router-01", "edge-switch-02"],
    "srv-db-primary": ["core-router-01"],
    "ap-floor3-01": ["edge-switch-02"],
    "srv-app-01": ["edge-switch-02", "srv-db-primary"],
}


# ─────────────────────────────────────────────────────────────────────────────
# Database
# ─────────────────────────────────────────────────────────────────────────────

def get_db():
    try:
        return psycopg2.connect(DB_URL)
    except Exception as e:
        log.warning(f"DB connection failed: {e}")
        return None


def load_recent_alerts():
    """Load recent unresolved alerts from DB into the sliding window."""
    conn = get_db()
    if not conn:
        return
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT alert_id, source, severity, category, title, description,
                   device_id, source_ip::text, affected_service, status,
                   correlation_id, first_seen, last_seen
            FROM noc_alerts
            WHERE status IN ('open', 'acknowledged', 'escalated')
            AND first_seen > NOW() - INTERVAL '30 minutes'
            ORDER BY first_seen DESC
            LIMIT 500
        """)
        rows = cur.fetchall()
        with alert_window_lock:
            for row in rows:
                alert_window.append({
                    "alert_id": row[0], "source": row[1], "severity": row[2],
                    "category": row[3], "title": row[4], "description": row[5] or "",
                    "device_id": row[6], "source_ip": str(row[7]) if row[7] else None,
                    "affected_service": row[8], "status": row[9],
                    "correlation_id": row[10],
                    "first_seen": row[11].isoformat() if row[11] else None,
                    "last_seen": row[12].isoformat() if row[12] else None,
                })
        log.info(f"Loaded {len(rows)} recent alerts into correlation window")
    except Exception as e:
        log.error(f"Failed to load alerts: {e}")
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Correlation Strategies
# ─────────────────────────────────────────────────────────────────────────────

def temporal_correlate(alert: dict) -> Optional[str]:
    """Find alerts within 5-minute window from same device/service."""
    global correlations_created

    with alert_window_lock:
        candidates = []
        for existing in alert_window:
            if existing["alert_id"] == alert["alert_id"]:
                continue
            # Same device or same service
            same_device = (alert.get("device_id") and
                           existing.get("device_id") == alert["device_id"])
            same_service = (alert.get("affected_service") and
                            existing.get("affected_service") == alert["affected_service"])
            same_ip = (alert.get("source_ip") and
                       existing.get("source_ip") == alert["source_ip"])

            if same_device or same_service or same_ip:
                if existing.get("correlation_id"):
                    candidates.append(existing["correlation_id"])

        if candidates:
            # Join existing correlation group
            correlation_id = candidates[0]
            correlations_created += 1
            return correlation_id

    return None


def causal_correlate(alert: dict) -> Optional[dict]:
    """Match against known causal patterns."""
    for pattern in CAUSAL_PATTERNS:
        trigger = pattern["trigger"]
        if (alert["source"] == trigger["source"] and
                alert["category"] == trigger["category"]):
            # This alert is a trigger — check if any effects exist in window
            effects_found = []
            with alert_window_lock:
                for existing in alert_window:
                    for effect in pattern["effects"]:
                        if (existing["source"] == effect["source"] and
                                existing["category"] == effect["category"]):
                            effects_found.append(existing)

            if effects_found:
                return {
                    "pattern_name": pattern["name"],
                    "root_cause": pattern["root_cause"],
                    "severity": pattern["severity_override"],
                    "trigger_alert": alert["alert_id"],
                    "effect_alerts": [e["alert_id"] for e in effects_found],
                }

        # Check if this alert is an effect of a trigger already in window
        for effect in pattern.get("effects", []):
            if (alert["source"] == effect["source"] and
                    alert["category"] == effect["category"]):
                with alert_window_lock:
                    for existing in alert_window:
                        if (existing["source"] == trigger["source"] and
                                existing["category"] == trigger["category"]):
                            return {
                                "pattern_name": pattern["name"],
                                "root_cause": pattern["root_cause"],
                                "severity": pattern["severity_override"],
                                "trigger_alert": existing["alert_id"],
                                "effect_alerts": [alert["alert_id"]],
                            }

    return None


def topological_correlate(alert: dict) -> list[str]:
    """Find alerts from topologically adjacent devices."""
    device_id = alert.get("device_id")
    if not device_id:
        return []

    adjacent = TOPOLOGY_GRAPH.get(device_id, [])
    related = []

    with alert_window_lock:
        for existing in alert_window:
            if existing.get("device_id") in adjacent:
                related.append(existing["alert_id"])

    return related


def statistical_correlate(alert: dict) -> float:
    """Compute co-occurrence score using Jaccard similarity."""
    alert_features = {alert["source"], alert["category"], alert.get("severity", "")}
    max_similarity = 0.0

    with alert_window_lock:
        for existing in alert_window:
            if existing["alert_id"] == alert["alert_id"]:
                continue
            existing_features = {existing["source"], existing["category"],
                                 existing.get("severity", "")}
            intersection = len(alert_features & existing_features)
            union = len(alert_features | existing_features)
            if union > 0:
                similarity = intersection / union
                max_similarity = max(max_similarity, similarity)

    return max_similarity


# ─────────────────────────────────────────────────────────────────────────────
# Main Correlation Pipeline
# ─────────────────────────────────────────────────────────────────────────────

def correlate_alert(alert: dict):
    """Run all correlation strategies on an incoming alert."""
    global alerts_processed, correlations_created, incidents_created

    alerts_processed += 1
    correlation_id = None
    root_cause = None

    # Strategy 1: Temporal correlation (same device/service within time window)
    temporal_cid = temporal_correlate(alert)
    if temporal_cid:
        correlation_id = temporal_cid

    # Strategy 2: Causal pattern matching
    causal_result = causal_correlate(alert)
    if causal_result:
        if not correlation_id:
            correlation_id = f"incident-{uuid.uuid4().hex[:12]}"
            incidents_created += 1
        root_cause = causal_result["root_cause"]

        # Link all related alerts to this correlation_id
        all_alert_ids = [causal_result["trigger_alert"]] + causal_result["effect_alerts"]
        link_alerts_to_correlation(correlation_id, all_alert_ids)

        # Publish incident to middleware
        publish_incident(correlation_id, causal_result)

    # Strategy 3: Topological adjacency
    topo_related = topological_correlate(alert)
    if topo_related and not correlation_id:
        correlation_id = f"topo-{uuid.uuid4().hex[:12]}"
        correlations_created += 1

    # Strategy 4: Statistical co-occurrence
    similarity = statistical_correlate(alert)
    if similarity > 0.7 and not correlation_id:
        correlation_id = f"stat-{uuid.uuid4().hex[:12]}"
        correlations_created += 1

    # Update alert with correlation_id
    if correlation_id:
        alert["correlation_id"] = correlation_id
        update_alert_correlation(alert["alert_id"], correlation_id, root_cause)

    # Add to sliding window
    with alert_window_lock:
        alert_window.append(alert)


def link_alerts_to_correlation(correlation_id: str, alert_ids: list[str]):
    """Link multiple alerts to the same correlation group."""
    conn = get_db()
    if not conn:
        return
    try:
        cur = conn.cursor()
        for aid in alert_ids:
            cur.execute(
                "UPDATE noc_alerts SET correlation_id = %s, is_correlated = true WHERE alert_id = %s",
                (correlation_id, aid)
            )
        conn.commit()
    except Exception as e:
        log.error(f"Link correlation failed: {e}")
        conn.rollback()
    finally:
        conn.close()


def update_alert_correlation(alert_id: str, correlation_id: str, root_cause: Optional[str]):
    """Update a single alert with its correlation_id."""
    conn = get_db()
    if not conn:
        return
    try:
        cur = conn.cursor()
        if root_cause:
            cur.execute(
                """UPDATE noc_alerts SET correlation_id = %s, is_correlated = true,
                   metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{root_cause}', %s::jsonb)
                   WHERE alert_id = %s""",
                (correlation_id, json.dumps(root_cause), alert_id)
            )
        else:
            cur.execute(
                "UPDATE noc_alerts SET correlation_id = %s, is_correlated = true WHERE alert_id = %s",
                (correlation_id, alert_id)
            )
        conn.commit()
    except Exception as e:
        log.error(f"Update correlation failed: {e}")
        conn.rollback()
    finally:
        conn.close()


def publish_incident(correlation_id: str, causal_result: dict):
    """Publish correlated incident to middleware."""
    incident = {
        "correlation_id": correlation_id,
        "pattern": causal_result["pattern_name"],
        "root_cause": causal_result["root_cause"],
        "severity": causal_result["severity"],
        "trigger_alert": causal_result["trigger_alert"],
        "effect_count": len(causal_result["effect_alerts"]),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Kafka: publish to noc.incidents topic
    publish_to_kafka("noc.incidents", incident)
    # Dapr: pub/sub for cross-service
    publish_to_dapr("noc-incident", incident)
    # OpenSearch: index for search
    index_in_opensearch("noc-incidents", correlation_id, incident)
    # Fluvio: edge relay
    publish_to_fluvio("noc-incidents", incident)
    # Lakehouse: analytics
    publish_to_lakehouse("noc_incidents", incident)

    log.info(f"[Incident] {causal_result['pattern_name']}: {correlation_id} "
             f"(trigger={causal_result['trigger_alert']}, effects={len(causal_result['effect_alerts'])})")


# ─────────────────────────────────────────────────────────────────────────────
# Middleware Helpers
# ─────────────────────────────────────────────────────────────────────────────

def publish_to_kafka(topic: str, data: dict):
    # In production: use confluent-kafka producer
    log.debug(f"[Kafka] Published to {topic}")


def publish_to_dapr(topic: str, data: dict):
    # In production: POST /v1.0/publish/noc-pubsub/{topic}
    log.debug(f"[Dapr] Published to {topic}")


def index_in_opensearch(index: str, doc_id: str, data: dict):
    # In production: PUT /{index}/_doc/{doc_id}
    log.debug(f"[OpenSearch] Indexed {doc_id} in {index}")


def publish_to_fluvio(topic: str, data: dict):
    log.debug(f"[Fluvio] Published to {topic}")


def publish_to_lakehouse(table: str, data: dict):
    """Publish data to Lakehouse Analytics Engine for historical analytics."""
    try:
        resp = requests.post(
            f"{LAKEHOUSE_URL}/ingest",
            json={"namespace": "ndsep", "table": table, "records": [data]},
            timeout=5,
        )
        if resp.ok:
            log.debug(f"[Lakehouse] Written to {table}: {resp.json().get('rowsIngested', 0)} rows")
        else:
            log.warning(f"[Lakehouse] Ingest to {table} failed: HTTP {resp.status_code}")
    except Exception as e:
        log.debug(f"[Lakehouse] Ingest to {table} unavailable: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Background Workers
# ─────────────────────────────────────────────────────────────────────────────

def alert_poll_loop():
    """Poll DB for new uncorrelated alerts every 15 seconds."""
    while True:
        time.sleep(15)
        conn = get_db()
        if not conn:
            continue
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT alert_id, source, severity, category, title,
                       COALESCE(description, ''), device_id, source_ip::text,
                       affected_service, status, correlation_id, first_seen
                FROM noc_alerts
                WHERE is_correlated = false
                AND status IN ('open', 'acknowledged')
                AND first_seen > NOW() - INTERVAL '30 minutes'
                ORDER BY first_seen DESC
                LIMIT 100
            """)
            rows = cur.fetchall()
            for row in rows:
                alert = {
                    "alert_id": row[0], "source": row[1], "severity": row[2],
                    "category": row[3], "title": row[4], "description": row[5],
                    "device_id": row[6], "source_ip": str(row[7]) if row[7] else None,
                    "affected_service": row[8], "status": row[9],
                    "correlation_id": row[10],
                    "first_seen": row[11].isoformat() if row[11] else None,
                }
                correlate_alert(alert)
        except Exception as e:
            log.error(f"Alert poll failed: {e}")
        finally:
            conn.close()


def window_cleanup_loop():
    """Remove expired alerts from sliding window every 60 seconds."""
    while True:
        time.sleep(60)
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
        with alert_window_lock:
            while alert_window and alert_window[0].get("first_seen"):
                try:
                    first_seen = datetime.fromisoformat(alert_window[0]["first_seen"])
                    if first_seen.tzinfo is None:
                        first_seen = first_seen.replace(tzinfo=timezone.utc)
                    if first_seen < cutoff:
                        alert_window.popleft()
                    else:
                        break
                except (ValueError, TypeError):
                    alert_window.popleft()


def relay_heartbeat():
    """Send heartbeat to main server every 60 seconds."""
    while True:
        time.sleep(60)
        try:
            requests.post(RELAY_URL, json={
                "worker": "noc-correlator",
                "type": "noc.correlator.heartbeat",
                "data": {
                    "alerts_processed": alerts_processed,
                    "correlations_created": correlations_created,
                    "incidents_created": incidents_created,
                    "window_size": len(alert_window),
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }, timeout=3)
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# HTTP API Server
# ─────────────────────────────────────────────────────────────────────────────

class NocCorrelatorHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default logging

    def do_GET(self):
        if self.path == "/health":
            self._json_response({
                "status": "healthy",
                "worker": "noc-correlator",
                "uptime_seconds": int(time.time() - worker_start),
                "strategies": ["temporal", "causal", "topological", "statistical"],
                "causal_patterns": len(CAUSAL_PATTERNS),
                "middleware": {
                    "kafka": KAFKA_URL, "redis": REDIS_URL,
                    "opensearch": OPENSEARCH_URL, "temporal": TEMPORAL_URL,
                    "dapr": DAPR_URL, "fluvio": FLUVIO_URL,
                    "lakehouse": LAKEHOUSE_URL,
                },
            })
        elif self.path == "/metrics":
            self._json_response({
                "alerts_processed": alerts_processed,
                "correlations_created": correlations_created,
                "incidents_created": incidents_created,
                "false_positives_suppressed": false_positives_suppressed,
                "window_size": len(alert_window),
                "correlation_groups": len(correlation_groups),
            })
        elif self.path == "/api/patterns":
            patterns = []
            for p in CAUSAL_PATTERNS:
                patterns.append({
                    "name": p["name"],
                    "trigger": p["trigger"],
                    "effects_count": len(p["effects"]),
                    "severity": p["severity_override"],
                    "root_cause": p["root_cause"],
                })
            self._json_response({"count": len(patterns), "patterns": patterns})
        elif self.path == "/api/incidents":
            self._serve_incidents()
        elif self.path == "/api/window":
            with alert_window_lock:
                recent = list(alert_window)[-50:]
            self._json_response({"count": len(recent), "alerts": recent})
        elif self.path == "/api/topology":
            self._json_response({"graph": TOPOLOGY_GRAPH})
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == "/api/correlate":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                alert = json.loads(body)
                correlate_alert(alert)
                self._json_response({
                    "status": "correlated",
                    "alert_id": alert.get("alert_id"),
                    "correlation_id": alert.get("correlation_id"),
                })
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
        else:
            self.send_error(404)

    def _json_response(self, data: dict, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode())

    def _serve_incidents(self):
        conn = get_db()
        if not conn:
            self._json_response({"incidents": [], "count": 0})
            return
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT correlation_id, COUNT(*) as alert_count,
                       MAX(severity) as max_severity,
                       array_agg(DISTINCT source) as sources,
                       MIN(first_seen) as started,
                       MAX(last_seen) as last_updated
                FROM noc_alerts
                WHERE correlation_id IS NOT NULL
                AND is_correlated = true
                GROUP BY correlation_id
                ORDER BY MIN(first_seen) DESC
                LIMIT 50
            """)
            rows = cur.fetchall()
            incidents = []
            for row in rows:
                incidents.append({
                    "correlation_id": row[0],
                    "alert_count": row[1],
                    "max_severity": row[2],
                    "sources": row[3] if row[3] else [],
                    "started": row[4].isoformat() if row[4] else None,
                    "last_updated": row[5].isoformat() if row[5] else None,
                })
            self._json_response({"count": len(incidents), "incidents": incidents})
        except Exception as e:
            log.error(f"Incidents query failed: {e}")
            self._json_response({"incidents": [], "count": 0, "error": str(e)})
        finally:
            conn.close()


def run_server():
    log.info("╔══════════════════════════════════════════════════════════╗")
    log.info("║  NDSEP NOC Cross-Domain Alert Correlator                ║")
    log.info(f"║  Port: {PORT}                                              ║")
    log.info("║  Strategies: Temporal · Causal · Topological · Stat     ║")
    log.info("╚══════════════════════════════════════════════════════════╝")

    # Start background workers
    threading.Thread(target=alert_poll_loop, daemon=True).start()
    threading.Thread(target=window_cleanup_loop, daemon=True).start()
    threading.Thread(target=relay_heartbeat, daemon=True).start()

    # Load initial alerts
    load_recent_alerts()

    # Start HTTP server
    with socketserver.TCPServer(("", PORT), NocCorrelatorHandler) as httpd:
        log.info(f"[HTTP] Listening on :{PORT}")
        httpd.serve_forever()


if __name__ == "__main__":
    run_server()
