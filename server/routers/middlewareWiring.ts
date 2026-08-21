/**
 * Middleware Wiring Router
 * Connects all 14 middleware services into the tRPC API layer:
 * - Temporal: workflow orchestration for enforcement/compliance/breach lifecycle
 * - OpenSearch: full-text search across all entities
 * - OpenAppSec: WAF threat intelligence and IP blocking
 * - APISIX: API gateway route management and rate limiting
 * - Permify: relationship-based authorization checks
 * - TigerBeetle: financial ledger queries
 * - Keycloak: token introspection and session management
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { startWorkflow, describeWorkflow, listWorkflows } from "../temporal";
import { opensearchGlobalSearch, opensearchSearch, opensearchIndex } from "../middlewareExtensions";
import { openappsecHealth, listPolicies, getRecentThreats, getThreatStats, blockIp, unblockIp } from "../openappsec";
import { apisixHealth, apisixListRoutes, apisixSyncNdsepRoutes } from "../apisix";
import { permifyCheck, permifyWriteRelationship } from "../middlewareExtensions";
import { tigerbeetleTransfer } from "../middlewareExtensions";
import { getKafkaConsumerMetrics } from "../kafkaConsumer";
import { syncPlatformRole, syncOrgMembership, bulkSyncFromDatabase } from "../permifySync";
import { logger } from "../logger";

// ── Temporal Workflow Orchestration ──────────────────────────────────────────

export const temporalRouter = router({
  startEnforcementWorkflow: adminProcedure
    .input(z.object({
      caseId: z.string(),
      orgId: z.number(),
      orgName: z.string(),
      caseType: z.string(),
      severity: z.enum(["low", "medium", "high", "critical"]),
    }))
    .mutation(async ({ input }) => {
      return startWorkflow("enforcement-lifecycle", {
        workflowId: `enforcement-${input.caseId}`,
        taskQueue: "ndsep-enforcement",
        input: {
          caseId: input.caseId,
          orgId: input.orgId,
          orgName: input.orgName,
          caseType: input.caseType,
          severity: input.severity,
          steps: ["investigation", "evidence-collection", "hearing", "decision", "penalty-enforcement"],
        },
      });
    }),

  startBreachResponseWorkflow: protectedProcedure
    .input(z.object({
      breachId: z.string(),
      orgId: z.number(),
      severity: z.enum(["low", "medium", "high", "critical"]),
      affectedSubjects: z.number(),
    }))
    .mutation(async ({ input }) => {
      return startWorkflow("breach-response", {
        workflowId: `breach-${input.breachId}`,
        taskQueue: "ndsep-breach",
        input: {
          breachId: input.breachId,
          orgId: input.orgId,
          severity: input.severity,
          affectedSubjects: input.affectedSubjects,
          slaDeadlineHours: 72,
          steps: ["containment", "assessment", "ndpc-notification", "subject-notification", "remediation"],
        },
        executionTimeoutSeconds: 7 * 24 * 3600, // 7 days max
      });
    }),

  startComplianceAuditWorkflow: adminProcedure
    .input(z.object({
      auditId: z.string(),
      orgId: z.number(),
      auditType: z.enum(["annual", "spot-check", "complaint-triggered", "renewal"]),
      scope: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      return startWorkflow("compliance-audit", {
        workflowId: `audit-${input.auditId}`,
        taskQueue: "ndsep-compliance",
        input: {
          auditId: input.auditId,
          orgId: input.orgId,
          auditType: input.auditType,
          scope: input.scope,
          steps: ["document-request", "on-site-review", "findings", "remediation-plan", "follow-up"],
        },
        executionTimeoutSeconds: 30 * 24 * 3600, // 30 days max
      });
    }),

  startDsarWorkflow: protectedProcedure
    .input(z.object({
      dsarId: z.string(),
      requestType: z.enum(["access", "erasure", "rectification", "portability", "objection"]),
      subjectId: z.string(),
      orgId: z.number(),
    }))
    .mutation(async ({ input }) => {
      return startWorkflow("dsar-fulfillment", {
        workflowId: `dsar-${input.dsarId}`,
        taskQueue: "ndsep-dsar",
        input: {
          dsarId: input.dsarId,
          requestType: input.requestType,
          subjectId: input.subjectId,
          orgId: input.orgId,
          slaDeadlineHours: 720, // 30 days
          steps: ["identity-verification", "data-collection", "review", "fulfillment", "confirmation"],
        },
      });
    }),

  describe: protectedProcedure
    .input(z.object({ workflowId: z.string(), runId: z.string().optional() }))
    .query(async ({ input }) => {
      return describeWorkflow(input.workflowId, input.runId);
    }),

  list: protectedProcedure
    .input(z.object({ status: z.string().optional(), limit: z.number().default(20) }))
    .query(async ({ input }) => {
      return listWorkflows({ query: input.status ? `ExecutionStatus = "${input.status}"` : undefined });
    }),
});

// ── OpenSearch Full-Text Search ─────────────────────────────────────────────

export const searchRouter = router({
  global: protectedProcedure
    .input(z.object({
      query: z.string().min(1).max(500),
      sectors: z.array(z.string()).optional(),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      return opensearchGlobalSearch(input.query, input.sectors);
    }),

  enforcement: protectedProcedure
    .input(z.object({ query: z.string(), status: z.string().optional() }))
    .query(async ({ input }) => {
      return opensearchSearch("enforcement_events", {
        query: { bool: { must: [{ multi_match: { query: input.query, fields: ["*"] } }], ...(input.status ? { filter: [{ term: { status: input.status } }] } : {}) } },
        size: 50,
      });
    }),

  compliance: protectedProcedure
    .input(z.object({ query: z.string(), orgId: z.number().optional() }))
    .query(async ({ input }) => {
      return opensearchSearch("compliance_events", {
        query: { bool: { must: [{ multi_match: { query: input.query, fields: ["*"] } }], ...(input.orgId ? { filter: [{ term: { org_id: input.orgId } }] } : {}) } },
        size: 50,
      });
    }),

  breach: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      return opensearchSearch("breach_events", {
        query: { multi_match: { query: input.query, fields: ["*"] } },
        size: 50,
      });
    }),

  banking: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      return opensearchSearch("banking_events", {
        query: { multi_match: { query: input.query, fields: ["*"] } },
        size: 50,
      });
    }),

  indexDocument: adminProcedure
    .input(z.object({ index: z.string(), document: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ input }) => {
      await opensearchIndex(input.index, input.document);
      return { success: true };
    }),
});

// ── OpenAppSec WAF Management ───────────────────────────────────────────────

export const wafRouter = router({
  health: protectedProcedure.query(async () => {
    return openappsecHealth();
  }),

  policies: protectedProcedure.query(async () => {
    return listPolicies();
  }),

  threats: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ input }) => {
      return getRecentThreats(input.limit);
    }),

  stats: protectedProcedure.query(async () => {
    return getThreatStats();
  }),

  blockIp: adminProcedure
    .input(z.object({ ip: z.string(), reason: z.string(), durationMinutes: z.number().default(1440) }))
    .mutation(async ({ input }) => {
      const success = await blockIp(input.ip, input.reason, input.durationMinutes);
      return { success, ip: input.ip, duration: input.durationMinutes };
    }),

  unblockIp: adminProcedure
    .input(z.object({ ip: z.string() }))
    .mutation(async ({ input }) => {
      const success = await unblockIp(input.ip);
      return { success, ip: input.ip };
    }),
});

// ── APISIX Gateway Management ───────────────────────────────────────────────

export const gatewayRouter = router({
  health: protectedProcedure.query(async () => {
    return apisixHealth();
  }),

  routes: protectedProcedure.query(async () => {
    return apisixListRoutes();
  }),

  syncRoutes: adminProcedure.mutation(async () => {
    return apisixSyncNdsepRoutes();
  }),
});

// ── Permify Authorization Management ────────────────────────────────────────

export const authzRouter = router({
  check: protectedProcedure
    .input(z.object({
      entityType: z.string(),
      entityId: z.string(),
      permission: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const result = await permifyCheck(
        String(ctx.user.id),
        input.entityType,
        input.entityId,
        input.permission
      );
      return { allowed: result };
    }),

  writeRelationship: adminProcedure
    .input(z.object({
      entityType: z.string(),
      entityId: z.string(),
      relation: z.string(),
      subjectId: z.string(),
    }))
    .mutation(async ({ input }) => {
      await permifyWriteRelationship(input.entityType, input.entityId, input.relation, input.subjectId);
      return { success: true };
    }),

  syncUserRole: adminProcedure
    .input(z.object({ userId: z.string(), role: z.string() }))
    .mutation(async ({ input }) => {
      await syncPlatformRole(input.userId, input.role);
      return { success: true };
    }),

  syncOrgMember: adminProcedure
    .input(z.object({ userId: z.string(), orgId: z.number(), role: z.string() }))
    .mutation(async ({ input }) => {
      await syncOrgMembership(input.userId, input.orgId, input.role);
      return { success: true };
    }),

  bulkSync: adminProcedure.mutation(async () => {
    const { getSharedPool } = await import("../db");
    const pool = getSharedPool();
    if (!pool) return { synced: 0, errors: 0, message: "No database pool available" };
    return bulkSyncFromDatabase(pool);
  }),
});

// ── Kafka Consumer Metrics ──────────────────────────────────────────────────

export const kafkaMetricsRouter = router({
  consumerStatus: protectedProcedure.query(() => {
    return getKafkaConsumerMetrics();
  }),
});

// ── TigerBeetle Ledger Operations ───────────────────────────────────────────

export const ledgerRouter = router({
  transfer: adminProcedure
    .input(z.object({
      debitAccountId: z.string(),
      creditAccountId: z.string(),
      amount: z.number().positive(),
      currency: z.string().default("NGN"),
      reference: z.string(),
      transferType: z.string(),
    }))
    .mutation(async ({ input }) => {
      await tigerbeetleTransfer(input);
      return { success: true, reference: input.reference };
    }),
});
