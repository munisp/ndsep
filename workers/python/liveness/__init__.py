"""
NDSEP Liveness Detection Engine
=================================
Full biometric verification pipeline:

Modules:
  - face_detector: Face detection with 68-point IBUG landmark extraction
  - face_matcher: 128-d feature embedding and similarity matching
  - anti_spoof: Multi-modal anti-spoofing classification (6 attack types)
  - deepfake_detector: GAN/deepfake manipulation detection
  - liveness_scorer: Combined passive + active liveness scoring

Attack types detected:
  - Printed photo
  - Screen replay
  - Paper mask
  - 3D mask (silicone/resin)
  - Deepfake (GAN-generated)
  - High-quality photo
"""

from .face_detector import FaceDetector, FaceDetection, DetectionResult, compute_landmark_features
from .face_matcher import FaceMatcher, FaceEmbedding, MatchResult
from .anti_spoof import AntiSpoofClassifier, AntiSpoofResult, SpoofType
from .deepfake_detector import DeepfakeDetector, DeepfakeResult
from .liveness_scorer import LivenessScorer, PassiveLivenessResult, ActiveLivenessResult

__all__ = [
    "FaceDetector", "FaceDetection", "DetectionResult", "compute_landmark_features",
    "FaceMatcher", "FaceEmbedding", "MatchResult",
    "AntiSpoofClassifier", "AntiSpoofResult", "SpoofType",
    "DeepfakeDetector", "DeepfakeResult",
    "LivenessScorer", "PassiveLivenessResult", "ActiveLivenessResult",
]
