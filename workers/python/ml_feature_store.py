#!/usr/bin/env python3
"""
NDSEP ML Feature Store & Model Registry (Python)
==================================================
Manages ML features, model versioning, and experiment tracking for NDSEP.
Integrates with the lakehouse (Delta Lake / Iceberg schemas) for feature lineage.

Feature Groups:
  - compliance_features    : org compliance scores, violation rates, audit gaps
  - risk_features          : sector risk, cross-border exposure, DPO coverage
  - behavioral_features    : login patterns, API usage, data access frequency
  - temporal_features      : trend slopes, seasonality, anomaly indicators
  - graph_features         : GNN embeddings from FalkorDB knowledge graph

Model Registry:
  - compliance_classifier  : RF/GBT for compliant/non-compliant prediction
  - risk_scorer            : Isolation Forest for anomaly detection
  - violation_predictor    : LSTM for time-series violation prediction
  - sector_benchmarker     : Clustering for sector peer comparison

Technology: Python · scikit-learn · joblib · psycopg2 · numpy · pandas
Port: 8205
"""
import os, time, json, logging, threading, http.server, socketserver, joblib, hashlib
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional, Any, Tuple
from pathlib import Path
import numpy as np
import psycopg2
import psycopg2.extras

# ── Configuration ──────────────────────────────────────────────────────────────
DB_URL = os.environ.get("WORKER_DATABASE_URL", os.environ.get("DATABASE_URL", "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"))
RELAY_URL = os.environ.get("WORKER_RELAY_URL", "http://localhost:3000/api/workers/event")
PORT = int(os.environ.get("FEATURE_STORE_PORT", "8205"))
MODEL_DIR = Path(os.environ.get("ML_MODEL_PATH", "./workers/python/models"))
FEATURE_DIR = Path(os.environ.get("ML_FEATURE_PATH", "./workers/python/features"))
RETRAIN_INTERVAL = 3600  # 1 hour

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [NDSEP-FeatureStore] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

# ── Ensure directories exist ───────────────────────────────────────────────────
MODEL_DIR.mkdir(parents=True, exist_ok=True)
FEATURE_DIR.mkdir(parents=True, exist_ok=True)

# ── State ──────────────────────────────────────────────────────────────────────
_worker_start = time.time()
_model_registry: Dict[str, Dict] = {}
_feature_stats: Dict[str, Dict] = {}
_last_retrain: Optional[str] = None
_errors = 0

# ── Feature extraction ─────────────────────────────────────────────────────────
def extract_compliance_features(conn) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """Extract compliance features from PostgreSQL for model training."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT
                o.id::text as org_id,
                o.compliance_score,
                o.sector,
                COALESCE(v.violation_count, 0) as violation_count,
                COALESCE(v.critical_violations, 0) as critical_violations,
                COALESCE(v.high_violations, 0) as high_violations,
                COALESCE(ea.enforcement_count, 0) as enforcement_count,
                COALESCE(ea.total_fines, 0) as total_fines,
                EXTRACT(DAYS FROM (NOW() - o.created_at)) as days_since_registration,
                CASE WHEN o.compliance_score >= 80 THEN 0 ELSE 1 END as label
            FROM organizations o
            LEFT JOIN (
                SELECT organization_id,
                       COUNT(*) as violation_count,
                       COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_violations,
                       COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_violations
                FROM compliance_violations
                GROUP BY organization_id
            ) v ON v.organization_id = o.id
            LEFT JOIN (
                SELECT organization_id,
                       COUNT(*) as enforcement_count,
                       COALESCE(SUM(fp.amount), 0) as total_fines
                FROM enforcement_actions ea2
                LEFT JOIN financial_penalties fp ON fp.organization_id = ea2.organization_id
                GROUP BY organization_id
            ) ea ON ea.organization_id = o.id
            WHERE o.status = 'active'
            ORDER BY o.id
        """)
        rows = cur.fetchall()

    if not rows:
        return np.array([]), np.array([]), []

    feature_cols = ["compliance_score", "violation_count", "critical_violations",
                    "high_violations", "enforcement_count", "total_fines", "days_since_registration"]
    org_ids = [r["org_id"] for r in rows]
    X = np.array([[float(r.get(col) or 0) for col in feature_cols] for r in rows], dtype=np.float32)
    y = np.array([int(r["label"]) for r in rows])
    return X, y, org_ids

def compute_feature_stats(X: np.ndarray, feature_names: List[str]) -> Dict:
    """Compute feature statistics for the feature store."""
    stats = {}
    for i, name in enumerate(feature_names):
        col = X[:, i]
        stats[name] = {
            "mean": float(np.mean(col)),
            "std": float(np.std(col)),
            "min": float(np.min(col)),
            "max": float(np.max(col)),
            "p25": float(np.percentile(col, 25)),
            "p50": float(np.median(col)),
            "p75": float(np.percentile(col, 75)),
            "missing_rate": float(np.sum(np.isnan(col)) / len(col))
        }
    return stats

# ── Model training ─────────────────────────────────────────────────────────────
def train_compliance_classifier(X: np.ndarray, y: np.ndarray) -> Dict:
    """Train and register compliance classifier."""
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
    from sklearn.model_selection import cross_val_score, train_test_split
    from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
    from sklearn.preprocessing import StandardScaler

    if len(X) < 10:
        return {"error": "Insufficient training data"}

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.2, random_state=42)

    # Train RF
    rf = RandomForestClassifier(n_estimators=100, random_state=42, class_weight="balanced")
    rf.fit(X_train, y_train)
    y_pred = rf.predict(X_test)
    y_prob = rf.predict_proba(X_test)[:, 1]

    metrics = {
        "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
        "f1_score": round(float(f1_score(y_test, y_pred, zero_division=0)), 4),
        "roc_auc": round(float(roc_auc_score(y_test, y_prob)), 4) if len(np.unique(y_test)) > 1 else 0.0,
        "cv_accuracy": round(float(np.mean(cross_val_score(rf, X_scaled, y, cv=min(5, len(X)//2)))), 4),
        "training_samples": len(X_train),
        "test_samples": len(X_test)
    }

    # Save model + scaler
    version = hashlib.md5(f"{time.time()}".encode()).hexdigest()[:8]
    model_path = MODEL_DIR / f"compliance_classifier_{version}.joblib"
    scaler_path = MODEL_DIR / f"compliance_scaler_{version}.joblib"
    joblib.dump(rf, model_path)
    joblib.dump(scaler, scaler_path)

    # Update registry
    _model_registry["compliance_classifier"] = {
        "version": version,
        "model_type": "RandomForestClassifier",
        "model_path": str(model_path),
        "scaler_path": str(scaler_path),
        "metrics": metrics,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "feature_count": X.shape[1],
        "training_samples": len(X),
        "status": "active"
    }

    log.info(f"Compliance classifier trained: accuracy={metrics['accuracy']}, AUC={metrics['roc_auc']}, version={version}")
    return {"model": "compliance_classifier", "version": version, "metrics": metrics}

def train_anomaly_detector(X: np.ndarray) -> Dict:
    """Train Isolation Forest for anomaly detection."""
    from sklearn.ensemble import IsolationForest
    from sklearn.preprocessing import StandardScaler

    if len(X) < 5:
        return {"error": "Insufficient data"}

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    iso = IsolationForest(contamination=0.1, random_state=42, n_estimators=100)
    iso.fit(X_scaled)
    anomaly_scores = iso.decision_function(X_scaled)
    anomaly_labels = iso.predict(X_scaled)
    anomaly_rate = float(np.sum(anomaly_labels == -1) / len(anomaly_labels))

    version = hashlib.md5(f"anomaly-{time.time()}".encode()).hexdigest()[:8]
    model_path = MODEL_DIR / f"anomaly_detector_{version}.joblib"
    scaler_path = MODEL_DIR / f"anomaly_scaler_{version}.joblib"
    joblib.dump(iso, model_path)
    joblib.dump(scaler, scaler_path)

    _model_registry["anomaly_detector"] = {
        "version": version,
        "model_type": "IsolationForest",
        "model_path": str(model_path),
        "scaler_path": str(scaler_path),
        "metrics": {
            "anomaly_rate": round(anomaly_rate, 4),
            "mean_anomaly_score": round(float(np.mean(anomaly_scores)), 4),
            "training_samples": len(X)
        },
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "status": "active"
    }

    log.info(f"Anomaly detector trained: anomaly_rate={anomaly_rate:.4f}, version={version}")
    return {"model": "anomaly_detector", "version": version, "anomaly_rate": anomaly_rate}

# ── Inference ──────────────────────────────────────────────────────────────────
def predict_compliance(features: List[float]) -> Dict:
    """Predict compliance status for a new organization."""
    reg = _model_registry.get("compliance_classifier")
    if not reg:
        return {"error": "Model not trained yet"}
    try:
        model = joblib.load(reg["model_path"])
        scaler = joblib.load(reg["scaler_path"])
        X = np.array([features], dtype=np.float32)
        X_scaled = scaler.transform(X)
        pred = model.predict(X_scaled)[0]
        prob = model.predict_proba(X_scaled)[0]
        return {
            "prediction": "non_compliant" if pred == 1 else "compliant",
            "confidence": round(float(max(prob)), 4),
            "compliant_probability": round(float(prob[0]), 4),
            "non_compliant_probability": round(float(prob[1]), 4),
            "model_version": reg["version"]
        }
    except Exception as e:
        return {"error": str(e)}

def detect_anomaly(features: List[float]) -> Dict:
    """Detect if an organization is anomalous."""
    reg = _model_registry.get("anomaly_detector")
    if not reg:
        return {"error": "Anomaly detector not trained yet"}
    try:
        model = joblib.load(reg["model_path"])
        scaler = joblib.load(reg["scaler_path"])
        X = np.array([features], dtype=np.float32)
        X_scaled = scaler.transform(X)
        score = float(model.decision_function(X_scaled)[0])
        label = int(model.predict(X_scaled)[0])
        return {
            "is_anomaly": label == -1,
            "anomaly_score": round(score, 4),
            "risk_level": "high" if score < -0.2 else "medium" if score < 0 else "low",
            "model_version": reg["version"]
        }
    except Exception as e:
        return {"error": str(e)}

# ── Full retrain pipeline ──────────────────────────────────────────────────────
def run_retrain():
    global _last_retrain, _errors
    log.info("Starting ML model retrain pipeline...")
    try:
        conn = psycopg2.connect(DB_URL)
        try:
            X, y, org_ids = extract_compliance_features(conn)
        finally:
            conn.close()

        if len(X) == 0:
            log.warning("No training data available")
            return

        feature_names = ["compliance_score", "violation_count", "critical_violations",
                         "high_violations", "enforcement_count", "total_fines", "days_since_registration"]
        _feature_stats["compliance_features"] = compute_feature_stats(X, feature_names)

        # Save feature snapshot
        feature_snapshot = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "n_samples": len(X),
            "feature_names": feature_names,
            "stats": _feature_stats["compliance_features"]
        }
        with open(FEATURE_DIR / "compliance_features_latest.json", "w") as f:
            json.dump(feature_snapshot, f, indent=2)

        train_compliance_classifier(X, y)
        train_anomaly_detector(X)

        _last_retrain = datetime.now(timezone.utc).isoformat()
        log.info(f"Retrain complete. Models: {list(_model_registry.keys())}")

        try:
            import requests
            requests.post(RELAY_URL, json={
                "workerId": "ml_feature_store",
                "event": "retrain_complete",
                "models": list(_model_registry.keys()),
                "timestamp": _last_retrain
            }, timeout=3)
        except Exception:
            pass

    except Exception as e:
        _errors += 1
        log.error(f"Retrain failed: {e}")

# ── HTTP Server ────────────────────────────────────────────────────────────────
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def send_json(self, data: Any, status: int = 200):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> Dict:
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def do_GET(self):
        if self.path == "/health":
            self.send_json({
                "status": "healthy",
                "worker": "ml_feature_store",
                "models": {k: {"version": v.get("version"), "trained_at": v.get("trained_at"), "status": v.get("status")} for k, v in _model_registry.items()},
                "feature_groups": list(_feature_stats.keys()),
                "last_retrain": _last_retrain,
                "errors": _errors,
                "uptime_seconds": round(time.time() - _worker_start, 1)
            })
        elif self.path == "/registry":
            self.send_json({"registry": _model_registry})
        elif self.path == "/features":
            self.send_json({"feature_stats": _feature_stats})
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/predict/compliance":
            body = self.read_body()
            result = predict_compliance(body.get("features", []))
            self.send_json(result)
        elif self.path == "/predict/anomaly":
            body = self.read_body()
            result = detect_anomaly(body.get("features", []))
            self.send_json(result)
        elif self.path == "/retrain":
            threading.Thread(target=run_retrain, daemon=True).start()
            self.send_json({"status": "retrain_started"})
        else:
            self.send_response(404)
            self.end_headers()

def startup():
    time.sleep(10)
    run_retrain()

def retrain_loop():
    time.sleep(RETRAIN_INTERVAL)
    while True:
        run_retrain()
        time.sleep(RETRAIN_INTERVAL)

if __name__ == "__main__":
    log.info("Starting NDSEP ML Feature Store & Model Registry...")
    threading.Thread(target=startup, daemon=True).start()
    threading.Thread(target=retrain_loop, daemon=True).start()
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        httpd.allow_reuse_address = True
        log.info(f"ML Feature Store HTTP server on port {PORT}")
        httpd.serve_forever()
