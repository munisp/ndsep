/**
 * DSAR Edge Cases Router
 * - On-behalf / guardian third-party submissions with authority evidence
 * - Deceased data subject handling (death certificate + executor verification)
 * - Refusal / exemption workflow ("manifestly unfounded or excessive") with
 *   mandatory written justification and appeal pointer
 * - Duplicate / competing request linking and merging
 * - Redaction workflow protecting third-party rights
 *
 * All tables are companions to the existing citizen_requests table; the
 * original DSAR router is untouched.
 *
 * Round-9 remediation:
 *   - verify* procedures are staffProcedure (NDPC staff / auditors only).
 *   - The statutory response clock is PAUSED while representative/executor
 *     verification is pending (dsar_clock_pauses, migration 0103); the
 *     deadline is recomputed when verification concludes.
 *   - extendDeadline grants up to 60 days total extension and only inside the
 *     initial response window, with the mandatory subject notification
 *     recorded (failures land in dsar_notification_retries).
 *   - mergeRequests uses the canonical 'merged' status (0103 extends the
 *     citizen_request_status vocabulary) instead of 'completed'.
 *   - Base-request + companion inserts run in a single transaction.
 *   - Public submission endpoints are IP-hash rate limited (non-TOCTOU upsert
 *     counter, trusted-proxy-aware client IP, env-salted hashes).
 *   - APPEAL_POINTER cites NDPA 2023 s.46 without an invented time bar.
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure, staffProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField, decryptField } from "../encryption";
import { sendCitizenRequestUpdate } from "../emailNotification";
import {
  hashIp,
  ipHashSalt,
  extractClientIp,
  fixedWindowStart,
  counterExceedsLimit,
} from "../services/complaintLogic";

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
    logger.error({ err, query: query.slice(0, 200) }, "[dsarEdge] DB query error");
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
    logger.warn({ err, action, resourceType }, "[dsarEdge] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

const RELATIONSHIPS = ["guardian", "legal_counsel", "next_of_kin", "authorised_agent", "executor"] as const;

/**
 * Appeal pointer for refusals. NDPA 2023 s.46 gives the data subject the
 * right to complain to the Commission; judicial review lies with the courts.
 * No statutory 30-day bar is asserted — none exists in the Act.
 */
const APPEAL_POINTER =
  "You may lodge a complaint with the Nigeria Data Protection Commission (NDPC) " +
  "under section 46 of the Nigeria Data Protection Act 2023, or apply to a " +
  "competent court for judicial review.";

const MAX_EXTENSION_DAYS_TOTAL = 60;
const SUBMIT_RATE_LIMIT_PER_HOUR = Math.max(1, parseInt(process.env.DSAR_EDGE_SUBMIT_RATE_LIMIT_PER_HOUR ?? "10", 10) || 10);
const TRUSTED_PROXY_COUNT = Math.max(0, parseInt(process.env.NDSEP_TRUSTED_PROXY_COUNT ?? "0", 10) || 0);

/**
 * Non-TOCTOU per-IP rate limit: one atomic upsert increments the fixed-window
 * counter and returns the new value, so concurrent bursts cannot both pass a
 * check-then-insert race.
 */
async function enforceIpRateLimit(req: any, action: string): Promise<void> {
  const ip = extractClientIp(req?.headers, req?.ip ?? req?.socket?.remoteAddress, TRUSTED_PROXY_COUNT);
  const key = hashIp(`${action}|${ip}`, ipHashSalt());
  const windowStart = fixedWindowStart(Date.now(), 3_600_000);
  const rows = await exec(
    `INSERT INTO rate_limit_counters (limiter_key, window_start, count, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (limiter_key, window_start)
     DO UPDATE SET count = rate_limit_counters.count + 1, updated_at = NOW()
     RETURNING count`,
    [key, windowStart],
  );
  if (counterExceedsLimit(Number(rows[0]?.count ?? 1), SUBMIT_RATE_LIMIT_PER_HOUR)) {
    await logAudit("dsar_edge_rate_limited", "citizen_requests", null, null, { action });
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Submission rate limit reached. Please try again later.",
    });
  }
}

/**
 * Pause the DSAR response clock while representative/executor verification is
 * pending. No-op when a pause interval is already open (idempotent).
 */
async function pauseClock(client: PoolClient, requestId: number, reason: string): Promise<void> {
  await client.query(
    `INSERT INTO dsar_clock_pauses (request_id, paused_at, reason)
     SELECT $1, NOW(), $2
     WHERE NOT EXISTS (
       SELECT 1 FROM dsar_clock_pauses WHERE request_id = $1 AND resumed_at IS NULL
     )`,
    [requestId, reason],
  );
}

/**
 * Resume the response clock: close any open pause interval and push the
 * response deadline out by the total paused duration.
 */
async function resumeClock(requestId: number): Promise<void> {
  await exec(
    `WITH closed AS (
       UPDATE dsar_clock_pauses SET resumed_at = NOW()
       WHERE request_id = $1 AND resumed_at IS NULL
       RETURNING paused_at, resumed_at
     )
     UPDATE citizen_requests
     SET response_deadline = response_deadline + COALESCE((SELECT SUM(resumed_at - paused_at) FROM closed), interval '0'),
         updated_at = NOW()
     WHERE id = $1`,
    [requestId],
  );
}

/** Insert the base citizen_requests row inside an existing transaction. */
async function createBaseRequestTx(client: PoolClient, input: {
  requestType: string;
  citizenName: string;
  citizenEmail: string;
  citizenNin?: string;
  organizationId?: number;
  description: string;
  supportingDocUrl?: string;
}): Promise<{ id: number; referenceNumber: string }> {
  const seq = await client.query("SELECT nextval('citizen_requests_id_seq') AS id");
  const id = Number(seq.rows[0].id);
  const referenceNumber = `NDSEP-CR-${String(id).padStart(6, "0")}`;
  const responseDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await client.query(
    `INSERT INTO citizen_requests
       (id, citizen_name, citizen_email, citizen_nin, request_type, status,
        organization_id, description, reference_number, response_deadline,
        initial_response_deadline, supporting_doc_url, is_third_party, submitted_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'submitted',$6,$7,$8,$9,$9,$10,true,NOW(),NOW())`,
    [
      id, input.citizenName, encryptField(input.citizenEmail),
      input.citizenNin ? encryptField(input.citizenNin) : null,
      input.requestType, input.organizationId ?? null, input.description,
      referenceNumber, responseDeadline, input.supportingDocUrl ?? null,
    ]
  );
  return { id, referenceNumber };
}

/** Decrypt known PII columns on a row returned from a raw tx client. */
function decryptRow<T extends Record<string, any>>(row: T, cols: string[]): T {
  const out = { ...row };
  for (const c of cols) {
    if (typeof out[c] === "string") (out as any)[c] = decryptField(out[c]);
  }
  return out;
}

/**
 * Record a notification failure for retry (dsar_notification_retries) instead
 * of dropping it. Returns true when the notification was delivered.
 */
async function notifySubjectWithRetry(args: {
  requestId: number;
  kind: "refusal" | "extension";
  to: string;
  citizenName: string;
  requestType: string;
  requestRef: string;
  newStatus: string;
  message: string;
}): Promise<boolean> {
  try {
    const sent = await sendCitizenRequestUpdate({
      to: args.to,
      citizenName: args.citizenName,
      requestType: args.requestType,
      requestRef: args.requestRef,
      newStatus: args.newStatus,
      orgName: "NDPC / Data Controller",
      message: args.message,
    });
    if (sent) return true;
    throw new Error("email gateway reported failure");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, requestId: args.requestId, kind: args.kind }, "[dsarEdge] subject notification failed — queued for retry");
    await exec(
      `INSERT INTO dsar_notification_retries (request_id, kind, recipient, payload, last_error, next_retry_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + interval '1 hour')`,
      [
        args.requestId,
        args.kind,
        encryptField(args.to),
        JSON.stringify({
          citizenName: args.citizenName,
          requestType: args.requestType,
          requestRef: args.requestRef,
          newStatus: args.newStatus,
          message: args.message,
        }),
        msg.slice(0, 1000),
      ],
    );
    return false;
  }
}

export const dsarEdgeCasesRouter = router({
  // ─── Third-party / on-behalf submissions ─────────────────────────────────
  submitOnBehalf: publicProcedure
    .input(z.object({
      requestType: z.enum(["access", "rectification", "erasure", "portability", "restriction", "objection", "automated_decision"]),
      citizenName: z.string().min(2).max(256),
      citizenEmail: z.string().email(),
      citizenNin: z.string().optional(),
      organizationId: z.number().int().positive().optional(),
      description: z.string().min(10).max(5000),
      representativeName: z.string().min(2).max(256),
      representativeEmail: z.string().email(),
      representativePhone: z.string().max(32).optional(),
      relationship: z.enum(RELATIONSHIPS),
      authorityEvidenceDocUrl: z.string().url().optional(),
      authorityEvidenceDocKey: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!input.authorityEvidenceDocUrl && !input.authorityEvidenceDocKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Evidence of authority to act (e.g. letter of authority, guardianship order, power of attorney) is required.",
        });
      }
      await enforceIpRateLimit((ctx as any).req, "dsar.submitOnBehalf");

      // Base request + companion row + clock pause in ONE transaction.
      const pool = getPool();
      if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const client = await pool.connect();
      let base: { id: number; referenceNumber: string };
      let rep: any;
      try {
        await client.query("BEGIN");
        base = await createBaseRequestTx(client, input);
        const repRows = await client.query(
          `INSERT INTO dsar_third_party_submissions
             (request_id, representative_name, representative_email, representative_phone,
              relationship, authority_evidence_doc_url, authority_evidence_doc_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            base.id, encryptField(input.representativeName), encryptField(input.representativeEmail),
            input.representativePhone ? encryptField(input.representativePhone) : null, input.relationship,
            input.authorityEvidenceDocUrl ?? null, input.authorityEvidenceDocKey ?? null,
          ]
        );
        rep = decryptRow(repRows.rows[0], ["representative_name", "representative_email", "representative_phone"]);
        // Verification is pending: the response clock does not run until the
        // representative's authority is decided.
        await pauseClock(client, base.id, "representative_verification_pending");
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        logger.error({ err }, "[dsarEdge] submitOnBehalf failed");
        throw err instanceof TRPCError ? err : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Submission failed" });
      } finally {
        client.release();
      }
      await logAudit("dsar_third_party_submitted", "citizen_requests", base.id, null, {
        reference: base.referenceNumber, relationship: input.relationship,
      });
      fireAndForget("dsarEdgeCases.submitOnBehalf");
      return { ...base, thirdPartySubmission: rep };
    }),

  verifyRepresentative: staffProcedure
    .input(z.object({
      thirdPartySubmissionId: z.number().int().positive(),
      decision: z.enum(["verified", "rejected"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE dsar_third_party_submissions
         SET verification_status = $2, verified_by = $3, verified_at = NOW(), notes = $4, updated_at = NOW()
         WHERE id = $1 AND verification_status = 'pending' RETURNING *`,
        [input.thirdPartySubmissionId, input.decision, ctx.user.name ?? String(ctx.user.id), input.notes ?? null]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Submission not found or already verified" });
      // Verification concluded — resume the response clock (deadline is pushed
      // out by the paused interval) regardless of the decision.
      await resumeClock(row.request_id);
      // Rejected representatives cannot progress the underlying request
      if (input.decision === "rejected") {
        await exec(`UPDATE citizen_requests SET status = 'rejected', updated_at = NOW() WHERE id = $1`, [row.request_id]);
      }
      await logAudit("dsar_representative_verified", "dsar_third_party_submissions", input.thirdPartySubmissionId, String(ctx.user.id), { decision: input.decision });
      fireAndForget("dsarEdgeCases.verifyRepresentative");
      return row;
    }),

  listThirdPartySubmissions: protectedProcedure
    .input(z.object({ verificationStatus: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.verificationStatus) { params.push(input.verificationStatus); where = `WHERE t.verification_status = $${params.length}`; }
      return exec(
        `SELECT t.*, c.reference_number, c.request_type, c.status AS request_status, c.citizen_name
         FROM dsar_third_party_submissions t
         JOIN citizen_requests c ON c.id = t.request_id
         ${where} ORDER BY t.created_at DESC LIMIT 200`,
        params
      );
    }),

  // ─── Deceased data subjects ──────────────────────────────────────────────
  submitDeceasedSubjectRequest: publicProcedure
    .input(z.object({
      requestType: z.enum(["access", "rectification", "erasure", "portability", "restriction", "objection"]),
      deceasedName: z.string().min(2).max(256),
      deathCertificateRef: z.string().min(3).max(128),
      executorName: z.string().min(2).max(256),
      executorEmail: z.string().email(),
      executorContact: z.string().max(320).optional(),
      organizationId: z.number().int().positive().optional(),
      description: z.string().min(10).max(5000),
    }))
    .mutation(async ({ input, ctx }) => {
      await enforceIpRateLimit((ctx as any).req, "dsar.submitDeceased");

      const pool = getPool();
      if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const client = await pool.connect();
      let base: { id: number; referenceNumber: string };
      let deceased: any;
      try {
        await client.query("BEGIN");
        base = await createBaseRequestTx(client, {
          requestType: input.requestType,
          citizenName: input.deceasedName,
          citizenEmail: input.executorEmail,
          organizationId: input.organizationId,
          description: `[DECEASED DATA SUBJECT] ${input.description}`,
        });
        const rows = await client.query(
          `INSERT INTO dsar_deceased_subjects
             (request_id, deceased_name, death_certificate_ref, executor_name, executor_contact)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [base.id, encryptField(input.deceasedName), input.deathCertificateRef, encryptField(input.executorName), encryptField(input.executorContact ?? input.executorEmail)]
        );
        deceased = decryptRow(rows.rows[0], ["deceased_name", "executor_name", "executor_contact"]);
        // Executor verification pending: pause the response clock.
        await pauseClock(client, base.id, "executor_verification_pending");
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        logger.error({ err }, "[dsarEdge] submitDeceasedSubjectRequest failed");
        throw err instanceof TRPCError ? err : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Submission failed" });
      } finally {
        client.release();
      }
      await logAudit("dsar_deceased_submitted", "citizen_requests", base.id, null, { reference: base.referenceNumber });
      fireAndForget("dsarEdgeCases.submitDeceasedSubjectRequest");
      return { ...base, deceasedSubject: deceased };
    }),

  verifyExecutor: staffProcedure
    .input(z.object({
      deceasedSubjectId: z.number().int().positive(),
      decision: z.enum(["verified", "rejected"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE dsar_deceased_subjects
         SET executor_verification_status = $2, verified_by = $3, verified_at = NOW(), notes = $4, updated_at = NOW()
         WHERE id = $1 AND executor_verification_status = 'pending' RETURNING *`,
        [input.deceasedSubjectId, input.decision, ctx.user.name ?? String(ctx.user.id), input.notes ?? null]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Record not found or already verified" });
      // Executor verification concluded: resume the response clock.
      await resumeClock(row.request_id);
      if (input.decision === "rejected") {
        await exec(`UPDATE citizen_requests SET status = 'rejected', updated_at = NOW() WHERE id = $1`, [row.request_id]);
      }
      await logAudit("dsar_executor_verified", "dsar_deceased_subjects", input.deceasedSubjectId, String(ctx.user.id), { decision: input.decision });
      fireAndForget("dsarEdgeCases.verifyExecutor");
      return row;
    }),

  listDeceasedSubjects: protectedProcedure.query(async () => {
    return exec(
      `SELECT d.*, c.reference_number, c.request_type, c.status AS request_status
       FROM dsar_deceased_subjects d
       JOIN citizen_requests c ON c.id = d.request_id
       ORDER BY d.created_at DESC LIMIT 200`
    );
  }),

  // ─── Deadline extension (staff) ──────────────────────────────────────────
  /**
   * Extend the DSAR response deadline by up to 60 days (cumulative). The
   * extension is only lawful when the data subject is notified BEFORE the
   * initial response window expires, so this procedure refuses extensions
   * requested after the initial deadline and records the notification outcome
   * (failures are queued for retry, never dropped).
   */
  extendDeadline: staffProcedure
    .input(z.object({
      requestId: z.number().int().positive(),
      extensionDays: z.number().int().min(1).max(MAX_EXTENSION_DAYS_TOTAL),
      justification: z.string().min(20, "A written justification of at least 20 characters is mandatory"),
    }))
    .mutation(async ({ input, ctx }) => {
      const [req] = await exec(
        `SELECT id, reference_number, citizen_name, citizen_email, request_type, status,
                response_deadline, COALESCE(initial_response_deadline, response_deadline) AS initial_deadline,
                COALESCE(extension_days, 0) AS extension_days
         FROM citizen_requests WHERE id = $1`,
        [input.requestId],
      );
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "DSAR not found" });
      if (["completed", "rejected", "merged"].includes(req.status)) {
        throw new TRPCError({ code: "CONFLICT", message: `Request is already ${req.status}` });
      }
      // The initial response window must still be open — the subject can only
      // be lawfully notified of an extension before the original deadline.
      if (new Date(req.initial_deadline).getTime() <= Date.now()) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "The initial response window has expired; a deadline extension can no longer be granted (the subject must be notified within the initial window).",
        });
      }
      const used = Number(req.extension_days ?? 0);
      if (used + input.extensionDays > MAX_EXTENSION_DAYS_TOTAL) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Extension would exceed the ${MAX_EXTENSION_DAYS_TOTAL}-day maximum (${used} days already granted).`,
        });
      }
      const [updated] = await exec(
        `UPDATE citizen_requests
         SET response_deadline = response_deadline + ($2 || ' days')::interval,
             extension_days = COALESCE(extension_days, 0) + $2,
             extension_reason = $3, extended_at = NOW(), extension_notified_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 RETURNING id, reference_number, response_deadline, extension_days`,
        [input.requestId, input.extensionDays, input.justification],
      );
      const notified = await notifySubjectWithRetry({
        requestId: input.requestId,
        kind: "extension",
        to: req.citizen_email,
        citizenName: req.citizen_name ?? "Data Subject",
        requestType: req.request_type,
        requestRef: req.reference_number,
        newStatus: "in_progress",
        message: `The response deadline for your request has been extended by ${input.extensionDays} day(s) to ${new Date(updated.response_deadline).toISOString().slice(0, 10)}. Justification: ${input.justification}. ${APPEAL_POINTER}`,
      });
      await logAudit("dsar_deadline_extended", "citizen_requests", input.requestId, String(ctx.user.id), {
        extensionDays: input.extensionDays, totalExtensionDays: updated.extension_days, notified,
      });
      fireAndForget("dsarEdgeCases.extendDeadline");
      return { ...updated, subjectNotified: notified };
    }),

  // ─── Refusal / exemption workflow ────────────────────────────────────────
  refuseRequest: protectedProcedure
    .input(z.object({
      requestId: z.number().int().positive(),
      refusalGround: z.enum(["manifestly_unfounded", "manifestly_excessive", "exemption_applies"]),
      writtenJustification: z.string().min(20, "A written justification of at least 20 characters is mandatory"),
      exemptionBasis: z.string().max(256).optional(),
      feeCharged: z.number().min(0).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const req = await exec(`SELECT id, reference_number, citizen_name, citizen_email, request_type, status FROM citizen_requests WHERE id = $1`, [input.requestId]);
      if (!req[0]) throw new TRPCError({ code: "NOT_FOUND", message: "DSAR not found" });
      if (["completed", "rejected", "merged"].includes(req[0].status)) {
        throw new TRPCError({ code: "CONFLICT", message: `Request is already ${req[0].status}` });
      }
      const [refusal] = await exec(
        `INSERT INTO dsar_refusals
           (request_id, refusal_ground, written_justification, exemption_basis, fee_charged, appeal_pointer, refused_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.requestId, input.refusalGround, input.writtenJustification,
          input.exemptionBasis ?? null, input.feeCharged ?? null, APPEAL_POINTER,
          ctx.user.name ?? String(ctx.user.id),
        ]
      );
      await exec(`UPDATE citizen_requests SET status = 'rejected', response_notes = $2, updated_at = NOW() WHERE id = $1`,
        [input.requestId, `Refused (${input.refusalGround}): ${input.writtenJustification}`]);
      await logAudit("dsar_refused", "citizen_requests", input.requestId, String(ctx.user.id), { ground: input.refusalGround });
      // Notify the data subject. Failures are NOT swallowed: they are logged
      // at warn level and queued in dsar_notification_retries for re-send.
      if (req[0].citizen_email) {
        const notified = await notifySubjectWithRetry({
          requestId: input.requestId,
          kind: "refusal",
          to: req[0].citizen_email,
          citizenName: req[0].citizen_name ?? "Data Subject",
          requestType: req[0].request_type,
          requestRef: req[0].reference_number,
          newStatus: "rejected",
          message: `Your request was refused as ${input.refusalGround.replace(/_/g, " ")}. Justification: ${input.writtenJustification}. ${APPEAL_POINTER}`,
        });
        if (!notified) {
          await logAudit("dsar_refusal_notification_queued", "citizen_requests", input.requestId, String(ctx.user.id), {});
        }
      }
      fireAndForget("dsarEdgeCases.refuseRequest");
      return refusal;
    }),

  /** Staff: re-attempt queued subject notifications (refusal / extension). */
  retryFailedNotifications: staffProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
    .mutation(async ({ input, ctx }) => {
      const due = await exec(
        `SELECT * FROM dsar_notification_retries
         WHERE status = 'pending' AND next_retry_at <= NOW() AND attempts < 5
         ORDER BY next_retry_at ASC LIMIT $1`,
        [input?.limit ?? 25],
      );
      let sent = 0;
      let failed = 0;
      for (const row of due) {
        const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
        const to = decryptField(row.recipient) ?? "";
        try {
          const ok = await sendCitizenRequestUpdate({
            to,
            citizenName: payload.citizenName ?? "Data Subject",
            requestType: payload.requestType ?? "access",
            requestRef: payload.requestRef ?? "",
            newStatus: payload.newStatus ?? "in_progress",
            orgName: "NDPC / Data Controller",
            message: payload.message ?? "",
          });
          if (!ok) throw new Error("email gateway reported failure");
          await exec(`UPDATE dsar_notification_retries SET status = 'sent', attempts = attempts + 1, sent_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id]);
          sent++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await exec(
            `UPDATE dsar_notification_retries
             SET attempts = attempts + 1, last_error = $2,
                 next_retry_at = NOW() + (interval '1 hour' * (attempts + 1)),
                 status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END,
                 updated_at = NOW()
             WHERE id = $1`,
            [row.id, msg.slice(0, 1000)],
          );
          failed++;
        }
      }
      await logAudit("dsar_notifications_retried", "citizen_requests", null, String(ctx.user.id), { sent, failed, attempted: due.length });
      return { attempted: due.length, sent, failed };
    }),

  listRefusals: protectedProcedure
    .input(z.object({ requestId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.requestId) { params.push(input.requestId); where = `WHERE r.request_id = $${params.length}`; }
      return exec(
        `SELECT r.*, c.reference_number, c.request_type, c.citizen_name
         FROM dsar_refusals r JOIN citizen_requests c ON c.id = r.request_id
         ${where} ORDER BY r.refused_at DESC LIMIT 200`,
        params
      );
    }),

  markRefusalOverturned: protectedProcedure
    .input(z.object({ refusalId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE dsar_refusals SET status = 'overturned_on_appeal', updated_at = NOW()
         WHERE id = $1 AND status = 'issued' RETURNING *`,
        [input.refusalId]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Refusal not found or not in issued state" });
      // Reinstate the underlying request for processing
      await exec(`UPDATE citizen_requests SET status = 'in_progress', updated_at = NOW() WHERE id = $1`, [row.request_id]);
      await logAudit("dsar_refusal_overturned", "dsar_refusals", input.refusalId, String(ctx.user.id), {});
      fireAndForget("dsarEdgeCases.markRefusalOverturned");
      return row;
    }),

  // ─── Duplicate / competing request merging ───────────────────────────────
  linkRequests: protectedProcedure
    .input(z.object({
      requestId: z.number().int().positive(),
      relatedRequestId: z.number().int().positive(),
      linkType: z.enum(["duplicate", "competing", "related"]),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.requestId === input.relatedRequestId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot link a request to itself" });
      }
      const [row] = await exec(
        `INSERT INTO dsar_request_links (request_id, related_request_id, link_type)
         VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING RETURNING *`,
        [input.requestId, input.relatedRequestId, input.linkType]
      );
      await logAudit("dsar_requests_linked", "citizen_requests", input.requestId, String(ctx.user.id), {
        related: input.relatedRequestId, linkType: input.linkType,
      });
      fireAndForget("dsarEdgeCases.linkRequests");
      return row ?? { alreadyLinked: true };
    }),

  listLinkedRequests: protectedProcedure
    .input(z.object({ requestId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.requestId) { params.push(input.requestId); where = `WHERE l.request_id = $${params.length} OR l.related_request_id = $${params.length}`; }
      return exec(
        `SELECT l.*, a.reference_number AS request_ref, b.reference_number AS related_ref
         FROM dsar_request_links l
         JOIN citizen_requests a ON a.id = l.request_id
         JOIN citizen_requests b ON b.id = l.related_request_id
         ${where} ORDER BY l.created_at DESC LIMIT 200`,
        params
      );
    }),

  /** Merge duplicate requests into a surviving primary request */
  mergeRequests: protectedProcedure
    .input(z.object({
      primaryRequestId: z.number().int().positive(),
      duplicateRequestId: z.number().int().positive(),
      mergeNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.primaryRequestId === input.duplicateRequestId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot merge a request into itself" });
      }
      // 'merged' is its own lifecycle status (migration 0103) — the duplicate
      // was never answered, so marking it 'completed' would misstate the
      // statutory record.
      const [merged] = await exec(
        `UPDATE citizen_requests
         SET merged_into_request_id = $1, status = 'merged',
             response_notes = COALESCE(response_notes, '') || E'\nMerged into request #' || $1::text || '. ' || COALESCE($3, ''),
             updated_at = NOW()
         WHERE id = $2 AND merged_into_request_id IS NULL RETURNING *`,
        [input.primaryRequestId, input.duplicateRequestId, input.mergeNotes ?? null]
      );
      if (!merged) throw new TRPCError({ code: "CONFLICT", message: "Duplicate request not found or already merged" });
      await exec(
        `UPDATE dsar_request_links SET resolution = 'merged', resolved_by = $3, resolved_at = NOW()
         WHERE resolution = 'pending'
           AND ((request_id = $1 AND related_request_id = $2) OR (request_id = $2 AND related_request_id = $1))`,
        [input.primaryRequestId, input.duplicateRequestId, ctx.user.name ?? String(ctx.user.id)]
      );
      await logAudit("dsar_requests_merged", "citizen_requests", input.duplicateRequestId, String(ctx.user.id), {
        primary: input.primaryRequestId,
      });
      fireAndForget("dsarEdgeCases.mergeRequests");
      return merged;
    }),

  // ─── Redaction workflow (third-party rights) ─────────────────────────────
  proposeRedaction: protectedProcedure
    .input(z.object({
      requestId: z.number().int().positive(),
      documentRef: z.string().min(1),
      redactionReason: z.enum(["third_party_rights", "legal_privilege", "crime_prevention", "management_forecast"]),
      redactedPassages: z.array(z.object({
        passageRef: z.string(),
        thirdPartyIdentifier: z.string().optional(),
        rationale: z.string(),
      })).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      // Idempotency: an identical pending proposal for the same document is a
      // no-op — return the CURRENT state instead of inserting a duplicate.
      const existing = await exec(
        `SELECT * FROM dsar_redactions
         WHERE request_id = $1 AND document_ref = $2 AND status = 'pending_review'
         ORDER BY id DESC LIMIT 1`,
        [input.requestId, input.documentRef],
      );
      if (existing[0] && JSON.stringify(existing[0].redacted_passages) === JSON.stringify(input.redactedPassages)) {
        return { ...existing[0], idempotent: true };
      }
      const [row] = await exec(
        `INSERT INTO dsar_redactions (request_id, document_ref, redaction_reason, redacted_passages, proposed_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [input.requestId, input.documentRef, input.redactionReason, input.redactedPassages, ctx.user.name ?? String(ctx.user.id)]
      );
      await exec(
        `UPDATE citizen_requests SET redaction_status = 'pending_review', updated_at = NOW()
         WHERE id = $1 AND redaction_status = 'none'`,
        [input.requestId]
      );
      await logAudit("dsar_redaction_proposed", "dsar_redactions", row?.id, String(ctx.user.id), { reason: input.redactionReason });
      fireAndForget("dsarEdgeCases.proposeRedaction");
      return row;
    }),

  reviewRedaction: protectedProcedure
    .input(z.object({
      redactionId: z.number().int().positive(),
      decision: z.enum(["approved", "applied"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE dsar_redactions
         SET status = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status IN ('pending_review', 'approved') RETURNING *`,
        [input.redactionId, input.decision, ctx.user.name ?? String(ctx.user.id)]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Redaction not found or already applied" });
      if (input.decision === "applied") {
        await exec(`UPDATE citizen_requests SET redaction_status = 'applied', updated_at = NOW() WHERE id = $1`, [row.request_id]);
      }
      await logAudit("dsar_redaction_reviewed", "dsar_redactions", input.redactionId, String(ctx.user.id), { decision: input.decision });
      fireAndForget("dsarEdgeCases.reviewRedaction");
      return row;
    }),

  listRedactions: protectedProcedure
    .input(z.object({ requestId: z.number().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.requestId) { params.push(input.requestId); conditions.push(`r.request_id = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`r.status = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT r.*, c.reference_number
         FROM dsar_redactions r JOIN citizen_requests c ON c.id = r.request_id
         ${where} ORDER BY r.created_at DESC LIMIT 200`,
        params
      );
    }),

  /** Combined edge-case view for a single DSAR */
  getEdgeCaseDetail: protectedProcedure
    .input(z.object({ requestId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [thirdParty, deceased, refusals, links, redactions, clockPauses] = await Promise.all([
        exec(`SELECT * FROM dsar_third_party_submissions WHERE request_id = $1`, [input.requestId]),
        exec(`SELECT * FROM dsar_deceased_subjects WHERE request_id = $1`, [input.requestId]),
        exec(`SELECT * FROM dsar_refusals WHERE request_id = $1`, [input.requestId]),
        exec(`SELECT * FROM dsar_request_links WHERE request_id = $1 OR related_request_id = $1`, [input.requestId]),
        exec(`SELECT * FROM dsar_redactions WHERE request_id = $1`, [input.requestId]),
        exec(`SELECT * FROM dsar_clock_pauses WHERE request_id = $1 ORDER BY paused_at ASC`, [input.requestId]),
      ]);
      return {
        thirdParty: thirdParty[0] ?? null,
        deceased: deceased[0] ?? null,
        refusals,
        links,
        redactions,
        clockPauses,
      };
    }),
});
