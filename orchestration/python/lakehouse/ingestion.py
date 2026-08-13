"""NDSEP lakehouse ingestion service.

Records are written as real Parquet objects to the configured S3-compatible
lakehouse. Queries and statistics are derived from those objects; no process
memory or local-file fallback is reported as persisted lakehouse data.
"""
import io
import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO, format="[lakehouse] %(asctime)s %(message)s")
logger = logging.getLogger(__name__)
app = FastAPI(title="NDSEP Lakehouse Ingestion", version="3.0.0")

S3_BUCKET = os.getenv("LAKEHOUSE_S3_BUCKET", "").strip()
S3_PREFIX = os.getenv("LAKEHOUSE_S3_PREFIX", "delta").strip("/")
S3_ENDPOINT_URL = os.getenv("LAKEHOUSE_S3_ENDPOINT_URL") or os.getenv("AWS_ENDPOINT_URL_S3")
S3_REGION = os.getenv("AWS_REGION", "us-east-1")
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "")
DELTA_LAKE_URI = f"s3://{S3_BUCKET}/{S3_PREFIX}" if S3_BUCKET else None

SCHEMAS: Dict[str, pa.Schema] = {
    "compliance_events": pa.schema([pa.field("id", pa.string()), pa.field("org_id", pa.int64()), pa.field("framework", pa.string()), pa.field("score", pa.float64()), pa.field("event_type", pa.string()), pa.field("ingested_at", pa.timestamp("ms", tz="UTC"))]),
    "violations": pa.schema([pa.field("id", pa.string()), pa.field("org_id", pa.int64()), pa.field("framework", pa.string()), pa.field("article", pa.string()), pa.field("severity", pa.string()), pa.field("ingested_at", pa.timestamp("ms", tz="UTC"))]),
    "financial_records": pa.schema([pa.field("id", pa.string()), pa.field("org_id", pa.int64()), pa.field("penalty_id", pa.string()), pa.field("amount_usd", pa.float64()), pa.field("tx_type", pa.string()), pa.field("status", pa.string()), pa.field("ingested_at", pa.timestamp("ms", tz="UTC"))]),
    "network_events": pa.schema([pa.field("id", pa.string()), pa.field("src_ip", pa.string()), pa.field("dst_ip", pa.string()), pa.field("protocol", pa.string()), pa.field("bytes", pa.int64()), pa.field("ingested_at", pa.timestamp("ms", tz="UTC"))]),
    "audit_trail": pa.schema([pa.field("id", pa.string()), pa.field("user_id", pa.int64()), pa.field("action", pa.string()), pa.field("resource_type", pa.string()), pa.field("resource_id", pa.string()), pa.field("ingested_at", pa.timestamp("ms", tz="UTC"))]),
}
DEFAULT_SCHEMA = pa.schema([pa.field("id", pa.string()), pa.field("data", pa.string()), pa.field("ingested_at", pa.timestamp("ms", tz="UTC"))])


def _s3_client():
    if not S3_BUCKET:
        raise HTTPException(status_code=503, detail="LAKEHOUSE_S3_BUCKET is not configured")
    try:
        import boto3
        return boto3.client("s3", endpoint_url=S3_ENDPOINT_URL, region_name=S3_REGION)
    except ImportError as error:
        raise HTTPException(status_code=503, detail="boto3 is required for lakehouse storage") from error


def _raise_storage_error(operation: str, error: Exception) -> None:
    logger.error("Lakehouse %s failed: %s", operation, error)
    raise HTTPException(status_code=503, detail=f"Lakehouse object storage unavailable during {operation}") from error


def _get_schema(table: str) -> pa.Schema:
    return SCHEMAS.get(table, DEFAULT_SCHEMA)


def _normalize_records(table: str, records: List[Dict[str, Any]], now: datetime) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for record in records:
        item = dict(record)
        item.setdefault("id", str(uuid.uuid4()))
        item["ingested_at"] = now
        if table not in SCHEMAS:
            item = {"id": str(item["id"]), "data": json.dumps(item, default=str), "ingested_at": now}
        normalized.append(item)
    return normalized


def _to_parquet(table: str, records: List[Dict[str, Any]], now: datetime) -> bytes:
    schema = _get_schema(table)
    normalized = _normalize_records(table, records, now)
    try:
        arrays: Dict[str, List[Any]] = {}
        for field in schema:
            values = [row.get(field.name) for row in normalized]
            if pa.types.is_timestamp(field.type):
                values = [value if isinstance(value, datetime) else now for value in values]
            elif pa.types.is_int64(field.type):
                values = [int(value) if value is not None else 0 for value in values]
            elif pa.types.is_float64(field.type):
                values = [float(value) if value is not None else 0.0 for value in values]
            else:
                values = [str(value) if value is not None else "" for value in values]
            arrays[field.name] = values
        output = io.BytesIO()
        pq.write_table(pa.table(arrays, schema=schema), output, compression="snappy")
        return output.getvalue()
    except Exception as error:
        logger.error("Parquet serialization failed for %s: %s", table, error)
        raise HTTPException(status_code=422, detail=f"Records cannot be serialized for table {table!r}") from error


def _write_parquet(table: str, records: List[Dict[str, Any]]) -> str:
    now = datetime.now(timezone.utc)
    key = f"{S3_PREFIX}/{table}/{now.strftime('%Y/%m/%d')}/{uuid.uuid4()}.parquet"
    payload = _to_parquet(table, records, now)
    try:
        _s3_client().put_object(Bucket=S3_BUCKET, Key=key, Body=payload, ContentType="application/octet-stream")
    except HTTPException:
        raise
    except Exception as error:
        _raise_storage_error("Parquet upload", error)
    uri = f"s3://{S3_BUCKET}/{key}"
    logger.info("Persisted %s records to %s", len(records), uri)
    return uri


def _list_objects(table: Optional[str] = None) -> List[Dict[str, Any]]:
    prefix = f"{S3_PREFIX}/" + (f"{table}/" if table else "")
    try:
        paginator = _s3_client().get_paginator("list_objects_v2")
        objects: List[Dict[str, Any]] = []
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
            objects.extend(page.get("Contents", []))
        return [entry for entry in objects if str(entry.get("Key", "")).endswith(".parquet")]
    except HTTPException:
        raise
    except Exception as error:
        _raise_storage_error("object listing", error)


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _read_recent_records(table: str, limit: int) -> List[Dict[str, Any]]:
    objects = sorted(_list_objects(table), key=lambda entry: str(entry.get("LastModified", "")), reverse=True)
    result: List[Dict[str, Any]] = []
    try:
        client = _s3_client()
        for entry in objects:
            response = client.get_object(Bucket=S3_BUCKET, Key=entry["Key"])
            table_data = pq.read_table(io.BytesIO(response["Body"].read()))
            rows = table_data.to_pylist()
            for row in reversed(rows):
                result.append({key: _json_value(value) for key, value in row.items()})
                if len(result) >= limit:
                    return result
        return result
    except HTTPException:
        raise
    except Exception as error:
        _raise_storage_error("Parquet query", error)


def _start_kafka_consumer() -> None:
    if not KAFKA_BROKERS:
        logger.info("Kafka ingestion disabled: KAFKA_BROKERS is not configured")
        return
    try:
        from confluent_kafka import Consumer
    except ImportError:
        logger.error("Kafka ingestion unavailable: confluent-kafka is not installed")
        return

    topic_table = {
        "ndsep.compliance.violations": "violations",
        "ndsep.financial.transactions": "financial_records",
        "ndsep.network.events": "network_events",
        "ndsep.audit.trail": "audit_trail",
        "ndsep.threat.intel": "threat_intel",
        "ndsep.penalty.issued": "financial_records",
    }
    config: Dict[str, str] = {"bootstrap.servers": KAFKA_BROKERS, "group.id": "ndsep-lakehouse-ingestion", "auto.offset.reset": "latest", "enable.auto.commit": "false"}
    if os.getenv("KAFKA_SASL_USER"):
        config.update({"security.protocol": "SASL_SSL", "sasl.mechanism": "PLAIN", "sasl.username": os.environ["KAFKA_SASL_USER"], "sasl.password": os.getenv("KAFKA_SASL_PASS", "")})

    def consume() -> None:
        consumer = Consumer(config)
        consumer.subscribe(list(topic_table))
        batches: Dict[str, List[Dict[str, Any]]] = {}
        try:
            while True:
                message = consumer.poll(1.0)
                if message is None:
                    continue
                if message.error():
                    logger.error("Kafka consume error: %s", message.error())
                    continue
                table = topic_table.get(message.topic(), "streaming_events")
                try:
                    record = json.loads(message.value().decode("utf-8"))
                except Exception:
                    record = {"raw": message.value().decode("utf-8", errors="replace")}
                batches.setdefault(table, []).append(record)
                if len(batches[table]) >= 100:
                    _write_parquet(table, batches[table])
                    batches[table] = []
                    consumer.commit(asynchronous=False)
        except Exception as error:
            logger.exception("Kafka consumer stopped without committing unpersisted data: %s", error)
        finally:
            consumer.close()

    threading.Thread(target=consume, daemon=True).start()


class IngestRequest(BaseModel):
    table: str
    records: List[Dict[str, Any]]
    partition_by: Optional[str] = "date"
    dedup_key: Optional[str] = None


class IngestResponse(BaseModel):
    ok: bool
    table: str
    records_written: int
    partition: str
    ingested_at: str
    uri: str


@app.get("/health")
def health():
    try:
        _s3_client().head_bucket(Bucket=S3_BUCKET)
    except HTTPException:
        raise
    except Exception as error:
        _raise_storage_error("health check", error)
    return {"service": "lakehouse-ingestion", "status": "healthy", "version": "3.0.0", "s3_bucket": S3_BUCKET, "delta_lake_uri": DELTA_LAKE_URI, "kafka_configured": bool(KAFKA_BROKERS), "timestamp": datetime.now(timezone.utc).isoformat()}


@app.post("/lakehouse/ingest", response_model=IngestResponse)
def ingest(request: IngestRequest):
    if not request.records:
        raise HTTPException(status_code=400, detail="No records provided")
    if request.dedup_key:
        logger.warning("dedup_key is not used without a transactional table catalog; event producers must provide idempotency keys")
    now = datetime.now(timezone.utc)
    uri = _write_parquet(request.table, request.records)
    return IngestResponse(ok=True, table=request.table, records_written=len(request.records), partition=now.strftime("%Y-%m-%d"), ingested_at=now.isoformat(), uri=uri)


@app.get("/lakehouse/query/{table}")
def query_table(table: str, limit: int = 50):
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 1000")
    records = _read_recent_records(table, limit)
    if not records and not _list_objects(table):
        raise HTTPException(status_code=404, detail=f"Table {table!r} has no persisted Parquet objects")
    return {"table": table, "records": records, "total_returned": len(records), "delta_lake_uri": f"{DELTA_LAKE_URI}/{table}"}


@app.get("/lakehouse/tables")
def list_tables():
    tables: Dict[str, int] = {}
    for entry in _list_objects():
        key = str(entry["Key"])
        suffix = key.removeprefix(f"{S3_PREFIX}/")
        table = suffix.split("/", 1)[0]
        tables[table] = tables.get(table, 0) + 1
    return {"tables": [{"name": name, "parquet_objects": count, "uri": f"{DELTA_LAKE_URI}/{name}"} for name, count in sorted(tables.items())]}


@app.post("/lakehouse/compliance-event")
def ingest_compliance_event(event: Dict[str, Any]):
    return ingest(IngestRequest(table="compliance_events", records=[event]))


@app.post("/lakehouse/violation")
def ingest_violation(event: Dict[str, Any]):
    return ingest(IngestRequest(table="violations", records=[event], dedup_key="violation_id"))


@app.post("/lakehouse/financial")
def ingest_financial(event: Dict[str, Any]):
    return ingest(IngestRequest(table="financial_records", records=[event]))


@app.post("/lakehouse/network-event")
def ingest_network_event(event: Dict[str, Any]):
    return ingest(IngestRequest(table="network_events", records=[event]))


@app.post("/lakehouse/audit")
def ingest_audit(event: Dict[str, Any]):
    return ingest(IngestRequest(table="audit_trail", records=[event]))


@app.on_event("startup")
def on_startup():
    logger.info("Lakehouse starting with S3 bucket=%s Kafka configured=%s", S3_BUCKET or "<missing>", bool(KAFKA_BROKERS))
    _start_kafka_consumer()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8210")), log_level="info")
