"""Local lakehouse layout for NDSEP ML datasets and training-run metrics.

Layout (root default: ml/lakehouse/):

    <root>/<dataset>/v<yyyymmddTHHMMSS>.parquet   (or .csv fallback)
    <root>/_manifest.json                          catalog of all snapshots

Usage:
    from ml.training.lakehouse import save_snapshot, load_latest, list_snapshots

    save_snapshot(transactions_df, "transactions")
    df = load_latest("transactions")

pyarrow is used for parquet when available; otherwise falls back to CSV
(the manifest records the format either way). duckdb is optionally used
for ad-hoc SQL over snapshots when installed.
"""

from __future__ import annotations

import json
import os
from datetime import datetime

import pandas as pd

DEFAULT_ROOT = (os.environ.get("ML_LAKEHOUSE_ROOT")
                or os.path.join(os.path.dirname(os.path.dirname(__file__)),
                                "lakehouse"))

try:
    import pyarrow  # noqa: F401
    HAS_PARQUET = True
except Exception:
    try:
        import fastparquet  # noqa: F401  (alternative parquet engine)
        HAS_PARQUET = True
    except Exception:
        HAS_PARQUET = False

try:
    import duckdb  # noqa: F401
    HAS_DUCKDB = True
except Exception:
    HAS_DUCKDB = False


def _manifest_path(root: str) -> str:
    return os.path.join(root, "_manifest.json")


def _read_manifest(root: str) -> dict:
    path = _manifest_path(root)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {"snapshots": {}}


def _write_manifest(root: str, manifest: dict) -> None:
    os.makedirs(root, exist_ok=True)
    with open(_manifest_path(root), "w") as f:
        json.dump(manifest, f, indent=2, default=str)


def save_snapshot(df: pd.DataFrame, dataset: str, root: str = DEFAULT_ROOT,
                  snapshot_id: str | None = None, meta: dict | None = None) -> dict:
    """Persist a DataFrame as a versioned snapshot; update the catalog."""
    snapshot_id = snapshot_id or "v" + datetime.utcnow().strftime("%Y%m%dT%H%M%S")
    ds_dir = os.path.join(root, dataset)
    os.makedirs(ds_dir, exist_ok=True)

    if HAS_PARQUET:
        path = os.path.join(ds_dir, f"{snapshot_id}.parquet")
        df.to_parquet(path, index=False)
        fmt = "parquet"
    else:
        path = os.path.join(ds_dir, f"{snapshot_id}.csv")
        df.to_csv(path, index=False)
        fmt = "csv"

    entry = {"dataset": dataset, "snapshot_id": snapshot_id, "path": path,
             "format": fmt, "rows": int(len(df)),
             "columns": list(df.columns),
             "created_at": datetime.utcnow().isoformat() + "Z",
             "meta": meta or {}}
    manifest = _read_manifest(root)
    manifest["snapshots"].setdefault(dataset, []).append(entry)
    _write_manifest(root, manifest)
    return entry


def list_snapshots(dataset: str, root: str = DEFAULT_ROOT) -> list[dict]:
    return _read_manifest(root)["snapshots"].get(dataset, [])


def load_snapshot(dataset: str, snapshot_id: str | None = None,
                  root: str = DEFAULT_ROOT) -> pd.DataFrame:
    snaps = list_snapshots(dataset, root)
    if not snaps:
        raise FileNotFoundError(
            f"No snapshots for dataset '{dataset}' under {root}")
    entry = snaps[-1] if snapshot_id is None else next(
        (s for s in snaps if s["snapshot_id"] == snapshot_id), None)
    if entry is None:
        raise FileNotFoundError(
            f"Snapshot '{snapshot_id}' not found for dataset '{dataset}'")
    if entry["format"] == "parquet":
        return pd.read_parquet(entry["path"])
    return pd.read_csv(entry["path"])


def load_latest(dataset: str, root: str = DEFAULT_ROOT) -> pd.DataFrame:
    """Load the most recent snapshot of a dataset."""
    return load_snapshot(dataset, snapshot_id=None, root=root)


def query(sql: str, root: str = DEFAULT_ROOT) -> pd.DataFrame:
    """Ad-hoc SQL over lakehouse parquet snapshots (requires duckdb).

    Snapshots are exposed as views named after their dataset, e.g.:
        query("SELECT count(*) FROM transactions WHERE is_fraud = 1")
    """
    if not HAS_DUCKDB:
        raise RuntimeError("duckdb is not installed; query() unavailable")
    import duckdb
    con = duckdb.connect()
    manifest = _read_manifest(root)
    for dataset, snaps in manifest["snapshots"].items():
        if snaps:
            latest = snaps[-1]["path"].replace("'", "''")
            con.execute(
                f"CREATE VIEW {dataset} AS SELECT * FROM read_parquet('{latest}')")
    try:
        return con.execute(sql).df()
    finally:
        con.close()


def save_metrics_snapshot(metrics: dict, model: str,
                          root: str = DEFAULT_ROOT) -> dict:
    """Append a training-run metrics row as a lakehouse snapshot."""
    row = pd.DataFrame([{**{"model": model,
                            "recorded_at": datetime.utcnow().isoformat() + "Z"},
                         **metrics}])
    return save_snapshot(row, f"training_metrics_{model}", root=root)


if __name__ == "__main__":
    print(json.dumps(_read_manifest(DEFAULT_ROOT), indent=2, default=str))
