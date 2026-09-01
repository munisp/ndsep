"""
NDSEP DPCO Analytics Service — durable PostgreSQL implementation.

Authoritative DPCO analytics events and aggregates are persisted to PostgreSQL.
Kafka, Fluvio, Dapr, Redis, and Lakehouse are integrations around that source of
truth; none is permitted to replace it with process-local state or demo data.
"""
from __future__ import annotations

import hashlib
import hmac
import io
import json
import logging
import os
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format="[dpco-analytics] %(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

PORT = int(os.getenv("PORT", "8330"))
APP_ENV = os.getenv("APP_ENV", os.getenv("NODE_ENV", "development")).lower()
DATABASE_URL = os.getenv("DPCO_ANALYTICS_DATABASE_URL") or os.getenv("DATABASE_URL")
DATABASE_POOL_MIN = int(os.getenv("DPCO_ANALYTICS_DB_POOL_MIN", "1"))
DATABASE_POOL_MAX = int(os.getenv("DPCO_ANALYTICS_DB_POOL_MAX", "10"))
SERVICE_TOKEN = os.getenv("DPCO_ANALYTICS_SERVICE_TOKEN", "")
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
KAFKA_ENABLED = os.getenv("KAFKA_ENABLED", "false").lower() == "true"
KAFKA_CONSUME_TOPICS = [
    "ndsep.dpco.audit.events",
    "ndsep.dpco.registry.events",
    "ndsep.dpco.verification.events",
]
KAFKA_PRODUCE_TOPIC = "ndsep.dpco.analytics.events"
FLUVIO_HTTP_URL = os.getenv("FLUVIO_HTTP_URL", "")
FLUVIO_ENABLED = os.getenv("FLUVIO_ENABLED", "false").lower() == "true"
LAKEHOUSE_S3_ENDPOINT = os.getenv("LAKEHOUSE_S3_ENDPOINT", "")
LAKEHOUSE_S3_BUCKET = os.getenv("LAKEHOUSE_S3_BUCKET", "")
LAKEHOUSE_S3_ACCESS_KEY = os.getenv("LAKEHOUSE_S3_ACCESS_KEY", "")
LAKEHOUSE_S3_SECRET_KEY = os.getenv("LAKEHOUSE_S3_SECRET_KEY", "")
LAKEHOUSE_ENABLED = os.getenv("LAKEHOUSE_ENABLED", "false").lower() == "true"
REDIS_URL = os.getenv("REDIS_URL", "")
DAPR_HTTP_PORT = os.getenv("DAPR_HTTP_PORT", "3500")
DAPR_ENABLED = os.getenv("DAPR_ENABLED", "false").lower() == "true"
DAPR_APP_ID = os.getenv("DAPR_APP_ID", "dpco-analytics")

_metrics: dict[str, int] = {}
_start_time = time.time()
_middleware_status = {"kafka": False, "fluvio": False, "lakehouse": False, "redis": False, "dapr": False}


def metric_increment(name: str, amount: int = 1) -> None:
    _metrics[name] = _metrics.get(name, 0) + amount


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def canonical_json(value: dict[str, Any]) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def parse_timestamp(value: Any) -> datetime:
    if value is None:
        return utc_now()
    if not isinstance(value, str):
        raise ValueError("event timestamp must be an ISO-8601 string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("event timestamp must include a UTC offset")
    return parsed.astimezone(timezone.utc)


def finite_score(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    score = float(value)
    if not 0 <= score <= 100:
        raise ValueError("compliance_score must be between 0 and 100")
    return score


def require_configuration() -> None:
    if not DATABASE_URL:
        raise RuntimeError("DPCO_ANALYTICS_DATABASE_URL or DATABASE_URL is required; analytics has no in-memory fallback")
    if DATABASE_POOL_MIN < 1 or DATABASE_POOL_MAX < DATABASE_POOL_MIN:
        raise RuntimeError("DPCO analytics database pool bounds are invalid")
    if APP_ENV == "production" and len(SERVICE_TOKEN) < 32:
        raise RuntimeError("DPCO_ANALYTICS_SERVICE_TOKEN must be at least 32 characters in production")
    if APP_ENV == "production" and not DATABASE_URL.startswith("postgresql"):
        raise RuntimeError("DPCO analytics production database URL must be PostgreSQL")


class DurableAnalyticsStore:
    """PostgreSQL source of truth for DPCO analytics events and materialized stats."""

    def __init__(self, dsn: str):
        self.pool = ConnectionPool(
            conninfo=dsn,
            min_size=DATABASE_POOL_MIN,
            max_size=DATABASE_POOL_MAX,
            kwargs={"autocommit": False, "row_factory": dict_row},
            open=True,
        )

    @contextmanager
    def connection(self) -> Iterator[Any]:
        with self.pool.connection() as connection:
            yield connection

    def close(self) -> None:
        self.pool.close()

    def ping(self) -> None:
        with self.connection() as connection:
            connection.execute("SELECT 1")

    def ingest_event(self, event: dict[str, Any], source: str) -> bool:
        if source not in {"api", "kafka", "dapr"}:
            raise ValueError("event source is not permitted")
        event_type = event.get("event_type")
        if not isinstance(event_type, str) or not event_type or len(event_type) > 128:
            raise ValueError("event_type is required and must be at most 128 characters")
        dpco_id = event.get("dpco_id") or event.get("dpco_org_id")
        if not isinstance(dpco_id, (str, int)) or not str(dpco_id).strip() or len(str(dpco_id)) > 128:
            raise ValueError("dpco_id or dpco_org_id is required and must be at most 128 characters")

        occurred_at = parse_timestamp(event.get("timestamp"))
        score = finite_score(event.get("compliance_score"))
        to_stage = event.get("to_stage")
        if to_stage is not None and (not isinstance(to_stage, str) or len(to_stage) > 128):
            raise ValueError("to_stage must be a string of at most 128 characters")

        payload = dict(event)
        payload_json = canonical_json(payload)
        payload_sha256 = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
        event_id = uuid.uuid5(uuid.NAMESPACE_URL, f"ndsep:dpco-analytics:{source}:{payload_sha256}")
        audit_started = 1 if event_type == "dpco.audit.initiated" else 0
        audit_completed = 1 if event_type == "dpco.audit.stage_advanced" and to_stage == "car_filed" else 0
        statement_issued = 1 if event_type == "dpco.verification.issued" else 0
        actual_sla_breach = 1 if event_type == "dpco.sla.breached" or payload.get("sla_breached") is True else 0
        score_total = score if event_type == "dpco.audit.control_assessed" and score is not None else 0
        score_count = 1 if event_type == "dpco.audit.control_assessed" and score is not None else 0

        with self.connection() as connection:
            with connection.transaction():
                inserted = connection.execute(
                    """
                    INSERT INTO dpco_analytics_events
                        (id, event_type, dpco_id, source, occurred_at, compliance_score, to_stage, payload, payload_sha256)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (source, payload_sha256) DO NOTHING
                    RETURNING id
                    """,
                    (str(event_id), event_type, str(dpco_id), source, occurred_at, score, to_stage, payload_json, payload_sha256),
                ).fetchone()
                if inserted is None:
                    return False
                connection.execute(
                    """
                    INSERT INTO dpco_analytics_dpco_stats
                        (dpco_id, audits_initiated, audits_completed, statements_issued, score_total, score_count, sla_breaches, last_activity)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (dpco_id) DO UPDATE SET
                        audits_initiated = dpco_analytics_dpco_stats.audits_initiated + EXCLUDED.audits_initiated,
                        audits_completed = dpco_analytics_dpco_stats.audits_completed + EXCLUDED.audits_completed,
                        statements_issued = dpco_analytics_dpco_stats.statements_issued + EXCLUDED.statements_issued,
                        score_total = dpco_analytics_dpco_stats.score_total + EXCLUDED.score_total,
                        score_count = dpco_analytics_dpco_stats.score_count + EXCLUDED.score_count,
                        sla_breaches = dpco_analytics_dpco_stats.sla_breaches + EXCLUDED.sla_breaches,
                        last_activity = GREATEST(dpco_analytics_dpco_stats.last_activity, EXCLUDED.last_activity),
                        updated_at = NOW()
                    """,
                    (str(dpco_id), audit_started, audit_completed, statement_issued, score_total, score_count, actual_sla_breach, occurred_at),
                )
        return True

    def event_count(self) -> int:
        with self.connection() as connection:
            row = connection.execute("SELECT COUNT(*)::int AS count FROM dpco_analytics_events").fetchone()
            return int(row["count"])

    def dpco_count(self) -> int:
        with self.connection() as connection:
            row = connection.execute("SELECT COUNT(*)::int AS count FROM dpco_analytics_dpco_stats").fetchone()
            return int(row["count"])

    def trends(self) -> dict[str, Any]:
        with self.connection() as connection:
            rows = connection.execute(
                """
                SELECT
                    TO_CHAR(date_trunc('week', occurred_at), 'IYYY-"W"IW') AS week,
                    COUNT(*) FILTER (WHERE event_type = 'dpco.audit.initiated')::int AS audits,
                    COUNT(*) FILTER (WHERE event_type = 'dpco.verification.issued')::int AS statements,
                    COALESCE(ROUND(AVG(compliance_score) FILTER (WHERE event_type = 'dpco.audit.control_assessed'), 1), 0)::float AS avg_score
                FROM dpco_analytics_events
                WHERE occurred_at >= NOW() - INTERVAL '180 days'
                GROUP BY date_trunc('week', occurred_at)
                ORDER BY date_trunc('week', occurred_at)
                """
            ).fetchall()
        return {"weeks": rows, "total_weeks": len(rows), "generated_at": utc_now().isoformat(), "source": "postgresql"}

    def portfolio(self) -> list[dict[str, Any]]:
        with self.connection() as connection:
            return connection.execute(
                """
                SELECT dpco_id, audits_initiated, audits_completed, statements_issued,
                    CASE WHEN score_count = 0 THEN 0 ELSE ROUND(score_total / score_count, 1) END::float AS avg_compliance_score,
                    sla_breaches, last_activity
                FROM dpco_analytics_dpco_stats
                ORDER BY last_activity DESC NULLS LAST, dpco_id
                """
            ).fetchall()

    def sla(self) -> list[dict[str, Any]]:
        with self.connection() as connection:
            return connection.execute(
                """
                SELECT dpco_id,
                    audits_initiated::int AS total_audits,
                    sla_breaches::int AS breached,
                    CASE WHEN audits_initiated = 0 THEN 0
                         ELSE ROUND((sla_breaches::numeric / audits_initiated) * 100, 1)
                    END::float AS rate
                FROM dpco_analytics_dpco_stats
                ORDER BY dpco_id
                """
            ).fetchall()

    def heatmap(self) -> list[dict[str, Any]]:
        with self.connection() as connection:
            return connection.execute(
                """
                SELECT TO_CHAR(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
                FROM dpco_analytics_events
                WHERE occurred_at >= NOW() - INTERVAL '365 days'
                GROUP BY date_trunc('day', occurred_at)
                ORDER BY date_trunc('day', occurred_at)
                """
            ).fetchall()


_store: Optional[DurableAnalyticsStore] = None
_store_lock = threading.Lock()


def get_store() -> DurableAnalyticsStore:
    global _store
    require_configuration()
    with _store_lock:
        if _store is None:
            _store = DurableAnalyticsStore(DATABASE_URL or "")
        return _store


def _redis_client() -> Any:
    if not REDIS_URL:
        raise RuntimeError("REDIS_URL is not configured")
    import redis
    return redis.from_url(REDIS_URL, socket_connect_timeout=2, socket_timeout=2)


def _redis_set(key: str, value: dict[str, Any], ttl: int = 300) -> None:
    try:
        _redis_client().setex(key, ttl, canonical_json(value))
        _middleware_status["redis"] = True
        metric_increment("redis_sets")
    except Exception as error:
        _middleware_status["redis"] = False
        log.warning("[Redis] cache write failed: %s", error)


def _redis_get(key: str) -> Optional[dict[str, Any]]:
    try:
        value = _redis_client().get(key)
        if value:
            _middleware_status["redis"] = True
            metric_increment("redis_hits")
            return json.loads(value)
    except Exception as error:
        _middleware_status["redis"] = False
        log.warning("[Redis] cache read failed: %s", error)
    return None


def _invalidate_caches() -> None:
    try:
        _redis_client().delete("dpco:analytics:trends", "dpco:analytics:portfolio")
        _middleware_status["redis"] = True
    except Exception as error:
        _middleware_status["redis"] = False
        log.warning("[Redis] cache invalidation failed: %s", error)


def _kafka_produce(topic: str, event: dict[str, Any]) -> bool:
    if not KAFKA_ENABLED:
        return False
    try:
        from kafka import KafkaProducer
        producer = KafkaProducer(
            bootstrap_servers=KAFKA_BROKERS.split(","),
            value_serializer=lambda value: canonical_json(value).encode("utf-8"),
        )
        producer.send(topic, event).get(timeout=10)
        producer.flush(timeout=10)
        producer.close(timeout=10)
        metric_increment("kafka_produced")
        return True
    except Exception as error:
        _middleware_status["kafka"] = False
        log.warning("[Kafka] publish failed: %s", error)
        return False


def _fluvio_publish(topic: str, data: dict[str, Any]) -> None:
    if not FLUVIO_ENABLED:
        return
    try:
        response = requests.post(
            f"{FLUVIO_HTTP_URL.rstrip('/')}/topics/{topic}/produce",
            json={"value": canonical_json(data)},
            timeout=3,
        )
        response.raise_for_status()
        _middleware_status["fluvio"] = True
        metric_increment("fluvio_published")
    except Exception as error:
        _middleware_status["fluvio"] = False
        log.warning("[Fluvio] publish failed: %s", error)


def _lakehouse_ingest(table: str, records: list[dict[str, Any]]) -> None:
    if not LAKEHOUSE_ENABLED:
        return
    try:
        import boto3
        import pyarrow as pa
        import pyarrow.parquet as pq
        from botocore.client import Config

        if not all([LAKEHOUSE_S3_ENDPOINT, LAKEHOUSE_S3_BUCKET, LAKEHOUSE_S3_ACCESS_KEY, LAKEHOUSE_S3_SECRET_KEY]):
            raise RuntimeError("lakehouse is enabled but S3 configuration is incomplete")
        now = utc_now()
        rows = [{**record, "ingested_at": now.isoformat()} for record in records]
        columns = {key: [canonical_json(row[key]) if isinstance(row.get(key), (dict, list)) else str(row.get(key, "")) for row in rows] for key in rows[0]}
        buffer = io.BytesIO()
        pq.write_table(pa.table(columns), buffer, compression="snappy")
        s3 = boto3.client(
            "s3",
            endpoint_url=LAKEHOUSE_S3_ENDPOINT,
            aws_access_key_id=LAKEHOUSE_S3_ACCESS_KEY,
            aws_secret_access_key=LAKEHOUSE_S3_SECRET_KEY,
            config=Config(signature_version="s3v4"),
        )
        key = f"dpco/{table}/{now.strftime('%Y/%m/%d')}/{uuid.uuid4()}.parquet"
        s3.put_object(Bucket=LAKEHOUSE_S3_BUCKET, Key=key, Body=buffer.getvalue())
        _middleware_status["lakehouse"] = True
        metric_increment("lakehouse_ingested", len(records))
    except Exception as error:
        _middleware_status["lakehouse"] = False
        log.warning("[Lakehouse] ingest failed: %s", error)


def _dapr_publish(topic: str, data: dict[str, Any]) -> None:
    if not DAPR_ENABLED:
        return
    try:
        response = requests.post(
            f"http://localhost:{DAPR_HTTP_PORT}/v1.0/publish/kafka-pubsub/{topic}",
            json=data,
            timeout=3,
        )
        response.raise_for_status()
        _middleware_status["dapr"] = True
        metric_increment("dapr_published")
    except Exception as error:
        _middleware_status["dapr"] = False
        log.warning("[Dapr] publish failed: %s", error)


def _ingest_event(event: dict[str, Any], source: str) -> bool:
    """Persist first. Downstream middleware cannot make domain analytics authoritative."""
    inserted = get_store().ingest_event(event, source)
    if not inserted:
        metric_increment("duplicate_events")
        return False
    metric_increment("events_ingested")
    _invalidate_caches()
    persisted = {**event, "source": source, "persisted_at": utc_now().isoformat()}
    threading.Thread(target=_lakehouse_ingest, args=("dpco_events", [persisted]), daemon=True).start()
    _fluvio_publish("dpco.analytics.realtime", persisted)
    _dapr_publish("dpco.analytics.processed", persisted)
    return True


def _kafka_consumer_thread() -> None:
    if not KAFKA_ENABLED:
        log.info("[Kafka] consumer disabled")
        return
    try:
        from kafka import KafkaConsumer
    except ImportError as error:
        raise RuntimeError("kafka-python is required when KAFKA_ENABLED=true") from error

    while True:
        consumer = None
        try:
            consumer = KafkaConsumer(
                *KAFKA_CONSUME_TOPICS,
                bootstrap_servers=KAFKA_BROKERS.split(","),
                group_id="dpco-analytics-service",
                auto_offset_reset="earliest",
                enable_auto_commit=False,
                value_deserializer=lambda message: json.loads(message.decode("utf-8")),
                consumer_timeout_ms=5000,
            )
            _middleware_status["kafka"] = True
            for message in consumer:
                _ingest_event(message.value, source="kafka")
                consumer.commit()
                metric_increment("kafka_consumed")
        except Exception as error:
            _middleware_status["kafka"] = False
            log.warning("[Kafka] consumer error; offset was not committed for failed persistence: %s", error)
            time.sleep(15)
        finally:
            if consumer is not None:
                consumer.close()


class IngestRequest(BaseModel):
    events: list[dict[str, Any]] = Field(min_length=1, max_length=500)


app = FastAPI(title="NDSEP DPCO Analytics Service", version="2.0.0")


def require_service_token(request: Request) -> None:
    if not SERVICE_TOKEN:
        if APP_ENV == "production":
            raise HTTPException(status_code=503, detail="analytics service authentication is not configured")
        return
    supplied = request.headers.get("X-NDSEP-Service-Token", "")
    if not hmac.compare_digest(supplied, SERVICE_TOKEN):
        raise HTTPException(status_code=401, detail="invalid analytics service credential")


@app.get("/health")
def health():
    try:
        store = get_store()
        store.ping()
        return {
            "service": "dpco-analytics-service",
            "status": "healthy",
            "persistence": "postgresql",
            "port": PORT,
            "uptime_s": round(time.time() - _start_time, 1),
            "middleware": _middleware_status,
            "total_events_ingested": store.event_count(),
            "total_dpcos_tracked": store.dpco_count(),
            "metrics": _metrics,
            "consume_topics": KAFKA_CONSUME_TOPICS,
            "produce_topic": KAFKA_PRODUCE_TOPIC,
            "timestamp": utc_now().isoformat(),
        }
    except Exception as error:
        return JSONResponse(status_code=503, content={"service": "dpco-analytics-service", "status": "not_ready", "persistence": "unavailable", "error": str(error)})


@app.get("/metrics")
def get_metrics():
    return {"metrics": _metrics, "middleware_status": _middleware_status, "uptime_s": round(time.time() - _start_time, 1)}


@app.get("/api/dpco/analytics/trends")
def get_trends(request: Request):
    require_service_token(request)
    cached = _redis_get("dpco:analytics:trends")
    if cached:
        return {**cached, "cache": "hit"}
    result = get_store().trends()
    _redis_set("dpco:analytics:trends", result, ttl=300)
    return {**result, "cache": "miss"}


@app.get("/api/dpco/analytics/portfolio")
def get_portfolio(request: Request):
    require_service_token(request)
    cached = _redis_get("dpco:analytics:portfolio")
    if cached:
        return {"dpcos": cached, "total": len(cached), "cache": "hit", "source": "postgresql"}
    data = get_store().portfolio()
    _redis_set("dpco:analytics:portfolio", data, ttl=120)
    return {"dpcos": data, "total": len(data), "cache": "miss", "source": "postgresql"}


@app.get("/api/dpco/analytics/sla")
def get_sla(request: Request):
    require_service_token(request)
    data = get_store().sla()
    return {"sla_data": data, "total": len(data), "source": "postgresql"}


@app.get("/api/dpco/analytics/heatmap")
def get_heatmap(request: Request):
    require_service_token(request)
    data = get_store().heatmap()
    return {"heatmap": data, "days": len(data), "source": "postgresql"}


@app.post("/api/dpco/analytics/ingest")
def ingest_events(request: Request, body: IngestRequest):
    require_service_token(request)
    inserted = 0
    duplicate = 0
    try:
        for event in body.events:
            if _ingest_event(event, source="api"):
                inserted += 1
            else:
                duplicate += 1
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        log.exception("[PostgreSQL] event persistence failed")
        raise HTTPException(status_code=503, detail="durable analytics persistence is unavailable") from error
    _kafka_produce(KAFKA_PRODUCE_TOPIC, {
        "event_type": "dpco.analytics.batch_ingested",
        "count": inserted,
        "duplicates": duplicate,
        "timestamp": utc_now().isoformat(),
        "source": "dpco-analytics-service",
    })
    return {"ok": True, "ingested": inserted, "duplicates": duplicate, "source": "postgresql"}


@app.get("/dapr/subscribe")
def dapr_subscribe():
    return [{"pubsubname": "kafka-pubsub", "topic": topic, "route": f"/dapr/events/{topic.replace('.', '/')}"} for topic in KAFKA_CONSUME_TOPICS]


@app.post("/dapr/events/{path:path}")
async def dapr_event(path: str, request: Request):
    body = await request.json()
    data = body.get("data", body)
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Dapr event data must be an object")
    try:
        _ingest_event(data, source="dapr")
        return {"status": "SUCCESS"}
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        log.exception("[Dapr] durable event persistence failed")
        raise HTTPException(status_code=503, detail="durable analytics persistence is unavailable") from error


if __name__ == "__main__":
    require_configuration()
    get_store().ping()
    log.info("DPCO analytics service starting with PostgreSQL source of truth on port %d", PORT)
    if KAFKA_ENABLED:
        threading.Thread(target=_kafka_consumer_thread, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
