#!/usr/bin/env python3
"""Deterministic, synthetic-only data generator for NDSEP candidate-model training.

This module never connects to production databases or external financial systems.  The
schema resembles compliance-event telemetry only at an abstract level.  Tenant,
organization, device and transaction identifiers are generated and contain no
personal, institutional or regulated data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA_VERSION = "ndsep.synthetic.compliance.v1"
GENERATOR_VERSION = "1.0.0"


@dataclass(frozen=True)
class GenerationConfig:
    seed: int = 20260830
    events: int = 6000
    tenants: int = 12
    days: int = 180


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _event_id(seed: int, ordinal: int) -> str:
    return hashlib.sha256(f"ndsep-synthetic:{seed}:{ordinal}".encode()).hexdigest()[:32]


def generate_dataset(config: GenerationConfig) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Generate reproducible events and a safe organization-to-organization graph.

    Labels are generated from documented synthetic risk mechanisms.  They describe a
    *simulation* target only and must never be portrayed as fraud, compliance or
    residency labels for real entities.
    """
    if config.events < 500:
        raise ValueError("events must be at least 500 for a stratified time split")
    if config.tenants < 2:
        raise ValueError("tenants must be at least 2")
    if config.days < 30:
        raise ValueError("days must be at least 30")

    rng = np.random.default_rng(config.seed)
    chooser = random.Random(config.seed)
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    organization_count = config.tenants * 8
    organizations = [f"org-{index:04d}" for index in range(organization_count)]
    tenant_for_org = {org: f"tenant-{index // 8 + 1:03d}" for index, org in enumerate(organizations)}

    events: list[dict[str, Any]] = []
    for ordinal in range(config.events):
        origin = organizations[int(rng.integers(0, organization_count))]
        destination = organizations[int(rng.integers(0, organization_count))]
        while destination == origin:
            destination = organizations[int(rng.integers(0, organization_count))]

        day_offset = int(rng.integers(0, config.days))
        minute_offset = int(rng.integers(0, 24 * 60))
        observed_at = start + timedelta(days=day_offset, minutes=minute_offset)
        amount = float(np.round(rng.lognormal(mean=7.25, sigma=1.0), 2))
        velocity = int(rng.poisson(2.2 + (amount > 4000) * 2.0))
        device_age_days = int(rng.integers(0, 900))
        country_risk = int(rng.choice([0, 1, 2], p=[0.78, 0.17, 0.05]))
        cross_border = bool(rng.random() < 0.16)
        prior_review_count = int(rng.poisson(0.6))
        failed_auth_24h = int(rng.poisson(0.35 + (device_age_days < 7) * 1.8))
        hour = observed_at.hour
        unusual_hour = int(hour < 5 or hour > 22)

        # Deliberately documented simulated causal process, plus irreducible noise.
        logit = (
            -4.2
            + 0.00018 * min(amount, 50000)
            + 0.24 * velocity
            + 0.82 * int(device_age_days < 7)
            + 0.62 * cross_border
            + 0.44 * country_risk
            + 0.41 * prior_review_count
            + 0.53 * failed_auth_24h
            + 0.27 * unusual_hour
            + float(rng.normal(0, 0.65))
        )
        simulated_review_label = int(rng.random() < 1.0 / (1.0 + math.exp(-logit)))
        events.append({
            "event_id": _event_id(config.seed, ordinal),
            "tenant_id": tenant_for_org[origin],
            "organization_id": origin,
            "counterparty_organization_id": destination,
            "observed_at": observed_at.isoformat(),
            "event_day": observed_at.date().isoformat(),
            "amount_ngn_equivalent": amount,
            "velocity_24h": velocity,
            "device_age_days": device_age_days,
            "country_risk_band": country_risk,
            "cross_border": cross_border,
            "prior_review_count": prior_review_count,
            "failed_auth_24h": failed_auth_24h,
            "unusual_hour": unusual_hour,
            "simulated_review_label": simulated_review_label,
            "dataset_classification": "synthetic_only",
            "generator_version": GENERATOR_VERSION,
        })

    # The graph is derived solely from the generated events.  It is a second dataset,
    # not an unsupported claim about real network or money movement.
    edge_counts: dict[tuple[str, str], dict[str, Any]] = {}
    for event in events:
        key = (event["organization_id"], event["counterparty_organization_id"])
        row = edge_counts.setdefault(key, {
            "source_organization_id": key[0],
            "target_organization_id": key[1],
            "event_count": 0,
            "simulated_review_count": 0,
            "cross_border_count": 0,
        })
        row["event_count"] += 1
        row["simulated_review_count"] += event["simulated_review_label"]
        row["cross_border_count"] += int(event["cross_border"])

    edges = []
    for edge in edge_counts.values():
        if edge["event_count"] >= 2:
            edges.append({
                **edge,
                "source_tenant_id": tenant_for_org[edge["source_organization_id"]],
                "target_tenant_id": tenant_for_org[edge["target_organization_id"]],
                "dataset_classification": "synthetic_only",
            })
    chooser.shuffle(edges)
    return events, edges


def write_lakehouse(output_dir: Path, config: GenerationConfig) -> dict[str, Any]:
    """Write partitioned Parquet + immutable manifest without external services."""
    output_dir = output_dir.resolve()
    events, edges = generate_dataset(config)
    dataset_root = output_dir / "bronze" / "synthetic_compliance_events"
    graph_root = output_dir / "bronze" / "synthetic_compliance_graph_edges"
    dataset_root.mkdir(parents=True, exist_ok=True)
    graph_root.mkdir(parents=True, exist_ok=True)

    event_files: list[Path] = []
    partitions: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for event in events:
        partitions.setdefault((event["tenant_id"], event["event_day"]), []).append(event)
    for (tenant_id, event_day), rows in sorted(partitions.items()):
        destination = dataset_root / f"tenant_id={tenant_id}" / f"event_day={event_day}"
        destination.mkdir(parents=True, exist_ok=True)
        path = destination / "events.parquet"
        pq.write_table(pa.Table.from_pylist(rows), path, compression="zstd")
        event_files.append(path)

    graph_path = graph_root / "graph_edges.parquet"
    pq.write_table(pa.Table.from_pylist(edges), graph_path, compression="zstd")
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "generator_version": GENERATOR_VERSION,
        "classification": "synthetic_only",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generation_config": asdict(config),
        "event_count": len(events),
        "edge_count": len(edges),
        "label_name": "simulated_review_label",
        "label_notice": "This is an analytically generated simulation label and is not a regulatory, fraud, residency, sanctions, KYC or adverse-decision label.",
        "files": [
            {"path": str(path.relative_to(output_dir)), "sha256": sha256_file(path)}
            for path in [*event_files, graph_path]
        ],
    }
    manifest_payload = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    manifest["dataset_sha256"] = hashlib.sha256(manifest_payload).hexdigest()
    manifest_path = output_dir / "manifests" / f"synthetic-{manifest['dataset_sha256'][:16]}.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
    return {"manifest_path": str(manifest_path), **manifest}


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate deterministic NDSEP synthetic-only Lakehouse training data")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--events", default=6000, type=int)
    parser.add_argument("--tenants", default=12, type=int)
    parser.add_argument("--days", default=180, type=int)
    parser.add_argument("--seed", default=20260830, type=int)
    args = parser.parse_args()
    result = write_lakehouse(args.output_dir, GenerationConfig(args.seed, args.events, args.tenants, args.days))
    print(json.dumps({
        "status": "created",
        "classification": result["classification"],
        "dataset_sha256": result["dataset_sha256"],
        "event_count": result["event_count"],
        "edge_count": result["edge_count"],
        "manifest_path": result["manifest_path"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
