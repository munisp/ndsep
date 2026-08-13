"""NDSEP Fluvio consumer worker.

Consumes records through the official Fluvio Python client, routes only after
all configured downstream writes succeed, and commits offsets after successful
processing. It has no in-memory broker, queue, or allow-success fallback.
"""
import json
import logging
import os
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict

import requests

try:
    from fluvio import ConsumerConfigExtBuilder, Fluvio, Offset, OffsetManagementStrategy
except ImportError as error:  # surfaced on startup rather than faking messages
    FLUVIO_IMPORT_ERROR: Exception | None = error
else:
    FLUVIO_IMPORT_ERROR = None

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [fluvio-consumer] %(message)s")
logger = logging.getLogger(__name__)

PORT = int(os.getenv("FLUVIO_CONSUMER_PORT", "8165"))
CONSUMER_ID = os.getenv("FLUVIO_CONSUMER_ID", "ndsep-fluvio-consumer")
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "").rstrip("/")
EVENT_RELAY_URL = os.getenv("EVENT_RELAY_URL", "").rstrip("/")

NDSEP_TOPICS = [
    "ndsep.compliance.events", "ndsep.aml.cases", "ndsep.kyc.updates", "ndsep.fines.issued",
    "ndsep.accreditation.transitions", "ndsep.watchlist.hits", "ndsep.breach.notifications",
    "ndsep.cross.agency.alerts", "ndsep.sector.metrics", "ndsep.audit.trail",
    "ndsep.financial.transactions", "ndsep.regulatory.reports",
]

metrics: Dict[str, Any] = {
    "messages_consumed": 0, "messages_routed": 0, "route_failures": 0,
    "start_time": time.time(), "by_topic": defaultdict(int), "connected": False,
}


def _post_required(url: str, payload: Dict[str, Any]) -> None:
    if not url:
        raise RuntimeError("Required downstream URL is not configured")
    response = requests.post(url, json=payload, timeout=10)
    if not response.ok:
        raise RuntimeError(f"Downstream endpoint {url} returned HTTP {response.status_code}: {response.text[:300]}")


def route_event(topic: str, event: Dict[str, Any]) -> None:
    index = topic.replace(".", "-").replace("ndsep-", "ndsep_")
    _post_required(f"{OPENSEARCH_URL}/{index}/_doc", {
        **event, "indexed_at": datetime.now(timezone.utc).isoformat(), "source_topic": topic,
    })
    if topic in {"ndsep.breach.notifications", "ndsep.cross.agency.alerts", "ndsep.aml.cases"}:
        _post_required(f"{EVENT_RELAY_URL}/events/relay", {"topic": topic, "event": event, "priority": "high"})


def consume_topic(topic: str) -> None:
    if FLUVIO_IMPORT_ERROR is not None:
        raise RuntimeError(f"Official Fluvio client is unavailable: {FLUVIO_IMPORT_ERROR}")
    fluvio = Fluvio.connect()
    builder = ConsumerConfigExtBuilder(topic)
    builder.offset_start(Offset.beginning())
    builder.offset_strategy(OffsetManagementStrategy.MANUAL)
    builder.offset_consumer(f"{CONSUMER_ID}-{topic}")
    stream = fluvio.consumer_with_config(builder.build())
    metrics["connected"] = True
    logger.info("Consuming Fluvio topic %s with consumer %s", topic, CONSUMER_ID)
    while True:
        record = next(stream)
        try:
            payload = json.loads(bytearray(record.value()).decode("utf-8"))
            if not isinstance(payload, dict):
                payload = {"value": payload}
            route_event(topic, payload)
            stream.offset_commit()
            stream.offset_flush()
            metrics["messages_consumed"] += 1
            metrics["messages_routed"] += 1
            metrics["by_topic"][topic] += 1
        except Exception:
            metrics["route_failures"] += 1
            logger.exception("Route failure for %s; offset remains uncommitted for retry", topic)
            time.sleep(2)


def start_consumers() -> None:
    for topic in NDSEP_TOPICS:
        thread = threading.Thread(target=consume_topic, args=(topic,), daemon=True, name=f"fluvio-{topic}")
        thread.start()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def send_json(self, data: Dict[str, Any], status: int = 200) -> None:
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            healthy = metrics["connected"] and FLUVIO_IMPORT_ERROR is None and bool(OPENSEARCH_URL) and bool(EVENT_RELAY_URL)
            self.send_json({"status": "healthy" if healthy else "unhealthy", "service": "ndsep-fluvio-consumer", "topics": NDSEP_TOPICS, "metrics": {key: value for key, value in metrics.items() if key not in {"by_topic", "start_time"}}}, 200 if healthy else 503)
        elif self.path == "/topics":
            self.send_json({"topics": NDSEP_TOPICS, "count": len(NDSEP_TOPICS)})
        elif self.path == "/metrics":
            lines = [
                f"ndsep_fluvio_messages_consumed_total {metrics['messages_consumed']}",
                f"ndsep_fluvio_messages_routed_total {metrics['messages_routed']}",
                f"ndsep_fluvio_route_failures_total {metrics['route_failures']}",
            ]
            body = "\n".join(lines).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self) -> None:
        self.send_json({"error": "This endpoint is a broker-backed consumer and does not accept synthetic publish or DLQ replay requests"}, 405)


if __name__ == "__main__":
    if FLUVIO_IMPORT_ERROR is not None:
        raise SystemExit(f"Cannot start Fluvio worker: {FLUVIO_IMPORT_ERROR}")
    if not OPENSEARCH_URL or not EVENT_RELAY_URL:
        raise SystemExit("OPENSEARCH_URL and EVENT_RELAY_URL must be configured")
    logger.info("Starting real Fluvio consumers for %d topics", len(NDSEP_TOPICS))
    start_consumers()
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
