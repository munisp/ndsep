"""
Deepfake Detection Module
==========================
Detects AI-generated face manipulations using:

1. **Frequency Domain Analysis** — GAN-generated images have distinctive
   high-frequency artifacts from the upsampling/deconvolution process.
2. **Blending Boundary Detection** — Face swaps leave blending artifacts
   at the face-background boundary.
3. **Lighting Consistency** — Deepfakes often have inconsistent lighting
   between the face and surrounding context.
4. **Texture Consistency** — GAN artifacts create unnatural texture patterns
   especially in hair, teeth, and eye regions.
"""

import logging
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger("liveness.deepfake")


@dataclass
class DeepfakeResult:
    """Deepfake detection result."""
    is_deepfake: bool
    confidence: float            # 0-100
    deepfake_probability: float  # 0-1
    frequency_score: float       # 0-1 (1 = real)
    blending_score: float        # 0-1 (1 = real)
    lighting_score: float        # 0-1 (1 = real)
    texture_score: float         # 0-1 (1 = real)
    details: str


class DeepfakeDetector:
    """Detect deepfake/face-swap manipulations."""

    def __init__(self, threshold: float = 0.55):
        self.threshold = threshold

    def detect(
        self,
        face_image: np.ndarray,
        full_image: Optional[np.ndarray] = None,
        face_bbox: Optional[tuple] = None,
    ) -> DeepfakeResult:
        """Analyze an image for deepfake manipulation."""
        if face_image is None or face_image.size == 0:
            return DeepfakeResult(
                is_deepfake=False, confidence=0.0, deepfake_probability=1.0,
                frequency_score=0, blending_score=0, lighting_score=0,
                texture_score=0, details="No face image provided",
            )

        if face_image.shape[0] < 32 or face_image.shape[1] < 32:
            face_image = cv2.resize(face_image, (160, 160))

        # 1. Frequency domain analysis for GAN artifacts
        freq_score = self._analyze_gan_frequency(face_image)

        # 2. Blending boundary analysis
        blend_score = self._analyze_blending(face_image, full_image, face_bbox)

        # 3. Lighting consistency
        light_score = self._analyze_lighting(face_image, full_image, face_bbox)

        # 4. Texture consistency (GAN artifacts in hair/teeth/eyes)
        texture_score = self._analyze_texture(face_image)

        # Weighted combination
        overall = (
            freq_score * 0.35 +
            blend_score * 0.25 +
            light_score * 0.20 +
            texture_score * 0.20
        )

        deepfake_prob = 1.0 - overall
        is_deepfake = overall < self.threshold

        confidence = abs(overall - 0.5) * 200  # 0-100 calibrated

        details_parts = []
        if freq_score < 0.5:
            details_parts.append("GAN frequency artifacts detected")
        if blend_score < 0.5:
            details_parts.append("face-background blending anomaly")
        if light_score < 0.5:
            details_parts.append("lighting inconsistency")
        if texture_score < 0.5:
            details_parts.append("unnatural texture patterns")

        return DeepfakeResult(
            is_deepfake=is_deepfake,
            confidence=round(confidence, 2),
            deepfake_probability=round(deepfake_prob, 4),
            frequency_score=round(freq_score, 4),
            blending_score=round(blend_score, 4),
            lighting_score=round(light_score, 4),
            texture_score=round(texture_score, 4),
            details="; ".join(details_parts) if details_parts else "no deepfake indicators",
        )

    def _analyze_gan_frequency(self, face: np.ndarray) -> float:
        """Detect GAN upsampling artifacts in the frequency domain.
        GANs using transposed convolutions create checkerboard patterns
        visible in the FFT as periodic peaks."""
        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, (128, 128))

        # 2D FFT
        f = np.fft.fft2(gray.astype(np.float64))
        f_shift = np.fft.fftshift(f)
        mag = np.log1p(np.abs(f_shift))

        h, w = mag.shape
        cy, cx = h // 2, w // 2

        # Analyze azimuthal symmetry — GAN artifacts are often grid-aligned
        # Check for peaks at specific frequencies (upsampling artifacts)
        # Real images have smooth radial falloff; GANs have bumps

        # Radial profile
        radii = np.sqrt((np.arange(w) - cx) ** 2)
        radial_profile = np.zeros(w // 2)
        counts = np.zeros(w // 2)
        for r in range(w // 2):
            mask = (np.sqrt((np.arange(h)[:, None] - cy) ** 2 +
                           (np.arange(w)[None, :] - cx) ** 2) >= r) & \
                   (np.sqrt((np.arange(h)[:, None] - cy) ** 2 +
                           (np.arange(w)[None, :] - cx) ** 2) < r + 1)
            vals = mag[mask]
            if vals.size > 0:
                radial_profile[r] = vals.mean()
                counts[r] = vals.size

        # Check for non-monotonic bumps (GAN artifacts)
        if len(radial_profile) > 10:
            # Smooth the profile and look for deviations
            kernel_size = 5
            kernel = np.ones(kernel_size) / kernel_size
            smooth_profile = np.convolve(radial_profile, kernel, mode="same")
            deviation = np.abs(radial_profile - smooth_profile)
            # High-frequency region (outer 40%)
            hf_start = int(len(deviation) * 0.6)
            hf_deviation = deviation[hf_start:].mean() if hf_start < len(deviation) else 0

            # Real: low deviation; GAN: high deviation in HF
            if hf_deviation > 0.5:
                return max(0.0, 0.5 - (hf_deviation - 0.5) * 0.5)

        # Also check for grid-pattern peaks (at multiples of stride)
        # Corners of the FFT (diagonal high-frequency)
        corner_energy = (mag[0:10, 0:10].mean() + mag[0:10, -10:].mean() +
                        mag[-10:, 0:10].mean() + mag[-10:, -10:].mean()) / 4
        center_energy = mag[cy - 5:cy + 5, cx - 5:cx + 5].mean()

        corner_ratio = corner_energy / max(center_energy, 1e-6)
        if corner_ratio > 0.3:
            return max(0.2, 0.7 - corner_ratio)

        return min(1.0, 0.7 + (1 - corner_ratio) * 0.3)

    def _analyze_blending(
        self,
        face: np.ndarray,
        full_image: Optional[np.ndarray],
        bbox: Optional[tuple],
    ) -> float:
        """Detect face-background blending artifacts from face swaps."""
        if full_image is None or bbox is None:
            # Can only analyze face crop — check internal consistency
            return self._analyze_internal_blending(face)

        x, y, w, h = bbox
        # Extract boundary region (face edge)
        pad = max(5, int(min(w, h) * 0.05))
        x1, y1 = max(0, x - pad), max(0, y - pad)
        x2, y2 = min(full_image.shape[1], x + w + pad), min(full_image.shape[0], y + h + pad)

        boundary = full_image[y1:y2, x1:x2].copy()
        if boundary.size == 0:
            return 0.7

        # Analyze color transition at face boundary
        gray_bound = cv2.cvtColor(boundary, cv2.COLOR_BGR2GRAY).astype(np.float64)
        lap = cv2.Laplacian(gray_bound, cv2.CV_64F)

        # Face swap blending creates a visible seam with high Laplacian at boundary
        # Extract border pixels vs interior
        border_mask = np.zeros_like(gray_bound, dtype=bool)
        bw = min(3, gray_bound.shape[0] // 4, gray_bound.shape[1] // 4)
        border_mask[:bw, :] = True
        border_mask[-bw:, :] = True
        border_mask[:, :bw] = True
        border_mask[:, -bw:] = True

        border_lap = np.abs(lap[border_mask]).mean() if border_mask.any() else 0
        interior_lap = np.abs(lap[~border_mask]).mean() if (~border_mask).any() else 0

        # High border/interior ratio → blending seam detected
        ratio = border_lap / max(interior_lap, 1e-6)
        if ratio > 2.5:
            return max(0.1, 0.5 - (ratio - 2.5) * 0.1)
        elif ratio > 1.5:
            return 0.6
        return 0.85

    def _analyze_internal_blending(self, face: np.ndarray) -> float:
        """Check for blending artifacts within the face crop itself."""
        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY).astype(np.float64)
        h, w = gray.shape

        # Check for smooth-to-sharp transitions (blend boundary)
        lap = cv2.Laplacian(gray, cv2.CV_64F)
        # Divide face into regions
        mid_h, mid_w = h // 2, w // 2
        regions = [
            lap[:mid_h, :mid_w], lap[:mid_h, mid_w:],
            lap[mid_h:, :mid_w], lap[mid_h:, mid_w:],
        ]
        variances = [float(r.var()) for r in regions if r.size > 0]
        if len(variances) < 2:
            return 0.7

        # High variance ratio between regions → manipulation
        max_var = max(variances)
        min_var = min(variances) + 1e-6
        var_ratio = max_var / min_var

        if var_ratio > 5:
            return max(0.2, 0.6 - (var_ratio - 5) * 0.05)
        return min(1.0, 0.7 + (5 - var_ratio) * 0.06)

    def _analyze_lighting(
        self,
        face: np.ndarray,
        full_image: Optional[np.ndarray],
        bbox: Optional[tuple],
    ) -> float:
        """Check lighting consistency between face and surroundings."""
        # Analyze face lighting direction
        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY).astype(np.float64)
        h, w = gray.shape

        # Split face into left/right halves
        left_mean = gray[:, :w // 2].mean()
        right_mean = gray[:, w // 2:].mean()
        top_mean = gray[:h // 2, :].mean()
        bottom_mean = gray[h // 2:, :].mean()

        # Internal lighting consistency
        lr_ratio = abs(left_mean - right_mean) / max(left_mean + right_mean, 1)
        tb_ratio = abs(top_mean - bottom_mean) / max(top_mean + bottom_mean, 1)

        # Moderate asymmetry is natural; extreme is suspicious
        # But very symmetric is also suspicious (GAN-generated faces tend to be symmetric)
        score = 1.0
        if lr_ratio > 0.3:
            score -= 0.2  # extreme lighting asymmetry
        if lr_ratio < 0.01:
            score -= 0.1  # too symmetric (possible GAN)

        # Check against full image if available
        if full_image is not None and bbox is not None:
            x, y, bw, bh = bbox
            face_brightness = gray.mean()
            full_gray = cv2.cvtColor(full_image, cv2.COLOR_BGR2GRAY).astype(np.float64)
            bg_brightness = full_gray.mean()

            # Large brightness mismatch → inconsistent lighting (possible composite)
            bright_diff = abs(face_brightness - bg_brightness) / max(bg_brightness, 1)
            if bright_diff > 0.5:
                score -= 0.3

        return max(0.0, min(1.0, score))

    def _analyze_texture(self, face: np.ndarray) -> float:
        """Analyze texture consistency — GAN images have artifacts
        in fine details (hair strands, teeth, eye reflections)."""
        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape

        # Analyze fine texture using high-pass filter
        blur = cv2.GaussianBlur(gray.astype(np.float64), (7, 7), 2.0)
        high_freq = gray.astype(np.float64) - blur

        # Compute local standard deviation map
        local_std = cv2.blur((high_freq ** 2), (11, 11)) ** 0.5

        # GAN faces have unnaturally smooth regions interspersed with sharp transitions
        std_of_std = float(local_std.std())
        mean_of_std = float(local_std.mean())

        # Check for unnatural periodicity in texture
        if mean_of_std > 0:
            coefficient_of_variation = std_of_std / mean_of_std
        else:
            coefficient_of_variation = 0

        # Real faces: CV ~ 0.5-1.5
        # GAN faces: CV often > 2.0 or < 0.3
        score = 1.0
        if coefficient_of_variation > 2.0:
            score -= 0.3
        elif coefficient_of_variation < 0.3:
            score -= 0.2

        # Check for checkerboard pattern (GAN deconvolution artifact)
        # Sample small patches and check for alternating intensity
        patch_size = min(16, w // 4, h // 4)
        if patch_size >= 8:
            center_patch = high_freq[
                h // 2 - patch_size:h // 2 + patch_size,
                w // 2 - patch_size:w // 2 + patch_size,
            ]
            if center_patch.size > 0:
                # Check autocorrelation at stride 2 (checkerboard)
                even_vals = center_patch[::2, ::2].mean()
                odd_vals = center_patch[1::2, 1::2].mean()
                checker_diff = abs(even_vals - odd_vals)
                if checker_diff > 3.0:
                    score -= 0.2  # checkerboard pattern detected

        return max(0.0, min(1.0, score))
