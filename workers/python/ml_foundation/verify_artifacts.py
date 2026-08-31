#!/usr/bin/env python3
"""Verify signed NDSEP candidate model artifacts and exercise one CPU inference."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify NDSEP signed candidate model artifacts")
    parser.add_argument("--model-dir", required=True, type=Path)
    args = parser.parse_args()
    os.environ["NDSEP_ML_MODEL_DIR"] = str(args.model_dir.resolve())
    import service  # Imported after model path is fixed.

    service.MODEL_DIR = args.model_dir.resolve()
    service.MANIFEST_PATH = service.MODEL_DIR / "model-manifest.json"
    model, scaler, details = service._load_verified_model()
    request = service.EventPredictionRequest(
        amount_ngn_equivalent=2000.0,
        velocity_24h=1,
        device_age_days=120,
        country_risk_band=0,
        cross_border=False,
        prior_review_count=0,
        failed_auth_24h=0,
        unusual_hour=0,
        purpose="decision_support",
    )
    result = service.predict_event(request)
    if result["status"] != "candidate_only" or result["recommended_workflow"] != "human_review_required":
        raise SystemExit("candidate model returned an unsafe workflow state")
    print(json.dumps({
        "status": "verified",
        "device": str(next(model.parameters()).device),
        "model": details["entry"]["name"],
        "model_sha256": details["entry"]["sha256"],
        "dataset_sha256": details["manifest"]["training_dataset_sha256"],
        "sample_probability": result["simulated_review_probability"],
        "workflow": result["recommended_workflow"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
