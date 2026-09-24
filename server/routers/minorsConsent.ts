/**
 * Minors Consent Router — NDPA 2023 (child data subjects)
 * - Age-assurance records (document / bank verification / guardian attestation)
 * - Consent refresh workflow when a child reaches the age of majority (18):
 *   re-consent task generation, processing block until renewed
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
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
    logger.error({ err, query: query.slice(0, 200) }, "[minors] DB query error");
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
    logger.warn({ err, action, resourceType }, "[minors] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

export const minorsConsentRouter = router({
  // ─── Age assurance ───────────────────────────────────────────────────────
  recordAgeAssurance: protectedProcedure
    .input(z.object({
      organization_id: z.number().int().positive(),
      data_subject_ref: z.string().min(1).max(128),
      dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dob must be YYYY-MM-DD"),
      method: z.enum(["document", "bank_verification", "guardian_attestation"]),
      evidence_ref: z.string().optional(),
      guardian_name: z.string().max(256).optional(),
      guardian_contact: z.string().max(320).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.method === "guardian_attestation" && !input.guardian_name) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "guardian_name is required for guardian attestation" });
      }
      const dob = new Date(input.dob);
      if (Number.isNaN(dob.getTime()) || dob > new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "dob must be a valid past date" });
      }
      const [row] = await exec(
        `INSERT INTO age_assurance_records
           (organization_id, data_subject_ref, dob, method, evidence_ref, guardian_name, guardian_contact)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *, (dob + INTERVAL '18 years')::date AS majority_date`,
        [
          input.organization_id, input.data_subject_ref, input.dob, input.method,
          input.evidence_ref ?? null, input.guardian_name ?? null, input.guardian_contact ?? null,
        ]
      );
      await logAudit("age_assurance_recorded", "age_assurance_records", row?.id, String(ctx.user.id), {
        method: input.method, data_subject_ref: input.data_subject_ref,
      });
      fireAndForget("minorsConsent.recordAgeAssurance");
      return row;
    }),

  verifyAgeAssurance: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["verified", "failed"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE age_assurance_records
         SET status = $2, verified_by = $3, verified_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'pending' RETURNING *`,
        [input.id, input.decision, ctx.user.name ?? String(ctx.user.id)]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Record not found or already processed" });
      await logAudit("age_assurance_verified", "age_assurance_records", input.id, String(ctx.user.id), { decision: input.decision });
      // On successful verification, immediately ensure a re-consent task exists
      if (input.decision === "verified") {
        await exec(
          `INSERT INTO consent_refresh_tasks
             (age_assurance_id, organization_id, data_subject_ref, majority_date, due_at)
           VALUES ($1, $2, $3, (SELECT (dob + INTERVAL '18 years')::date FROM age_assurance_records WHERE id = $1),
                   (SELECT (dob + INTERVAL '18 years')::timestamptz FROM age_assurance_records WHERE id = $1))
           ON CONFLICT DO NOTHING`,
          [input.id, row.organization_id, row.data_subject_ref]
        );
      }
      fireAndForget("minorsConsent.verifyAgeAssurance");
      return row;
    }),

  listAgeAssurances: protectedProcedure
    .input(z.object({ organizationId: z.number().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.organizationId) { params.push(input.organizationId); conditions.push(`organization_id = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT *, (dob + INTERVAL '18 years')::date AS majority_date,
                DATE_PART('year', AGE(dob)) AS current_age_years
         FROM age_assurance_records ${where} ORDER BY created_at DESC LIMIT 500`,
        params
      );
    }),

  // ─── Consent refresh at majority ─────────────────────────────────────────
  /**
   * Generate (idempotently) re-consent tasks for verified age-assurance
   * records whose subject reaches majority within the lookahead window.
   * Also transitions due tasks and blocks processing on expired ones.
   */
  generateConsentRefreshTasks: protectedProcedure
    .input(z.object({ lookaheadDays: z.number().int().min(0).max(365).default(90) }).optional())
    .mutation(async ({ input, ctx }) => {
      const lookahead = input?.lookaheadDays ?? 90;
      const created = await exec(
        `INSERT INTO consent_refresh_tasks
           (age_assurance_id, organization_id, data_subject_ref, majority_date, due_at)
         SELECT id, organization_id, data_subject_ref,
                (dob + INTERVAL '18 years')::date,
                (dob + INTERVAL '18 years')::timestamptz
         FROM age_assurance_records
         WHERE status = 'verified'
           AND (dob + INTERVAL '18 years')::date <= CURRENT_DATE + ($1 || ' days')::interval
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [lookahead]
      );
      // Mark tasks as due when the majority date has arrived
      const due = await exec(
        `UPDATE consent_refresh_tasks SET status = 'due', updated_at = NOW()
         WHERE status = 'scheduled' AND majority_date <= CURRENT_DATE RETURNING id`
      );
      // Block processing for tasks overdue beyond a 30-day grace period
      const blocked = await exec(
        `UPDATE consent_refresh_tasks
         SET status = 'blocked', processing_blocked = true, updated_at = NOW()
         WHERE status = 'due' AND majority_date < CURRENT_DATE - INTERVAL '30 days' RETURNING id`
      );
      await logAudit("consent_refresh_generated", "consent_refresh_tasks", null, String(ctx.user.id), {
        created: created.length, markedDue: due.length, blocked: blocked.length,
      });
      fireAndForget("minorsConsent.generateConsentRefreshTasks");
      return { created: created.length, markedDue: due.length, blocked: blocked.length, tasks: created };
    }),

  listConsentRefreshTasks: protectedProcedure
    .input(z.object({ organizationId: z.number().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.organizationId) { params.push(input.organizationId); conditions.push(`organization_id = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT *, (majority_date - CURRENT_DATE) AS days_until_majority
         FROM consent_refresh_tasks ${where}
         ORDER BY majority_date ASC LIMIT 500`,
        params
      );
    }),

  /** Data subject (now adult) re-confirms consent; processing is unblocked */
  renewConsent: protectedProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      renewedBy: z.string().min(2).max(256),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE consent_refresh_tasks
         SET status = 'renewed', processing_blocked = false, renewed_at = NOW(),
             renewed_by = $2, notes = $3, updated_at = NOW()
         WHERE id = $1 AND status IN ('scheduled', 'due', 'blocked') RETURNING *`,
        [input.taskId, input.renewedBy, input.notes ?? null]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Task not found or already renewed/expired" });
      await logAudit("consent_renewed_at_majority", "consent_refresh_tasks", input.taskId, String(ctx.user.id), {
        data_subject_ref: row.data_subject_ref,
      });
      fireAndForget("minorsConsent.renewConsent");
      return row;
    }),

  /** Manually block processing for a data subject pending re-consent */
  blockProcessing: protectedProcedure
    .input(z.object({ taskId: z.number().int().positive(), reason: z.string().min(5) }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE consent_refresh_tasks
         SET status = 'blocked', processing_blocked = true, notes = $2, updated_at = NOW()
         WHERE id = $1 AND status IN ('scheduled', 'due') RETURNING *`,
        [input.taskId, input.reason]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Task not found or not blockable" });
      await logAudit("minor_processing_blocked", "consent_refresh_tasks", input.taskId, String(ctx.user.id), { reason: input.reason });
      fireAndForget("minorsConsent.blockProcessing");
      return row;
    }),

  /** Gate check: may this data subject's data be processed? */
  checkProcessingAllowed: protectedProcedure
    .input(z.object({ data_subject_ref: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const blocked = await exec(
        `SELECT id, status, majority_date FROM consent_refresh_tasks
         WHERE data_subject_ref = $1 AND processing_blocked = true
         ORDER BY updated_at DESC LIMIT 1`,
        [input.data_subject_ref]
      );
      const pending = await exec(
        `SELECT id, status, majority_date, (majority_date - CURRENT_DATE) AS days_until_majority
         FROM consent_refresh_tasks
         WHERE data_subject_ref = $1 AND status IN ('scheduled', 'due')
         ORDER BY majority_date ASC LIMIT 1`,
        [input.data_subject_ref]
      );
      return {
        data_subject_ref: input.data_subject_ref,
        processing_allowed: blocked.length === 0,
        blocking_task: blocked[0] ?? null,
        upcoming_refresh: pending[0] ?? null,
      };
    }),
});
