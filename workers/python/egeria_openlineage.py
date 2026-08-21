#!/usr/bin/env python3.11
"""
NDSEP Egeria + OpenLineage Metadata Worker (Layer 2)
Simulates Apache Egeria vendor-neutral metadata exchange and OpenLineage pipeline lineage tracking
Captures data lineage from Airflow, Spark, dbt pipelines and exchanges metadata across systems
Port: 8094
"""

import json
import logging
import os
import random
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

import psycopg2
import psycopg2.extras

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [NDSEP-Egeria] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("egeria_openlineage")

PORT = 8094
VERSION = "1.0.0"

DB_URL = os.environ.get(
    "WORKER_DATABASE_URL",
    "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"
)

metrics = {
    "lineage_events_captured": 0,
    "datasets_tracked": 0,
    "jobs_tracked": 0,
    "runs_recorded": 0,
    "egeria_metadata_exchanges": 0,
    "schema_changes_detected": 0,
    "data_quality_checks": 0,
    "pii_lineage_tracked": 0,
    "cross_system_links": 0,
    "uptime_seconds": 0,
}
metrics_lock = threading.Lock()
start_time = time.time()

# OpenLineage event types
OPENLINEAGE_EVENTS = ["START", "COMPLETE", "FAIL", "ABORT", "OTHER"]

PIPELINE_JOBS = [
    "airflow.citizen_pii_ingestion", "spark.financial_aggregation",
    "dbt.compliance_report_transform", "airflow.health_records_sync",
    "spark.cross_border_analytics", "dbt.risk_score_calculation",
    "airflow.asset_inventory_sync", "spark.audit_log_archival",
    "dbt.organization_metrics", "airflow.threat_intel_feed",
]

DATASETS = [
    "s3://ndsep-lake/citizens/pii/", "hdfs://namenode/financial/transactions/",
    "kafka://broker:9092/compliance-events", "postgresql://ndsep_db/organizations",
    "s3://ndsep-lake/health/records/", "hdfs://namenode/audit/logs/",
    "kafka://broker:9092/network-events", "postgresql://ndsep_db/assets",
    "s3://ndsep-lake/tax/returns/", "hdfs://namenode/ml/features/",
]

EGERIA_SERVERS = [
    "metadata-server-1", "metadata-server-2", "view-server", "integration-daemon"
]

ORG_NAMES = [
    "National Bank of Finance", "Federal Ministry of Health",
    "Digital Commerce Ltd", "TelecomNG Plc", "Energy Corp National",
]


def get_db():
    return psycopg2.connect(DB_URL)


def run_openlineage_tracker():
    """Capture OpenLineage events from data pipelines."""
    while True:
        try:
            conn = get_db()
            cur = conn.cursor()
            while True:
                job = random.choice(PIPELINE_JOBS)
                event_type = random.choice(OPENLINEAGE_EVENTS)
                input_ds = random.choice(DATASETS)
                output_ds = random.choice(DATASETS)
                run_id = str(uuid.uuid4())
                duration_ms = random.randint(500, 30000)
                rows_processed = random.randint(100, 1000000)
                has_pii = random.random() < 0.4
                schema_change = random.random() < 0.08

                with metrics_lock:
                    metrics["lineage_events_captured"] += 1
                    metrics["jobs_tracked"] = len(PIPELINE_JOBS)
                    metrics["datasets_tracked"] = len(DATASETS)
                    metrics["runs_recorded"] += 1
                    if has_pii:
                        metrics["pii_lineage_tracked"] += 1
                    if schema_change:
                        metrics["schema_changes_detected"] += 1

                logger.info(
                    f"[OpenLineage] {event_type} | job={job} | "
                    f"in={input_ds.split('/')[-2] if '/' in input_ds else input_ds} -> "
                    f"out={output_ds.split('/')[-2] if '/' in output_ds else output_ds} | "
                    f"rows={rows_processed:,} | pii={has_pii}"
                )

                if schema_change:
                    logger.warning(
                        f"[OpenLineage] SCHEMA CHANGE detected in {output_ds} | job={job}"
                    )
                    # Write audit log for schema change
                    cur.execute(
                        """INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
                           VALUES (%s, %s, %s, %s, %s, NOW())""",
                        (
                            "schema_change_detected",
                            "dataset",
                            random.randint(1, 500),
                            1,
                            json.dumps({
                                "job": job,
                                "dataset": output_ds,
                                "run_id": run_id,
                                "event_type": event_type,
                            }),
                        ),
                    )
                    conn.commit()

                time.sleep(random.uniform(4, 8))
        except Exception as e:
            logger.error(f"[OpenLineage] Error: {e}")
            time.sleep(5)


def run_egeria_metadata_exchange():
    """Simulate Egeria metadata exchange between systems."""
    while True:
        try:
            conn = get_db()
            cur = conn.cursor()
            while True:
                server = random.choice(EGERIA_SERVERS)
                exchange_type = random.choice([
                    "glossary_sync", "schema_propagation", "classification_update",
                    "lineage_publish", "data_quality_score", "governance_zone_update"
                ])
                asset_count = random.randint(5, 200)
                cross_system = random.random() < 0.3

                with metrics_lock:
                    metrics["egeria_metadata_exchanges"] += 1
                    if cross_system:
                        metrics["cross_system_links"] += 1

                logger.info(
                    f"[Egeria] Exchange: {exchange_type} | server={server} | "
                    f"assets={asset_count} | cross_system={cross_system}"
                )

                time.sleep(random.uniform(6, 12))
        except Exception as e:
            logger.error(f"[Egeria] Error: {e}")
            time.sleep(5)


def run_data_quality_engine():
    """Run data quality checks and report via lineage."""
    while True:
        try:
            while True:
                dataset = random.choice(DATASETS)
                checks_run = random.randint(5, 50)
                checks_passed = int(checks_run * random.uniform(0.7, 1.0))
                checks_failed = checks_run - checks_passed
                quality_score = checks_passed / checks_run * 100

                with metrics_lock:
                    metrics["data_quality_checks"] += checks_run

                logger.info(
                    f"[DataQuality] Dataset={dataset.split('/')[-2] if '/' in dataset else dataset} | "
                    f"checks={checks_run} | passed={checks_passed} | failed={checks_failed} | "
                    f"score={quality_score:.1f}%"
                )
                time.sleep(random.uniform(10, 20))
        except Exception as e:
            logger.error(f"[DataQuality] Error: {e}")
            time.sleep(5)


def run_uptime_tracker():
    while True:
        with metrics_lock:
            metrics["uptime_seconds"] = int(time.time() - start_time)
        time.sleep(1)


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            with metrics_lock:
                m = dict(metrics)
            resp = json.dumps({
                "status": "ok",
                "service": "egeria-openlineage",
                "version": VERSION,
                "layer": "L2",
                "lang": "Python",
                "metrics": m,
            })
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(resp.encode())
        elif self.path == "/metrics":
            with metrics_lock:
                m = dict(metrics)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(m).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress HTTP access logs


def main():
    logger.info("=== NDSEP Egeria + OpenLineage Worker (Python) ===")
    logger.info(f"Version: {VERSION} | Port: {PORT}")

    # Test DB connection
    try:
        conn = get_db()
        conn.close()
        logger.info("[DB] Connected to PostgreSQL")
    except Exception as e:
        logger.error(f"[DB] Connection failed: {e}")
        return

    # Start background threads
    threading.Thread(target=run_uptime_tracker, daemon=True).start()
    threading.Thread(target=run_openlineage_tracker, daemon=True).start()
    threading.Thread(target=run_egeria_metadata_exchange, daemon=True).start()
    threading.Thread(target=run_data_quality_engine, daemon=True).start()

    logger.info(f"[Egeria] Egeria + OpenLineage worker listening on :{PORT}")
    server = HTTPServer(("", PORT), HealthHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
