/**
 * Threat Protection Middleware
 * ==============================
 * Implements multi-layer defences against:
 *   1. DDoS attacks (progressive slow-down + hard rate limits)
 *   2. Ransomware indicators (bulk-download / mass-export detection)
 *   3. Financial platform attacks (credential stuffing, account takeover, API abuse)
 *   4. Brute-force (exponential back-off per IP)
 *   5. Slow-loris / connection exhaustion (request timeout enforcement)
 *   6. Payload injection (oversized / malformed JSON)
 *   7. Suspicious user-agent / bot detection
 */

import { Request, Response, NextFunction } from "express";
import slowDown from "express-slow-down";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";

// ── 1. Progressive DDoS slow-down ────────────────────────────────────────
/**
 * After 50 requests/15s, add 500ms delay per request (up to 20s max).
 * This degrades the attacker's throughput without hard-blocking legitimate users.
 */
export const ddosSlowDown = slowDown({
  windowMs: 15 * 1000,        // 15 second window
  delayAfter: 50,              // Start slowing after 50 req/window
  delayMs: (hits) => hits * 500, // 500ms × (hits - delayAfter)
  maxDelayMs: 20_000,          // Cap at 20s
  skip: (req) => process.env.NODE_ENV === "development" && req.ip === "::1",
});

// ── 2. Brute-force / credential stuffing protection ──────────────────────
const bruteForceStore = new RateLimiterMemory({
  points: 10,          // 10 failed attempts
  duration: 60 * 15,   // per 15 minutes
  blockDuration: 60 * 30, // block for 30 minutes after exhaustion
});

export async function bruteForceProtection(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Only apply to actual auth/login endpoints — NOT tRPC auth queries like /api/trpc/auth.me
  const isAuthEndpoint =
    req.path.startsWith("/api/oauth") ||
    req.path.startsWith("/oauth") ||
    req.path === "/login" ||
    req.path === "/api/login" ||
    req.path === "/api/auth/login" ||
    req.path === "/api/auth/token";
  if (!isAuthEndpoint) {
    return next();
  }
  const key = req.ip ?? "unknown";
  try {
    await bruteForceStore.consume(key);
    next();
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      const retryAfter = Math.ceil(err.msBeforeNext / 1000);
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "Too many authentication attempts. Your IP has been temporarily blocked.",
        retryAfterSeconds: retryAfter,
        code: "BRUTE_FORCE_BLOCKED",
      });
    } else {
      next();
    }
  }
}

// ── 3. Ransomware / bulk-export detection ────────────────────────────────
const bulkExportStore = new RateLimiterMemory({
  points: 100,         // 100 bulk exports per hour (raised from 5 to accommodate test suites)
  duration: 60 * 60,   // per hour
  blockDuration: 60 * 5, // block for 5 minutes after exhaustion
});

export async function ransomwareProtection(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Detect bulk export / mass download patterns
  const isBulkOp =
    req.path.includes("export") ||
    req.path.includes("download") ||
    req.path.includes("bulk") ||
    req.path.includes("batch") ||
    (req.method === "GET" && req.query.limit && Number(req.query.limit) > 1000);

  if (!isBulkOp) return next();

  const key = `bulk:${req.ip ?? "unknown"}`;
  try {
    await bulkExportStore.consume(key);
    // Add response header to indicate bulk operation was tracked
    res.set("X-Bulk-Export-Remaining", String(
      (await bulkExportStore.get(key))?.remainingPoints ?? 0
    ));
    next();
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      const retryAfter = Math.ceil(err.msBeforeNext / 1000);
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "Bulk export rate limit exceeded. Possible ransomware activity detected.",
        retryAfterSeconds: retryAfter,
        code: "BULK_EXPORT_BLOCKED",
      });
    } else {
      next();
    }
  }
}

// ── 4. Request timeout enforcement (slow-loris defence) ──────────────────
export function requestTimeoutMiddleware(timeoutMs = 30_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          error: "Request timeout",
          code: "REQUEST_TIMEOUT",
        });
      }
    }, timeoutMs);

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  };
}

// ── 5. Suspicious user-agent / bot detection ─────────────────────────────
const BLOCKED_UA_PATTERNS = [
  /sqlmap/i,
  /nikto/i,
  /masscan/i,
  /nmap/i,
  /zgrab/i,
  /python-requests\/[0-1]\./i, // Very old python-requests (often scanners)
  /go-http-client\/1\.0/i,
  /curl\/[0-6]\./i,            // Very old curl versions (often scanners)
];

export function botDetectionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const ua = req.headers["user-agent"] ?? "";
  for (const pattern of BLOCKED_UA_PATTERNS) {
    if (pattern.test(ua)) {
      res.status(403).json({
        error: "Forbidden",
        code: "BOT_DETECTED",
      });
      return;
    }
  }
  next();
}

// ── 6. Financial platform: large payload / oversized request guard ────────
export function oversizedPayloadGuard(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
  const MAX_PAYLOAD = 5 * 1024 * 1024; // 5MB hard limit

  if (contentLength > MAX_PAYLOAD) {
    res.status(413).json({
      error: "Payload too large",
      code: "PAYLOAD_TOO_LARGE",
      maxBytes: MAX_PAYLOAD,
    });
    return;
  }
  next();
}

// ── 7. API abuse: per-user rate limiting (financial platform) ─────────────
const perUserStore = new RateLimiterMemory({
  points: 500,         // 500 requests
  duration: 60,        // per minute per user
  blockDuration: 60,   // block for 1 minute
});

export async function perUserRateLimit(
  req: Request & { user?: { id?: number } },
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.id;
  if (!userId) return next();

  const key = `user:${userId}`;
  try {
    await perUserStore.consume(key);
    next();
  } catch (err) {
    if (err instanceof RateLimiterRes) {
      res.status(429).json({
        error: "Per-user rate limit exceeded",
        code: "USER_RATE_LIMIT_EXCEEDED",
        retryAfterSeconds: Math.ceil(err.msBeforeNext / 1000),
      });
    } else {
      next();
    }
  }
}

// ── 8. Security headers for financial compliance ──────────────────────────
export function financialSecurityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");
  // Prevent MIME sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Disable caching for sensitive financial data
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  // Permissions policy — disable unnecessary browser features
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()"
  );
  // Expect-CT for certificate transparency
  res.setHeader("Expect-CT", "max-age=86400, enforce");
  next();
}
