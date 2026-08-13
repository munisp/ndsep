"""NDSEP Fluvio edge telemetry ingestion worker.

Consumes records produced by real edge agents through Fluvio. It never generates
packets, countries, health measurements, or broker acknowledgements locally.
"""
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict

import psycopg2
import requests

try:
    from fluvio import ConsumerConfigExtBuilder, Fluvio, Offset, OffsetManagementStrategy
except ImportError as error:
    FLUVIO_IMPORT_ERROR: Exception | None = error
else:
    FLUVIO_IMPORT_ERROR = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s [NDSEP-Fluvio] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

DB_URL = os.getenv("WORKER_DATABASE_URL", "")
RELAY_URL = os.getenv("WORKER_RELAY_URL", "").rstrip("/")
TOPIC = os.getenv("FLUVIO_TELEMETRY_TOPIC", "fluvio.edge.telemetry")
CONSUMER_ID = os.getenv("FLUVIO_TELEMETRY_CONSUMER_ID", "ndsep-edge-telemetry")
PORT = int(os.getenv("FLUVIO_PORT", "8087"))

metrics: Dict[str, Any] = {"records_persisted": 0, "cross_border_detected": 0, "errors": 0, "connected": False, "start_time": time.time()}


def database_connection():
    if not DB_URL:
        raise RuntimeError("WORKER_DATABASE_URL is required")
    return psycopg2.connect(DB_URL)


def validate_record(record: Dict[str, Any]) -> Dict[str, Any]:
    required = ["organization_id", "source_ip", "destination_ip", "protocol", "bytes_transferred", "ixp_site"]
    missing = [field for field in required if record.get(field) in (None, "")]
    if missing:
        raise ValueError(f"Telemetry record is missing required fields: {', '.join(missing)}")
    destination_country = str(record.get("destination_country", "NG"))
    source_country = str(record.get("source_country", "NG"))
    return {
        "organization_id": int(record["organization_id"]),
        "source_ip": str(record["source_ip"]),
        "destination_ip": str(record["destination_ip"]),
        "protocol": str(record["protocol"]),
        "bytes_transferred": int(record["bytes_transferred"]),
        "ixp_site": str(record["ixp_site"]),
        "is_cross_border": bool(record.get("is_cross_border", destination_country != source_country)),
        "is_blocked": bool(record.get("is_blocked", False)),
        "metadata": {**record.get("metadata", {}), "source_country": source_country, "destination_country": destination_country, "received_at": datetime.now(timezone.utc).isoformat()},
    }


def persist_record(record: Dict[str, Any]) -> None:
    values = validate_record(record)
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """INSERT INTO network_events (organization_id, source_ip, destination_ip, protocol, bytes_transferred, is_cross_border, is_blocked, ixp_site, metadata, detected_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())""",
                (values["organization_id"], values["source_ip"], values["destination_ip"], values["protocol"], values["bytes_transferred"], values["is_cross_border"], values["is_blocked"], values["ixp_site"], json.dumps(values["metadata"])),
            )


def relay_required(event: Dict[str, Any]) -> None:
    if not RELAY_URL:
        return
    response = requests.post(f"{RELAY_URL}/api/workers/event", json={"event": "fluvio_packet_ingested", "data": event}, timeout=5)
    if not response.ok:
        raise RuntimeError(f"Realtime relay returned HTTP {response.status_code}")


def consume() -> None:
    if FLUVIO_IMPORT_ERROR is not None:
        raise RuntimeError(f"Official Fluvio client unavailable: {FLUVIO_IMPORT_ERROR}")
    fluvio = Fluvio.connect()
    builder = ConsumerConfigExtBuilder(TOPIC)
    builder.offset_start(Offset.beginning())
    builder.offset_strategy(OffsetManagementStrategy.MANUAL)
    builder.offset_consumer(CONSUMER_ID)
    stream = fluvio.consumer_with_config(builder.build())
    metrics["connected"] = True
    log.info("Connected to Fluvio telemetry topic %s", TOPIC)
    while True:
        record = next(stream)
        try:
            payload = json.loads(bytearray(record.value()).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("Telemetry record must be a JSON object")
            persist_record(payload)
            relay_required(payload)
            stream.offset_commit()
            stream.offset_flush()
            metrics["records_persisted"] += 1
            if bool(payload.get("is_cross_border")):
                metrics["cross_border_detected"] += 1
        except Exception:
            metrics["errors"] += 1
            log.exception("Telemetry handling failed; Fluvio offset remains uncommitted")
            time.sleep(2)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_response(404)
            self.end_headers()
            return
        healthy = metrics["connected"] and FLUVIO_IMPORT_ERROR is None and bool(DB_URL)
        body = json.dumps({"status": "healthy" if healthy else "unhealthy", "service": "ndsep-fluvio-edge-telemetry", "topic": TOPIC, "metrics": metrics}, default=str).encode()
        self.send_response(200 if healthy else 503)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    if FLUVIO_IMPORT_ERROR is not None:
        raise SystemExit(f"Cannot start telemetry worker: {FLUVIO_IMPORT_ERROR}")
    if not DB_URL:
        raise SystemExit("WORKER_DATABASE_URL is required")
    threading.Thread(target=consume, daemon=True, name="fluvio-edge-telemetry").start()
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
