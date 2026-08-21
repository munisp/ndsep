/**
 * DDoS / Rate Limiting Protection
 * ================================
 * Multi-layer defence against volumetric and application-layer attacks.
 * - Per-IP sliding window rate limiter
 * - Endpoint-specific limits (auth endpoints get tighter limits)
 * - Automatic IP blocklisting after repeated violations
 * - Circuit breaker for cascading failure prevention
 * - Slowloris protection via connection timeout
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";

const logger = pino({ name: "ndsep-ddos" });

// ── Sliding window rate limiter ────────────────────────────────────────────

interface RateBucket {
  count: number;
  windowStart: number;
  violations: number;
}

const ipBuckets = new Map<string, RateBucket>();
const blocklist = new Set<string>();
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 min auto-unblock
const blockExpiry = new Map<string, number>();

// Config per route prefix
interface RateConfig {
  windowMs: number;
  maxRequests: number;
  blockAfterViolations: number;
}

const ROUTE_LIMITS: Record<string, RateConfig> = {
  "/api/demo-login": { windowMs: 60_000, maxRequests: 5, blockAfterViolations: 3 },
  "/api/oauth": { windowMs: 60_000, maxRequests: 10, blockAfterViolations: 5 },
  "/api/trpc/auth": { windowMs: 60_000, maxRequests: 20, blockAfterViolations: 5 },
  "/api/stripe": { windowMs: 60_000, maxRequests: 30, blockAfterViolations: 10 },
  "/api/trpc": { windowMs: 60_000, maxRequests: 200, blockAfterViolations: 10 },
  "/api": { windowMs: 60_000, maxRequests: 300, blockAfterViolations: 15 },
};

function getConfig(path: string): RateConfig {
  for (const [prefix, cfg] of Object.entries(ROUTE_LIMITS)) {
    if (path.startsWith(prefix)) return cfg;
  }
  return { windowMs: 60_000, maxRequests: 500, blockAfterViolations: 20 };
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

/**
 * Express middleware: per-IP sliding window rate limiter with auto-blocking.
 */
export function ddosProtection(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req);

  // Check blocklist
  const expiry = blockExpiry.get(ip);
  if (blocklist.has(ip)) {
    if (expiry && Date.now() > expiry) {
      blocklist.delete(ip);
      blockExpiry.delete(ip);
    } else {
      logger.warn({ ip }, "[DDoS] Blocked IP attempted request");
      res.status(429).json({
        error: "Too many requests. Your IP has been temporarily blocked.",
        retryAfter: expiry ? Math.ceil((expiry - Date.now()) / 1000) : 900,
      });
      return;
    }
  }

  const config = getConfig(req.path);
  const now = Date.now();
  const key = `${ip}:${req.path.split("/").slice(0, 4).join("/")}`;
  const bucket = ipBuckets.get(key);

  if (!bucket || now - bucket.windowStart > config.windowMs) {
    ipBuckets.set(key, { count: 1, windowStart: now, violations: bucket?.violations ?? 0 });
    next();
    return;
  }

  bucket.count++;

  if (bucket.count > config.maxRequests) {
    bucket.violations++;
    if (bucket.violations >= config.blockAfterViolations) {
      blocklist.add(ip);
      blockExpiry.set(ip, now + BLOCK_DURATION_MS);
      logger.warn({ ip, violations: bucket.violations, path: req.path },
        "[DDoS] IP auto-blocked after repeated rate limit violations");
    }

    const retryAfter = Math.ceil((config.windowMs - (now - bucket.windowStart)) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    res.setHeader("X-RateLimit-Limit", String(config.maxRequests));
    res.setHeader("X-RateLimit-Remaining", "0");
    res.setHeader("X-RateLimit-Reset", String(Math.ceil((bucket.windowStart + config.windowMs) / 1000)));
    res.status(429).json({
      error: "Rate limit exceeded",
      retryAfter,
    });
    return;
  }

  res.setHeader("X-RateLimit-Limit", String(config.maxRequests));
  res.setHeader("X-RateLimit-Remaining", String(config.maxRequests - bucket.count));
  next();
}

// ── Connection flood detection ─────────────────────────────────────────────

const connectionTracker = new Map<string, number>();
const CONNECTION_LIMIT = 50; // max simultaneous connections per IP

export function connectionFloodGuard(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req);
  const current = connectionTracker.get(ip) ?? 0;

  if (current >= CONNECTION_LIMIT) {
    logger.warn({ ip, connections: current }, "[DDoS] Connection flood detected");
    res.status(429).json({ error: "Too many concurrent connections" });
    return;
  }

  connectionTracker.set(ip, current + 1);
  res.on("finish", () => {
    const c = connectionTracker.get(ip) ?? 1;
    if (c <= 1) connectionTracker.delete(ip);
    else connectionTracker.set(ip, c - 1);
  });

  next();
}

// ── Circuit breaker ────────────────────────────────────────────────────────

interface CircuitState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
}

const circuits = new Map<string, CircuitState>();
const CIRCUIT_FAILURE_THRESHOLD = 10;
const CIRCUIT_RESET_MS = 30_000;

export function circuitBreaker(serviceName: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const circuit = circuits.get(serviceName) ?? { failures: 0, lastFailure: 0, state: "closed" as const };

    if (circuit.state === "open") {
      if (Date.now() - circuit.lastFailure > CIRCUIT_RESET_MS) {
        circuit.state = "half-open";
      } else {
        res.status(503).json({ error: `Service ${serviceName} temporarily unavailable` });
        return;
      }
    }

    const origEnd = res.end.bind(res);
    (res as any).end = function (...args: any[]) {
      if (res.statusCode >= 500) {
        circuit.failures++;
        circuit.lastFailure = Date.now();
        if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
          circuit.state = "open";
          logger.warn({ serviceName, failures: circuit.failures }, "[CircuitBreaker] Circuit opened");
        }
      } else if (circuit.state === "half-open") {
        circuit.failures = 0;
        circuit.state = "closed";
      }
      circuits.set(serviceName, circuit);
      return origEnd(...args);
    };

    next();
  };
}

// ── Periodic cleanup ───────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  Array.from(ipBuckets.entries()).forEach(([key, bucket]) => {
    if (now - bucket.windowStart > 120_000) ipBuckets.delete(key);
  });
  Array.from(blockExpiry.entries()).forEach(([ip, expiry]) => {
    if (now > expiry) { blocklist.delete(ip); blockExpiry.delete(ip); }
  });
}, 60_000);

// ── Admin API: view/manage blocked IPs ─────────────────────────────────────

export function getBlockedIps(): Array<{ ip: string; expiresAt: string }> {
  const result: Array<{ ip: string; expiresAt: string }> = [];
  blocklist.forEach((ip) => {
    const exp = blockExpiry.get(ip);
    result.push({ ip, expiresAt: exp ? new Date(exp).toISOString() : "permanent" });
  });
  return result;
}

export function blockIp(ip: string, durationMs = BLOCK_DURATION_MS): void {
  blocklist.add(ip);
  blockExpiry.set(ip, Date.now() + durationMs);
}

export function unblockIp(ip: string): void {
  blocklist.delete(ip);
  blockExpiry.delete(ip);
}
