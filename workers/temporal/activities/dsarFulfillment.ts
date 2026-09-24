/**
 * DSAR fulfillment activities — honest implementations.
 *
 * These wrap the canonical activity logic in server/temporalWorker.ts and
 * persist the resulting state transitions on citizen_requests. No activity
 * in this module fabricates success: identity verification defers to manual
 * review unless a provider is configured, data location reports real row
 * counts, and delivery is only recorded when a delivery channel confirms it.
 */
import { database } from "./common";
import {
  acknowledgeActivity,
  identityVerifyActivity,
  dataLocateActivity,
  dataDeliverActivity,
} from "../../../server/temporalWorker";

export interface DsarVerifyResult {
  verified: boolean;
  reason: string;
}

export interface DsarLocateResult {
  systemsSearched: number;
  recordsFound: number;
  counts: Record<string, number>;
}

export interface DsarDeliverResult {
  delivered: boolean;
  reason?: string;
  recordsFound?: number;
}

function asDsarId(requestId: unknown): number | null {
  const n = Number(requestId);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function acknowledgeDsar(params: { dsarId: string; requestType: string }): Promise<void> {
  const result = await acknowledgeActivity({ requestId: params.dsarId, requestType: params.requestType });
  if (!result.success) throw new Error(result.error ?? "DSAR acknowledge failed");
  const id = asDsarId(params.dsarId);
  if (id !== null) {
    await database().query(
      `UPDATE citizen_requests SET status = 'acknowledged', updated_at = NOW()
       WHERE id = $1 AND status = 'submitted'`,
      [id]
    );
  }
}

export async function verifyDsarIdentity(params: {
  dsarId: string;
  subjectId: string;
  citizenEmail?: string;
  citizenNin?: string;
}): Promise<DsarVerifyResult> {
  const result = await identityVerifyActivity({
    requestId: params.dsarId,
    subjectId: params.subjectId,
    citizenEmail: params.citizenEmail,
    citizenNin: params.citizenNin,
  });
  if (!result.success) throw new Error(result.error ?? "identity verification activity failed");
  const output = result.output ?? {};
  return {
    verified: output.verified === true,
    reason: typeof output.reason === "string" ? output.reason : (output.verified === true ? "verified" : "manual_review_required"),
  };
}

/** Record that a request needs manual identity review — never auto-fail the citizen. */
export async function markDsarManualReview(params: { dsarId: string; reason: string }): Promise<void> {
  const id = asDsarId(params.dsarId);
  if (id === null) return;
  await database().query(
    `UPDATE citizen_requests
     SET status = 'in_progress',
         response_notes = COALESCE(response_notes || E'\n', '') || $2,
         updated_at = NOW()
     WHERE id = $1 AND status NOT IN ('completed', 'rejected')`,
    [id, `[identity-review] ${params.reason}`]
  );
}

export async function locateDsarData(params: {
  dsarId: string;
  subjectId: string;
  orgId: number;
  citizenEmail?: string;
  citizenNin?: string;
}): Promise<DsarLocateResult> {
  const result = await dataLocateActivity({
    requestId: params.dsarId,
    subjectId: params.subjectId,
    orgId: params.orgId,
    citizenEmail: params.citizenEmail,
    citizenNin: params.citizenNin,
  });
  if (!result.success) throw new Error(result.error ?? "data locate activity failed");
  const output = result.output ?? {};
  return {
    systemsSearched: Number(output.systemsSearched ?? 0),
    recordsFound: Number(output.recordsFound ?? 0),
    counts: (output.counts as Record<string, number>) ?? {},
  };
}

export async function deliverDsarData(params: {
  dsarId: string;
  citizenEmail?: string;
  requestType: string;
  identityVerified: boolean;
  recordsFound: number;
}): Promise<DsarDeliverResult> {
  const result = await dataDeliverActivity({
    requestId: params.dsarId,
    citizenEmail: params.citizenEmail,
    requestType: params.requestType,
    identityVerified: params.identityVerified,
    recordsFound: params.recordsFound,
  });
  if (!result.success) throw new Error(result.error ?? "delivery activity failed");
  const output = result.output ?? {};
  const delivered = output.delivered === true;
  const id = asDsarId(params.dsarId);
  if (delivered && id !== null) {
    await database().query(
      `UPDATE citizen_requests SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('completed', 'rejected')`,
      [id]
    );
  }
  return {
    delivered,
    reason: typeof output.reason === "string" ? output.reason : undefined,
    recordsFound: typeof output.recordsFound === "number" ? output.recordsFound : params.recordsFound,
  };
}
