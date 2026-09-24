/**
 * Sector-Regulator Reconciliation Router (gap 8)
 *
 * Handles dual-jurisdiction conflicts between sector regulators (NDPC, CBN,
 * NCC, SEC, NAICOM, FCCPC, ...) and MoU-based regulator-to-regulator case
 * referrals (sent -> acknowledged -> accepted/declined -> resolved).
 *
 * Regulator-facing read endpoints are keyed by the caller's Permify
 * `regulator` role: callers must hold the platform `regulator` role (or be
 * admin) and pass a Permify `regulator:read` check. The `regulatorCode`
 * input scopes read results so a regulator only sees its own slice.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { permifyCheck } from "../middlewareExtensions";

export const REGULATOR_CODES = ["NDPC", "CBN", "NCC", "SEC", "NAICOM", "FCCPC", "NITDA", "NIMC"] as const;
const regulatorEnum = z.enum(REGULATOR_CODES);

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
    return result.rows ?? [];
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[regRecon] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
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
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[regRecon] Audit log write failed");
  }
}

/**
 * Regulator read guard: admin passes unconditionally; other callers must hold
 * the `regulator` platform role AND a Permify `regulator:read` grant. Fail
 * closed on Permify outage (consistent with adminProcedure posture).
 */
async function requireRegulatorRead(ctx: { user: { id: number | string; role?: string } }): Promise<void> {
  if (ctx.user.role === "admin") return;
  if (ctx.user.role !== "regulator" && ctx.user.role !== "government_staff") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Regulator role required" });
  }
  let allowed = false;
  try {
    allowed = await permifyCheck("regulator", "sector", "read", String(ctx.user.id));
  } catch (err) {
    logger.warn({ err }, "[regRecon] Permify check failed — denying regulator read");
  }
  if (!allowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Permify: regulator read permission denied" });
  }
}

export const regulatorReconciliationRouter = router({
  // ─── Jurisdiction conflicts ───────────────────────────────────────────────

  /** NDPC officer: raise a dual-jurisdiction conflict record for a matter. */
  raiseConflict: protectedProcedure
    .input(z.object({
      matterRef: z.string().min(3).max(100),
      regulators: z.array(regulatorEnum).min(2),
      conflictType: z.enum(["overlapping_mandate", "concurrent_investigation", "double_jeopardy_risk", "data_sharing_dispute", "enforcement_precedence"]).default("overlapping_mandate"),
      description: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `INSERT INTO jurisdiction_conflicts (matter_ref, regulators, conflict_type, description, raised_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [input.matterRef, JSON.stringify(input.regulators), input.conflictType, input.description, ctx.user.email ?? String(ctx.user.id)],
      );
      await logAudit("regulator.conflict_raise", "jurisdiction_conflict", rows[0].id, String(ctx.user.id), { matter_ref: input.matterRef, regulators: input.regulators });
      emitMutationEvent("ndsep.regulator.reconciliation", { action: "conflictRaised", matterRef: input.matterRef, ts: new Date().toISOString() })
        .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  /** Officer view: list conflicts (optionally by status). */
  listConflicts: protectedProcedure
    .input(z.object({
      status: z.enum(["raised", "under_review", "resolved", "escalated"]).optional(),
      matterRef: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM jurisdiction_conflicts WHERE 1=1`;
      const params: unknown[] = [];
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      if (input.matterRef) { params.push(input.matterRef); sql += ` AND matter_ref = $${params.length}`; }
      sql += ` ORDER BY created_at DESC`;
      return exec(sql, params);
    }),

  /** Admin: record the reconciliation outcome and precedence decision. */
  resolveConflict: adminProcedure
    .input(z.object({
      conflictId: z.number(),
      status: z.enum(["under_review", "resolved", "escalated"]),
      precedenceDecision: z.string().min(10).optional(),
      leadRegulator: regulatorEnum.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.status === "resolved" && !input.precedenceDecision) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A precedence decision is required to resolve a conflict" });
      }
      const rows = await exec(
        `UPDATE jurisdiction_conflicts
         SET status = $1,
             precedence_decision = COALESCE($2, precedence_decision),
             lead_regulator = COALESCE($3, lead_regulator),
             decided_by = $4,
             updated_at = NOW(),
             resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END
         WHERE id = $5 RETURNING *`,
        [input.status, input.precedenceDecision ?? null, input.leadRegulator ?? null, ctx.user.email ?? String(ctx.user.id), input.conflictId],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Conflict not found" });
      await logAudit("regulator.conflict_resolve", "jurisdiction_conflict", input.conflictId, String(ctx.user.id), { status: input.status, lead: input.leadRegulator });
      emitMutationEvent("ndsep.regulator.reconciliation", { action: "conflictResolved", conflictId: input.conflictId, ts: new Date().toISOString() })
        .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  // ─── MoU case referrals ───────────────────────────────────────────────────

  /** Send a case referral to another regulator under the MoU framework. */
  sendReferral: protectedProcedure
    .input(z.object({
      fromRegulator: regulatorEnum,
      toRegulator: regulatorEnum,
      matterRef: z.string().max(100).optional(),
      casePayload: z.record(z.unknown()).default({}),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.fromRegulator === input.toRegulator) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "from_regulator and to_regulator must differ" });
      }
      const ref = `REF-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      const rows = await exec(
        `INSERT INTO case_referrals (referral_ref, from_regulator, to_regulator, matter_ref, case_payload, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [ref, input.fromRegulator, input.toRegulator, input.matterRef ?? null, JSON.stringify(input.casePayload), input.notes ?? null],
      );
      await logAudit("regulator.referral_send", "case_referral", rows[0].id, String(ctx.user.id), { referral_ref: ref, from: input.fromRegulator, to: input.toRegulator });
      emitMutationEvent("ndsep.regulator.referral", { action: "sent", referralRef: ref, to: input.toRegulator, ts: new Date().toISOString() })
        .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  /** Receiving regulator acknowledges receipt (sent -> acknowledged). */
  acknowledgeReferral: protectedProcedure
    .input(z.object({ referralRef: z.string().min(4) }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE case_referrals SET status = 'acknowledged', acknowledged_at = NOW(), updated_at = NOW()
         WHERE referral_ref = $1 AND status = 'sent' RETURNING *`,
        [input.referralRef],
      );
      if (!rows[0]) throw new TRPCError({ code: "CONFLICT", message: "Referral not found or not in 'sent' status" });
      await logAudit("regulator.referral_ack", "case_referral", rows[0].id, String(ctx.user.id), { referral_ref: input.referralRef });
      return rows[0];
    }),

  /** Receiving regulator accepts or declines (acknowledged -> accepted|declined). */
  respondReferral: protectedProcedure
    .input(z.object({
      referralRef: z.string().min(4),
      decision: z.enum(["accepted", "declined"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE case_referrals
         SET status = $1, notes = COALESCE($2, notes), responded_by = $3, responded_at = NOW(), updated_at = NOW()
         WHERE referral_ref = $4 AND status IN ('sent', 'acknowledged') RETURNING *`,
        [input.decision, input.notes ?? null, ctx.user.email ?? String(ctx.user.id), input.referralRef],
      );
      if (!rows[0]) throw new TRPCError({ code: "CONFLICT", message: "Referral not found or already responded to" });
      await logAudit("regulator.referral_respond", "case_referral", rows[0].id, String(ctx.user.id), { referral_ref: input.referralRef, decision: input.decision });
      emitMutationEvent("ndsep.regulator.referral", { action: input.decision, referralRef: input.referralRef, ts: new Date().toISOString() })
        .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  /** Close an accepted referral once the receiving regulator resolves the matter. */
  resolveReferral: protectedProcedure
    .input(z.object({ referralRef: z.string().min(4), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE case_referrals
         SET status = 'resolved', notes = COALESCE($1, notes), resolved_at = NOW(), updated_at = NOW()
         WHERE referral_ref = $2 AND status = 'accepted' RETURNING *`,
        [input.notes ?? null, input.referralRef],
      );
      if (!rows[0]) throw new TRPCError({ code: "CONFLICT", message: "Referral not found or not in 'accepted' status" });
      await logAudit("regulator.referral_resolve", "case_referral", rows[0].id, String(ctx.user.id), { referral_ref: input.referralRef });
      return rows[0];
    }),

  /** List referrals sent from or to a regulator. */
  listReferrals: protectedProcedure
    .input(z.object({
      regulator: regulatorEnum.optional(),
      status: z.enum(["sent", "acknowledged", "accepted", "declined", "resolved"]).optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM case_referrals WHERE 1=1`;
      const params: unknown[] = [];
      if (input.regulator) {
        params.push(input.regulator);
        sql += ` AND (from_regulator = $${params.length} OR to_regulator = $${params.length})`;
      }
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      sql += ` ORDER BY created_at DESC`;
      return exec(sql, params);
    }),

  // ─── Regulator-facing read API (Permify regulator role, read-only aggregates) ──

  /**
   * Aggregate reconciliation snapshot for one regulator: conflict counts by
   * status, referral pipeline counts in both directions, and the last 20
   * conflicts/referrals touching that regulator. No row-level PII is exposed.
   */
  regulatorDashboard: protectedProcedure
    .input(z.object({ regulator: regulatorEnum }))
    .query(async ({ input, ctx }) => {
      await requireRegulatorRead(ctx);
      const [conflictStats] = await exec(
        `SELECT
           COUNT(*) AS total_conflicts,
           COUNT(*) FILTER (WHERE status = 'raised') AS raised,
           COUNT(*) FILTER (WHERE status = 'under_review') AS under_review,
           COUNT(*) FILTER (WHERE status = 'escalated') AS escalated,
           COUNT(*) FILTER (WHERE status = 'resolved') AS resolved
         FROM jurisdiction_conflicts
         WHERE regulators @> $1::jsonb`,
        [JSON.stringify([input.regulator])],
      );
      const [referralStats] = await exec(
        `SELECT
           COUNT(*) FILTER (WHERE from_regulator = $1) AS sent,
           COUNT(*) FILTER (WHERE to_regulator = $1) AS received,
           COUNT(*) FILTER (WHERE to_regulator = $1 AND status = 'sent') AS awaiting_acknowledgement,
           COUNT(*) FILTER (WHERE to_regulator = $1 AND status IN ('sent', 'acknowledged')) AS awaiting_response,
           COUNT(*) FILTER (WHERE status = 'accepted' AND (from_regulator = $1 OR to_regulator = $1)) AS active_accepted,
           COUNT(*) FILTER (WHERE status = 'resolved' AND (from_regulator = $1 OR to_regulator = $1)) AS resolved
         FROM case_referrals`,
        [input.regulator],
      );
      const recentConflicts = await exec(
        `SELECT id, matter_ref, conflict_type, status, lead_regulator, created_at
         FROM jurisdiction_conflicts WHERE regulators @> $1::jsonb
         ORDER BY created_at DESC LIMIT 20`,
        [JSON.stringify([input.regulator])],
      );
      const recentReferrals = await exec(
        `SELECT id, referral_ref, from_regulator, to_regulator, matter_ref, status, created_at
         FROM case_referrals WHERE from_regulator = $1 OR to_regulator = $1
         ORDER BY created_at DESC LIMIT 20`,
        [input.regulator],
      );
      return { regulator: input.regulator, conflicts: conflictStats, referrals: referralStats, recentConflicts, recentReferrals };
    }),

  /** Read-only cross-regulator aggregate (admin/oversight): per-regulator workload. */
  regulatorAggregateStats: protectedProcedure
    .query(async ({ ctx }) => {
      await requireRegulatorRead(ctx);
      const conflictsByRegulator = await exec(
        `SELECT reg AS regulator, COUNT(*) AS conflicts
         FROM jurisdiction_conflicts, LATERAL jsonb_array_elements_text(regulators) AS reg
         GROUP BY reg ORDER BY conflicts DESC`,
      );
      const referralsByRegulator = await exec(
        `SELECT regulator, SUM(sent) AS sent, SUM(received) AS received FROM (
           SELECT from_regulator AS regulator, COUNT(*) AS sent, 0 AS received FROM case_referrals GROUP BY from_regulator
           UNION ALL
           SELECT to_regulator AS regulator, 0 AS sent, COUNT(*) AS received FROM case_referrals GROUP BY to_regulator
         ) t GROUP BY regulator ORDER BY (SUM(sent) + SUM(received)) DESC`,
      );
      return { conflictsByRegulator, referralsByRegulator };
    }),
});
