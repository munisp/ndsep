"""
NDSEP NOC Anomaly Detector
Monitors network/infrastructure metrics from Kafka and detects anomalies
using statistical methods (Z-score, rolling averages, threshold breaches).
"""

import os
import time
import json
import logging
from datetime import datetime, timedelta
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s [NOC-Anomaly] %(message)s")
logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://ndsep:ndsep@localhost:5432/ndsep")
KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "localhost:9092")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
POLL_INTERVAL = int(os.environ.get("ANOMALY_POLL_INTERVAL", "30"))

# Anomaly detection thresholds
THRESHOLDS = {
    "cpu_usage": {"warning": 80.0, "critical": 95.0},
    "memory_usage": {"warning": 85.0, "critical": 95.0},
    "disk_io_latency_ms": {"warning": 50.0, "critical": 200.0},
    "network_packet_loss": {"warning": 1.0, "critical": 5.0},
    "error_rate_percent": {"warning": 5.0, "critical": 15.0},
    "response_time_p99_ms": {"warning": 500.0, "critical": 2000.0},
}

# Rolling window for Z-score calculation
WINDOW_SIZE = 60  # last 60 readings
metric_windows: dict[str, list[float]] = {}


def z_score(value: float, window: list[float]) -> float:
    """Calculate Z-score for anomaly detection."""
    if len(window) < 5:
        return 0.0
    mean = sum(window) / len(window)
    variance = sum((x - mean) ** 2 for x in window) / len(window)
    std_dev = variance**0.5
    if std_dev == 0:
        return 0.0
    return (value - mean) / std_dev


def detect_anomaly(metric_name: str, value: float, service: str) -> dict[str, Any] | None:
    """Detect anomalies using threshold + Z-score methods."""
    key = f"{service}:{metric_name}"

    # Update rolling window
    if key not in metric_windows:
        metric_windows[key] = []
    metric_windows[key].append(value)
    if len(metric_windows[key]) > WINDOW_SIZE:
        metric_windows[key] = metric_windows[key][-WINDOW_SIZE:]

    # Threshold-based detection
    thresholds = THRESHOLDS.get(metric_name)
    severity = None
    if thresholds:
        if value >= thresholds["critical"]:
            severity = "critical"
        elif value >= thresholds["warning"]:
            severity = "warning"

    # Z-score-based detection (|z| > 3 is anomalous)
    z = z_score(value, metric_windows[key])
    if abs(z) > 3.0 and severity is None:
        severity = "warning"
    if abs(z) > 4.5:
        severity = "critical"

    if severity:
        return {
            "type": "anomaly_detected",
            "service": service,
            "metric": metric_name,
            "value": value,
            "z_score": round(z, 2),
            "severity": severity,
            "threshold": thresholds,
            "detected_at": datetime.utcnow().isoformat(),
        }
    return None


def process_noc_event(event: dict[str, Any]) -> list[dict[str, Any]]:
    """Process a NOC metric event and return any anomalies found."""
    anomalies = []
    service = event.get("service", "unknown")
    metrics = event.get("metrics", {})

    for metric_name, value in metrics.items():
        if isinstance(value, (int, float)):
            anomaly = detect_anomaly(metric_name, float(value), service)
            if anomaly:
                anomalies.append(anomaly)
                logger.warning(
                    f"ANOMALY: {service}/{metric_name}={value} "
                    f"(z={anomaly['z_score']}, severity={anomaly['severity']})"
                )

    return anomalies


def run_polling_loop() -> None:
    """Main polling loop — reads from Kafka or simulates metrics."""
    logger.info(f"Starting NOC Anomaly Detector (poll interval: {POLL_INTERVAL}s)")
    logger.info(f"Kafka: {KAFKA_BROKERS}, Redis: {REDIS_URL}")
    logger.info(f"Monitoring {len(THRESHOLDS)} metric types with Z-score detection")

    cycle = 0
    while True:
        try:
            cycle += 1
            # In production, this reads from Kafka topic "ndsep-noc"
            # For now, log heartbeat and wait
            if cycle % 10 == 0:
                logger.info(
                    f"Heartbeat: cycle={cycle}, "
                    f"tracked_series={len(metric_windows)}, "
                    f"total_readings={sum(len(w) for w in metric_windows.values())}"
                )
            time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            logger.info("Shutting down NOC Anomaly Detector")
            break
        except Exception as e:
            logger.error(f"Error in polling loop: {e}")
            time.sleep(5)


if __name__ == "__main__":
    run_polling_loop()
