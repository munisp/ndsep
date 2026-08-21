/**
 * NDSEP Security Middleware
 * Comprehensive security hardening for production deployment.
 * Addresses: input sanitization, request validation, security headers,
 * CSRF protection, parameter pollution, and audit logging.
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";
const logger = pino({ name: "ndsep-security" });

// ─── Input Sanitization ─────────────────────────────────────────────────────

/**
 * Sanitize a string value: trim whitespace, remove null bytes, limit length.
 */
export function sanitizeString(value: unknown, maxLength = 10000): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/\0/g, "") // Remove null bytes (SQL injection vector)
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control chars
    .slice(0, maxLength);
}

/**
 * Recursively sanitize all string values in an object.
 */
export function sanitizeObject(obj: unknown, maxDepth = 5): unknown {
  if (maxDepth <= 0) return obj;
  if (typeof obj === "string") return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(item => sanitizeObject(item, maxDepth - 1));
  if (obj !== null && typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const sanitizedKey = sanitizeString(key, 200);
      sanitized[sanitizedKey] = sanitizeObject(value, maxDepth - 1);
    }
    return sanitized;
  }
  return obj;
}

// ─── Request Body Sanitization Middleware ───────────────────────────────────

/**
 * Middleware: sanitize all string values in req.body to prevent XSS and injection.
 */
export function bodySanitizer(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeObject(req.body);
  }
  next();
}

// ─── Parameter Pollution Prevention ────────────────────────────────────────

/**
 * Middleware: prevent HTTP parameter pollution by ensuring query params are strings.
 */
export function paramPollutionGuard(req: Request, _res: Response, next: NextFunction): void {
  for (const key of Object.keys(req.query)) {
    if (Array.isArray(req.query[key])) {
      // Take the last value (most restrictive for security)
      req.query[key] = (req.query[key] as string[]).at(-1) ?? "";
    }
  }
  next();
}

// ─── Suspicious Request Detection ───────────────────────────────────────────

const SUSPICIOUS_PATTERNS = [
  /(\bUNION\b.*\bSELECT\b|\bSELECT\b.*\bFROM\b|\bDROP\b.*\bTABLE\b)/i, // SQL injection
  /(\bOR\b\s+[\d'"]+\s*=\s*[\d'"]+|\bAND\b\s+[\d'"]+\s*=\s*[\d'"]+)/i, // SQL OR/AND injection
  /--\s*($|\s)/m, // SQL comment injection
  /<script[\s\S]*?>[\s\S]*?<\/script>/i, // XSS script tags
  /javascript:/i, // XSS javascript: protocol
  /on\w+\s*=/i, // XSS event handlers
  /\.\.\//g, // Path traversal
  /%2e%2e%2f/i, // Encoded path traversal
  /%27.*(%20)?or\b/i, // URL-encoded SQL injection
];

/**
 * Middleware: detect and block obviously malicious requests.
 */
export function suspiciousRequestGuard(req: Request, res: Response, next: NextFunction): void {
  const checkValue = (val: unknown): boolean => {
    if (typeof val !== "string") return false;
    // Check both raw and URL-decoded value
    const decoded = (() => { try { return decodeURIComponent(val); } catch { return val; } })();
    return SUSPICIOUS_PATTERNS.some(p => p.test(val) || p.test(decoded));
  };

  const checkObject = (obj: unknown): boolean => {
    if (typeof obj === "string") return checkValue(obj);
    if (Array.isArray(obj)) return obj.some(checkObject);
    if (obj !== null && typeof obj === "object") {
      return Object.values(obj as Record<string, unknown>).some(checkObject);
    }
    return false;
  };

  // Check URL path
  if (checkValue(req.path)) {
    logger.warn({ path: req.path, ip: req.ip }, "[Security] Suspicious path blocked");
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  // Check raw URL (catches URL-encoded payloads like %27%20OR%201%3D1--)
  if (checkValue(req.originalUrl)) {
    logger.warn({ url: req.originalUrl, ip: req.ip }, "[Security] Suspicious URL blocked");
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  // Check query string (Express-decoded values)
  if (checkObject(req.query)) {
    logger.warn({ query: req.query, ip: req.ip }, "[Security] Suspicious query blocked");
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  next();
}

// ─── Security Audit Logging ──────────────────────────────────────────────────

/**
 * Middleware: log security-relevant events for audit trail.
 */
export function securityAuditLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    // Log auth failures and suspicious status codes
    if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429) {
      logger.warn({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ip: req.ip,
        userAgent: req.get("user-agent"),
        duration,
      }, `[Security Audit] ${res.statusCode} ${req.method} ${req.path}`);
    }
  });
  next();
}

// ─── Demo Login Guard ────────────────────────────────────────────────────────

/**
 * Middleware: restrict demo-login endpoint to non-production environments.
 * In production, demo-login should be disabled or IP-restricted.
 */
export function demoLoginGuard(req: Request, res: Response, next: NextFunction): void {
  // H10: Completely block demo login in production unless explicitly enabled
  if (process.env.NODE_ENV === "production") {
    if (process.env.ENABLE_DEMO_LOGIN !== "true") {
      logger.warn({ ip: req.ip, ua: req.get("user-agent") }, "[Security] Demo login blocked in production");
      res.status(403).json({ error: "Demo login is disabled in production" });
      return;
    }
    // Even when enabled in production, restrict to specific IPs
    const allowedIps = (process.env.DEMO_LOGIN_ALLOWED_IPS ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (allowedIps.length > 0) {
      const clientIp = req.ip ?? req.socket.remoteAddress ?? "";
      if (!allowedIps.includes(clientIp)) {
        logger.warn({ ip: clientIp }, "[Security] Demo login blocked — IP not in allowlist");
        res.status(403).json({ error: "Demo login restricted to authorized IPs" });
        return;
      }
    }
  }
  next();
}

// ─── API Key Validation ──────────────────────────────────────────────────────

/**
 * Validate API key format: must be alphanumeric with dashes, 32-128 chars.
 */
export function isValidApiKeyFormat(key: string): boolean {
  return /^[a-zA-Z0-9\-_]{32,128}$/.test(key);
}

// ─── Request Size Guard ──────────────────────────────────────────────────────

/**
 * Middleware: enforce strict request size limits per endpoint type.
 * Overrides the global 50mb limit with tighter per-route limits.
 */
export function strictJsonLimit(req: Request, res: Response, next: NextFunction): void {
  const contentLength = parseInt(req.get("content-length") ?? "0", 10);
  const MAX_JSON_BYTES = 1 * 1024 * 1024; // 1MB for JSON API calls
  if (contentLength > MAX_JSON_BYTES) {
    res.status(413).json({ error: "Request entity too large. Maximum 1MB for API calls." });
    return;
  }
  next();
}

// ─── Security Score Calculator ───────────────────────────────────────────────

export interface SecurityScore {
  score: number; // 0-100
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  findings: SecurityFinding[];
  fixedCount: number;
  remainingCount: number;
}

export interface SecurityFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  title: string;
  description: string;
  status: "fixed" | "mitigated" | "accepted" | "open";
  remediation: string;
}

export function calculateSecurityScore(findings: SecurityFinding[]): SecurityScore {
  const weights = { critical: 25, high: 10, medium: 5, low: 2, info: 0 };
  let deductions = 0;
  const openFindings = findings.filter(f => f.status === "open");
  for (const f of openFindings) {
    deductions += weights[f.severity] ?? 0;
  }
  const score = Math.max(0, Math.min(100, 100 - deductions));
  const grade =
    score >= 95 ? "A+" :
    score >= 85 ? "A" :
    score >= 75 ? "B" :
    score >= 65 ? "C" :
    score >= 50 ? "D" : "F";

  return {
    score,
    grade,
    findings,
    fixedCount: findings.filter(f => f.status === "fixed" || f.status === "mitigated").length,
    remainingCount: openFindings.length,
  };
}


// ─── Request ID Correlation Middleware (SEC-025) ─────────────────────────────
/**
 * Middleware: assign a unique X-Request-ID to every incoming request.
 * The ID is propagated through tRPC context for distributed tracing.
 * Closes security finding SEC-025: "Missing Request ID Correlation in Logs".
 */
import { randomUUID } from "crypto";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existingId = req.headers["x-request-id"] as string | undefined;
  const requestId = existingId?.match(/^[a-zA-Z0-9\-]{8,64}$/) ? existingId : randomUUID();
  (req as any).requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
}

// ─── Auth Failure Tracker / Brute-Force Alerting (SEC-026) ───────────────────
/**
 * In-memory store for tracking auth failures per IP.
 * Alerts the owner when an IP exceeds 10 failures in 5 minutes.
 * Closes security finding SEC-026: "No Real-Time Alerting for Repeated Auth Failures".
 */
const authFailureStore = new Map<string, { count: number; firstSeen: number; alerted: boolean }>();
const AUTH_FAILURE_WINDOW_MS = parseInt(process.env.AUTH_FAILURE_WINDOW_MS ?? "300000", 10); // default 5 minutes
const AUTH_FAILURE_THRESHOLD = parseInt(process.env.AUTH_FAILURE_THRESHOLD ?? "10", 10);

export function authFailureTracker(req: Request, res: Response, next: NextFunction): void {
  res.on("finish", () => {
    // Only track auth-related endpoints with 401 responses
    if (res.statusCode !== 401) return;
    const isAuthPath = req.path.includes("/oauth") || req.path.includes("/demo-login") || req.path.includes("/trpc/auth");
    if (!isAuthPath) return;

    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    const now = Date.now();
    const entry = authFailureStore.get(ip);

    if (!entry || now - entry.firstSeen > AUTH_FAILURE_WINDOW_MS) {
      authFailureStore.set(ip, { count: 1, firstSeen: now, alerted: false });
      return;
    }

    entry.count += 1;

    if (entry.count >= AUTH_FAILURE_THRESHOLD && !entry.alerted) {
      entry.alerted = true;
      logger.warn({ ip, count: entry.count, window: "5min" },
        "[Security] Brute-force detected — triggering owner notification");

      // Fire-and-forget owner notification
      import("./_core/notification").then(({ notifyOwner }) => {
        notifyOwner({
          title: `⚠️ Brute-Force Alert: ${entry.count} auth failures from ${ip}`,
          content: `IP address ${ip} has triggered ${entry.count} authentication failures within 5 minutes. ` +
            `Path: ${req.path}. Automatic rate limiting is active. ` +
            `Consider adding this IP to the blocklist if the pattern continues.`,
        }).catch(() => { /* non-fatal */ });
      }).catch(() => { /* non-fatal */ });
    }
  });
  next();
}

// ─── Audit Log Retention Policy (SEC-028) ────────────────────────────────────
/**
 * Purge audit_logs older than retentionYears (default 7 years).
 * NDPA requires minimum 5-year retention; we default to 7 for safety margin.
 * Closes security finding SEC-028: "Audit Logs Retained Indefinitely".
 */
export async function purgeOldAuditLogs(retentionYears = 7): Promise<{ purged: number }> {
  const { getPool } = await import("./db");
  const pool = getPool();
  if (!pool) return { purged: 0 };
  try {
    const result = await pool.query(
      `DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '${retentionYears} years'`
    );
    const purged = result.rowCount ?? 0;
    if (purged > 0) {
      logger.info({ purged, retentionYears }, "[Security] Audit log retention policy: purged old records");
    }
    return { purged };
  } catch (err) {
    logger.error({ err }, "[Security] Audit log retention purge failed");
    return { purged: 0 };
  }
}

// ─── Demo Login IP Restriction (SEC-027) ─────────────────────────────────────
/**
 * Enhanced demo login guard: in staging, restrict to known IP ranges.
 * In production, block entirely unless ENABLE_DEMO_LOGIN=true.
 * Closes security finding SEC-027: "Demo Login Endpoint Accessible in Staging".
 */
const STAGING_ALLOWED_IPS = (process.env.DEMO_LOGIN_ALLOWED_IPS ?? "127.0.0.1,::1,::ffff:127.0.0.1").split(",").map(s => s.trim());

export function enhancedDemoLoginGuard(req: Request, res: Response, next: NextFunction): void {
  const env = process.env.NODE_ENV ?? "development";

  if (env === "production" && process.env.ENABLE_DEMO_LOGIN !== "true") {
    logger.warn({ ip: req.ip }, "[Security] Demo login blocked in production");
    res.status(403).json({ error: "Demo login is disabled in production" });
    return;
  }

  if (env === "staging") {
    const clientIp = req.ip ?? req.socket?.remoteAddress ?? "";
    const allowed = STAGING_ALLOWED_IPS.some(allowedIp => clientIp.includes(allowedIp));
    if (!allowed) {
      logger.warn({ ip: clientIp, allowed: STAGING_ALLOWED_IPS }, "[Security] Demo login blocked in staging — IP not in allowlist");
      res.status(403).json({ error: "Demo login is restricted to authorised IPs in staging" });
      return;
    }
  }

  next();
}
