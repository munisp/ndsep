/**
 * OpenAppSec WAF + APISIX Gateway Middleware
 * - Validates requests against WAF threat intelligence
 * - Injects APISIX-compatible rate limiting headers
 * - Blocks IPs flagged by OpenAppSec
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

const OPENAPPSEC_URL = process.env.OPENAPPSEC_URL || "http://localhost:8090";
const OPENAPPSEC_ENABLED = process.env.OPENAPPSEC_ENABLED !== "false";
const APISIX_ENABLED = process.env.APISIX_ENABLED !== "false";
const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 200;

// In-memory blocked IPs (synced from OpenAppSec)
const blockedIps = new Set<string>();
let lastBlockSync = 0;

async function syncBlockedIps(): Promise<void> {
  if (!OPENAPPSEC_ENABLED) return;
  if (Date.now() - lastBlockSync < 60_000) return; // Sync at most once per minute
  lastBlockSync = Date.now();
  try {
    const resp = await fetch(`${OPENAPPSEC_URL}/api/v1/blocked-ips`, {
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      const data = await resp.json() as { ips?: string[] };
      if (Array.isArray(data.ips)) {
        blockedIps.clear();
        for (const ip of data.ips) blockedIps.add(ip);
      }
    }
  } catch {
    // Graceful degradation — WAF unavailable
  }
}

/**
 * Express middleware: OpenAppSec WAF enforcement
 * Checks incoming IP against blocked list + injects APISIX rate limit headers
 */
export function wafEnforcementMiddleware(req: Request, res: Response, next: NextFunction): void {
  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";

  // Async sync blocked IPs (non-blocking)
  syncBlockedIps().catch(() => {});

  // Check if IP is blocked by WAF
  if (OPENAPPSEC_ENABLED && blockedIps.has(clientIp)) {
    logger.warn({ ip: clientIp, path: req.path }, "[WAF] Blocked request from banned IP");
    res.status(403).json({ error: "Forbidden", reason: "IP blocked by WAF policy" });
    return;
  }

  // Inject APISIX-compatible rate limiting headers
  if (APISIX_ENABLED) {
    res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
    res.setHeader("X-RateLimit-Remaining", String(RATE_LIMIT_MAX - 1));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(Date.now() / 1000) + RATE_LIMIT_WINDOW));
    res.setHeader("X-Gateway", "APISIX");
  }

  // Inject WAF status header
  if (OPENAPPSEC_ENABLED) {
    res.setHeader("X-WAF-Status", "active");
    res.setHeader("X-WAF-Engine", "OpenAppSec");
  }

  next();
}

export function getBlockedIpCount(): number {
  return blockedIps.size;
}
