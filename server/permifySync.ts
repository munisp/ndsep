/**
 * Permify Relationship Sync
 * Writes relationship tuples to Permify when entities are created/updated.
 * Ensures ReBAC authorization reflects actual data state.
 */
import { permifyWriteRelationship } from "./middlewareExtensions";
import { logger } from "./logger";

const PERMIFY_ENABLED = process.env.PERMIFY_ENABLED !== "false";

async function writeRel(entityType: string, entityId: string, relation: string, subjectId: string): Promise<void> {
  if (!PERMIFY_ENABLED) return;
  try {
    await permifyWriteRelationship(entityType, entityId, relation, subjectId);
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, `[Permify] write relationship failed: ${entityType}#${entityId}@${relation}`);
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
    await writeRel("compliance", "*", "write", userId);
    await writeRel("enforcement", "*", "write", userId);
    await writeRel("banking", "*", "write", userId);
    await writeRel("audit", "*", "write", userId);
  }
  if (role === "government_staff") {
    await writeRel("compliance", "*", "read", userId);
    await writeRel("enforcement", "*", "read", userId);
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
