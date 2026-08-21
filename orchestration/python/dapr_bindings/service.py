"""NDSEP Dapr Bindings Service.

This adapter proxies state, pub/sub, service invocation, and subscription
acknowledgements through a running Dapr sidecar. It does not acknowledge an
operation when the sidecar or its configured component cannot persist it.
"""
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO, format="[dapr-bindings] %(asctime)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="NDSEP Dapr Bindings", version="2.0.0")
DAPR_HTTP_PORT = os.getenv("DAPR_HTTP_PORT", "3500")
DAPR_BASE_URL = os.getenv("DAPR_HTTP_URL", f"http://127.0.0.1:{DAPR_HTTP_PORT}").rstrip("/")
APP_ID = os.getenv("APP_ID", "ndsep-orchestration")
DEFAULT_PUBSUB = os.getenv("DAPR_PUBSUB_NAME", "kafka-pubsub")
DEFAULT_STORE = os.getenv("DAPR_STATE_STORE", "redis-state")


class PublishRequest(BaseModel):
    pubsub_name: str = DEFAULT_PUBSUB
    topic: str
    data: Dict[str, Any]
    metadata: Optional[Dict[str, str]] = None


class StateRequest(BaseModel):
    store_name: str = DEFAULT_STORE
    key: str
    value: Any
    ttl_seconds: Optional[int] = None


class InvokeRequest(BaseModel):
    app_id: str
    method: str
    data: Optional[Dict[str, Any]] = None
    http_verb: str = "POST"


def dapr_request(path: str, method: str = "GET", payload: Any = None, query: Optional[Dict[str, str]] = None) -> Any:
    url = f"{DAPR_BASE_URL}{path}"
    if query:
        url = f"{url}?{urlencode(query)}"
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = UrlRequest(url, data=body, method=method, headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=5) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else None
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=503, detail=f"Dapr {method} {path} failed with HTTP {error.code}: {detail[:300]}") from error
    except (URLError, TimeoutError, OSError) as error:
        raise HTTPException(status_code=503, detail=f"Dapr sidecar unavailable: {error}") from error


def write_receipt(event_type: str, body: Any) -> str:
    receipt_id = str(uuid.uuid4())
    receipt = {
        "id": receipt_id,
        "event_type": event_type,
        "payload": body,
        "received_at": datetime.now(timezone.utc).isoformat(),
        "consumer": APP_ID,
    }
    dapr_request(f"/v1.0/state/{DEFAULT_STORE}", "POST", [{"key": f"event_receipts/{receipt_id}", "value": receipt}])
    return receipt_id


@app.get("/health")
def health():
    metadata = dapr_request("/v1.0/metadata")
    return {
        "service": "dapr-bindings",
        "status": "healthy",
        "app_id": APP_ID,
        "dapr_base_url": DAPR_BASE_URL,
        "metadata": metadata,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/dapr/publish")
def publish_event(req: PublishRequest):
    event_id = str(uuid.uuid4())
    metadata = dict(req.metadata or {})
    metadata.setdefault("cloudevent.id", event_id)
    dapr_request(f"/v1.0/publish/{req.pubsub_name}/{req.topic}", "POST", req.data, metadata)
    logger.info("PUBLISH pubsub=%s topic=%s id=%s", req.pubsub_name, req.topic, event_id)
    return {"ok": True, "event_id": event_id, "topic": req.topic}


@app.post("/dapr/state/set")
def set_state(req: StateRequest):
    metadata: Dict[str, str] = {}
    if req.ttl_seconds is not None:
        metadata["ttlInSeconds"] = str(req.ttl_seconds)
    dapr_request(
        f"/v1.0/state/{req.store_name}",
        "POST",
        [{"key": req.key, "value": req.value, "metadata": metadata}],
    )
    logger.info("STATE_SET key=%s store=%s", req.key, req.store_name)
    return {"ok": True, "key": req.key}


@app.get("/dapr/state/{key}")
def get_state(key: str, store_name: str = DEFAULT_STORE):
    value = dapr_request(f"/v1.0/state/{store_name}/{key}")
    if value is None:
        raise HTTPException(status_code=404, detail=f"Key {key!r} not found")
    return {"key": key, "store": store_name, "value": value}


@app.post("/dapr/invoke")
def invoke_service(req: InvokeRequest):
    verb = req.http_verb.upper()
    if verb not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
        raise HTTPException(status_code=400, detail="Unsupported HTTP verb")
    result = dapr_request(f"/v1.0/invoke/{req.app_id}/method/{req.method.lstrip('/')}", verb, req.data)
    return {"ok": True, "app_id": req.app_id, "method": req.method, "result": result}


@app.get("/dapr/components")
def list_components():
    metadata = dapr_request("/v1.0/metadata")
    return {"components": metadata.get("components", []) if isinstance(metadata, dict) else []}


@app.get("/dapr/subscribe")
def dapr_subscribe():
    return [
        {"pubsubname": DEFAULT_PUBSUB, "topic": "ndsep.violation.detected", "route": "/events/violation"},
        {"pubsubname": DEFAULT_PUBSUB, "topic": "ndsep.penalty.issued", "route": "/events/penalty"},
        {"pubsubname": DEFAULT_PUBSUB, "topic": "ndsep.transfer.requested", "route": "/events/transfer"},
        {"pubsubname": DEFAULT_PUBSUB, "topic": "ndsep.incident.created", "route": "/events/incident"},
        {"pubsubname": DEFAULT_PUBSUB, "topic": "ndsep.ml.risk_score_updated", "route": "/events/risk"},
    ]


async def persist_event(event_type: str, request: Request) -> Dict[str, str]:
    try:
        body = await request.json()
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid event JSON") from error
    receipt_id = write_receipt(event_type, body)
    logger.info("EVENT persisted type=%s receipt=%s", event_type, receipt_id)
    return {"status": "SUCCESS", "receipt_id": receipt_id}


@app.post("/events/violation")
async def handle_violation(request: Request):
    return await persist_event("violation", request)


@app.post("/events/penalty")
async def handle_penalty(request: Request):
    return await persist_event("penalty", request)


@app.post("/events/transfer")
async def handle_transfer(request: Request):
    return await persist_event("transfer", request)


@app.post("/events/incident")
async def handle_incident(request: Request):
    return await persist_event("incident", request)


@app.post("/events/risk")
async def handle_risk(request: Request):
    return await persist_event("risk", request)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8220"))
    logger.info("NDSEP Dapr Bindings starting on port %s", port)
    uvicorn.run(app, host="0.0.0.0", port=port)
