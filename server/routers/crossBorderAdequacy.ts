/**
 * Cross-Border Transfer Adequacy Router — NDPA 2023 ss.41-43
 * - Adequacy-decision lifecycle (issue / suspend / revoke / reinstate) with
 *   criteria and review dates
 * - Binding Corporate Rules (BCR) registry + NDPC approval workflow
 * - Derogation tracking per transfer
 * - Enforcement-action linkage for unlawful transfers
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const safeParams = params.map((p) =>
      Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
        ? JSON.stringify(p)
        : p
    );
    const result = await pool.query(query, safeParams);
    const rows = result.rows ?? [];
    return autoDecryptRows(query, rows);
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[crossBorder] DB query error");
    return [];
  }
}

async function logAudit(
  action: string,
  resourceType: string,
  resourceId: string | number | null,
  userId: string | null,
  details: Record<string, unknown> = {}
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())`,
      [action, resourceType, String(resourceId ?? ""), userId, JSON.stringify(details)]
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[crossBorder] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

const ADEQUACY_STATUSES = ["proposed", "in_force", "suspended", "revoked"] as const;
const DEROGATION_TYPES = [
  "explicit_consent",
  "contract_performance",
  "public_interest",
  "legal_claims",
  "vital_interests",
  "legitimate_interests",
] as const;

export const crossBorderAdequacyRouter = router({
  // ─── Adequacy decisions (NDPA s.41) ──────────────────────────────────────
  listAdequacyDecisions: protectedProcedure
    .input(z.object({ status: z.enum(ADEQUACY_STATUSES).optional(), country: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.status) { params.push(input.status); conditions.push(`decision_status = $${params.length}`); }
      if (input?.country) { params.push(`%${input.country}%`); conditions.push(`country ILIKE $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(`SELECT * FROM adequacy_decisions ${where} ORDER BY country ASC`, params);
    }),

  getAdequacyDecision: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await exec(`SELECT * FROM adequacy_decisions WHERE id = $1`, [input.id]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Adequacy decision not found" });
      return rows[0];
    }),

  /** NDPC issues (or proposes) an adequacy finding for a country/region */
  issueAdequacyDecision: adminProcedure
    .input(z.object({
      country: z.string().min(2).max(128),
      region: z.string().max(128).optional(),
      criteria: z.record(z.string(), z.any()).optional(),
      review_due_date: z.string().optional(),
      notes: z.string().optional(),
      in_force: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const status = input.in_force ? "in_force" : "proposed";
      const [row] = await exec(
        `INSERT INTO adequacy_decisions
           (country, region, decision_status, criteria, issued_by, issued_at, review_due_date, notes)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $3 = 'in_force' THEN NOW() ELSE NULL END, $6, $7)
         RETURNING *`,
        [
          input.country, input.region ?? null, status, input.criteria ?? {},
          ctx.user.name ?? String(ctx.user.id), input.review_due_date ?? null, input.notes ?? null,
        ]
      );
      await logAudit("adequacy_decision_issued", "adequacy_decisions", row?.id, String(ctx.user.id), { country: input.country, status });
      fireAndForget("crossBorderAdequacy.issueAdequacyDecision");
      return row;
    }),

  suspendAdequacyDecision: adminProcedure
    .input(z.object({ id: z.number().int().positive(), reason: z.string().min(10) }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE adequacy_decisions
         SET decision_status = 'suspended', suspended_at = NOW(), suspension_reason = $2, updated_at = NOW()
         WHERE id = $1 AND decision_status = 'in_force' RETURNING *`,
        [input.id, input.reason]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Only an in-force decision can be suspended" });
      await logAudit("adequacy_decision_suspended", "adequacy_decisions", input.id, String(ctx.user.id), { reason: input.reason });
      fireAndForget("crossBorderAdequacy.suspendAdequacyDecision");
      return row;
    }),

  revokeAdequacyDecision: adminProcedure
    .input(z.object({ id: z.number().int().positive(), reason: z.string().min(10) }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE adequacy_decisions
         SET decision_status = 'revoked', revoked_at = NOW(), revocation_reason = $2, updated_at = NOW()
         WHERE id = $1 AND decision_status IN ('in_force', 'suspended') RETURNING *`,
        [input.id, input.reason]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Decision not found or already revoked" });
      await logAudit("adequacy_decision_revoked", "adequacy_decisions", input.id, String(ctx.user.id), { reason: input.reason });
      fireAndForget("crossBorderAdequacy.revokeAdequacyDecision");
      return row;
    }),

  reinstateAdequacyDecision: adminProcedure
    .input(z.object({ id: z.number().int().positive(), review_due_date: z.string().optional(), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE adequacy_decisions
         SET decision_status = 'in_force', suspended_at = NULL, suspension_reason = NULL,
             review_due_date = COALESCE($2, review_due_date), notes = COALESCE($3, notes), updated_at = NOW()
         WHERE id = $1 AND decision_status = 'suspended' RETURNING *`,
        [input.id, input.review_due_date ?? null, input.notes ?? null]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Only a suspended decision can be reinstated" });
      await logAudit("adequacy_decision_reinstated", "adequacy_decisions", input.id, String(ctx.user.id), {});
      fireAndForget("crossBorderAdequacy.reinstateAdequacyDecision");
      return row;
    }),

  /** Countries/region whose adequacy review is coming due */
  adequacyReviewsDue: protectedProcedure
    .input(z.object({ withinDays: z.number().int().min(1).max(365).default(90) }).optional())
    .query(async ({ input }) => {
      return exec(
        `SELECT *, (review_due_date - CURRENT_DATE) AS days_until_review
         FROM adequacy_decisions
         WHERE decision_status = 'in_force'
           AND review_due_date IS NOT NULL
           AND review_due_date <= CURRENT_DATE + ($1 || ' days')::interval
         ORDER BY review_due_date ASC`,
        [input?.withinDays ?? 90]
      );
    }),

  // ─── Binding Corporate Rules registry + approval (NDPA s.42) ────────────
  listBcrs: protectedProcedure
    .input(z.object({ status: z.string().optional(), organizationId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      if (input?.organizationId) { params.push(input.organizationId); conditions.push(`organization_id = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(`SELECT * FROM binding_corporate_rules ${where} ORDER BY created_at DESC`, params);
    }),

  registerBcr: protectedProcedure
    .input(z.object({
      organization_id: z.number().int().positive().optional(),
      group_name: z.string().min(2).max(256),
      bcr_document_url: z.string().url().optional(),
      bcr_document_key: z.string().optional(),
      scope: z.record(z.string(), z.any()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `INSERT INTO binding_corporate_rules
           (organization_id, group_name, bcr_document_url, bcr_document_key, scope, status, submitted_at)
         VALUES ($1, $2, $3, $4, $5, 'submitted', NOW()) RETURNING *`,
        [input.organization_id ?? null, input.group_name, input.bcr_document_url ?? null, input.bcr_document_key ?? null, input.scope ?? {}]
      );
      await logAudit("bcr_registered", "binding_corporate_rules", row?.id, String(ctx.user.id), { group_name: input.group_name });
      fireAndForget("crossBorderAdequacy.registerBcr");
      return row;
    }),

  reviewBcr: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["approved", "rejected", "under_review"]),
      review_notes: z.string().optional(),
      approval_reference: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.decision === "approved" && !input.approval_reference) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "approval_reference is required when approving BCRs" });
      }
      const [row] = await exec(
        `UPDATE binding_corporate_rules
         SET status = $2, reviewed_by = $3, reviewed_at = NOW(), review_notes = $4, approval_reference = $5, updated_at = NOW()
         WHERE id = $1 AND status IN ('submitted', 'under_review') RETURNING *`,
        [input.id, input.decision, ctx.user.name ?? String(ctx.user.id), input.review_notes ?? null, input.approval_reference ?? null]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "BCR not found or already decided" });
      await logAudit("bcr_reviewed", "binding_corporate_rules", input.id, String(ctx.user.id), { decision: input.decision });
      fireAndForget("crossBorderAdequacy.reviewBcr");
      return row;
    }),

  // ─── Derogation tracking (NDPA s.43) ─────────────────────────────────────
  recordDerogation: protectedProcedure
    .input(z.object({
      organization_id: z.number().int().positive(),
      destination_country: z.string().min(2).max(128),
      derogation_type: z.enum(DEROGATION_TYPES),
      justification: z.string().min(10),
      transfer_reference: z.string().max(128).optional(),
      data_subject_count: z.number().int().min(0).optional(),
      transfer_date: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Check whether an in-force adequacy decision exists for the destination;
      // if so a derogation is recorded but flagged as not strictly required.
      const adequacy = await exec(
        `SELECT id, decision_status FROM adequacy_decisions WHERE country ILIKE $1 ORDER BY id DESC LIMIT 1`,
        [input.destination_country]
      );
      const adequacyId = adequacy[0]?.id ?? null;
      const [row] = await exec(
        `INSERT INTO cross_border_derogations
           (organization_id, transfer_reference, destination_country, adequacy_decision_id,
            derogation_type, data_subject_count, justification, transfer_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()), $9)
         RETURNING *`,
        [
          input.organization_id, input.transfer_reference ?? null, input.destination_country,
          adequacyId, input.derogation_type, input.data_subject_count ?? null,
          input.justification, input.transfer_date ?? null, ctx.user.name ?? String(ctx.user.id),
        ]
      );
      await logAudit("derogation_recorded", "cross_border_derogations", row?.id, String(ctx.user.id), {
        destination: input.destination_country, type: input.derogation_type,
        adequate_destination: adequacy[0]?.decision_status === "in_force",
      });
      fireAndForget("crossBorderAdequacy.recordDerogation");
      return { ...row, adequacy_status_at_destination: adequacy[0]?.decision_status ?? "none" };
    }),

  listDerogations: protectedProcedure
    .input(z.object({ organizationId: z.number().optional(), country: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.organizationId) { params.push(input.organizationId); conditions.push(`d.organization_id = $${params.length}`); }
      if (input?.country) { params.push(`%${input.country}%`); conditions.push(`d.destination_country ILIKE $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT d.*, a.decision_status AS adequacy_status
         FROM cross_border_derogations d
         LEFT JOIN adequacy_decisions a ON a.id = d.adequacy_decision_id
         ${where} ORDER BY d.transfer_date DESC LIMIT 500`,
        params
      );
    }),

  // ─── Enforcement linkage for unlawful transfers ──────────────────────────
  linkEnforcementAction: adminProcedure
    .input(z.object({
      enforcement_action_id: z.number().int().positive(),
      derogation_id: z.number().int().positive().optional(),
      adequacy_decision_id: z.number().int().positive().optional(),
      link_reason: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!input.derogation_id && !input.adequacy_decision_id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide derogation_id or adequacy_decision_id to link" });
      }
      const [row] = await exec(
        `INSERT INTO cross_border_enforcement_links
           (derogation_id, adequacy_decision_id, enforcement_action_id, link_reason, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [input.derogation_id ?? null, input.adequacy_decision_id ?? null, input.enforcement_action_id, input.link_reason, ctx.user.name ?? String(ctx.user.id)]
      );
      await logAudit("cross_border_enforcement_linked", "cross_border_enforcement_links", row?.id, String(ctx.user.id), {
        enforcement_action_id: input.enforcement_action_id,
      });
      fireAndForget("crossBorderAdequacy.linkEnforcementAction");
      return row;
    }),

  listEnforcementLinks: protectedProcedure
    .input(z.object({ enforcementActionId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.enforcementActionId) { params.push(input.enforcementActionId); where = `WHERE l.enforcement_action_id = $${params.length}`; }
      return exec(
        `SELECT l.*, e.action_type AS enforcement_action_type, e.status AS enforcement_status,
                d.destination_country, d.derogation_type
         FROM cross_border_enforcement_links l
         LEFT JOIN enforcement_actions e ON e.id = l.enforcement_action_id
         LEFT JOIN cross_border_derogations d ON d.id = l.derogation_id
         ${where} ORDER BY l.created_at DESC LIMIT 200`,
        params
      );
    }),
});
