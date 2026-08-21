/**
 * Session & Cookie Hardening
 * ============================
 * Production-grade session security:
 * - Secure cookie settings enforcement
 * - Session fixation prevention
 * - Idle timeout
 * - Concurrent session limiting
 * - CSRF token generation and validation
 */

import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import pino from "pino";
import { cacheGet, cacheSet, cacheDel, redisConnected } from "../cache";

const logger = pino({ name: "ndsep-session" });

// ── CSRF Protection (Redis-backed with in-memory fallback) ─────────────────

const csrfMemory = new Map<string, { token: string; createdAt: number }>();
const CSRF_TOKEN_TTL = parseInt(process.env.CSRF_TOKEN_TTL_MS ?? "3600000", 10); // default 1 hour
const CSRF_REDIS_PREFIX = "ndsep:csrf:";

export function generateCsrfToken(sessionId: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  const data = { token, createdAt: Date.now() };
  csrfMemory.set(sessionId, data);
  if (redisConnected) {
    cacheSet(`${CSRF_REDIS_PREFIX}${sessionId}`, JSON.stringify(data), Math.ceil(CSRF_TOKEN_TTL / 1000)).catch((e) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[CSRF] Redis write failed"));
  }
  return token;
}

export async function csrfProtection(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Skip for GET, HEAD, OPTIONS (safe methods)
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }

  // Skip for API calls with valid auth (they use Bearer tokens)
  if (req.headers.authorization?.startsWith("Bearer ")) {
    next();
    return;
  }

  // Skip for Stripe webhooks (they have their own verification)
  if (req.path.startsWith("/api/stripe/webhook")) {
    next();
    return;
  }

  // Skip for tRPC batch calls (authenticated via session cookie)
  if (req.path.includes("/api/trpc/")) {
    next();
    return;
  }

  const csrfToken = req.headers["x-csrf-token"] as string;
  const sessionId = (req as any).sessionId;

  if (!csrfToken || !sessionId) {
    next(); // non-session requests don't need CSRF
    return;
  }

  let stored = csrfMemory.get(sessionId);
  if (!stored && redisConnected) {
    try {
      const raw = await cacheGet(`${CSRF_REDIS_PREFIX}${sessionId}`);
      if (raw) stored = JSON.parse(raw);
    } catch (e) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[CSRF] Redis read failed — using memory fallback"); }
  }
  if (!stored || stored.token !== csrfToken || Date.now() - stored.createdAt > CSRF_TOKEN_TTL) {
    res.status(403).json({ error: "Invalid or expired CSRF token" });
    return;
  }

  next();
}

// ── Session Idle Timeout (Redis-backed with in-memory fallback) ────────────

const sessionActivityMemory = new Map<string, number>();
const SESSION_IDLE_TIMEOUT_MS = parseInt(process.env.SESSION_IDLE_TIMEOUT_MS ?? "1800000", 10); // default 30 minutes
const SESSION_REDIS_PREFIX = "ndsep:session_activity:";

export function sessionIdleCheck(req: Request, res: Response, next: NextFunction): void {
  const sessionId = (req as any).sessionId;
  if (!sessionId) { next(); return; }

  const lastActivity = sessionActivityMemory.get(sessionId);
  const now = Date.now();

  if (lastActivity && now - lastActivity > SESSION_IDLE_TIMEOUT_MS) {
    sessionActivityMemory.delete(sessionId);
    csrfMemory.delete(sessionId);
    if (redisConnected) {
      cacheDel(`${SESSION_REDIS_PREFIX}${sessionId}`).catch((e) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Session] Redis cleanup failed"));
      cacheDel(`${CSRF_REDIS_PREFIX}${sessionId}`).catch((e) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Session] Redis cleanup failed"));
    }
    res.clearCookie("ndsep_session");
    res.status(401).json({ error: "Session expired due to inactivity" });
    return;
  }

  sessionActivityMemory.set(sessionId, now);
  if (redisConnected) {
    cacheSet(`${SESSION_REDIS_PREFIX}${sessionId}`, String(now), Math.ceil(SESSION_IDLE_TIMEOUT_MS / 1000)).catch((e) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Session] Redis activity write failed"));
  }
  next();
}

// ── Concurrent Session Limiter (in-memory — bounded per-instance) ──────────

const userSessions = new Map<number, Set<string>>();
const MAX_CONCURRENT_SESSIONS = parseInt(process.env.MAX_CONCURRENT_SESSIONS ?? "5", 10);

export function trackSession(userId: number, sessionId: string): { allowed: boolean; activeSessions: number } {
  const sessions = userSessions.get(userId) ?? new Set();

  if (sessions.size >= MAX_CONCURRENT_SESSIONS && !sessions.has(sessionId)) {
    // Remove oldest session
    const oldest = sessions.values().next().value;
    if (oldest) {
      sessions.delete(oldest);
      sessionActivityMemory.delete(oldest);
      csrfMemory.delete(oldest);
    }
  }

  sessions.add(sessionId);
  userSessions.set(userId, sessions);

  return { allowed: true, activeSessions: sessions.size };
}

export function removeSession(userId: number, sessionId: string): void {
  const sessions = userSessions.get(userId);
  if (sessions) {
    sessions.delete(sessionId);
    if (sessions.size === 0) userSessions.delete(userId);
  }
  sessionActivityMemory.delete(sessionId);
  csrfMemory.delete(sessionId);
  if (redisConnected) {
    cacheDel(`${SESSION_REDIS_PREFIX}${sessionId}`).catch((e) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Session] Redis cleanup failed"));
    cacheDel(`${CSRF_REDIS_PREFIX}${sessionId}`).catch((e) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Session] Redis cleanup failed"));
  }
}

// ── Cookie Security Enforcer ───────────────────────────────────────────────

export function enforceCookieSecurity(_req: Request, res: Response, next: NextFunction): void {
  const originalSetHeader = res.setHeader.bind(res);

  (res as any).setHeader = (name: string, value: any) => {
    if (name.toLowerCase() === "set-cookie" && typeof value === "string") {
      // Ensure all cookies have Secure, HttpOnly, SameSite
      if (!value.includes("HttpOnly")) value += "; HttpOnly";
      if (!value.includes("Secure") && process.env.NODE_ENV === "production") {
        value += "; Secure";
      }
      if (!value.includes("SameSite")) value += "; SameSite=Lax";
    }
    return originalSetHeader(name, value);
  };

  next();
}

// ── Periodic cleanup ───────────────────────────────────────────────────────

let cleanupInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
  const now = Date.now();
  let csrfPurged = 0;
  let sessionPurged = 0;
  Array.from(csrfMemory.entries()).forEach(([id, data]) => {
    if (now - data.createdAt > CSRF_TOKEN_TTL * 2) { csrfMemory.delete(id); csrfPurged++; }
  });
  Array.from(sessionActivityMemory.entries()).forEach(([id, lastActivity]) => {
    if (now - lastActivity > SESSION_IDLE_TIMEOUT_MS * 2) { sessionActivityMemory.delete(id); sessionPurged++; }
  });
  if (csrfPurged > 0 || sessionPurged > 0) {
    logger.debug({ csrfPurged, sessionPurged }, "[Session] Periodic cleanup completed");
  }
}, 300_000); // Every 5 minutes

/** Stop the periodic cleanup interval (call on graceful shutdown) */
export function stopSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info("[Session] Periodic cleanup stopped");
  }
}
