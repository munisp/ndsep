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
 * Bootstrap the NDSEP authorization schema into Permify.
 * Idempotent — safe to call on every startup.
 */
export async function permifyBootstrapSchema(): Promise<boolean> {
  // Covers every entity type and permission referenced by:
  //   - middlewareIntegration.checkPermission (admin/compliance/enforcement/banking/audit "write"/"read")
  //   - requirePermission call sites in server/routers.ts
  //     (user.assign_role, organization.issue_penalty / issue_certificate, transfer.approve_transfer)
  //   - permifySync.ts tuple writes (platform roles, org membership, resource-scoped entities)
  //   - routers/regulatorReconciliation.ts (regulator.read)
  // Relations named read/write are checked directly (Permify checks work on
  // relations as well as permissions), matching the tuples written by
  // permifySync.syncPlatformRole.
  const NDSEP_SCHEMA = `
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
`;

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
