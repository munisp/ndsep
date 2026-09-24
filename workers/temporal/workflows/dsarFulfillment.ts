import { defineQuery, proxyActivities, setHandler } from "@temporalio/workflow";
import type * as activities from "../activities/dsarFulfillment";

/**
 * DSAR fulfillment workflow (task queue: ndsep-dsar).
 *
 * The workflow surfaces incomplete states honestly: when identity cannot be
 * verified by a configured provider it completes with
 * status "manual_review_required" and delivered:false rather than claiming
 * fulfillment. Delivery is only reported when the delivery activity actually
 * confirmed it.
 */
export interface DsarFulfillmentInput {
  dsarId: string;
  requestType: "access" | "erasure" | "rectification" | "portability" | "objection" | string;
  subjectId: string;
  orgId: number;
  citizenEmail?: string;
  citizenNin?: string;
}

export type DsarFulfillmentStatus = "completed" | "manual_review_required" | "delivery_unavailable";

export interface DsarFulfillmentResult {
  dsarId: string;
  status: DsarFulfillmentStatus;
  identityVerified: boolean;
  recordsFound: number;
  delivered: boolean;
  reason?: string;
  completedAt: string;
}

export type DsarFulfillmentStage =
  | "acknowledging"
  | "verifying_identity"
  | "manual_review_required"
  | "locating_data"
  | "delivering"
  | "delivery_unavailable"
  | "completed";

export const getDsarStageQuery = defineQuery<DsarFulfillmentStage>("getDsarStage");

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 3 },
});

export async function dsarFulfillmentWorkflow(input: DsarFulfillmentInput): Promise<DsarFulfillmentResult> {
  let stage: DsarFulfillmentStage = "acknowledging";
  setHandler(getDsarStageQuery, () => stage);

  await acts.acknowledgeDsar({ dsarId: input.dsarId, requestType: input.requestType });

  stage = "verifying_identity";
  const identity = await acts.verifyDsarIdentity({
    dsarId: input.dsarId,
    subjectId: input.subjectId,
    citizenEmail: input.citizenEmail,
    citizenNin: input.citizenNin,
  });

  if (!identity.verified) {
    stage = "manual_review_required";
    await acts.markDsarManualReview({ dsarId: input.dsarId, reason: identity.reason });
    return {
      dsarId: input.dsarId,
      status: "manual_review_required",
      identityVerified: false,
      recordsFound: 0,
      delivered: false,
      reason: identity.reason,
      completedAt: new Date().toISOString(),
    };
  }

  stage = "locating_data";
  const located = await acts.locateDsarData({
    dsarId: input.dsarId,
    subjectId: input.subjectId,
    orgId: input.orgId,
    citizenEmail: input.citizenEmail,
    citizenNin: input.citizenNin,
  });

  stage = "delivering";
  const delivery = await acts.deliverDsarData({
    dsarId: input.dsarId,
    citizenEmail: input.citizenEmail,
    requestType: input.requestType,
    identityVerified: true,
    recordsFound: located.recordsFound,
  });

  if (!delivery.delivered) {
    stage = "delivery_unavailable";
    return {
      dsarId: input.dsarId,
      status: "delivery_unavailable",
      identityVerified: true,
      recordsFound: located.recordsFound,
      delivered: false,
      reason: delivery.reason ?? "delivery_not_confirmed",
      completedAt: new Date().toISOString(),
    };
  }

  stage = "completed";
  return {
    dsarId: input.dsarId,
    status: "completed",
    identityVerified: true,
    recordsFound: located.recordsFound,
    delivered: true,
    completedAt: new Date().toISOString(),
  };
}

export const DSAR_TASK_QUEUE = "ndsep-dsar";
export const DSAR_WORKFLOW_ID_PREFIX = "dsar-";
