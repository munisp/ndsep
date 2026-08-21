/**
 * NDSEP Query Cache — Production-grade Redis caching for high-frequency endpoints
 * ================================================================================
 * Wraps the low-level cache.ts helpers with:
 *   - Typed cache-aside pattern (read-through, write-around)
 *   - Automatic TTL tuning per query category
 *   - Cache-key namespacing to prevent collisions
 *   - Stale-while-revalidate support for critical paths
 *   - Cache invalidation helpers grouped by domain
 *
 * TTL Strategy:
 *   - Dashboard stats:         30s  (high-frequency, acceptable staleness)
 *   - Compliance scores:       60s  (changes on enforcement actions)
 *   - Organization lists:     120s  (rarely changes)
 *   - Sector aggregates:      300s  (5 min — expensive aggregation)
 *   - Reference data:        3600s  (1 hour — static config)
 *   - User profiles:          300s  (5 min)
 *   - Audit logs:              30s  (append-only, short TTL for freshness)
 *   - BGP routes:              15s  (near-real-time)
 *   - Streaming stats:         10s  (live data)
 */
import { cacheGetJson, cacheSetJson, cacheDel, cacheGet, cacheSet } from "./cache";
import { logger } from "./logger";

// ─── TTL Constants (seconds) ──────────────────────────────────────────────────
export const TTL = {
  DASHBOARD:       30,
  COMPLIANCE:      60,
  ORG_LIST:       120,
  SECTOR_AGG:     300,
  REFERENCE:     3600,
  USER_PROFILE:   300,
  AUDIT_LOG:       30,
  BGP:             15,
  STREAMING:       10,
  PENALTY_STATS:   60,
  CERTIFICATE:    180,
  ACCREDITATION:   60,
  POLICY:         600,
  RISK_SCORE:      45,
  SEARCH:          30,
} as const;

// ─── Cache Key Builders ───────────────────────────────────────────────────────
export const CK = {
  dashboardStats:          () => "ndsep:dashboard:stats",
  orgList:                 (page = 0, limit = 50) => `ndsep:orgs:list:${page}:${limit}`,
  orgById:                 (id: number) => `ndsep:orgs:${id}`,
  complianceScore:         (orgId: number) => `ndsep:compliance:score:${orgId}`,
  sectorAgg:               (sector: string) => `ndsep:sector:agg:${sector}`,
  allSectorAgg:            () => "ndsep:sector:agg:all",
  penaltyStats:            () => "ndsep:penalties:stats",
  penaltyList:             (orgId?: number) => orgId ? `ndsep:penalties:org:${orgId}` : "ndsep:penalties:list",
  certificateList:         (orgId?: number) => orgId ? `ndsep:certs:org:${orgId}` : "ndsep:certs:list",
  accreditationStatus:     (orgId: number) => `ndsep:accreditation:${orgId}`,
  bgpStats:                () => "ndsep:bgp:stats",
  bgpRoutes:               (limit: number) => `ndsep:bgp:routes:${limit}`,
  streamingTopicStats:     () => "ndsep:streaming:topics",
  riskScore:               (orgId: number) => `ndsep:risk:score:${orgId}`,
  policyList:              () => "ndsep:policies:list",
  userProfile:             (userId: number) => `ndsep:user:${userId}`,
  dpcoList:                (page = 0) => `ndsep:dpco:list:${page}`,
  auditLogRecent:          (limit: number) => `ndsep:audit:recent:${limit}`,
  nipStats:                () => "ndsep:nip:stats",
  nipDashboard:            () => "ndsep:nip:dashboard",
  slaStats:                () => "ndsep:sla:stats",
  aiGovernanceScores:      () => "ndsep:ai:governance:scores",
  nationalReport:          (year: number, month: number) => `ndsep:report:national:${year}:${month}`,
  searchResults:           (query: string, type: string) => `ndsep:search:${type}:${Buffer.from(query).toString("base64").slice(0, 32)}`,
} as const;

// ─── Generic Cache-Aside Helper ───────────────────────────────────────────────

/**
 * Cache-aside pattern: try cache first, fall back to DB query, cache the result.
 * @param key    Cache key
 * @param ttl    TTL in seconds
 * @param fetch  Async function to fetch from DB if cache miss
 */
export async function withCache<T>(
  key: string,
  ttl: number,
  fetch: () => Promise<T>
): Promise<T> {
  const cached = await cacheGetJson<T>(key);
  if (cached !== null) return cached;
  const data = await fetch();
  await cacheSetJson(key, data, ttl).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed")); // non-blocking, non-fatal
  return data;
}

/**
 * Stale-while-revalidate: return cached value immediately (even if stale),
 * then refresh in the background. Ideal for dashboard stats.
 */
export async function withSWR<T>(
  key: string,
  ttl: number,
  staleTtl: number,
  fetch: () => Promise<T>
): Promise<T> {
  const staleKey = `${key}:stale`;
  // Try fresh cache first
  const fresh = await cacheGetJson<T>(key);
  if (fresh !== null) return fresh;
  // Try stale cache and trigger background refresh
  const stale = await cacheGetJson<T>(staleKey);
  if (stale !== null) {
    // Background refresh (fire-and-forget)
    fetch()
      .then(async (data) => {
        await cacheSetJson(key, data, ttl);
        await cacheSetJson(staleKey, data, staleTtl);
      })
      .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return stale;
  }
  // Cache miss — fetch synchronously
  const data = await fetch();
  await Promise.all([
    cacheSetJson(key, data, ttl),
    cacheSetJson(staleKey, data, staleTtl),
  ]).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
  return data;
}

// ─── Domain-Specific Invalidation Helpers ────────────────────────────────────

/** Invalidate all organization-related caches when an org is updated */
export async function invalidateOrgCaches(orgId: number): Promise<void> {
  await Promise.allSettled([
    cacheDel(CK.orgById(orgId)),
    cacheDel(CK.complianceScore(orgId)),
    cacheDel(CK.riskScore(orgId)),
    cacheDel(CK.accreditationStatus(orgId)),
    cacheDel(CK.dashboardStats()),
    cacheDel(CK.orgList(0, 50)),
    cacheDel(CK.orgList(0, 100)),
    cacheDel(CK.penaltyList(orgId)),
    cacheDel(CK.certificateList(orgId)),
  ]);
}

/** Invalidate compliance-related caches when a violation is issued */
export async function invalidateComplianceCaches(orgId?: number): Promise<void> {
  const keys = [
    CK.dashboardStats(),
    CK.penaltyStats(),
    CK.allSectorAgg(),
    CK.nipStats(),
    CK.nipDashboard(),
  ];
  if (orgId) {
    keys.push(CK.complianceScore(orgId));
    keys.push(CK.riskScore(orgId));
    keys.push(CK.penaltyList(orgId));
  }
  await Promise.allSettled(keys.map(cacheDel));
}

/** Invalidate certificate caches when a certificate is issued/revoked */
export async function invalidateCertificateCaches(orgId?: number): Promise<void> {
  const keys = [
    CK.certificateList(),
    CK.dashboardStats(),
  ];
  if (orgId) keys.push(CK.certificateList(orgId));
  await Promise.allSettled(keys.map(cacheDel));
}

/** Invalidate accreditation caches when status changes */
export async function invalidateAccreditationCaches(orgId: number): Promise<void> {
  await Promise.allSettled([
    cacheDel(CK.accreditationStatus(orgId)),
    cacheDel(CK.dashboardStats()),
  ]);
}

/** Invalidate BGP caches when a route is updated */
export async function invalidateBgpCaches(): Promise<void> {
  await Promise.allSettled([
    cacheDel(CK.bgpStats()),
    cacheDel(CK.bgpRoutes(50)),
    cacheDel(CK.bgpRoutes(100)),
  ]);
}

/** Warm up critical caches on server startup */
export async function warmupCaches(
  fetchDashboard: () => Promise<unknown>,
  fetchSectorAgg: () => Promise<unknown>,
  fetchPenaltyStats: () => Promise<unknown>,
): Promise<void> {
  const tasks = [
    cacheSetJson(CK.dashboardStats(), await fetchDashboard().catch(() => null), TTL.DASHBOARD),
    cacheSetJson(CK.allSectorAgg(), await fetchSectorAgg().catch(() => null), TTL.SECTOR_AGG),
    cacheSetJson(CK.penaltyStats(), await fetchPenaltyStats().catch(() => null), TTL.PENALTY_STATS),
  ];
  await Promise.allSettled(tasks);
  logger.info("[QueryCache] Cache warmup complete");
}

// Re-export low-level helpers for convenience
export { cacheGetJson, cacheSetJson, cacheDel, cacheGet, cacheSet };
