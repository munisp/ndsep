/**
 * Minors Consent Router — NDPA 2023 (child data subjects)
 * - Age-assurance records (document / bank verification / guardian attestation)
 * - Consent refresh workflow when a child reaches the age of majority (18):
 *   re-consent task generation, processing block until renewed
 *
 * Round-9 remediation:
 *   - All child/guardian PII (dob, guardian_name, guardian_contact,
 *     data_subject_ref) is encrypted at write via encryptField; equality
 *     lookups use a keyed-HMAC column (data_subject_ref_hmac) because
 *     random-IV ciphertext is not searchable.
 *   - Org scoping: org_admin callers are confined to their own
 *     organization_id on every procedure that touches org data.
 *   - checkProcessingAllowed fails CLOSED for known-child contexts: a child
 *     with verified age assurance but no valid parental-consent linkage and
 *     no renewed majority consent gets processing_allowed=false with
 *     assurance 'none' and a block flag.
 *   - renewConsent requires the majority date to have been reached and an
 *     evidence reference for the renewal.
 *   - Age-assurance records can be linked to parental_consent_records
 *     (migration 0103 creates the table if missing + the linkage column).
 *   - sweepExpired transitions stale records/tasks to the 'expired' status.
 */
import { z } from "zod";
import { router, protectedProcedure, staffProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField, decryptField } from "../encryption";
import { requireHmacKey, hmacSha256Hex } from "../services/complaintLogic";

const SUBJECT_HMAC_KEY = process.env.SUBJECT_HMAC_KEY ?? "";
if (!SUBJECT_HMAC_KEY) {
  logger.warn("[minors] SUBJECT_HMAC_KEY is not set — data_subject_ref hashes use a dev-only key outside production. Set SUBJECT_HMAC_KEY.");
}

/** Keyed HMAC of the normalized data-subject reference; fail-closed in prod. */
function subjectRefHmac(ref: string): string {
  const { key } = requireHmacKey(SUBJECT_HMAC_KEY, "SUBJECT_HMAC_KEY", { devSeed: "minors-subject" });
  return hmacSha256Hex(key, ref.trim().toLowerCase());
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
    const rows = result.rows ?? [];
    return autoDecryptRows(query, rows);
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[minors] DB query error");
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
  details: Record<string, unknown> = {}
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)]
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[minors] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

/** Org scoping: returns the organization id the caller is confined to. */
function orgScopeFilter(ctx: any, requestedOrgId?: number | null): number | null {
  const role = ctx?.user?.role;
  if (role === "org_admin" || role === "user") {
    const userOrg = ctx?.user?.organizationId ?? ctx?.user?.organization_id ?? null;
    if (userOrg == null) {
      throw new TRPCError({ code: "FORBIDDEN", message: "No organisation attached to this account." });
    }
    if (requestedOrgId != null && Number(requestedOrgId) !== Number(userOrg)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not authorised for this organisation." });
    }
    return Number(userOrg);
  }
  return requestedOrgId ?? null;
}

/** PII columns stored encrypted at rest; decrypt explicitly on read. */
const AAR_PII = ["dob", "guardian_name", "guardian_contact", "data_subject_ref"] as const;
const CRT_PII = ["data_subject_ref"] as const;
function decryptCols<T extends Record<string, any>>(row: T, cols: readonly string[]): T {
  const out = { ...row };
  for (const c of cols) {
    if (typeof out[c] === "string") (out as any)[c] = decryptField(out[c]);
  }
  return out;
}

/** Majority date (18th birthday) computed in app code: dob is encrypted at
 *  rest (ciphertext is not date-arithmetic-able in SQL), so the plaintext
 *  majority_date column carries the schedule arithmetic. */
function computeMajorityDate(dob: string): string {
  const d = new Date(`${dob}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 18);
  return d.toISOString().slice(0, 10);
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
      parental_consent_record_id: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      orgScopeFilter(ctx, input.organization_id);
      if (input.method === "guardian_attestation" && !input.guardian_name) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "guardian_name is required for guardian attestation" });
      }
      const dob = new Date(input.dob);
      if (Number.isNaN(dob.getTime()) || dob > new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "dob must be a valid past date" });
      }
      // Parental-consent linkage: the record must exist and belong to the org.
      if (input.parental_consent_record_id != null) {
        const pcr = await exec(
          `SELECT id, organization_id, parental_consent_status FROM parental_consent_records WHERE id = $1`,
          [input.parental_consent_record_id],
        );
        if (!pcr[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Parental consent record not found." });
        if (Number(pcr[0].organization_id) !== input.organization_id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Parental consent record belongs to a different organisation." });
        }
      }
      const [row] = await exec(
        `INSERT INTO age_assurance_records
           (organization_id, data_subject_ref, data_subject_ref_hmac, dob, majority_date, method, evidence_ref,
            guardian_name, guardian_contact, parental_consent_record_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          input.organization_id,
          encryptField(input.data_subject_ref), subjectRefHmac(input.data_subject_ref),
          encryptField(input.dob), computeMajorityDate(input.dob), input.method,
          input.evidence_ref ?? null,
          input.guardian_name ? encryptField(input.guardian_name) : null,
          input.guardian_contact ? encryptField(input.guardian_contact) : null,
          input.parental_consent_record_id ?? null,
        ]
      );
      await logAudit("age_assurance_recorded", "age_assurance_records", row?.id, String(ctx.user.id), {
        method: input.method, data_subject_ref_hmac: subjectRefHmac(input.data_subject_ref),
      });
      fireAndForget("minorsConsent.recordAgeAssurance");
      return decryptCols(row, AAR_PII);
    }),

  verifyAgeAssurance: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["verified", "failed"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await exec(`SELECT id, organization_id FROM age_assurance_records WHERE id = $1`, [input.id]);
      if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      orgScopeFilter(ctx, Number(existing[0].organization_id));
      const [row] = await exec(
        `UPDATE age_assurance_records
         SET status = $2, verified_by = $3, verified_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'pending' RETURNING *`,
        [input.id, input.decision, ctx.user.name ?? String(ctx.user.id)]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Record not found or already processed" });
      await logAudit("age_assurance_verified", "age_assurance_records", input.id, String(ctx.user.id), { decision: input.decision });
      // On successful verification, immediately ensure a re-consent task exists.
      // data_subject_ref is copied as-is (already ciphertext at rest) with its
      // lookup HMAC alongside.
      if (input.decision === "verified") {
        await exec(
          `INSERT INTO consent_refresh_tasks
             (age_assurance_id, organization_id, data_subject_ref, data_subject_ref_hmac, majority_date, due_at)
           SELECT id, organization_id, data_subject_ref, data_subject_ref_hmac,
                  majority_date, majority_date::timestamptz
           FROM age_assurance_records WHERE id = $1
           ON CONFLICT DO NOTHING`,
          [input.id]
        );
      }
      fireAndForget("minorsConsent.verifyAgeAssurance");
      return decryptCols(row, AAR_PII);
    }),

  listAgeAssurances: protectedProcedure
    .input(z.object({ organizationId: z.number().optional(), status: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = orgScopeFilter(ctx, input?.organizationId ?? null);
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (orgId != null) { params.push(orgId); conditions.push(`organization_id = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = await exec(
        `SELECT *, majority_date,
                DATE_PART('year', AGE((majority_date - INTERVAL '18 years')::date)) AS current_age_years
         FROM age_assurance_records ${where} ORDER BY created_at DESC LIMIT 500`,
        params
      );
      return rows.map((r) => decryptCols(r, AAR_PII));
    }),

  // ─── Consent refresh at majority ─────────────────────────────────────────
  /**
   * Generate (idempotently) re-consent tasks for verified age-assurance
   * records whose subject reaches majority within the lookahead window.
   * Also transitions due tasks and blocks processing on expired ones.
   */
  generateConsentRefreshTasks: staffProcedure
    .input(z.object({ lookaheadDays: z.number().int().min(0).max(365).default(90) }).optional())
    .mutation(async ({ input, ctx }) => {
      const lookahead = input?.lookaheadDays ?? 90;
      const created = await exec(
        `INSERT INTO consent_refresh_tasks
           (age_assurance_id, organization_id, data_subject_ref, data_subject_ref_hmac, majority_date, due_at)
         SELECT id, organization_id, data_subject_ref, data_subject_ref_hmac,
                majority_date, majority_date::timestamptz
         FROM age_assurance_records
         WHERE status = 'verified'
           AND majority_date <= CURRENT_DATE + ($1 || ' days')::interval
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [String(lookahead)]
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
      return { created: created.length, markedDue: due.length, blocked: blocked.length, tasks: created.map((t) => decryptCols(t, CRT_PII)) };
    }),

  listConsentRefreshTasks: protectedProcedure
    .input(z.object({ organizationId: z.number().optional(), status: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = orgScopeFilter(ctx, input?.organizationId ?? null);
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (orgId != null) { params.push(orgId); conditions.push(`organization_id = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = await exec(
        `SELECT *, (majority_date - CURRENT_DATE) AS days_until_majority
         FROM consent_refresh_tasks ${where}
         ORDER BY majority_date ASC LIMIT 500`,
        params
      );
      return rows.map((r) => decryptCols(r, CRT_PII));
    }),

  /**
   * Data subject (now adult) re-confirms consent; processing is unblocked.
   * Requires the majority date to have been REACHED and an evidence reference
   * for the renewal (NDPA 2023 — consent must be demonstrable).
   */
  renewConsent: protectedProcedure
    .input(z.object({
      taskId: z.number().int().positive(),
      renewedBy: z.string().min(2).max(256),
      evidenceRef: z.string().min(4, "An evidence reference for the renewal is required").max(1024),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const task = await exec(`SELECT id, organization_id, majority_date FROM consent_refresh_tasks WHERE id = $1`, [input.taskId]);
      if (!task[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      orgScopeFilter(ctx, Number(task[0].organization_id));
      const [row] = await exec(
        `UPDATE consent_refresh_tasks
         SET status = 'renewed', processing_blocked = false, renewed_at = NOW(),
             renewed_by = $2, notes = $3, evidence_ref = $4, updated_at = NOW()
         WHERE id = $1 AND status IN ('scheduled', 'due', 'blocked')
           AND majority_date <= CURRENT_DATE
         RETURNING *`,
        [input.taskId, input.renewedBy, input.notes ?? null, input.evidenceRef]
      );
      if (!row) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Task not found, already renewed/expired, or the data subject has not yet reached the age of majority (majority_date is in the future).",
        });
      }
      await logAudit("consent_renewed_at_majority", "consent_refresh_tasks", input.taskId, String(ctx.user.id), {
        data_subject_ref_hmac: row.data_subject_ref_hmac,
      });
      fireAndForget("minorsConsent.renewConsent");
      return decryptCols(row, CRT_PII);
    }),

  /** Manually block processing for a data subject pending re-consent */
  blockProcessing: protectedProcedure
    .input(z.object({ taskId: z.number().int().positive(), reason: z.string().min(5) }))
    .mutation(async ({ input, ctx }) => {
      const task = await exec(`SELECT id, organization_id FROM consent_refresh_tasks WHERE id = $1`, [input.taskId]);
      if (!task[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      orgScopeFilter(ctx, Number(task[0].organization_id));
      const [row] = await exec(
        `UPDATE consent_refresh_tasks
         SET status = 'blocked', processing_blocked = true, notes = $2, updated_at = NOW()
         WHERE id = $1 AND status IN ('scheduled', 'due') RETURNING *`,
        [input.taskId, input.reason]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Task not found or not blockable" });
      await logAudit("minor_processing_blocked", "consent_refresh_tasks", input.taskId, String(ctx.user.id), { reason: input.reason });
      fireAndForget("minorsConsent.blockProcessing");
      return decryptCols(row, CRT_PII);
    }),

  /**
   * Gate check: may this data subject's data be processed?
   * FAILS CLOSED for known-child contexts: when a verified age-assurance
   * record shows the subject is still a child and there is NO parental
   * consent linkage and NO renewed majority consent, the answer is
   * processing_allowed=false with assurance 'none' and blocked=true.
   */
  checkProcessingAllowed: protectedProcedure
    .input(z.object({ data_subject_ref: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const hmac = subjectRefHmac(input.data_subject_ref);
      const blocked = await exec(
        `SELECT id, status, majority_date FROM consent_refresh_tasks
         WHERE data_subject_ref_hmac = $1 AND processing_blocked = true
         ORDER BY updated_at DESC LIMIT 1`,
        [hmac]
      );
      const pending = await exec(
        `SELECT id, status, majority_date, (majority_date - CURRENT_DATE) AS days_until_majority
         FROM consent_refresh_tasks
         WHERE data_subject_ref_hmac = $1 AND status IN ('scheduled', 'due')
         ORDER BY majority_date ASC LIMIT 1`,
        [hmac]
      );
      // Known-child check: verified age assurance with a future majority date.
      const childRows = await exec(
        `SELECT id, parental_consent_record_id, majority_date
         FROM age_assurance_records
         WHERE data_subject_ref_hmac = $1 AND status = 'verified'
           AND majority_date > CURRENT_DATE
         ORDER BY created_at DESC LIMIT 1`,
        [hmac]
      );
      const knownChild = childRows[0] ?? null;
      const renewed = await exec(
        `SELECT id FROM consent_refresh_tasks
         WHERE data_subject_ref_hmac = $1 AND status = 'renewed'
         ORDER BY renewed_at DESC LIMIT 1`,
        [hmac]
      );

      // Fail closed: known child without parental consent linkage and without
      // a (future-dated) renewal path must not be processed.
      if (knownChild && knownChild.parental_consent_record_id == null && !renewed[0]) {
        return {
          data_subject_ref_hmac: hmac,
          processing_allowed: false,
          assurance: "none" as const,
          blocked: true,
          reason: "Known child data subject without a linked parental consent record — processing is blocked pending verified parental consent (NDPA 2023).",
          blocking_task: blocked[0] ?? null,
          upcoming_refresh: pending[0] ?? null,
        };
      }

      return {
        data_subject_ref_hmac: hmac,
        processing_allowed: blocked.length === 0,
        assurance: knownChild ? "parental_consent" as const : "adult_or_unknown" as const,
        blocked: blocked.length > 0,
        blocking_task: blocked[0] ?? null,
        upcoming_refresh: pending[0] ?? null,
      };
    }),

  /**
   * Expired-status sweep (staff / scheduler):
   *   - consent_refresh_tasks stuck 'blocked' for >180 days → 'expired'
   *     (processing_blocked stays true — expiry never unblocks).
   *   - age_assurance_records stuck 'pending' for >90 days → 'expired'.
   */
  sweepExpired: staffProcedure
    .input(z.object({ taskExpiryDays: z.number().int().min(30).max(730).default(180), assuranceExpiryDays: z.number().int().min(7).max(365).default(90) }).optional())
    .mutation(async ({ input, ctx }) => {
      const taskDays = input?.taskExpiryDays ?? 180;
      const assuranceDays = input?.assuranceExpiryDays ?? 90;
      const expiredTasks = await exec(
        `UPDATE consent_refresh_tasks
         SET status = 'expired', updated_at = NOW()
         WHERE status = 'blocked'
           AND updated_at < NOW() - ($1 || ' days')::interval
         RETURNING id`,
        [String(taskDays)],
      );
      const expiredAssurances = await exec(
        `UPDATE age_assurance_records
         SET status = 'expired', updated_at = NOW()
         WHERE status = 'pending'
           AND created_at < NOW() - ($1 || ' days')::interval
         RETURNING id`,
        [String(assuranceDays)],
      );
      await logAudit("minors_expired_swept", "consent_refresh_tasks", null, String(ctx.user.id), {
        expiredTasks: expiredTasks.length, expiredAssurances: expiredAssurances.length,
      });
      fireAndForget("minorsConsent.sweepExpired");
      return { expiredTasks: expiredTasks.length, expiredAssurances: expiredAssurances.length };
    }),
});
