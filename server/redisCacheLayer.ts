/**
 * NDSEP Redis Cache Layer
 * ========================
 * High-level caching utilities built on top of the Redis client.
 * Provides:
 *   - Query result caching with configurable TTL
 *   - Cache invalidation by key pattern
 *   - Cache-aside pattern for DB queries
 *   - Stale-while-revalidate for read-heavy endpoints
 */

import { cacheGet, cacheSet, cacheDel } from "./cache";
import { logger } from "./logger";

const DEFAULT_TTL = 300; // 5 minutes

export async function cachedQuery<T>(
  key: string,
  queryFn: () => Promise<T>,
  ttl: number = DEFAULT_TTL
): Promise<T> {
  // Try cache first
  const cached = await cacheGet(key);
  if (cached) {
    try {
      return JSON.parse(cached) as T;
    } catch {
      // Corrupted cache — fall through to query
    }
  }

  // Execute query
  const result = await queryFn();

  // Cache result
  if (result !== null && result !== undefined) {
    await cacheSet(key, JSON.stringify(result), ttl).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
  }

  return result;
}

export async function invalidateCache(pattern: string): Promise<void> {
  try {
    await cacheDel(pattern);
    logger.info({ pattern }, "[Cache] Invalidated: %s", pattern);
  } catch {
    // Non-critical — cache will expire naturally
  }
}

export function buildCacheKey(prefix: string, ...parts: (string | number)[]): string {
  return `ndsep:${prefix}:${parts.join(":")}`;
}

// Pre-defined cache key builders
export const CacheKeys = {
  orgList: (page: number, limit: number) => buildCacheKey("orgs", "list", page, limit),
  orgDetail: (id: number) => buildCacheKey("orgs", id),
  complianceScore: (orgId: number) => buildCacheKey("score", orgId),
  auditEngagements: (orgId: number) => buildCacheKey("audits", orgId),
  dsarList: (status: string) => buildCacheKey("dsar", status),
  userProfile: (userId: string) => buildCacheKey("user", userId),
  sectorStats: (sector: string) => buildCacheKey("sector", sector),
};
