/**
 * NDSEP Temporal Workflow Definitions
 * =====================================
 * Production workflow definitions for compliance enforcement,
 * breach SLA tracking, and regulatory processes.
 *
 * Workflows:
 *   breachSlaEnforcement    — Monitors breach notification deadlines
 *   penaltyCollection       — Manages penalty issuance → payment → appeal lifecycle
 *   complianceAudit         — Orchestrates scheduled compliance audits
 *   consentLifecycle        — Tracks consent expiry and renewal
 *   crossBorderTransfer     — Manages cross-border data transfer approvals
 *   dpcoOnboarding          — DPCO organization onboarding workflow
 *
 * Each workflow:
 *   - Starts via Temporal (or HTTP fallback when Temporal is unavailable)
 *   - Publishes events to Kafka event bus
 *   - Persists state to PostgreSQL
 *   - Supports cancellation and human-in-the-loop approval
 */

import { startWorkflow, describeWorkflow, getTemporalConfig } from "./temporal";
import { publishEvent } from "./eventBus";
import { captureError } from "./errorMonitoring";
import { logger } from "./logger";

export interface WorkflowDefinition {
  name: string;
  description: string;
  taskQueue: string;
  defaultTimeout: number; // seconds
  steps: string[];
}

export const WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    name: "breach_sla_enforcement",
    description: "Monitors breach notification SLA (72h NDPA default). Escalates if deadline approaches.",
    taskQueue: "ndsep-compliance",
    defaultTimeout: 259200, // 72 hours
    steps: [
      "detect_breach",
      "assess_severity",
      "notify_dpo",
      "check_ndpc_notification_deadline",
      "escalate_if_overdue",
      "notify_affected_individuals",
      "close_breach",
    ],
  },
  {
    name: "penalty_collection",
    description: "Manages financial penalty lifecycle from issuance through payment or appeal.",
    taskQueue: "ndsep-finance",
    defaultTimeout: 2592000, // 30 days
    steps: [
      "issue_penalty",
      "send_notification",
      "await_payment_or_appeal",
      "process_payment",
      "handle_appeal",
      "settle_or_escalate",
      "close_case",
    ],
  },
  {
    name: "compliance_audit",
    description: "Orchestrates scheduled compliance audits for registered organizations.",
    taskQueue: "ndsep-compliance",
    defaultTimeout: 604800, // 7 days
    steps: [
      "schedule_audit",
      "assign_auditor",
      "collect_evidence",
      "evaluate_compliance",
      "generate_report",
      "notify_organization",
      "track_remediation",
    ],
  },
  {
    name: "consent_lifecycle",
    description: "Tracks consent records from creation through expiry, with renewal reminders.",
    taskQueue: "ndsep-consent",
    defaultTimeout: 31536000, // 1 year
    steps: [
      "record_consent",
      "validate_lawful_basis",
      "schedule_expiry_check",
      "send_renewal_reminder",
      "process_withdrawal",
      "archive_expired",
    ],
  },
  {
    name: "cross_border_transfer",
    description: "Manages cross-border data transfer approval workflow per NDPA requirements.",
    taskQueue: "ndsep-transfer",
    defaultTimeout: 1209600, // 14 days
    steps: [
      "submit_transfer_request",
      "assess_adequacy",
      "check_safeguards",
      "route_for_approval",
      "await_ndpc_decision",
      "execute_or_deny",
      "monitor_ongoing",
    ],
  },
  {
    name: "dpco_onboarding",
    description: "DPCO organization onboarding: registration, KYC, certification, and activation.",
    taskQueue: "ndsep-dpco",
    defaultTimeout: 2592000, // 30 days
    steps: [
      "submit_application",
      "verify_kyc",
      "assess_capability",
      "issue_certificate",
      "activate_account",
      "schedule_first_audit",
    ],
  },
];

// ─── Workflow Execution ──────────────────────────────────────────────────────

export async function startComplianceWorkflow(
  workflowName: string,
  input: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<{ ok: boolean; workflowId: string; runId?: string; error?: string }> {
  const def = WORKFLOW_DEFINITIONS.find((w) => w.name === workflowName);
  if (!def) {
    return { ok: false, workflowId: "", error: `Unknown workflow: ${workflowName}` };
  }

  const workflowId = idempotencyKey ?? `${workflowName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const result = await startWorkflow(workflowName, {
      workflowId,
      input,
      taskQueue: def.taskQueue,
      executionTimeoutSeconds: def.defaultTimeout,
    });

    if (result.ok) {
      // Publish event
      await publishEvent(
        "compliance.audit_completed",
        workflowId,
        "workflow",
        { workflowName, input, runId: result.runId },
      );
      logger.info({ workflowId, workflowName, runId: result.runId }, "[Workflows] Started");
    }

    return {
      ok: result.ok,
      workflowId: result.workflowId,
      runId: result.runId,
      error: result.error,
    };
  } catch (err) {
    captureError(err instanceof Error ? err : new Error(String(err)), "workflow-start");
    return {
      ok: false,
      workflowId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getWorkflowStatus(workflowId: string) {
  try {
    return await describeWorkflow(workflowId);
  } catch (err) {
    captureError(err instanceof Error ? err : new Error(String(err)), "workflow-status");
    return null;
  }
}

export function getWorkflowDefinitions() {
  return WORKFLOW_DEFINITIONS.map((d) => ({
    name: d.name,
    description: d.description,
    taskQueue: d.taskQueue,
    defaultTimeoutHours: Math.round(d.defaultTimeout / 3600),
    steps: d.steps,
    stepCount: d.steps.length,
  }));
}

export function getWorkflowHealth() {
  const config = getTemporalConfig();
  return {
    temporalSdkLoaded: config.sdkLoaded,
    temporalAddress: config.address,
    namespace: config.namespace,
    isCloud: config.isCloud,
    authMethod: config.authMethod,
    workflowCount: WORKFLOW_DEFINITIONS.length,
    taskQueues: Array.from(new Set(WORKFLOW_DEFINITIONS.map((d) => d.taskQueue))),
  };
}
