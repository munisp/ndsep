#!/usr/bin/env python3
"""Bounded continuous candidate-training controller.

This controller is intentionally an explicit one-shot job suitable for an external
scheduler. It does not run an unbounded daemon, auto-promote models, mutate
operational decisions or ingest regulated platform data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from pipeline import main as pipeline_main


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one governed NDSEP candidate training cycle")
    parser.add_argument("--lakehouse-dir", required=True, type=Path)
    parser.add_argument("--model-output-dir", required=True, type=Path)
    parser.add_argument("--signing-key", required=True, type=Path)
    parser.add_argument("--run-evidence-dir", required=True, type=Path)
    parser.add_argument("--events", default=6000, type=int)
    parser.add_argument("--tenants", default=12, type=int)
    parser.add_argument("--days", default=180, type=int)
    parser.add_argument("--seed", default=20260830, type=int)
    args = parser.parse_args()

    # Rebuild argv for the strict one-shot candidate pipeline; no hidden data source.
    import sys
    sys.argv = [
        "pipeline.py", "--lakehouse-dir", str(args.lakehouse_dir), "--model-output-dir", str(args.model_output_dir),
        "--signing-key", str(args.signing_key), "--events", str(args.events), "--tenants", str(args.tenants),
        "--days", str(args.days), "--seed", str(args.seed),
    ]
    pipeline_main()
    model_manifest = args.model_output_dir / "model-manifest.json"
    if not model_manifest.is_file():
        raise RuntimeError("candidate pipeline did not produce a signed model manifest")
    raw = model_manifest.read_bytes()
    evidence = {
        "schema_version": "ndsep.ml.candidate-run.v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "run_mode": "candidate_only",
        "source_classification": "synthetic_only",
        "model_manifest_path": str(model_manifest.resolve()),
        "model_manifest_sha256": hashlib.sha256(raw).hexdigest(),
        "automatic_promotion": False,
        "required_next_control": "independent_evaluation_and_human_approval",
    }
    args.run_evidence_dir.mkdir(parents=True, exist_ok=True)
    destination = args.run_evidence_dir / f"candidate-run-{evidence['model_manifest_sha256'][:16]}.json"
    destination.write_text(json.dumps(evidence, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"status": "candidate_cycle_recorded", "evidence_path": str(destination), **evidence}, sort_keys=True))


if __name__ == "__main__":
    main()
