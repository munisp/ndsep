/**
 * NDSEP Middleware Helpers
 * ========================
 * Shared utilities for injecting middleware into tRPC routers:
 *   - Kafka event publishing (fire-and-forget with graceful degradation)
 *   - Redis cache helpers (get/set/invalidate with TTL)
 *   - Audit logging (structured INSERT into audit_logs)
 *   - TigerBeetle financial transactions
 *   - WebSocket broadcast
 *   - Temporal workflow triggers
 *   - Permify RBAC checks
 *
 * All functions degrade gracefully — middleware failures never break the primary operation.
 */
import { kafkaProduce } from "./kafka";

import { cacheGet, cacheSet, cacheDel, cacheGetJson, cacheSetJson } from "./cache";
import { withCache, withSWR, CK, TTL, invalidateOrgCaches, invalidateComplianceCaches, invalidateCertificateCaches, invalidateAccreditationCaches, invalidateBgpCaches } from "./queryCache";
import { broadcast as wsBroadcast } from "./websocket";
import { createTigerBeetleTransaction, type TbTransactionType } from "./tigerbeetle";
import { startWorkflow } from "./temporal";
import { permifyCheck, type PermifyAction } from "./permify";
import pg from "pg";
const { Pool } = pg;
let _mwPool: InstanceType<typeof Pool> | null = null;
function getMwPool(): InstanceType<typeof Pool> {
  if (!_mwPool) {
    _mwPool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: getPgSslConfig(),
    });
  }
  return _mwPool;
}
async function dbQuery(sql: string, params: unknown[] = []): Promise<unknown[]> {
  const { rows } = await getMwPool().query(sql, params as any[]);
  return rows;
}

// ─── Kafka ────────────────────────────────────────────────────────────────────
import { kafkaResilience, daprResilience, temporalResilience, getAllCircuitBreakerStates } from "./resilience";
export async function emitEvent(topic: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await kafkaResilience(() => kafkaProduce(topic, null, { ...payload, ts: new Date().toISOString() }));
  } catch (e) {
    logger.warn({ err: (e as Error).message }, `[Kafka] emitEvent ${topic} failed (non-fatal)`);
  }
}
export { getAllCircuitBreakerStates };

// ─── Audit Logging ────────────────────────────────────────────────────────────
export async function logAuditEvent(
  action: string,
  resourceType: string,
  resourceId: string | number,
  userId: string | number,
  details: Record<string, unknown> = {},
  ipAddress?: string,
): Promise<void> {
  try {
    await dbQuery(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [action, resourceType, String(resourceId), String(userId), JSON.stringify(details), ipAddress ?? null],
    );
  } catch (e) {
    logger.warn({ err: (e as Error).message }, `[Audit] logAuditEvent ${action} failed (non-fatal)`);
  }
}

// ─── Cache ────────────────────────────────────────────────────────────────────
export { cacheGet, cacheSet, cacheDel, cacheGetJson, cacheSetJson, withCache, withSWR, CK, TTL, invalidateOrgCaches, invalidateComplianceCaches, invalidateCertificateCaches, invalidateAccreditationCaches, invalidateBgpCaches };

// ─── WebSocket Broadcast ──────────────────────────────────────────────────────
export function broadcastEvent(event: string, data: Record<string, unknown>): void {
  try {
    wsBroadcast(event, data);
  } catch (e) {
    logger.warn({ err: (e as Error).message }, `[WS] broadcastEvent ${event} failed (non-fatal)`);
  }
}

// ─── TigerBeetle ─────────────────────────────────────────────────────────────
export async function recordFinancialTransaction(
  type: TbTransactionType,
  amountUsd: number,
  orgId: string,
  penaltyId: string,
  description?: string,
): Promise<void> {
  const { tigerbeetleResilience } = await import("./resilience");
  await tigerbeetleResilience(() => createTigerBeetleTransaction({
    type,
    amountUsd,
    orgId,
    penaltyId,
    description,
  }));
}

// ─── Temporal Workflow ────────────────────────────────────────────────────────
export async function triggerWorkflow(
  workflowType: string,
  workflowId: string,
  input: Record<string, unknown>,
  taskQueue = "ndsep-main",
): Promise<void> {
  await temporalResilience(() => startWorkflow(workflowType, { workflowId, input, taskQueue }));
}

// ─── Permify RBAC ─────────────────────────────────────────────────────────────
export async function checkPermission(
  subjectId: string | number,
  action: PermifyAction,
  resourceType: string,
  resourceId: string | number,
): Promise<boolean> {
  try {
    return await permifyCheck(subjectId, action, resourceType, resourceId);
  } catch (e) {
    logger.error({ err: (e as Error).message }, `[Permify] checkPermission failed; denying access`);
    return false;
  }
}

// ─── Aliases & Extended Helpers ───────────────────────────────────────────────

/** Alias for broadcastEvent — preferred name in router middleware */
export async function broadcastUpdate(event: string, data: Record<string, unknown>): Promise<void> {
  broadcastEvent(event, data);
}

/** Rate limit check using Redis sliding window. Returns true if allowed. */
export async function checkRateLimit(
  key: string,
  limit = 100,
  windowSecs = 60,
): Promise<boolean> {
  try {
    const countKey = `ratelimit:${key}`;
    const current = await cacheGet(countKey);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= limit) return false;
    await cacheSet(countKey, String(count + 1), windowSecs);
    return true;
  } catch (e) {
    logger.error({ err: (e as Error).message }, `[RateLimit] checkRateLimit ${key} failed; denying request`);
    return false;
  }
}

/** Alias for triggerWorkflow — preferred name in router middleware */
export async function startWorkflowIfAvailable(
  workflowType: string,
  workflowId: string,
  input: Record<string, unknown>,
  taskQueue = "ndsep-main",
): Promise<void> {
  return triggerWorkflow(workflowType, workflowId, input, taskQueue);
}

// ─── Phase 24 Aliases ─────────────────────────────────────────────────────────
/** Alias for relayEventViaBridge — shorter name for router middleware */
export async function relayToGoBridge(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const GO_BRIDGE_URL = process.env.MIDDLEWARE_BRIDGE_URL ?? "http://localhost:8140";
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 1000);
    const response = await fetch(`${GO_BRIDGE_URL}/events/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: eventType, payload, timestamp: Date.now() }),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Go bridge relay failed with HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`Go bridge relay unavailable: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

const RUST_CACHE_URL = process.env.MIDDLEWARE_CACHE_URL ?? process.env.RUST_CACHE_URL ?? "http://localhost:8141";

/** Rate limit check proxied to Rust middleware cache worker */
export async function checkRateLimitRust(
  key: string,
  limit: number = 100,
  windowMs: number = 60000,
): Promise<boolean> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 200);
  try {
    const res = await fetch(`${RUST_CACHE_URL}/ratelimit/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, limit, window_ms: windowMs }),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json() as { allowed: boolean };
    return data.allowed;
  } catch {
    return false;
  }
}

/** Proxy rate limit check to Rust middleware cache */
export const proxyRateLimit = checkRateLimitRust;

// MIDDLEWARE_CACHE_URL alias
import { getPgSslConfig } from "./dbSslConfig";
import { getDatabaseUrl } from "./config";
import { logger } from "./logger";
