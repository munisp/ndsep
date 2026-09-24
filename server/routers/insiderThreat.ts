/**
 * Insider-Threat & Fraud-Fusion Router
 *
 * tRPC surface for the ml/insider/ detection stack:
 *
 *   riskRegister        latest fused insider-risk score per subject, with
 *                       component breakdown and explanation payload
 *   officerDetail       one subject: latest score + open violations
 *   sodViolations       process-control findings (SoD matrix, maker-checker
 *                       breaches, dormant reactivations, privilege grants)
 *   policyMatrix        the codified segregation-of-duties matrix and the
 *                       maker-checker action list (mirrors
 *                       ml/insider/process_controls.py — keep in sync)
 *   dualControlQueue    pending/decided maker-checker requests
 *   approveDualControl  admin; two DISTINCT approvers required, requester
 *                       can never approve; expired requests are rejected
 *   rejectDualControl   admin; requester cannot reject their own request
 *   runSweep            admin; invokes the Python detector as a child
 *                       process (`python -m ml.insider.run_detection --once`)
 *                       with a timeout and returns its JSON summary
 *
 * requireDualControl(action, payload, requestedBy) is exported so OTHER
 * routers can route sensitive actions through the maker-checker queue
 * instead of executing them directly. (Wiring into finePayments / dpco /
 * user-role routers is a documented next step — see
 * /tmp/wave4/insider_registration.md.)
 *
 * Authz: staffProcedure for reads, adminProcedure for actions.
 * Reads degrade gracefully (empty result + note) when migration 0080 has
 * not been applied yet, so the UI never hard-fails pre-migration.
 */
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, staffProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";

const execFileAsync = promisify(execFile);

// ─── Policy constants (mirror ml/insider/process_controls.py — keep in sync) ─

export const MAKER_CHECKER_ACTIONS = [
  "fine_settlement",
  "dpco_approval",
  "role_grant",
  "vault_sealing_override",
] as const;
export type MakerCheckerAction = (typeof MAKER_CHECKER_ACTIONS)[number];

export const SOD_MATRIX = [
  {
    process: "penalty_lifecycle",
    description:
      "Penalty issuer, approver and payment recorder must be three different officers for the same penalty.",
    scope: "penalty",
    steps: [
      { role: "penalty_issuer", actionTypes: ["issue_penalty", "create_financial_penalty"] },
      { role: "penalty_approver", actionTypes: ["approve_penalty", "confirm_penalty"] },
      { role: "payment_recorder", actionTypes: ["record_penalty_payment", "settle_fine"] },
    ],
  },
  {
    process: "appeals",
    description: "An appeal must be reviewed by someone other than the original decision maker.",
    scope: "case",
    steps: [
      { role: "original_decision_maker", actionTypes: ["issue_penalty", "decide_case", "reject_dsar", "deny_request"] },
      { role: "appeal_reviewer", actionTypes: ["review_appeal", "decide_appeal"] },
    ],
  },
  {
    process: "dpco_accreditation",
    description: "DPCO accreditation reviewer must not be affiliated with the applicant organisation.",
    scope: "application",
    steps: [
      { role: "applicant_affiliate", actionTypes: ["submit_dpco_application", "upload_dpco_evidence"] },
      { role: "accreditation_reviewer", actionTypes: ["approve_dpco_accreditation", "reject_dpco_accreditation"] },
    ],
  },
] as const;

const DUAL_CONTROL_TTL_HOURS = 72;
const SWEEP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes hard cap

// ─── DB helpers ──────────────────────────────────────────────────────────────

function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  }
  return pool;
}

/** True when the error is "relation does not exist" (migration 0080 pending). */
function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const pool = requirePool();
  const safe = params.map((p) =>
    p !== null && typeof p === "object" && !(p instanceof Date) ? JSON.stringify(p) : p,
  );
  const result = await pool.query(sql, safe);
  return (result.rows ?? []) as T[];
}

function actorOf(user: { id: number; openId?: string | null }): string {
  return user.openId ?? String(user.id);
}

// ─── Exported maker-checker helper (for wiring into other routers) ───────────

/**
 * Queue a sensitive action for maker-checker dual control instead of
 * executing it inline. Returns the created request; callers should treat
 * "queued" as the terminal state of their own mutation and surface the
 * request id to the user. Approval/rejection happens via this router's
 * approveDualControl / rejectDualControl procedures.
 */
export async function requireDualControl(
  action: MakerCheckerAction,
  payload: Record<string, unknown>,
  requestedBy: string,
  thresholdSnapshot: Record<string, unknown> = {},
): Promise<{ queued: true; requestId: number; status: "pending" }> {
  if (!MAKER_CHECKER_ACTIONS.includes(action)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Action '${action}' is not a maker-checker action`,
    });
  }
  const rows = await query<{ id: number }>(
    `INSERT INTO dual_control_requests
       (action_type, payload, requested_by, threshold_snapshot, status, expires_at)
     VALUES ($1, $2, $3, $4, 'pending', now() + make_interval(hours => $5))
     RETURNING id`,
    [action, payload, requestedBy, thresholdSnapshot, DUAL_CONTROL_TTL_HOURS],
  );
  await emitMutationEvent("insider.dual_control.requested", {
    requestId: rows[0]!.id, action, requestedBy,
  }).catch(() => undefined);
  return { queued: true, requestId: rows[0]!.id, status: "pending" };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const insiderThreatRouter = router({
  /** Risk register: latest fused score per subject, highest risk first. */
  riskRegister: staffProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(100),
        minScore: z.number().min(0).max(1).default(0),
        recommendedAction: z
          .enum(["monitor", "require_dual_approval", "suspend_privileges", "investigate"])
          .optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      try {
        const rows = await query(
          `SELECT DISTINCT ON (subject_id)
             subject_id, subject_type, fused_score, components, explanation,
             recommended_action, computed_at
           FROM insider_risk_scores
           WHERE fused_score >= $1
             AND ($2::text IS NULL OR recommended_action = $2)
           ORDER BY subject_id, computed_at DESC`,
          [input?.minScore ?? 0, input?.recommendedAction ?? null],
        );
        rows.sort((a, b) => Number(b.fused_score) - Number(a.fused_score));
        return { rows: rows.slice(0, input?.limit ?? 100), note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) {
          return { rows: [], note: "migration 0080 not applied — run a sweep first" };
        }
        throw err;
      }
    }),

  /** One subject: latest fused score + open violations referencing them. */
  officerDetail: staffProcedure
    .input(z.object({ subjectId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      try {
        const scores = await query(
          `SELECT subject_id, subject_type, fused_score, components, explanation,
                  recommended_action, computed_at
           FROM insider_risk_scores
           WHERE subject_id = $1
           ORDER BY computed_at DESC LIMIT 1`,
          [input.subjectId],
        );
        const violations = await query(
          `SELECT id, rule, subject_refs, evidence, status, detected_at
           FROM sod_violations
           WHERE subject_refs->>'actor_id' = $1
              OR subject_refs->>'target_user_id' = $1
           ORDER BY detected_at DESC LIMIT 50`,
          [input.subjectId],
        );
        return { score: scores[0] ?? null, violations };
      } catch (err) {
        if (isMissingTable(err)) return { score: null, violations: [] };
        throw err;
      }
    }),

  /** Process-control violations (SoD, maker-checker, watches). */
  sodViolations: staffProcedure
    .input(
      z.object({
        status: z.enum(["open", "acknowledged", "resolved", "dismissed"]).default("open"),
        limit: z.number().int().min(1).max(500).default(100),
      }).optional(),
    )
    .query(async ({ input }) => {
      try {
        const rows = await query(
          `SELECT id, rule, subject_refs, evidence, status, detected_at,
                  resolved_at, resolved_by
           FROM sod_violations
           WHERE status = $1
           ORDER BY detected_at DESC LIMIT $2`,
          [input?.status ?? "open", input?.limit ?? 100],
        );
        return { rows, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) {
          return { rows: [], note: "migration 0080 not applied" };
        }
        throw err;
      }
    }),

  /** The codified segregation-of-duties matrix + maker-checker action list. */
  policyMatrix: staffProcedure.query(() => ({
    sodMatrix: SOD_MATRIX,
    makerCheckerActions: MAKER_CHECKER_ACTIONS,
    dualControlTtlHours: DUAL_CONTROL_TTL_HOURS,
    source: "ml/insider/process_controls.py (mirrored)",
  })),

  /** Maker-checker queue: pending first, then recently decided. */
  dualControlQueue: staffProcedure
    .input(
      z.object({
        includeDecided: z.boolean().default(true),
        limit: z.number().int().min(1).max(500).default(100),
      }).optional(),
    )
    .query(async ({ input }) => {
      try {
        const rows = await query(
          `SELECT id, action_type, payload, requested_by, first_approver,
                  second_approver, status, threshold_snapshot, created_at,
                  expires_at, decided_at, decided_by, decision_reason
           FROM dual_control_requests
           WHERE ($1::boolean OR status = 'pending')
           ORDER BY (status = 'pending') DESC, created_at DESC
           LIMIT $2`,
          [input?.includeDecided ?? true, input?.limit ?? 100],
        );
        return { rows, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) {
          return { rows: [], note: "migration 0080 not applied" };
        }
        throw err;
      }
    }),

  /**
   * Approve a maker-checker request. Two DISTINCT approvers are required;
   * the requester can never approve; approvals after expiry mark the
   * request expired and fail.
   */
  approveDualControl: adminProcedure
    .input(z.object({ requestId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const approver = actorOf(ctx.user);
      const pool = requirePool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT * FROM dual_control_requests WHERE id = $1 FOR UPDATE`,
          [input.requestId],
        );
        const req = res.rows[0];
        if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "request not found" });
        if (req.status !== "pending") {
          throw new TRPCError({ code: "CONFLICT", message: `request already ${req.status}` });
        }
        if (new Date(req.expires_at).getTime() <= Date.now()) {
          await client.query(
            `UPDATE dual_control_requests SET status = 'expired', decided_at = now() WHERE id = $1`,
            [input.requestId],
          );
          await client.query("COMMIT");
          throw new TRPCError({ code: "CONFLICT", message: "request expired" });
        }
        if (req.requested_by === approver) {
          throw new TRPCError({ code: "FORBIDDEN", message: "self-approval is not permitted" });
        }
        if (req.first_approver === approver) {
          throw new TRPCError({ code: "CONFLICT", message: "approver has already approved" });
        }
        let status: string;
        if (!req.first_approver) {
          await client.query(
            `UPDATE dual_control_requests SET first_approver = $2 WHERE id = $1`,
            [input.requestId, approver],
          );
          status = "pending"; // awaiting second approver
        } else {
          await client.query(
            `UPDATE dual_control_requests
             SET second_approver = $2, status = 'approved', decided_at = now(), decided_by = $2
             WHERE id = $1`,
            [input.requestId, approver],
          );
          status = "approved";
        }
        await client.query("COMMIT");
        await emitMutationEvent("insider.dual_control.approved", {
          requestId: input.requestId, approver, finalStatus: status,
        }).catch(() => undefined);
        return { requestId: input.requestId, status };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }),

  /** Reject a maker-checker request (requester may not reject their own). */
  rejectDualControl: adminProcedure
    .input(
      z.object({
        requestId: z.number().int().positive(),
        reason: z.string().max(2000).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const approver = actorOf(ctx.user);
      const rows = await query<{ requested_by: string; status: string }>(
        `SELECT requested_by, status FROM dual_control_requests WHERE id = $1`,
        [input.requestId],
      );
      const req = rows[0];
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "request not found" });
      if (req.status !== "pending") {
        throw new TRPCError({ code: "CONFLICT", message: `request already ${req.status}` });
      }
      if (req.requested_by === approver) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "requester cannot reject their own request (ask a second officer)",
        });
      }
      await query(
        `UPDATE dual_control_requests
         SET status = 'rejected', decided_at = now(), decided_by = $2, decision_reason = $3
         WHERE id = $1`,
        [input.requestId, approver, input.reason],
      );
      await emitMutationEvent("insider.dual_control.rejected", {
        requestId: input.requestId, approver, reason: input.reason,
      }).catch(() => undefined);
      return { requestId: input.requestId, status: "rejected" as const };
    }),

  /**
   * Admin: run the full insider-threat detection sweep.
   *
   * Invokes `python -m ml.insider.run_detection --once` as a child process
   * from the repository root with a 10-minute timeout, then reads the JSON
   * risk register it wrote. The Python side falls back to deterministic
   * synthetic data when Postgres is unreachable, so this procedure works
   * in every environment; pass insert=true to persist results into
   * insider_risk_scores / sod_violations (requires DATABASE_URL and a
   * Python pg driver on the host running the sweep).
   */
  runSweep: adminProcedure
    .input(
      z.object({
        insert: z.boolean().default(false),
        nSubjects: z.number().int().min(10).max(1000).default(60),
        seed: z.number().int().default(42),
      }).optional(),
    )
    .mutation(async ({ input }) => {
      const repoRoot = process.cwd();
      const jsonOut = path.join(
        os.tmpdir(),
        `insider_risk_register_${Date.now()}.json`,
      );
      const pythonBin = process.env.NDSEP_PYTHON || "python3";
      const args = [
        "-m", "ml.insider.run_detection", "--once",
        "--json-out", jsonOut,
        "--n-subjects", String(input?.nSubjects ?? 60),
        "--seed", String(input?.seed ?? 42),
      ];
      if (input?.insert) args.push("--insert");
      let stdout: string;
      try {
        const res = await execFileAsync(pythonBin, args, {
          cwd: repoRoot,
          timeout: SWEEP_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
          env: { ...process.env, NDSEP_ML_MONITOR: "0" },
        });
        stdout = res.stdout;
      } catch (err) {
        logger.error({ err }, "[insiderThreat] sweep child process failed");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `insider sweep failed: ${err instanceof Error ? err.message.slice(0, 500) : String(err)}`,
        });
      }
      // The CLI prints a JSON summary as its last stdout block.
      const start = stdout.indexOf("{");
      if (start < 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "sweep produced no JSON summary",
        });
      }
      let summary: Record<string, unknown>;
      try {
        summary = JSON.parse(stdout.slice(start));
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "could not parse sweep summary JSON",
        });
      }
      await emitMutationEvent("insider.sweep.completed", {
        nSubjects: summary.n_subjects,
        nViolations: summary.n_violations,
        insert: input?.insert ?? false,
      }).catch(() => undefined);
      return summary;
    }),
});

export type InsiderThreatRouter = typeof insiderThreatRouter;
