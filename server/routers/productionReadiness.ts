/**
 * NDSEP Production Readiness Router
 * ====================================
 * Exposes production monitoring, error tracking, middleware health,
 * worker management, and Keycloak auth status via tRPC procedures.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getErrorSummary, getErrorMetrics } from "../errorMonitoring";
import { getKeycloakConfig, getKeycloakHealthStatus, isKeycloakEnabled } from "../keycloakAuth";
import { getAllMiddlewareStatuses, getCachedStatus } from "../middlewareConnector";
import { getBuildStatus } from "../workerBuilder";
import { getEventBusMetrics } from "../eventBus";
import { getWorkflowDefinitions, getWorkflowHealth } from "../workflows";
import { getAutoStartStatus, getServiceDefinitions } from "../serviceAutoStart";
import { getModelDefinitions, getPipelineStatus } from "../mlPipeline";
import { checkK8sReadiness } from "../k8sReadiness";

export type ProductionReadinessInputs = {
  middleware: {
    services: Array<{ name: string; status: string }>;
    overall: string;
    connected: number;
    total: number;
  };
  builds: Array<{ success: boolean }>;
  errors: { errorsLastMinute: number; totalErrors: number };
  keycloak: { enabled: boolean; jwksCached: boolean; jwksCacheAge: number | null };
};

/**
 * Evaluate only evidence that is currently observable by this process.
 * Authentication is not production-ready merely because a demo fallback exists:
 * Keycloak must be enabled and must have a fresh verified JWKS cache.
 */
export function evaluateProductionReadinessChecks({
  middleware,
  builds,
  errors,
  keycloak,
}: ProductionReadinessInputs) {
  const keycloakCacheIsFresh =
    keycloak.enabled &&
    keycloak.jwksCached &&
    keycloak.jwksCacheAge !== null &&
    keycloak.jwksCacheAge <= 3600;

  return [
    { name: "PostgreSQL Connected", pass: middleware.services.some((s) => s.name === "PostgreSQL" && s.status === "connected") },
    { name: "Redis Available", pass: middleware.services.some((s) => s.name === "Redis" && s.status !== "disconnected") },
    { name: "Error Rate Normal", pass: errors.errorsLastMinute < 10 },
    { name: "Worker Binaries Built", pass: builds.length > 0 && builds.filter((b) => b.success).length > builds.length / 2 },
    { name: "Keycloak Verification Ready", pass: keycloakCacheIsFresh },
    { name: "Middleware Health", pass: middleware.overall !== "unhealthy" },
  ];
}

export const productionReadinessRouter = router({
  // ─── Error Monitoring ────────────────────────────────────────────────────
  errorSummary: protectedProcedure.query(() => {
    return getErrorSummary();
  }),

  errorMetrics: protectedProcedure.query(() => {
    return getErrorMetrics();
  }),

  // ─── Middleware Health ───────────────────────────────────────────────────
  middlewareHealth: protectedProcedure.query(async () => {
    return getAllMiddlewareStatuses();
  }),

  middlewareStatus: protectedProcedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => {
      return getCachedStatus(input.name) ?? { name: input.name, status: "unknown" };
    }),

  // ─── Authentication Status ──────────────────────────────────────────────
  authConfig: protectedProcedure.query(() => {
    return {
      keycloak: getKeycloakConfig(),
      health: getKeycloakHealthStatus(),
      mode: isKeycloakEnabled() ? "keycloak" : "demo-login",
    };
  }),

  // ─── Worker Build Status ────────────────────────────────────────────────
  workerBuildStatus: protectedProcedure.query(() => {
    return getBuildStatus();
  }),

  // ─── Production Readiness Score ─────────────────────────────────────────
  readinessScore: protectedProcedure.query(async () => {
    const middleware = await getAllMiddlewareStatuses();
    const builds = getBuildStatus();
    const errors = getErrorSummary();
    const keycloak = getKeycloakHealthStatus();

    const checks = evaluateProductionReadinessChecks({ middleware, builds, errors, keycloak });

    const passed = checks.filter((c) => c.pass).length;
    const score = Math.round((passed / checks.length) * 100);

    return {
      score,
      level: score >= 80 ? "production" : score >= 50 ? "staging" : "development",
      checks,
      middleware: { overall: middleware.overall, connected: middleware.connected, total: middleware.total },
      errors: { lastMinute: errors.errorsLastMinute, total: errors.totalErrors },
    };
  }),

  // ─── Seed Data Summary ──────────────────────────────────────────────────
  seedDataSummary: protectedProcedure.query(async () => {
    const { getPool } = await import("../db");
    const pool = getPool();
    if (!pool) return { tables: [], totalRows: 0 };

    const result = await pool.query(`
      SELECT schemaname, relname as table_name, n_live_tup as row_count
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY n_live_tup DESC
      LIMIT 50
    `);

    const tables = result.rows.map((r: { table_name: string; row_count: string }) => ({
      name: r.table_name,
      rows: parseInt(r.row_count, 10),
    }));

    return {
      tables,
      totalRows: tables.reduce((sum: number, t: { rows: number }) => sum + t.rows, 0),
      tablesWithData: tables.filter((t: { rows: number }) => t.rows > 0).length,
      tablesEmpty: tables.filter((t: { rows: number }) => t.rows === 0).length,
    };
  }),

  // ─── Event Bus (TIER 2) ─────────────────────────────────────────────────
  eventBusMetrics: protectedProcedure.query(() => {
    return getEventBusMetrics();
  }),

  // ─── Temporal Workflows (TIER 2) ────────────────────────────────────────
  workflowDefinitions: protectedProcedure.query(() => {
    return getWorkflowDefinitions();
  }),

  workflowHealth: protectedProcedure.query(() => {
    return getWorkflowHealth();
  }),

  // ─── Service Auto-Start (TIER 2) ───────────────────────────────────────
  serviceStatus: protectedProcedure.query(() => {
    return getAutoStartStatus();
  }),

  serviceDefinitions: protectedProcedure.query(() => {
    return getServiceDefinitions();
  }),

  // ─── ML Pipeline (TIER 3) ──────────────────────────────────────────────
  mlModels: protectedProcedure.query(() => {
    return getModelDefinitions();
  }),

  mlPipelineStatus: protectedProcedure.query(async () => {
    return getPipelineStatus();
  }),

  // ─── K8s Readiness (TIER 3) ────────────────────────────────────────────
  k8sReadiness: protectedProcedure.query(() => {
    return checkK8sReadiness();
  }),
});
