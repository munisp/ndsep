/**
 * Enhancement Routers — All Priority 1-5 features
 * DSAR public submission, DPIA wizard, AI governance scoring,
 * sector benchmarking, webhook delivery, full-text search, i18n
 */
import { z } from "zod";

import { router, publicProcedure, protectedProcedure, adminProcedure, exportProcedure, deleteProcedure, approveProcedure} from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import pg from "pg";
import { invokeLLM } from "../_core/llm";
import crypto from "crypto";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { syncEnforcementCase, syncComplianceAudit } from "../permifySync";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField, isEncryptionEnabled } from "../encryption";
import { getPgSslConfig } from "../dbSslConfig";
import { getDatabaseUrl } from "../config";
import { logger } from "../logger";

const { Pool } = pg;
let _pool: InstanceType<typeof Pool> | null = null;
function getPool(): InstanceType<typeof Pool> {
  if (!_pool) {
    _pool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: getPgSslConfig(),
    });
  }
  // Return a proxied pool whose query method auto-decrypts PII
  return new Proxy(_pool, {
    get(target, prop) {
      if (prop === "query") {
        return async (sql: string, params?: unknown[]) => {
          const result = await target.query(sql, params);
          if (result.rows) {
            result.rows = autoDecryptRows(sql, result.rows);
          }
          return result;
        };
      }
      return (target as any)[prop];
    },
  }) as InstanceType<typeof Pool>;
}

// ─── DSAR (Data Subject Access Request) Public Router ────────────────────────
export const dsarRouter = router({
  /** Public: citizen submits a DSAR without needing a login */
  publicSubmit: publicProcedure
    .input(
      z.object({
        requestType: z.enum([
          "access",
          "rectification",
          "erasure",
          "portability",
          "restriction",
          "objection",
          "automated_decision",
        ]),
        citizenName: z.string().min(2).max(256),
        citizenEmail: z.string().email(),
        citizenNin: z.string().optional(),
        organizationId: z.number().int().positive().optional(),
        description: z.string().min(10).max(5000),
        supportingDocUrl: z.string().url().optional(),
        supportingDocKey: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const pool = getPool();
      // Generate reference number
      const seq = await pool.query("SELECT nextval('citizen_requests_id_seq') AS id");
      const id = Number(seq.rows[0].id);
      const referenceNumber = `NDSEP-CR-${String(id).padStart(6, "0")}`;
      const responseDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      // Encrypt PII at the database write point (after Zod validation)
      const dbEmail = encryptField(input.citizenEmail);
      const dbNin = input.citizenNin ? encryptField(input.citizenNin) : null;

      await pool.query(
        `INSERT INTO citizen_requests
          (id, citizen_name, citizen_email, citizen_nin, request_type, status,
           organization_id, description, reference_number, response_deadline,
           supporting_doc_url, supporting_doc_key, submitted_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'submitted',$6,$7,$8,$9,$10,$11,NOW(),NOW())`,
        [
          id,
          input.citizenName,
          dbEmail,
          dbNin,
          input.requestType,
          input.organizationId ?? null,
          input.description,
          referenceNumber,
          responseDeadline,
          input.supportingDocUrl ?? null,
          input.supportingDocKey ?? null,
        ]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { id, referenceNumber, responseDeadline };
    }),

  /** Public: citizen tracks their DSAR by reference number + email */
  publicTrack: publicProcedure
    .input(
      z.object({
        referenceNumber: z.string().min(10),
        citizenEmail: z.string().email(),
      })
    )
    .query(async ({ input }) => {
      const pool = getPool();
      // AES-256-GCM uses random IVs so the same plaintext encrypts
      // differently each time — we cannot do equality comparison in SQL.
      // Fetch by reference_number, then verify email in application code
      // after the Proxy auto-decrypts the row.
      const { rows } = await pool.query(
        `SELECT id, reference_number, request_type, status, submitted_at,
                response_deadline, completed_at, response_notes, citizen_email
         FROM citizen_requests
         WHERE reference_number = $1`,
        [input.referenceNumber]
      );
      const match = rows.find(
        (r: Record<string, unknown>) =>
          (r.citizen_email as string)?.toLowerCase() === input.citizenEmail.toLowerCase()
      );
      if (!match) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No request found with that reference number and email.",
        });
      }
      // Strip PII from the response (citizen_email was only needed for verification)
      const { citizen_email: _e, ...safe } = match as Record<string, unknown>;
      return safe;
    }),

  /** Protected: list all DSARs with deadline tracking */
  listWithDeadlines: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        overdue: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }).optional()
    )
    .query(async ({ input }) => {
      const pool = getPool();
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (input?.status) {
        conditions.push(`status = $${idx++}`);
        params.push(input.status);
      }
      if (input?.overdue) {
        conditions.push(`response_deadline < NOW() AND status NOT IN ('resolved', 'closed')`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const { rows } = await pool.query(
        `SELECT *, 
                EXTRACT(DAY FROM (response_deadline - NOW())) AS days_remaining,
                CASE WHEN response_deadline < NOW() AND status NOT IN ('resolved','closed') THEN true ELSE false END AS is_overdue
         FROM citizen_requests ${where}
         ORDER BY response_deadline ASC NULLS LAST
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, input?.limit ?? 50, input?.offset ?? 0]
      );
      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM citizen_requests ${where}`,
        params
      );
      return { rows, total: Number(countResult.rows[0].total) };
    }),

  /** Protected: escalate an overdue DSAR */
  escalate: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().min(10),
      })
    )
    .mutation(async ({ input }) => {
      const pool = getPool();
      await pool.query(
        `UPDATE citizen_requests
         SET status = 'overdue', escalated_at = NOW(), escalation_reason = $1, updated_at = NOW()
         WHERE id = $2`,
        [input.reason, input.id]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  /** Badge count: DSARs not yet resolved or closed */
  pendingCount: protectedProcedure.query(async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM citizen_requests WHERE status NOT IN ('resolved', 'closed')`
    );
    return { count: Number(rows[0].count) };
  }),
});

// ─── DPIA / TIA Wizard Router ────────────────────────────────────────────────
export const dpiaRouter = router({
  list: protectedProcedure
    .input(z.object({ orgId: z.number().int().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const pool = getPool();
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (input?.orgId) { conditions.push(`org_id = $${idx++}`); params.push(input.orgId); }
      if (input?.status) { conditions.push(`status = $${idx++}`); params.push(input.status); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const { rows } = await pool.query(
        `SELECT d.*, u.name as created_by_name FROM dpia_assessments d
         LEFT JOIN users u ON u.id = d.created_by
         ${where} ORDER BY d.created_at DESC`,
        params
      );
      return rows;
    }),

  create: protectedProcedure
    .input(
      z.object({
        orgId: z.number().int().positive(),
        title: z.string().min(3).max(256),
        processingPurpose: z.string().optional(),
        dataCategories: z.array(z.string()).optional(),
        dataSubjects: z.array(z.string()).optional(),
        necessityScore: z.number().int().min(1).max(5).optional(),
        proportionalityScore: z.number().int().min(1).max(5).optional(),
        riskFactors: z.array(z.any()).optional(),
        mitigations: z.array(z.any()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const pool = getPool();
      const riskLevel =
        (input.necessityScore ?? 3) < 3 || (input.proportionalityScore ?? 3) < 3
          ? "high"
          : "medium";
      const { rows } = await pool.query(
        `INSERT INTO dpia_assessments
          (org_id, title, processing_purpose, data_categories, data_subjects,
           necessity_score, proportionality_score, risk_level, risk_factors,
           mitigations, status, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,NOW(),NOW())
         RETURNING *`,
        [
          input.orgId, input.title, input.processingPurpose ?? null,
          input.dataCategories ?? [], input.dataSubjects ?? [],
          input.necessityScore ?? null, input.proportionalityScore ?? null,
          riskLevel,
          JSON.stringify(input.riskFactors ?? []),
          JSON.stringify(input.mitigations ?? []),
          ctx.user.id,
        ]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().optional(),
        processingPurpose: z.string().optional(),
        dataCategories: z.array(z.string()).optional(),
        dataSubjects: z.array(z.string()).optional(),
        necessityScore: z.number().int().min(1).max(5).optional(),
        proportionalityScore: z.number().int().min(1).max(5).optional(),
        riskFactors: z.array(z.any()).optional(),
        mitigations: z.array(z.any()).optional(),
        status: z.enum(["draft", "under_review", "approved", "rejected"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const pool = getPool();
      const { id, ...fields } = input;
      const setClauses: string[] = ["updated_at = NOW()"];
      const params: unknown[] = [];
      let idx = 1;
      if (fields.title !== undefined) { setClauses.push(`title = $${idx++}`); params.push(fields.title); }
      if (fields.processingPurpose !== undefined) { setClauses.push(`processing_purpose = $${idx++}`); params.push(fields.processingPurpose); }
      if (fields.dataCategories !== undefined) { setClauses.push(`data_categories = $${idx++}`); params.push(fields.dataCategories); }
      if (fields.dataSubjects !== undefined) { setClauses.push(`data_subjects = $${idx++}`); params.push(fields.dataSubjects); }
      if (fields.necessityScore !== undefined) { setClauses.push(`necessity_score = $${idx++}`); params.push(fields.necessityScore); }
      if (fields.proportionalityScore !== undefined) { setClauses.push(`proportionality_score = $${idx++}`); params.push(fields.proportionalityScore); }
      if (fields.riskFactors !== undefined) { setClauses.push(`risk_factors = $${idx++}`); params.push(JSON.stringify(fields.riskFactors)); }
      if (fields.mitigations !== undefined) { setClauses.push(`mitigations = $${idx++}`); params.push(JSON.stringify(fields.mitigations)); }
      if (fields.status !== undefined) {
        setClauses.push(`status = $${idx++}`); params.push(fields.status);
        if (fields.status === "approved") { setClauses.push(`completed_at = NOW()`); }
      }
      params.push(id);
      const { rows } = await pool.query(
        `UPDATE dpia_assessments SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
        params
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  /** AI-assisted risk analysis for a DPIA */
  aiAnalyse: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        processingPurpose: z.string(),
        dataCategories: z.array(z.string()),
        dataSubjects: z.array(z.string()),
      })
    )
    .mutation(async ({ input }) => {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content:
              "You are a Nigerian data protection expert specialising in NDPA 2023 DPIA assessments. Respond with JSON only.",
          },
          {
            role: "user",
            content: `Analyse this DPIA for NDPA 2023 compliance:\nTitle: ${input.title}\nPurpose: ${input.processingPurpose}\nData categories: ${input.dataCategories.join(", ")}\nData subjects: ${input.dataSubjects.join(", ")}\n\nReturn JSON: { riskLevel: "low"|"medium"|"high"|"very_high", riskFactors: [{factor: string, severity: "low"|"medium"|"high", ndpaArticle: string}], mitigations: [{action: string, priority: "low"|"medium"|"high"}], necessityScore: 1-5, proportionalityScore: 1-5, summary: string }`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "dpia_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                riskLevel: { type: "string" },
                riskFactors: { type: "array", items: { type: "object", properties: { factor: { type: "string" }, severity: { type: "string" }, ndpaArticle: { type: "string" } }, required: ["factor", "severity", "ndpaArticle"], additionalProperties: false } },
                mitigations: { type: "array", items: { type: "object", properties: { action: { type: "string" }, priority: { type: "string" } }, required: ["action", "priority"], additionalProperties: false } },
                necessityScore: { type: "number" },
                proportionalityScore: { type: "number" },
                summary: { type: "string" },
              },
              required: ["riskLevel", "riskFactors", "mitigations", "necessityScore", "proportionalityScore", "summary"],
              additionalProperties: false,
            },
          },
        },
      });
      const content = response.choices[0].message.content;
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return typeof content === "string" ? JSON.parse(content) : content;
    }),
});

// ─── AI Governance Scoring Router ────────────────────────────────────────────
export const aiGovernanceRouter = router({
  list: protectedProcedure
    .input(z.object({ orgId: z.number().int().optional() }).optional())
    .query(async ({ input }) => {
      const pool = getPool();
      const where = input?.orgId ? "WHERE org_id = $1" : "";
      const params = input?.orgId ? [input.orgId] : [];
      const { rows } = await pool.query(
        `SELECT g.*, u.name as assessed_by_name FROM ai_governance_scores g
         LEFT JOIN users u ON u.id = g.assessed_by
         ${where} ORDER BY g.created_at DESC`,
        params
      );
      return rows;
    }),

  score: protectedProcedure
    .input(
      z.object({
        orgId: z.number().int().positive(),
        systemName: z.string().min(2).max(256),
        systemType: z.string().optional(),
        systemDescription: z.string().min(10),
        useCases: z.array(z.string()),
        hasHumanOversight: z.boolean(),
        hasExplainability: z.boolean(),
        hasAuditTrail: z.boolean(),
        hasBiasAssessment: z.boolean(),
        hasDataGovernance: z.boolean(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Compute scores based on inputs
      const transparencyScore = Math.round(
        ((input.hasExplainability ? 40 : 0) + (input.hasAuditTrail ? 35 : 0) + 25) * 0.9
      );
      const fairnessScore = Math.round(
        ((input.hasBiasAssessment ? 60 : 0) + (input.hasDataGovernance ? 30 : 0) + 10)
      );
      const accountabilityScore = Math.round(
        ((input.hasAuditTrail ? 40 : 0) + (input.hasDataGovernance ? 35 : 0) + 25)
      );
      const humanOversightScore = input.hasHumanOversight ? 85 : 30;
      const overallScore = Math.round(
        (transparencyScore + fairnessScore + accountabilityScore + humanOversightScore) / 4
      );
      const ndpaCompliant = overallScore >= 70 && input.hasHumanOversight && input.hasAuditTrail;
      const riskCategory =
        overallScore >= 80 ? "low" : overallScore >= 60 ? "medium" : overallScore >= 40 ? "high" : "critical";

      // AI-generated findings
      const llmResponse = await invokeLLM({
        messages: [
          { role: "system", content: "You are an AI governance expert specialising in NDPA Article 24 compliance. Respond with JSON only." },
          {
            role: "user",
            content: `Assess this AI system for NDPA Article 24 compliance:\nSystem: ${input.systemName}\nType: ${input.systemType ?? "general"}\nDescription: ${input.systemDescription}\nUse cases: ${input.useCases.join(", ")}\nHuman oversight: ${input.hasHumanOversight}\nExplainability: ${input.hasExplainability}\nAudit trail: ${input.hasAuditTrail}\nBias assessment: ${input.hasBiasAssessment}\n\nReturn JSON: { findings: [{issue: string, severity: "low"|"medium"|"high"|"critical", ndpaArticle: string}], recommendations: [{action: string, priority: "low"|"medium"|"high", timeline: string}] }`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ai_governance_assessment",
            strict: true,
            schema: {
              type: "object",
              properties: {
                findings: { type: "array", items: { type: "object", properties: { issue: { type: "string" }, severity: { type: "string" }, ndpaArticle: { type: "string" } }, required: ["issue", "severity", "ndpaArticle"], additionalProperties: false } },
                recommendations: { type: "array", items: { type: "object", properties: { action: { type: "string" }, priority: { type: "string" }, timeline: { type: "string" } }, required: ["action", "priority", "timeline"], additionalProperties: false } },
              },
              required: ["findings", "recommendations"],
              additionalProperties: false,
            },
          },
        },
      });
      const aiContent = llmResponse.choices[0].message.content;
      const aiResult = typeof aiContent === "string" ? JSON.parse(aiContent) : aiContent;
      const nextReview = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

      const pool = getPool();
      const { rows } = await pool.query(
        `INSERT INTO ai_governance_scores
          (org_id, system_name, system_type, risk_category, transparency_score,
           fairness_score, accountability_score, human_oversight_score, overall_score,
           ndpa_article24_compliant, findings, recommendations, assessed_by,
           assessed_at, next_review_date, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),$14,NOW(),NOW())
         RETURNING *`,
        [
          input.orgId, input.systemName, input.systemType ?? null, riskCategory,
          transparencyScore, fairnessScore, accountabilityScore, humanOversightScore,
          overallScore, ndpaCompliant,
          JSON.stringify(aiResult.findings), JSON.stringify(aiResult.recommendations),
          ctx.user.id, nextReview,
        ]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),
});

// ─── Sector Benchmarking Router ───────────────────────────────────────────────
export const sectorBenchmarkRouter = router({
  list: protectedProcedure
    .input(z.object({ sector: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const pool = getPool();
      const where = input?.sector ? "WHERE sector = $1" : "";
      const params = input?.sector ? [input.sector] : [];
      const { rows } = await pool.query(
        `SELECT * FROM sector_benchmarks ${where} ORDER BY snapshot_date DESC, sector ASC`,
        params
      );
      return rows;
    }),

  compare: protectedProcedure
    .input(z.object({ orgId: z.number().int().positive(), sector: z.string() }))
    .query(async ({ input }) => {
      const pool = getPool();
      // Get org's compliance score
      const orgResult = await pool.query(
        `SELECT compliance_score FROM organizations WHERE id = $1`,
        [input.orgId]
      );
      const orgScore = Number(orgResult.rows[0]?.compliance_score ?? 0);
      // Get latest sector benchmark
      const benchResult = await pool.query(
        `SELECT * FROM sector_benchmarks WHERE sector = $1 ORDER BY snapshot_date DESC LIMIT 1`,
        [input.sector]
      );
      const benchmark = benchResult.rows[0];
      return {
        orgScore,
        sectorAvg: Number(benchmark?.avg_compliance_score ?? 0),
        sectorMedian: Number(benchmark?.median_compliance_score ?? 0),
        sectorOrgCount: benchmark?.org_count ?? 0,
        percentile:
          orgScore >= Number(benchmark?.avg_compliance_score ?? 0) ? "above_average" : "below_average",
        topViolations: benchmark?.top_violation_types ?? [],
        snapshotDate: benchmark?.snapshot_date,
      };
    }),

  sectors: publicProcedure.query(async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT DISTINCT sector FROM sector_benchmarks ORDER BY sector`
    );
    return rows.map((r: Record<string, unknown>) => r.sector);
  }),
});

// ─── Webhook Delivery Router ─────────────────────────────────────────────────
export const webhookRouter = router({
  listSubscriptions: protectedProcedure
    .input(z.object({ orgId: z.number().int().optional(), dpcoOrgId: z.number().int().optional() }).optional())
    .query(async ({ input }) => {
      const pool = getPool();
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (input?.orgId) { conditions.push(`org_id = $${idx++}`); params.push(input.orgId); }
      if (input?.dpcoOrgId) { conditions.push(`dpco_org_id = $${idx++}`); params.push(input.dpcoOrgId); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const { rows } = await pool.query(
        `SELECT id, org_id, dpco_org_id, url, events, is_active, failure_count,
                last_delivery_at, last_failure_at, created_at
         FROM webhook_subscriptions ${where} ORDER BY created_at DESC`,
        params
      );
      return rows;
    }),

  createSubscription: protectedProcedure
    .input(
      z.object({
        orgId: z.number().int().optional(),
        dpcoOrgId: z.number().int().optional(),
        url: z.string().url(),
        events: z.array(z.string()).min(1),
      })
    )
    .mutation(async ({ input }) => {
      const pool = getPool();
      const secret = crypto.randomBytes(32).toString("hex");
      const { rows } = await pool.query(
        `INSERT INTO webhook_subscriptions (org_id, dpco_org_id, url, secret, events, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW(),NOW()) RETURNING id, url, events, is_active`,
        [input.orgId ?? null, input.dpcoOrgId ?? null, input.url, secret, input.events]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { ...rows[0], secret }; // Return secret only on creation
    }),

  deleteSubscription: deleteProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const pool = getPool();
      await pool.query(`DELETE FROM webhook_subscriptions WHERE id = $1`, [input.id]);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  listDeliveries: protectedProcedure
    .input(z.object({ subscriptionId: z.number().int().positive(), limit: z.number().int().default(50) }))
    .query(async ({ input }) => {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT id, event_type, status, http_status, attempt_count, delivered_at, created_at
         FROM webhook_deliveries WHERE subscription_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [input.subscriptionId, input.limit]
      );
      return rows;
    }),

  /** Available webhook event types */
  eventTypes: publicProcedure.query(() => [
    "enforcement.case.opened",
    "enforcement.case.closed",
    "enforcement.penalty.issued",
    "breach.notification.submitted",
    "breach.notification.approved",
    "citizen.request.submitted",
    "citizen.request.resolved",
    "dpco.accreditation.approved",
    "dpco.accreditation.rejected",
    "dpco.subscription.upgraded",
    "dpco.subscription.cancelled",
    "dpco.invoice.paid",
    "dpco.invoice.overdue",
  ]),
});

// ─── Full-Text Search Router ──────────────────────────────────────────────────
export const searchRouter = router({
  global: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(200),
        types: z
          .array(z.enum(["organizations", "enforcement", "citizen_requests", "dpco"]))
          .optional(),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      const pool = getPool();
      const q = input.query;
      const results: any[] = [];
      const types = input.types ?? ["organizations", "enforcement", "citizen_requests", "dpco"];

      if (types.includes("organizations")) {
        const { rows } = await pool.query(
          `SELECT id, name, sector, registration_number, compliance_score,
                  ts_rank(to_tsvector('english', COALESCE(name,'') || ' ' || COALESCE(sector,'') || ' ' || COALESCE(registration_number,'')), plainto_tsquery('english', $1)) AS rank
           FROM organizations
           WHERE to_tsvector('english', COALESCE(name,'') || ' ' || COALESCE(sector,'') || ' ' || COALESCE(registration_number,'')) @@ plainto_tsquery('english', $1)
           ORDER BY rank DESC LIMIT $2`,
          [q, Math.ceil(input.limit / types.length)]
        );
        rows.forEach((r: Record<string, unknown>) => results.push({ type: "organization", ...r }));
      }

      if (types.includes("enforcement")) {
        const { rows } = await pool.query(
          `SELECT ec.id, ec.case_reference, ec.status, ec.opened_at,
                  o.name as org_name,
                  ts_rank(to_tsvector('english', COALESCE(ec.case_reference,'') || ' ' || COALESCE(ec.resolution_notes,'')), plainto_tsquery('english', $1)) AS rank
           FROM enforcement_cases ec
           LEFT JOIN organizations o ON o.id = ec.organization_id
           WHERE to_tsvector('english', COALESCE(ec.case_reference,'') || ' ' || COALESCE(ec.resolution_notes,'')) @@ plainto_tsquery('english', $1)
           ORDER BY rank DESC LIMIT $2`,
          [q, Math.ceil(input.limit / types.length)]
        );
        rows.forEach((r: Record<string, unknown>) => results.push({ type: "enforcement_case", ...r }));
      }

      if (types.includes("citizen_requests")) {
        const { rows } = await pool.query(
          `SELECT id, reference_number, request_type, status, citizen_name, submitted_at,
                  ts_rank(to_tsvector('english', COALESCE(citizen_name,'') || ' ' || COALESCE(description,'')), plainto_tsquery('english', $1)) AS rank
           FROM citizen_requests
           WHERE to_tsvector('english', COALESCE(citizen_name,'') || ' ' || COALESCE(description,'')) @@ plainto_tsquery('english', $1)
           ORDER BY rank DESC LIMIT $2`,
          [q, Math.ceil(input.limit / types.length)]
        );
        rows.forEach((r: Record<string, unknown>) => results.push({ type: "citizen_request", ...r }));
      }

      if (types.includes("dpco")) {
        const { rows } = await pool.query(
          `SELECT id, name, licence_number, tier, status,
                  ts_rank(to_tsvector('english', COALESCE(name,'') || ' ' || COALESCE(licence_number,'')), plainto_tsquery('english', $1)) AS rank
           FROM dpco_organisations
           WHERE to_tsvector('english', COALESCE(name,'') || ' ' || COALESCE(licence_number,'')) @@ plainto_tsquery('english', $1)
           ORDER BY rank DESC LIMIT $2`,
          [q, Math.ceil(input.limit / types.length)]
        );
        rows.forEach((r: Record<string, unknown>) => results.push({ type: "dpco", ...r }));
      }

      // Sort all results by rank descending
      results.sort((a, b) => Number(b.rank ?? 0) - Number(a.rank ?? 0));
      return results.slice(0, input.limit);
    }),
});

// ─── i18n Router ─────────────────────────────────────────────────────────────
export const i18nRouter = router({
  /** Public: get translations for a locale and namespace */
  getTranslations: publicProcedure
    .input(
      z.object({
        locale: z.enum(["en", "ha", "yo", "ig", "fr"]),
        namespace: z.string().default("common"),
      })
    )
    .query(async ({ input }) => {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT key, value FROM i18n_translations WHERE locale = $1 AND namespace = $2`,
        [input.locale, input.namespace]
      );
      const translations: Record<string, string> = {};
      rows.forEach((r: Record<string, unknown>) => { translations[String(r.key)] = String(r.value ?? ""); });
      return translations;
    }),

  /** Admin: upsert a translation */
  upsertTranslation: adminProcedure
    .input(
      z.object({
        locale: z.enum(["en", "ha", "yo", "ig", "fr"]),
        namespace: z.string().default("common"),
        key: z.string().min(1),
        value: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const pool = getPool();
      await pool.query(
        `INSERT INTO i18n_translations (locale, namespace, key, value, updated_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (locale, namespace, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [input.locale, input.namespace, input.key, input.value]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  /** Admin: AI-generate translations for a key */
  aiTranslate: adminProcedure
    .input(
      z.object({
        key: z.string(),
        sourceText: z.string(),
        targetLocales: z.array(z.enum(["ha", "yo", "ig", "fr"])),
        namespace: z.string().default("common"),
      })
    )
    .mutation(async ({ input }) => {
      const localeNames: Record<string, string> = {
        ha: "Hausa", yo: "Yoruba", ig: "Igbo", fr: "French",
      };
      const targetList = input.targetLocales.map(l => `${l} (${localeNames[l]})`).join(", ");
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are a professional translator specialising in Nigerian languages and French. Respond with JSON only." },
          {
            role: "user",
            content: `Translate this UI text to ${targetList}:\n"${input.sourceText}"\n\nReturn JSON with locale codes as keys: { ${input.targetLocales.map(l => `"${l}": "translation"`).join(", ")} }`,
          },
        ],
      });
      const content = response.choices[0].message.content;
      const translations = typeof content === "string" ? JSON.parse(content) : content;

      const pool = getPool();
      for (const [locale, value] of Object.entries(translations)) {
        await pool.query(
          `INSERT INTO i18n_translations (locale, namespace, key, value, updated_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (locale, namespace, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [locale, input.namespace, input.key, value]
        );
      }
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return translations;
    }),
});

// ─── CAR Automation Router ────────────────────────────────────────────────────
export const carAutomationRouter = router({
  /** List CARs for an organisation */
  list: protectedProcedure
    .input(z.object({ orgId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const pool = getPool();
      const { rows } = await pool.query(
        `SELECT * FROM compliance_audit_returns WHERE org_id = $1 ORDER BY reporting_year DESC`,
        [input.orgId]
      );
      return rows;
    }),
  /** Generate a full annual CAR for an organisation */
  generate: protectedProcedure
    .input(z.object({ orgId: z.number().int().positive(), year: z.number().int() }))
    .mutation(async ({ input }) => {
      const pool = getPool();
      const orgResult = await pool.query(`SELECT * FROM organizations WHERE id = $1`, [input.orgId]);
      const org = orgResult.rows[0];
      if (!org) throw new TRPCError({ code: 'NOT_FOUND', message: 'Organisation not found' });
      const [violRes, breachRes, dsarRes] = await Promise.all([
        pool.query(`SELECT COUNT(*) FROM violations WHERE organization_id = $1 AND status = 'open'`, [input.orgId]),
        pool.query(`SELECT COUNT(*) FROM breach_notifications WHERE organization_id = $1 AND EXTRACT(YEAR FROM submitted_at) = $2`, [input.orgId, input.year]),
        pool.query(`SELECT COUNT(*) FROM citizen_requests WHERE organization_id = $1 AND status = 'resolved' AND EXTRACT(YEAR FROM submitted_at) = $2`, [input.orgId, input.year]),
      ]);
      const openViolations = Number(violRes.rows[0]?.count ?? 0);
      const breachesReported = Number(breachRes.rows[0]?.count ?? 0);
      const dsarsResolved = Number(dsarRes.rows[0]?.count ?? 0);
      const complianceScore = Number(org.compliance_score ?? 75);
      const sections = [
        { title: 'Data Processing Activities', summary: 'Overview of personal data processing operations conducted during the reporting year.' },
        { title: 'Privacy Notices & Consent Management', summary: 'Review of consent mechanisms and privacy notice updates.' },
        { title: 'Data Subject Rights Fulfilment', summary: `${dsarsResolved} DSAR(s) resolved during ${input.year}.` },
        { title: 'Breach Incidents & Notifications', summary: `${breachesReported} breach notification(s) submitted to NITDA.` },
        { title: 'Compliance Violations & Remediation', summary: `${openViolations} open violation(s) pending remediation.` },
        { title: 'Data Protection Officer Activities', summary: 'DPO oversight, training, and audit activities.' },
        { title: 'Third-Party Data Processor Management', summary: 'Review of data processing agreements and vendor compliance.' },
        { title: 'International Data Transfers', summary: 'Cross-border data transfer mechanisms and adequacy assessments.' },
      ];
      const { rows } = await pool.query(
        `INSERT INTO compliance_audit_returns (org_id, reporting_year, title, compliance_score, open_violations, breaches_reported, dsars_resolved, sections, status, generated_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',NOW(),NOW(),NOW()) RETURNING *`,
        [input.orgId, input.year, `Compliance Audit Return ${input.year} — ${org.name}`, complianceScore, openViolations, breachesReported, dsarsResolved, JSON.stringify(sections)]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { ...rows[0], organisation: org.name, reportingYear: input.year, complianceScore, openViolations, breachesReported, dsarsResolved, sections };
    }),
  /** Submit a CAR to NITDA */
  submit: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const pool = getPool();
      const { rows } = await pool.query(
        `UPDATE compliance_audit_returns SET status = 'submitted', submitted_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
        [input.id]
      );
      if (!rows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'CAR not found' });
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),
  /** AI-generate a CAR narrative from enforcement case data */
  generateNarrative: protectedProcedure
    .input(
      z.object({
        caseReference: z.string(),
        orgName: z.string(),
        violationType: z.string(),
        violationDescription: z.string(),
        penaltyAmount: z.number().optional(),
        remediationSteps: z.array(z.string()).optional(),
        ndpaArticles: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content:
              "You are a Nigerian data protection compliance officer drafting Corrective Action Reports (CARs) under NDPA 2023. Write formal, legally precise language.",
          },
          {
            role: "user",
            content: `Draft a Corrective Action Report for:\nCase: ${input.caseReference}\nOrganisation: ${input.orgName}\nViolation: ${input.violationType}\nDescription: ${input.violationDescription}\nPenalty: ₦${(input.penaltyAmount ?? 0).toLocaleString()}\nNDPA Articles: ${(input.ndpaArticles ?? []).join(", ")}\nRemediation steps: ${(input.remediationSteps ?? []).join("; ")}\n\nReturn JSON: { executiveSummary: string, findingsNarrative: string, legalBasis: string, remediationPlan: string, complianceTimeline: string, closingStatement: string }`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "car_narrative",
            strict: true,
            schema: {
              type: "object",
              properties: {
                executiveSummary: { type: "string" },
                findingsNarrative: { type: "string" },
                legalBasis: { type: "string" },
                remediationPlan: { type: "string" },
                complianceTimeline: { type: "string" },
                closingStatement: { type: "string" },
              },
              required: ["executiveSummary", "findingsNarrative", "legalBasis", "remediationPlan", "complianceTimeline", "closingStatement"],
              additionalProperties: false,
            },
          },
        },
      });
      const content = response.choices[0].message.content;
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return typeof content === "string" ? JSON.parse(content) : content;
    }),
});

// ─── OpenAPI / Developer Portal Router ───────────────────────────────────────
export const openApiRouter = router({
  /** Get the current user's API key (prefix only for display) */
  getApiKey: protectedProcedure.query(async ({ ctx }) => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, key_prefix, created_at, last_used_at FROM api_keys WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at DESC LIMIT 1`,
      [ctx.user.id]
    );
    if (!rows[0]) return null;
    return { id: rows[0].id, key: `${rows[0].key_prefix}...`, createdAt: rows[0].created_at, lastUsedAt: rows[0].last_used_at };
  }),

  /** Generate or rotate the current user's API key */
  generateApiKey: protectedProcedure.mutation(async ({ ctx }) => {
    const pool = getPool();
    // Deactivate old keys
    await pool.query(`UPDATE api_keys SET is_active = FALSE WHERE user_id = $1`, [ctx.user.id]);
    // Generate new key
    const rawKey = `ndsep_${crypto.randomBytes(32).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.substring(0, 16);
    await pool.query(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix, is_active, created_at, updated_at) VALUES ($1,$2,$3,TRUE,NOW(),NOW())`,
      [ctx.user.id, keyHash, keyPrefix]
    );
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return { key: rawKey, prefix: keyPrefix };
  }),

  /** List all available webhook event types (public) */
  eventTypes: publicProcedure.query(() => [
    "enforcement.case.opened", "enforcement.case.closed", "enforcement.penalty.issued",
    "breach.notification.submitted", "breach.notification.approved",
    "citizen.request.submitted", "citizen.request.resolved",
    "dpco.accreditation.approved", "dpco.accreditation.rejected",
    "dpco.subscription.upgraded", "dpco.subscription.cancelled",
    "dpco.invoice.paid", "dpco.invoice.overdue",
  ]),
});

// ─────────────────────────────────────────────────────────────────────────────
// ORPHANED TABLE CRUD ROUTERS — remediation sprint 2026-04-11
// ─────────────────────────────────────────────────────────────────────────────
async function query(sql: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  const { rows } = await pool.query(sql, params);
  return rows;
}

export const aiSystemsRouter = router({
  list: protectedProcedure.input(z.object({ riskLevel: z.string().optional(), orgId: z.number().optional() }).optional()).query(async ({ input }) => {
    if (input?.riskLevel) return query("SELECT * FROM ai_systems WHERE risk_level=$1 ORDER BY created_at DESC LIMIT 200",[input.riskLevel]);
    if (input?.orgId) return query("SELECT * FROM ai_systems WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200",[input.orgId]);
    return query("SELECT * FROM ai_systems ORDER BY created_at DESC LIMIT 200", []);
  }),
  byId: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const rows = await query("SELECT * FROM ai_systems WHERE id = $1", [input.id]);
    return rows[0] ?? null;
  }),
  create: protectedProcedure.input(z.object({
    name: z.string().min(1), vendor: z.string().optional(), version: z.string().optional(),
    purpose: z.string().optional(), risk_level: z.enum(["low","medium","high","critical"]).default("medium"),
    org_id: z.number().optional(), organizationId: z.number().optional(), status: z.string().default("active"),
    personalDataProcessed: z.boolean().optional(),
  })).mutation(async ({ input }) => {
    const orgId = input.org_id ?? input.organizationId ?? null;
    const rows = await query(
      `INSERT INTO ai_systems (name,vendor,version,purpose,risk_level,org_id,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
      [input.name,input.vendor??null,input.version??null,input.purpose??null,input.risk_level,orgId,input.status]);
    return rows[0];
  }),
  update: protectedProcedure.input(z.object({ id: z.number(), name: z.string().optional(), risk_level: z.enum(["low","medium","high","critical"]).optional(), status: z.string().optional() })).mutation(async ({ input }) => {
    const { id, ...f } = input; const entries = Object.entries(f).filter(([,v])=>v!==undefined);
    if (!entries.length) return null;
    const sets = entries.map(([k],i)=>`${k}=$${i+2}`).join(","); const vals = entries.map(([,v])=>v);
    const rows = await query(`UPDATE ai_systems SET ${sets} WHERE id=$1 RETURNING *`,[id,...vals]); return rows[0];
  }),
  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { await query("DELETE FROM ai_systems WHERE id=$1",[input.id]); return {success:true}; }),
});

export const auditLogsRouter = router({
  list: protectedProcedure.input(z.object({ orgId: z.number().optional(), action: z.string().optional(), limit: z.number().default(100), offset: z.number().default(0) })).query(async ({ input }) => {
    const conds: string[] = []; const vals: any[] = [];
    if (input.orgId) { conds.push(`org_id=$${vals.length+1}`); vals.push(input.orgId); }
    if (input.action) { conds.push(`action ILIKE $${vals.length+1}`); vals.push(`%${input.action}%`); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    vals.push(input.limit, input.offset);
    return query(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${vals.length-1} OFFSET $${vals.length}`, vals);
  }),
  create: protectedProcedure.input(z.object({ actor_id: z.number().optional(), action: z.string(), resource_type: z.string().optional(), resource_id: z.string().optional(), details: z.record(z.string(), z.any()).optional(), ip_address: z.string().optional() })).mutation(async ({ input }) => {
    const rows = await query(`INSERT INTO audit_logs (actor_id,action,resource_type,resource_id,details,ip_address,created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
      [input.actor_id??null,input.action,input.resource_type??null,input.resource_id??null,JSON.stringify(input.details??{}),input.ip_address??null]);
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return rows[0];
  }),
});

export const compliancePoliciesRouter = router({
  list: protectedProcedure.query(async () => query("SELECT * FROM compliance_policies ORDER BY created_at DESC", [])),
  byId: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => { const r = await query("SELECT * FROM compliance_policies WHERE id=$1",[input.id]); return r[0]??null; }),
  create: adminProcedure.input(z.object({ name: z.string().min(1), framework: z.string(), description: z.string().optional(), policy_text: z.string().optional(), status: z.string().default("draft") })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO compliance_policies (name,framework,description,policy_text,status,created_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,[input.name,input.framework,input.description??null,input.policy_text??null,input.status]); return r[0];
  }),
  update: adminProcedure.input(z.object({ id: z.number(), name: z.string().optional(), status: z.string().optional(), policy_text: z.string().optional() })).mutation(async ({ input }) => {
    const { id, ...f } = input; const entries = Object.entries(f).filter(([,v])=>v!==undefined);
    if (!entries.length) return null;
    const sets = entries.map(([k],i)=>`${k}=$${i+2}`).join(","); const vals = entries.map(([,v])=>v);
    const r = await query(`UPDATE compliance_policies SET ${sets} WHERE id=$1 RETURNING *`,[id,...vals]); return r[0];
  }),
  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { await query("DELETE FROM compliance_policies WHERE id=$1",[input.id]); return {success:true}; }),
});

export const configSnapshotsRouter = router({
  list: protectedProcedure.input(z.object({ limit: z.number().default(50) })).query(async ({ input }) => query("SELECT * FROM config_snapshots ORDER BY created_at DESC LIMIT $1",[input.limit])),
  byId: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => { const r = await query("SELECT * FROM config_snapshots WHERE id=$1",[input.id]); return r[0]??null; }),
  create: adminProcedure.input(z.object({ name: z.string(), config_data: z.record(z.string(), z.any()), source: z.string().optional(), commit_hash: z.string().optional() })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO config_snapshots (name,config_data,source,commit_hash,created_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING *`,[input.name,JSON.stringify(input.config_data),input.source??null,input.commit_hash??null]); return r[0];
  }),
  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { await query("DELETE FROM config_snapshots WHERE id=$1",[input.id]); return {success:true}; }),
});

export const dataCatalogRouter = router({
  list: protectedProcedure.input(z.object({ search: z.string().optional(), limit: z.number().default(100) })).query(async ({ input }) => {
    if (input.search) return query(`SELECT * FROM data_catalog_entries WHERE name ILIKE $1 OR description ILIKE $1 ORDER BY created_at DESC LIMIT $2`,[`%${input.search}%`,input.limit]);
    return query("SELECT * FROM data_catalog_entries ORDER BY created_at DESC LIMIT $1",[input.limit]);
  }),
  byId: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => { const r = await query("SELECT * FROM data_catalog_entries WHERE id=$1",[input.id]); return r[0]??null; }),
  create: protectedProcedure.input(z.object({ name: z.string().min(1), description: z.string().optional(), data_type: z.string().optional(), classification: z.string().optional(), owner_org_id: z.number().optional(), location: z.string().optional(), retention_days: z.number().optional(), contains_pii: z.boolean().default(false) })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO data_catalog_entries (name,description,data_type,classification,owner_org_id,location,retention_days,contains_pii,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
      [input.name,input.description??null,input.data_type??null,input.classification??null,input.owner_org_id??null,input.location??null,input.retention_days??null,input.contains_pii]); return r[0];
  }),
  update: protectedProcedure.input(z.object({ id: z.number(), name: z.string().optional(), classification: z.string().optional(), retention_days: z.number().optional(), contains_pii: z.boolean().optional() })).mutation(async ({ input }) => {
    const { id, ...f } = input; const entries = Object.entries(f).filter(([,v])=>v!==undefined);
    if (!entries.length) return null;
    const sets = entries.map(([k],i)=>`${k}=$${i+2}`).join(","); const vals = entries.map(([,v])=>v);
    const r = await query(`UPDATE data_catalog_entries SET ${sets} WHERE id=$1 RETURNING *`,[id,...vals]); return r[0];
  }),
  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { await query("DELETE FROM data_catalog_entries WHERE id=$1",[input.id]); return {success:true}; }),
});

export const dpcoAuditLogsRouter = router({
  list: protectedProcedure.input(z.object({ dpcoOrgId: z.number().optional(), limit: z.number().default(100) })).query(async ({ input }) => {
    if (input.dpcoOrgId) return query("SELECT * FROM dpco_audit_logs WHERE dpco_org_id=$1 ORDER BY created_at DESC LIMIT $2",[input.dpcoOrgId,input.limit]);
    return query("SELECT * FROM dpco_audit_logs ORDER BY created_at DESC LIMIT $1",[input.limit]);
  }),
  create: protectedProcedure.input(z.object({ dpco_org_id: z.number(), actor_id: z.number().optional(), action: z.string(), details: z.record(z.string(), z.any()).optional() })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO dpco_audit_logs (dpco_org_id,actor_id,action,details,created_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING *`,[input.dpco_org_id,input.actor_id??null,input.action,JSON.stringify(input.details??{})]); return r[0];
  }),
});

export const dpcoPerformanceMetricsRouter = router({
  list: protectedProcedure.input(z.object({ dpcoOrgId: z.number() })).query(async ({ input }) =>
    query("SELECT * FROM dpco_performance_metrics WHERE dpco_org_id=$1 ORDER BY period_start DESC LIMIT 24",[input.dpcoOrgId])),
  upsert: protectedProcedure.input(z.object({ dpco_org_id: z.number(), period_start: z.string(), period_end: z.string(), cases_handled: z.number().default(0), avg_resolution_days: z.number().default(0), client_satisfaction_score: z.number().default(0), compliance_rate: z.number().default(0), revenue_ngn: z.number().default(0), active_clients: z.number().default(0) })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO dpco_performance_metrics (dpco_org_id,period_start,period_end,cases_handled,avg_resolution_days,client_satisfaction_score,compliance_rate,revenue_ngn,active_clients,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT (dpco_org_id,period_start) DO UPDATE SET cases_handled=EXCLUDED.cases_handled,avg_resolution_days=EXCLUDED.avg_resolution_days,client_satisfaction_score=EXCLUDED.client_satisfaction_score,compliance_rate=EXCLUDED.compliance_rate,revenue_ngn=EXCLUDED.revenue_ngn,active_clients=EXCLUDED.active_clients RETURNING *`,
      [input.dpco_org_id,input.period_start,input.period_end,input.cases_handled,input.avg_resolution_days,input.client_satisfaction_score,input.compliance_rate,input.revenue_ngn,input.active_clients]); return r[0];
  }),
});

export const enforcementActionsRouter = router({
  list: protectedProcedure.input(z.object({ caseId: z.number().optional() })).query(async ({ input }) => {
    if (input.caseId) return query("SELECT * FROM enforcement_actions WHERE case_id=$1 ORDER BY created_at DESC",[input.caseId]);
    return query("SELECT * FROM enforcement_actions ORDER BY created_at DESC LIMIT 200", []);
  }),
  create: adminProcedure.input(z.object({ case_id: z.number(), action_type: z.string(), description: z.string().optional(), assigned_to: z.number().optional(), due_date: z.string().optional(), status: z.string().default("pending") })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO enforcement_actions (case_id,action_type,description,assigned_to,due_date,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,[input.case_id,input.action_type,input.description??null,input.assigned_to??null,input.due_date??null,input.status]);
    syncEnforcementCase(String(r[0]?.id ?? ""), String(input.assigned_to ?? "system"), input.case_id).catch(() => {});
    return r[0];
  }),
  update: adminProcedure.input(z.object({ id: z.number(), status: z.string().optional(), description: z.string().optional() })).mutation(async ({ input }) => {
    const { id, ...f } = input; const entries = Object.entries(f).filter(([,v])=>v!==undefined);
    if (!entries.length) return null;
    const sets = entries.map(([k],i)=>`${k}=$${i+2}`).join(","); const vals = entries.map(([,v])=>v);
    const r = await query(`UPDATE enforcement_actions SET ${sets} WHERE id=$1 RETURNING *`,[id,...vals]); return r[0];
  }),
  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { await query("DELETE FROM enforcement_actions WHERE id=$1",[input.id]); return {success:true}; }),
});

export const evidencePackagesRouter = router({
  list: protectedProcedure.input(z.object({ caseId: z.number().optional(), orgId: z.number().optional() })).query(async ({ input }) => {
    if (input.caseId) return query("SELECT * FROM evidence_packages WHERE case_id=$1 ORDER BY created_at DESC",[input.caseId]);
    if (input.orgId) return query("SELECT * FROM evidence_packages WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200",[input.orgId]);
    return query("SELECT * FROM evidence_packages ORDER BY created_at DESC LIMIT 200", []);
  }),
  generate: protectedProcedure.input(z.object({ organizationId: z.number().optional(), packageType: z.string().default("compliance_audit"), referenceType: z.string().optional() })).mutation(async ({ input, ctx }) => {
    const crypto = await import('crypto');
    const contentHash = `sha256-${crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
    const hmacKey = process.env.JWT_SECRET;
    if (!hmacKey) throw new Error("JWT_SECRET is required for HMAC signing");
    const hmacSignature = `hmac-${crypto.createHmac('sha256', hmacKey).update(contentHash).digest('hex').slice(0, 32)}`;
    const r = await query(`INSERT INTO evidence_packages (org_id,package_type,reference_type,content_hash,hmac_signature,status,generated_by,created_at) VALUES ($1,$2,$3,$4,$5,'ready',$6,NOW()) RETURNING *`,[input.organizationId??null,input.packageType,input.referenceType??null,contentHash,hmacSignature,ctx.user.id]); return r[0];
  }),
  verify: protectedProcedure.input(z.object({ contentHash: z.string(), hmacSignature: z.string() })).query(async ({ input }) => {
    const r = await query("SELECT * FROM evidence_packages WHERE content_hash=$1 AND hmac_signature=$2",[input.contentHash,input.hmacSignature]);
    return { valid: r.length > 0, package: r[0]??null };
  }),
  byId: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => { const r = await query("SELECT * FROM evidence_packages WHERE id=$1",[input.id]); return r[0]??null; }),
  create: protectedProcedure.input(z.object({ case_id: z.number().optional(), name: z.string(), description: z.string().optional(), file_url: z.string().optional(), file_key: z.string().optional(), mime_type: z.string().optional(), size_bytes: z.number().optional(), hash_sha256: z.string().optional(), signed: z.boolean().default(false) })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO evidence_packages (case_id,name,description,file_url,file_key,mime_type,size_bytes,hash_sha256,signed,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,[input.case_id??null,input.name,input.description??null,input.file_url??null,input.file_key??null,input.mime_type??null,input.size_bytes??null,input.hash_sha256??null,input.signed]); return r[0];
  }),
  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { await query("DELETE FROM evidence_packages WHERE id=$1",[input.id]); return {success:true}; }),
});

export const mlRiskPredictionsRouter = router({
  list: protectedProcedure.input(z.object({ orgId: z.number().optional(), limit: z.number().default(100) })).query(async ({ input }) => {
    if (input.orgId) return query("SELECT * FROM ml_risk_predictions WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2",[input.orgId,input.limit]);
    return query("SELECT * FROM ml_risk_predictions ORDER BY created_at DESC LIMIT $1",[input.limit]);
  }),
  create: protectedProcedure.input(z.object({ org_id: z.number(), model_version: z.string(), risk_score: z.number(), confidence: z.number(), features: z.record(z.string(), z.any()).optional(), prediction_label: z.string().optional() })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO ml_risk_predictions (org_id,model_version,risk_score,confidence,features,prediction_label,created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,[input.org_id,input.model_version,input.risk_score,input.confidence,JSON.stringify(input.features??{}),input.prediction_label??null]); return r[0];
  }),
});

export const penaltyAppealsRouter = router({
  list: protectedProcedure.input(z.object({ penaltyId: z.number().optional() })).query(async ({ input }) => {
    if (input.penaltyId) return query("SELECT * FROM penalty_appeals WHERE penalty_id=$1 ORDER BY created_at DESC",[input.penaltyId]);
    return query("SELECT * FROM penalty_appeals ORDER BY created_at DESC LIMIT 200", []);
  }),
  create: protectedProcedure.input(z.object({ penalty_id: z.number(), appellant_org_id: z.number(), grounds: z.string(), supporting_docs: z.array(z.string()).optional(), contact_email: z.string().email().optional() })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO penalty_appeals (penalty_id,appellant_org_id,grounds,supporting_docs,contact_email,status,created_at) VALUES ($1,$2,$3,$4,$5,'submitted',NOW()) RETURNING *`,[input.penalty_id,input.appellant_org_id,input.grounds,JSON.stringify(input.supporting_docs??[]),input.contact_email??null]); return r[0];
  }),
  updateStatus: adminProcedure.input(z.object({ id: z.number(), status: z.enum(["submitted","under_review","upheld","dismissed","withdrawn"]), reviewer_notes: z.string().optional() })).mutation(async ({ input }) => {
    const r = await query(`UPDATE penalty_appeals SET status=$2,reviewer_notes=$3,reviewed_at=NOW() WHERE id=$1 RETURNING *`,[input.id,input.status,input.reviewer_notes??null]); return r[0];
  }),
});

export const policyTemplatesRouter = router({
  list: protectedProcedure.input(z.object({ framework: z.string().optional() })).query(async ({ input }) => {
    if (input.framework) return query("SELECT * FROM policy_templates WHERE framework=$1 ORDER BY created_at DESC",[input.framework]);
    return query("SELECT * FROM policy_templates ORDER BY created_at DESC", []);
  }),
  byId: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => { const r = await query("SELECT * FROM policy_templates WHERE id=$1",[input.id]); return r[0]??null; }),
  create: adminProcedure.input(z.object({ name: z.string().min(1), framework: z.string(), category: z.string().optional(), template_text: z.string(), variables: z.array(z.string()).optional(), is_public: z.boolean().default(true) })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO policy_templates (name,framework,category,template_text,variables,is_public,created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,[input.name,input.framework,input.category??null,input.template_text,JSON.stringify(input.variables??[]),input.is_public]); return r[0];
  }),
  update: adminProcedure.input(z.object({ id: z.number(), name: z.string().optional(), template_text: z.string().optional(), is_public: z.boolean().optional() })).mutation(async ({ input }) => {
    const { id, ...f } = input; const entries = Object.entries(f).filter(([,v])=>v!==undefined);
    if (!entries.length) return null;
    const sets = entries.map(([k],i)=>`${k}=$${i+2}`).join(","); const vals = entries.map(([,v])=>v);
    const r = await query(`UPDATE policy_templates SET ${sets} WHERE id=$1 RETURNING *`,[id,...vals]); return r[0];
  }),
  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { await query("DELETE FROM policy_templates WHERE id=$1",[input.id]); return {success:true}; }),
  instantiate: protectedProcedure.input(z.object({ templateId: z.number(), orgId: z.number() })).mutation(async ({ input }) => {
    const tmpl = await query("SELECT * FROM policy_templates WHERE id=$1",[input.templateId]);
    if (!tmpl[0]) throw new Error("Template not found");
    const t = tmpl[0] as Record<string, unknown>;
    const r = await query(`INSERT INTO compliance_policies (name,framework,description,policy_text,status,created_at) VALUES ($1,$2,$3,$4,'active',NOW()) RETURNING *`,[`${t.name} (Org ${input.orgId})`,t.framework??'NDPR',t.category??null,t.template_text??null]);
    await query("UPDATE policy_templates SET instantiated_count=COALESCE(instantiated_count,0)+1 WHERE id=$1",[input.templateId]);
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "enhancement_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return r[0];
  }),
});

export const streamingEventsDbRouter = router({
  list: protectedProcedure.input(z.object({ topic: z.string().optional(), limit: z.number().default(100) })).query(async ({ input }) => {
    if (input.topic) return query(`SELECT * FROM streaming_events WHERE topic=$1 ORDER BY created_at DESC LIMIT $2`,[input.topic,input.limit]);
    return query("SELECT * FROM streaming_events ORDER BY created_at DESC LIMIT $1",[input.limit]);
  }),
  stats: protectedProcedure.query(async () => query(`SELECT topic,COUNT(*) as event_count,AVG(latency_ms) as avg_latency_ms,MAX(created_at) as last_event_at FROM streaming_events GROUP BY topic ORDER BY event_count DESC`, [])),
  create: protectedProcedure.input(z.object({ topic: z.string(), partition: z.number().optional(), offset: z.number().optional(), payload: z.record(z.string(), z.any()), source: z.string().optional(), latency_ms: z.number().optional() })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO streaming_events (topic,partition,"offset",payload,source,latency_ms,created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,[input.topic,input.partition??0,input.offset??0,JSON.stringify(input.payload),input.source??"api",input.latency_ms??null]); return r[0];
  }),
});

export const threatIntelligenceRouter = router({
  list: protectedProcedure.input(z.object({ severity: z.string().optional(), limit: z.number().default(100) })).query(async ({ input }) => {
    if (input.severity) return query("SELECT * FROM threat_intelligence WHERE severity=$1 ORDER BY created_at DESC LIMIT $2",[input.severity,input.limit]);
    return query("SELECT * FROM threat_intelligence ORDER BY created_at DESC LIMIT $1",[input.limit]);
  }),
  create: adminProcedure.input(z.object({ indicator_type: z.string(), indicator_value: z.string(), severity: z.enum(["low","medium","high","critical"]), source: z.string().optional(), description: z.string().optional(), ttl_hours: z.number().default(24) })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO threat_intelligence (indicator_type,indicator_value,severity,source,description,ttl_hours,created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,[input.indicator_type,input.indicator_value,input.severity,input.source??null,input.description??null,input.ttl_hours]); return r[0];
  }),
  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { await query("DELETE FROM threat_intelligence WHERE id=$1",[input.id]); return {success:true}; }),
});

export const tiaAssessmentsRouter = router({
  list: protectedProcedure.input(z.object({ orgId: z.number().optional() })).query(async ({ input }) => {
    if (input.orgId) return query("SELECT * FROM tia_assessments WHERE org_id=$1 ORDER BY created_at DESC",[input.orgId]);
    return query("SELECT * FROM tia_assessments ORDER BY created_at DESC LIMIT 200", []);
  }),
  byId: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => { const r = await query("SELECT * FROM tia_assessments WHERE id=$1",[input.id]); return r[0]??null; }),
  create: protectedProcedure.input(z.object({ org_id: z.number(), transfer_destination: z.string(), legal_basis: z.string(), data_categories: z.array(z.string()).optional(), risk_level: z.enum(["low","medium","high","critical"]).default("medium"), safeguards: z.string().optional(), status: z.string().default("draft") })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO tia_assessments (org_id,transfer_destination,legal_basis,data_categories,risk_level,safeguards,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,[input.org_id,input.transfer_destination,input.legal_basis,JSON.stringify(input.data_categories??[]),input.risk_level,input.safeguards??null,input.status]); return r[0];
  }),
  update: protectedProcedure.input(z.object({ id: z.number(), status: z.string().optional(), risk_level: z.enum(["low","medium","high","critical"]).optional(), safeguards: z.string().optional() })).mutation(async ({ input }) => {
    const { id, ...f } = input; const entries = Object.entries(f).filter(([,v])=>v!==undefined);
    if (!entries.length) return null;
    const sets = entries.map(([k],i)=>`${k}=$${i+2}`).join(","); const vals = entries.map(([,v])=>v);
    const r = await query(`UPDATE tia_assessments SET ${sets} WHERE id=$1 RETURNING *`,[id,...vals]); return r[0];
  }),
  delete: deleteProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { await query("DELETE FROM tia_assessments WHERE id=$1",[input.id]); return {success:true}; }),
});

export const transferImpactRouter = router({
  list: protectedProcedure.input(z.object({ orgId: z.number().optional() })).query(async ({ input }) => {
    if (input.orgId) return query("SELECT * FROM transfer_impact_assessments WHERE org_id=$1 ORDER BY created_at DESC",[input.orgId]);
    return query("SELECT * FROM transfer_impact_assessments ORDER BY created_at DESC LIMIT 200", []);
  }),
  create: protectedProcedure.input(z.object({ org_id: z.number(), destination_country: z.string(), adequacy_decision: z.boolean().default(false), safeguard_mechanism: z.string().optional(), risk_summary: z.string().optional(), approved: z.boolean().default(false) })).mutation(async ({ input }) => {
    const r = await query(`INSERT INTO transfer_impact_assessments (org_id,destination_country,adequacy_decision,safeguard_mechanism,risk_summary,approved,created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,[input.org_id,input.destination_country,input.adequacy_decision,input.safeguard_mechanism??null,input.risk_summary??null,input.approved]); return r[0];
  }),
  update: adminProcedure.input(z.object({ id: z.number(), approved: z.boolean().optional(), risk_summary: z.string().optional() })).mutation(async ({ input }) => {
    const { id, ...f } = input; const entries = Object.entries(f).filter(([,v])=>v!==undefined);
    if (!entries.length) return null;
    const sets = entries.map(([k],i)=>`${k}=$${i+2}`).join(","); const vals = entries.map(([,v])=>v);
    const r = await query(`UPDATE transfer_impact_assessments SET ${sets} WHERE id=$1 RETURNING *`,[id,...vals]); return r[0];
  }),
  delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => { await query("DELETE FROM transfer_impact_assessments WHERE id=$1",[input.id]); return {success:true}; }),
});
