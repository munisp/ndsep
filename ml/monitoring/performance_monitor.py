#!/usr/bin/env python3
"""Live inference performance monitoring + alerting for the NDSEP ML stack.

What it does
------------
1. ROLLING LOG — `log_inference()` is called by ml/inference.py on every
   score_* call (unless NDSEP_ML_MONITOR=0) and appends
   {ts, model, version, score, latency_ms, subject_id?, variant?} to
   ml/lakehouse/inference_log/<model>.jsonl (rolling, capped).
2. REFERENCE — the training-time score distribution (decile bins +
   latency p50/p95) is persisted to
   ml/weights/<model>_net_reference_scores.json (written by
   ml/validation/validate.py after a training run, or lazily computed
   here from the lakehouse training snapshot).
3. DEGRADATION CHECK — `check_performance()` compares the most recent
   window of live scores against that reference:
     * PSI on the score distribution (psi > 0.25 = drift, 0.1-0.25 watch)
     * latency p95 regression (> 3x reference p95)
     * volume (records in window; informational)
     * optional labeled outcomes: if logged records carry an `outcome`
       field, recent ROC-AUC vs reference AUC
4. ALERTS — `emit_alert()` always writes ml/lakehouse/alerts/<ts>_<model>.json
   AND — when DATABASE_URL is reachable — INSERTs into the platform's
   Postgres `compliance_drift_alerts` table (same column set used by
   workers/python/drift_detector.py: organization_id, drift_type,
   previous_score, current_score, drift_percentage, severity, status,
   detected_at; organization_id=0 = platform-level model alert).
   Everything degrades gracefully: file alerts are the source of truth.

    python -m ml.monitoring.performance_monitor --check fraud
    python -m ml.monitoring.performance_monitor --check all
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime

import numpy as np
import pandas as pd

ML_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEIGHTS_DIR = os.path.join(ML_ROOT, "weights")
LAKEHOUSE_ROOT = (os.environ.get("ML_LAKEHOUSE_ROOT")
                  or os.path.join(ML_ROOT, "lakehouse"))
LOG_DIR = os.path.join(LAKEHOUSE_ROOT, "inference_log")
ALERTS_DIR = os.path.join(LAKEHOUSE_ROOT, "alerts")

MAX_LOG_LINES = 50_000          # rolling cap per model
PSI_DRIFT = 0.25
PSI_WATCH = 0.10
LATENCY_REGRESSION_FACTOR = 3.0
MIN_WINDOW = 100


# --------------------------------------------------------------------------- #
# 1. Rolling inference log
# --------------------------------------------------------------------------- #
def _log_path(model: str, root: str = LOG_DIR) -> str:
    return os.path.join(root, f"{model}.jsonl")


def log_inference(model: str, version: str, score: float, latency_ms: float,
                  subject_id: str | None = None, variant: str | None = None,
                  outcome: float | None = None,
                  root: str = LOG_DIR, weights_dir: str = WEIGHTS_DIR) -> str:
    """Append one inference observation to the rolling log (failure-safe)."""
    os.makedirs(root, exist_ok=True)
    rec = {"ts": datetime.utcnow().isoformat() + "Z", "model": model,
           "version": version, "score": float(score),
           "latency_ms": round(float(latency_ms), 3)}
    if subject_id is not None:
        rec["subject_id"] = str(subject_id)
    if variant is not None:
        rec["variant"] = variant
    if outcome is not None:
        rec["outcome"] = float(outcome)
    path = _log_path(model, root)
    with open(path, "a") as f:
        f.write(json.dumps(rec) + "\n")
    # cheap rolling cap: ~1% of calls, rewrite keeping the tail
    if os.path.getsize(path) > 0 and np.random.random() < 0.01:
        try:
            with open(path) as f:
                lines = f.readlines()
            if len(lines) > MAX_LOG_LINES:
                with open(path, "w") as f:
                    f.writelines(lines[-MAX_LOG_LINES:])
        except Exception:
            pass
    return path


def load_log(model: str, root: str = LOG_DIR, window: int | None = None
             ) -> pd.DataFrame:
    path = _log_path(model, root)
    if not os.path.exists(path):
        return pd.DataFrame()
    df = pd.read_json(path, lines=True)
    return df.tail(window) if window else df


# --------------------------------------------------------------------------- #
# 2. Reference distribution (training-time score profile)
# --------------------------------------------------------------------------- #
def _reference_path(model: str, weights_dir: str = WEIGHTS_DIR) -> str:
    return os.path.join(weights_dir, f"{model}_net_reference_scores.json")


def save_reference(model: str, scores: np.ndarray,
                   weights_dir: str = WEIGHTS_DIR,
                   latencies_ms: np.ndarray | None = None,
                   auc: float | None = None) -> dict:
    """Persist the training/validation-time score distribution reference."""
    scores = np.asarray(scores, dtype=float)
    edges = np.unique(np.quantile(scores, np.linspace(0, 1, 11)))
    if len(edges) < 3:
        edges = np.array([scores.min() - 1e-6, scores.mean(),
                          scores.max() + 1e-6])
    edges[0], edges[-1] = -np.inf, np.inf
    counts, _ = np.histogram(scores, bins=edges)
    ref = {
        "model": model,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "n": int(len(scores)),
        "mean": float(scores.mean()), "std": float(scores.std()),
        "bin_edges": [float(e) for e in edges],
        "bin_probs": (counts / max(counts.sum(), 1)).tolist(),
        "latency_p50_ms": (float(np.percentile(latencies_ms, 50))
                           if latencies_ms is not None and len(latencies_ms)
                           else None),
        "latency_p95_ms": (float(np.percentile(latencies_ms, 95))
                           if latencies_ms is not None and len(latencies_ms)
                           else None),
        "auc": auc,
    }
    with open(_reference_path(model, weights_dir), "w") as f:
        json.dump(ref, f, indent=2)
    return ref


def load_reference(model: str, weights_dir: str = WEIGHTS_DIR) -> dict | None:
    path = _reference_path(model, weights_dir)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return None


def ensure_reference(model: str, weights_dir: str = WEIGHTS_DIR) -> dict | None:
    """Load the reference; if missing, compute it lazily by scoring a
    sample of the latest lakehouse training snapshot with current weights."""
    ref = load_reference(model, weights_dir)
    if ref is not None:
        return ref
    try:
        from ml.inference import score_batch
        from ml.training import lakehouse
        ds = {"fraud": "transactions", "credit": "credit_features",
              "gnn": "graph_labels"}[model]
        df = lakehouse.load_latest(ds)
        if len(df) > 5000:
            df = df.sample(5000, random_state=0)
        scores = score_batch(model, df, weights_dir=weights_dir)
        return save_reference(model, scores, weights_dir=weights_dir)
    except Exception as e:
        print(f"[monitor] could not build reference for {model}: {e}")
        return None


# --------------------------------------------------------------------------- #
# 3. Degradation check
# --------------------------------------------------------------------------- #
def _psi(expected: np.ndarray, actual: np.ndarray, eps: float = 1e-6) -> float:
    e = np.clip(np.asarray(expected, dtype=float), eps, None)
    a = np.clip(np.asarray(actual, dtype=float), eps, None)
    e, a = e / e.sum(), a / a.sum()
    return float(np.sum((a - e) * np.log(a / e)))


def check_performance(model: str, weights_dir: str = WEIGHTS_DIR,
                      root: str = LOG_DIR, window: int = 1000,
                      alert: bool = True,
                      alerts_dir: str = ALERTS_DIR) -> dict:
    """Compare the recent live-score window against the training reference."""
    df = load_log(model, root=root, window=window)
    report = {"model": model, "checked_at": datetime.utcnow().isoformat() + "Z",
              "window": int(window), "n_in_window": int(len(df)),
              "alerts": [], "status": "ok"}
    if len(df) < MIN_WINDOW:
        report["status"] = "insufficient_data"
        report["note"] = f"need >= {MIN_WINDOW} logged scores, have {len(df)}"
        return report
    ref = ensure_reference(model, weights_dir)
    if ref is None:
        report["status"] = "no_reference"
        return report

    scores = df["score"].to_numpy(dtype=float)
    edges = np.array(ref["bin_edges"], dtype=float)
    counts, _ = np.histogram(scores, bins=edges)
    psi_val = _psi(np.array(ref["bin_probs"]), counts / max(counts.sum(), 1))
    lat_p95 = float(np.percentile(df["latency_ms"], 95))
    report.update({
        "score_psi": round(psi_val, 4),
        "score_mean_recent": round(float(scores.mean()), 5),
        "score_mean_reference": round(ref["mean"], 5),
        "latency_p95_ms": round(lat_p95, 3),
        "latency_p95_reference_ms": ref.get("latency_p95_ms"),
        "volume_per_day": _volume_per_day(df),
    })

    if psi_val > PSI_DRIFT:
        report["alerts"].append({
            "type": "score_distribution_drift", "severity": "high",
            "detail": f"PSI={psi_val:.3f} > {PSI_DRIFT} on live {model} scores",
            "previous_score": ref["mean"], "current_score": float(scores.mean())})
        report["status"] = "drift"
    elif psi_val > PSI_WATCH:
        report["alerts"].append({
            "type": "score_distribution_watch", "severity": "medium",
            "detail": f"PSI={psi_val:.3f} in watch band ({PSI_WATCH}-{PSI_DRIFT})",
            "previous_score": ref["mean"], "current_score": float(scores.mean())})
        report["status"] = "watch"

    ref_p95 = ref.get("latency_p95_ms")
    if ref_p95 and lat_p95 > LATENCY_REGRESSION_FACTOR * ref_p95:
        report["alerts"].append({
            "type": "latency_regression", "severity": "medium",
            "detail": (f"p95 latency {lat_p95:.1f}ms > "
                       f"{LATENCY_REGRESSION_FACTOR}x reference {ref_p95:.1f}ms"),
            "previous_score": ref_p95, "current_score": lat_p95})
        report["status"] = "drift" if report["status"] == "drift" else "latency"

    # optional labeled-outcome track
    if "outcome" in df.columns and df["outcome"].notna().sum() >= MIN_WINDOW:
        from sklearn.metrics import roc_auc_score
        g = df.dropna(subset=["outcome"])
        try:
            recent_auc = float(roc_auc_score(g["outcome"], g["score"]))
            report["recent_auc"] = round(recent_auc, 4)
            if ref.get("auc") and recent_auc < ref["auc"] - 0.05:
                report["alerts"].append({
                    "type": "performance_degradation", "severity": "critical",
                    "detail": (f"recent AUC {recent_auc:.3f} dropped >0.05 "
                               f"below reference {ref['auc']:.3f}"),
                    "previous_score": ref["auc"], "current_score": recent_auc})
                report["status"] = "degraded"
        except ValueError:
            pass

    if alert and report["alerts"]:
        for a in report["alerts"]:
            emit_alert(model, a, report, alerts_dir=alerts_dir)
    return report


def _volume_per_day(df: pd.DataFrame) -> float | None:
    try:
        ts = pd.to_datetime(df["ts"])
        span_h = max((ts.max() - ts.min()).total_seconds() / 3600.0, 1e-6)
        return round(len(df) / span_h * 24.0, 1)
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# 4. Alert emission: lakehouse file + Postgres compliance_drift_alerts
# --------------------------------------------------------------------------- #
def emit_alert(model: str, alert: dict, context: dict | None = None,
               alerts_dir: str = ALERTS_DIR) -> dict:
    """Persist an alert to the lakehouse and (best-effort) Postgres."""
    os.makedirs(alerts_dir, exist_ok=True)
    record = {
        "ts": datetime.utcnow().isoformat() + "Z",
        "model": model,
        "alert": alert,
        "context": {k: v for k, v in (context or {}).items()
                    if k not in ("alerts",)},
        "postgres": "skipped",
    }
    fname = f"{time.strftime('%Y%m%dT%H%M%S')}_{model}_{alert['type']}.json"
    with open(os.path.join(alerts_dir, fname), "w") as f:
        json.dump(record, f, indent=2, default=str)

    dsn = os.environ.get("DATABASE_URL")
    if dsn:
        try:
            import psycopg2
            prev = alert.get("previous_score")
            cur = alert.get("current_score")
            drift_pct = (None if prev in (None, 0) or cur is None
                         else round((float(cur) - float(prev))
                                    / abs(float(prev)) * 100.0, 1))
            conn = psycopg2.connect(dsn, connect_timeout=3)
            try:
                with conn, conn.cursor() as curq:
                    curq.execute(
                        """INSERT INTO compliance_drift_alerts
                           (organization_id, drift_type, previous_score,
                            current_score, drift_percentage, severity,
                            status, detected_at)
                           VALUES (%s, %s, %s, %s, %s, %s, 'open', NOW())""",
                        (0, f"ml_{model}_{alert['type']}",
                         None if prev is None else round(float(prev), 4),
                         None if cur is None else round(float(cur), 4),
                         drift_pct, alert.get("severity", "medium")))
                record["postgres"] = "inserted"
            finally:
                conn.close()
        except Exception as e:
            record["postgres"] = f"failed: {e}"
            with open(os.path.join(alerts_dir, fname), "w") as f:
                json.dump(record, f, indent=2, default=str)
    return record


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", choices=["fraud", "credit", "gnn", "all"],
                    required=True)
    ap.add_argument("--window", type=int, default=1000)
    ap.add_argument("--no-alert", action="store_true")
    args = ap.parse_args()
    models = ["fraud", "credit", "gnn"] if args.check == "all" else [args.check]
    for m in models:
        rep = check_performance(m, window=args.window, alert=not args.no_alert)
        print(json.dumps(rep, indent=2, default=str))


if __name__ == "__main__":
    main()
