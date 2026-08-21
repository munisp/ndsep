"""NDSEP CPU ML prediction worker.

Trains Random Forest and Isolation Forest models only from persisted platform
features. The worker emits no synthetic risk, forecast, geospatial, or broker
results when data or dependencies are unavailable.
"""
import http.server
import json
import logging
import os
import socketserver
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np
import psycopg2
import requests
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

DB_URL = os.getenv("WORKER_DATABASE_URL", os.getenv("DATABASE_URL", ""))
RELAY_URL = os.getenv("WORKER_RELAY_URL", "").rstrip("/")
PORT = int(os.getenv("ML_PORT", "8085"))
PREDICTION_INTERVAL_SECONDS = int(os.getenv("ML_PREDICTION_INTERVAL_SECONDS", "300"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [NDSEP-ML] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

events_processed = 0
predictions_made = 0
anomalies_detected = 0
worker_start = time.time()
model_trained = False
rf_pipeline: Optional[Pipeline] = None
isolation_forest: Optional[IsolationForest] = None
last_training_error: Optional[str] = None
last_run: Optional[str] = None
FEATURE_COUNT = 10


def get_db():
    if not DB_URL:
        raise RuntimeError("WORKER_DATABASE_URL or DATABASE_URL is required")
    return psycopg2.connect(DB_URL)


def broadcast(event: str, data: dict) -> bool:
    if not RELAY_URL:
        log.warning("Event relay is not configured; event %s was not delivered", event)
        return False
    try:
        response = requests.post(RELAY_URL, json={"event": event, "data": data}, timeout=5)
        if not response.ok:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text[:300]}")
        return True
    except Exception as error:
        log.error("Event relay delivery failed for %s: %s", event, error)
        return False


def extract_features(connection, org_id: int) -> Optional[np.ndarray]:
    """Extract observed platform features. Missing organization data is rejected."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT compliance_score FROM organizations WHERE id = %s", (org_id,))
        organization = cursor.fetchone()
        if not organization or organization[0] is None:
            return None
        compliance_score = float(organization[0])
        cursor.execute("""
            SELECT COUNT(*) FILTER (WHERE severity = 'critical'), COUNT(*) FILTER (WHERE severity = 'high'),
                   COUNT(*) FILTER (WHERE severity = 'medium'), COUNT(*) FILTER (WHERE severity = 'low')
              FROM compliance_violations
             WHERE organization_id = %s AND detected_at > NOW() - INTERVAL '30 days'
        """, (org_id,))
        critical, high, medium, low = cursor.fetchone() or (0, 0, 0, 0)
        cursor.execute("""
            SELECT COUNT(*), COUNT(*) FILTER (WHERE is_cross_border), COUNT(*) FILTER (WHERE is_blocked)
              FROM network_events
             WHERE organization_id = %s AND detected_at > NOW() - INTERVAL '7 days'
        """, (org_id,))
        total_network, cross_border, blocked = cursor.fetchone() or (0, 0, 0)
        cursor.execute("""
            SELECT COUNT(*) FROM security_alerts
             WHERE organization_id = %s AND created_at > NOW() - INTERVAL '30 days'
        """, (org_id,))
        alerts = (cursor.fetchone() or (0,))[0]
    return np.array([compliance_score, critical, high, medium, low, total_network, cross_border, blocked, alerts, critical * 25 + high * 10 + medium * 5 + low * 2], dtype=np.float64)


def train_models(connection) -> bool:
    """Train on real organizations only; no synthetic data is manufactured."""
    global rf_pipeline, isolation_forest, model_trained, last_training_error
    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM organizations ORDER BY id")
        org_ids = [row[0] for row in cursor.fetchall()]
    observations: list[np.ndarray] = []
    labels: list[int] = []
    for org_id in org_ids:
        try:
            features = extract_features(connection, org_id)
            if features is None:
                continue
            observations.append(features)
            labels.append(int(features[0] < 60 or features[1] > 0))
        except Exception as error:
            log.error("Feature extraction failed for organization %s: %s", org_id, error)
    if len(observations) < 10 or len(set(labels)) < 2:
        model_trained = False
        last_training_error = f"Insufficient labelled persisted data: samples={len(observations)}, classes={len(set(labels))}"
        log.warning(last_training_error)
        return False
    features_array = np.asarray(observations)
    labels_array = np.asarray(labels)
    rf_pipeline = Pipeline([("scaler", StandardScaler()), ("classifier", RandomForestClassifier(n_estimators=200, random_state=42, max_depth=8, class_weight="balanced"))])
    rf_pipeline.fit(features_array, labels_array)
    isolation_forest = IsolationForest(contamination=0.1, n_estimators=200, random_state=42)
    isolation_forest.fit(features_array)
    model_trained = True
    last_training_error = None
    broadcast("ml_model_trained", {"type": "ml_model_trained", "model": "RandomForest+IsolationForest", "training_samples": len(observations), "features": FEATURE_COUNT, "timestamp": datetime.now(timezone.utc).isoformat()})
    return True


def run_prediction_cycle() -> int:
    """Persist one risk prediction per organization using active trained models."""
    global predictions_made, anomalies_detected, events_processed, last_run
    with get_db() as connection:
        if not model_trained and not train_models(connection):
            return 0
        if rf_pipeline is None or isolation_forest is None:
            raise RuntimeError("CPU models are not available after training")
        with connection.cursor() as cursor:
            cursor.execute("SELECT id, name FROM organizations ORDER BY id")
            organizations = cursor.fetchall()
        written = 0
        for org_id, org_name in organizations:
            features = extract_features(connection, org_id)
            if features is None:
                log.warning("Skipping organization %s because its observed feature set is incomplete", org_id)
                continue
            features_2d = features.reshape(1, -1)
            probabilities = rf_pipeline.predict_proba(features_2d)[0]
            classes = list(rf_pipeline.named_steps["classifier"].classes_)
            risk_probability = float(probabilities[classes.index(1)]) if 1 in classes else 0.0
            confidence = float(np.max(probabilities))
            risk_score = round(risk_probability * 100, 2)
            anomaly = bool(isolation_forest.predict(features_2d)[0] == -1)
            anomaly_score = float(isolation_forest.decision_function(features_2d)[0])
            recommendation = "Initiate enforcement workflow" if risk_score >= 70 else "Schedule targeted compliance review" if risk_score >= 50 else "Continue monitored compliance programme"
            with connection.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO ml_risk_predictions
                      (organization_id, model_name, current_risk_score, predicted_risk_score,
                       confidence_interval, prediction_horizon_days, features, recommendation, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, NOW())
                """, (org_id, "RandomForest CPU v2", risk_score, risk_score, round(confidence, 4), 30, json.dumps(features.tolist()), recommendation))
            connection.commit()
            written += 1
            predictions_made += 1
            if anomaly:
                anomalies_detected += 1
            event = {"type": "ml_prediction_update", "organizationId": org_id, "organizationName": org_name, "riskScore": risk_score, "confidence": round(confidence, 4), "isAnomaly": anomaly, "anomalyScore": round(anomaly_score, 4), "recommendation": recommendation, "model": "RandomForest CPU v2", "timestamp": datetime.now(timezone.utc).isoformat()}
            broadcast("ml_prediction_update", event)
            if anomaly:
                broadcast("ml_anomaly_detected", event)
        events_processed += 1
        last_run = datetime.now(timezone.utc).isoformat()
        return written


def run_predictions() -> None:
    while True:
        try:
            written = run_prediction_cycle()
            log.info("CPU prediction cycle completed: %s persisted predictions", written)
        except Exception as error:
            log.exception("CPU prediction cycle failed: %s", error)
        time.sleep(PREDICTION_INTERVAL_SECONDS)


class StatusHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def do_GET(self) -> None:
        ready = bool(DB_URL) and model_trained and rf_pipeline is not None and isolation_forest is not None
        if self.path == "/health":
            payload = {"status": "healthy" if ready else "unhealthy", "worker": "ml_prediction", "model_trained": model_trained, "last_training_error": last_training_error}
            status = 200 if ready else 503
        elif self.path == "/status":
            payload = {"id": "ml-prediction", "name": "CPU ML Prediction Worker", "status": "running" if ready else "blocked", "lastRun": last_run, "eventsProcessed": events_processed, "description": "Random Forest risk classification and Isolation Forest anomaly detection using persisted PostgreSQL features only."}
            status = 200 if ready else 503
        elif self.path == "/metrics":
            payload = {"eventsProcessed": events_processed, "predictionsMade": predictions_made, "anomaliesDetected": anomalies_detected, "modelTrained": model_trained, "uptimeSeconds": round(time.time() - worker_start, 1)}
            status = 200
        else:
            self.send_response(404)
            self.end_headers()
            return
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def start_status_server() -> None:
    with socketserver.TCPServer(("", PORT), StatusHandler) as server:
        log.info("ML status server listening on :%s", PORT)
        server.serve_forever()


if __name__ == "__main__":
    if not DB_URL:
        raise SystemExit("WORKER_DATABASE_URL or DATABASE_URL is required")
    threading.Thread(target=run_predictions, daemon=True, name="cpu-ml-predictions").start()
    start_status_server()
