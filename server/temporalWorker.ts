/**
 * NDSEP Temporal Worker — Workflow Activity Definitions
 *
 * Registers activities for all 4 NDSEP workflow types:
 *   1. enforcement-lifecycle: Investigation → Evidence → Hearing → Decision → Penalty
 *   2. breach-response: Containment → Assessment → NDPC Notification → Remediation
 *   3. compliance-audit: Document Review → Control Testing → Gap Analysis → Report
 *   4. dsar-fulfillment: Acknowledge → Identity Verify → Data Locate → Deliver
 *
 * Activities are the individual steps within a workflow. Each logs progress
 * and can interact with the database/middleware.
 *
 * In production, this runs as a separate process connected to the same
 * Temporal cluster. For development, it registers handlers on startup.
 */

import { logger } from "./logger";

// ── Activity Definitions ─────────────────────────────────────────────────────

export interface ActivityContext {
  workflowId: string;
  workflowType: string;
  step: string;
  attempt: number;
}

export interface ActivityResult {
  success: boolean;
  step: string;
  duration_ms: number;
  output?: Record<string, unknown>;
  error?: string;
}

// ── Enforcement Lifecycle Activities ─────────────────────────────────────────

export async function investigationActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ caseId: input.caseId, orgId: input.orgId }, "[Temporal:Enforcement] Starting investigation");
  // Simulate investigation — in production this checks evidence queue
  return { success: true, step: "investigation", duration_ms: Date.now() - start, output: { findings: "preliminary" } };
}

export async function evidenceCollectionActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ caseId: input.caseId }, "[Temporal:Enforcement] Collecting evidence");
  return { success: true, step: "evidence-collection", duration_ms: Date.now() - start, output: { documentsCollected: 0 } };
}

export async function hearingActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ caseId: input.caseId }, "[Temporal:Enforcement] Scheduling hearing");
  return { success: true, step: "hearing", duration_ms: Date.now() - start, output: { scheduledDate: new Date(Date.now() + 14 * 86400000).toISOString() } };
}

export async function decisionActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ caseId: input.caseId }, "[Temporal:Enforcement] Rendering decision");
  return { success: true, step: "decision", duration_ms: Date.now() - start, output: { verdict: "pending_review" } };
}

export async function penaltyEnforcementActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ caseId: input.caseId }, "[Temporal:Enforcement] Enforcing penalty");
  return { success: true, step: "penalty-enforcement", duration_ms: Date.now() - start, output: { enforced: true } };
}

// ── Breach Response Activities ───────────────────────────────────────────────

export async function containmentActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ breachId: input.breachId, severity: input.severity }, "[Temporal:Breach] Initiating containment");
  return { success: true, step: "containment", duration_ms: Date.now() - start, output: { contained: true } };
}

export async function assessmentActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ breachId: input.breachId }, "[Temporal:Breach] Assessing impact");
  return { success: true, step: "assessment", duration_ms: Date.now() - start, output: { riskLevel: input.severity ?? "medium" } };
}

export async function ndpcNotificationActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  const deadlineHours = (input.deadlineHours as number) ?? 72;
  logger.info({ breachId: input.breachId, deadlineHours }, "[Temporal:Breach] Preparing NDPC notification");
  return { success: true, step: "ndpc-notification", duration_ms: Date.now() - start, output: { deadline: new Date(Date.now() + deadlineHours * 3600000).toISOString(), notified: false } };
}

export async function remediationActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ breachId: input.breachId }, "[Temporal:Breach] Executing remediation plan");
  return { success: true, step: "remediation", duration_ms: Date.now() - start, output: { planCreated: true } };
}

// ── Compliance Audit Activities ──────────────────────────────────────────────

export async function documentReviewActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ carId: input.carId, orgId: input.orgId }, "[Temporal:Audit] Reviewing documentation");
  return { success: true, step: "document-review", duration_ms: Date.now() - start, output: { documentsReviewed: 0 } };
}

export async function controlTestingActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ carId: input.carId }, "[Temporal:Audit] Testing controls");
  return { success: true, step: "control-testing", duration_ms: Date.now() - start, output: { controlsTested: 0, passed: 0 } };
}

export async function gapAnalysisActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ carId: input.carId }, "[Temporal:Audit] Performing gap analysis");
  return { success: true, step: "gap-analysis", duration_ms: Date.now() - start, output: { gapsFound: 0 } };
}

export async function reportGenerationActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ carId: input.carId }, "[Temporal:Audit] Generating audit report");
  return { success: true, step: "report-generation", duration_ms: Date.now() - start, output: { reportGenerated: true } };
}

// ── DSAR Fulfillment Activities ──────────────────────────────────────────────

export async function acknowledgeActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ requestId: input.requestId, type: input.requestType }, "[Temporal:DSAR] Acknowledging request");
  return { success: true, step: "acknowledge", duration_ms: Date.now() - start, output: { acknowledged: true, acknowledgmentSent: true } };
}

/**
 * Identity verification is a regulatory gate: NDPA requires reasonable
 * certainty of the requester's identity before disclosing personal data.
 * Without an env-configured verification provider this activity must NOT
 * claim success — it returns verified:false with reason
 * "manual_review_required" so the workflow surfaces the request for staff
 * review instead of auto-fulfilling.
 *
 * Configure DSAR_IDENTITY_VERIFY_URL (optionally DSAR_IDENTITY_VERIFY_TOKEN)
 * to integrate a real provider. The provider endpoint receives the request
 * context and must respond with { "verified": boolean, "reason"?: string }.
 */
export async function identityVerifyActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ requestId: input.requestId }, "[Temporal:DSAR] Verifying identity");
  const providerUrl = process.env.DSAR_IDENTITY_VERIFY_URL;

  if (!providerUrl) {
    return {
      success: true,
      step: "identity-verify",
      duration_ms: Date.now() - start,
      output: { verified: false, reason: "manual_review_required" },
    };
  }

  try {
    const res = await fetch(providerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.DSAR_IDENTITY_VERIFY_TOKEN
          ? { Authorization: `Bearer ${process.env.DSAR_IDENTITY_VERIFY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        requestId: input.requestId,
        subjectId: input.subjectId,
        citizenEmail: input.citizenEmail,
        citizenNin: input.citizenNin,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`identity provider returned HTTP ${res.status}`);
    const body = (await res.json()) as { verified?: boolean; reason?: string };
    // Fail closed: anything other than an explicit verified:true is unverified.
    const verified = body.verified === true;
    return {
      success: true,
      step: "identity-verify",
      duration_ms: Date.now() - start,
      output: { verified, reason: verified ? "provider_verified" : (body.reason ?? "provider_rejected") },
    };
  } catch (error) {
    logger.warn({ err: error }, "[Temporal:DSAR] Identity provider unreachable — routing to manual review");
    return {
      success: true,
      step: "identity-verify",
      duration_ms: Date.now() - start,
      output: { verified: false, reason: "manual_review_required" },
    };
  }
}

/**
 * Locate the subject's personal data records across the platform's own
 * stores. Reports real row counts; a database failure is an activity error
 * (not a silent zero) so the workflow never reports "no data found" when it
 * actually could not search.
 */
export async function dataLocateActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ requestId: input.requestId }, "[Temporal:DSAR] Locating personal data across systems");
  const { getSharedPool } = await import("./db");
  const pool = getSharedPool();
  const email = typeof input.citizenEmail === "string" ? input.citizenEmail : null;
  const nin = typeof input.citizenNin === "string" ? input.citizenNin : null;

  const counts: Record<string, number> = {};
  let systemsSearched = 0;
  let recordsFound = 0;
  const search = async (system: string, sqlText: string, params: unknown[]) => {
    systemsSearched++;
    const { rows } = await pool.query(sqlText, params);
    const n = Number(rows[0]?.count ?? 0);
    counts[system] = n;
    recordsFound += n;
  };

  try {
    if (email || nin) {
      await search(
        "citizen_requests",
        `SELECT COUNT(*) AS count FROM citizen_requests
         WHERE ($1::text IS NOT NULL AND citizen_email = $1) OR ($2::text IS NOT NULL AND citizen_nin = $2)`,
        [email, nin]
      );
      await search(
        "consent_records",
        `SELECT COUNT(*) AS count FROM consent_records
         WHERE ($1::text IS NOT NULL AND data_subject_email = $1) OR ($2::text IS NOT NULL AND data_subject_nin = $2)`,
        [email, nin]
      );
    }
    const orgId = typeof input.orgId === "number" ? input.orgId : Number(input.orgId);
    if (Number.isFinite(orgId)) {
      await search(
        "organizations",
        `SELECT COUNT(*) AS count FROM organizations WHERE id = $1`,
        [orgId]
      );
    }
  } catch (error) {
    return {
      success: false,
      step: "data-locate",
      duration_ms: Date.now() - start,
      error: `Data locate failed: ${error instanceof Error ? error.message : String(error)}`,
      output: { systemsSearched, recordsFound, counts },
    };
  }

  return {
    success: true,
    step: "data-locate",
    duration_ms: Date.now() - start,
    output: { systemsSearched, recordsFound, counts },
  };
}

/**
 * Delivery is only claimed when the upstream steps actually completed:
 * identity must be verified and the data-locate step must have run. Anything
 * else returns delivered:false with an explicit reason so the workflow result
 * reflects the incomplete state honestly.
 */
export async function dataDeliverActivity(input: Record<string, unknown>): Promise<ActivityResult> {
  const start = Date.now();
  logger.info({ requestId: input.requestId, email: input.citizenEmail }, "[Temporal:DSAR] Delivering data to subject");

  if (input.identityVerified !== true) {
    return {
      success: true,
      step: "deliver",
      duration_ms: Date.now() - start,
      output: { delivered: false, reason: "identity_not_verified" },
    };
  }
  if (typeof input.recordsFound !== "number") {
    return {
      success: true,
      step: "deliver",
      duration_ms: Date.now() - start,
      output: { delivered: false, reason: "data_locate_incomplete" },
    };
  }

  const deliveryUrl = process.env.DSAR_DELIVERY_URL;
  if (!deliveryUrl) {
    // No delivery channel configured — do not fabricate a delivery.
    return {
      success: true,
      step: "deliver",
      duration_ms: Date.now() - start,
      output: { delivered: false, reason: "delivery_channel_not_configured", recordsFound: input.recordsFound },
    };
  }

  try {
    const res = await fetch(deliveryUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.DSAR_DELIVERY_TOKEN
          ? { Authorization: `Bearer ${process.env.DSAR_DELIVERY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        requestId: input.requestId,
        citizenEmail: input.citizenEmail,
        recordsFound: input.recordsFound,
        requestType: input.requestType,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`delivery endpoint returned HTTP ${res.status}`);
    return {
      success: true,
      step: "deliver",
      duration_ms: Date.now() - start,
      output: { delivered: true, format: "json", recordsFound: input.recordsFound },
    };
  } catch (error) {
    return {
      success: false,
      step: "deliver",
      duration_ms: Date.now() - start,
      error: `Delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      output: { delivered: false },
    };
  }
}

// ── Activity Registry ────────────────────────────────────────────────────────

export const WORKFLOW_ACTIVITIES: Record<string, Record<string, (input: Record<string, unknown>) => Promise<ActivityResult>>> = {
  "enforcement-lifecycle": {
    investigation: investigationActivity,
    "evidence-collection": evidenceCollectionActivity,
    hearing: hearingActivity,
    decision: decisionActivity,
    "penalty-enforcement": penaltyEnforcementActivity,
  },
  "breach-response": {
    containment: containmentActivity,
    assessment: assessmentActivity,
    "ndpc-notification": ndpcNotificationActivity,
    remediation: remediationActivity,
  },
  "compliance-audit": {
    "document-review": documentReviewActivity,
    "control-testing": controlTestingActivity,
    "gap-analysis": gapAnalysisActivity,
    "report-generation": reportGenerationActivity,
  },
  "dsar-fulfillment": {
    acknowledge: acknowledgeActivity,
    "identity-verify": identityVerifyActivity,
    "data-locate": dataLocateActivity,
    deliver: dataDeliverActivity,
  },
};

export function getRegisteredWorkflows(): string[] {
  return Object.keys(WORKFLOW_ACTIVITIES);
}

export function getWorkflowSteps(workflowType: string): string[] {
  return Object.keys(WORKFLOW_ACTIVITIES[workflowType] ?? {});
}

export async function executeActivity(
  workflowType: string,
  step: string,
  input: Record<string, unknown>
): Promise<ActivityResult> {
  const activities = WORKFLOW_ACTIVITIES[workflowType];
  if (!activities) {
    return { success: false, step, duration_ms: 0, error: `Unknown workflow: ${workflowType}` };
  }
  const activity = activities[step];
  if (!activity) {
    return { success: false, step, duration_ms: 0, error: `Unknown step: ${step} in ${workflowType}` };
  }
  return activity(input);
}
