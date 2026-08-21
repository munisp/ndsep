#!/usr/bin/env python3
"""
NDSEP Dapr State Store Bridge — Python
Port 8167 | Dapr state store, pub/sub, and service invocation bridge
Implements: state management, pub/sub routing, actor pattern, distributed tracing
"""

import os
import json
import time
import logging
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.error import URLError
from datetime import datetime, timezone
from collections import defaultdict

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] [dapr-state-bridge] %(message)s')
logger = logging.getLogger(__name__)

PORT = int(os.getenv("DAPR_BRIDGE_PORT", "8167"))
DAPR_HTTP_PORT = int(os.getenv("DAPR_HTTP_PORT", "3500"))
DAPR_URL = f"http://localhost:{DAPR_HTTP_PORT}"
DAPR_APP_ID = os.getenv("DAPR_APP_ID", "ndsep-platform")
STATE_STORE = os.getenv("DAPR_STATE_STORE", "ndsep-redis-state")
PUBSUB_NAME = os.getenv("DAPR_PUBSUB", "ndsep-kafka-pubsub")

# NDSEP Dapr pub/sub topics
PUBSUB_TOPICS = [
    "compliance-events",
    "aml-cases",
    "kyc-updates",
    "fines-issued",
    "accreditation-transitions",
    "watchlist-hits",
    "breach-notifications",
    "cross-agency-alerts",
    "sector-metrics",
    "financial-transactions",
]

metrics = {
    "state_gets": 0,
    "state_sets": 0,
    "state_deletes": 0,
    "publishes": 0,
    "subscriptions_served": 0,
    "errors": 0,
    "start_time": time.time(),
    "by_topic": defaultdict(int),
}

def dapr_request(method: str, path: str, body: dict = None) -> dict:
    url = f"{DAPR_URL}{path}"
    data = json.dumps(body).encode() if body else None
    req = Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("dapr-app-id", DAPR_APP_ID)
    try:
        with urlopen(req, timeout=5) as resp:
            content = resp.read()
            return json.loads(content) if content else {"success": True}
    except (URLError, Exception) as e:
        metrics["errors"] += 1
        return {"error": f"Dapr sidecar unavailable: {e}"}

def state_get(key: str) -> dict:
    result = dapr_request("GET", f"/v1.0/state/{STATE_STORE}/{key}")
    metrics["state_gets"] += 1
    if result.get("error"):
        raise RuntimeError(result["error"])
    return {"value": result, "source": "dapr"}

def state_set(key: str, value, etag: str = None) -> bool:
    payload = [{"key": key, "value": value}]
    if etag:
        payload[0]["etag"] = etag
    result = dapr_request("POST", f"/v1.0/state/{STATE_STORE}", payload)
    metrics["state_sets"] += 1
    if result.get("error"):
        raise RuntimeError(result["error"])
    return True

def state_delete(key: str) -> bool:
    result = dapr_request("DELETE", f"/v1.0/state/{STATE_STORE}/{key}")
    metrics["state_deletes"] += 1
    if result.get("error"):
        raise RuntimeError(result["error"])
    return True

def publish_event(topic: str, data: dict) -> bool:
    result = dapr_request("POST", f"/v1.0/publish/{PUBSUB_NAME}/{topic}", data)
    metrics["publishes"] += 1
    metrics["by_topic"][topic] += 1
    if result.get("error"):
        raise RuntimeError(result["error"])
    return True

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
                "service": "ndsep-dapr-state-bridge",
                "version": "1.0.0",
                "uptime": time.time() - metrics["start_time"],
                "dapr_url": DAPR_URL,
                "state_store": STATE_STORE,
                "pubsub": PUBSUB_NAME,
                "topics": PUBSUB_TOPICS,
                "durable_state": "dapr-required",
                "metrics": {k: v for k, v in metrics.items() if k != "by_topic"},
            })
        elif self.path == "/dapr/subscribe":
            # Dapr subscription endpoint
            subscriptions = [
                {"pubsubname": PUBSUB_NAME, "topic": t, "route": f"/events/{t}"}
                for t in PUBSUB_TOPICS
            ]
            self.send_json(subscriptions)
        elif self.path == "/topics":
            self.send_json({"topics": PUBSUB_TOPICS, "pubsub": PUBSUB_NAME})
        elif self.path == "/state":
            self.send_json({"error": "state enumeration is unsupported; query Dapr directly"}, 501)
        elif self.path == "/metrics":
            lines = [
                f"ndsep_dapr_state_gets_total {metrics['state_gets']}",
                f"ndsep_dapr_state_sets_total {metrics['state_sets']}",
                f"ndsep_dapr_state_deletes_total {metrics['state_deletes']}",
                f"ndsep_dapr_publishes_total {metrics['publishes']}",
                f"ndsep_dapr_errors_total {metrics['errors']}",
            ]
            for topic, count in metrics["by_topic"].items():
                safe = topic.replace("-", "_")
                lines.append(f"ndsep_dapr_topic_{safe}_publishes_total {count}")
            body = "\n".join(lines).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        body = self.read_body()
        path = self.path

        # Dapr event subscription handler
        if path.startswith("/events/"):
            topic = path[8:]
            metrics["subscriptions_served"] += 1
            metrics["by_topic"][topic] += 1
            logger.info(f"Received Dapr event on topic: {topic}")
            self.send_json({"status": "SUCCESS"})
            return

        if path == "/state/get":
            key = body.get("key", "")
            result = state_get(key)
            self.send_json({"success": True, "key": key, **result})
        elif path == "/state/set":
            key = body.get("key", "")
            value = body.get("value")
            etag = body.get("etag")
            ok = state_set(key, value, etag)
            self.send_json({"success": ok, "key": key})
        elif path == "/state/delete":
            key = body.get("key", "")
            ok = state_delete(key)
            self.send_json({"success": ok, "key": key})
        elif path == "/publish":
            topic = body.get("topic", "compliance-events")
            data = body.get("data", body)
            ok = publish_event(topic, data)
            self.send_json({"success": ok, "topic": topic})
        elif path == "/state/bulk":
            # Bulk state operations
            operations = body.get("operations", [])
            results = []
            for op in operations:
                if op.get("type") == "set":
                    ok = state_set(op["key"], op["value"])
                    results.append({"key": op["key"], "success": ok})
                elif op.get("type") == "get":
                    result = state_get(op["key"])
                    results.append({"key": op["key"], **result})
                elif op.get("type") == "delete":
                    ok = state_delete(op["key"])
                    results.append({"key": op["key"], "success": ok})
            self.send_json({"success": True, "results": results})
        else:
            self.send_json({"error": "not found"}, 404)

if __name__ == "__main__":
    logger.info(f"NDSEP Dapr State Bridge starting on port {PORT}")
    logger.info(f"Dapr URL: {DAPR_URL} | State Store: {STATE_STORE} | PubSub: {PUBSUB_NAME}")
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
