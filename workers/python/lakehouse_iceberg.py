#!/usr/bin/env python3
"""
NDSEP Lakehouse Worker — Apache Iceberg REST Catalog Integration (Python)
=========================================================================
Manages the NDSEP data lakehouse via the Apache Iceberg REST Catalog API.

Tables: compliance_events, audit_trail, network_telemetry, violations,
        penalties, cross_border_flows, ml_predictions
"""
import os, time, json, logging, threading, http.server, socketserver
from datetime import datetime, timezone
import requests

ICEBERG_CATALOG_URL = os.environ.get("ICEBERG_CATALOG_URL", "http://localhost:8181")
ICEBERG_ENABLED = os.environ.get("ICEBERG_ENABLED", "true").lower() == "true"
RELAY_URL = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
PORT = int(os.environ.get("LAKEHOUSE_PORT", "8092"))
ICEBERG_NAMESPACE = "ndsep"
ICEBERG_WAREHOUSE = os.environ.get("ICEBERG_WAREHOUSE", "s3://ndsep-lakehouse/warehouse")

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [NDSEP-Lakehouse] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

worker_start = time.time()
_iceberg_connected = False
_tables_created = 0
_errors = 0

ICEBERG_TABLES = {
    "compliance_events": {"fields": [
        {"id":1,"name":"event_id","required":True,"type":"string"},
        {"id":2,"name":"organization_id","required":True,"type":"string"},
        {"id":3,"name":"event_type","required":True,"type":"string"},
        {"id":4,"name":"score","required":False,"type":"float"},
        {"id":5,"name":"passed","required":True,"type":"boolean"},
        {"id":6,"name":"assessed_at","required":True,"type":"timestamptz"},
    ]},
    "audit_trail": {"fields": [
        {"id":1,"name":"audit_id","required":True,"type":"string"},
        {"id":2,"name":"actor_id","required":True,"type":"string"},
        {"id":3,"name":"action","required":True,"type":"string"},
        {"id":4,"name":"resource_type","required":True,"type":"string"},
        {"id":5,"name":"resource_id","required":True,"type":"string"},
        {"id":6,"name":"metadata","required":False,"type":"string"},
        {"id":7,"name":"created_at","required":True,"type":"timestamptz"},
    ]},
    "network_telemetry": {"fields": [
        {"id":1,"name":"event_id","required":True,"type":"string"},
        {"id":2,"name":"ixp_site","required":True,"type":"string"},
        {"id":3,"name":"src_ip","required":True,"type":"string"},
        {"id":4,"name":"dst_ip","required":True,"type":"string"},
        {"id":5,"name":"protocol","required":True,"type":"string"},
        {"id":6,"name":"bytes_transferred","required":True,"type":"long"},
        {"id":7,"name":"is_cross_border","required":True,"type":"boolean"},
        {"id":8,"name":"latency_ms","required":False,"type":"int"},
        {"id":9,"name":"detected_at","required":True,"type":"timestamptz"},
    ]},
    "violations": {"fields": [
        {"id":1,"name":"violation_id","required":True,"type":"string"},
        {"id":2,"name":"organization_id","required":True,"type":"string"},
        {"id":3,"name":"violation_type","required":True,"type":"string"},
        {"id":4,"name":"severity","required":True,"type":"string"},
        {"id":5,"name":"status","required":True,"type":"string"},
        {"id":6,"name":"detected_at","required":True,"type":"timestamptz"},
    ]},
    "penalties": {"fields": [
        {"id":1,"name":"penalty_id","required":True,"type":"string"},
        {"id":2,"name":"organization_id","required":True,"type":"string"},
        {"id":3,"name":"amount_ngn","required":True,"type":"decimal(18,2)"},
        {"id":4,"name":"status","required":True,"type":"string"},
        {"id":5,"name":"issued_at","required":True,"type":"timestamptz"},
        {"id":6,"name":"paid_at","required":False,"type":"timestamptz"},
    ]},
    "cross_border_flows": {"fields": [
        {"id":1,"name":"flow_id","required":True,"type":"string"},
        {"id":2,"name":"organization_id","required":True,"type":"string"},
        {"id":3,"name":"src_country","required":True,"type":"string"},
        {"id":4,"name":"dst_country","required":True,"type":"string"},
        {"id":5,"name":"bytes_transferred","required":True,"type":"long"},
        {"id":6,"name":"approved","required":True,"type":"boolean"},
        {"id":7,"name":"detected_at","required":True,"type":"timestamptz"},
    ]},
    "ml_predictions": {"fields": [
        {"id":1,"name":"prediction_id","required":True,"type":"string"},
        {"id":2,"name":"organization_id","required":True,"type":"string"},
        {"id":3,"name":"model_name","required":True,"type":"string"},
        {"id":4,"name":"risk_score","required":True,"type":"float"},
        {"id":5,"name":"prediction_label","required":True,"type":"string"},
        {"id":6,"name":"confidence","required":False,"type":"float"},
        {"id":7,"name":"predicted_at","required":True,"type":"timestamptz"},
    ]},
}

def _iceberg_request(method, path, body=None):
    try:
        url = f"{ICEBERG_CATALOG_URL}/v1{path}"
        r = requests.request(method, url,
            headers={"Content-Type": "application/json"},
            json=body, timeout=8)
        if r.status_code < 300:
            try: return True, r.json()
            except: return True, {}
        return False, {"error": r.text}
    except Exception as e:
        return False, {"error": str(e)}

def iceberg_health_check():
    global _iceberg_connected
    if not ICEBERG_ENABLED: return False
    ok, _ = _iceberg_request("GET", "/config")
    if ok and not _iceberg_connected:
        log.info(f"[Iceberg] Connected to REST Catalog at {ICEBERG_CATALOG_URL}")
    _iceberg_connected = ok
    return ok

def ensure_namespace():
    ok, _ = _iceberg_request("GET", f"/namespaces/{ICEBERG_NAMESPACE}")
    if ok: return True
    ok, _ = _iceberg_request("POST", "/namespaces", {
        "namespace": [ICEBERG_NAMESPACE],
        "properties": {"location": f"{ICEBERG_WAREHOUSE}/{ICEBERG_NAMESPACE}",
                       "description": "NDSEP Data Sovereignty Enforcement Platform"}
    })
    if ok: log.info(f"[Iceberg] Created namespace: {ICEBERG_NAMESPACE}")
    return ok

def ensure_table(table_name, schema_def):
    global _tables_created
    ok, _ = _iceberg_request("GET", f"/namespaces/{ICEBERG_NAMESPACE}/tables/{table_name}")
    if ok: return True
    ok, _ = _iceberg_request("POST", f"/namespaces/{ICEBERG_NAMESPACE}/tables", {
        "name": table_name,
        "location": f"{ICEBERG_WAREHOUSE}/{ICEBERG_NAMESPACE}/{table_name}",
        "schema": {"type": "struct", "schema-id": 0, "fields": schema_def["fields"]},
        "partition-spec": {"spec-id": 0, "fields": []},
        "write-order": {"order-id": 0, "fields": []},
        "properties": {"write.format.default": "parquet",
                       "write.parquet.compression-codec": "snappy"},
    })
    if ok:
        _tables_created += 1
        log.info(f"[Iceberg] Created table: {ICEBERG_NAMESPACE}.{table_name}")
    return ok

def list_tables():
    ok, data = _iceberg_request("GET", f"/namespaces/{ICEBERG_NAMESPACE}/tables")
    return data.get("identifiers", []) if ok else []

def bootstrap_lakehouse():
    if not _iceberg_connected:
        log.warning("[Iceberg] Not connected — skipping bootstrap")
        return
    if not ensure_namespace():
        log.error("[Iceberg] Failed to create namespace")
        return
    for table_name, schema_def in ICEBERG_TABLES.items():
        ensure_table(table_name, schema_def)
    log.info(f"[Iceberg] Bootstrap complete — {len(ICEBERG_TABLES)} tables ensured")

def run_periodic_health():
    while True:
        time.sleep(60)
        was_connected = _iceberg_connected
        iceberg_health_check()
        if not was_connected and _iceberg_connected:
            bootstrap_lakehouse()

class StatusHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass
    def do_GET(self):
        if self.path in ("/health", "/"):
            tables = list_tables() if _iceberg_connected else []
            body = json.dumps({
                "status": "ok", "worker": "lakehouse_iceberg",
                "iceberg_connected": _iceberg_connected,
                "iceberg_url": ICEBERG_CATALOG_URL,
                "namespace": ICEBERG_NAMESPACE,
                "tables_defined": len(ICEBERG_TABLES),
                "tables_created": _tables_created,
                "live_tables": len(tables),
                "errors": _errors,
                "uptime_seconds": round(time.time() - worker_start, 1),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/tables":
            tables = list_tables() if _iceberg_connected else []
            body = json.dumps({"tables": tables, "count": len(tables)}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

def broadcast(event, data):
    try: requests.post(RELAY_URL, json={"event": event, "data": data}, timeout=2)
    except: pass

if __name__ == "__main__":
    log.info("=== NDSEP Lakehouse Worker (Apache Iceberg REST Catalog) ===")
    log.info(f"Port: {PORT} | Catalog: {ICEBERG_CATALOG_URL} | Namespace: {ICEBERG_NAMESPACE}")
    iceberg_health_check()
    if _iceberg_connected:
        bootstrap_lakehouse()
    else:
        log.warning("[Iceberg] Catalog not reachable — will retry every 60s (graceful degradation)")
    threading.Thread(target=run_periodic_health, daemon=True).start()
    broadcast("worker_started", {
        "worker": "lakehouse_iceberg", "layer": "L7", "language": "Python",
        "iceberg_url": ICEBERG_CATALOG_URL,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    with socketserver.TCPServer(("", PORT), StatusHandler) as httpd:
        log.info(f"Status server listening on :{PORT}")
        httpd.serve_forever()
