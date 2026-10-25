/**
 * Permify Relationship Sync
 * Writes relationship tuples to Permify when entities are created/updated.
 * Ensures ReBAC authorization reflects actual data state.
 */
import { permifyWriteRelationship } from "./middlewareExtensions";
import { logger } from "./logger";

const PERMIFY_ENABLED = process.env.PERMIFY_ENABLED !== "false";

interface RetryItem { entityType: string; entityId: string; relation: string; subjectId: string; attempts: number; nextAttemptAt: number }

// Round-9: tuple-write failures were debug-logged and DROPPED, leaving ReBAC
// silently stale. Now: error-level log + bounded in-memory retry queue with
// exponential backoff; items that exhaust retries are logged as CRITICAL for
// operator reconciliation (Permify has no persistent queue of its own here).
const RETRY_QUEUE: RetryItem[] = [];
const MAX_RETRY_ATTEMPTS = 5;
let retryTimer: ReturnType<typeof setInterval> | null = null;

export function getPermifyRetryQueueDepth(): number {
  return RETRY_QUEUE.length;
}

function enqueueRetry(item: Omit<RetryItem, "attempts" | "nextAttemptAt">): void {
  RETRY_QUEUE.push({ ...item, attempts: 0, nextAttemptAt: Date.now() + 5_000 });
  if (!retryTimer) {
    retryTimer = setInterval(() => { void drainRetries(); }, 10_000);
    (retryTimer as { unref?: () => void }).unref?.();
  }
}

async function drainRetries(): Promise<void> {
  const now = Date.now();
  for (let i = RETRY_QUEUE.length - 1; i >= 0; i--) {
    const item = RETRY_QUEUE[i];
    if (item.nextAttemptAt > now) continue;
    try {
      await permifyWriteRelationship(item.entityType, item.entityId, item.relation, item.subjectId);
      RETRY_QUEUE.splice(i, 1);
      logger.info({ ...item }, "[Permify] retry succeeded — relationship synced");
    } catch (err) {
      item.attempts++;
      if (item.attempts >= MAX_RETRY_ATTEMPTS) {
        RETRY_QUEUE.splice(i, 1);
        logger.error({ ...item, err: err instanceof Error ? err.message : String(err) },
          "[Permify] CRITICAL: relationship write exhausted retries — ReBAC state diverged, manual reconciliation required");
      } else {
        item.nextAttemptAt = now + Math.min(300_000, 5_000 * 2 ** item.attempts);
      }
    }
  }
  if (RETRY_QUEUE.length === 0 && retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

async function writeRel(entityType: string, entityId: string, relation: string, subjectId: string): Promise<void> {
  if (!PERMIFY_ENABLED) return;
  try {
    await permifyWriteRelationship(entityType, entityId, relation, subjectId);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, `[Permify] write relationship failed: ${entityType}#${entityId}@${relation} — queued for retry`);
    enqueueRetry({ entityType, entityId, relation, subjectId });
  }
}

/** Called when a user is assigned to an organization */
export async function syncOrgMembership(userId: string, orgId: string | number, role: string): Promise<void> {
  await writeRel("organization", String(orgId), "member", userId);
  if (role === "admin" || role === "org_admin") {
    await writeRel("organization", String(orgId), "admin", userId);
  }
  if (role === "auditor") {
    await writeRel("organization", String(orgId), "auditor", userId);
  }
}

/** Called when a user is granted a platform role */
export async function syncPlatformRole(userId: string, role: string): Promise<void> {
  await writeRel("platform", "ndsep", role, userId);
  if (role === "admin") {
    // adminProcedure gates on checkPermission(userId, "admin", "write") —
    // without this tuple every admin mutation is denied even after role sync.
    await writeRel("admin", "ndsep", "write", userId);
    await writeRel("admin", "ndsep", "read", userId);
    await writeRel("compliance", "ndsep", "write", userId);
    await writeRel("enforcement", "ndsep", "write", userId);
    await writeRel("banking", "ndsep", "write", userId);
    await writeRel("audit", "ndsep", "write", userId);
  }
  if (role === "government_staff") {
    await writeRel("admin", "ndsep", "read", userId);
    await writeRel("compliance", "ndsep", "read", userId);
    await writeRel("enforcement", "ndsep", "read", userId);
  }
}

/** Called when an enforcement case is created */
export async function syncEnforcementCase(caseId: string, creatorId: string, orgId: string | number): Promise<void> {
  await writeRel("enforcement_case", caseId, "owner", creatorId);
  await writeRel("enforcement_case", caseId, "organization", String(orgId));
}

/** Called when a breach incident is reported */
export async function syncBreachIncident(breachId: string, reporterId: string, orgId: string | number): Promise<void> {
  await writeRel("breach_incident", breachId, "reporter", reporterId);
  await writeRel("breach_incident", breachId, "organization", String(orgId));
}

/** Called when a compliance audit is started */
export async function syncComplianceAudit(auditId: string, auditorId: string, orgId: string | number): Promise<void> {
  await writeRel("compliance_audit", auditId, "auditor", auditorId);
  await writeRel("compliance_audit", auditId, "organization", String(orgId));
}

/** Called when a data transfer is requested */
export async function syncDataTransfer(transferId: string, requesterId: string, orgId: string | number): Promise<void> {
  await writeRel("data_transfer", transferId, "requester", requesterId);
  await writeRel("data_transfer", transferId, "organization", String(orgId));
}

/** Called when a DSAR request is submitted */
export async function syncDsarRequest(dsarId: string, subjectId: string, orgId: string | number): Promise<void> {
  await writeRel("dsar_request", dsarId, "subject", subjectId);
  await writeRel("dsar_request", dsarId, "organization", String(orgId));
}

/** Bulk sync: re-sync all relationships from database (useful for initial setup) */
export async function bulkSyncFromDatabase(pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }): Promise<{ synced: number; errors: number }> {
  if (!PERMIFY_ENABLED) return { synced: 0, errors: 0 };
  let synced = 0;
  let errors = 0;

  try {
    // Sync all users with their platform roles
    const { rows: users } = await pool.query("SELECT id, role, organization_id FROM users LIMIT 1000");
    for (const u of users as Array<{ id: number; role: string; organization_id?: number }>) {
      try {
        await syncPlatformRole(String(u.id), u.role);
        if (u.organization_id) {
          await syncOrgMembership(String(u.id), u.organization_id, u.role);
        }
        synced++;
      } catch { errors++; }
    }
    logger.info({ synced, errors }, "[Permify] Bulk sync completed");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[Permify] Bulk sync failed");
  }

  return { synced, errors };
}
