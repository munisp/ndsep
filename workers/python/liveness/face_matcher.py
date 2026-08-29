"""
Face Feature Extraction & Matching
====================================
Extracts 128-d face embeddings and computes similarity scores.
Uses the CPU face_recognition (dlib) embedding model. No heuristic image-similarity fallback is permitted for biometric decisions.
"""

import logging
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger("liveness.face_matcher")


@dataclass
class FaceEmbedding:
    """128-dimensional face feature vector."""
    vector: np.ndarray  # (128,) float64
    model: str  # "dlib"


@dataclass
class MatchResult:
    """Face matching result between two images."""
    similarity: float  # 0.0 - 1.0
    distance: float    # Euclidean distance
    is_match: bool     # True if similarity >= threshold
    threshold: float
    confidence: float  # Calibrated confidence 0-100
    embedding_model: str


class FaceFeatureExtractor:
    """Extract face embeddings for matching and identification."""

    def __init__(self):
        self._backend = "none"
        self._face_rec = None
        self._init_backend()

    def _init_backend(self):
        # Try face_recognition (dlib) first
        try:
            import face_recognition
            self._face_rec = face_recognition
            self._backend = "dlib"
            logger.info("[FaceFeatureExtractor] Using dlib backend (128-d embeddings)")
            return
        except ImportError:
            logger.warning("[FaceFeatureExtractor] face_recognition not available")

        logger.error("[FaceFeatureExtractor] No approved face embedding backend is available")

    def extract(self, face_image: np.ndarray) -> Optional[FaceEmbedding]:
        """Extract face embedding from a cropped face image (BGR)."""
        if face_image is None or face_image.size == 0:
            return None

        if self._backend == "dlib":
            return self._extract_dlib(face_image)
        return None

    def _extract_dlib(self, face_image: np.ndarray) -> Optional[FaceEmbedding]:
        rgb = cv2.cvtColor(face_image, cv2.COLOR_BGR2RGB)
        # Detect face locations in the crop (should find 1)
        locations = self._face_rec.face_locations(rgb, model="hog")
        if not locations:
            # Use full image as face region
            h, w = rgb.shape[:2]
            locations = [(0, w, h, 0)]

        encodings = self._face_rec.face_encodings(rgb, known_face_locations=locations)
        if not encodings:
            return None

        return FaceEmbedding(
            vector=np.array(encodings[0], dtype=np.float64),
            model="dlib",
        )


class FaceMatcher:
    """Compare two face images and determine if they match."""

    def __init__(self, match_threshold: float = 0.6):
        self.extractor = FaceFeatureExtractor()
        self.match_threshold = match_threshold

    def match(
        self,
        face_a: np.ndarray,
        face_b: np.ndarray,
        threshold: Optional[float] = None,
    ) -> MatchResult:
        """Compare two face images. Returns match result with confidence."""
        thresh = threshold or self.match_threshold

        emb_a = self.extractor.extract(face_a)
        emb_b = self.extractor.extract(face_b)

        if emb_a is None or emb_b is None:
            return MatchResult(
                similarity=0.0,
                distance=999.0,
                is_match=False,
                threshold=thresh,
                confidence=0.0,
                embedding_model="none",
            )

        # Euclidean distance
        distance = float(np.linalg.norm(emb_a.vector - emb_b.vector))

        # dlib embeddings use Euclidean distance; lower values represent a closer match.
        max_dist = 1.2
        similarity = max(0.0, 1.0 - (distance / max_dist))
        is_match = distance < thresh

        # Calibrate confidence (0-100 scale)
        confidence = _calibrate_confidence(similarity, emb_a.model)

        return MatchResult(
            similarity=round(similarity, 4),
            distance=round(distance, 4),
            is_match=is_match,
            threshold=thresh,
            confidence=round(confidence, 2),
            embedding_model=emb_a.model,
        )

    def extract_embedding(self, face_image: np.ndarray) -> Optional[FaceEmbedding]:
        """Extract embedding for storage/later comparison."""
        return self.extractor.extract(face_image)


def _calibrate_confidence(similarity: float, model: str) -> float:
    """Convert raw similarity to calibrated confidence score (0-100)."""
    if model == "dlib":
        # dlib similarity 0.5 → ~50%, 0.7 → ~80%, 0.9 → ~98%
        if similarity >= 0.9:
            return 95 + (similarity - 0.9) * 50
        elif similarity >= 0.7:
            return 70 + (similarity - 0.7) * 125
        elif similarity >= 0.5:
            return 40 + (similarity - 0.5) * 150
        else:
            return similarity * 80
    return 0.0
