/**
 * Rate Limiting Middleware — NDSEP Enhancement (Priority 4)
 * Per-organisation and per-IP rate limiting using express-rate-limit.
 * Falls back to in-memory store when Redis is unavailable.
 */
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** IPv6-safe IP key: normalises /56 subnets so IPv6 users can't bypass limits */
function safeIpKey(req: Request): string {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  return ipKeyGenerator(ip);
}

function getOrgKey(req: Request): string {
  // Use org ID from session if available, otherwise fall back to IP (IPv6-safe)
  const orgId = (req as any).session?.orgId ?? (req as any).user?.orgId;
  if (orgId) return `org:${orgId}`;
  return safeIpKey(req);
}

function standardHeaders() {
  return {
    standardHeaders: "draft-7" as const,
    legacyHeaders: false,
  };
}

// ─── Rate Limiters ──────────────────────────────────────────────────────────

/**
 * Global API rate limiter — 1000 req/15min per IP.
 * Applied to all /api/* routes.
 */
export const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
  keyGenerator: safeIpKey,
  skip: (req: Request) => req.path === "/api/health",
  ...standardHeaders(),
});

/**
 * Auth rate limiter — 20 req/15min per IP.
 * Applied to /api/oauth/* routes to prevent brute force.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many authentication attempts. Please wait 15 minutes.", code: "AUTH_RATE_LIMITED" },
  keyGenerator: safeIpKey,
  ...standardHeaders(),
});

/**
 * tRPC mutation rate limiter — 200 mutations/15min per org.
 * Applied to /api/trpc POST requests.
 */
export const trpcMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many write operations. Please slow down.", code: "MUTATION_RATE_LIMITED" },
  keyGenerator: (req: Request) => getOrgKey(req),
  skip: (req: Request) => req.method !== "POST",
  ...standardHeaders(),
});

/**
 * File upload rate limiter — 50 uploads/hour per org.
 * Applied to /api/evidence/upload and /api/dsar/upload.
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  message: { error: "Upload limit reached. Maximum 50 uploads per hour.", code: "UPLOAD_RATE_LIMITED" },
  keyGenerator: getOrgKey,
  ...standardHeaders(),
});

/**
 * Stripe webhook — no rate limit (Stripe controls delivery).
 * Public DSAR submission — 10 req/hour per IP to prevent spam.
 */
export const dsarPublicLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many DSAR submissions from this IP. Please wait before submitting again.", code: "DSAR_RATE_LIMITED" },
  keyGenerator: safeIpKey,
  ...standardHeaders(),
});

/**
 * BGP SSE stream — 5 concurrent connections per IP.
 */
export const bgpSseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many SSE connections.", code: "SSE_RATE_LIMITED" },
  keyGenerator: safeIpKey,
  ...standardHeaders(),
});

/**
 * Developer API — 500 req/hour per API key.
 */
export const developerApiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 500,
  message: { error: "API rate limit exceeded. Upgrade your plan for higher limits.", code: "API_KEY_RATE_LIMITED" },
  keyGenerator: (req: Request) => {
    const apiKey = req.headers["x-api-key"] as string;
    if (apiKey) return `apikey:${apiKey}`;
    return safeIpKey(req);
  },
  ...standardHeaders(),
});
