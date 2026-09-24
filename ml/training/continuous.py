#!/usr/bin/env python3
"""Continuous training orchestration for the NDSEP ML stack.

One evaluation cycle (`--once`, cron-friendly) per model:

  1. DECIDE — fine-tune when ANY of:
       * --force is given,
       * feature DRIFT is detected on a fresh data batch (PSI/KS via
         ml.monitoring.drift against the train-time feature stats),
       * the current weights are older than --max-staleness-hours
         (default 72h — the platform's model-refresh cadence).
  2. DATA   — the batch comes from fine_tune.get_new_batch: real platform
       tables via DATABASE_URL when reachable, otherwise a fresh synthetic
       batch (explicitly labelled as such in the run record).
  3. TRAIN  — fine_tune's per-model fine-tuner runs from existing weights
       at a low LR; VERSIONED weights (<model>_net_<version>.pt) are saved
       (canonical weights are NOT overwritten — promote via A/B,
       ml/ab_testing.py), and the run is registered (JSON registry +
       Postgres ml_model_registry when reachable).
  4. REPORT — a run record is appended to ml/lakehouse/training_runs/
       (jsonl + lakehouse snapshot). Failures additionally emit an alert
       (ml/lakehouse/alerts/ + Postgres compliance_drift_alerts when
       reachable). Exit code is non-zero if any model failed, so cron /
       Temporal can page on it.

Scheduling: see ml/CONTINUOUS_TRAINING.md (cron line + Temporal schedule).

    python -m ml.training.continuous --once --model all
    python -m ml.training.continuous --model all --interval-hours 24  # loop
"""

from __future__ import annotations

import argparse
import json
import os
import time
import traceback
from datetime import datetime, timedelta

import pandas as pd

from ml.data.generate_synthetic import (CREDIT_FEATURES, FRAUD_FEATURES,
                                        NODE_FEATURE_DIM)
from ml.monitoring import performance_monitor
from ml.monitoring.drift import drift_report, load_feature_stats
from ml.training import lakehouse
from ml.training.fine_tune import FINE_TUNERS, get_new_batch
from ml.training.train import DEFAULT_DATA_DIR, WEIGHTS_DIR

LAKEHOUSE_ROOT = lakehouse.DEFAULT_ROOT
TRAINING_RUNS_DIR = os.path.join(LAKEHOUSE_ROOT, "training_runs")

MODELS = ["fraud", "credit", "gnn"]


# --------------------------------------------------------------------------- #
# Decision inputs
# --------------------------------------------------------------------------- #
def _weights_age_hours(model: str, weights_dir: str) -> float | None:
    """Age of the canonical weights in hours (None = never trained)."""
    mpath = os.path.join(weights_dir, f"{model}_net_metrics.json")
    if not os.path.exists(mpath):
        return None
    try:
        with open(mpath) as f:
            trained_at = json.load(f)["trained_at"]
        ts = datetime.strptime(trained_at, "%Y-%m-%dT%H:%M:%SZ")
        return (datetime.utcnow() - ts).total_seconds() / 3600.0
    except Exception:
        return None


def _check_drift(model: str, batch: dict, weights_dir: str) -> dict:
    """Drift report of the fresh batch vs train-time feature stats."""
    stats_path = os.path.join(weights_dir, f"{model}_net_feature_stats.json")
    if not os.path.exists(stats_path):
        return {"drift_detected": False, "note": "no feature stats"}
    stats = load_feature_stats(stats_path)
    if model == "fraud":
        return drift_report(stats, batch["transactions"], FRAUD_FEATURES)
    if model == "credit":
        cr = batch["credit_features"]
        return drift_report(stats, cr,
                            [f for f in CREDIT_FEATURES if f in cr.columns])
    feat_cols = [f"f{i}" for i in range(NODE_FEATURE_DIM)]
    org_feats = batch["graph_nodes"][
        batch["graph_nodes"]["node_type"] == "organization"]
    return drift_report(stats, org_feats, feat_cols)


# --------------------------------------------------------------------------- #
# Run-record persistence + alerts
# --------------------------------------------------------------------------- #
def _record_run(record: dict) -> None:
    os.makedirs(TRAINING_RUNS_DIR, exist_ok=True)
    with open(os.path.join(TRAINING_RUNS_DIR,
                           f"{record['model']}.jsonl"), "a") as f:
        f.write(json.dumps(record, default=str) + "\n")
    try:  # lakehouse snapshot catalog (parquet when available)
        lakehouse.save_snapshot(pd.DataFrame([record]), "training_runs",
                                meta={"model": record["model"],
                                      "action": record["action"]})
    except Exception as e:
        print(f"[continuous] lakehouse snapshot skipped: {e}")


def _emit_failure_alert(model: str, error: str) -> None:
    try:
        performance_monitor.emit_alert(
            model,
            {"type": "continuous_training_failure", "severity": "high",
             "detail": f"continuous training failed for {model}: {error}"},
            context={"orchestrator": "ml.training.continuous"})
    except Exception as e:
        print(f"[continuous] alert emission failed: {e}")


# --------------------------------------------------------------------------- #
# One cycle
# --------------------------------------------------------------------------- #
def run_cycle(models: list[str], force: bool, max_staleness_hours: float,
              epochs: int, lr: float, batch_seed: int,
              data_dir: str = DEFAULT_DATA_DIR,
              weights_dir: str = WEIGHTS_DIR) -> list[dict]:
    records = []
    failed = False
    for model in models:
        rec = {"model": model, "cycle_at": datetime.utcnow().isoformat() + "Z",
               "action": "skipped", "reason": None, "version": None,
               "status": "ok"}
        print(f"\n[continuous] === {model} ===")
        try:
            if not os.path.exists(os.path.join(weights_dir,
                                               f"{model}_net.pt")):
                rec["reason"] = "no base weights — run train.py first"
                print(f"[continuous] {rec['reason']}")
                _record_run(rec)
                records.append(rec)
                continue

            batch, source = get_new_batch(model, data_dir, batch_seed)
            drift = _check_drift(model, batch, weights_dir)
            age_h = _weights_age_hours(model, weights_dir)
            stale = age_h is None or age_h > max_staleness_hours
            drifted = bool(drift.get("drift_detected"))
            rec["drift"] = {k: v for k, v in drift.items() if k != "features"}
            rec["data_source"] = source
            rec["weights_age_hours"] = (round(age_h, 1)
                                        if age_h is not None else None)

            if force or drifted or stale:
                why = ([r for r, c in [("forced", force),
                                       ("drift_detected", drifted),
                                       ("weights_stale", stale)] if c])
                rec["reason"] = "+".join(why)
                print(f"[continuous] fine-tuning {model} ({rec['reason']}; "
                      f"age={rec['weights_age_hours']}h, source={source})")
                payload = FINE_TUNERS[model](batch, source, epochs, lr,
                                             weights_dir)
                rec["action"] = "fine_tuned"
                rec["version"] = payload["version"]
                rec["metrics"] = payload["metrics"]
            else:
                rec["reason"] = (f"no drift, weights fresh "
                                 f"({rec['weights_age_hours']}h "
                                 f"<= {max_staleness_hours}h)")
                print(f"[continuous] {model}: {rec['reason']} — skipping")
        except Exception as e:
            failed = True
            rec["status"] = "failed"
            rec["action"] = "failed"
            rec["reason"] = f"{type(e).__name__}: {e}"
            traceback.print_exc()
            _emit_failure_alert(model, rec["reason"])
        _record_run(rec)
        records.append(rec)

    n_trained = sum(r["action"] == "fine_tuned" for r in records)
    print(f"\n[continuous] cycle complete: {n_trained} fine-tuned, "
          f"{sum(r['action'] == 'skipped' for r in records)} skipped, "
          f"{sum(r['status'] == 'failed' for r in records)} failed")
    return records


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", choices=[*MODELS, "all"], default="all")
    ap.add_argument("--once", action="store_true",
                    help="run a single cycle and exit (cron-friendly)")
    ap.add_argument("--force", action="store_true",
                    help="fine-tune regardless of drift/staleness")
    ap.add_argument("--interval-hours", type=float, default=24.0,
                    help="loop interval when not --once (default 24h)")
    ap.add_argument("--max-staleness-hours", type=float, default=72.0,
                    help="fine-tune when weights are older than this "
                         "(default 72h)")
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--batch-seed", type=int, default=None,
                    help="synthetic fallback batch seed (default: hourly)")
    ap.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    ap.add_argument("--weights-dir", default=WEIGHTS_DIR)
    args = ap.parse_args()

    models = MODELS if args.model == "all" else [args.model]
    seed = args.batch_seed or int(time.time() // 3600)

    if args.once:
        records = run_cycle(models, args.force, args.max_staleness_hours,
                            args.epochs, args.lr, seed,
                            data_dir=args.data_dir,
                            weights_dir=args.weights_dir)
        return 1 if any(r["status"] == "failed" for r in records) else 0

    print(f"[continuous] entering scheduler loop "
          f"(every {args.interval_hours}h; Ctrl-C to stop)")
    while True:
        run_cycle(models, args.force, args.max_staleness_hours,
                  args.epochs, args.lr, seed,
                  data_dir=args.data_dir, weights_dir=args.weights_dir)
        args.force = False  # --force applies to the first cycle only
        time.sleep(args.interval_hours * 3600)


if __name__ == "__main__":
    raise SystemExit(main())
