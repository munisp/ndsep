/**
 * NDSEP NOC AI Agent — TypeScript Orchestrator & tRPC Router
 * ===========================================================
 * Coordinates the perception → reasoning → action agent loop.
 * Provides unified tRPC API for the AI NOC Agent Dashboard.
 *
 * Agent services:
 *   - Perception Engine (Rust :8194) — anomaly detection
 *   - Reasoning Engine (Python :8195) — root cause analysis + LLM
 *   - Action Engine (Go :8196) — autonomous remediation
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { logger } from "../logger";

const PERCEPTION_URL = "http://localhost:8194";
const REASONING_URL = "http://localhost:8195";
const ACTION_URL = "http://localhost:8196";

async function agentFetch(baseUrl: string, path: string, method = "GET", body?: unknown): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${baseUrl}${path}`, opts);
    if (!res.ok) return { error: `HTTP ${res.status}`, status: res.status };
    return await res.json();
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e), status: 0 };
  }
}

async function agentDbQuery(sql: string, params: unknown[] = []): Promise<unknown[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const result = await pool.query(sql, params);
    return result.rows;
  } catch {
    return [];
  }
}

export const nocAgentRouter = router({
  // ── Unified Agent Dashboard ─────────────────────────────────────────────
  dashboard: protectedProcedure.query(async () => {
    const [perception, reasoning, action] = await Promise.all([
      agentFetch(PERCEPTION_URL, "/api/dashboard"),
      agentFetch(REASONING_URL, "/api/dashboard"),
      agentFetch(ACTION_URL, "/api/dashboard"),
    ]);

    // DB stats
    const [memoryCount] = await agentDbQuery("SELECT count(*)::int AS count FROM noc_agent_memory") as { count: number }[];
    const [knowledgeCount] = await agentDbQuery("SELECT count(*)::int AS count FROM noc_incident_knowledge") as { count: number }[];
    const [actionCount] = await agentDbQuery("SELECT count(*)::int AS count FROM noc_agent_actions") as { count: number }[];
    const [remediationCount] = await agentDbQuery("SELECT count(*)::int AS count FROM noc_remediation_history") as { count: number }[];
    const [predictionCount] = await agentDbQuery("SELECT count(*)::int AS count FROM noc_agent_predictions") as { count: number }[];

    return {
      agents: {
        perception,
        reasoning,
        action,
      },
      database: {
        agent_memories: memoryCount?.count ?? 0,
        knowledge_entries: knowledgeCount?.count ?? 0,
        agent_actions: actionCount?.count ?? 0,
        remediations: remediationCount?.count ?? 0,
        predictions: predictionCount?.count ?? 0,
      },
      orchestrator: {
        status: "active",
        loop: "perception → reasoning → action → learning",
        auto_threshold: 0.85,
        suggest_threshold: 0.50,
      },
    };
  }),

  // ── Perception Engine ───────────────────────────────────────────────────
  anomalies: protectedProcedure.query(async () => agentFetch(PERCEPTION_URL, "/api/anomalies")),

  baselines: protectedProcedure.query(async () => agentFetch(PERCEPTION_URL, "/api/baselines")),

  predictions: protectedProcedure.query(async () => agentFetch(PERCEPTION_URL, "/api/predictions")),

  perceptionMetrics: protectedProcedure.query(async () => agentFetch(PERCEPTION_URL, "/metrics")),

  ingestMetrics: adminProcedure
    .input(z.object({
      metrics: z.array(z.object({
        service_name: z.string(),
        metric_name: z.string(),
        value: z.number(),
        timestamp: z.string().optional(),
        labels: z.record(z.string(), z.string()).optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const result = await agentFetch(PERCEPTION_URL, "/api/ingest", "POST", input);
      emitMutationEvent(EVENTS.NOC_AGENT_METRICS_INGESTED, { count: input.metrics.length }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  markFalsePositive: adminProcedure
    .input(z.object({ anomaly_id: z.string() }))
    .mutation(async ({ input }) => {
      const result = await agentFetch(PERCEPTION_URL, "/api/false-positive", "POST", input);
      emitMutationEvent(EVENTS.NOC_AGENT_FALSE_POSITIVE, { anomalyId: input.anomaly_id }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  // ── Reasoning Engine ────────────────────────────────────────────────────
  diagnoses: protectedProcedure.query(async () => agentFetch(REASONING_URL, "/api/diagnoses")),

  knowledgeBase: protectedProcedure.query(async () => agentFetch(REASONING_URL, "/api/knowledge")),

  diagnoseAnomaly: adminProcedure
    .input(z.object({
      anomaly_id: z.string(),
      service_name: z.string(),
      metric_name: z.string(),
      current_value: z.number(),
      baseline_mean: z.number(),
      baseline_std: z.number(),
      z_score: z.number(),
      isolation_score: z.number(),
      severity: z.string(),
      detection_method: z.string(),
      context: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await agentFetch(REASONING_URL, "/api/diagnose", "POST", input);
      emitMutationEvent(EVENTS.NOC_AGENT_DIAGNOSIS, { anomalyId: input.anomaly_id, serviceName: input.service_name, severity: input.severity }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  reportLearning: adminProcedure
    .input(z.object({
      remediation_id: z.string(),
      outcome: z.enum(["success", "partial_success", "failure"]),
      actual_root_cause: z.string().optional(),
      resolution_time_seconds: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await agentFetch(REASONING_URL, "/api/learn", "POST", input);
      emitMutationEvent(EVENTS.NOC_AGENT_LEARNING, { remediationId: input.remediation_id, outcome: input.outcome }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  reasoningMetrics: protectedProcedure.query(async () => agentFetch(REASONING_URL, "/metrics")),

  // ── Action Engine ───────────────────────────────────────────────────────
  executions: protectedProcedure.query(async () => agentFetch(ACTION_URL, "/api/executions")),

  pendingApprovals: protectedProcedure.query(async () => agentFetch(ACTION_URL, "/api/pending")),

  executeRemediation: adminProcedure
    .input(z.object({
      diagnosis_id: z.string(),
      anomaly_id: z.string(),
      root_cause_hypothesis: z.string(),
      root_cause_category: z.string(),
      confidence: z.number(),
      remediation_plan: z.array(z.object({
        step: z.number(),
        action: z.string(),
        command: z.string(),
        timeout_seconds: z.number(),
      })),
      should_auto_execute: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const result = await agentFetch(ACTION_URL, "/api/execute", "POST", input);
      emitMutationEvent(EVENTS.NOC_AGENT_REMEDIATION, { diagnosisId: input.diagnosis_id, anomalyId: input.anomaly_id, autoExecute: input.should_auto_execute }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  approveRemediation: adminProcedure
    .input(z.object({ diagnosis_id: z.string() }))
    .mutation(async ({ input }) => {
      const result = await agentFetch(ACTION_URL, "/api/approve", "POST", input);
      emitMutationEvent(EVENTS.NOC_AGENT_APPROVAL, { diagnosisId: input.diagnosis_id }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return result;
    }),

  actionMetrics: protectedProcedure.query(async () => agentFetch(ACTION_URL, "/metrics")),

  // ── Database Queries ────────────────────────────────────────────────────
  agentMemory: protectedProcedure
    .input(z.object({
      type: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const typeFilter = input?.type ? "WHERE memory_type = $1" : "";
      const params = input?.type ? [input.type] : [];
      const limitParam = input?.limit ?? 50;
      const sql = `SELECT * FROM noc_agent_memory ${typeFilter} ORDER BY created_at DESC LIMIT ${limitParam}`;
      return agentDbQuery(sql, params);
    }),

  agentActions: protectedProcedure
    .input(z.object({
      agent_type: z.string().optional(),
      action_type: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: string[] = [];
      if (input?.agent_type) { conditions.push(`agent_type = $${params.length + 1}`); params.push(input.agent_type); }
      if (input?.action_type) { conditions.push(`action_type = $${params.length + 1}`); params.push(input.action_type); }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const limitParam = input?.limit ?? 50;
      return agentDbQuery(`SELECT * FROM noc_agent_actions ${where} ORDER BY created_at DESC LIMIT ${limitParam}`, params);
    }),

  remediationHistory: protectedProcedure
    .input(z.object({
      outcome: z.string().optional(),
      limit: z.number().min(1).max(200).default(50),
    }).optional())
    .query(async ({ input }) => {
      const filter = input?.outcome ? "WHERE outcome = $1" : "";
      const params = input?.outcome ? [input.outcome] : [];
      const limitParam = input?.limit ?? 50;
      return agentDbQuery(`SELECT * FROM noc_remediation_history ${filter} ORDER BY created_at DESC LIMIT ${limitParam}`, params);
    }),

  serviceBaselines: protectedProcedure.query(async () =>
    agentDbQuery("SELECT * FROM noc_service_baselines ORDER BY service_name, metric_name")
  ),

  agentPredictions: protectedProcedure
    .input(z.object({
      active_only: z.boolean().default(true),
      limit: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input }) => {
      const activeFilter = input?.active_only !== false ? "WHERE predicted_time > NOW()" : "";
      const limitParam = input?.limit ?? 20;
      return agentDbQuery(`SELECT * FROM noc_agent_predictions ${activeFilter} ORDER BY confidence_score DESC LIMIT ${limitParam}`);
    }),

  // ── Agent Health Summary ────────────────────────────────────────────────
  agentHealth: protectedProcedure.query(async () => {
    const agents = [
      { name: "Perception", url: PERCEPTION_URL, port: 8194, lang: "Rust" },
      { name: "Reasoning", url: REASONING_URL, port: 8195, lang: "Python" },
      { name: "Action", url: ACTION_URL, port: 8196, lang: "Go" },
    ];

    const results = await Promise.allSettled(
      agents.map(async (agent) => {
        const start = Date.now();
        try {
          const res = await fetch(`${agent.url}/health`, { signal: AbortSignal.timeout(3000) });
          const latency = Date.now() - start;
          if (res.ok) {
            const data = await res.json() as Record<string, unknown>;
            return { ...agent, status: "healthy", latency, capabilities: data.capabilities ?? [] };
          }
          return { ...agent, status: "degraded", latency, capabilities: [] };
        } catch {
          return { ...agent, status: "down", latency: null, capabilities: [] };
        }
      })
    );

    return results.map((r, i) =>
      r.status === "fulfilled" ? r.value : { ...agents[i], status: "down", latency: null, capabilities: [] }
    );
  }),
});
