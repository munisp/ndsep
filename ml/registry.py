"""Lightweight model registry for the NDSEP ML stack.

Every training / fine-tuning run is appended to ml/weights/registry.json
(model name, version = UTC timestamp, metrics, weights path, data snapshot
id). If DATABASE_URL is set and reachable, the run is ALSO inserted into
the existing Postgres tables:

    ml_model_registry (name, version, algorithm, framework, accuracy,
                       f1_score, auc_roc, description, status, created_at)
    ml_model_metrics  (model_id, metric_name, metric_value, dataset_split,
                       recorded_at)

(Column names verified against server/routers/aimlRouter.ts — the tables
are created by the platform's own migrations; this module only INSERTs,
and degrades gracefully to file-only when the DB is unreachable.)
"""

from __future__ import annotations

import json
import os
from datetime import datetime

WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "weights")
REGISTRY_JSON = os.path.join(WEIGHTS_DIR, "registry.json")

ALGORITHMS = {"fraud": "MLP (BatchNorm/Dropout) binary classifier",
              "credit": "MLP default-risk scorer",
              "gnn": "GraphSAGE-style GNN (pure PyTorch)"}


def _pg_connect():
    """Return a psycopg2 connection or None (fast timeout, graceful)."""
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return None
    try:
        import psycopg2
        return psycopg2.connect(dsn, connect_timeout=3)
    except Exception:
        return None


def register_run(model: str, metrics: dict, weights_path: str,
                 data_snapshot_id: str | None = None,
                 version: str | None = None,
                 registry_path: str = REGISTRY_JSON,
                 notes: str | None = None) -> dict:
    """Record a training run in the file registry and (optionally) Postgres."""
    version = version or datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    entry = {
        "model": model,
        "version": version,
        "registered_at": datetime.utcnow().isoformat() + "Z",
        "algorithm": ALGORITHMS.get(model, "unknown"),
        "framework": f"pytorch-cpu",
        "metrics": metrics,
        "weights_path": weights_path,
        "data_snapshot_id": data_snapshot_id,
        "notes": notes,
        "postgres": "skipped",
    }

    # ---- file registry (always) ---- #
    os.makedirs(os.path.dirname(registry_path), exist_ok=True)
    registry = []
    if os.path.exists(registry_path):
        with open(registry_path) as f:
            registry = json.load(f)
    registry.append(entry)
    with open(registry_path, "w") as f:
        json.dump(registry, f, indent=2, default=str)

    # ---- Postgres (best-effort) ---- #
    conn = _pg_connect()
    if conn is not None:
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO ml_model_registry
                       (name, version, algorithm, framework, accuracy,
                        f1_score, auc_roc, description, status, created_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'staging', NOW())
                       RETURNING id::text""",
                    (model, version, entry["algorithm"], entry["framework"],
                     metrics.get("accuracy"), metrics.get("f1"),
                     metrics.get("roc_auc"),
                     f"NDSEP ml/ stack run; snapshot={data_snapshot_id}"))
                model_id = cur.fetchone()[0]
                for name, value in metrics.items():
                    if isinstance(value, (int, float)):
                        cur.execute(
                            """INSERT INTO ml_model_metrics
                               (model_id, metric_name, metric_value,
                                dataset_split, recorded_at)
                               VALUES (%s::uuid, %s, %s, 'test', NOW())""",
                            (model_id, name, float(value)))
            entry["postgres"] = f"inserted id={model_id}"
            # rewrite file entry with pg status
            registry[-1] = entry
            with open(registry_path, "w") as f:
                json.dump(registry, f, indent=2, default=str)
        except Exception as e:  # table missing / perms / etc.
            entry["postgres"] = f"failed: {e}"
            registry[-1] = entry
            with open(registry_path, "w") as f:
                json.dump(registry, f, indent=2, default=str)
        finally:
            conn.close()
    return entry


def list_runs(registry_path: str = REGISTRY_JSON) -> list[dict]:
    if os.path.exists(registry_path):
        with open(registry_path) as f:
            return json.load(f)
    return []


def latest_version(model: str, registry_path: str = REGISTRY_JSON) -> str | None:
    runs = [r for r in list_runs(registry_path) if r["model"] == model]
    return runs[-1]["version"] if runs else None


if __name__ == "__main__":
    print(json.dumps(list_runs(), indent=2, default=str))
