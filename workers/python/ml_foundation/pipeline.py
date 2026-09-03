#!/usr/bin/env python3
"""Candidate-only NDSEP ML pipeline.

This is a deliberately bounded training entry point.  It generates synthetic data,
trains candidate artifacts and exits.  A scheduler may invoke it, but it cannot
self-promote a model or access platform data without a separately approved adapter.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from synthetic_data import GenerationConfig, write_lakehouse
from train import train_all


def main() -> None:
    parser = argparse.ArgumentParser(description="Run one NDSEP synthetic-only candidate training cycle")
    parser.add_argument("--lakehouse-dir", required=True, type=Path)
    parser.add_argument("--model-output-dir", required=True, type=Path)
    parser.add_argument("--signing-key", required=True, type=Path)
    parser.add_argument("--events", default=6000, type=int)
    parser.add_argument("--tenants", default=12, type=int)
    parser.add_argument("--days", default=180, type=int)
    parser.add_argument("--seed", default=20260830, type=int)
    args = parser.parse_args()
    data = write_lakehouse(args.lakehouse_dir, GenerationConfig(args.seed, args.events, args.tenants, args.days))
    trained = train_all(args.lakehouse_dir, Path(data["manifest_path"]), args.model_output_dir, args.signing_key, args.seed)
    print(json.dumps({"status": "candidate_cycle_completed", "dataset": data, "training": trained}, sort_keys=True))


if __name__ == "__main__":
    main()
