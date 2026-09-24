#!/usr/bin/env python3
"""Optional MLflow tracking client for the NDSEP ML stack (thin wrapper).

Design: GRACEFUL. MLflow is only used when BOTH
  * the `mlflow` pip package is installed, AND
  * MLFLOW_TRACKING_URI is set (e.g. http://localhost:5000 — the tracking
    server runs via docker-compose, service `mlflow`, see
    docker-compose-workers-addition.yml).
Otherwise every call is a no-op (with a one-line warning the first time),
so training/fine-tuning work identically with or without MLflow.

Usage in a training script:

    from ml.tracking import track_run
    with track_run("fraud", params={"epochs": 40, "lr": 1e-3}) as run:
        ...train...
        run.log_metrics({"roc_auc": 0.97, "f1": 0.81})
        run.log_artifact("ml/weights/fraud_net.pt")
"""

from __future__ import annotations

import os

try:
    import mlflow  # noqa: F401
    HAS_MLFLOW = True
except Exception:
    mlflow = None
    HAS_MLFLOW = False

_warned = False


def is_active() -> bool:
    """True when MLflow tracking will actually happen."""
    return HAS_MLFLOW and bool(os.environ.get("MLFLOW_TRACKING_URI"))


def _warn_once(msg: str) -> None:
    global _warned
    if not _warned:
        print(f"[tracking] MLflow disabled ({msg}); run is NOT tracked. "
              "Install mlflow and set MLFLOW_TRACKING_URI to enable.")
        _warned = True


class _NullRun:
    """No-op stand-in with the same interface as TrackedRun."""
    active = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def log_params(self, params: dict) -> None:
        pass

    def log_metrics(self, metrics: dict, step: int | None = None) -> None:
        pass

    def log_artifact(self, path: str) -> None:
        pass

    def set_tags(self, tags: dict) -> None:
        pass


class TrackedRun:
    """Context manager wrapping one MLflow run (experiment 'ndsep-ml')."""
    active = True

    def __init__(self, model: str, params: dict | None = None,
                 tags: dict | None = None, experiment: str = "ndsep-ml"):
        self.model = model
        self.params = params or {}
        self.tags = {"model": model, **(tags or {})}
        self.experiment = experiment
        self._run = None

    def __enter__(self) -> "TrackedRun":
        mlflow.set_experiment(self.experiment)
        self._run = mlflow.start_run(run_name=f"{self.model}-"
                                     + os.environ.get("USER", "run"))
        mlflow.set_tags(self.tags)
        if self.params:
            mlflow.log_params({k: str(v) for k, v in self.params.items()})
        return self

    def __exit__(self, exc_type, exc, tb):
        status = "FAILED" if exc_type else "FINISHED"
        mlflow.end_run(status=status)
        return False

    def log_params(self, params: dict) -> None:
        mlflow.log_params({k: str(v) for k, v in params.items()})

    def log_metrics(self, metrics: dict, step: int | None = None) -> None:
        clean = {k: float(v) for k, v in metrics.items()
                 if isinstance(v, (int, float)) and v == v}  # drop NaN
        if clean:
            mlflow.log_metrics(clean, step=step)

    def log_artifact(self, path: str) -> None:
        if os.path.exists(path):
            mlflow.log_artifact(path)

    def set_tags(self, tags: dict) -> None:
        mlflow.set_tags(tags)


def track_run(model: str, params: dict | None = None,
              tags: dict | None = None, experiment: str = "ndsep-ml"):
    """Return a TrackedRun when MLflow is configured, else a no-op run."""
    if not HAS_MLFLOW:
        _warn_once("mlflow package not installed")
        return _NullRun()
    if not os.environ.get("MLFLOW_TRACKING_URI"):
        _warn_once("MLFLOW_TRACKING_URI not set")
        return _NullRun()
    try:
        return TrackedRun(model, params=params, tags=tags,
                          experiment=experiment)
    except Exception as e:
        _warn_once(f"init failed: {e}")
        return _NullRun()
