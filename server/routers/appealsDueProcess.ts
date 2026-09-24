/**
 * Appeals Due Process Router — complements the existing penaltyAppealsRouter
 * (which remains untouched). Procedure names are deliberately distinct.
 * - Appeal hearing scheduling (appeal_hearings)
 * - 30-day appeal deadline computation from the penalty decision date,
 *   exposing days_remaining
 * - Automatic stay of enforcement: filing an appeal records a penalty_stays
 *   row (companion table; the financial_penalties enum is untouched)
 * - Tribunal escalation tracking
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { sendAppealUpdate } from "../emailNotification";

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
    logger.error({ err, query: query.slice(0, 200) }, "[appealsDP] DB query error");
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
    logger.warn({ err, action, resourceType }, "[appealsDP] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

/** Statutory appeal window: 30 days from the penalty decision date */
const APPEAL_WINDOW_DAYS = 30;

export const appealsDueProcessRouter = router({
  // ─── Deadline computation ────────────────────────────────────────────────
  /** Compute the appeal deadline (penalty decision date + 30 days) and days remaining */
  computeAppealDeadline: protectedProcedure
    .input(z.object({ penaltyId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [penalty] = await exec(
        `SELECT id, organization_id, created_at AS decision_date,
                (created_at + INTERVAL '${APPEAL_WINDOW_DAYS} days') AS appeal_deadline,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM (created_at + INTERVAL '${APPEAL_WINDOW_DAYS} days' - NOW())) / 86400))::int AS days_remaining
         FROM financial_penalties WHERE id = $1`,
        [input.penaltyId]
      );
      if (!penalty) throw new TRPCError({ code: "NOT_FOUND", message: "Penalty not found" });
      return { ...penalty, appeal_window_days: APPEAL_WINDOW_DAYS, appeal_expired: penalty.days_remaining <= 0 };
    }),

  listAppealsWithDeadlines: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.status) { params.push(input.status); where = `WHERE a.status = $${params.length}`; }
      return exec(
        `SELECT a.*,
                COALESCE(a.appeal_deadline, a.created_at + INTERVAL '${APPEAL_WINDOW_DAYS} days') AS effective_deadline,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM (COALESCE(a.appeal_deadline, a.created_at + INTERVAL '${APPEAL_WINDOW_DAYS} days') - NOW())) / 86400))::int AS days_remaining,
                (SELECT COUNT(*) FROM appeal_hearings h WHERE h.appeal_id = a.id) AS hearing_count,
                (SELECT s.status FROM penalty_stays s WHERE s.appeal_id = a.id ORDER BY s.granted_at DESC LIMIT 1) AS stay_status
         FROM penalty_appeals a ${where}
         ORDER BY a.created_at DESC LIMIT 200`,
        params
      );
    }),

  // ─── Filing with automatic stay of enforcement ───────────────────────────
  /**
   * File an appeal against a penalty decision. Records the statutory deadline
   * and automatically grants a stay of enforcement (companion penalty_stays
   * row) — enforcement is paused while the appeal is pending.
   */
  fileAppealWithAutomaticStay: protectedProcedure
    .input(z.object({
      penaltyId: z.number().int().positive(),
      organizationId: z.number().int().positive(),
      submittedBy: z.string().min(2).max(256),
      contactEmail: z.string().email(),
      groundsForAppeal: z.string().min(20),
      evidenceSummary: z.string().optional(),
      evidenceUrls: z.array(z.string()).optional(),
      requestedOutcome: z.string().max(64).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [penalty] = await exec(
        `SELECT id, created_at, (created_at + INTERVAL '${APPEAL_WINDOW_DAYS} days') AS deadline FROM financial_penalties WHERE id = $1`,
        [input.penaltyId]
      );
      if (!penalty) throw new TRPCError({ code: "NOT_FOUND", message: "Penalty not found" });
      if (new Date(penalty.deadline) < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `The ${APPEAL_WINDOW_DAYS}-day appeal window for this penalty has expired` });
      }
      const [appeal] = await exec(
        `INSERT INTO penalty_appeals
           (penalty_id, organization_id, submitted_by, contact_email, grounds_for_appeal,
            evidence_summary, evidence_urls, requested_outcome, status, appeal_deadline, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted',$9,NOW(),NOW())
         RETURNING *`,
        [
          input.penaltyId, input.organizationId, input.submittedBy, input.contactEmail,
          input.groundsForAppeal, input.evidenceSummary ?? null, input.evidenceUrls ?? [],
          input.requestedOutcome ?? "reduction", penalty.deadline,
        ]
      );
      // Automatic stay — one active stay per penalty (partial unique index)
      const [stay] = await exec(
        `INSERT INTO penalty_stays (penalty_id, appeal_id, stay_reason)
         VALUES ($1, $2, 'appeal_filed')
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [input.penaltyId, appeal?.id]
      );
      await logAudit("appeal_filed_with_stay", "penalty_appeals", appeal?.id, String(ctx.user.id), {
        penalty_id: input.penaltyId, deadline: penalty.deadline, stay_granted: Boolean(stay),
      });
      if (input.contactEmail && appeal?.id) {
        sendAppealUpdate({
          to: input.contactEmail,
          orgName: input.submittedBy,
          appealId: appeal.id,
          penaltyId: input.penaltyId,
          decision: "under_review",
          notes: `Appeal received. Enforcement of the penalty is automatically stayed pending determination. Appeal deadline: ${new Date(penalty.deadline).toISOString().slice(0, 10)}.`,
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "appeal email failed"));
      }
      fireAndForget("appealsDueProcess.fileAppealWithAutomaticStay");
      return { appeal, stay: stay ?? null, stay_active: Boolean(stay) };
    }),

  // ─── Stay management ─────────────────────────────────────────────────────
  getStayStatus: protectedProcedure
    .input(z.object({ penaltyId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [stay] = await exec(
        `SELECT * FROM penalty_stays WHERE penalty_id = $1 ORDER BY granted_at DESC LIMIT 1`,
        [input.penaltyId]
      );
      return { penalty_id: input.penaltyId, enforcement_stayed: stay?.status === "active", stay: stay ?? null };
    }),

  liftStay: adminProcedure
    .input(z.object({
      stayId: z.number().int().positive(),
      liftReason: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE penalty_stays
         SET status = 'lifted', lifted_at = NOW(), lifted_by = $2, lift_reason = $3, updated_at = NOW()
         WHERE id = $1 AND status = 'active' RETURNING *`,
        [input.stayId, ctx.user.name ?? String(ctx.user.id), input.liftReason]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Stay not found or already lifted/expired" });
      await logAudit("penalty_stay_lifted", "penalty_stays", input.stayId, String(ctx.user.id), { reason: input.liftReason });
      fireAndForget("appealsDueProcess.liftStay");
      return row;
    }),

  listStays: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.status) { params.push(input.status); where = `WHERE s.status = $${params.length}`; }
      return exec(
        `SELECT s.*, p.amount AS penalty_amount, p.currency, a.status AS appeal_status
         FROM penalty_stays s
         LEFT JOIN financial_penalties p ON p.id = s.penalty_id
         LEFT JOIN penalty_appeals a ON a.id = s.appeal_id
         ${where} ORDER BY s.granted_at DESC LIMIT 200`,
        params
      );
    }),

  // ─── Hearing scheduling ──────────────────────────────────────────────────
  scheduleAppealHearing: protectedProcedure
    .input(z.object({
      appealId: z.number().int().positive(),
      hearingDate: z.string(),
      location: z.string().max(256).optional(),
      mode: z.enum(["in_person", "virtual", "hybrid"]).default("in_person"),
      panel: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const appeal = await exec(`SELECT id, status FROM penalty_appeals WHERE id = $1`, [input.appealId]);
      if (!appeal[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Appeal not found" });
      const [row] = await exec(
        `INSERT INTO appeal_hearings (appeal_id, hearing_date, location, mode, panel, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [input.appealId, input.hearingDate, input.location ?? null, input.mode, input.panel ?? [], ctx.user.name ?? String(ctx.user.id)]
      );
      await exec(`UPDATE penalty_appeals SET status = 'under_review', updated_at = NOW() WHERE id = $1 AND status = 'submitted'`, [input.appealId]);
      await logAudit("appeal_hearing_scheduled", "appeal_hearings", row?.id, String(ctx.user.id), { appeal_id: input.appealId });
      fireAndForget("appealsDueProcess.scheduleAppealHearing");
      return row;
    }),

  listAppealHearings: protectedProcedure
    .input(z.object({ appealId: z.number().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.appealId) { params.push(input.appealId); conditions.push(`h.appeal_id = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`h.status = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT h.*, a.penalty_id, a.submitted_by
         FROM appeal_hearings h JOIN penalty_appeals a ON a.id = h.appeal_id
         ${where} ORDER BY h.hearing_date ASC LIMIT 200`,
        params
      );
    }),

  updateAppealHearing: protectedProcedure
    .input(z.object({
      hearingId: z.number().int().positive(),
      status: z.enum(["held", "adjourned", "cancelled"]),
      outcome: z.string().optional(),
      minutesUrl: z.string().url().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE appeal_hearings
         SET status = $2, outcome = $3, minutes_url = $4, updated_at = NOW()
         WHERE id = $1 AND status = 'scheduled' RETURNING *`,
        [input.hearingId, input.status, input.outcome ?? null, input.minutesUrl ?? null]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Hearing not found or already concluded" });
      await logAudit("appeal_hearing_updated", "appeal_hearings", input.hearingId, String(ctx.user.id), { status: input.status });
      fireAndForget("appealsDueProcess.updateAppealHearing");
      return row;
    }),

  // ─── Tribunal escalation ─────────────────────────────────────────────────
  escalateToTribunal: protectedProcedure
    .input(z.object({
      appealId: z.number().int().positive(),
      tribunalName: z.string().max(256).optional(),
      caseNumber: z.string().max(128).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const appeal = await exec(`SELECT id, penalty_id FROM penalty_appeals WHERE id = $1`, [input.appealId]);
      if (!appeal[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Appeal not found" });
      const [row] = await exec(
        `INSERT INTO tribunal_escalations (appeal_id, penalty_id, tribunal_name, case_number, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [input.appealId, appeal[0].penalty_id, input.tribunalName ?? "Data Protection Tribunal", input.caseNumber ?? null, ctx.user.name ?? String(ctx.user.id)]
      );
      await exec(`UPDATE penalty_appeals SET status = 'under_review', updated_at = NOW() WHERE id = $1`, [input.appealId]);
      await logAudit("appeal_escalated_tribunal", "tribunal_escalations", row?.id, String(ctx.user.id), { appeal_id: input.appealId });
      fireAndForget("appealsDueProcess.escalateToTribunal");
      return row;
    }),

  updateTribunalStatus: adminProcedure
    .input(z.object({
      escalationId: z.number().int().positive(),
      status: z.enum(["heard", "decided", "withdrawn"]),
      decision: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.status === "decided" && !input.decision) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "decision text is required when marking an escalation as decided" });
      }
      const [row] = await exec(
        `UPDATE tribunal_escalations
         SET status = $2, decision = $3,
             decided_at = CASE WHEN $2 = 'decided' THEN NOW() ELSE decided_at END, updated_at = NOW()
         WHERE id = $1 AND status IN ('filed', 'heard') RETURNING *`,
        [input.escalationId, input.status, input.decision ?? null]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Escalation not found or already closed" });
      await logAudit("tribunal_status_updated", "tribunal_escalations", input.escalationId, String(ctx.user.id), { status: input.status });
      fireAndForget("appealsDueProcess.updateTribunalStatus");
      return row;
    }),

  listTribunalEscalations: protectedProcedure
    .input(z.object({ appealId: z.number().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.appealId) { params.push(input.appealId); conditions.push(`t.appeal_id = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`t.status = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT t.*, a.submitted_by, a.penalty_id AS appeal_penalty_id
         FROM tribunal_escalations t JOIN penalty_appeals a ON a.id = t.appeal_id
         ${where} ORDER BY t.escalated_at DESC LIMIT 200`,
        params
      );
    }),
});
