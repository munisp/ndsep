/**
 * NDSEP AI/ML/DL/GNN/LLM Router
 * ================================
 * Comprehensive AI/ML backend router integrating:
 *   - Qdrant vector store (semantic search, RAG pipeline)
 *   - FalkorDB knowledge graph (GNN, path analysis, KGQA)
 *   - Ollama local LLM (inference, compliance Q&A)
 *   - ART adversarial robustness testing
 *   - ML feature store (lakehouse integration)
 *   - Model registry (versioning, A/B testing)
 *   - Anomaly alert dispatcher (real-time SSE)
 *   - RSS/webhook feed
 *   - CocoIndex ETL pipeline status
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "../_core/llm";
import { getPool } from "../db";
import {
  emitEvent,
  logAuditEvent,
  broadcastEvent,
  cacheGetJson,
  cacheSetJson,
  cacheDel,
  triggerWorkflow,
} from "../middlewareHelpers";
import {
  emitComplianceEvent,
  opensearchIndex,
  lakehouseIngest,
  daprPublish,
  fluvioPublish,
  permifyCheck,
} from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { logger } from "../logger";

// ── Helper: raw SQL query ─────────────────────────────────────────────────────
async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const result = await pool.query(query, params);
    const rows = result.rows ?? [];
    return autoDecryptRows(query, rows);
  } catch (err: unknown) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "[aiml] DB query error"
    );
    return [];
  }
}

// ── Worker base URLs (configurable via env) ────────────────────────────────────
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const FALKORDB_WORKER_URL =
  process.env.FALKORDB_WORKER_URL || "http://localhost:8210";
const RAG_ORCHESTRATOR_URL =
  process.env.RAG_ORCHESTRATOR_URL || "http://localhost:8211";
const ANOMALY_DISPATCHER_URL =
  process.env.ANOMALY_DISPATCHER_URL || "http://localhost:8212";
const RSS_SERVER_URL = process.env.RSS_SERVER_URL || "http://localhost:8213";
const VECTOR_CACHE_URL =
  process.env.VECTOR_CACHE_URL || "http://localhost:8214";
const LAKEHOUSE_WRITER_URL =
  process.env.LAKEHOUSE_WRITER_URL || "http://localhost:8215";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const PYTHON_WORKER_URL =
  process.env.PYTHON_WORKER_URL || "http://localhost:8300";
const LAKEHOUSE_ANALYTICS_URL =
  process.env.LAKEHOUSE_ANALYTICS_URL || "http://localhost:8140";
const ML_PRODUCTION_URL =
  process.env.ML_PRODUCTION_URL || "http://localhost:8085";
const GNN_ENGINE_URL = process.env.GNN_ENGINE_URL || "http://localhost:8216";

// ── Helper: safe fetch with timeout ───────────────────────────────────────────
async function safeFetch(
  url: string,
  options?: RequestInit,
  timeoutMs = 5000
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    return await resp.json();
  } catch (err: unknown) {
    clearTimeout(timer);
    return {
      error: err instanceof Error ? err.message : "worker_unavailable",
      available: false,
    };
  }
}

// ── Qdrant Router ──────────────────────────────────────────────────────────────
export const qdrantRouter = router({
  health: protectedProcedure.query(async () => {
    const health = await safeFetch(`${QDRANT_URL}/healthz`);
    const collections = await safeFetch(`${QDRANT_URL}/collections`);
    return {
      available: !health.error,
      status: health.error ? "unavailable" : "healthy",
      collections: collections.result?.collections || [],
      url: QDRANT_URL,
    };
  }),

  search: protectedProcedure
    .input(
      z.object({
        query: z.string().min(1).max(500),
        collection: z.string().default("compliance_docs"),
        limit: z.number().min(1).max(50).default(10),
        threshold: z.number().min(0).max(1).default(0.7),
      })
    )
    .query(async ({ input }) => {
      // First check vector cache
      const cacheResult = await safeFetch(`${VECTOR_CACHE_URL}/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: input.query, top_k: input.limit }),
      });

      if (cacheResult.cache_hit) {
        return {
          results: cacheResult.results,
          source: "cache",
          query: input.query,
          cached_similarity: cacheResult.similarity_to_cached,
        };
      }

      // Fall through to RAG orchestrator
      const ragResult = await safeFetch(
        `${RAG_ORCHESTRATOR_URL}/search`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: input.query,
            collection: input.collection,
            limit: input.limit,
            threshold: input.threshold,
          }),
        },
        10000
      );

      return {
        results: ragResult.results || [],
        source: "qdrant",
        query: input.query,
        total: ragResult.total || 0,
        error: ragResult.error,
      };
    }),

  collections: protectedProcedure.query(async () => {
    const result = await safeFetch(`${QDRANT_URL}/collections`);
    if (result.error) return { collections: [], available: false };
    return {
      collections: result.result?.collections || [],
      available: true,
    };
  }),

  ingestDocument: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        content: z.string(),
        collection: z.string().default("compliance_docs"),
        metadata: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await safeFetch(
        `${RAG_ORCHESTRATOR_URL}/ingest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
        30000
      );
      emitMutationEvent("ndsep.ai.mutation", {
        action: "aimlRouter",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return {
        status: result.error ? "failed" : "ingested",
        id: result.id,
        error: result.error,
      };
    }),
});

// ── Knowledge Graph Router (FalkorDB + GNN) ────────────────────────────────────
export const knowledgeGraphRouter = router({
  health: protectedProcedure.query(async () => {
    return await safeFetch(`${FALKORDB_WORKER_URL}/health`);
  }),

  stats: protectedProcedure.query(async () => {
    return await safeFetch(`${FALKORDB_WORKER_URL}/graph/stats`);
  }),

  rebuild: protectedProcedure.mutation(async () => {
    emitMutationEvent("ndsep.ai.mutation", {
      action: "aimlRouter",
      ts: new Date().toISOString(),
    }).catch((e: unknown) =>
      logger.debug(
        { err: e instanceof Error ? e.message : String(e) },
        "fire-and-forget failed"
      )
    );
    return await safeFetch(
      `${FALKORDB_WORKER_URL}/graph/build`,
      {
        method: "POST",
      },
      60000
    );
  }),

  getNeighbors: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        relation: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return await safeFetch(
        `${FALKORDB_WORKER_URL}/graph/neighbors?node_id=${encodeURIComponent(input.nodeId)}&relation=${input.relation || ""}`
      );
    }),

  findPath: protectedProcedure
    .input(
      z.object({
        fromId: z.string(),
        toId: z.string(),
        maxDepth: z.number().min(1).max(6).default(4),
      })
    )
    .query(async ({ input }) => {
      return await safeFetch(
        `${FALKORDB_WORKER_URL}/graph/path?from=${encodeURIComponent(input.fromId)}&to=${encodeURIComponent(input.toId)}&depth=${input.maxDepth}`
      );
    }),

  gnnEmbedding: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        depth: z.number().min(1).max(3).default(2),
      })
    )
    .query(async ({ input }) => {
      return await safeFetch(
        `${FALKORDB_WORKER_URL}/graph/embedding?node_id=${encodeURIComponent(input.nodeId)}&depth=${input.depth}`
      );
    }),

  kgqa: protectedProcedure
    .input(
      z.object({
        question: z.string().min(5).max(500),
      })
    )
    .query(async ({ input }) => {
      // EPR-KGQA: answer questions using the knowledge graph
      const kgResult = await safeFetch(
        `${FALKORDB_WORKER_URL}/graph/query`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: input.question }),
        },
        15000
      );

      if (kgResult.error || !kgResult.answer) {
        // Fallback to LLM with graph context
        const graphStats = await safeFetch(
          `${FALKORDB_WORKER_URL}/graph/stats`
        );
        const llmResp = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `You are the NDSEP compliance knowledge graph assistant. 
Answer questions about Nigerian data protection compliance, organizations, violations, and enforcement actions.
Knowledge graph context: ${JSON.stringify(graphStats)}`,
            },
            { role: "user", content: input.question },
          ],
        });
        return {
          answer: llmResp.choices?.[0]?.message?.content || "Unable to answer",
          source: "llm_fallback",
          question: input.question,
        };
      }

      return {
        answer: kgResult.answer,
        paths: kgResult.paths,
        nodes: kgResult.nodes,
        source: "knowledge_graph",
        question: input.question,
      };
    }),

  sectorPeers: protectedProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ input }) => {
      return await safeFetch(
        `${FALKORDB_WORKER_URL}/graph/neighbors?node_id=org:${input.orgId}&relation=SECTOR_PEER`
      );
    }),
});

// ── Ollama LLM Router ──────────────────────────────────────────────────────────
export const ollamaRouter = router({
  health: protectedProcedure.query(async () => {
    const result = await safeFetch(`${OLLAMA_URL}/api/tags`);
    return {
      available: !result.error,
      models: result.models || [],
      url: OLLAMA_URL,
    };
  }),

  models: protectedProcedure.query(async () => {
    const result = await safeFetch(`${OLLAMA_URL}/api/tags`);
    return {
      models: result.models || [],
      available: !result.error,
    };
  }),

  generate: protectedProcedure
    .input(
      z.object({
        model: z.string().default("llama3.2"),
        prompt: z.string().min(1).max(2000),
        system: z.string().optional(),
        temperature: z.number().min(0).max(2).default(0.7),
      })
    )
    .mutation(async ({ input }) => {
      // Try Ollama first, fall back to built-in LLM
      const ollamaResult = await safeFetch(
        `${OLLAMA_URL}/api/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: input.model,
            prompt: input.prompt,
            system: input.system,
            stream: false,
            options: { temperature: input.temperature },
          }),
        },
        30000
      );

      if (ollamaResult.error) {
        // Fallback to built-in LLM
        const messages: any[] = [];
        if (input.system)
          messages.push({ role: "system", content: input.system });
        messages.push({ role: "user", content: input.prompt });
        const llmResp = await invokeLLM({ messages });
        emitMutationEvent("ndsep.ai.mutation", {
          action: "aimlRouter",
          ts: new Date().toISOString(),
        }).catch((e: unknown) =>
          logger.debug(
            { err: e instanceof Error ? e.message : String(e) },
            "fire-and-forget failed"
          )
        );
        return {
          response: llmResp.choices?.[0]?.message?.content || "",
          model: "built-in",
          source: "builtin_llm",
          done: true,
        };
      }

      emitMutationEvent("ndsep.ai.mutation", {
        action: "aimlRouter",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return {
        response: ollamaResult.response || "",
        model: ollamaResult.model || input.model,
        source: "ollama",
        done: ollamaResult.done,
        eval_count: ollamaResult.eval_count,
        eval_duration: ollamaResult.eval_duration,
      };
    }),

  complianceQA: protectedProcedure
    .input(
      z.object({
        question: z.string().min(5).max(1000),
        orgId: z.string().optional(),
        useRAG: z.boolean().default(true),
      })
    )
    .query(async ({ input }) => {
      let context = "";

      // Retrieve relevant context from Qdrant if RAG is enabled
      if (input.useRAG) {
        const ragResult = await safeFetch(
          `${RAG_ORCHESTRATOR_URL}/search`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: input.question,
              limit: 5,
              threshold: 0.6,
            }),
          },
          10000
        );

        if (!ragResult.error && ragResult.results?.length > 0) {
          context = ragResult.results
            .map((r: Record<string, unknown>) => {
              const p = r.payload as Record<string, unknown> | undefined;
              return p?.content || p?.text || "";
            })
            .filter(Boolean)
            .join("\n\n");
        }
      }

      const systemPrompt = `You are the NDSEP (National Data Sovereignty Enforcement Platform) compliance assistant.
You help NDPC officers and regulated organizations understand Nigerian data protection law (NDPA 2023).
Answer questions accurately, cite relevant sections of the NDPA where applicable.
${context ? `\nRelevant context from compliance documents:\n${context}` : ""}`;

      const llmResp = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: input.question },
        ],
      });

      return {
        answer: llmResp.choices?.[0]?.message?.content || "Unable to answer",
        question: input.question,
        rag_context_used: !!context,
        context_snippets: context ? context.split("\n\n").length : 0,
      };
    }),
});

// ── ART Adversarial Robustness Router ─────────────────────────────────────────
export const artRouter = router({
  health: protectedProcedure.query(async () => {
    return await safeFetch(`${PYTHON_WORKER_URL}/art/health`);
  }),

  runTest: protectedProcedure
    .input(
      z.object({
        modelName: z.string(),
        attackType: z.enum([
          "fgsm",
          "pgd",
          "deepfool",
          "carlini_wagner",
          "boundary",
        ]),
        epsilon: z.number().min(0.001).max(0.5).default(0.1),
        iterations: z.number().min(1).max(100).default(20),
      })
    )
    .mutation(async ({ input }) => {
      const result = await safeFetch(
        `${PYTHON_WORKER_URL}/art/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
        60000
      );

      if (result.error) {
        logger.warn(
          {
            modelName: input.modelName,
            attackType: input.attackType,
            error: String(result.error),
          },
          "ART robustness worker unavailable; no test result was produced"
        );
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message:
            "ART robustness worker is unavailable; no adversarial-test result was produced",
        });
      }
      emitMutationEvent("ndsep.ai.mutation", {
        action: "aimlRouter",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return result;
    }),

  getResults: protectedProcedure
    .input(z.object({ modelName: z.string().optional() }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT id::text, model_name, attack_type, epsilon, clean_accuracy,
                adversarial_accuracy, robustness_score, created_at
         FROM art_test_results
         ${input.modelName ? "WHERE model_name = $1" : ""}
         ORDER BY created_at DESC LIMIT 50`,
        input.modelName ? [input.modelName] : []
      );
      return { results: rows || [] };
    }),

  modelVulnerabilities: protectedProcedure
    .input(z.object({ modelName: z.string() }))
    .query(async ({ input }) => {
      return await safeFetch(
        `${PYTHON_WORKER_URL}/art/vulnerabilities?model=${encodeURIComponent(input.modelName)}`
      );
    }),
});

// ── Feature Store Router ───────────────────────────────────────────────────────
export const featureStoreRouter = router({
  health: protectedProcedure.query(async () => {
    return await safeFetch(`${LAKEHOUSE_WRITER_URL}/health`);
  }),

  getFeatures: protectedProcedure
    .input(
      z.object({
        featureGroup: z.string(),
        entityId: z.string(),
      })
    )
    .query(async ({ input }) => {
      return await safeFetch(`${LAKEHOUSE_WRITER_URL}/features/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature_group: input.featureGroup,
          entity_id: input.entityId,
        }),
      });
    }),

  listFeatureGroups: protectedProcedure.query(async () => {
    const rows = await exec(`
      SELECT feature_group, COUNT(*) as entity_count,
             MAX(recorded_at) as last_updated
      FROM ml_feature_store
      GROUP BY feature_group
      ORDER BY feature_group
    `);
    return { groups: rows || [] };
  }),

  getPredictionLog: protectedProcedure
    .input(
      z.object({
        modelName: z.string().optional(),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT id::text, model_name, model_version, entity_id,
                prediction, confidence, latency_ms, predicted_at
         FROM ml_prediction_log
         ${input.modelName ? "WHERE model_name = $1" : ""}
         ORDER BY predicted_at DESC LIMIT ${input.limit}`,
        input.modelName ? [input.modelName] : []
      );
      return { predictions: rows || [] };
    }),

  getLineage: protectedProcedure
    .input(z.object({ pipelineRunId: z.string().optional() }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT id::text, source_table, target_table, transformation,
                record_count, pipeline_run_id, created_at
         FROM ml_lineage
         ${input.pipelineRunId ? "WHERE pipeline_run_id = $1" : ""}
         ORDER BY created_at DESC LIMIT 100`,
        input.pipelineRunId ? [input.pipelineRunId] : []
      );
      return { lineage: rows || [] };
    }),
  createFeatureGroup: protectedProcedure
    .input(
      z.object({
        featureName: z.string().min(1).max(255),
        featureType: z.string().min(1).max(100),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const rows = await exec(
        `INSERT INTO ml_feature_store (feature_name, feature_type, description, recorded_at)
         VALUES ($1, $2, $3, NOW()) RETURNING id::text, feature_name, feature_type`,
        [input.featureName, input.featureType, input.description ?? null]
      );
      emitMutationEvent("ndsep.ai.mutation", {
        action: "aimlRouter",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return rows[0] ?? null;
    }),
  logPrediction: protectedProcedure
    .input(
      z.object({
        modelName: z.string().min(1),
        inputFeatures: z.record(z.string(), z.unknown()),
        prediction: z.string(),
        confidence: z.number().min(0).max(1).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const rows = await exec(
        `INSERT INTO ml_prediction_log (model_name, input_features, prediction, confidence, predicted_at)
         VALUES ($1, $2::jsonb, $3, $4, NOW()) RETURNING id::text`,
        [
          input.modelName,
          JSON.stringify(input.inputFeatures),
          input.prediction,
          input.confidence ?? null,
        ]
      );
      emitMutationEvent("ndsep.ai.mutation", {
        action: "aimlRouter",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return rows[0] ?? null;
    }),
});
// ── Model Registry Router ──────────────────────────────────────────────────────
export const modelRegistryRouter = router({
  list: protectedProcedure.query(async () => {
    const rows = await exec(`
      SELECT id::text, name, version, algorithm, framework,
             accuracy, f1_score, auc_roc, status, deployed_at, created_at
      FROM ml_model_registry
      ORDER BY created_at DESC
    `);
    return { models: rows || [] };
  }),

  getMetrics: protectedProcedure
    .input(z.object({ modelId: z.string() }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT id::text, model_id::text, metric_name, metric_value,
                dataset_split, recorded_at
         FROM ml_model_metrics
         WHERE model_id = $1::uuid
         ORDER BY recorded_at DESC`,
        [input.modelId]
      );
      return { metrics: rows || [] };
    }),

  getDriftReport: protectedProcedure
    .input(z.object({ modelName: z.string() }))
    .query(async ({ input }) => {
      // Compute feature drift from prediction log
      const rows = await exec(
        `SELECT DATE_TRUNC('day', predicted_at) as day,
                AVG(confidence) as avg_confidence,
                COUNT(*) as prediction_count,
                STDDEV(confidence) as confidence_stddev
         FROM ml_prediction_log
         WHERE model_name = $1
           AND predicted_at >= NOW() - INTERVAL '30 days'
         GROUP BY day
         ORDER BY day`,
        [input.modelName]
      );
      return {
        model: input.modelName,
        drift_data: rows || [],
        drift_detected: false,
        last_checked: new Date().toISOString(),
      };
    }),
  register: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        version: z.string().min(1).max(50),
        algorithm: z.string().min(1).max(100),
        framework: z.string().optional(),
        accuracy: z.number().min(0).max(1).optional(),
        f1Score: z.number().min(0).max(1).optional(),
        aucRoc: z.number().min(0).max(1).optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const rows = await exec(
        `INSERT INTO ml_model_registry (name, version, algorithm, framework, accuracy, f1_score, auc_roc, description, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'staging', NOW()) RETURNING id::text, name, version, status`,
        [
          input.name,
          input.version,
          input.algorithm,
          input.framework ?? null,
          input.accuracy ?? null,
          input.f1Score ?? null,
          input.aucRoc ?? null,
          input.description ?? null,
        ]
      );
      emitMutationEvent("ndsep.ai.mutation", {
        action: "aimlRouter",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return rows[0] ?? null;
    }),
  deploy: protectedProcedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input }) => {
      await exec(
        `UPDATE ml_model_registry SET status = 'deployed', deployed_at = NOW() WHERE id = $1::uuid`,
        [input.modelId]
      );
      emitMutationEvent("ndsep.ai.mutation", {
        action: "aimlRouter",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return { success: true };
    }),
  retire: protectedProcedure
    .input(z.object({ modelId: z.string() }))
    .mutation(async ({ input }) => {
      await exec(
        `UPDATE ml_model_registry SET status = 'retired' WHERE id = $1::uuid`,
        [input.modelId]
      );
      emitMutationEvent("ndsep.ai.mutation", {
        action: "aimlRouter",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return { success: true };
    }),
});

// ── Anomaly Alerts Router ──────────────────────────────────────────────────────
export const anomalyAlertsRouter = router({
  health: protectedProcedure.query(async () => {
    return await safeFetch(`${ANOMALY_DISPATCHER_URL}/health`);
  }),

  getActive: protectedProcedure.query(async () => {
    const result = await safeFetch(`${ANOMALY_DISPATCHER_URL}/alerts`);
    if (result.error) {
      // Return from DB if worker unavailable
      const rows = await exec(`
        SELECT id::text, alert_type, severity, title, description,
               organization_id::text, status, created_at
        FROM security_alerts
        WHERE alert_type = 'compliance_anomaly' AND status = 'open'
        ORDER BY created_at DESC LIMIT 20
      `);
      return { alerts: rows || [], source: "database" };
    }
    return { alerts: result.alerts || [], source: "dispatcher" };
  }),

  triggerScan: protectedProcedure.mutation(async () => {
    emitMutationEvent("ndsep.ai.mutation", {
      action: "aimlRouter",
      ts: new Date().toISOString(),
    }).catch((e: unknown) =>
      logger.debug(
        { err: e instanceof Error ? e.message : String(e) },
        "fire-and-forget failed"
      )
    );
    return await safeFetch(`${ANOMALY_DISPATCHER_URL}/scan`, {
      method: "POST",
    });
  }),

  acknowledge: protectedProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(async ({ input }) => {
      await exec(
        `UPDATE security_alerts SET status = 'acknowledged', updated_at = NOW()
         WHERE id = $1::uuid`,
        [input.alertId]
      );
      emitMutationEvent("ndsep.ai.mutation", {
        action: "aimlRouter",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return { status: "acknowledged", alertId: input.alertId };
    }),
});

// ── CocoIndex ETL Router ───────────────────────────────────────────────────────
export const cocoIndexRouter = router({
  health: protectedProcedure.query(async () => {
    return await safeFetch(`${PYTHON_WORKER_URL}/cocoindex/health`);
  }),

  getStatus: protectedProcedure.query(async () => {
    const result = await safeFetch(`${PYTHON_WORKER_URL}/cocoindex/status`);
    if (result.error) {
      return {
        status: "worker_unavailable",
        last_run: null,
        documents_indexed: 0,
        collections: [],
        available: false,
      };
    }
    return result;
  }),

  triggerRun: protectedProcedure.mutation(async () => {
    emitMutationEvent("ndsep.ai.mutation", {
      action: "aimlRouter",
      ts: new Date().toISOString(),
    }).catch((e: unknown) =>
      logger.debug(
        { err: e instanceof Error ? e.message : String(e) },
        "fire-and-forget failed"
      )
    );
    return await safeFetch(
      `${PYTHON_WORKER_URL}/cocoindex/run`,
      {
        method: "POST",
      },
      30000
    );
  }),
});

// ── RSS Feed Router ────────────────────────────────────────────────────────────
export const rssFeedRouter = router({
  health: protectedProcedure.query(async () => {
    return await safeFetch(`${RSS_SERVER_URL}/health`);
  }),

  subscribeWebhook: protectedProcedure
    .input(
      z.object({
        url: z.string().url(),
        events: z
          .array(z.string())
          .default(["changelog.published", "compliance.alert"]),
        secret: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      emitMutationEvent("ndsep.ai.mutation", {
        action: "aimlRouter",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return await safeFetch(`${RSS_SERVER_URL}/api/webhooks/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    }),

  triggerWebhook: protectedProcedure
    .input(
      z.object({
        event: z.string(),
        payload: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(async ({ input }) => {
      emitMutationEvent("ndsep.ai.mutation", {
        action: "aimlRouter",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return await safeFetch(`${RSS_SERVER_URL}/api/webhooks/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    }),
});

// ── Lakehouse Analytics Router ─────────────────────────────────────────────────
export const lakehouseAnalyticsRouter = router({
  health: protectedProcedure.query(async () => {
    return await safeFetch(`${LAKEHOUSE_ANALYTICS_URL}/health`);
  }),

  triggerETL: protectedProcedure.mutation(async () => {
    emitMutationEvent("ndsep.ai.mutation", {
      action: "lakehouse_etl",
      ts: new Date().toISOString(),
    }).catch((e: unknown) =>
      logger.debug(
        { err: e instanceof Error ? e.message : String(e) },
        "fire-and-forget failed"
      )
    );
    return await safeFetch(
      `${LAKEHOUSE_ANALYTICS_URL}/etl/run`,
      { method: "POST" },
      60000
    );
  }),

  etlStatus: protectedProcedure.query(async () => {
    return await safeFetch(`${LAKEHOUSE_ANALYTICS_URL}/etl/status`);
  }),

  query: protectedProcedure
    .input(
      z.object({
        sql: z.string().min(1).max(5000),
      })
    )
    .query(async ({ input }) => {
      return await safeFetch(
        `${LAKEHOUSE_ANALYTICS_URL}/query`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql: input.sql }),
        },
        30000
      );
    }),

  tables: protectedProcedure.query(async () => {
    return await safeFetch(`${LAKEHOUSE_ANALYTICS_URL}/tables`);
  }),

  materializedView: protectedProcedure
    .input(z.object({ viewName: z.string() }))
    .query(async ({ input }) => {
      return await safeFetch(
        `${LAKEHOUSE_ANALYTICS_URL}/views/${encodeURIComponent(input.viewName)}`
      );
    }),

  features: protectedProcedure
    .input(z.object({ featureGroup: z.string() }))
    .query(async ({ input }) => {
      return await safeFetch(
        `${LAKEHOUSE_ANALYTICS_URL}/features/${encodeURIComponent(input.featureGroup)}`
      );
    }),

  snapshots: protectedProcedure.query(async () => {
    return await safeFetch(`${LAKEHOUSE_ANALYTICS_URL}/snapshots`);
  }),

  compact: protectedProcedure
    .input(z.object({ table: z.string() }))
    .mutation(async ({ input }) => {
      emitMutationEvent("ndsep.ai.mutation", {
        action: "lakehouse_compact",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return await safeFetch(
        `${LAKEHOUSE_ANALYTICS_URL}/compact`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table: input.table }),
        },
        30000
      );
    }),

  lineage: protectedProcedure.query(async () => {
    return await safeFetch(`${LAKEHOUSE_ANALYTICS_URL}/lineage`);
  }),

  incrementalStatus: protectedProcedure.query(async () => {
    return await safeFetch(`${LAKEHOUSE_ANALYTICS_URL}/incremental/status`);
  }),

  resetIncremental: protectedProcedure.mutation(async () => {
    emitMutationEvent("ndsep.ai.mutation", {
      action: "lakehouse_reset_incremental",
      ts: new Date().toISOString(),
    }).catch((e: unknown) =>
      logger.debug(
        { err: e instanceof Error ? e.message : String(e) },
        "fire-and-forget failed"
      )
    );
    return await safeFetch(`${LAKEHOUSE_ANALYTICS_URL}/etl/reset`, {
      method: "POST",
    });
  }),

  ingest: protectedProcedure
    .input(
      z.object({
        namespace: z.string().default("ndsep"),
        table: z.string(),
        records: z.array(z.record(z.string(), z.unknown())),
      })
    )
    .mutation(async ({ input }) => {
      return await safeFetch(`${LAKEHOUSE_ANALYTICS_URL}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    }),
});

// ── ML Production Engine Router ───────────────────────────────────────────────
export const mlProductionRouter = router({
  health: protectedProcedure.query(async () => {
    return await safeFetch(`${ML_PRODUCTION_URL}/health`);
  }),

  trainAll: protectedProcedure.mutation(async () => {
    emitMutationEvent("ndsep.ai.mutation", {
      action: "ml_train",
      ts: new Date().toISOString(),
    }).catch((e: unknown) =>
      logger.debug(
        { err: e instanceof Error ? e.message : String(e) },
        "fire-and-forget failed"
      )
    );
    return await safeFetch(
      `${ML_PRODUCTION_URL}/train`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: ["all"] }),
      },
      120000
    );
  }),

  trainModel: protectedProcedure
    .input(z.object({ modelName: z.string() }))
    .mutation(async ({ input }) => {
      emitMutationEvent("ndsep.ai.mutation", {
        action: "ml_train",
        ts: new Date().toISOString(),
      }).catch((e: unknown) =>
        logger.debug(
          { err: e instanceof Error ? e.message : String(e) },
          "fire-and-forget failed"
        )
      );
      return await safeFetch(
        `${ML_PRODUCTION_URL}/train`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ models: [input.modelName] }),
        },
        120000
      );
    }),

  models: protectedProcedure.query(async () => {
    return await safeFetch(`${ML_PRODUCTION_URL}/models`);
  }),

  modelDetail: protectedProcedure
    .input(z.object({ modelName: z.string() }))
    .query(async ({ input }) => {
      return await safeFetch(
        `${ML_PRODUCTION_URL}/models/${encodeURIComponent(input.modelName)}`
      );
    }),

  predictBreach: protectedProcedure
    .input(z.object({ orgFeatures: z.record(z.string(), z.number()) }))
    .query(async ({ input }) => {
      return await safeFetch(
        `${ML_PRODUCTION_URL}/predict/breach`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ org_features: input.orgFeatures }),
        },
        15000
      );
    }),

  predictViolations: protectedProcedure.query(async () => {
    return await safeFetch(
      `${ML_PRODUCTION_URL}/predict/violations`,
      { method: "POST" },
      15000
    );
  }),

  detectAnomaly: protectedProcedure
    .input(z.object({ orgFeatures: z.record(z.string(), z.number()) }))
    .query(async ({ input }) => {
      return await safeFetch(
        `${ML_PRODUCTION_URL}/predict/anomaly`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ org_features: input.orgFeatures }),
        },
        15000
      );
    }),

  scoreRisk: protectedProcedure
    .input(z.object({ orgFeatures: z.record(z.string(), z.number()) }))
    .query(async ({ input }) => {
      return await safeFetch(
        `${ML_PRODUCTION_URL}/predict/risk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ org_features: input.orgFeatures }),
        },
        15000
      );
    }),

  shapExplanation: protectedProcedure
    .input(z.object({ modelName: z.string() }))
    .query(async ({ input }) => {
      return await safeFetch(
        `${ML_PRODUCTION_URL}/shap/${encodeURIComponent(input.modelName)}`
      );
    }),

  pipelineStatus: protectedProcedure.query(async () => {
    return await safeFetch(`${ML_PRODUCTION_URL}/pipeline/status`);
  }),
});

// ── GNN Compliance Engine Router ──────────────────────────────────────────────
export const gnnRouter = router({
  health: protectedProcedure.query(async () => {
    return await safeFetch(`${GNN_ENGINE_URL}/health`);
  }),

  buildGraph: protectedProcedure.mutation(async () => {
    emitMutationEvent("ndsep.ai.mutation", {
      action: "gnn_build",
      ts: new Date().toISOString(),
    }).catch((e: unknown) =>
      logger.debug(
        { err: e instanceof Error ? e.message : String(e) },
        "fire-and-forget failed"
      )
    );
    return await safeFetch(
      `${GNN_ENGINE_URL}/graph/build`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "database" }),
      },
      60000
    );
  }),

  graphStats: protectedProcedure.query(async () => {
    return await safeFetch(`${GNN_ENGINE_URL}/graph/stats`);
  }),

  embedding: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        depth: z.number().min(1).max(3).default(2),
      })
    )
    .query(async ({ input }) => {
      return await safeFetch(`${GNN_ENGINE_URL}/embedding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: input.nodeId, depth: input.depth }),
      });
    }),

  allEmbeddings: protectedProcedure.query(async () => {
    return await safeFetch(
      `${GNN_ENGINE_URL}/embeddings/all`,
      undefined,
      30000
    );
  }),

  predictLink: protectedProcedure
    .input(
      z.object({
        source: z.string(),
        target: z.string(),
      })
    )
    .query(async ({ input }) => {
      return await safeFetch(`${GNN_ENGINE_URL}/predict/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    }),

  predictViolations: protectedProcedure
    .input(z.object({ orgId: z.string() }))
    .query(async ({ input }) => {
      return await safeFetch(`${GNN_ENGINE_URL}/predict/violations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: input.orgId }),
      });
    }),

  neighbors: protectedProcedure
    .input(
      z.object({
        nodeId: z.string(),
        relation: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return await safeFetch(
        `${GNN_ENGINE_URL}/graph/neighbors/${encodeURIComponent(input.nodeId)}?relation=${input.relation || ""}`
      );
    }),

  findPath: protectedProcedure
    .input(
      z.object({
        src: z.string(),
        dst: z.string(),
        maxDepth: z.number().min(1).max(6).default(4),
      })
    )
    .query(async ({ input }) => {
      return await safeFetch(
        `${GNN_ENGINE_URL}/graph/path?src=${encodeURIComponent(input.src)}&dst=${encodeURIComponent(input.dst)}&max_depth=${input.maxDepth}`
      );
    }),

  similarity: protectedProcedure
    .input(
      z.object({
        nodeA: z.string(),
        nodeB: z.string(),
      })
    )
    .query(async ({ input }) => {
      return await safeFetch(
        `${GNN_ENGINE_URL}/graph/similarity/${encodeURIComponent(input.nodeA)}/${encodeURIComponent(input.nodeB)}`
      );
    }),
});

// ── Platform AI Health (aggregate) ────────────────────────────────────────────
export const aiHealthRouter = router({
  summary: protectedProcedure.query(async () => {
    const [
      qdrant,
      falkordb,
      ollama,
      vectorCache,
      lakehouse,
      anomaly,
      rss,
      lakehouseAnalytics,
      mlProd,
      gnn,
    ] = await Promise.allSettled([
      safeFetch(`${QDRANT_URL}/healthz`, undefined, 3000),
      safeFetch(`${FALKORDB_WORKER_URL}/health`, undefined, 3000),
      safeFetch(`${OLLAMA_URL}/api/tags`, undefined, 3000),
      safeFetch(`${VECTOR_CACHE_URL}/health`, undefined, 3000),
      safeFetch(`${LAKEHOUSE_WRITER_URL}/health`, undefined, 3000),
      safeFetch(`${ANOMALY_DISPATCHER_URL}/health`, undefined, 3000),
      safeFetch(`${RSS_SERVER_URL}/health`, undefined, 3000),
      safeFetch(`${LAKEHOUSE_ANALYTICS_URL}/health`, undefined, 3000),
      safeFetch(`${ML_PRODUCTION_URL}/health`, undefined, 3000),
      safeFetch(`${GNN_ENGINE_URL}/health`, undefined, 3000),
    ]);

    const resolve = (r: PromiseSettledResult<any>, name: string) => ({
      name,
      available: r.status === "fulfilled" && !r.value?.error,
      status:
        r.status === "fulfilled" && !r.value?.error ? "healthy" : "unavailable",
      details: r.status === "fulfilled" ? r.value : { error: "request_failed" },
    });

    const services = [
      resolve(qdrant, "Qdrant Vector Store"),
      resolve(falkordb, "FalkorDB Knowledge Graph"),
      resolve(ollama, "Ollama Local LLM"),
      resolve(vectorCache, "Vector Cache (Rust)"),
      resolve(lakehouse, "Lakehouse Writer (Rust)"),
      resolve(anomaly, "Anomaly Alert Dispatcher"),
      resolve(rss, "RSS/Webhook Server"),
      resolve(lakehouseAnalytics, "Lakehouse Analytics (DuckDB/Parquet)"),
      resolve(mlProd, "ML Production Engine (XGBoost/LSTM/SHAP)"),
      resolve(gnn, "GNN Compliance Engine"),
    ];

    const healthy = services.filter(s => s.available).length;
    return {
      total_services: services.length,
      healthy_services: healthy,
      health_score: Math.round((healthy / services.length) * 100),
      services,
      checked_at: new Date().toISOString(),
    };
  }),
});
