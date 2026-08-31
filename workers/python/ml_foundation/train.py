#!/usr/bin/env python3
"""CPU-only candidate training for NDSEP synthetic Lakehouse data.

The program trains two real models: a PyTorch MLP on event features and a
PyTorch-Geometric GraphSAGE model on the generated organization graph.  It is
candidate-only: no output changes a compliance, payment, residency, sanctions,
fraud or enforcement decision.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import duckdb
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from torch_geometric.data import Data
from torch_geometric.nn import SAGEConv

FEATURE_NAMES = [
    "amount_ngn_equivalent", "velocity_24h", "device_age_days",
    "country_risk_band", "cross_border", "prior_review_count",
    "failed_auth_24h", "unusual_hour",
]
MODEL_SCHEMA_VERSION = "ndsep.ml.candidate.v1"
DEVICE = torch.device("cpu")


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def sha256_path(path: Path) -> str:
    hash_value = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            hash_value.update(block)
    return hash_value.hexdigest()


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True, warn_only=True)


class EventRiskMLP(nn.Module):
    def __init__(self, inputs: int) -> None:
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(inputs, 32), nn.ReLU(), nn.Dropout(0.10),
            nn.Linear(32, 16), nn.ReLU(), nn.Linear(16, 1),
        )

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        return self.network(values).squeeze(-1)


class OrganizationGraphSAGE(nn.Module):
    def __init__(self, inputs: int) -> None:
        super().__init__()
        self.layer_one = SAGEConv(inputs, 24)
        self.layer_two = SAGEConv(24, 12)
        self.output = nn.Linear(12, 1)

    def forward(self, x: torch.Tensor, edge_index: torch.Tensor) -> torch.Tensor:
        x = F.relu(self.layer_one(x, edge_index))
        x = F.dropout(x, p=0.10, training=self.training)
        x = F.relu(self.layer_two(x, edge_index))
        return self.output(x).squeeze(-1)


def _load_manifest(path: Path) -> dict[str, Any]:
    manifest = json.loads(path.read_text())
    if manifest.get("classification") != "synthetic_only":
        raise ValueError("candidate trainer permits only classification=synthetic_only")
    required = {"dataset_sha256", "files", "schema_version", "event_count", "label_name"}
    missing = required - set(manifest)
    if missing:
        raise ValueError(f"dataset manifest missing: {sorted(missing)}")
    return manifest


def _verify_data_manifest(lakehouse_dir: Path, manifest: dict[str, Any]) -> None:
    files = manifest.get("files", [])
    if not files:
        raise ValueError("dataset manifest has no data files")
    for record in files:
        path = lakehouse_dir / record["path"]
        if not path.is_file():
            raise ValueError(f"dataset file missing: {path}")
        actual = sha256_path(path)
        if actual != record["sha256"]:
            raise ValueError(f"dataset file hash mismatch: {record['path']}")


def _event_matrix(lakehouse_dir: Path, manifest: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, list[str], list[str]]:
    _verify_data_manifest(lakehouse_dir, manifest)
    events_glob = str(lakehouse_dir / "bronze" / "synthetic_compliance_events" / "**" / "*.parquet")
    query = f"""
      SELECT {', '.join(FEATURE_NAMES)}, simulated_review_label, observed_at, tenant_id
      FROM read_parquet('{events_glob}', hive_partitioning=true)
      ORDER BY observed_at ASC, event_id ASC
    """
    connection = duckdb.connect(":memory:")
    rows = connection.execute(query).fetchall()
    connection.close()
    if len(rows) < 500:
        raise ValueError("at least 500 synthetic records are required")
    features = np.asarray([[float(item[index]) for index in range(len(FEATURE_NAMES))] for item in rows], dtype=np.float32)
    labels = np.asarray([float(item[len(FEATURE_NAMES)]) for item in rows], dtype=np.float32)
    timestamps = [str(item[len(FEATURE_NAMES) + 1]) for item in rows]
    tenants = [str(item[len(FEATURE_NAMES) + 2]) for item in rows]
    return features, labels, timestamps, tenants


def _standardize_train(features: np.ndarray, train_end: int) -> tuple[np.ndarray, dict[str, list[float]]]:
    means = features[:train_end].mean(axis=0)
    stds = features[:train_end].std(axis=0)
    stds = np.where(stds < 1e-6, 1.0, stds)
    return ((features - means) / stds).astype(np.float32), {"mean": means.tolist(), "std": stds.tolist()}


def _metrics(logits: torch.Tensor, labels: torch.Tensor) -> dict[str, float]:
    with torch.no_grad():
        probabilities = torch.sigmoid(logits)
        predictions = (probabilities >= 0.5).float()
        accuracy = float((predictions == labels).float().mean().item())
        true_positive = float(((predictions == 1) & (labels == 1)).sum().item())
        false_positive = float(((predictions == 1) & (labels == 0)).sum().item())
        false_negative = float(((predictions == 0) & (labels == 1)).sum().item())
        precision = true_positive / max(true_positive + false_positive, 1.0)
        recall = true_positive / max(true_positive + false_negative, 1.0)
        f1 = 2 * precision * recall / max(precision + recall, 1e-12)
    return {"accuracy": round(accuracy, 6), "precision": round(precision, 6), "recall": round(recall, 6), "f1": round(f1, 6)}


def train_event_model(features: np.ndarray, labels: np.ndarray, seed: int) -> tuple[EventRiskMLP, dict[str, Any], dict[str, list[float]]]:
    total = len(features)
    train_end = int(total * 0.70)
    validation_end = int(total * 0.85)
    standardized, scaler = _standardize_train(features, train_end)
    x = torch.tensor(standardized, dtype=torch.float32, device=DEVICE)
    y = torch.tensor(labels, dtype=torch.float32, device=DEVICE)
    model = EventRiskMLP(x.shape[1]).to(DEVICE)
    positives = max(float(y[:train_end].sum().item()), 1.0)
    negatives = max(float(train_end) - positives, 1.0)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(negatives / positives, device=DEVICE))
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.002, weight_decay=1e-4)
    best_state: dict[str, torch.Tensor] | None = None
    best_validation = float("inf")
    stale_epochs = 0
    history: list[float] = []
    for epoch in range(80):
        model.train()
        optimizer.zero_grad()
        loss = loss_fn(model(x[:train_end]), y[:train_end])
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        model.eval()
        with torch.no_grad():
            validation_loss = float(loss_fn(model(x[train_end:validation_end]), y[train_end:validation_end]).item())
        history.append(validation_loss)
        if validation_loss < best_validation - 1e-6:
            best_validation = validation_loss
            best_state = {name: value.detach().cpu().clone() for name, value in model.state_dict().items()}
            stale_epochs = 0
        else:
            stale_epochs += 1
        if stale_epochs >= 12:
            break
    if best_state is None:
        raise RuntimeError("event model did not produce a checkpoint")
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        test_logits = model(x[validation_end:])
    metrics = {
        "task": "synthetic_event_review_classification",
        "split": {"strategy": "time_ordered", "train": train_end, "validation": validation_end - train_end, "test": total - validation_end},
        "test": _metrics(test_logits, y[validation_end:]),
        "validation_bce": round(best_validation, 6),
        "epochs": len(history),
        "feature_names": FEATURE_NAMES,
        "seed": seed,
    }
    return model, metrics, scaler


def _graph_data(lakehouse_dir: Path) -> tuple[Data, list[str]]:
    events_glob = str(lakehouse_dir / "bronze" / "synthetic_compliance_events" / "**" / "*.parquet")
    edges_path = str(lakehouse_dir / "bronze" / "synthetic_compliance_graph_edges" / "graph_edges.parquet")
    query = f"""
      WITH nodes AS (
        SELECT organization_id AS organization_id,
          AVG(amount_ngn_equivalent) AS avg_amount,
          AVG(velocity_24h) AS avg_velocity,
          AVG(failed_auth_24h) AS avg_failed_auth,
          AVG(CASE WHEN cross_border THEN 1 ELSE 0 END) AS cross_border_ratio,
          AVG(simulated_review_label) AS review_ratio
        FROM read_parquet('{events_glob}', hive_partitioning=true)
        GROUP BY organization_id
      )
      SELECT * FROM nodes ORDER BY organization_id
    """
    connection = duckdb.connect(":memory:")
    node_rows = connection.execute(query).fetchall()
    edge_rows = connection.execute(
        f"SELECT source_organization_id, target_organization_id FROM read_parquet('{edges_path}')"
    ).fetchall()
    connection.close()
    node_ids = [str(row[0]) for row in node_rows]
    index = {node_id: position for position, node_id in enumerate(node_ids)}
    raw_features = np.asarray([[float(value) for value in row[1:5]] for row in node_rows], dtype=np.float32)
    feature_mean = raw_features.mean(axis=0)
    feature_std = np.where(raw_features.std(axis=0) < 1e-6, 1.0, raw_features.std(axis=0))
    labels = np.asarray([float(row[5] >= 0.16) for row in node_rows], dtype=np.float32)
    edges: list[tuple[int, int]] = []
    for src, dst in edge_rows:
        if src in index and dst in index:
            edges.extend([(index[src], index[dst]), (index[dst], index[src])])
    if not edges:
        raise ValueError("synthetic graph has no usable edges")
    edge_index = torch.tensor(edges, dtype=torch.long).t().contiguous()
    data = Data(
        x=torch.tensor((raw_features - feature_mean) / feature_std, dtype=torch.float32),
        edge_index=edge_index,
        y=torch.tensor(labels, dtype=torch.float32),
    )
    count = len(node_ids)
    data.train_mask = torch.arange(count) < int(count * 0.70)
    data.val_mask = (torch.arange(count) >= int(count * 0.70)) & (torch.arange(count) < int(count * 0.85))
    data.test_mask = torch.arange(count) >= int(count * 0.85)
    return data, node_ids


def train_graph_model(lakehouse_dir: Path, seed: int) -> tuple[OrganizationGraphSAGE, dict[str, Any], list[str]]:
    graph, node_ids = _graph_data(lakehouse_dir)
    model = OrganizationGraphSAGE(graph.x.shape[1]).to(DEVICE)
    graph = graph.to(DEVICE)
    positives = max(float(graph.y[graph.train_mask].sum().item()), 1.0)
    negatives = max(float(graph.train_mask.sum().item()) - positives, 1.0)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(negatives / positives, device=DEVICE))
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.01, weight_decay=5e-4)
    best_state: dict[str, torch.Tensor] | None = None
    best_val = float("inf")
    stale = 0
    for epoch in range(120):
        model.train()
        optimizer.zero_grad()
        logits = model(graph.x, graph.edge_index)
        loss = loss_fn(logits[graph.train_mask], graph.y[graph.train_mask])
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        model.eval()
        with torch.no_grad():
            val_logits = model(graph.x, graph.edge_index)[graph.val_mask]
            val_loss = float(loss_fn(val_logits, graph.y[graph.val_mask]).item())
        if val_loss < best_val - 1e-6:
            best_val = val_loss
            best_state = {name: value.detach().cpu().clone() for name, value in model.state_dict().items()}
            stale = 0
        else:
            stale += 1
        if stale >= 18:
            break
    if best_state is None:
        raise RuntimeError("graph model did not produce a checkpoint")
    model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        test_logits = model(graph.x, graph.edge_index)[graph.test_mask]
    metrics = {
        "task": "synthetic_organization_graph_review_classification",
        "test": _metrics(test_logits, graph.y[graph.test_mask]),
        "validation_bce": round(best_val, 6),
        "epochs": epoch + 1,
        "nodes": int(graph.num_nodes),
        "directed_edges": int(graph.edge_index.shape[1]),
        "seed": seed,
    }
    return model, metrics, node_ids


def _load_signing_key(path: Path) -> Ed25519PrivateKey:
    private_key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(private_key, Ed25519PrivateKey):
        raise ValueError("model signing key must be Ed25519 PEM")
    return private_key


def _write_signed_manifest(
    output_dir: Path,
    data_manifest: dict[str, Any],
    model_entries: list[dict[str, Any]],
    signing_key_path: Path,
) -> Path:
    key = _load_signing_key(signing_key_path)
    public_bytes = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    manifest = {
        "schema_version": MODEL_SCHEMA_VERSION,
        "status": "candidate_only",
        "classification": "synthetic_training_only",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "training_dataset_sha256": data_manifest["dataset_sha256"],
        "training_dataset_manifest": data_manifest.get("manifest_path", "external"),
        "models": model_entries,
        "safety_notice": "Model outputs are decision-support candidates. They must not automatically impose penalties, blocks, residency assertions, regulatory findings or adverse actions.",
        "signing": {"algorithm": "Ed25519", "public_key_b64": public_bytes.hex()},
    }
    signature = key.sign(canonical_json(manifest))
    manifest["signing"]["signature_b64"] = signature.hex()
    manifest["manifest_sha256"] = hashlib.sha256(canonical_json(manifest)).hexdigest()
    destination = output_dir / "model-manifest.json"
    destination.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
    return destination


def train_all(lakehouse_dir: Path, data_manifest_path: Path, output_dir: Path, signing_key_path: Path, seed: int) -> dict[str, Any]:
    set_seed(seed)
    data_manifest = _load_manifest(data_manifest_path)
    data_manifest["manifest_path"] = str(data_manifest_path.resolve())
    features, labels, _timestamps, _tenants = _event_matrix(lakehouse_dir, data_manifest)
    output_dir.mkdir(parents=True, exist_ok=True)

    event_model, event_metrics, scaler = train_event_model(features, labels, seed)
    event_path = output_dir / "event_risk_mlp.pt"
    torch.save({"state_dict": event_model.state_dict(), "feature_names": FEATURE_NAMES, "scaler": scaler}, event_path)

    graph_model, graph_metrics, node_ids = train_graph_model(lakehouse_dir, seed)
    graph_path = output_dir / "organization_graphsage.pt"
    torch.save({"state_dict": graph_model.state_dict(), "node_ids": node_ids}, graph_path)

    model_entries = [
        {"name": "event_risk_mlp", "framework": "pytorch", "device": "cpu", "artifact": event_path.name,
         "sha256": sha256_path(event_path), "metrics": event_metrics, "input_schema": FEATURE_NAMES},
        {"name": "organization_graphsage", "framework": "pytorch_geometric", "device": "cpu", "artifact": graph_path.name,
         "sha256": sha256_path(graph_path), "metrics": graph_metrics, "input_schema": ["organization_graph"]},
    ]
    model_manifest = _write_signed_manifest(output_dir, data_manifest, model_entries, signing_key_path)
    return {"status": "candidate_trained", "model_manifest": str(model_manifest), "models": model_entries,
            "dataset_sha256": data_manifest["dataset_sha256"]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Train NDSEP synthetic-only CPU candidate models")
    parser.add_argument("--lakehouse-dir", required=True, type=Path)
    parser.add_argument("--data-manifest", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--signing-key", required=True, type=Path)
    parser.add_argument("--seed", default=20260830, type=int)
    args = parser.parse_args()
    result = train_all(args.lakehouse_dir, args.data_manifest, args.output_dir, args.signing_key, args.seed)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
