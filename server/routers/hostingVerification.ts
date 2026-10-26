/**
 * Hosting Verification Router (Round-13 P0.2)
 * ===================================================================
 * tRPC surface over server/services/hostingVerification.ts — evidence-based
 * verification of hosting declarations via OSIRIS RECON + the verified NG
 * prefix/ASN reference tables (migrations 0096/0120/0142).
 *
 *   verifyNow(declarationId)   manual trigger (staff); runs verification
 *                              synchronously and returns the persisted verdict.
 *   runDue                     manual trigger for the due-verification sweep
 *                              (same function the scheduler calls).
 *   listVerdicts(status)       verification queue — latest run per
 *                              declaration, violations first.
 *   declarationVerdict(id)     latest run + per-host evidence for one
 *                              declaration (badge/popover data source).
 *   stats                      verdict distribution + recency for dashboards.
 *   confirmFlag / rejectFlag   human confirm/reject of a violation flag —
 *                              the ONLY paths that write decision_feedback
 *                              rows for surface 'hosting_verification'
 *                              (baseline is minted at flag time by the
 *                              service; these append the human outcome).
 *
 * Authz: staffProcedure for everything (verification runs recon against
 * declared infrastructure — not an entity self-serve surface).
 * Reads degrade gracefully when migration 0142 is not yet applied.
 *
 * Wiring: registered in server/routers.ts by the integrator (that file is
 * owned by another workstream this round).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, staffProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { publishWithOutbox } from "../kafka";
import { appendLedger } from "../antiwipe/ledger";
import { actorUuid, FEEDBACK_TOPIC } from "./decisionFeedback";
import {
  verifyDeclaration,
  runDueVerifications,
  FEEDBACK_SURFACE,
  DECLARATION_VERDICTS,
} from "../services/hostingVerification";

// ─── DB helpers (mirrors dataSovereignty.ts conventions) ─────────────────────

function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

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
    if (isMissingTable(err)) throw err;
    logger.error({ err, query: query.slice(0, 200) }, "[hostingVerification] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

/** Latest run id per declaration (for verdict rollups). */
const LATEST_RUN_CTE = `
  SELECT DISTINCT ON (declaration_id) *
  FROM hosting_verification_runs
  ORDER BY declaration_id, checked_at DESC
`;

// ─── Router ───────────────────────────────────────────────────────────────────

export const hostingVerificationRouter = router({
  /** Manual trigger: verify one declaration now (staff). */
  verifyNow: staffProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await verifyDeclaration(input.declarationId, {
          trigger: "manual",
          checkedBy: ctx.user?.name ?? String(ctx.user?.id ?? "staff"),
        });
        return result;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) {
          throw new TRPCError({ code: "NOT_FOUND", message: msg });
        }
        logger.error({ err: msg }, "[hostingVerification] verifyNow failed");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Verification run failed" });
      }
    }),

  /** Manual trigger for the scheduled sweep (operator override). */
  runDue: staffProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(50) }).optional())
    .mutation(async ({ input }) => {
      return runDueVerifications({ limit: input?.limit });
    }),

  /** Verification queue: latest run per declaration, violations first. */
  listVerdicts: staffProcedure
    .input(
      z
        .object({
          status: z.enum(DECLARATION_VERDICTS).optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.status) {
        params.push(input.status);
        conditions.push(`lr.verdict = $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      try {
        const rows = await exec(
          `WITH latest AS (${LATEST_RUN_CTE})
           SELECT lr.id AS run_id, lr.declaration_id, lr.entity_ref, lr.verdict, lr.trigger,
                  lr.host_count, lr.in_nigeria_count, lr.outside_nigeria_count,
                  lr.unverified_count, lr.prediction_id, lr.checked_by, lr.checked_at, lr.evidence,
                  d.entity_name, d.entity_type, d.declaration_status, d.in_scope
           FROM latest lr
           JOIN hosting_declarations d ON d.id = lr.declaration_id
           ${where}
           ORDER BY CASE lr.verdict
                      WHEN 'violation' THEN 0 WHEN 'unverified' THEN 1 ELSE 2 END,
                    lr.checked_at DESC
           LIMIT ${input?.limit ?? 200}`,
          params
        );
        return { rows, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { rows: [], note: "migration 0142 not applied" };
        throw err;
      }
    }),

  /** Latest verdict + per-host evidence for one declaration (badge popover). */
  declarationVerdict: staffProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        const [run] = await exec(
          `SELECT * FROM hosting_verification_runs
           WHERE declaration_id = $1 ORDER BY checked_at DESC LIMIT 1`,
          [input.declarationId]
        );
        if (!run) return { run: null, hosts: [], note: "never verified" };
        const hosts = await exec(
          `SELECT id, host, host_kind, resolved_ips, verdict, evidence, checked_at
           FROM hosting_verification_hosts WHERE run_id = $1
           ORDER BY CASE verdict
                      WHEN 'outside_nigeria' THEN 0 WHEN 'unverified' THEN 1 ELSE 2 END, host`,
          [run.id]
        );
        return { run, hosts, note: null as string | null };
      } catch (err) {
        if (isMissingTable(err)) return { run: null, hosts: [], note: "migration 0142 not applied" };
        throw err;
      }
    }),

  /** Dashboard stats: verdict distribution over latest runs + run recency. */
  stats: staffProcedure.query(async () => {
    try {
      const [verdicts] = await exec(
        `WITH latest AS (${LATEST_RUN_CTE})
         SELECT
           COUNT(*)::int AS declarations_verified,
           COUNT(*) FILTER (WHERE verdict = 'compliant')::int AS compliant,
           COUNT(*) FILTER (WHERE verdict = 'violation')::int AS violation,
           COUNT(*) FILTER (WHERE verdict = 'unverified')::int AS unverified,
           MAX(checked_at) AS last_checked_at
         FROM latest`
      );
      const [pending] = await exec(
        `SELECT COUNT(*)::int AS never_verified
         FROM hosting_declarations d
         WHERE d.in_scope = TRUE AND d.declaration_status <> 'rejected'
           AND NOT EXISTS (
             SELECT 1 FROM hosting_verification_runs r WHERE r.declaration_id = d.id
           )`
      );
      const [recent] = await exec(
        `SELECT COUNT(*)::int AS runs_24h,
                COUNT(*) FILTER (WHERE verdict = 'violation')::int AS violations_24h
         FROM hosting_verification_runs
         WHERE checked_at >= now() - interval '24 hours'`
      );
      return { ...(verdicts ?? {}), ...(pending ?? {}), ...(recent ?? {}), note: null as string | null };
    } catch (err) {
      if (isMissingTable(err)) return { note: "migration 0142 not applied" };
      throw err;
    }
  }),

  /**
   * Human CONFIRMS a violation flag (accept). Appends the outcome row to
   * decision_feedback for surface 'hosting_verification' and marks the run's
   * evidence with the human decision.
   */
  confirmFlag: staffProcedure
    .input(z.object({ runId: z.number().int().positive(), notes: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => flagOutcome(input.runId, "accept", ctx, input.notes)),

  /** Human REJECTS a violation flag (false positive). */
  rejectFlag: staffProcedure
    .input(z.object({ runId: z.number().int().positive(), reason: z.string().min(3).max(2000) }))
    .mutation(async ({ input, ctx }) => flagOutcome(input.runId, "reject", ctx, input.reason)),
});

type Ctx = { user?: { id: number | string; name?: string | null } };

async function flagOutcome(
  runId: number,
  action: "accept" | "reject",
  ctx: Ctx,
  notes?: string
): Promise<{ runId: number; action: string; feedbackId: string }> {
  const [run] = await exec(
    `SELECT id, declaration_id, entity_ref, verdict, prediction_id
     FROM hosting_verification_runs WHERE id = $1`,
    [runId]
  );
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Verification run not found" });
  if (run.verdict !== "violation") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only violation flags can be confirmed/rejected" });
  }
  if (!run.prediction_id) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Run has no decision_feedback baseline (prediction_id missing) — cannot record outcome",
    });
  }
  const actor = ctx.user?.name ?? String(ctx.user?.id ?? "staff");
  const actorId = actorUuid(ctx.user?.id ?? actor);

  const rows = await exec(
    `INSERT INTO decision_feedback
       (prediction_id, surface, model_version, suggestion, actor_id, action, edit_distance, final_value)
     SELECT $1, $2, 'recon-r13',
            (SELECT suggestion FROM decision_feedback WHERE prediction_id = $1
             ORDER BY created_at ASC LIMIT 1),
            $3, $4, NULL, $5::jsonb
     RETURNING id, created_at`,
    [run.prediction_id, FEEDBACK_SURFACE, actorId, action, JSON.stringify({ notes: notes ?? null, runId })]
  );
  const feedbackId = rows[0]?.id as string;

  await exec(
    `UPDATE hosting_verification_runs
     SET evidence = evidence || $1::jsonb
     WHERE id = $2`,
    [JSON.stringify({ human_review: { action, actor, notes: notes ?? null, at: new Date().toISOString() } }), runId]
  );

  publishWithOutbox(FEEDBACK_TOPIC, String(run.prediction_id), {
    event: "feedback.recorded",
    feedbackId,
    predictionId: run.prediction_id,
    surface: FEEDBACK_SURFACE,
    action,
    actorId,
    modelVersion: "recon-r13",
    ts: new Date().toISOString(),
  }).catch((e: unknown) =>
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "[hostingVerification] feedback publish failed")
  );
  appendLedger("sovereignty.verification.flag_review", {
    runId,
    declarationId: run.declaration_id,
    entityRef: run.entity_ref,
    action,
    feedbackId,
  }, actor).catch((e: unknown) =>
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[hostingVerification] ledger append failed")
  );

  return { runId, action, feedbackId };
}
