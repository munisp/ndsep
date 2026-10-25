/**
 * Permify Relationship Sync
 * Writes relationship tuples to Permify when entities are created/updated.
 * Ensures ReBAC authorization reflects actual data state.
 */
import { permifyWriteRelationship } from "./middlewareExtensions";
import {
  permifyWriteRelationship as permifyWriteRelationshipDirect,
  permifyDeleteRelationship,
} from "./permify";
import { logger } from "./logger";

const PERMIFY_ENABLED = process.env.PERMIFY_ENABLED !== "false";

interface RetryItem {
  entityType: string;
  entityId: string;
  relation: string;
  subjectId: string;
  /** Non-user subjects (e.g. organization parents) go through the direct Permify API. */
  subjectType?: "user" | "organization";
  /** "delete" removes all tuples for the entity (relation/subjectId ignored). */
  op?: "write" | "delete";
  attempts: number;
  nextAttemptAt: number;
}

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
      if (item.op === "delete") {
        await permifyDeleteRelationship(item.entityType, item.entityId);
      } else if (item.subjectType && item.subjectType !== "user") {
        await permifyWriteRelationshipDirect(item.entityType, item.entityId, item.relation, item.subjectType, item.subjectId);
      } else {
        await permifyWriteRelationship(item.entityType, item.entityId, item.relation, item.subjectId);
      }
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

// ─── Round-10: resource-scoped entities (round-8/9 surfaces) ───────────────
// Typed writes: organization parents are written with subjectType
// "organization" via the direct Permify API (the middleware-bridge writer
// hardcodes user subjects). All failures go through the shared retry queue.

/** Write a relation tuple with an explicit subject type (user | organization). */
async function writeSubjectRel(
  entityType: string,
  entityId: string | number,
  relation: string,
  subjectType: "user" | "organization",
  subjectId: string | number
): Promise<void> {
  if (!PERMIFY_ENABLED) return;
  const id = String(entityId);
  const subj = String(subjectId);
  try {
    await permifyWriteRelationshipDirect(entityType, id, relation, subjectType, subj);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, `[Permify] write relationship failed: ${entityType}#${id}@${relation} — queued for retry`);
    enqueueRetry({ entityType, entityId: id, relation, subjectId: subj, subjectType });
  }
}

async function writeUserRel(entityType: string, entityId: string | number, relation: string, userId: string | number | null | undefined): Promise<void> {
  if (userId == null || String(userId) === "") return;
  await writeSubjectRel(entityType, entityId, relation, "user", userId);
}

async function writeOrgRel(entityType: string, entityId: string | number, relation: string, orgId: string | number | null | undefined): Promise<void> {
  if (orgId == null || String(orgId) === "") return;
  await writeSubjectRel(entityType, entityId, relation, "organization", orgId);
}

/**
 * Delete ALL relationship tuples for an entity (row deleted / resource
 * retired). Fails loudly into the retry queue — stale tuples must never
 * silently outlive the resource.
 */
export async function deleteResourceTuples(entityType: string, entityId: string | number): Promise<void> {
  if (!PERMIFY_ENABLED) return;
  const id = String(entityId);
  try {
    await permifyDeleteRelationship(entityType, id);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, `[Permify] delete relationships failed: ${entityType}#${id} — queued for retry`);
    enqueueRetry({ entityType, entityId: id, relation: "*", subjectId: "*", op: "delete" });
  }
}

/** Complaint assigned to an officer (publicComplaints.assign). Pass orgId when the controller is resolved; a null assignee writes only the controller link (intake path). */
export async function syncComplaintAssignment(complaintId: string | number, assigneeId: string | number | null, orgId?: string | number | null): Promise<void> {
  await writeUserRel("public_complaint", complaintId, "assignee", assigneeId);
  await writeOrgRel("public_complaint", complaintId, "controller", orgId);
}

/** Settlement created / parties changed (settlementWorkflow). */
export async function syncSettlementParties(
  settlementId: string | number,
  parties: { initiatorId?: string | number | null; approverId?: string | number | null; orgId?: string | number | null }
): Promise<void> {
  await writeUserRel("settlement", settlementId, "initiator", parties.initiatorId);
  await writeUserRel("settlement", settlementId, "approver", parties.approverId);
  await writeOrgRel("settlement", settlementId, "organization", parties.orgId);
}

/** Publication workbench document drafted / approved (publicationWorkbench). */
export async function syncPublicationDocument(
  documentId: string | number,
  parties: { editorId?: string | number | null; approverId?: string | number | null; orgId?: string | number | null }
): Promise<void> {
  await writeUserRel("publication_document", documentId, "editor", parties.editorId);
  await writeUserRel("publication_document", documentId, "approver", parties.approverId);
  await writeOrgRel("publication_document", documentId, "organization", parties.orgId);
}

/** Tribunal bundle assembled / verifier designated (tribunalBundle). */
export async function syncTribunalBundle(
  bundleId: string | number,
  parties: { assemblerId?: string | number | null; verifierId?: string | number | null; orgId?: string | number | null }
): Promise<void> {
  await writeUserRel("tribunal_bundle", bundleId, "assembler", parties.assemblerId);
  await writeUserRel("tribunal_bundle", bundleId, "verifier", parties.verifierId);
  await writeOrgRel("tribunal_bundle", bundleId, "organization", parties.orgId);
}

/** Hosting declaration submitted / put under review (dataSovereignty). */
export async function syncHostingDeclaration(
  declarationId: string | number,
  parties: { declarantId?: string | number | null; reviewerId?: string | number | null; orgId?: string | number | null }
): Promise<void> {
  await writeUserRel("hosting_declaration", declarationId, "declarant", parties.declarantId);
  await writeUserRel("hosting_declaration", declarationId, "reviewer", parties.reviewerId);
  await writeOrgRel("hosting_declaration", declarationId, "organization", parties.orgId);
}

/** Cross-border transfer declaration submitted / under review (crossBorderDeclarations). */
export async function syncTransferDeclaration(
  declarationId: string | number,
  parties: { declarantId?: string | number | null; reviewerId?: string | number | null; orgId?: string | number | null }
): Promise<void> {
  await writeUserRel("transfer_declaration", declarationId, "declarant", parties.declarantId);
  await writeUserRel("transfer_declaration", declarationId, "reviewer", parties.reviewerId);
  await writeOrgRel("transfer_declaration", declarationId, "organization", parties.orgId);
}

/** Scan target registered (complianceScanning.addTarget). */
export async function syncScanTarget(targetId: string | number, ownerId: string | number, orgId?: string | number | null): Promise<void> {
  await writeUserRel("scan_target", targetId, "owner", ownerId);
  await writeOrgRel("scan_target", targetId, "organization", orgId);
}

/** Scan finding triaged to an analyst (complianceScanning.setFindingStatus / referFindingToEnforcement). */
export async function syncScanFindingAssignment(findingId: string | number, assigneeId: string | number, orgId?: string | number | null): Promise<void> {
  await writeUserRel("scan_finding", findingId, "assignee", assigneeId);
  await writeOrgRel("scan_finding", findingId, "organization", orgId);
}

/** Supervision plan generated / item assigned (supervisionRisk.generateAnnualPlan / assignPlanItem). */
export async function syncSupervisionPlan(
  planId: string | number,
  parties: { ownerId?: string | number | null; assigneeId?: string | number | null; orgId?: string | number | null }
): Promise<void> {
  await writeUserRel("supervision_plan", planId, "owner", parties.ownerId);
  await writeUserRel("supervision_plan", planId, "assignee", parties.assigneeId);
  await writeOrgRel("supervision_plan", planId, "organization", parties.orgId);
}

/** Verified revenue filing submitted / verified (revenueVerification). */
export async function syncVerifiedRevenue(
  revenueId: string | number,
  parties: { filerId?: string | number | null; verifierId?: string | number | null; orgId?: string | number | null }
): Promise<void> {
  await writeUserRel("verified_revenue", revenueId, "filer", parties.filerId);
  await writeUserRel("verified_revenue", revenueId, "verifier", parties.verifierId);
  await writeOrgRel("verified_revenue", revenueId, "organization", parties.orgId);
}

/** Identity verification record created / reviewed (ninIdentity.verifyBasic / verifyNin). */
export async function syncIdentityVerification(
  verificationId: string | number,
  parties: { subjectId?: string | number | null; reviewerId?: string | number | null }
): Promise<void> {
  await writeUserRel("identity_verification", verificationId, "subject", parties.subjectId);
  await writeUserRel("identity_verification", verificationId, "reviewer", parties.reviewerId);
}

/** USSD intake item claimed by an officer (ussdChannel.listIntakeQueue / syncPendingIntake). */
export async function syncUssdIntakeAssignment(intakeId: string | number, assigneeId: string | number, orgId?: string | number | null): Promise<void> {
  await writeUserRel("ussd_intake", intakeId, "assignee", assigneeId);
  await writeOrgRel("ussd_intake", intakeId, "organization", orgId);
}

/** Adverse media item routed to a reviewer (adverseMedia.ingestManualItem / reviewQueue). */
export async function syncAdverseMediaItem(itemId: string | number, reviewerId: string | number, orgId?: string | number | null): Promise<void> {
  await writeUserRel("adverse_media_item", itemId, "reviewer", reviewerId);
  await writeOrgRel("adverse_media_item", itemId, "organization", orgId);
}

/** AI system registered / conformity assessment started (aiRegulation). */
export async function syncAiSystem(
  systemId: string | number,
  parties: { ownerId?: string | number | null; assessorId?: string | number | null; orgId?: string | number | null }
): Promise<void> {
  await writeUserRel("ai_system", systemId, "owner", parties.ownerId);
  await writeUserRel("ai_system", systemId, "assessor", parties.assessorId);
  await writeOrgRel("ai_system", systemId, "organization", parties.orgId);
}

/** Mutual-assistance request created / handler assigned (internationalCooperation.createRequest / transitionRequest). */
export async function syncMutualAssistanceRequest(
  requestId: string | number,
  parties: { requesterId?: string | number | null; handlerId?: string | number | null }
): Promise<void> {
  await writeUserRel("mutual_assistance_request", requestId, "requester", parties.requesterId);
  await writeUserRel("mutual_assistance_request", requestId, "handler", parties.handlerId);
}

/** Legal instrument registered / published (legal-instrument registry surfaces). */
export async function syncLegalInstrument(
  instrumentId: string | number,
  parties: { custodianId?: string | number | null; publisherId?: string | number | null }
): Promise<void> {
  await writeUserRel("legal_instrument", instrumentId, "custodian", parties.custodianId);
  await writeUserRel("legal_instrument", instrumentId, "publisher", parties.publisherId);
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
