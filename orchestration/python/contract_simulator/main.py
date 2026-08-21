"""NDSEP test-only external-provider contract simulator.

This service exists solely to exercise request, timeout, and response-validation paths
when approved NIMC, CAC, or document-conversion infrastructure is unavailable. Every
response is marked with X-NDSEP-Simulation: true. It refuses to start in production.
"""

from __future__ import annotations

import hashlib
import os
import sys
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field


if os.environ.get("NODE_ENV") == "production" or os.environ.get("NDSEP_ENV") == "production":
    raise RuntimeError("NDSEP contract simulator must never start in production")
if os.environ.get("NDSEP_ALLOW_TEST_PROVIDER_EMULATORS") != "true":
    raise RuntimeError(
        "Set NDSEP_ALLOW_TEST_PROVIDER_EMULATORS=true explicitly to start the test-only contract simulator"
    )

app = FastAPI(title="NDSEP Test-Only Provider Contract Simulator", version="1.0.0")


def simulation_headers(response: Response) -> None:
    response.headers["X-NDSEP-Simulation"] = "true"
    response.headers["X-NDSEP-Simulation-Reason"] = "contract-test-only"
    response.headers["Cache-Control"] = "no-store"


@app.middleware("http")
async def label_all_responses(request: Request, call_next: Any) -> Response:
    response = await call_next(request)
    simulation_headers(response)
    return response


class IdentityRequest(BaseModel):
    id_type: str = Field(pattern="^(nin|bvn|passport|drivers_license|voter_card)$")
    id_value: str = Field(min_length=3, max_length=255)
    purpose: str = Field(min_length=3, max_length=500)


class CompanyRequest(BaseModel):
    registration_number: str = Field(min_length=3, max_length=128)
    purpose: str = Field(min_length=3, max_length=500)


class DocumentRequest(BaseModel):
    document_reference: str = Field(min_length=1, max_length=255)
    media_type: str = Field(pattern="^(application/pdf|image/png|image/jpeg)$")


def configured_outcome(name: str) -> bool:
    """Returns a test result only when a human explicitly selects it in test config."""
    value = os.environ.get(name, "not_verified").strip().lower()
    if value == "verified":
        return True
    if value == "not_verified":
        return False
    raise RuntimeError(f"{name} must be 'verified' or 'not_verified' in a test environment")


def redacted_subject_reference(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "test_only",
        "simulation": True,
        "services": [
            "nimc_nvs",
            "cac_registry",
            "docling",
            "arkime_viewer",
            "bgp_route_feed",
            "asset_inventory",
            "vulnerability_source",
            "dpi_sensor_gateway",
            "stream_metrics_gateway",
        ],
    }


@app.post("/v1/identity/verify")
async def verify_identity(
    payload: IdentityRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="test bridge authentication is required")
    verified = configured_outcome("NDSEP_SIM_NIMC_OUTCOME")
    return {
        "verified": verified,
        "provider_reference": f"sim-nimc-{uuid.uuid4()}",
        "status": "verified" if verified else "not_found",
        "subject_reference": redacted_subject_reference(payload.id_value),
        "simulation": True,
    }


@app.post("/v1/business/verify")
async def verify_company(
    payload: CompanyRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="test bridge authentication is required")
    verified = configured_outcome("NDSEP_SIM_CAC_OUTCOME")
    return {
        "verified": verified,
        "provider_reference": f"sim-cac-{uuid.uuid4()}",
        "status": "active" if verified else "not_found",
        "legal_name": "Test-only simulated business" if verified else None,
        "registration_type": "company" if verified else None,
        "simulation": True,
    }


@app.post("/v1/documents/convert")
async def convert_document(
    payload: DocumentRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="test bridge authentication is required")
    # The simulator verifies only the shape and error paths. It never claims to
    # convert, OCR, or validate a document.
    return {
        "status": "unavailable_in_simulation",
        "provider_reference": f"sim-docling-{uuid.uuid4()}",
        "document_reference": payload.document_reference,
        "simulation": True,
    }


@app.get("/api/sessions")
async def arkime_sessions(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization:
        raise HTTPException(status_code=401, detail="test bridge authentication is required")
    # Empty by design: this fixture validates contract paths only and never invents PCAP sessions.
    return {"data": [], "recordsTotal": 0, "recordsFiltered": 0}


@app.get("/api/eshealth")
async def arkime_health(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization:
        raise HTTPException(status_code=401, detail="test bridge authentication is required")
    return {"status": "test_only", "simulation": True}


@app.get("/v1/routes")
async def bgp_routes(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization:
        raise HTTPException(status_code=401, detail="test bridge authentication is required")
    return {"routes": []}


@app.get("/v1/assets")
async def discovery_assets(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization:
        raise HTTPException(status_code=401, detail="test bridge authentication is required")
    return {"assets": []}


@app.get("/v1/findings")
async def vulnerability_findings(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization:
        raise HTTPException(status_code=401, detail="test bridge authentication is required")
    return {"findings": []}


@app.get("/v1/dpi/snapshot")
async def dpi_snapshot(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization:
        raise HTTPException(status_code=401, detail="test bridge authentication is required")
    return {"events": [], "sites": []}


@app.get("/v1/stream/metrics")
async def stream_metrics(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization:
        raise HTTPException(status_code=401, detail="test bridge authentication is required")
    observed_at = datetime.now(UTC).isoformat()
    return {
        "kafka_topics": [],
        "fluvio_topics": [],
        "broker": {
            "broker_count": 1,
            "leaders_online": 1,
            "replicas_in_sync": 1,
            "under_replicated": 0,
            "messages_in_per_second": 0,
            "messages_out_per_second": 0,
            "observed_at": observed_at,
        },
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8346"))
    uvicorn.run(app, host="0.0.0.0", port=port)
