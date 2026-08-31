#!/usr/bin/env python3
"""Fail-closed CPU inference service for signed NDSEP candidate models.

This service intentionally exposes decision support only. It rejects unsigned,
missing, altered, production-labelled or non-synthetic candidate artifacts and
never returns an enforcement instruction.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import numpy as np
import torch
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from train import EventRiskMLP, FEATURE_NAMES, canonical_json, sha256_path

MODEL_DIR = Path(os.environ.get("NDSEP_ML_MODEL_DIR", "/var/lib/ndsep-ml/models"))
MANIFEST_PATH = MODEL_DIR / "model-manifest.json"
DEVICE = torch.device("cpu")

app = FastAPI(title="NDSEP Candidate ML Foundation", version="1.0.0")


class EventPredictionRequest(BaseModel):
    amount_ngn_equivalent: float = Field(ge=0, le=10_000_000)
    velocity_24h: int = Field(ge=0, le=10_000)
    device_age_days: int = Field(ge=0, le=20_000)
    country_risk_band: int = Field(ge=0, le=2)
    cross_border: bool
    prior_review_count: int = Field(ge=0, le=10_000)
    failed_auth_24h: int = Field(ge=0, le=10_000)
    unusual_hour: int = Field(ge=0, le=1)
    purpose: str = Field(pattern="^decision_support$")


def _load_verified_model() -> tuple[EventRiskMLP, dict[str, Any], dict[str, Any]]:
    if not MANIFEST_PATH.is_file():
        raise RuntimeError("candidate model manifest is unavailable")
    manifest = json.loads(MANIFEST_PATH.read_text())
    if manifest.get("status") != "candidate_only" or manifest.get("classification") != "synthetic_training_only":
        raise RuntimeError("model manifest is not an approved synthetic candidate")
    expected_manifest_hash = manifest.get("manifest_sha256")
    digest_copy = dict(manifest)
    digest_copy.pop("manifest_sha256", None)
    if expected_manifest_hash != hashlib.sha256(canonical_json(digest_copy)).hexdigest():
        raise RuntimeError("model manifest digest mismatch")
    signing = dict(manifest.get("signing") or {})
    signature_hex = signing.pop("signature_b64", "")
    public_key_hex = signing.get("public_key_b64", "")
    verify_copy = dict(manifest)
    verify_copy.pop("manifest_sha256", None)
    verify_signing = dict(verify_copy["signing"])
    verify_signing.pop("signature_b64", None)
    verify_copy["signing"] = verify_signing
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key_hex)).verify(bytes.fromhex(signature_hex), canonical_json(verify_copy))
    except Exception as error:
        raise RuntimeError("model manifest signature verification failed") from error
    entry = next((record for record in manifest.get("models", []) if record.get("name") == "event_risk_mlp"), None)
    if not entry:
        raise RuntimeError("event model entry is missing")
    artifact_path = MODEL_DIR / str(entry.get("artifact", ""))
    if not artifact_path.is_file() or sha256_path(artifact_path) != entry.get("sha256"):
        raise RuntimeError("event model artifact hash verification failed")
    checkpoint = torch.load(artifact_path, map_location=DEVICE, weights_only=True)
    if checkpoint.get("feature_names") != FEATURE_NAMES:
        raise RuntimeError("event model feature schema does not match service schema")
    model = EventRiskMLP(len(FEATURE_NAMES)).to(DEVICE)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model, checkpoint["scaler"], {"manifest": manifest, "entry": entry}


@app.get("/health")
def health() -> dict[str, Any]:
    try:
        _model, _scaler, data = _load_verified_model()
        return {"status": "ready", "device": "cpu", "model": data["entry"]["name"], "model_sha256": data["entry"]["sha256"], "mode": "candidate_only"}
    except RuntimeError as error:
        return {"status": "unavailable", "reason": str(error), "mode": "candidate_only"}


@app.get("/v1/models")
def model_info() -> dict[str, Any]:
    try:
        _model, _scaler, data = _load_verified_model()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail="verified candidate model unavailable") from error
    entry = data["entry"]
    return {"status": "candidate_only", "model": {"name": entry["name"], "framework": entry["framework"], "sha256": entry["sha256"], "metrics": entry["metrics"]}, "training_dataset_sha256": data["manifest"]["training_dataset_sha256"]}


@app.post("/v1/predict/event")
def predict_event(request: EventPredictionRequest) -> dict[str, Any]:
    try:
        model, scaler, data = _load_verified_model()
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail="verified candidate model unavailable") from error
    raw = np.asarray([[getattr(request, feature) for feature in FEATURE_NAMES]], dtype=np.float32)
    mean = np.asarray(scaler["mean"], dtype=np.float32)
    std = np.asarray(scaler["std"], dtype=np.float32)
    scaled = torch.tensor((raw - mean) / std, dtype=torch.float32, device=DEVICE)
    with torch.no_grad():
        probability = float(torch.sigmoid(model(scaled)).item())
    return {
        "status": "candidate_only",
        "model_name": data["entry"]["name"],
        "model_sha256": data["entry"]["sha256"],
        "training_dataset_sha256": data["manifest"]["training_dataset_sha256"],
        "simulated_review_probability": round(probability, 6),
        "recommended_workflow": "human_review_required",
        "prohibited_uses": ["automated_enforcement", "payment_action", "residency_assertion", "regulatory_finding", "adverse_decision"],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("NDSEP_ML_PORT", "8251")))
