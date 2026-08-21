/**
 * NDSEP Session Blacklist (Redis-backed JWT Token Invalidation)
 * =============================================================
 * Provides immediate session revocation even before JWT expiry.
 * Uses Redis SET with TTL matching the token's remaining lifetime.
 *
 * Closes security finding: "Session Timeout Not Enforced for Idle Sessions"
 * Implements: NDPA Article 26 — right to erasure / session termination
 *
 * Usage:
 *   await blacklistToken(jti, expiresAt);  // on logout
 *   const revoked = await isTokenRevoked(jti);  // on every request
 */

import Redis from "ioredis";
import { logger } from "./logger";

const BLACKLIST_PREFIX = "session:blacklist:";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// Dedicated Redis client for session blacklist — uses eager connect (not lazy)
// so it is available immediately in tests and short-lived processes.
let _blacklistRedis: Redis | null = null;

function getBlacklistRedis(): Redis {
  if (!_blacklistRedis) {
    _blacklistRedis = new Redis(REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
      enableOfflineQueue: true,
    });
    _blacklistRedis.on("error", () => { /* suppress — graceful degradation */ });
  }
  return _blacklistRedis;
}

/**
 * Add a JWT token ID to the blacklist.
 * TTL is set to the token's remaining lifetime so Redis auto-expires the entry.
 *
 * @param jti - JWT token ID (jti claim)
 * @param expiresAt - Token expiration timestamp in seconds (JWT exp claim)
 */
export async function blacklistToken(jti: string, expiresAt: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Math.max(1, expiresAt - now);
  try {
    const r = getBlacklistRedis();
    await r.set(`${BLACKLIST_PREFIX}${jti}`, "1", "EX", ttlSeconds);
  } catch {
    // Graceful degradation: if Redis is unavailable, log but don't fail logout
    logger.warn("[SessionBlacklist] Failed to blacklist token — Redis unavailable");
  }
}

/**
 * Check if a JWT token ID has been revoked.
 *
 * @param jti - JWT token ID (jti claim)
 * @returns true if the token is revoked, false otherwise
 */
export async function isTokenRevoked(jti: string): Promise<boolean> {
  try {
    const r = getBlacklistRedis();
    const val = await r.get(`${BLACKLIST_PREFIX}${jti}`);
    return val !== null;
  } catch {
    // Graceful degradation: if Redis is unavailable, assume token is valid
    return false;
  }
}

/**
 * Generate a cryptographically random JWT ID (jti claim).
 * Uses Node.js crypto.randomUUID() for RFC 4122 UUID v4.
 */
export function generateJti(): string {
  return crypto.randomUUID();
}

/**
 * Disconnect the Redis client (for graceful shutdown).
 */
export async function disconnectBlacklistRedis(): Promise<void> {
  if (_blacklistRedis) {
    await _blacklistRedis.quit().catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    _blacklistRedis = null;
  }
}
