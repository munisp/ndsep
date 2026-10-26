/**
 * Autonomy Governance Router (round 12, wave 9 — roadmap §7)
 * ==========================================================
 * Promotion dashboard + governance controls for graduated autonomy:
 *
 *   tierStatus         per-surface tier, live acceptance stats (read-only
 *                      preview of the gates), and progress toward the next gate
 *   promote / demote   MANUAL tier overrides — governance-sensitive, therefore
 *                      adminProcedure + the dual_control_requests maker-checker
 *                      queue (migration 0080/0102/0139): without a
 *                      dualControlRequestId the call QUEUES a request (two
 *                      DISTINCT admin approvers via
 *                      insiderThreat.approveDualControl; the requester can
 *                      never approve); with one, it verifies the request is
 *                      approved/unexpired/unconsumed and applies the change.
 *   listAutonomyActions  pending_undo / executed / undone / expired queue
 *   undoAction           human undo of an auto-action (cancels a pending
 *                        proposal or restores an executed one from snapshot)
 *   transitionHistory    autonomy.* entries from the anti-wipe audit_ledger
 *
 * DB access is raw SQL against the shared pg pool (same convention as
 * decisionFeedback.ts); tables are defined in
 * drizzle/schema.ts (autonomyTiers/autonomyActions tables) + migrations 0139/0140.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { appendLedger } from "../antiwipe/ledger";
import {
  AUTONOMY_SURFACES,
  SURFACE_LABELS,
  TIER_GATES,
  MIN_TIER,
  MAX_TIER,
  evaluate,
  applyManualTierChange,
  type AutonomySurface,
} from "../services/autonomyTiers";
import { listAutonomyActions, undoAutonomyAction } from "../services/autonomyActions";
// Importing the surface services registers their execute/undo handlers with
// the shared autonomy-actions queue (side effect).
import "../services/duplicateMerge";
import "../services/falseFindingSuppressor";

const TIER_CHANGE_ACTION = "autonomy_tier_change";

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const safeParams = params.map((p) =>
    Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
      ? JSON.stringify(p)
      : p,
  );
  try {
    const result = await pool.query(query, safeParams);
    return result.rows ?? [];
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[autonomyGovernance] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

function ledger(action: string, payload: Record<string, unknown>, actor: string): void {
  appendLedger(action, payload, actor).catch((e: unknown) =>
    logger.warn({ err: e instanceof Error ? e.message : String(e), action }, "[autonomyGovernance] audit_ledger append failed"),
  );
}

const surfaceSchema = z.enum(AUTONOMY_SURFACES);

// ─── Gate progress shape for the dashboard ───────────────────────────────────

function gateProgress(tier: number, stats: { decided: number; acceptance: number | null }, promotedAt: string | null) {
  if (tier >= MAX_TIER) return null;
  const g = tier === 1 ? TIER_GATES.promote["1->2"] : TIER_GATES.promote["2->3"];
  const stableDays =
    tier === 2 && promotedAt
      ? Math.max(0, (Date.now() - new Date(promotedAt).getTime()) / 86_400_000)
      : null;
  return {
    targetTier: tier + 1,
    minAcceptance: g.minAcceptance,
    minSuggestions: g.minSuggestions,
    decided: stats.decided,
    acceptance: stats.acceptance,
    suggestionsProgress: Math.min(1, stats.decided / g.minSuggestions),
    acceptanceProgress: stats.acceptance !== null ? Math.min(1, stats.acceptance / g.minAcceptance) : 0,
    ...(tier === 2
      ? {
          minStableDays: TIER_GATES.promote["2->3"].minStableDays,
          stableDays,
          stableProgress: stableDays !== null ? Math.min(1, stableDays / TIER_GATES.promote["2->3"].minStableDays) : 0,
        }
      : {}),
  };
}

// ─── Dual-control queue/consume (sanctionsRegister.publishNotice pattern) ────

async function queueTierChangeRequest(opts: {
  surface: AutonomySurface;
  targetTier: number;
  reason: string;
  actor: string;
}): Promise<{ queued: true; requestId: number; status: "pending" }> {
  const pending = await exec(
    `SELECT id FROM dual_control_requests
     WHERE action_type = $1 AND status = 'pending'
       AND payload->>'surface' = $2 AND (payload->>'target_tier')::int = $3`,
    [TIER_CHANGE_ACTION, opts.surface, opts.targetTier],
  );
  if (pending[0]) return { queued: true, requestId: Number(pending[0].id), status: "pending" };
  const rows = await exec(
    `INSERT INTO dual_control_requests (action_type, payload, requested_by, threshold_snapshot)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      TIER_CHANGE_ACTION,
      { kind: TIER_CHANGE_ACTION, surface: opts.surface, target_tier: opts.targetTier, reason: opts.reason },
      opts.actor,
      { approvers_required: 2, requester_may_not_approve: true },
    ],
  );
  ledger("autonomy.tier_override_requested", {
    surface: opts.surface,
    targetTier: opts.targetTier,
    reason: opts.reason.slice(0, 500),
    dualControlRequestId: Number(rows[0].id),
  }, opts.actor);
  return { queued: true, requestId: Number(rows[0].id), status: "pending" };
}

async function consumeTierChangeRequest(opts: {
  dualControlRequestId: number;
  surface: AutonomySurface;
  targetTier: number;
}): Promise<{ firstApprover: string | null; secondApprover: string | null }> {
  const reqs = await exec(
    `SELECT id, action_type, payload, requested_by, first_approver, second_approver, status, expires_at
     FROM dual_control_requests WHERE id = $1`,
    [opts.dualControlRequestId],
  );
  const req = reqs[0];
  if (!req || req.action_type !== TIER_CHANGE_ACTION) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Autonomy tier-change dual-control request not found." });
  }
  if (req.status !== "approved") {
    throw new TRPCError({ code: "CONFLICT", message: `Dual-control request is '${req.status}' — a tier override requires an approved request (two distinct approvers).` });
  }
  if (new Date(req.expires_at) <= new Date()) {
    throw new TRPCError({ code: "CONFLICT", message: "Dual-control request has expired — re-request the tier change." });
  }
  const payload = (req.payload ?? {}) as Record<string, unknown>;
  if (payload.kind !== TIER_CHANGE_ACTION || payload.surface !== opts.surface || Number(payload.target_tier) !== opts.targetTier) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Dual-control request does not refer to this surface/tier change." });
  }
  // Consume atomically so the approval cannot be replayed.
  const consumed = await exec(
    `UPDATE dual_control_requests SET status = 'consumed', decided_at = now()
     WHERE id = $1 AND status = 'approved' RETURNING id`,
    [opts.dualControlRequestId],
  );
  if (!consumed[0]) {
    throw new TRPCError({ code: "CONFLICT", message: "Dual-control request is no longer approved — it may have been consumed already." });
  }
  return { firstApprover: req.first_approver ?? null, secondApprover: req.second_approver ?? null };
}

async function manualTierOverride(input: {
  surface: AutonomySurface;
  targetTier: number;
  reason: string;
  dualControlRequestId?: number;
  actor: string;
}) {
  if (input.dualControlRequestId == null) {
    return queueTierChangeRequest({ surface: input.surface, targetTier: input.targetTier, reason: input.reason, actor: input.actor });
  }
  const approvers = await consumeTierChangeRequest({
    dualControlRequestId: input.dualControlRequestId,
    surface: input.surface,
    targetTier: input.targetTier,
  });
  let tierRow;
  try {
    tierRow = await applyManualTierChange({
      surface: input.surface,
      targetTier: input.targetTier,
      actor: input.actor,
      reason: input.reason,
      dualControlRequestId: input.dualControlRequestId,
    });
  } catch (err) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "tier change failed" });
  }
  return {
    queued: false as const,
    applied: true as const,
    dualControlRequestId: input.dualControlRequestId,
    ...approvers,
    tier: tierRow,
  };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const autonomyGovernanceRouter = router({
  /** Tier registry + live gate progress for every autonomy surface. */
  tierStatus: protectedProcedure.query(async () => {
    const surfaces = [] as any[];
    for (const surface of AUTONOMY_SURFACES) {
      // Read-only preview (commit=false): no writes, no transitions.
      const preview = await evaluate(surface, { commit: false });
      surfaces.push({
        surface,
        label: SURFACE_LABELS[surface],
        tier: preview.tier,
        acceptanceRate: preview.stats.acceptance,
        suggestions: preview.stats.suggestions,
        decided: preview.stats.decided,
        counts: preview.stats.counts,
        trailing: preview.stats.trailing,
        gates: {
          windowDays: TIER_GATES.windowDays,
          demote: TIER_GATES.demote,
        },
        nextGate: gateProgress(preview.tier, preview.stats, null),
        failedClosed: preview.failedClosed,
      });
    }
    // Stored rows carry promoted_at/demoted_at for the stability gate.
    const stored = await exec(`SELECT * FROM autonomy_tiers ORDER BY surface`);
    for (const s of surfaces) {
      const row = stored.find((r: any) => r.surface === s.surface);
      s.promotedAt = row?.promoted_at ?? null;
      s.demotedAt = row?.demoted_at ?? null;
      s.updatedAt = row?.updated_at ?? null;
      s.nextGate = gateProgress(s.tier, { decided: s.decided, acceptance: s.acceptanceRate }, s.promotedAt);
    }
    return { surfaces, gates: TIER_GATES };
  }),

  /** Manual promotion — queued through dual control (maker-checker). */
  promote: adminProcedure
    .input(z.object({
      surface: surfaceSchema,
      reason: z.string().min(10).max(2000),
      dualControlRequestId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const actor = String(ctx.user.id);
      const current = await evaluate(input.surface, { commit: false });
      if (current.tier >= MAX_TIER) {
        throw new TRPCError({ code: "CONFLICT", message: `Surface '${input.surface}' is already at tier ${MAX_TIER}.` });
      }
      return manualTierOverride({
        surface: input.surface,
        targetTier: current.tier + 1,
        reason: input.reason,
        dualControlRequestId: input.dualControlRequestId,
        actor,
      });
    }),

  /** Manual demotion — queued through dual control (maker-checker). */
  demote: adminProcedure
    .input(z.object({
      surface: surfaceSchema,
      reason: z.string().min(10).max(2000),
      dualControlRequestId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const actor = String(ctx.user.id);
      const current = await evaluate(input.surface, { commit: false });
      if (current.tier <= MIN_TIER) {
        throw new TRPCError({ code: "CONFLICT", message: `Surface '${input.surface}' is already at tier ${MIN_TIER}.` });
      }
      return manualTierOverride({
        surface: input.surface,
        targetTier: current.tier - 1,
        reason: input.reason,
        dualControlRequestId: input.dualControlRequestId,
        actor,
      });
    }),

  /** Auto-action queue (pending undo / executed / undone / expired). */
  listAutonomyActions: protectedProcedure
    .input(z.object({
      status: z.enum(["pending_undo", "executed", "undone", "expired"]).optional(),
      surface: surfaceSchema.optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      return listAutonomyActions({
        status: input?.status,
        surface: input?.surface,
        limit: input?.limit,
        offset: input?.offset,
      });
    }),

  /** Human undo: cancels a pending proposal or restores an executed action. */
  undoAction: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await undoAutonomyAction(input.id, String(ctx.user.id));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "undo failed";
        const code = msg.includes("not found") ? "NOT_FOUND" : "CONFLICT";
        throw new TRPCError({ code: code as "NOT_FOUND" | "CONFLICT", message: msg });
      }
    }),

  /** Tier transitions + action lifecycle from the anti-wipe audit ledger. */
  transitionHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT seq, action, payload, actor, created_at
         FROM audit_ledger
         WHERE action LIKE 'autonomy.%'
         ORDER BY seq DESC
         LIMIT $1`,
        [input?.limit ?? 50],
      );
      return rows.map((r) => ({
        seq: Number(r.seq),
        action: r.action as string,
        payload: r.payload as unknown,
        actor: (r.actor as string) ?? null,
        createdAt: r.created_at as string,
      }));
    }),
});
