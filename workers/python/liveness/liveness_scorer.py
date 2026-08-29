"""
Liveness Scoring Engine
========================
Combines all sub-modules into passive and active liveness scores.

Passive Liveness (single image):
  - Face detection + quality assessment
  - Anti-spoofing classification
  - Deepfake detection
  - Confidence scoring

Active Liveness (video/motion):
  - Blink detection (EAR threshold tracking)
  - Head pose change detection
  - Motion consistency analysis
  - Challenge-response verification
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import cv2
import numpy as np

from .anti_spoof import AntiSpoofClassifier, AntiSpoofResult
from .deepfake_detector import DeepfakeDetector, DeepfakeResult
from .face_detector import DetectionResult, FaceDetector, compute_landmark_features

logger = logging.getLogger("liveness.scorer")


@dataclass
class PassiveLivenessResult:
    """Complete passive liveness analysis (single image)."""
    is_live: bool
    liveness_score: float          # 0-100
    face_detected: bool
    face_count: int
    face_quality: float            # 0-100
    anti_spoof: Optional[AntiSpoofResult] = None
    deepfake: Optional[DeepfakeResult] = None
    detection: Optional[DetectionResult] = None
    landmarks_68: Optional[list] = None
    landmark_features: Optional[dict] = None
    processing_time_ms: float = 0.0
    details: str = ""


@dataclass
class ActiveLivenessResult:
    """Complete active liveness analysis (video/motion)."""
    is_live: bool
    liveness_score: float          # 0-100
    challenges_passed: int
    challenges_total: int
    blink_detected: bool
    head_movement_detected: bool
    motion_consistency: float      # 0-1
    frame_count: int
    anti_spoof: Optional[AntiSpoofResult] = None
    deepfake: Optional[DeepfakeResult] = None
    processing_time_ms: float = 0.0
    details: str = ""
    challenge_results: Dict[str, bool] = field(default_factory=dict)


class LivenessScorer:
    """Main liveness scoring engine."""

    # Thresholds
    PASSIVE_THRESHOLD = 60.0   # minimum score for passive liveness
    ACTIVE_THRESHOLD = 65.0    # minimum score for active liveness
    BLINK_EAR_THRESHOLD = 0.21  # EAR below this = blink
    HEAD_TURN_THRESHOLD = 0.15  # nose offset change for head turn

    def __init__(self):
        self.detector = FaceDetector(min_confidence=0.5, max_faces=1)
        self.anti_spoof = AntiSpoofClassifier(threshold=0.55)
        self.deepfake = DeepfakeDetector(threshold=0.55)

    def passive_liveness(self, image: np.ndarray) -> PassiveLivenessResult:
        """Analyze a single image for liveness."""
        t0 = time.monotonic()

        # 1. Face Detection
        detection = self.detector.detect(image)
        if detection.face_count == 0:
            return PassiveLivenessResult(
                is_live=False, liveness_score=0, face_detected=False,
                face_count=0, face_quality=0,
                processing_time_ms=(time.monotonic() - t0) * 1000,
                details="No face detected in image",
            )

        primary = detection.primary_face
        face_crop = primary.face_crop

        # 2. Face Quality Assessment
        face_quality = self._assess_face_quality(face_crop, primary.landmarks_68)

        # 3. Anti-Spoofing
        spoof_result = self.anti_spoof.classify(face_crop, image)

        # 4. Deepfake Detection
        df_result = self.deepfake.detect(face_crop, image, primary.bbox)

        # 5. Compute landmark features
        lm_features = None
        landmarks_list = None
        if primary.landmarks_68 is not None:
            lm_features = compute_landmark_features(primary.landmarks_68)
            landmarks_list = primary.landmarks_68.tolist()

        # 6. Combined Liveness Score
        #    40% anti-spoof + 25% deepfake + 20% face quality + 15% detection confidence
        combined = (
            spoof_result.overall_score * 0.40 +
            (1 - df_result.deepfake_probability) * 100 * 0.25 +
            face_quality * 0.20 +
            primary.confidence * 100 * 0.15
        )
        combined = max(0, min(100, combined))
        is_live = combined >= self.PASSIVE_THRESHOLD and spoof_result.is_real and not df_result.is_deepfake

        details_parts = []
        if not spoof_result.is_real:
            details_parts.append(f"spoof detected: {spoof_result.spoof_type.value}")
        if df_result.is_deepfake:
            details_parts.append(f"deepfake detected ({df_result.details})")
        if face_quality < 50:
            details_parts.append("low face quality")
        if not details_parts:
            details_parts.append("all checks passed")

        return PassiveLivenessResult(
            is_live=is_live,
            liveness_score=round(combined, 2),
            face_detected=True,
            face_count=detection.face_count,
            face_quality=round(face_quality, 2),
            anti_spoof=spoof_result,
            deepfake=df_result,
            detection=detection,
            landmarks_68=landmarks_list,
            landmark_features=lm_features,
            processing_time_ms=(time.monotonic() - t0) * 1000,
            details="; ".join(details_parts),
        )

    def active_liveness(
        self,
        frames: List[np.ndarray],
        challenges: Optional[List[str]] = None,
    ) -> ActiveLivenessResult:
        """Analyze a sequence of video frames for active liveness.

        Supported challenges: "blink", "turn_left", "turn_right", "nod", "open_mouth"
        """
        t0 = time.monotonic()
        if not frames:
            return ActiveLivenessResult(
                is_live=False, liveness_score=0, challenges_passed=0,
                challenges_total=0, blink_detected=False,
                head_movement_detected=False, motion_consistency=0,
                frame_count=0, processing_time_ms=0, details="No frames provided",
            )

        if challenges is None:
            challenges = ["blink", "turn_left"]

        # Process all frames
        frame_features = []
        ear_values = []
        nose_offsets_x = []
        nose_offsets_y = []
        mars = []

        for frame in frames:
            det = self.detector.detect(frame)
            if det.face_count == 0:
                continue

            primary = det.primary_face
            if primary.landmarks_68 is not None:
                features = compute_landmark_features(primary.landmarks_68)
                frame_features.append(features)
                ear_values.append(features.get("avg_ear", 0.3))
                nose_offsets_x.append(features.get("nose_offset_x", 0))
                nose_offsets_y.append(features.get("nose_offset_y", 0))
                mars.append(features.get("mar", 0))

        if len(frame_features) < 3:
            return ActiveLivenessResult(
                is_live=False, liveness_score=0, challenges_passed=0,
                challenges_total=len(challenges), blink_detected=False,
                head_movement_detected=False, motion_consistency=0,
                frame_count=len(frames),
                processing_time_ms=(time.monotonic() - t0) * 1000,
                details="Insufficient frames with detected faces",
            )

        # Check challenges
        challenge_results = {}

        # Blink detection: EAR should dip below threshold then recover
        blink_detected = False
        if "blink" in challenges:
            blink_detected = self._detect_blink(ear_values)
            challenge_results["blink"] = blink_detected

        # Head turn detection
        head_movement = False
        if "turn_left" in challenges:
            turned = self._detect_head_turn(nose_offsets_x, direction="left")
            challenge_results["turn_left"] = turned
            head_movement = head_movement or turned

        if "turn_right" in challenges:
            turned = self._detect_head_turn(nose_offsets_x, direction="right")
            challenge_results["turn_right"] = turned
            head_movement = head_movement or turned

        if "nod" in challenges:
            nodded = self._detect_nod(nose_offsets_y)
            challenge_results["nod"] = nodded
            head_movement = head_movement or nodded

        if "open_mouth" in challenges:
            opened = self._detect_mouth_open(mars)
            challenge_results["open_mouth"] = opened

        challenges_passed = sum(1 for v in challenge_results.values() if v)

        # Motion consistency — check that face position changes smoothly
        motion_consistency = self._compute_motion_consistency(nose_offsets_x, nose_offsets_y)

        # Anti-spoofing on middle frame
        mid_idx = len(frames) // 2
        mid_det = self.detector.detect(frames[mid_idx])
        spoof_result = None
        df_result = None
        if mid_det.face_count > 0:
            spoof_result = self.anti_spoof.classify(mid_det.primary_face.face_crop, frames[mid_idx])
            df_result = self.deepfake.detect(
                mid_det.primary_face.face_crop, frames[mid_idx], mid_det.primary_face.bbox
            )

        # Combined score
        challenge_score = (challenges_passed / len(challenges)) * 100 if challenges else 0
        motion_score = motion_consistency * 100
        spoof_score = spoof_result.overall_score if spoof_result else 0
        df_penalty = (df_result.deepfake_probability * 30) if df_result else 100

        combined = (
            challenge_score * 0.40 +
            motion_score * 0.20 +
            spoof_score * 0.40
        ) - df_penalty

        combined = max(0, min(100, combined))
        is_live = (
            combined >= self.ACTIVE_THRESHOLD and
            challenges_passed >= max(1, len(challenges) // 2) and
            spoof_result is not None and spoof_result.is_real and
            df_result is not None and not df_result.is_deepfake
        )

        return ActiveLivenessResult(
            is_live=is_live,
            liveness_score=round(combined, 2),
            challenges_passed=challenges_passed,
            challenges_total=len(challenges),
            blink_detected=blink_detected,
            head_movement_detected=head_movement,
            motion_consistency=round(motion_consistency, 4),
            frame_count=len(frames),
            anti_spoof=spoof_result,
            deepfake=df_result,
            processing_time_ms=(time.monotonic() - t0) * 1000,
            details=f"passed {challenges_passed}/{len(challenges)} challenges",
            challenge_results=challenge_results,
        )

    def _assess_face_quality(self, face_crop: np.ndarray, landmarks: Optional[np.ndarray]) -> float:
        """Assess face image quality (brightness, blur, size, pose)."""
        if face_crop is None or face_crop.size == 0:
            return 0

        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape

        # Size check (minimum 80x80 for reliable analysis)
        size_score = min(1.0, (h * w) / (80 * 80))

        # Brightness check
        brightness = gray.mean()
        if brightness < 40:
            bright_score = brightness / 40
        elif brightness > 220:
            bright_score = (255 - brightness) / 35
        else:
            bright_score = 1.0

        # Blur check (Laplacian variance)
        lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        blur_score = min(1.0, lap_var / 100)

        # Contrast check
        contrast = gray.std()
        contrast_score = min(1.0, contrast / 50)

        # Combine
        quality = (
            size_score * 0.25 +
            bright_score * 0.25 +
            blur_score * 0.30 +
            contrast_score * 0.20
        ) * 100

        return max(0, min(100, quality))

    def _detect_blink(self, ear_values: List[float]) -> bool:
        """Detect a blink from EAR time series."""
        if len(ear_values) < 5:
            return False

        # Find a dip below threshold that recovers
        below_count = 0
        was_above = False
        recovered = False

        for ear in ear_values:
            if ear >= 0.25:
                if below_count >= 2:
                    recovered = True
                was_above = True
                below_count = 0
            elif ear < self.BLINK_EAR_THRESHOLD:
                if was_above:
                    below_count += 1

        return recovered

    def _detect_head_turn(self, nose_offsets: List[float], direction: str) -> bool:
        """Detect head turn from nose offset time series."""
        if len(nose_offsets) < 3:
            return False

        min_offset = min(nose_offsets)
        max_offset = max(nose_offsets)
        delta = max_offset - min_offset

        if delta < self.HEAD_TURN_THRESHOLD:
            return False

        if direction == "left":
            return min_offset < -self.HEAD_TURN_THRESHOLD / 2
        elif direction == "right":
            return max_offset > self.HEAD_TURN_THRESHOLD / 2
        return False

    def _detect_nod(self, nose_offsets_y: List[float]) -> bool:
        """Detect a nod from vertical nose offset changes."""
        if len(nose_offsets_y) < 3:
            return False
        delta = max(nose_offsets_y) - min(nose_offsets_y)
        return delta > 0.1

    def _detect_mouth_open(self, mars: List[float]) -> bool:
        """Detect mouth opening from MAR time series."""
        if len(mars) < 3:
            return False
        return max(mars) > 0.5

    def _compute_motion_consistency(
        self, offsets_x: List[float], offsets_y: List[float]
    ) -> float:
        """Check that motion is smooth (not jerky/teleporting)."""
        if len(offsets_x) < 3:
            return 0.5

        dx = np.diff(offsets_x)
        dy = np.diff(offsets_y)

        # Smooth motion: small, consistent deltas
        # Teleporting (replay attack): sudden large jumps
        max_jump = max(np.max(np.abs(dx)), np.max(np.abs(dy)))
        avg_delta = (np.mean(np.abs(dx)) + np.mean(np.abs(dy))) / 2

        # Some motion is expected (not static)
        has_motion = avg_delta > 0.002

        # No teleporting
        no_teleport = max_jump < 0.3

        if has_motion and no_teleport:
            return min(1.0, 0.7 + avg_delta * 5)
        elif not has_motion:
            return 0.3  # static (possibly photo)
        else:
            return 0.2  # teleporting (possibly spliced video)

    def close(self):
        self.detector.close()
