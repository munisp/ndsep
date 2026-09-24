/**
 * Breach Edge Cases Router — NDPA 2023 s.40
 * - Extended breach classification (joint controllers, processor origin,
 *   cross-border scope, ransomware exfiltration)
 * - Late-notification auto-penalty: notified > 72h after detection creates a
 *   penalty draft (breach_late_penalties) plus an admin review task
 * - Incomplete-notification supplementation flow (breach_supplements)
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
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
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
    logger.error({ err, query: query.slice(0, 200) }, "[breachEdge] DB query error");
    // Keep the original pg error on .cause so callers can branch on SQLSTATE
    // (e.g. 23505 retry for the supplement-sequence race).
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error", cause: err });
  }
}

/** audit_logs.resource_id / user_id are int4; coerce non-numeric refs to NULL. */
function toIntOrNull(v: string | number | null): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
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
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)]
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[breachEdge] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

/** Statutory NDPC notification window under NDPA s.40 */
const NOTIFICATION_WINDOW_HOURS = 72;

/**
 * Late-notification draft-penalty schedule, framed on NDPA 2023 s.49:
 * for a "data controller of major importance" the statutory maximum fine is
 * the GREATER of ₦10,000,000 or 2% of annual gross turnover (s.49(2); the
 * residual category is the greater of ₦2,000,000 or 2% of turnover).
 *
 * The auto-generated draft accrues DAILY_RATE_OF_BASE of that s.49 base per
 * commenced 24h of lateness, capped at MAX_ACCRUAL_DAYS days so a forgotten
 * breach cannot accrue an unbounded draft. These figures are NDPC policy
 * parameters, not statutory entitlements: every draft still requires admin
 * confirmation (confirmLatePenalty) before it is enforceable, and the exact
 * statutory basis/classification must be confirmed by counsel.
 */
const LATE_PENALTY_MAJOR_CONTROLLER_BASE_NGN = 10_000_000;
const LATE_PENALTY_TURNOVER_RATE = 0.02;
const LATE_PENALTY_DAILY_RATE_OF_BASE = 0.01; // 1% of the s.49 base per commenced day late
const LATE_PENALTY_MAX_ACCRUAL_DAYS = 30; // daily accrual cap

/** Compute the draft penalty for `daysLate` days of late notification. */
function computeLatePenaltyDraft(daysLate: number, annualTurnoverNgn: number | null): number {
  const base = Math.max(
    LATE_PENALTY_MAJOR_CONTROLLER_BASE_NGN,
    annualTurnoverNgn != null && annualTurnoverNgn > 0 ? annualTurnoverNgn * LATE_PENALTY_TURNOVER_RATE : 0,
  );
  const cappedDays = Math.min(daysLate, LATE_PENALTY_MAX_ACCRUAL_DAYS);
  return Math.round(base * LATE_PENALTY_DAILY_RATE_OF_BASE * cappedDays * 100) / 100;
}

const STAFF_ROLES = ["admin", "government_staff"];

/**
 * Authorization: staff (admin/government_staff) may act on any breach;
 * everyone else must belong to the organisation that owns the breach
 * (organization_users membership — same pattern as productionFeatures
 * apiKeyManagement).
 */
async function assertBreachAccess(
  user: { id: number; role: string },
  breachId: number,
): Promise<{ organization_id: number; detected_at: string }> {
  const rows = await exec(
    `SELECT organization_id, detected_at FROM breach_incidents WHERE id = $1`,
    [breachId],
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Breach incident not found" });
  if (!STAFF_ROLES.includes(user.role)) {
    const membership = await exec(
      `SELECT 1 AS member FROM organization_users WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
      [user.id, rows[0].organization_id],
    );
    if (membership.length === 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You can only act on breaches for organisations you belong to." });
    }
  }
  return rows[0];
}

export const breachEdgeCasesRouter = router({
  // ─── Extended classification ─────────────────────────────────────────────
  classifyBreach: protectedProcedure
    .input(z.object({
      breach_id: z.number().int().positive(),
      joint_controller_ids: z.array(z.number().int()).optional(),
      processor_origin: z.boolean().optional(),
      originating_processor_id: z.number().int().positive().optional(),
      is_cross_border: z.boolean().optional(),
      affected_jurisdictions: z.array(z.string()).optional(),
      ransomware_data_exfiltrated: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { breach_id, ...fields } = input;
      if (fields.processor_origin === false && fields.originating_processor_id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "originating_processor_id requires processor_origin = true" });
      }
      await assertBreachAccess(ctx.user, breach_id);
      const [row] = await exec(
        `UPDATE breach_incidents SET
           joint_controller_ids = COALESCE($2::jsonb, joint_controller_ids),
           processor_origin = COALESCE($3, processor_origin),
           originating_processor_id = COALESCE($4, originating_processor_id),
           is_cross_border = COALESCE($5, is_cross_border),
           affected_jurisdictions = COALESCE($6::jsonb, affected_jurisdictions),
           ransomware_data_exfiltrated = COALESCE($7, ransomware_data_exfiltrated),
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [
          breach_id,
          fields.joint_controller_ids ? JSON.stringify(fields.joint_controller_ids) : null,
          fields.processor_origin ?? null,
          fields.originating_processor_id ?? null,
          fields.is_cross_border ?? null,
          fields.affected_jurisdictions ? JSON.stringify(fields.affected_jurisdictions) : null,
          fields.ransomware_data_exfiltrated ?? null,
        ]
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Breach incident not found" });
      await logAudit("breach_classified", "breach_incidents", breach_id, String(ctx.user.id), {
        is_cross_border: fields.is_cross_border, processor_origin: fields.processor_origin,
        ransomware_data_exfiltrated: fields.ransomware_data_exfiltrated,
      });
      fireAndForget("breachEdgeCases.classifyBreach");
      return row;
    }),

  getExtendedClassification: protectedProcedure
    .input(z.object({ breach_id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [row] = await exec(
        `SELECT id, title, joint_controller_ids, processor_origin, originating_processor_id,
                is_cross_border, affected_jurisdictions, ransomware_data_exfiltrated,
                detected_at, ndpc_notified_at, notification_completed_at
         FROM breach_incidents WHERE id = $1`,
        [input.breach_id]
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Breach incident not found" });
      return row;
    }),

  // ─── Notification recording + late-notification auto-penalty ────────────
  /**
   * Record the NDPC notification timestamp for a breach. If notification
   * occurred more than 72h after detection, a late-notification penalty draft
   * and an admin review task are created automatically (idempotent per breach).
   */
  recordNdpcNotification: protectedProcedure
    .input(z.object({
      breach_id: z.number().int().positive(),
      notified_at: z.string().optional(),
      complete: z.boolean().default(true),
      // Optional: organisation's annual gross turnover (NGN), used to compute
      // the NDPA s.49 "2% of turnover" limb of the late-notification draft.
      annual_turnover_ngn: z.number().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await assertBreachAccess(ctx.user, input.breach_id);
      // Temporal sanity: a notification cannot predate detection. The server
      // receipt time (NOW()) is preferred whenever the caller does not supply
      // an explicit notified_at.
      if (input.notified_at) {
        const notifiedAtInput = new Date(input.notified_at);
        if (Number.isNaN(notifiedAtInput.getTime())) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "notified_at is not a valid timestamp" });
        }
        if (notifiedAtInput.getTime() < new Date(existing.detected_at).getTime()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "notified_at cannot be earlier than detected_at" });
        }
      }
      const rows = await exec(
        `UPDATE breach_incidents
         SET ndpc_notified_at = COALESCE($2::timestamptz, NOW()),
             notification_completed_at = CASE WHEN $3 THEN COALESCE($2::timestamptz, NOW()) ELSE notification_completed_at END,
             breach_incident_status = CASE WHEN breach_incident_status IN ('detected', 'assessing') THEN 'ndpc_notified' ELSE breach_incident_status END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, organization_id, detected_at, ndpc_notified_at`,
        [input.breach_id, input.notified_at ?? null, input.complete]
      );
      const breach = rows[0];
      if (!breach) throw new TRPCError({ code: "NOT_FOUND", message: "Breach incident not found" });

      const detectedAt = new Date(breach.detected_at);
      const notifiedAt = new Date(breach.ndpc_notified_at);
      const hoursLate = Math.max(0, (notifiedAt.getTime() - detectedAt.getTime()) / 3_600_000 - NOTIFICATION_WINDOW_HOURS);

      let penaltyDraft = null;
      if (hoursLate > 0) {
        const daysLate = Math.ceil(hoursLate / 24);
        // NDPA s.49-based draft: accrues a fixed share of the greater-of
        // (₦10M, 2% turnover) base per day late, with capped daily accrual.
        const proposedAmount = computeLatePenaltyDraft(daysLate, input.annual_turnover_ngn ?? null);
        const [draft] = await exec(
          `INSERT INTO breach_late_penalties
             (breach_id, organization_id, detected_at, notified_at, hours_late, proposed_amount, admin_task_created)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           ON CONFLICT (breach_id) DO UPDATE SET
             notified_at = EXCLUDED.notified_at,
             hours_late = EXCLUDED.hours_late,
             proposed_amount = EXCLUDED.proposed_amount,
             updated_at = NOW()
           RETURNING *`,
          [input.breach_id, breach.organization_id, breach.detected_at, breach.ndpc_notified_at, hoursLate.toFixed(2), proposedAmount]
        );
        penaltyDraft = draft;
        // Admin task recorded in audit log for the compliance queue
        await logAudit("breach_late_penalty_task", "breach_late_penalties", draft?.id, null, {
          task: "review_late_notification_penalty",
          breach_id: input.breach_id,
          hours_late: hoursLate.toFixed(2),
          proposed_amount_ngn: proposedAmount,
        });
      }
      await logAudit("breach_ndpc_notified", "breach_incidents", input.breach_id, String(ctx.user.id), {
        notified_at: breach.ndpc_notified_at, hours_late: hoursLate.toFixed(2),
      });
      fireAndForget("breachEdgeCases.recordNdpcNotification");
      return {
        breach,
        notified_late: hoursLate > 0,
        hours_late: Number(hoursLate.toFixed(2)),
        penalty_draft: penaltyDraft,
      };
    }),

  listLatePenalties: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.status) { params.push(input.status); where = `WHERE p.status = $${params.length}`; }
      return exec(
        `SELECT p.*, b.title AS breach_title, b.breach_incident_severity AS severity
         FROM breach_late_penalties p
         JOIN breach_incidents b ON b.id = p.breach_id
         ${where} ORDER BY p.created_at DESC LIMIT 200`,
        params
      );
    }),

  confirmLatePenalty: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      final_amount: z.number().min(0).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE breach_late_penalties
         SET status = 'confirmed', proposed_amount = COALESCE($2, proposed_amount),
             notes = $3, reviewed_by = $4, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'draft' RETURNING *`,
        [input.id, input.final_amount ?? null, input.notes ?? null, ctx.user.name ?? String(ctx.user.id)]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Penalty draft not found or already decided" });
      await logAudit("breach_late_penalty_confirmed", "breach_late_penalties", input.id, String(ctx.user.id), {
        amount: row.proposed_amount,
      });
      fireAndForget("breachEdgeCases.confirmLatePenalty");
      return row;
    }),

  waiveLatePenalty: adminProcedure
    .input(z.object({ id: z.number().int().positive(), reason: z.string().min(10) }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE breach_late_penalties
         SET status = 'waived', notes = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'draft' RETURNING *`,
        [input.id, input.reason, ctx.user.name ?? String(ctx.user.id)]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Penalty draft not found or already decided" });
      await logAudit("breach_late_penalty_waived", "breach_late_penalties", input.id, String(ctx.user.id), { reason: input.reason });
      fireAndForget("breachEdgeCases.waiveLatePenalty");
      return row;
    }),

  // ─── Incomplete-notification supplementation ─────────────────────────────
  submitSupplement: protectedProcedure
    .input(z.object({
      breach_id: z.number().int().positive(),
      supplementary_details: z.string().min(10),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertBreachAccess(ctx.user, input.breach_id);
      // supplement_sequence is MAX+1 guarded by UNIQUE(breach_id,
      // supplement_sequence) (0033; re-asserted in 0076). Two concurrent
      // submissions can compute the same MAX — retry on the unique violation
      // instead of failing or duplicating a sequence number.
      let row: any = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3 && !row; attempt++) {
        try {
          const [inserted] = await exec(
            `INSERT INTO breach_supplements (breach_id, supplement_sequence, supplementary_details, reason, submitted_by)
             VALUES ($1,
                     COALESCE((SELECT MAX(supplement_sequence) FROM breach_supplements WHERE breach_id = $1), 0) + 1,
                     $2, $3, $4)
             RETURNING *`,
            [input.breach_id, input.supplementary_details, input.reason ?? null, ctx.user.name ?? String(ctx.user.id)]
          );
          row = inserted;
        } catch (err) {
          lastErr = err;
          if ((err as { cause?: { code?: string } })?.cause?.code !== "23505") throw err;
        }
      }
      if (!row) throw lastErr instanceof Error ? lastErr : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not allocate supplement sequence" });
      await logAudit("breach_supplement_submitted", "breach_supplements", row?.id, String(ctx.user.id), { breach_id: input.breach_id });
      fireAndForget("breachEdgeCases.submitSupplement");
      return row;
    }),

  listSupplements: protectedProcedure
    .input(z.object({ breach_id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return exec(
        `SELECT * FROM breach_supplements WHERE breach_id = $1 ORDER BY supplement_sequence ASC`,
        [input.breach_id]
      );
    }),

  reviewSupplement: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["accepted", "rejected"]),
      review_notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE breach_supplements
         SET status = $2, reviewed_by = $3, reviewed_at = NOW(), review_notes = $4, updated_at = NOW()
         WHERE id = $1 AND status IN ('draft', 'submitted') RETURNING *`,
        [input.id, input.decision, ctx.user.name ?? String(ctx.user.id), input.review_notes ?? null]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Supplement not found or already reviewed" });
      await logAudit("breach_supplement_reviewed", "breach_supplements", input.id, String(ctx.user.id), { decision: input.decision });
      fireAndForget("breachEdgeCases.reviewSupplement");
      return row;
    }),
});
