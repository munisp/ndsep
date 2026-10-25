/**
 * Permify resource-level access control helper.
 *
 * This module provides a lightweight wrapper around the Permify HTTP API
 * so tRPC procedures can enforce fine-grained permissions without coupling
 * business logic to the IAM layer.
 *
 * In production, PERMIFY_URL should point to the Permify sidecar running
 * alongside the NDSEP server (default: http://localhost:3476).
 *
 * Schema (loaded into Permify on first boot): see NDSEP_SCHEMA in
 * permifyBootstrapSchema() below — it defines every entity type and action
 * referenced by check paths (middlewareIntegration.checkPermission,
 * requirePermission, permifyGuard) and by tuple writes in permifySync.ts.
 * Subject ids use the canonical "user:<id>" format everywhere (see
 * normalizePermifySubjectId).
 */

import { TRPCError } from "@trpc/server";
import { logger } from "./logger";

const PERMIFY_URL = process.env.PERMIFY_URL ?? "http://localhost:3476";
const PERMIFY_TENANT = process.env.PERMIFY_TENANT ?? "ndsep";

export type PermifyAction = string;

/**
 * Canonical Permify subject id format: "user:<id>".
 * Relationship tuples written by permifySync.ts and the authz provisioning
 * endpoints use this exact format, and every check path normalizes to it so
 * tuples and checks can never silently mismatch.
 */
export function normalizePermifySubjectId(subjectId: string | number): string {
  const raw = String(subjectId);
  return raw.startsWith("user:") ? raw : `user:${raw}`;
}

interface CheckResult {
  can: "RESULT_ALLOWED" | "RESULT_DENIED" | "RESULT_UNKNOWN";
}

/**
 * Check if a user is allowed to perform `action` on `resourceType:resourceId`.
 * Denies access when Permify is unavailable, returns an error, or cannot make
 * an authoritative decision. Authorization must fail closed in every runtime.
 */
export async function permifyCheck(
  subjectId: string | number,
  action: PermifyAction,
  resourceType: string,
  resourceId: string | number
): Promise<boolean> {
  try {
    const body = {
      metadata: { schema_version: "", snap_token: "", depth: 20 },
      entity: { type: resourceType, id: String(resourceId) },
      permission: action,
      subject: { type: "user", id: normalizePermifySubjectId(subjectId) },
    };

    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/permissions/check`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2000),
      }
    );

    if (!res.ok) {
      logger.warn({ status: res.status }, "[permify] Permission check returned an error");
      return false;
    }

    const data: CheckResult = await res.json();
    return data.can === "RESULT_ALLOWED";
  } catch (error) {
    logger.warn({ err: error }, "[permify] Permission check failed");
    return false;
  }
}

/**
 * Convenience wrapper: throws FORBIDDEN if the check fails.
 * Use inside tRPC procedures:
 *
 *   await requirePermission(ctx.user.id, "issue_penalty", "organization", input.organizationId);
 */
export async function requirePermission(
  subjectId: string | number,
  action: PermifyAction,
  resourceType: string,
  resourceId: string | number
): Promise<void> {
  const allowed = await permifyCheck(subjectId, action, resourceType, resourceId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Permission denied: ${action} on ${resourceType}:${resourceId}`,
    });
  }
}

/**
 * Write a relationship tuple to Permify (e.g., when a user is assigned admin).
 * Idempotent — safe to call multiple times.
 */
export async function permifyWriteRelationship(
  resourceType: string,
  resourceId: string | number,
  relation: string,
  subjectType: string,
  subjectId: string | number
): Promise<void> {
  try {
    const body = {
      metadata: { schema_version: "" },
      tuples: [
        {
          entity: { type: resourceType, id: String(resourceId) },
          relation,
          subject: { type: subjectType, id: subjectType === "user" ? normalizePermifySubjectId(subjectId) : String(subjectId) },
        },
      ],
    };

    const response = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/relationships/write`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2000),
      }
    );
    if (!response.ok) throw new Error(`Permify relationship write failed with HTTP ${response.status}`);
  } catch (error) {
    logger.error({ err: error }, "[permify] Failed to write relationship tuple");
    throw error;
  }
}

/**
 * Health check — returns true if Permify is reachable.
 */
export async function permifyHealthCheck(): Promise<{
  connected: boolean;
  url: string;
  tenant: string;
  latencyMs: number;
}> {
  const start = Date.now();
  try {
    const res = await fetch(`${PERMIFY_URL}/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    return { connected: res.ok, url: PERMIFY_URL, tenant: PERMIFY_TENANT, latencyMs: Date.now() - start };
  } catch {
    return { connected: false, url: PERMIFY_URL, tenant: PERMIFY_TENANT, latencyMs: Date.now() - start };
  }
}

/**
 * Resource types added in round 10 (round-8/9 entities). Used by
 * checkResourcePermission / requireResourcePermission and asserted against
 * NDSEP_SCHEMA by tests/round10/permifySchema.test.ts — the two must never
 * drift, or a router check would reference an entity Permify rejects.
 */
export const ROUND10_RESOURCE_TYPES = [
  "public_complaint",
  "settlement",
  "publication_document",
  "tribunal_bundle",
  "hosting_declaration",
  "transfer_declaration",
  "scan_target",
  "scan_finding",
  "supervision_plan",
  "verified_revenue",
  "identity_verification",
  "ussd_intake",
  "adverse_media_item",
  "ai_system",
  "mutual_assistance_request",
  "legal_instrument",
] as const;

export type Round10ResourceType = (typeof ROUND10_RESOURCE_TYPES)[number];

export interface ResourceRef {
  type: Round10ResourceType | (string & {});
  id: string | number;
}

/**
 * Resource-scoped permission check wrapper (round 10). Same fail-closed
 * semantics as permifyCheck; exists so round-8/9 routers pass a typed
 * resource ref instead of loose strings:
 *
 *   await checkResourcePermission(ctx.user.id, { type: "public_complaint", id }, "view");
 */
export async function checkResourcePermission(
  subjectId: string | number,
  resource: ResourceRef,
  action: PermifyAction
): Promise<boolean> {
  return permifyCheck(subjectId, action, resource.type, resource.id);
}

/**
 * Throwing variant of checkResourcePermission — FORBIDDEN on deny.
 */
export async function requireResourcePermission(
  subjectId: string | number,
  resource: ResourceRef,
  action: PermifyAction
): Promise<void> {
  await requirePermission(subjectId, action, resource.type, resource.id);
}

/**
 * Delete relationship tuples from Permify. With `relation`/`subjectId`
 * omitted this removes ALL tuples for the entity (entity lifecycle cleanup —
 * call when the underlying row is deleted so Permify never grants access to
 * a stale resource id). Failures throw — the caller (permifySync) queues
 * retries.
 */
export async function permifyDeleteRelationship(
  resourceType: string,
  resourceId: string | number,
  relation?: string,
  subjectId?: string | number
): Promise<void> {
  try {
    const filter: Record<string, unknown> = {
      entity: { type: resourceType, ids: [String(resourceId)] },
    };
    if (relation) filter.relation = relation;
    if (subjectId != null) {
      filter.subject = { type: "user", ids: [normalizePermifySubjectId(subjectId)] };
    }
    const response = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/relationships/delete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter }),
        signal: AbortSignal.timeout(2000),
      }
    );
    if (!response.ok) throw new Error(`Permify relationship delete failed with HTTP ${response.status}`);
  } catch (error) {
    logger.error({ err: error }, "[permify] Failed to delete relationship tuple");
    throw error;
  }
}

/**
 * Bootstrap the NDSEP authorization schema into Permify.
 * Idempotent — safe to call on every startup.
 */
// Covers every entity type and permission referenced by:
//   - middlewareIntegration.checkPermission (admin/compliance/enforcement/banking/audit "write"/"read")
//   - requirePermission call sites in server/routers.ts
//     (user.assign_role, organization.issue_penalty / issue_certificate, transfer.approve_transfer)
//   - permifySync.ts tuple writes (platform roles, org membership, resource-scoped entities)
//   - routers/regulatorReconciliation.ts (regulator.read)
//   - round-8/9 resource-scoped entities (see ROUND10_RESOURCE_TYPES) checked via
//     checkResourcePermission / requireResourcePermission
// Relations named read/write are checked directly (Permify checks work on
// relations as well as permissions), matching the tuples written by
// permifySync.syncPlatformRole.
export const NDSEP_SCHEMA = `
entity user {
  relation admin @user

  action assign_role = admin
}

entity organization {
  relation admin @user
  relation compliance_officer @user
  relation member @user
  relation auditor @user

  action issue_penalty = admin
  action issue_certificate = admin
  action approve_transfer = admin
  action access_pcap = admin
  action assign_role = admin
  action view = admin or compliance_officer or member
}

entity sector {
  relation regulator @user
  relation operator @user

  action manage = regulator
  action view = regulator or operator
}

entity platform {
  relation admin @user
  relation government_staff @user
  relation org_admin @user
  relation auditor @user
  relation member @user

  action manage = admin
  action view = admin or government_staff or org_admin or auditor or member
}

entity admin {
  relation write @user
  relation read @user
}

entity compliance {
  relation write @user
  relation read @user
}

entity enforcement {
  relation write @user
  relation read @user
}

entity banking {
  relation write @user
  relation read @user
}

entity audit {
  relation write @user
  relation read @user
}

entity transfer {
  relation admin @user

  action approve_transfer = admin
}

entity regulator {
  relation reader @user

  action read = reader
}

entity enforcement_case {
  relation owner @user
  relation organization @organization

  action view = owner or organization.admin
  action manage = owner
}

entity breach_incident {
  relation reporter @user
  relation organization @organization

  action view = reporter or organization.admin
  action manage = reporter
}

entity compliance_audit {
  relation auditor @user
  relation organization @organization

  action view = auditor or organization.admin
  action conduct = auditor
}

entity data_transfer {
  relation requester @user
  relation organization @organization

  action view = requester or organization.admin
  action approve = organization.admin
}

entity dsar_request {
  relation subject @user
  relation organization @organization

  action view = subject or organization.admin
  action process = organization.admin or organization.compliance_officer
}

// ─── Round-8/9 resource-scoped entities (round 10) ─────────────────────────
// Relations follow the admin/manager/viewer pattern of the legacy entities:
// a directly-assigned user relation plus an @organization parent so org
// admins/compliance officers inherit visibility. Tuples are written by the
// sync* helpers in server/permifySync.ts; checks go through
// checkResourcePermission / requireResourcePermission.

/** Public complaint (publicComplaints router). */
entity public_complaint {
  relation assignee @user
  relation controller @organization

  action view = assignee or controller.admin or controller.compliance_officer
  action manage = assignee
}

/** Payment settlement case (settlementWorkflow). */
entity settlement {
  relation initiator @user
  relation approver @user
  relation organization @organization

  action view = initiator or approver or organization.admin
  action approve = approver
  action manage = initiator
}

/** Gazette/publication workbench document. */
entity publication_document {
  relation editor @user
  relation approver @user
  relation organization @organization

  action view = editor or approver or organization.admin
  action publish = approver
  action manage = editor
}

/** Sealed tribunal evidence bundle. */
entity tribunal_bundle {
  relation assembler @user
  relation verifier @user
  relation organization @organization

  action view = assembler or verifier or organization.admin
  action verify = verifier
  action export = verifier
  action manage = assembler
}

/** Data-sovereignty hosting declaration. */
entity hosting_declaration {
  relation declarant @user
  relation reviewer @user
  relation organization @organization

  action view = declarant or reviewer or organization.admin
  action review = reviewer
  action manage = declarant or organization.admin
}

/** Cross-border transfer declaration. */
entity transfer_declaration {
  relation declarant @user
  relation reviewer @user
  relation organization @organization

  action view = declarant or reviewer or organization.admin or organization.compliance_officer
  action review = reviewer
  action manage = declarant
}

/** Compliance scan target (web property under supervision). */
entity scan_target {
  relation owner @user
  relation organization @organization

  action view = owner or organization.admin
  action manage = owner
}

/** Finding raised against a scan target. */
entity scan_finding {
  relation assignee @user
  relation organization @organization

  action view = assignee or organization.admin
  action triage = assignee
}

/** Annual supervision plan (risk-based supervision). */
entity supervision_plan {
  relation owner @user
  relation assignee @user
  relation organization @organization

  action view = owner or assignee or organization.admin
  action approve = owner
  action manage = owner or assignee
}

/** Verified revenue filing (FIRS/CAC cross-check). */
entity verified_revenue {
  relation filer @user
  relation verifier @user
  relation organization @organization

  action view = filer or verifier or organization.admin
  action verify = verifier
  action manage = filer
}

/** Identity verification record (NIN/basic assurance). Subject may be an
 *  unauthenticated public user — the subject relation is optional. */
entity identity_verification {
  relation subject @user
  relation reviewer @user

  action view = subject or reviewer
  action manage = reviewer
}

/** USSD intake queue item. */
entity ussd_intake {
  relation assignee @user
  relation organization @organization

  action view = assignee or organization.admin
  action manage = assignee
}

/** Adverse media item under review. */
entity adverse_media_item {
  relation reviewer @user
  relation organization @organization

  action view = reviewer or organization.admin
  action triage = reviewer
}

/** Registered AI system (AI regulation). */
entity ai_system {
  relation owner @user
  relation assessor @user
  relation organization @organization

  action view = owner or assessor or organization.admin
  action assess = assessor
  action manage = owner or organization.admin
}

/** International mutual-assistance request (inbound/outbound). */
entity mutual_assistance_request {
  relation requester @user
  relation handler @user

  action view = requester or handler
  action manage = handler
}

/** Legal instrument underpinning enforcement actions / notices. */
entity legal_instrument {
  relation custodian @user
  relation publisher @user

  action view = custodian or publisher
  action publish = publisher
  action manage = custodian
}
`;

/**
 * Bootstrap the NDSEP authorization schema into Permify.
 * Idempotent — safe to call on every startup.
 */
export async function permifyBootstrapSchema(): Promise<boolean> {
  try {
    const res = await fetch(
      `${PERMIFY_URL}/v1/tenants/${PERMIFY_TENANT}/schemas/write`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: NDSEP_SCHEMA }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) {
      logger.info("[permify] Schema bootstrapped successfully");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
