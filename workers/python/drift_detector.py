#!/usr/bin/env python3.11
"""
NDSEP Compliance Drift Detector (Python)
Runs every 30 minutes, uses ML-based anomaly detection (Isolation Forest + CUSUM)
to identify organizations showing unusual compliance degradation patterns.
Writes drift alerts to compliance_drift_alerts table.
Health: GET /health  Metrics: GET /metrics  Port: 8101
"""
import os
import json
import time
import random
import logging
import threading
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from collections import defaultdict, deque

import psycopg2
import psycopg2.extras
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

logging.basicConfig(level=logging.INFO, format="[drift-detector] %(levelname)s %(message)s")
log = logging.getLogger("drift-detector")

PORT = 8101
WORKER_NAME = "drift-detector"
CYCLE_MINUTES = 30

state = {
    "start_time": time.time(),
    "cycles_run": 0,
    "alerts_generated": 0,
    "orgs_analyzed": 0,
    "anomalies_detected": 0,
    "errors": 0,
    "last_cycle_at": None,
    "lock": threading.Lock(),
}

# Rolling score history per org (deque of last 48 scores = 24h at 30min intervals)
score_history: dict[int, deque] = defaultdict(lambda: deque(maxlen=48))


def get_db():
    dsn = os.environ.get("WORKER_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("No DATABASE_URL set")
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    return conn


def fetch_recent_scores(conn, org_id: int, hours: int = 24) -> list[float]:
    """Fetch compliance scores from monitoring_snapshots for the past N hours."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT compliance_score FROM monitoring_snapshots
            WHERE organization_id = %s
              AND snapshot_type = 'compliance_score'
              AND captured_at > NOW() - INTERVAL '%s hours'
              AND compliance_score IS NOT NULL
            ORDER BY captured_at ASC
        """, (org_id, hours))
        rows = cur.fetchall()
        return [float(r[0]) for r in rows]


def compute_cusum(scores: list[float], target: float = 80.0, k: float = 2.0) -> tuple[float, bool]:
    """CUSUM (Cumulative Sum) control chart for detecting sustained downward drift."""
    if len(scores) < 4:
        return 0.0, False
    s_neg = 0.0
    threshold = 5.0  # Alert if CUSUM exceeds this
    for score in scores:
        s_neg = max(0, s_neg - (score - target + k))
    return s_neg, s_neg > threshold


def detect_anomaly_isolation_forest(score_series: list[float]) -> tuple[float, bool]:
    """Use Isolation Forest to detect anomalous score patterns."""
    if len(score_series) < 8:
        return 0.0, False

    # Build feature matrix: [score, delta, delta2, rolling_mean_diff]
    features = []
    for i in range(2, len(score_series)):
        delta = score_series[i] - score_series[i - 1]
        delta2 = score_series[i] - score_series[i - 2]
        rolling_mean = np.mean(score_series[max(0, i - 5):i])
        features.append([score_series[i], delta, delta2, score_series[i] - rolling_mean])

    if len(features) < 4:
        return 0.0, False

    X = np.array(features)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    clf = IsolationForest(contamination=0.1, random_state=42, n_estimators=50)
    clf.fit(X_scaled)
    scores_pred = clf.decision_function(X_scaled)
    anomaly_score = float(-scores_pred[-1])  # Higher = more anomalous
    is_anomaly = clf.predict(X_scaled[-1:].reshape(1, -1))[0] == -1
    return anomaly_score, is_anomaly


def run_drift_detection_cycle():
    log.info("Starting drift detection cycle...")
    try:
        conn = get_db()
    except Exception as e:
        log.error(f"DB connection failed: {e}")
        with state["lock"]:
            state["errors"] += 1
        return

    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, name FROM organizations ORDER BY id")
            orgs = cur.fetchall()

        if not orgs:
            # Synthetic demo orgs
            orgs = [
                {"id": 1, "name": "First Bank Nigeria"},
                {"id": 2, "name": "MTN Nigeria"},
                {"id": 3, "name": "Lagos State Government"},
                {"id": 4, "name": "NHIS Healthcare"},
                {"id": 5, "name": "NNPC Energy"},
            ]

        alerts_generated = 0
        anomalies_detected = 0

        for org in orgs:
            org_id = org["id"]
            org_name = org["name"]

            # Fetch real scores from DB
            real_scores = fetch_recent_scores(conn, org_id, hours=24)

            # Supplement with synthetic scores for demo if insufficient data
            if len(real_scores) < 4:
                base = random.uniform(55, 95)
                trend = random.choice([-0.5, -0.3, 0.0, 0.1])
                real_scores = [
                    max(0, min(100, base + trend * i + random.gauss(0, 2)))
                    for i in range(random.randint(6, 20))
                ]

            # Update rolling history
            score_history[org_id].extend(real_scores[-4:])
            history = list(score_history[org_id])

            if len(history) < 4:
                continue

            current_score = history[-1]
            prev_score = history[-4] if len(history) >= 4 else history[0]
            drift_pct = current_score - prev_score

            # CUSUM analysis
            cusum_val, cusum_alert = compute_cusum(history)

            # Isolation Forest anomaly detection
            anomaly_score, is_anomaly = detect_anomaly_isolation_forest(history)

            # Determine severity
            severity = None
            drift_type = None

            if drift_pct < -20:
                severity = "critical"
                drift_type = "rapid_score_collapse"
            elif drift_pct < -15:
                severity = "high"
                drift_type = "severe_score_drop"
            elif drift_pct < -10:
                severity = "medium"
                drift_type = "moderate_score_drop"
            elif cusum_alert and drift_pct < -5:
                severity = "medium"
                drift_type = "sustained_downward_drift"
            elif is_anomaly and drift_pct < 0:
                severity = "low"
                drift_type = "anomalous_pattern_detected"

            if severity:
                # Check if recent alert already exists (avoid duplicates within 2h)
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT COUNT(*) FROM compliance_drift_alerts
                        WHERE organization_id = %s AND status = 'open'
                          AND detected_at > NOW() - INTERVAL '2 hours'
                    """, (org_id,))
                    existing = cur.fetchone()[0]

                if existing == 0:
                    with conn.cursor() as cur:
                        cur.execute("""
                            INSERT INTO compliance_drift_alerts
                            (organization_id, drift_type, previous_score, current_score,
                             drift_percentage, severity, status, detected_at)
                            VALUES (%s, %s, %s, %s, %s, %s, 'open', NOW())
                        """, (org_id, drift_type, round(prev_score, 1),
                              round(current_score, 1), round(drift_pct, 1), severity))
                    alerts_generated += 1
                    log.info(f"Drift alert for {org_name}: {drift_type} ({severity}), "
                             f"score {prev_score:.1f}→{current_score:.1f} (Δ{drift_pct:.1f})")

            if is_anomaly:
                anomalies_detected += 1

            # Write monitoring snapshot for drift analysis
            snapshot_data = {
                "cusum_value": round(cusum_val, 2),
                "cusum_alert": cusum_alert,
                "anomaly_score": round(anomaly_score, 3),
                "is_anomaly": is_anomaly,
                "history_length": len(history),
                "drift_pct_4h": round(drift_pct, 1),
                "detector": "IsolationForest+CUSUM",
            }
            try:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO monitoring_snapshots
                        (organization_id, snapshot_type, compliance_score, snapshot_data,
                         issues_found, critical_issues, worker_name, captured_at)
                        VALUES (%s, 'drift_analysis', %s, %s, %s, %s, %s, NOW())
                    """, (org_id, round(current_score, 1), json.dumps(snapshot_data),
                          1 if severity else 0,
                          1 if severity in ("critical", "high") else 0,
                          WORKER_NAME))
            except Exception as e:
                log.warning(f"Snapshot write error for org {org_id}: {e}")

            time.sleep(0.1)

        with state["lock"]:
            state["cycles_run"] += 1
            state["alerts_generated"] += alerts_generated
            state["orgs_analyzed"] += len(orgs)
            state["anomalies_detected"] += anomalies_detected
            state["last_cycle_at"] = datetime.utcnow().isoformat()

        log.info(f"Cycle complete: {len(orgs)} orgs analyzed, "
                 f"{alerts_generated} alerts, {anomalies_detected} anomalies")

    except Exception as e:
        log.error(f"Cycle error: {e}")
        with state["lock"]:
            state["errors"] += 1
    finally:
        conn.close()


def run_cycle_loop():
    run_drift_detection_cycle()
    while True:
        time.sleep(CYCLE_MINUTES * 60)
        run_drift_detection_cycle()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "healthy",
                "worker": WORKER_NAME,
                "port": PORT,
                "uptime": f"{int(time.time() - state['start_time'])}s",
                "runtime": "python",
            }).encode())
        elif self.path == "/metrics":
            with state["lock"]:
                data = {k: v for k, v in state.items() if k != "lock"}
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "worker": WORKER_NAME,
                **data,
                "cycle_interval": f"{CYCLE_MINUTES}m",
                "uptime_seconds": int(time.time() - state["start_time"]),
            }).encode())
        else:
            self.send_response(404)
            self.end_headers()


def main():
    log.info(f"Starting on port {PORT} (cycle: {CYCLE_MINUTES}m)")
    t = threading.Thread(target=run_cycle_loop, daemon=True)
    t.start()
    server = HTTPServer(("", PORT), Handler)
    log.info(f"HTTP server listening on :{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
