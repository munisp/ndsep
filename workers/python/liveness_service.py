#!/usr/bin/env python3
"""
NDSEP Liveness Detection Service (FastAPI)
============================================
Production biometric verification microservice.

Endpoints:
  POST /api/liveness/passive     — Single-image passive liveness check
  POST /api/liveness/active      — Multi-frame active liveness check
  POST /api/face/detect          — Face detection with 68-point landmarks
  POST /api/face/match           — Compare two face images
  POST /api/face/extract         — Extract face feature embedding
  POST /api/anti-spoof/classify  — Anti-spoofing classification
  POST /api/deepfake/detect      — Deepfake detection
  GET  /health                   — Liveness probe
  GET  /metrics                  — Prometheus metrics

Port: 8150 (configurable via LIVENESS_SERVICE_PORT)
"""

import base64
import io
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import List, Optional

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("liveness_service")

# Import liveness modules
from liveness.anti_spoof import SpoofType
from liveness.face_detector import FaceDetector, compute_landmark_features
from liveness.face_matcher import FaceMatcher
from liveness.liveness_scorer import LivenessScorer

# ─── Global State ────────────────────────────────────────────────────────────

scorer: Optional[LivenessScorer] = None
matcher: Optional[FaceMatcher] = None
startup_time: float = 0
request_count: int = 0
error_count: int = 0


@asynccontextmanager
async def lifespan(app: FastAPI):
    global scorer, matcher, startup_time
    logger.info("[LivenessService] Initializing ML models...")
    t0 = time.monotonic()
    scorer = LivenessScorer()
    matcher = FaceMatcher(match_threshold=0.6)
    startup_time = time.time()
    logger.info(f"[LivenessService] Models loaded in {(time.monotonic() - t0) * 1000:.0f}ms")
    yield
    if scorer:
        scorer.close()
    logger.info("[LivenessService] Shutdown complete")


app = FastAPI(
    title="NDSEP Liveness Detection Service",
    version="1.0.0",
    description="Biometric verification with face detection, liveness, anti-spoofing, and deepfake detection",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request/Response Models ─────────────────────────────────────────────────

class Base64ImageRequest(BaseModel):
    image: str = Field(..., description="Base64-encoded image (JPEG/PNG)")


class TwoImageRequest(BaseModel):
    image_a: str = Field(..., description="Base64-encoded reference image")
    image_b: str = Field(..., description="Base64-encoded probe image")
    threshold: Optional[float] = Field(0.6, description="Match threshold (0-1)")


class ActiveLivenessRequest(BaseModel):
    frames: List[str] = Field(..., description="List of base64-encoded frames", min_length=3)
    challenges: Optional[List[str]] = Field(
        default=["blink", "turn_left"],
        description="Challenges: blink, turn_left, turn_right, nod, open_mouth",
    )


class AntiSpoofResponse(BaseModel):
    is_real: bool
    overall_score: float
    spoof_type: str
    spoof_probability: float
    checks: list
    attack_details: dict


class DeepfakeResponse(BaseModel):
    is_deepfake: bool
    confidence: float
    deepfake_probability: float
    frequency_score: float
    blending_score: float
    lighting_score: float
    texture_score: float
    details: str


class FaceDetectionResponse(BaseModel):
    face_count: int
    faces: list
    image_width: int
    image_height: int
    processing_time_ms: float


class PassiveLivenessResponse(BaseModel):
    is_live: bool
    liveness_score: float
    face_detected: bool
    face_count: int
    face_quality: float
    anti_spoof: Optional[dict] = None
    deepfake: Optional[dict] = None
    landmarks_68: Optional[list] = None
    landmark_features: Optional[dict] = None
    processing_time_ms: float
    details: str


class ActiveLivenessResponse(BaseModel):
    is_live: bool
    liveness_score: float
    challenges_passed: int
    challenges_total: int
    blink_detected: bool
    head_movement_detected: bool
    motion_consistency: float
    frame_count: int
    anti_spoof: Optional[dict] = None
    deepfake: Optional[dict] = None
    processing_time_ms: float
    details: str
    challenge_results: dict


class FaceMatchResponse(BaseModel):
    is_match: bool
    similarity: float
    distance: float
    confidence: float
    threshold: float
    embedding_model: str


class FaceEmbeddingResponse(BaseModel):
    embedding: list
    model: str
    dimension: int


# ─── Helpers ──────────────────────────────────────────────────────────────────

def decode_image(b64: str) -> np.ndarray:
    """Decode a base64 image string to a BGR numpy array."""
    try:
        # Strip data URL prefix if present
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        raw = base64.b64decode(b64)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Failed to decode image")
        return img
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {e}")


def increment_request():
    global request_count
    request_count += 1


def increment_error():
    global error_count
    error_count += 1


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "liveness-detection",
        "uptime_seconds": round(time.time() - startup_time, 1) if startup_time else 0,
        "models_loaded": scorer is not None,
        "backend": scorer.detector._backend if scorer else "none",
    }


@app.get("/metrics")
async def metrics():
    return {
        "requests_total": request_count,
        "errors_total": error_count,
        "uptime_seconds": round(time.time() - startup_time, 1) if startup_time else 0,
    }


@app.post("/api/liveness/passive", response_model=PassiveLivenessResponse)
async def passive_liveness(req: Base64ImageRequest):
    """Single-image passive liveness detection."""
    increment_request()
    image = decode_image(req.image)
    result = scorer.passive_liveness(image)

    return PassiveLivenessResponse(
        is_live=bool(result.is_live),
        liveness_score=float(result.liveness_score),
        face_detected=bool(result.face_detected),
        face_count=int(result.face_count),
        face_quality=float(result.face_quality),
        anti_spoof=_serialize_anti_spoof(result.anti_spoof) if result.anti_spoof else None,
        deepfake=_serialize_deepfake(result.deepfake) if result.deepfake else None,
        landmarks_68=result.landmarks_68,
        landmark_features=result.landmark_features,
        processing_time_ms=round(float(result.processing_time_ms), 2),
        details=str(result.details),
    )


@app.post("/api/liveness/active", response_model=ActiveLivenessResponse)
async def active_liveness(req: ActiveLivenessRequest):
    """Multi-frame active liveness detection with challenges."""
    increment_request()
    frames = [decode_image(f) for f in req.frames]
    result = scorer.active_liveness(frames, challenges=req.challenges)

    return ActiveLivenessResponse(
        is_live=bool(result.is_live),
        liveness_score=float(result.liveness_score),
        challenges_passed=int(result.challenges_passed),
        challenges_total=int(result.challenges_total),
        blink_detected=bool(result.blink_detected),
        head_movement_detected=bool(result.head_movement_detected),
        motion_consistency=float(result.motion_consistency),
        frame_count=int(result.frame_count),
        anti_spoof=_serialize_anti_spoof(result.anti_spoof) if result.anti_spoof else None,
        deepfake=_serialize_deepfake(result.deepfake) if result.deepfake else None,
        processing_time_ms=round(float(result.processing_time_ms), 2),
        details=str(result.details),
        challenge_results={k: bool(v) for k, v in result.challenge_results.items()},
    )


@app.post("/api/face/detect", response_model=FaceDetectionResponse)
async def face_detect(req: Base64ImageRequest):
    """Detect faces with bounding boxes and 68-point landmarks."""
    increment_request()
    image = decode_image(req.image)
    result = scorer.detector.detect(image)

    faces = []
    for face in result.faces:
        face_data = {
            "bbox": {"x": int(face.bbox[0]), "y": int(face.bbox[1]), "w": int(face.bbox[2]), "h": int(face.bbox[3])},
            "confidence": round(float(face.confidence), 4),
        }
        if face.landmarks_68 is not None:
            face_data["landmarks_68"] = face.landmarks_68.tolist()
            face_data["landmark_features"] = compute_landmark_features(face.landmarks_68)
        faces.append(face_data)

    return FaceDetectionResponse(
        face_count=result.face_count,
        faces=faces,
        image_width=int(result.image_width),
        image_height=int(result.image_height),
        processing_time_ms=round(float(result.processing_time_ms), 2),
    )


@app.post("/api/face/match", response_model=FaceMatchResponse)
async def face_match(req: TwoImageRequest):
    """Compare two face images and return match score."""
    increment_request()
    img_a = decode_image(req.image_a)
    img_b = decode_image(req.image_b)

    # Detect and crop faces
    det_a = scorer.detector.detect(img_a)
    det_b = scorer.detector.detect(img_b)

    if det_a.face_count == 0:
        raise HTTPException(status_code=400, detail="No face detected in image_a")
    if det_b.face_count == 0:
        raise HTTPException(status_code=400, detail="No face detected in image_b")

    face_a = det_a.primary_face.face_crop
    face_b = det_b.primary_face.face_crop

    result = matcher.match(face_a, face_b, threshold=req.threshold)

    return FaceMatchResponse(
        is_match=bool(result.is_match),
        similarity=float(result.similarity),
        distance=float(result.distance),
        confidence=float(result.confidence),
        threshold=float(result.threshold),
        embedding_model=str(result.embedding_model),
    )


@app.post("/api/face/extract", response_model=FaceEmbeddingResponse)
async def face_extract(req: Base64ImageRequest):
    """Extract 128-d face feature embedding."""
    increment_request()
    image = decode_image(req.image)

    det = scorer.detector.detect(image)
    if det.face_count == 0:
        raise HTTPException(status_code=400, detail="No face detected")

    embedding = matcher.extract_embedding(det.primary_face.face_crop)
    if embedding is None:
        raise HTTPException(status_code=500, detail="Embedding extraction failed")

    return FaceEmbeddingResponse(
        embedding=embedding.vector.tolist(),
        model=embedding.model,
        dimension=len(embedding.vector),
    )


@app.post("/api/anti-spoof/classify", response_model=AntiSpoofResponse)
async def anti_spoof_classify(req: Base64ImageRequest):
    """Run anti-spoofing classification on a face image."""
    increment_request()
    image = decode_image(req.image)

    det = scorer.detector.detect(image)
    if det.face_count == 0:
        raise HTTPException(status_code=400, detail="No face detected")

    result = scorer.anti_spoof.classify(det.primary_face.face_crop, image)

    return AntiSpoofResponse(**_serialize_anti_spoof(result))


@app.post("/api/deepfake/detect", response_model=DeepfakeResponse)
async def deepfake_detect(req: Base64ImageRequest):
    """Run deepfake detection on a face image."""
    increment_request()
    image = decode_image(req.image)

    det = scorer.detector.detect(image)
    if det.face_count == 0:
        raise HTTPException(status_code=400, detail="No face detected")

    result = scorer.deepfake.detect(
        det.primary_face.face_crop, image, det.primary_face.bbox
    )

    return DeepfakeResponse(**_serialize_deepfake(result))


# ─── Serialization Helpers ────────────────────────────────────────────────────

def _serialize_anti_spoof(r) -> dict:
    return {
        "is_real": bool(r.is_real),
        "overall_score": float(r.overall_score),
        "spoof_type": r.spoof_type.value if hasattr(r.spoof_type, "value") else str(r.spoof_type),
        "spoof_probability": float(r.spoof_probability),
        "checks": [
            {"name": str(c.check_name), "score": round(float(c.score), 4), "weight": float(c.weight), "details": str(c.details)}
            for c in r.checks
        ],
        "attack_details": {str(k): float(v) if isinstance(v, (int, float, np.floating, np.integer)) else str(v) for k, v in r.attack_details.items()},
    }


def _serialize_deepfake(r) -> dict:
    return {
        "is_deepfake": bool(r.is_deepfake),
        "confidence": float(r.confidence),
        "deepfake_probability": float(r.deepfake_probability),
        "frequency_score": float(r.frequency_score),
        "blending_score": float(r.blending_score),
        "lighting_score": float(r.lighting_score),
        "texture_score": float(r.texture_score),
        "details": str(r.details),
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("LIVENESS_SERVICE_PORT", "8150"))
    logger.info(f"[LivenessService] Starting on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
