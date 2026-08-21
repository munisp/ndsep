"""
Anti-Spoofing Classification Engine
=====================================
Detects presentation attacks using multi-modal analysis:

1. **LBP Texture Analysis** — Local Binary Patterns distinguish real skin
   micro-texture from printed/screen dot patterns.
2. **FFT Frequency Analysis** — Printed photos and screen replays introduce
   frequency-domain artifacts (moire, halftone dots, pixel grid).
3. **Color Space Analysis** — Real skin has specific YCrCb/HSV distributions
   that differ from reproductions.
4. **Reflection Analysis** — Screens and glossy prints produce specular
   highlights absent from real faces.
5. **Edge Density Analysis** — Paper/3D masks have different edge profiles
   than real faces.

Attack types detected:
  - Printed photo
  - Screen replay
  - Paper mask
  - 3D mask (silicone, resin)
  - Deepfake (see deepfake_detector.py)
  - High-quality photo
"""

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional

import cv2
import numpy as np

logger = logging.getLogger("liveness.anti_spoof")


class SpoofType(str, Enum):
    REAL = "real"
    PRINTED_PHOTO = "printed_photo"
    SCREEN_REPLAY = "screen_replay"
    PAPER_MASK = "paper_mask"
    THREE_D_MASK = "3d_mask"
    HIGH_QUALITY_PHOTO = "high_quality_photo"
    DEEPFAKE = "deepfake"
    UNKNOWN = "unknown"


@dataclass
class SpoofScore:
    """Individual anti-spoofing check result."""
    check_name: str
    score: float      # 0.0 (spoof) to 1.0 (real)
    weight: float     # importance weight
    details: str


@dataclass
class AntiSpoofResult:
    """Complete anti-spoofing analysis result."""
    is_real: bool
    overall_score: float          # 0-100 (100 = definitely real)
    spoof_type: SpoofType
    spoof_probability: float      # 0-1 (probability of being a spoof)
    checks: List[SpoofScore]
    attack_details: Dict[str, float]  # per-attack-type probabilities


class AntiSpoofClassifier:
    """Multi-modal anti-spoofing classifier."""

    def __init__(self, threshold: float = 0.55):
        self.threshold = threshold

    def classify(self, face_image: np.ndarray, full_image: Optional[np.ndarray] = None) -> AntiSpoofResult:
        """Run all anti-spoofing checks on a face image."""
        if face_image is None or face_image.size == 0:
            return AntiSpoofResult(
                is_real=False, overall_score=0.0, spoof_type=SpoofType.UNKNOWN,
                spoof_probability=1.0, checks=[], attack_details={},
            )

        # Ensure minimum size for analysis
        if face_image.shape[0] < 50 or face_image.shape[1] < 50:
            face_image = cv2.resize(face_image, (160, 160))

        checks = []

        # 1. LBP Texture Analysis
        lbp_score = self._analyze_lbp_texture(face_image)
        checks.append(SpoofScore("lbp_texture", lbp_score, 0.25,
                                 "Local Binary Pattern micro-texture analysis"))

        # 2. FFT Frequency Analysis
        fft_score = self._analyze_frequency(face_image)
        checks.append(SpoofScore("fft_frequency", fft_score, 0.20,
                                 "Frequency-domain artifact detection"))

        # 3. Color Space Analysis
        color_score = self._analyze_color_space(face_image)
        checks.append(SpoofScore("color_space", color_score, 0.20,
                                 "YCrCb/HSV skin color distribution"))

        # 4. Reflection / Specular Analysis
        reflection_score = self._analyze_reflections(face_image)
        checks.append(SpoofScore("reflection", reflection_score, 0.15,
                                 "Specular highlight and glare detection"))

        # 5. Edge Density Analysis
        edge_score = self._analyze_edge_density(face_image)
        checks.append(SpoofScore("edge_density", edge_score, 0.10,
                                 "Edge profile consistency"))

        # 6. Noise Pattern Analysis
        noise_score = self._analyze_noise_pattern(face_image)
        checks.append(SpoofScore("noise_pattern", noise_score, 0.10,
                                 "Sensor noise vs reproduction noise"))

        # Weighted average
        total_weight = sum(c.weight for c in checks)
        overall = sum(c.score * c.weight for c in checks) / total_weight if total_weight > 0 else 0
        spoof_prob = 1.0 - overall

        # Classify attack type
        attack_probs = self._estimate_attack_types(checks, face_image)
        spoof_type = self._determine_spoof_type(overall, attack_probs)

        return AntiSpoofResult(
            is_real=overall >= self.threshold,
            overall_score=round(overall * 100, 2),
            spoof_type=spoof_type,
            spoof_probability=round(spoof_prob, 4),
            checks=checks,
            attack_details=attack_probs,
        )

    def _analyze_lbp_texture(self, face: np.ndarray) -> float:
        """LBP texture analysis — real skin has irregular micro-patterns,
        printed photos have regular dot patterns, screens have pixel grids."""
        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape

        # Compute LBP
        lbp = np.zeros_like(gray, dtype=np.uint8)
        for dy, dx in [(-1, -1), (-1, 0), (-1, 1), (0, 1),
                       (1, 1), (1, 0), (1, -1), (0, -1)]:
            shifted = np.roll(np.roll(gray, dy, axis=0), dx, axis=1)
            lbp = (lbp << 1) | (shifted >= gray).astype(np.uint8)

        # Compute histogram of LBP values
        hist, _ = np.histogram(lbp[1:-1, 1:-1].ravel(), bins=256, range=(0, 256))
        hist = hist.astype(np.float64)
        hist_sum = hist.sum()
        if hist_sum > 0:
            hist /= hist_sum

        # Real faces have more uniform LBP distributions (higher entropy)
        # Printed/screen images have concentrated patterns (lower entropy)
        entropy = -np.sum(hist[hist > 0] * np.log2(hist[hist > 0]))
        max_entropy = np.log2(256)  # ~8.0

        # Variance of LBP — real faces have moderate variance
        lbp_var = float(np.var(lbp[1:-1, 1:-1].astype(np.float64)))

        # Score: entropy in [5.5, 7.5] and moderate variance → real
        entropy_score = min(1.0, entropy / (max_entropy * 0.85))
        var_score = 1.0 - abs(lbp_var - 3000) / 5000  # penalize extremes
        var_score = max(0.0, min(1.0, var_score))

        return 0.65 * entropy_score + 0.35 * var_score

    def _analyze_frequency(self, face: np.ndarray) -> float:
        """FFT frequency analysis — detect periodic artifacts from
        printing (halftone) or screen display (pixel grid, moire)."""
        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, (128, 128))

        # Compute 2D FFT
        f_transform = np.fft.fft2(gray.astype(np.float64))
        f_shift = np.fft.fftshift(f_transform)
        magnitude = np.log1p(np.abs(f_shift))

        # Analyze frequency distribution
        h, w = magnitude.shape
        cy, cx = h // 2, w // 2

        # Divide into frequency bands
        low_freq = magnitude[cy - 10:cy + 10, cx - 10:cx + 10].mean()
        mid_freq_ring = _ring_mean(magnitude, cy, cx, 15, 30)
        high_freq_ring = _ring_mean(magnitude, cy, cx, 35, 60)

        # Real faces: smooth frequency rolloff
        # Screen replay: peaks in mid-high frequency (pixel grid)
        # Printed photo: peaks from halftone pattern
        if low_freq > 0:
            mid_ratio = mid_freq_ring / low_freq
            high_ratio = high_freq_ring / low_freq
        else:
            mid_ratio = 0
            high_ratio = 0

        # Periodic peak detection (moire/halftone)
        # Look for strong periodic peaks in the frequency domain
        peak_threshold = magnitude.mean() + 2.5 * magnitude.std()
        peak_count = np.sum(magnitude > peak_threshold)
        peak_density = peak_count / magnitude.size

        # Real faces: mid_ratio in [0.3, 0.7], low peak density
        freq_score = 1.0
        if mid_ratio > 0.75:
            freq_score -= 0.3  # suspicious mid-frequency energy
        if high_ratio > 0.5:
            freq_score -= 0.3  # suspicious high-frequency energy
        if peak_density > 0.05:
            freq_score -= 0.2  # periodic artifacts detected

        return max(0.0, min(1.0, freq_score))

    def _analyze_color_space(self, face: np.ndarray) -> float:
        """Color space analysis — real skin has specific color distributions
        in YCrCb and HSV that differ from reproductions."""
        # Convert to YCrCb
        ycrcb = cv2.cvtColor(face, cv2.COLOR_BGR2YCrCb)
        cr = ycrcb[:, :, 1].astype(np.float64)
        cb = ycrcb[:, :, 2].astype(np.float64)

        # Real skin color ranges in YCrCb (empirical, cross-ethnicity)
        # Cr: 133-173, Cb: 77-127 for most skin tones
        cr_mean = cr.mean()
        cb_mean = cb.mean()
        cr_std = cr.std()
        cb_std = cb.std()

        # Check if color distribution is within skin range
        cr_in_range = 133 <= cr_mean <= 173
        cb_in_range = 77 <= cb_mean <= 127

        # Real skin has moderate color variance; reproductions tend to be flatter
        cr_var_normal = 8 <= cr_std <= 25
        cb_var_normal = 8 <= cb_std <= 25

        # HSV saturation analysis
        hsv = cv2.cvtColor(face, cv2.COLOR_BGR2HSV)
        sat = hsv[:, :, 1].astype(np.float64)
        sat_mean = sat.mean()
        sat_std = sat.std()

        # Real faces: moderate saturation with good variation
        # Printed photos: often over-saturated or under-saturated
        # Screens: tend to have higher saturation
        sat_normal = 30 <= sat_mean <= 150

        score = 0.0
        if cr_in_range:
            score += 0.25
        if cb_in_range:
            score += 0.25
        if cr_var_normal:
            score += 0.15
        if cb_var_normal:
            score += 0.15
        if sat_normal:
            score += 0.20

        return min(1.0, score)

    def _analyze_reflections(self, face: np.ndarray) -> float:
        """Detect specular reflections from screens or glossy prints."""
        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)

        # Detect bright spots (specular highlights)
        _, bright = cv2.threshold(gray, 230, 255, cv2.THRESH_BINARY)
        bright_ratio = np.sum(bright > 0) / bright.size

        # Screens have large uniform bright areas; real faces have small highlights
        # Glossy prints have streaked reflections
        hsv = cv2.cvtColor(face, cv2.COLOR_BGR2HSV)
        val = hsv[:, :, 2].astype(np.float64)
        sat = hsv[:, :, 1].astype(np.float64)

        # Low saturation + high value = specular reflection
        specular_mask = (sat < 30) & (val > 200)
        specular_ratio = np.sum(specular_mask) / specular_mask.size

        # Score
        score = 1.0
        if bright_ratio > 0.15:
            score -= 0.4  # too many bright pixels
        if specular_ratio > 0.08:
            score -= 0.3  # specular reflection pattern
        if bright_ratio < 0.001:
            score -= 0.1  # no highlights at all is also suspicious (matte print)

        return max(0.0, min(1.0, score))

    def _analyze_edge_density(self, face: np.ndarray) -> float:
        """Edge density analysis — masks have different edge characteristics."""
        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (3, 3), 0)

        # Canny edge detection
        edges = cv2.Canny(gray, 50, 150)
        edge_density = np.sum(edges > 0) / edges.size

        # Laplacian variance (focus measure)
        lap = cv2.Laplacian(gray, cv2.CV_64F)
        lap_var = float(lap.var())

        # Real faces: moderate edge density (0.05-0.20), good focus
        # Paper masks: high edge density at boundaries, low internal detail
        # 3D masks: very smooth, low edge density
        score = 1.0
        if edge_density < 0.03:
            score -= 0.3  # too smooth (3D mask)
        elif edge_density > 0.25:
            score -= 0.3  # too many edges (paper mask boundary)

        if lap_var < 50:
            score -= 0.2  # blurry / out of focus
        elif lap_var > 2000:
            score -= 0.1  # over-sharpened (post-processing)

        return max(0.0, min(1.0, score))

    def _analyze_noise_pattern(self, face: np.ndarray) -> float:
        """Sensor noise analysis — real camera sensor noise differs from
        reproduction noise (print dots, screen sub-pixels)."""
        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY).astype(np.float64)

        # Extract noise by subtracting a smoothed version
        smooth = cv2.GaussianBlur(gray, (5, 5), 1.0)
        noise = gray - smooth

        # Noise statistics
        noise_std = float(noise.std())
        noise_skew = float(np.mean((noise / max(noise_std, 1e-6)) ** 3))

        # Real sensor noise: Gaussian-like (low skewness), moderate std
        # Print noise: structured, higher skewness
        # Screen noise: very low noise (digital-to-digital)
        score = 1.0
        if noise_std < 1.5:
            score -= 0.4  # too clean (screen replay or heavy processing)
        elif noise_std > 15:
            score -= 0.3  # too noisy (low quality print)
        if abs(noise_skew) > 1.5:
            score -= 0.2  # non-Gaussian noise (structured artifact)

        return max(0.0, min(1.0, score))

    def _estimate_attack_types(self, checks: List[SpoofScore], face: np.ndarray) -> Dict[str, float]:
        """Estimate probability of each attack type based on check results."""
        scores = {c.check_name: c.score for c in checks}

        lbp = scores.get("lbp_texture", 0.5)
        fft = scores.get("fft_frequency", 0.5)
        color = scores.get("color_space", 0.5)
        refl = scores.get("reflection", 0.5)
        edge = scores.get("edge_density", 0.5)
        noise = scores.get("noise_pattern", 0.5)

        return {
            "printed_photo": round(max(0, (1 - lbp) * 0.4 + (1 - fft) * 0.3 + (1 - noise) * 0.3), 3),
            "screen_replay": round(max(0, (1 - noise) * 0.35 + (1 - refl) * 0.3 + (1 - fft) * 0.35), 3),
            "paper_mask": round(max(0, (1 - edge) * 0.4 + (1 - color) * 0.3 + (1 - lbp) * 0.3), 3),
            "3d_mask": round(max(0, (1 - edge) * 0.35 + (1 - color) * 0.35 + (1 - noise) * 0.3), 3),
            "high_quality_photo": round(max(0, (1 - fft) * 0.3 + (1 - noise) * 0.4 + (1 - refl) * 0.3), 3),
        }

    def _determine_spoof_type(self, overall_score: float, attack_probs: Dict[str, float]) -> SpoofType:
        """Determine most likely spoof type."""
        if overall_score >= self.threshold:
            return SpoofType.REAL

        if not attack_probs:
            return SpoofType.UNKNOWN

        max_attack = max(attack_probs, key=lambda k: attack_probs[k])
        type_map = {
            "printed_photo": SpoofType.PRINTED_PHOTO,
            "screen_replay": SpoofType.SCREEN_REPLAY,
            "paper_mask": SpoofType.PAPER_MASK,
            "3d_mask": SpoofType.THREE_D_MASK,
            "high_quality_photo": SpoofType.HIGH_QUALITY_PHOTO,
        }
        return type_map.get(max_attack, SpoofType.UNKNOWN)


def _ring_mean(mag: np.ndarray, cy: int, cx: int, r_inner: int, r_outer: int) -> float:
    """Mean magnitude in an annular ring region."""
    y, x = np.ogrid[:mag.shape[0], :mag.shape[1]]
    dist = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    mask = (dist >= r_inner) & (dist < r_outer)
    vals = mag[mask]
    return float(vals.mean()) if vals.size > 0 else 0.0
