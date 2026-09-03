#!/usr/bin/env python3
"""Ray launcher for NDSEP synthetic-only candidate training.

The driver creates one synthetic dataset manifest, then executes independent MLP and
GraphSAGE candidate training workloads through Ray.  Artifact signing remains on the
driver, avoiding distribution of the model-signing private key to workers.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import ray
import torch

from synthetic_data import GenerationConfig, write_lakehouse
from train import (
    FEATURE_NAMES,
    _event_matrix,
    _load_manifest,
    _write_signed_manifest,
    set_seed,
    sha256_path,
    train_event_model,
    train_graph_model,
)


@ray.remote(num_cpus=1)
def train_event_remote(lakehouse_dir: str, data_manifest_path: str, seed: int) -> dict[str, Any]:
    set_seed(seed)
    manifest = _load_manifest(Path(data_manifest_path))
    features, labels, _timestamps, _tenants = _event_matrix(Path(lakehouse_dir), manifest)
    model, metrics, scaler = train_event_model(features, labels, seed)
    return {"state_dict": model.state_dict(), "metrics": metrics, "scaler": scaler}


@ray.remote(num_cpus=1)
def train_graph_remote(lakehouse_dir: str, seed: int) -> dict[str, Any]:
    set_seed(seed + 1)
    model, metrics, node_ids = train_graph_model(Path(lakehouse_dir), seed + 1)
    return {"state_dict": model.state_dict(), "metrics": metrics, "node_ids": node_ids}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Ray candidate training for NDSEP synthetic-only data")
    parser.add_argument("--lakehouse-dir", required=True, type=Path)
    parser.add_argument("--model-output-dir", required=True, type=Path)
    parser.add_argument("--signing-key", required=True, type=Path)
    parser.add_argument("--events", default=6000, type=int)
    parser.add_argument("--tenants", default=12, type=int)
    parser.add_argument("--days", default=180, type=int)
    parser.add_argument("--seed", default=20260830, type=int)
    parser.add_argument("--ray-address", default=None, help="Approved Ray address; omit for local two-CPU Ray runtime")
    args = parser.parse_args()

    data = write_lakehouse(args.lakehouse_dir, GenerationConfig(args.seed, args.events, args.tenants, args.days))
    ray.init(address=args.ray_address or None, num_cpus=2 if args.ray_address is None else None, ignore_reinit_error=True)
    event_result, graph_result = ray.get([
        train_event_remote.remote(str(args.lakehouse_dir), data["manifest_path"], args.seed),
        train_graph_remote.remote(str(args.lakehouse_dir), args.seed),
    ])
    output = args.model_output_dir
    output.mkdir(parents=True, exist_ok=True)
    event_path = output / "event_risk_mlp.pt"
    graph_path = output / "organization_graphsage.pt"
    torch.save({"state_dict": event_result["state_dict"], "feature_names": FEATURE_NAMES, "scaler": event_result["scaler"]}, event_path)
    torch.save({"state_dict": graph_result["state_dict"], "node_ids": graph_result["node_ids"]}, graph_path)
    entries = [
        {"name": "event_risk_mlp", "framework": "pytorch", "device": "cpu", "artifact": event_path.name,
         "sha256": sha256_path(event_path), "metrics": event_result["metrics"], "input_schema": FEATURE_NAMES},
        {"name": "organization_graphsage", "framework": "pytorch_geometric", "device": "cpu", "artifact": graph_path.name,
         "sha256": sha256_path(graph_path), "metrics": graph_result["metrics"], "input_schema": ["organization_graph"]},
    ]
    manifest = _load_manifest(Path(data["manifest_path"]))
    manifest["manifest_path"] = data["manifest_path"]
    model_manifest = _write_signed_manifest(output, manifest, entries, args.signing_key)
    print(json.dumps({"status": "ray_candidate_cycle_completed", "ray_resources": ray.cluster_resources(), "dataset": data,
                      "model_manifest": str(model_manifest), "models": entries}, sort_keys=True))
    ray.shutdown()


if __name__ == "__main__":
    main()
