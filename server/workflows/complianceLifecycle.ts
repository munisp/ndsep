/**
 * Compliance Lifecycle Workflow Engine
 * ======================================
 * Manages the full lifecycle of compliance policies, violations, and enforcement.
 *
 * Workflows:
 * 1. Organization Onboarding → Registration → Assessment → Certification
 * 2. Violation Detection → Investigation → Adjudication → Enforcement
 * 3. Breach Notification → Response → Remediation → Closure
 * 4. DPIA → Risk Assessment → Approval → Monitoring
 * 5. Data Subject Request → Validation → Processing → Completion
 */

import { getPool } from "../db";
import { logger } from "../logger";

export type WorkflowState =
  | "draft" | "submitted" | "under_review" | "approved" | "rejected"
  | "investigating" | "escalated" | "penalty_imposed" | "appealed"
  | "resolved" | "closed" | "expired" | "suspended";

export interface WorkflowTransition {
  from: WorkflowState;
  to: WorkflowState;
  action: string;
  requiredRole: string;
  conditions?: (ctx: WorkflowContext) => boolean;
  sideEffects?: (ctx: WorkflowContext) => Promise<void>;
}

export interface WorkflowContext {
  entityType: string;
  entityId: number;
  userId: number;
  userRole: string;
  metadata?: Record<string, unknown>;
}

// ── Organization Compliance Lifecycle ────────────────────────────────────────

const ORG_COMPLIANCE_TRANSITIONS: WorkflowTransition[] = [
  { from: "draft", to: "submitted", action: "submit_registration", requiredRole: "dpco_admin" },
  { from: "submitted", to: "under_review", action: "start_review", requiredRole: "admin" },
  { from: "under_review", to: "approved", action: "approve_registration", requiredRole: "admin",
    sideEffects: async (ctx) => {
      const pool = getPool();
      if (!pool) return;
      await pool.query(
        "UPDATE organizations SET compliance_status = 'compliant', updated_at = NOW() WHERE id = $1",
        [ctx.entityId]
      );
      await pool.query(
        "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at) VALUES ($1, 'approve_registration', 'organization', $2, $3, NOW())",
        [ctx.userId, ctx.entityId, JSON.stringify({ approved: true })]
      );
    }
  },
  { from: "under_review", to: "rejected", action: "reject_registration", requiredRole: "admin" },
  { from: "approved", to: "suspended", action: "suspend_organization", requiredRole: "admin" },
  { from: "suspended", to: "approved", action: "reinstate_organization", requiredRole: "admin" },
];

// ── Violation Enforcement Lifecycle ──────────────────────────────────────────

const VIOLATION_TRANSITIONS: WorkflowTransition[] = [
  { from: "draft", to: "submitted", action: "report_violation", requiredRole: "admin" },
  { from: "submitted", to: "investigating", action: "start_investigation", requiredRole: "admin" },
  { from: "investigating", to: "escalated", action: "escalate_violation", requiredRole: "admin",
    conditions: (ctx) => (ctx.metadata?.severity as string) === "critical" || (ctx.metadata?.severity as string) === "high",
  },
  { from: "investigating", to: "resolved", action: "resolve_violation", requiredRole: "admin" },
  { from: "escalated", to: "penalty_imposed", action: "impose_penalty", requiredRole: "admin",
    sideEffects: async (ctx) => {
      const pool = getPool();
      if (!pool) return;
      const amount = ctx.metadata?.penaltyAmount ?? 0;
      await pool.query(
        "INSERT INTO financial_penalties (organization_id, violation_id, amount, currency, status, issued_date, created_at) VALUES ($1, $2, $3, 'NGN', 'pending', NOW(), NOW())",
        [ctx.metadata?.organizationId, ctx.entityId, amount]
      );
    }
  },
  { from: "penalty_imposed", to: "appealed", action: "file_appeal", requiredRole: "dpco_admin" },
  { from: "appealed", to: "resolved", action: "uphold_appeal", requiredRole: "admin" },
  { from: "appealed", to: "penalty_imposed", action: "reject_appeal", requiredRole: "admin" },
  { from: "penalty_imposed", to: "resolved", action: "penalty_paid", requiredRole: "admin" },
];

// ── Breach Notification Lifecycle ────────────────────────────────────────────

const BREACH_TRANSITIONS: WorkflowTransition[] = [
  { from: "draft", to: "submitted", action: "report_breach", requiredRole: "dpco_admin" },
  { from: "submitted", to: "investigating", action: "acknowledge_breach", requiredRole: "admin" },
  { from: "investigating", to: "escalated", action: "escalate_breach", requiredRole: "admin",
    conditions: (ctx) => (ctx.metadata?.affectedRecords as number) > 10000,
  },
  { from: "investigating", to: "resolved", action: "resolve_breach", requiredRole: "admin" },
  { from: "escalated", to: "resolved", action: "resolve_escalated_breach", requiredRole: "admin" },
  { from: "resolved", to: "closed", action: "close_breach", requiredRole: "admin" },
];

// ── DPIA Workflow ────────────────────────────────────────────────────────────

const DPIA_TRANSITIONS: WorkflowTransition[] = [
  { from: "draft", to: "submitted", action: "submit_dpia", requiredRole: "dpco_admin" },
  { from: "submitted", to: "under_review", action: "start_dpia_review", requiredRole: "admin" },
  { from: "under_review", to: "approved", action: "approve_dpia", requiredRole: "admin" },
  { from: "under_review", to: "rejected", action: "reject_dpia", requiredRole: "admin" },
  { from: "rejected", to: "draft", action: "revise_dpia", requiredRole: "dpco_admin" },
];

// ── Data Subject Request (DSAR) Workflow ─────────────────────────────────────

const DSAR_TRANSITIONS: WorkflowTransition[] = [
  { from: "draft", to: "submitted", action: "submit_dsar", requiredRole: "user" },
  { from: "submitted", to: "under_review", action: "validate_dsar", requiredRole: "admin" },
  { from: "under_review", to: "approved", action: "complete_dsar", requiredRole: "admin" },
  { from: "under_review", to: "rejected", action: "reject_dsar", requiredRole: "admin" },
];

// ── Workflow Engine ──────────────────────────────────────────────────────────

const WORKFLOW_MAP: Record<string, WorkflowTransition[]> = {
  organization: ORG_COMPLIANCE_TRANSITIONS,
  violation: VIOLATION_TRANSITIONS,
  breach: BREACH_TRANSITIONS,
  dpia: DPIA_TRANSITIONS,
  dsar: DSAR_TRANSITIONS,
};

export function getAvailableActions(entityType: string, currentState: WorkflowState, userRole: string): string[] {
  const transitions = WORKFLOW_MAP[entityType] ?? [];
  return transitions
    .filter(t => t.from === currentState && (t.requiredRole === userRole || userRole === "admin"))
    .map(t => t.action);
}

export async function executeTransition(ctx: WorkflowContext, action: string): Promise<{ success: boolean; newState?: WorkflowState; error?: string }> {
  const transitions = WORKFLOW_MAP[ctx.entityType] ?? [];
  const pool = getPool();
  if (!pool) return { success: false, error: "Database unavailable" };

  // Get current state
  const stateResult = await pool.query(
    `SELECT status FROM ${getTableName(ctx.entityType)} WHERE id = $1`,
    [ctx.entityId]
  );
  if (stateResult.rows.length === 0) return { success: false, error: "Entity not found" };
  const currentState = stateResult.rows[0].status as WorkflowState;

  // Find matching transition
  const transition = transitions.find(t =>
    t.from === currentState && t.action === action && (t.requiredRole === ctx.userRole || ctx.userRole === "admin")
  );

  if (!transition) {
    return { success: false, error: `Invalid transition: ${action} from state ${currentState} for role ${ctx.userRole}` };
  }

  // Check conditions
  if (transition.conditions && !transition.conditions(ctx)) {
    return { success: false, error: "Transition conditions not met" };
  }

  // Execute transition with optimistic locking (prevent concurrent state changes)
  const updateResult = await pool.query(
    `UPDATE ${getTableName(ctx.entityType)} SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3`,
    [transition.to, ctx.entityId, currentState]
  );

  if (updateResult.rowCount === 0) {
    return { success: false, error: `Concurrent modification detected: entity ${ctx.entityId} is no longer in state '${currentState}'. Refresh and retry.` };
  }

  // Run side effects
  if (transition.sideEffects) {
    try {
      await transition.sideEffects(ctx);
    } catch (err) {
      logger.error({ err, ctx }, "Workflow side effect failed");
    }
  }

  // Audit trail
  await pool.query(
    "INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, created_at) VALUES ($1, $2, $3, $4, $5, NOW())",
    [ctx.userId, action, ctx.entityType, ctx.entityId, JSON.stringify({ from: currentState, to: transition.to })]
  );

  return { success: true, newState: transition.to };
}

function getTableName(entityType: string): string {
  const map: Record<string, string> = {
    organization: "organizations",
    violation: "compliance_violations",
    breach: "breach_incidents",
    dpia: "dpia_assessments",
    dsar: "dsar_requests",
  };
  return map[entityType] ?? entityType;
}
