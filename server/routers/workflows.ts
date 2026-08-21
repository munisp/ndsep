/**
 * Workflow tRPC Router
 * =====================
 * Exposes compliance lifecycle workflows via tRPC.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getAvailableActions, executeTransition, WorkflowState } from "../workflows/complianceLifecycle";
import { calculatePenalty, calculateComplianceScore, calculateRiskScore, checkSlaBreach, checkRenewalEligibility, checkCrossBorderAdequacy } from "../workflows/businessRules";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { logger } from "../logger";

export const workflowRouter = router({
  // Get available workflow actions for an entity
  getAvailableActions: protectedProcedure
    .input(z.object({
      entityType: z.string(),
      entityId: z.number(),
      currentState: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const userRole = (ctx as any).user?.role ?? "user";
      return getAvailableActions(input.entityType, input.currentState as WorkflowState, userRole);
    }),

  // Execute a workflow transition
  executeTransition: protectedProcedure
    .input(z.object({
      entityType: z.string(),
      entityId: z.number(),
      action: z.string(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = (ctx as any).user?.id ?? 0;
      const userRole = (ctx as any).user?.role ?? "user";
      const result = executeTransition({
        entityType: input.entityType,
        entityId: input.entityId,
        userId,
        userRole,
        metadata: input.metadata,
      }, input.action);
      emitMutationEvent(EVENTS.WORKFLOW_TRANSITION, {
        entityType: input.entityType, entityId: input.entityId,
        action: input.action, userId, userRole,
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  // Calculate penalty amount
  calculatePenalty: protectedProcedure
    .input(z.object({
      organizationId: z.number(),
      violationType: z.string(),
      severity: z.enum(["low", "medium", "high", "critical"]),
      affectedRecords: z.number().default(0),
      isRepeatOffender: z.boolean().default(false),
      annualTurnover: z.number().optional(),
    }))
    .query(({ input }) => {
      return calculatePenalty(input);
    }),

  // Calculate compliance score
  calculateComplianceScore: protectedProcedure
    .input(z.object({
      hasDpo: z.boolean(),
      hasPrivacyPolicy: z.boolean(),
      hasConsentMechanism: z.boolean(),
      hasBreachNotificationProcess: z.boolean(),
      hasDpia: z.boolean(),
      hasDataRetentionPolicy: z.boolean(),
      hasSecurityMeasures: z.boolean(),
      hasRecordOfProcessing: z.boolean(),
      openViolations: z.number().default(0),
      resolvedViolations: z.number().default(0),
      breachCount: z.number().default(0),
      lastAuditDate: z.string().nullable().optional(),
    }))
    .query(({ input }) => {
      return calculateComplianceScore({
        ...input,
        lastAuditDate: input.lastAuditDate ? new Date(input.lastAuditDate) : null,
      });
    }),

  // Calculate risk score
  calculateRiskScore: protectedProcedure
    .input(z.object({
      sector: z.string(),
      dataVolume: z.enum(["low", "medium", "high", "very_high"]),
      crossBorderTransfers: z.boolean(),
      sensitiveData: z.boolean(),
      automatedDecisions: z.boolean(),
      previousBreaches: z.number().default(0),
      complianceScore: z.number().default(50),
    }))
    .query(({ input }) => {
      return calculateRiskScore(input);
    }),

  // Check SLA breach
  checkSla: protectedProcedure
    .input(z.object({
      entityType: z.enum(["violation", "breach", "dsar", "appeal"]),
      createdAt: z.string(),
      currentStatus: z.string(),
    }))
    .query(({ input }) => {
      return checkSlaBreach({
        entityType: input.entityType,
        createdAt: new Date(input.createdAt),
        currentStatus: input.currentStatus,
      });
    }),

  // Check renewal eligibility
  checkRenewalEligibility: protectedProcedure
    .input(z.object({ organizationId: z.number() }))
    .query(async ({ input }) => {
      return checkRenewalEligibility(input.organizationId);
    }),

  // Check cross-border transfer adequacy
  checkCrossBorderAdequacy: protectedProcedure
    .input(z.object({ destinationCountry: z.string() }))
    .query(({ input }) => {
      return checkCrossBorderAdequacy(input.destinationCountry);
    }),
});
