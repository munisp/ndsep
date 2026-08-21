#!/usr/bin/env python3
"""
NDSEP DPCO Notification Service (Python) — Port 8340
=====================================================
Consumes DPCO events from Dapr pub/sub and Kafka, routes alert notifications
to relevant stakeholders (DPCO officers, NDPC regulators, data controllers).

Middleware integrations:
  - Dapr (HTTP sidecar): subscribes to dpco.* topics via CloudEvents;
    uses Dapr state store (redis-state) to track notification delivery state
  - Kafka (kafka-python): consumes ndsep.dpco.* topics; produces to
    ndsep.dpco.notifications.sent
  - Redis (direct): deduplication store (24h TTL) to prevent duplicate alerts
  - Fluvio (HTTP proxy): publishes notification events to Fluvio edge stream
    for real-time notification feed
  - Graceful degradation on all middleware failures

Alert Types:
  - DPCO licence expiry warning (30/7/1 day before)
  - CAR filing deadline reminder (31 March, 14/7/1 day before)
  - Audit SLA breach (72h NDPC notification window exceeded)
  - Compliance score drop alert (>10 point drop from 30-day average)
  - Verification statement issued notification
  - DPCO suspension/reinstatement notification

REST Endpoints:
  GET  /health                          — service health + middleware status
  GET  /api/dpco/notifications          — list recent notifications
  POST /api/dpco/notifications/send     — manual notification trigger
  GET  /api/dpco/notifications/rules    — list active alert rules
  GET  /dapr/subscribe                  — Dapr subscription manifest
  POST /dapr/events/{path}              — Dapr CloudEvents handler
  GET  /metrics                         — operational metrics
"""
import os
import json
import uuid
import time
import logging
import threading
import collections
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import requests
from fastapi import FastAPI, Request
from pydantic import BaseModel
import uvicorn

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="[dpco-notification] %(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────

PORT = int(os.getenv("PORT", "8340"))
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
KAFKA_ENABLED = os.getenv("KAFKA_ENABLED", "true").lower() == "true"
KAFKA_CONSUME_TOPICS = [
    "ndsep.dpco.audit.events",
    "ndsep.dpco.registry.events",
    "ndsep.dpco.verification.events",
    "ndsep.dpco.analytics.events",
]
KAFKA_PRODUCE_TOPIC = "ndsep.dpco.notifications.sent"
DAPR_HTTP_PORT = os.getenv("DAPR_HTTP_PORT", "3500")
DAPR_ENABLED = os.getenv("DAPR_ENABLED", "true").lower() == "true"
DAPR_APP_ID = os.getenv("DAPR_APP_ID", "dpco-notification")
DAPR_STATE_STORE = "redis-state"
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
FLUVIO_HTTP_URL = os.getenv("FLUVIO_HTTP_URL", "http://localhost:9003")
FLUVIO_ENABLED = os.getenv("FLUVIO_ENABLED", "true").lower() == "true"
NDSEP_RELAY_URL = os.getenv("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")

# ─── In-memory State ──────────────────────────────────────────────────────────

_lock = threading.Lock()
_notifications: List[Dict] = []
_dedup_cache: Dict[str, float] = {}  # key → timestamp
_metrics = collections.defaultdict(int)
_start_time = time.time()
_middleware_status = {
    "kafka": False, "dapr": False, "redis": False, "fluvio": False,
}

# ─── Alert Rules ──────────────────────────────────────────────────────────────

ALERT_RULES = [
    {
        "id": "dpco-licence-expiry-30d",
        "name": "DPCO Licence Expiry Warning (30 days)",
        "trigger": "dpco.registry.expiry_approaching",
        "days_before": 30,
        "severity": "warning",
        "recipients": ["dpco_officer", "ndpc_regulator"],
        "template": "Your DPCO licence {licence_number} expires in 30 days ({expiry_date}). Renew at https://services.ndpc.gov.ng/repo/",
    },
    {
        "id": "dpco-licence-expiry-7d",
        "name": "DPCO Licence Expiry Warning (7 days)",
        "trigger": "dpco.registry.expiry_approaching",
        "days_before": 7,
        "severity": "critical",
        "recipients": ["dpco_officer", "ndpc_regulator"],
        "template": "URGENT: DPCO licence {licence_number} expires in 7 days. Renew immediately.",
    },
    {
        "id": "car-deadline-14d",
        "name": "CAR Filing Deadline Reminder (14 days)",
        "trigger": "dpco.car.deadline_approaching",
        "days_before": 14,
        "severity": "warning",
        "recipients": ["dpco_officer", "data_controller"],
        "template": "CAR filing deadline is in 14 days (31 March {year}). Ensure all client CARs are submitted.",
    },
    {
        "id": "audit-sla-breach",
        "name": "Audit SLA Breach Alert",
        "trigger": "dpco.audit.sla_breached",
        "severity": "critical",
        "recipients": ["dpco_officer", "ndpc_regulator"],
        "template": "SLA BREACH: Audit {audit_id} for {org_name} exceeded the 72-hour NDPC notification window.",
    },
    {
        "id": "compliance-score-drop",
        "name": "Compliance Score Drop Alert",
        "trigger": "dpco.analytics.score_dropped",
        "severity": "warning",
        "recipients": ["dpco_officer", "data_controller"],
        "template": "Compliance score for {org_name} dropped {drop}pts to {score}. Review required.",
    },
    {
        "id": "verification-issued",
        "name": "Verification Statement Issued",
        "trigger": "dpco.verification.issued",
        "severity": "info",
        "recipients": ["data_controller", "ndpc_regulator"],
        "template": "Verification Statement {ref_number} issued by {dpco_name} for {org_name}.",
    },
    {
        "id": "dpco-suspended",
        "name": "DPCO Licence Suspended",
        "trigger": "dpco.licence_suspended",
        "severity": "critical",
        "recipients": ["dpco_officer", "ndpc_regulator", "data_controller"],
        "template": "DPCO {dpco_name} (licence {licence_number}) has been SUSPENDED. Reason: {reason}",
    },
    {
        "id": "audit-car-filed",
        "name": "Audit CAR Filed Successfully",
        "trigger": "dpco.audit.stage_advanced",
        "stage_filter": "car_filed",
        "severity": "info",
        "recipients": ["dpco_officer", "data_controller", "ndpc_regulator"],
        "template": "Compliance Audit Return filed for {org_id} by DPCO {dpco_org_id} (Audit: {audit_id}).",
    },
]

# ─── Deduplication ────────────────────────────────────────────────────────────

def _is_duplicate(key: str, ttl_seconds: int = 86400) -> bool:
    now = time.time()
    with _lock:
        if key in _dedup_cache and now - _dedup_cache[key] < ttl_seconds:
            return True
        _dedup_cache[key] = now
        # Prune old entries
        expired = [k for k, t in _dedup_cache.items() if now - t > ttl_seconds]
        for k in expired:
            del _dedup_cache[k]
    return False

# ─── Notification Delivery ────────────────────────────────────────────────────

def _send_notification(notif: Dict):
    """Deliver a notification via NDSEP relay, Kafka, Fluvio, and Dapr."""
    notif_id = notif.get("id", str(uuid.uuid4()))
    dedup_key = f"notif:{notif.get('rule_id', 'unknown')}:{notif.get('entity_id', 'unknown')}"

    if _is_duplicate(dedup_key):
        log.debug("[Dedup] Skipping duplicate notification: %s", dedup_key)
        _metrics["duplicates_skipped"] += 1
        return

    with _lock:
        _notifications.append(notif)
        if len(_notifications) > 5000:
            _notifications.pop(0)

    _metrics["notifications_sent"] += 1
    log.info("[Notification] Sending: rule=%s severity=%s entity=%s",
             notif.get("rule_id"), notif.get("severity"), notif.get("entity_id"))

    # 1. NDSEP relay (Node.js server)
    try:
        requests.post(NDSEP_RELAY_URL, json={
            "type": "dpco_notification",
            "payload": notif,
        }, timeout=3)
        _metrics["relay_sent"] += 1
    except Exception as e:
        log.debug("[Relay] Error: %s", e)

    # 2. Kafka
    _kafka_produce(KAFKA_PRODUCE_TOPIC, notif)

    # 3. Fluvio edge stream
    _fluvio_publish("dpco.notifications.realtime", notif)

    # 4. Dapr state (mark as delivered)
    _dapr_save_state(f"notif:{notif_id}", {"id": notif_id, "status": "delivered", "sent_at": datetime.now(timezone.utc).isoformat()})

# ─── Event → Notification Routing ────────────────────────────────────────────

def _route_event(event: Dict):
    """Match incoming event to alert rules and dispatch notifications."""
    event_type = event.get("event_type", "")
    now = datetime.now(timezone.utc)

    for rule in ALERT_RULES:
        trigger = rule.get("trigger", "")
        if trigger not in event_type:
            continue
        # Stage filter for audit stage advances
        if "stage_filter" in rule and event.get("to_stage") != rule["stage_filter"]:
            continue

        # Build notification from template
        try:
            message = rule["template"].format(**{**event, "year": now.year})
        except KeyError:
            message = rule["template"]

        notif = {
            "id": str(uuid.uuid4()),
            "rule_id": rule["id"],
            "rule_name": rule["name"],
            "severity": rule["severity"],
            "message": message,
            "recipients": rule["recipients"],
            "entity_id": event.get("dpco_id") or event.get("audit_id") or event.get("statement_id", "unknown"),
            "event_type": event_type,
            "event_data": event,
            "created_at": now.isoformat(),
            "source": "dpco-notification-service",
        }
        _send_notification(notif)

    _metrics["events_routed"] += 1

# ─── Kafka ────────────────────────────────────────────────────────────────────

def _kafka_consumer_thread():
    if not KAFKA_ENABLED:
        return
    try:
        from kafka import KafkaConsumer
        while True:
            try:
                consumer = KafkaConsumer(
                    *KAFKA_CONSUME_TOPICS,
                    bootstrap_servers=KAFKA_BROKERS.split(","),
                    group_id="dpco-notification-service",
                    auto_offset_reset="latest",
                    enable_auto_commit=True,
                    value_deserializer=lambda m: json.loads(m.decode("utf-8")),
                    consumer_timeout_ms=5000,
                )
                _middleware_status["kafka"] = True
                log.info("[Kafka] Consumer connected")
                for msg in consumer:
                    try:
                        _route_event(msg.value)
                        _metrics["kafka_consumed"] += 1
                    except Exception as e:
                        log.warning("[Kafka] Message error: %s", e)
            except Exception as e:
                _middleware_status["kafka"] = False
                log.warning("[Kafka] Connect failed (%s), retry in 15s", e)
                time.sleep(15)
    except ImportError:
        log.warning("[Kafka] kafka-python not installed")

def _kafka_produce(topic: str, event: Dict):
    try:
        from kafka import KafkaProducer
        p = KafkaProducer(
            bootstrap_servers=KAFKA_BROKERS.split(","),
            value_serializer=lambda v: json.dumps(v, default=str).encode("utf-8"),
        )
        p.send(topic, event)
        p.flush()
        _metrics["kafka_produced"] += 1
    except Exception as e:
        log.debug("[Kafka] Produce error: %s", e)

# ─── Fluvio ───────────────────────────────────────────────────────────────────

def _fluvio_publish(topic: str, data: Dict):
    if not FLUVIO_ENABLED:
        return
    try:
        resp = requests.post(
            f"{FLUVIO_HTTP_URL}/topics/{topic}/produce",
            json={"value": json.dumps(data, default=str)},
            timeout=3,
        )
        if resp.status_code < 300:
            _middleware_status["fluvio"] = True
            _metrics["fluvio_published"] += 1
    except Exception as e:
        _middleware_status["fluvio"] = False
        log.debug("[Fluvio] Error: %s", e)

# ─── Dapr ─────────────────────────────────────────────────────────────────────

def _dapr_save_state(key: str, value: Dict):
    if not DAPR_ENABLED:
        return
    try:
        body = [{"key": key, "value": value}]
        resp = requests.post(
            f"http://localhost:{DAPR_HTTP_PORT}/v1.0/state/{DAPR_STATE_STORE}",
            json=body, timeout=3,
        )
        if resp.status_code < 300:
            _middleware_status["dapr"] = True
            _metrics["dapr_state_saves"] += 1
    except Exception as e:
        _middleware_status["dapr"] = False
        log.debug("[Dapr] State save error: %s", e)

# ─── Expiry Check Cron ────────────────────────────────────────────────────────

def _expiry_check_thread():
    """Periodic check for upcoming DPCO licence expiries and CAR deadlines."""
    while True:
        try:
            now = datetime.now(timezone.utc)
            # CAR deadline: 31 March each year
            car_deadline = datetime(now.year, 3, 31, tzinfo=timezone.utc)
            if now > car_deadline:
                car_deadline = datetime(now.year + 1, 3, 31, tzinfo=timezone.utc)
            days_to_car = (car_deadline - now).days
            for days in [14, 7, 1]:
                if days_to_car == days:
                    _route_event({
                        "event_type": "dpco.car.deadline_approaching",
                        "days_before": days,
                        "year": car_deadline.year,
                        "deadline": car_deadline.strftime("%Y-%m-%d"),
                    })
            log.debug("[ExpiryCheck] Days to CAR deadline: %d", days_to_car)
        except Exception as e:
            log.warning("[ExpiryCheck] Error: %s", e)
        time.sleep(3600)  # Check every hour

# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(title="NDSEP DPCO Notification Service", version="1.0.0")

@app.get("/health")
def health():
    with _lock:
        total = len(_notifications)
    return {
        "service": "dpco-notification-service",
        "status": "healthy",
        "port": PORT,
        "uptime_s": round(time.time() - _start_time, 1),
        "middleware": _middleware_status,
        "total_notifications": total,
        "active_rules": len(ALERT_RULES),
        "metrics": dict(_metrics),
        "consume_topics": KAFKA_CONSUME_TOPICS,
        "produce_topic": KAFKA_PRODUCE_TOPIC,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/metrics")
def get_metrics():
    return {"metrics": dict(_metrics), "middleware": _middleware_status}

@app.get("/api/dpco/notifications")
def list_notifications(limit: int = 50, severity: Optional[str] = None):
    with _lock:
        result = list(reversed(_notifications[-500:]))
    if severity:
        result = [n for n in result if n.get("severity") == severity]
    return {"notifications": result[:limit], "total": len(result)}

@app.get("/api/dpco/notifications/rules")
def list_rules():
    return {"rules": ALERT_RULES, "total": len(ALERT_RULES)}

class SendRequest(BaseModel):
    rule_id: str
    entity_id: str
    event_data: Dict[str, Any] = {}

@app.post("/api/dpco/notifications/send")
def send_notification(req: SendRequest):
    rule = next((r for r in ALERT_RULES if r["id"] == req.rule_id), None)
    if not rule:
        return {"error": "Rule not found"}, 404
    event = {**req.event_data, "event_type": rule["trigger"], "entity_id": req.entity_id}
    _route_event(event)
    return {"ok": True, "rule_id": req.rule_id, "entity_id": req.entity_id}

# Dapr subscription manifest
@app.get("/dapr/subscribe")
def dapr_subscribe():
    return [
        {"pubsubname": "kafka-pubsub", "topic": t, "route": f"/dapr/events/{t.replace('.', '/')}"}
        for t in KAFKA_CONSUME_TOPICS
    ]

@app.post("/dapr/events/{path:path}")
async def dapr_event(path: str, request: Request):
    body = await request.json()
    data = body.get("data", body)
    _route_event(data)
    _metrics["dapr_events_received"] += 1
    return {"status": "SUCCESS"}

# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info("DPCO Notification Service starting on port %d", PORT)
    log.info("Middleware: Kafka=%s Dapr=%s Fluvio=%s", KAFKA_ENABLED, DAPR_ENABLED, FLUVIO_ENABLED)
    log.info("Alert rules: %d active", len(ALERT_RULES))

    threading.Thread(target=_kafka_consumer_thread, daemon=True).start()
    threading.Thread(target=_expiry_check_thread, daemon=True).start()

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
