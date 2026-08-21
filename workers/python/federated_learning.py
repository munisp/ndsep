"""
NDSEP Federated Learning — Privacy-Preserving Cross-Organization Threat Intelligence

Organizations train local anomaly detection models, share only model gradients (not raw data).
Aggregated threat intelligence feeds back to all participants.

Uses: Federated Averaging (FedAvg) with differential privacy noise injection.
"""

import os
import json
import logging
import hashlib
import math
import random
from datetime import datetime
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("federated-learning")

app = FastAPI(
    title="NDSEP Federated Learning Service",
    version="1.0.0",
    description="Privacy-preserving cross-organization threat intelligence via federated ML",
)

# ── Model Types ──────────────────────────────────────────────────────────────


class ModelWeights(BaseModel):
    layer_sizes: list[int]
    weights: list[list[float]]
    bias: list[float]
    version: int
    trained_samples: int


class LocalUpdate(BaseModel):
    org_id: int
    org_name: str
    model_version: int
    gradients: list[list[float]]
    bias_gradients: list[float]
    samples_used: int
    metrics: dict[str, float]
    noise_added: bool = False


class ThreatReport(BaseModel):
    org_id: int
    threat_type: str
    severity: str
    indicators: list[str]
    confidence: float
    timestamp: str | None = None


class FederatedConfig(BaseModel):
    min_participants: int = 3
    rounds: int = 10
    learning_rate: float = 0.01
    dp_epsilon: float = 1.0
    dp_delta: float = 1e-5
    clip_norm: float = 1.0


# ── Global Model State ───────────────────────────────────────────────────────

INPUT_DIM = 8  # packet_size, port, protocol_id, inter_arrival, byte_entropy, flow_duration, flag_count, payload_len
HIDDEN_DIM = 16
OUTPUT_DIM = 2  # normal / anomaly


def init_weights() -> ModelWeights:
    """Xavier initialization for the global model."""
    random.seed(42)
    scale1 = math.sqrt(2.0 / (INPUT_DIM + HIDDEN_DIM))
    scale2 = math.sqrt(2.0 / (HIDDEN_DIM + OUTPUT_DIM))
    return ModelWeights(
        layer_sizes=[INPUT_DIM, HIDDEN_DIM, OUTPUT_DIM],
        weights=[
            [random.gauss(0, scale1) for _ in range(INPUT_DIM * HIDDEN_DIM)],
            [random.gauss(0, scale2) for _ in range(HIDDEN_DIM * OUTPUT_DIM)],
        ],
        bias=[0.0] * HIDDEN_DIM + [0.0] * OUTPUT_DIM,
        version=0,
        trained_samples=0,
    )


global_model = init_weights()
pending_updates: list[LocalUpdate] = []
aggregation_history: list[dict[str, Any]] = []
threat_feed: list[dict[str, Any]] = []
config = FederatedConfig()


# ── Differential Privacy ─────────────────────────────────────────────────────


def clip_gradients(gradients: list[list[float]], clip_norm: float) -> list[list[float]]:
    """Clip gradient norms to bound sensitivity."""
    clipped = []
    for layer in gradients:
        norm = math.sqrt(sum(g * g for g in layer))
        if norm > clip_norm:
            scale = clip_norm / norm
            clipped.append([g * scale for g in layer])
        else:
            clipped.append(layer)
    return clipped


def add_dp_noise(gradients: list[list[float]], epsilon: float, delta: float, clip_norm: float, n_samples: int) -> list[list[float]]:
    """Add calibrated Gaussian noise for (epsilon, delta)-differential privacy."""
    sigma = clip_norm * math.sqrt(2 * math.log(1.25 / delta)) / epsilon
    noisy = []
    for layer in gradients:
        noisy_layer = [g + random.gauss(0, sigma / max(n_samples, 1)) for g in layer]
        noisy.append(noisy_layer)
    return noisy


# ── Federated Averaging ─────────────────────────────────────────────────────


def aggregate_updates(updates: list[LocalUpdate]) -> ModelWeights:
    """FedAvg: weighted average of local model updates."""
    global global_model

    total_samples = sum(u.samples_used for u in updates)
    if total_samples == 0:
        return global_model

    # Aggregate gradients (weighted by sample count)
    new_weights = []
    for layer_idx in range(len(global_model.weights)):
        layer_size = len(global_model.weights[layer_idx])
        aggregated = [0.0] * layer_size
        for update in updates:
            if layer_idx < len(update.gradients):
                weight = update.samples_used / total_samples
                for i in range(min(layer_size, len(update.gradients[layer_idx]))):
                    aggregated[i] += update.gradients[layer_idx][i] * weight
        # Apply learning rate and update global weights
        updated = [
            global_model.weights[layer_idx][i] - config.learning_rate * aggregated[i]
            for i in range(layer_size)
        ]
        new_weights.append(updated)

    # Aggregate biases
    new_bias = list(global_model.bias)
    for update in updates:
        weight = update.samples_used / total_samples
        for i in range(min(len(new_bias), len(update.bias_gradients))):
            new_bias[i] -= config.learning_rate * update.bias_gradients[i] * weight

    global_model = ModelWeights(
        layer_sizes=global_model.layer_sizes,
        weights=new_weights,
        bias=new_bias,
        version=global_model.version + 1,
        trained_samples=global_model.trained_samples + total_samples,
    )

    return global_model


# ── API Endpoints ────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "federated-learning",
        "mode": "simulation",
        "note": "In-memory FedAvg simulation — no distributed participants connected. "
                "For production, deploy Flower/PySyft with real org endpoints.",
        "model_version": global_model.version,
        "pending_updates": len(pending_updates),
        "participants": len({u.org_id for u in pending_updates}),
    }


@app.get("/api/v1/federated/model")
async def get_global_model():
    """Get current global model weights for local training."""
    return {
        "model": global_model.model_dump(),
        "config": config.model_dump(),
    }


@app.post("/api/v1/federated/submit-update")
async def submit_update(update: LocalUpdate):
    """Submit local model gradients after training on org's data."""
    # Validate model version
    if update.model_version != global_model.version:
        raise HTTPException(
            status_code=409,
            detail=f"Model version mismatch: expected {global_model.version}, got {update.model_version}",
        )

    # Clip and add DP noise
    clipped = clip_gradients(update.gradients, config.clip_norm)
    noisy = add_dp_noise(clipped, config.dp_epsilon, config.dp_delta, config.clip_norm, update.samples_used)
    update.gradients = noisy
    update.noise_added = True

    pending_updates.append(update)
    log.info(f"Update from org {update.org_id}: {update.samples_used} samples, metrics={update.metrics}")

    # Auto-aggregate if enough participants
    participants = {u.org_id for u in pending_updates}
    if len(participants) >= config.min_participants:
        new_model = aggregate_updates(pending_updates)
        record = {
            "round": new_model.version,
            "participants": len(participants),
            "total_samples": sum(u.samples_used for u in pending_updates),
            "avg_metrics": {
                k: sum(u.metrics.get(k, 0) for u in pending_updates) / len(pending_updates)
                for k in pending_updates[0].metrics
            },
            "timestamp": datetime.utcnow().isoformat(),
        }
        aggregation_history.append(record)
        pending_updates.clear()
        log.info(f"Aggregation round {new_model.version}: {record}")
        return {"status": "aggregated", "new_model_version": new_model.version, "record": record}

    return {
        "status": "pending",
        "current_participants": len(participants),
        "required": config.min_participants,
    }


@app.post("/api/v1/federated/threat-report")
async def report_threat(report: ThreatReport):
    """Share anonymized threat intelligence with the federation."""
    entry = {
        "org_id_hash": hashlib.sha256(str(report.org_id).encode()).hexdigest()[:16],
        "threat_type": report.threat_type,
        "severity": report.severity,
        "indicators": report.indicators,
        "confidence": report.confidence,
        "timestamp": report.timestamp or datetime.utcnow().isoformat(),
    }
    threat_feed.append(entry)

    # Keep last 1000 entries
    if len(threat_feed) > 1000:
        threat_feed.pop(0)

    return {"status": "reported", "feed_size": len(threat_feed)}


@app.get("/api/v1/federated/threat-feed")
async def get_threat_feed(limit: int = 50, severity: str | None = None):
    """Get aggregated threat intelligence feed."""
    feed = threat_feed
    if severity:
        feed = [t for t in feed if t["severity"] == severity]
    return {"threats": feed[-limit:], "total": len(feed)}


@app.get("/api/v1/federated/history")
async def get_history():
    """Get aggregation history."""
    return {"rounds": aggregation_history, "current_version": global_model.version}


@app.post("/api/v1/federated/config")
async def update_config(new_config: FederatedConfig):
    """Update federation configuration."""
    global config
    config = new_config
    return {"status": "updated", "config": config.model_dump()}


@app.get("/api/v1/federated/stats")
async def get_stats():
    """Get federation statistics."""
    return {
        "model_version": global_model.version,
        "total_samples_trained": global_model.trained_samples,
        "aggregation_rounds": len(aggregation_history),
        "pending_updates": len(pending_updates),
        "unique_participants": len({u.org_id for u in pending_updates}),
        "threat_feed_size": len(threat_feed),
        "config": config.model_dump(),
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("FEDERATED_LEARNING_PORT", "8170"))
    uvicorn.run(app, host="0.0.0.0", port=port)
