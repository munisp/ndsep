/**
 * Adaptive Bandwidth Detection & Management
 * ============================================
 * Optimizes platform behavior for low-bandwidth environments.
 * Designed specifically for rural African deployments where connectivity
 * is unreliable and expensive.
 *
 * Features:
 * - Network quality detection (effective type, downlink, RTT)
 * - Adaptive image quality (lower resolution on slow connections)
 * - Request priority management (critical data first)
 * - Data saver mode (reduces payload sizes)
 * - Bandwidth-aware polling intervals
 * - Connection quality scoring (0-100)
 */

export type ConnectionQuality = "excellent" | "good" | "fair" | "poor" | "offline";

export interface BandwidthProfile {
  quality: ConnectionQuality;
  score: number; // 0-100
  effectiveType: string; // "4g", "3g", "2g", "slow-2g"
  downlinkMbps: number;
  rttMs: number;
  saveData: boolean;
  pollingIntervalMs: number;
  maxPayloadKb: number;
  enableImages: boolean;
  enableAnimations: boolean;
  enableWebSocket: boolean;
  compressionLevel: "none" | "gzip" | "aggressive";
}

// ── Connection quality detection ────────────────────────────────────────────

function getNetworkInfo(): { effectiveType: string; downlink: number; rtt: number; saveData: boolean } {
  const nav = navigator as any;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;

  if (conn) {
    return {
      effectiveType: conn.effectiveType ?? "4g",
      downlink: conn.downlink ?? 10,
      rtt: conn.rtt ?? 50,
      saveData: conn.saveData ?? false,
    };
  }

  // Fallback: estimate from timing
  return {
    effectiveType: navigator.onLine ? "4g" : "offline",
    downlink: 10,
    rtt: 50,
    saveData: false,
  };
}

function calculateScore(effectiveType: string, downlink: number, rtt: number): number {
  let score = 50;

  // Effective type scoring
  const typeScores: Record<string, number> = {
    "4g": 40, "3g": 25, "2g": 10, "slow-2g": 0,
  };
  score = typeScores[effectiveType] ?? 30;

  // Downlink bonus/penalty
  if (downlink >= 10) score += 30;
  else if (downlink >= 5) score += 20;
  else if (downlink >= 1) score += 10;
  else if (downlink >= 0.5) score += 5;

  // RTT penalty
  if (rtt < 50) score += 30;
  else if (rtt < 100) score += 20;
  else if (rtt < 300) score += 10;
  else if (rtt < 1000) score += 0;
  else score -= 10;

  return Math.max(0, Math.min(100, score));
}

function getQuality(score: number): ConnectionQuality {
  if (!navigator.onLine) return "offline";
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 30) return "fair";
  return "poor";
}

// ── Bandwidth profile generator ─────────────────────────────────────────────

export function detectBandwidth(): BandwidthProfile {
  const { effectiveType, downlink, rtt, saveData } = getNetworkInfo();
  const score = calculateScore(effectiveType, downlink, rtt);
  const quality = getQuality(score);

  const profiles: Record<ConnectionQuality, Partial<BandwidthProfile>> = {
    excellent: {
      pollingIntervalMs: 5_000,
      maxPayloadKb: 5120,
      enableImages: true,
      enableAnimations: true,
      enableWebSocket: true,
      compressionLevel: "none",
    },
    good: {
      pollingIntervalMs: 15_000,
      maxPayloadKb: 2048,
      enableImages: true,
      enableAnimations: true,
      enableWebSocket: true,
      compressionLevel: "gzip",
    },
    fair: {
      pollingIntervalMs: 30_000,
      maxPayloadKb: 512,
      enableImages: false,
      enableAnimations: false,
      enableWebSocket: true,
      compressionLevel: "aggressive",
    },
    poor: {
      pollingIntervalMs: 60_000,
      maxPayloadKb: 128,
      enableImages: false,
      enableAnimations: false,
      enableWebSocket: false,
      compressionLevel: "aggressive",
    },
    offline: {
      pollingIntervalMs: 120_000,
      maxPayloadKb: 0,
      enableImages: false,
      enableAnimations: false,
      enableWebSocket: false,
      compressionLevel: "aggressive",
    },
  };

  const override = saveData ? {
    enableImages: false,
    enableAnimations: false,
    compressionLevel: "aggressive" as const,
    maxPayloadKb: 256,
  } : {};

  return {
    quality,
    score,
    effectiveType,
    downlinkMbps: downlink,
    rttMs: rtt,
    saveData,
    ...profiles[quality],
    ...override,
  } as BandwidthProfile;
}

// ── Bandwidth-aware fetch wrapper ───────────────────────────────────────────

export async function adaptiveFetch(
  url: string,
  options: RequestInit = {},
  priority: "critical" | "high" | "normal" | "low" = "normal"
): Promise<Response> {
  const profile = detectBandwidth();

  // Add compression headers
  const headers = new Headers(options.headers);
  if (profile.compressionLevel !== "none") {
    headers.set("Accept-Encoding", "gzip, deflate, br");
  }
  headers.set("X-Connection-Quality", profile.quality);
  headers.set("X-Request-Priority", priority);

  // Timeout based on connection quality
  const timeouts: Record<ConnectionQuality, number> = {
    excellent: 10_000,
    good: 15_000,
    fair: 30_000,
    poor: 60_000,
    offline: 5_000,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeouts[profile.quality]);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// ── Bandwidth change listener ───────────────────────────────────────────────

type BandwidthChangeCallback = (profile: BandwidthProfile) => void;
let bandwidthListeners: BandwidthChangeCallback[] = [];

export function onBandwidthChange(callback: BandwidthChangeCallback): () => void {
  bandwidthListeners.push(callback);

  // Listen to Network Information API changes
  const nav = navigator as any;
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;

  const handler = () => {
    const profile = detectBandwidth();
    for (const cb of bandwidthListeners) {
      try { cb(profile); } catch { /* non-fatal */ }
    }
  };

  if (conn) {
    conn.addEventListener("change", handler);
  }

  // Also listen to online/offline events
  window.addEventListener("online", handler);
  window.addEventListener("offline", handler);

  return () => {
    bandwidthListeners = bandwidthListeners.filter(cb => cb !== callback);
    if (conn) conn.removeEventListener("change", handler);
    window.removeEventListener("online", handler);
    window.removeEventListener("offline", handler);
  };
}
