"""
Face Detection & 68-Point Landmark Extraction
==============================================
Uses MediaPipe FaceMesh for detection + landmark extraction.
Falls back to OpenCV Haar cascades if MediaPipe unavailable.

68-point landmark indices (IBUG convention) mapped from MediaPipe's 468 points.
"""

import logging
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger("liveness.face_detector")

# MediaPipe 468-point → IBUG 68-point landmark mapping
# These indices map MediaPipe FaceMesh landmarks to the classic 68-point model
MEDIAPIPE_TO_68 = [
    # Jawline (0-16): 17 points
    162, 234, 93, 132, 58, 172, 136, 150, 149, 176,
    148, 152, 377, 400, 378, 379, 365, 397, 288, 361,
    # (adjusted to 17 points for jawline)
    323, 454, 389,
    # Right eyebrow (17-21): 5 points
    70, 63, 105, 66, 107,
    # Left eyebrow (22-26): 5 points
    336, 296, 334, 293, 300,
    # Nose bridge (27-30): 4 points
    168, 6, 197, 195,
    # Nose bottom (31-35): 5 points
    5, 4, 1, 275, 440,
    # Right eye (36-41): 6 points
    33, 160, 158, 133, 153, 144,
    # Left eye (42-47): 6 points
    362, 385, 387, 263, 373, 380,
    # Outer lip (48-59): 12 points
    61, 39, 37, 0, 267, 269, 291, 405, 314, 17, 84, 181,
    # Inner lip (60-67): 8 points
    78, 82, 13, 312, 308, 317, 14, 87,
]


@dataclass
class FaceDetection:
    """Single face detection result."""
    bbox: Tuple[int, int, int, int]  # (x, y, w, h)
    confidence: float
    landmarks_68: Optional[np.ndarray] = None  # (68, 2) array
    landmarks_478: Optional[np.ndarray] = None  # full MediaPipe mesh
    face_crop: Optional[np.ndarray] = None


@dataclass
class DetectionResult:
    """Complete detection result for an image."""
    faces: List[FaceDetection] = field(default_factory=list)
    image_width: int = 0
    image_height: int = 0
    processing_time_ms: float = 0.0

    @property
    def face_count(self) -> int:
        return len(self.faces)

    @property
    def primary_face(self) -> Optional[FaceDetection]:
        if not self.faces:
            return None
        return max(self.faces, key=lambda f: f.bbox[2] * f.bbox[3])


class FaceDetector:
    """Production face detector with MediaPipe + OpenCV fallback."""

    def __init__(self, min_confidence: float = 0.5, max_faces: int = 5):
        self.min_confidence = min_confidence
        self.max_faces = max_faces
        self._mp_landmarker = None
        self._haar_cascade = None
        self._backend = "none"
        self._init_backends()

    def _init_backends(self):
        # Try MediaPipe Tasks API first (0.10.14+)
        try:
            import mediapipe as mp
            import os

            model_path = os.environ.get(
                "FACE_LANDMARKER_MODEL",
                os.path.expanduser("~/.mediapipe/face_landmarker.task"),
            )
            if not os.path.exists(model_path):
                # Try to download the model
                import urllib.request
                os.makedirs(os.path.dirname(model_path), exist_ok=True)
                url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
                urllib.request.urlretrieve(url, model_path)
                logger.info(f"[FaceDetector] Downloaded face_landmarker model to {model_path}")

            base_options = mp.tasks.BaseOptions(model_asset_path=model_path)
            options = mp.tasks.vision.FaceLandmarkerOptions(
                base_options=base_options,
                running_mode=mp.tasks.vision.RunningMode.IMAGE,
                num_faces=self.max_faces,
                min_face_detection_confidence=self.min_confidence,
                min_face_presence_confidence=self.min_confidence,
                output_face_blendshapes=False,
                output_facial_transformation_matrixes=False,
            )
            self._mp_landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)
            self._backend = "mediapipe"
            logger.info("[FaceDetector] Using MediaPipe FaceLandmarker Tasks API (478 landmarks)")
        except (ImportError, Exception) as e:
            logger.warning(f"[FaceDetector] MediaPipe not available ({e}), trying OpenCV Haar")

        # Fallback to OpenCV Haar cascade
        if self._backend == "none":
            cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            self._haar_cascade = cv2.CascadeClassifier(cascade_path)
            if not self._haar_cascade.empty():
                self._backend = "haar"
                logger.info("[FaceDetector] Using OpenCV Haar cascade backend (no landmarks)")
            else:
                logger.error("[FaceDetector] No face detection backend available")

    def detect(self, image: np.ndarray) -> DetectionResult:
        """Detect faces in an image (BGR format)."""
        import time
        t0 = time.monotonic()
        h, w = image.shape[:2]
        result = DetectionResult(image_width=w, image_height=h)

        if self._backend == "mediapipe":
            result.faces = self._detect_mediapipe(image, w, h)
        elif self._backend == "haar":
            result.faces = self._detect_haar(image, w, h)

        result.processing_time_ms = (time.monotonic() - t0) * 1000
        return result

    def _detect_mediapipe(self, image: np.ndarray, w: int, h: int) -> List[FaceDetection]:
        import mediapipe as mp

        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        results = self._mp_landmarker.detect(mp_image)
        faces = []

        if not results.face_landmarks:
            return faces

        for face_landmarks in results.face_landmarks:
            # Extract all landmarks as pixel coordinates
            pts_all = np.array([
                (int(lm.x * w), int(lm.y * h))
                for lm in face_landmarks
            ], dtype=np.int32)

            # Compute bounding box from landmarks
            x_min, y_min = pts_all.min(axis=0)
            x_max, y_max = pts_all.max(axis=0)
            pad = int(max(x_max - x_min, y_max - y_min) * 0.1)
            x_min = max(0, x_min - pad)
            y_min = max(0, y_min - pad)
            x_max = min(w, x_max + pad)
            y_max = min(h, y_max + pad)
            bbox = (x_min, y_min, x_max - x_min, y_max - y_min)

            # Extract 68-point landmarks (IBUG convention)
            pts_68 = np.array([
                pts_all[min(idx, len(pts_all) - 1)]
                for idx in MEDIAPIPE_TO_68[:68]
            ], dtype=np.int32)

            # Crop face region
            face_crop = image[y_min:y_max, x_min:x_max].copy() if y_max > y_min and x_max > x_min else None

            faces.append(FaceDetection(
                bbox=bbox,
                confidence=0.95,
                landmarks_68=pts_68,
                landmarks_478=pts_all,
                face_crop=face_crop,
            ))

        return faces

    def _detect_haar(self, image: np.ndarray, w: int, h: int) -> List[FaceDetection]:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        rects = self._haar_cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60)
        )
        faces = []
        for (x, y, fw, fh) in rects[:self.max_faces]:
            face_crop = image[y:y + fh, x:x + fw].copy()
            faces.append(FaceDetection(
                bbox=(x, y, fw, fh),
                confidence=0.80,
                landmarks_68=None,
                face_crop=face_crop,
            ))
        return faces

    def close(self):
        if hasattr(self, '_mp_landmarker') and self._mp_landmarker:
            self._mp_landmarker.close()


def compute_landmark_features(landmarks_68: np.ndarray) -> dict:
    """Extract geometric features from 68-point landmarks for downstream analysis."""
    if landmarks_68 is None or len(landmarks_68) < 68:
        return {}

    # Eye aspect ratios (EAR) - used for blink detection in active liveness
    def eye_aspect_ratio(eye_pts):
        v1 = np.linalg.norm(eye_pts[1] - eye_pts[5])
        v2 = np.linalg.norm(eye_pts[2] - eye_pts[4])
        h = np.linalg.norm(eye_pts[0] - eye_pts[3])
        return (v1 + v2) / (2.0 * h) if h > 0 else 0

    right_eye = landmarks_68[36:42]
    left_eye = landmarks_68[42:48]
    right_ear = eye_aspect_ratio(right_eye)
    left_ear = eye_aspect_ratio(left_eye)

    # Mouth aspect ratio (MAR) - used for mouth-open challenge
    mouth_outer = landmarks_68[48:60]
    v1 = np.linalg.norm(mouth_outer[3] - mouth_outer[9])
    h1 = np.linalg.norm(mouth_outer[0] - mouth_outer[6])
    mar = v1 / h1 if h1 > 0 else 0

    # Inter-pupillary distance (IPD) — normalized by face width
    right_eye_center = right_eye.mean(axis=0)
    left_eye_center = left_eye.mean(axis=0)
    ipd = np.linalg.norm(right_eye_center - left_eye_center)

    # Head pose estimation via nose-to-eye-center ratio
    nose_tip = landmarks_68[30]
    eye_center = (right_eye_center + left_eye_center) / 2
    nose_offset_x = (nose_tip[0] - eye_center[0]) / ipd if ipd > 0 else 0
    nose_offset_y = (nose_tip[1] - eye_center[1]) / ipd if ipd > 0 else 0

    return {
        "right_ear": float(right_ear),
        "left_ear": float(left_ear),
        "avg_ear": float((right_ear + left_ear) / 2),
        "mar": float(mar),
        "ipd": float(ipd),
        "nose_offset_x": float(nose_offset_x),
        "nose_offset_y": float(nose_offset_y),
        "right_eye_center": right_eye_center.tolist(),
        "left_eye_center": left_eye_center.tolist(),
        "nose_tip": nose_tip.tolist(),
    }
