# NDSEP ML Foundation: Synthetic-Only CPU Candidate Models

This package is a **working candidate-model foundation**, not a production fraud, residency, compliance or enforcement engine. It creates deterministic synthetic data, writes partitioned Parquet in a Lakehouse-shaped layout, trains real PyTorch and PyTorch-Geometric weights on CPU, signs a candidate model manifest with Ed25519 and refuses inference when an artifact is unsigned, altered or unavailable.

> **Non-negotiable boundary:** The generated labels are analytically simulated. A score may support an accountable human review in a sandbox only. It must never trigger a penalty, payment, account action, residency determination, regulatory conclusion, sanctions decision or adverse action.

## Architecture

| Layer | Implemented behavior | Deliberate restriction |
|---|---|---|
| Synthetic data | Deterministic multi-tenant event and graph generator; partitioned Zstandard Parquet; content-hashed manifest | No real customer, institution, payment, geolocation, personal, regulated or production data is read. |
| Lakehouse access | DuckDB trains from partitioned Parquet and verifies every manifest file hash before load | This is Iceberg-compatible file layout, not a deployed governed Iceberg catalog. |
| ML/DL | CPU PyTorch MLP with optimizer, BCE loss, backpropagation, early stopping, time split, checkpoint and metrics | Candidate only; metrics on synthetic data do not transfer to real-world accuracy. |
| GNN | CPU PyTorch-Geometric GraphSAGE with real message passing and training loop | Graph contains only generated organization IDs/edges; no production graph store is connected. |
| Ray | `ray_pipeline.py` dispatches MLP and GraphSAGE training to separate Ray CPU tasks; signing happens only on driver | This is distributed candidate-task execution, not proof of a governed Ray cluster or distributed data-parallel production training. |
| Artifact integrity | Ed25519-signed `model-manifest.json`; SHA-256 artifact/data hashes; `torch.load(..., weights_only=True)` | Test key is for local validation only. Production requires a separately integrated, non-exportable signing service/HSM. |
| Serving | FastAPI worker verifies manifest signature + hashes before CPU inference and returns `human_review_required` | No train/promotion/enforcement endpoint is exposed. |
| Continuous approach | `continuous_candidate.py` executes one bounded cycle for an external scheduler and writes run evidence | No daemon, automatic promotion or access to base-platform data exists. |

## Local verified run

Use an empty non-production directory and a non-production Ed25519 key. Never place the key in Git, a model image, CI logs or a shared data volume.

```bash
set -euo pipefail
ROOT="$PWD/.ml-foundation-local"
rm -rf "$ROOT"
mkdir -p "$ROOT/keys" "$ROOT/lakehouse" "$ROOT/models" "$ROOT/evidence"
openssl genpkey -algorithm ED25519 -out "$ROOT/keys/candidate-model-signing-key.pem"
python3 synthetic_data.py --output-dir "$ROOT/lakehouse" --events 1200 --tenants 6 --days 90 --seed 20260830
MANIFEST="$(find "$ROOT/lakehouse/manifests" -type f -name 'synthetic-*.json' -print -quit)"
python3 train.py --lakehouse-dir "$ROOT/lakehouse" --data-manifest "$MANIFEST" --output-dir "$ROOT/models" --signing-key "$ROOT/keys/candidate-model-signing-key.pem" --seed 20260830
python3 verify_artifacts.py --model-dir "$ROOT/models"
```

Expected verifier shape:

```json
{"status":"verified","device":"cpu","model":"event_risk_mlp","workflow":"human_review_required"}
```

Start the candidate-only API only on a non-public loopback interface:

```bash
NDSEP_ML_MODEL_DIR="$ROOT/models" NDSEP_ML_PORT=8251 python3 service.py
curl --fail --silent http://127.0.0.1:8251/health
```

## Ray CPU candidate tasks

The following command starts a **local** two-CPU Ray runtime. On an approved managed/cluster Ray deployment, provide `--ray-address` with a private authenticated address and use workload identity, network policy, encrypted object storage and a remote signing service; do not send a private signing key to Ray workers.

```bash
python3 ray_pipeline.py \
  --lakehouse-dir "$ROOT/ray-lakehouse" \
  --model-output-dir "$ROOT/ray-models" \
  --signing-key "$ROOT/keys/candidate-model-signing-key.pem" \
  --events 1200 --tenants 6 --days 90 --seed 20260830
```

## Continuous candidate cycles

A scheduler may invoke one immutable candidate cycle. The scheduler must supply a distinct run directory and retain the resulting evidence; it must not mark a model as deployed.

```bash
python3 continuous_candidate.py \
  --lakehouse-dir "$ROOT/candidate-lakehouse" \
  --model-output-dir "$ROOT/candidate-models" \
  --run-evidence-dir "$ROOT/evidence" \
  --signing-key "$ROOT/keys/candidate-model-signing-key.pem" \
  --events 6000 --tenants 12 --days 180 --seed 20260830
```

## Path to governed platform-data training

Before adding a governed real-data adapter, require: legal authority and data-minimization approval; tenant-scoped data contract; irreversible de-identification or approved privacy-preserving treatment; a versioned Iceberg catalog/data-quality contract; immutable dataset snapshot and lineage; time-based and tenant-aware evaluation; data leakage, bias and performance validation; model registry; independent signature/attestation; approval by accountable model-risk and compliance owners; monitoring; and rollback. Existing base-platform data must not be read merely because it is technically accessible.

## Tests

```bash
python3 test_ml_foundation.py
```

The test creates temporary data and key material, trains both models, verifies artifacts and deletes the temporary directory. It does not connect to PostgreSQL, Redis, Kafka, TigerBeetle, Mojaloop, CBN, NIBSS, Keycloak, Ray cluster or any external service.
