/**
 * Consent Propagation Router (Gap 17)
 * Purpose-by-purpose withdrawal propagation: consent purpose registry,
 * withdrawal events, downstream processor tracking, token-based public
 * acknowledgment with proof references, and overdue-ack escalation reports.
 */
import { z } from "zod";
import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { logAuditEvent } from "../middlewareHelpers";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField } from "../encryption";

/** SHA-256 hex digest — used for ack-token-at-rest and subject lookup hashes. */
function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
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
    return autoDecryptRows(query, result.rows ?? []);
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[consent-prop] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

export const consentPropagationRouter = router({
  // ─── Consent purposes registry ──────────────────────────────────────────
  listPurposes: protectedProcedure
    .input(z.object({ organizationId: z.number().int(), activeOnly: z.boolean().default(true) }))
    .query(async ({ input }) => {
      return exec(
        `SELECT p.*,
           (SELECT COUNT(*) FROM downstream_processors dp WHERE dp.purpose_id = p.id AND dp.is_active) as processor_count,
           (SELECT COUNT(*) FROM withdrawal_events we WHERE we.purpose_id = p.id) as withdrawal_count
         FROM consent_purposes p
         WHERE p.organization_id = $1 ${input.activeOnly ? "AND p.is_active" : ""}
         ORDER BY p.created_at DESC`,
        [input.organizationId]
      );
    }),

  createPurpose: protectedProcedure
    .input(z.object({
      organizationId: z.number().int(),
      purposeKey: z.string().min(2).max(64).regex(/^[a-z0-9_]+$/, "lowercase snake_case key"),
      name: z.string().min(2).max(256),
      description: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `INSERT INTO consent_purposes (organization_id, purpose_key, name, description)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (organization_id, purpose_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true, updated_at = NOW()
         RETURNING *`,
        [input.organizationId, input.purposeKey, input.name, input.description ?? null]
      );
      await logAuditEvent("consent_prop.purpose_created", "consent_purpose", rows[0]?.id ?? "", String((ctx as any).user?.id ?? ""), { purposeKey: input.purposeKey });
      return rows[0];
    }),

  deactivatePurpose: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(`UPDATE consent_purposes SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`, [input.id]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Purpose not found." });
      await logAuditEvent("consent_prop.purpose_deactivated", "consent_purpose", input.id, String((ctx as any).user?.id ?? ""), {});
      return { success: true };
    }),

  // ─── Downstream processors per purpose ──────────────────────────────────
  listProcessors: protectedProcedure
    .input(z.object({ purposeId: z.number().int() }))
    .query(async ({ input }) => {
      return exec(`SELECT * FROM downstream_processors WHERE purpose_id = $1 ORDER BY created_at DESC`, [input.purposeId]);
    }),

  registerProcessor: protectedProcedure
    .input(z.object({
      purposeId: z.number().int(),
      processorName: z.string().min(2).max(256),
      contactEmail: z.string().email(),
      ackEndpointUrl: z.string().url().optional(),
      slaHours: z.number().int().min(1).max(720).default(72),
    }))
    .mutation(async ({ input, ctx }) => {
      const purposes = await exec(`SELECT id FROM consent_purposes WHERE id = $1`, [input.purposeId]);
      if (!purposes[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Purpose not found." });
      const rows = await exec(
        `INSERT INTO downstream_processors (purpose_id, processor_name, contact_email, ack_endpoint_url, sla_hours)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [input.purposeId, input.processorName, input.contactEmail, input.ackEndpointUrl ?? null, input.slaHours]
      );
      await logAuditEvent("consent_prop.processor_registered", "downstream_processor", rows[0]?.id ?? "", String((ctx as any).user?.id ?? ""), { purposeId: input.purposeId });
      return rows[0];
    }),

  // ─── Withdrawal events + fan-out to propagation records ─────────────────
  recordWithdrawal: protectedProcedure
    .input(z.object({
      purposeId: z.number().int(),
      subjectRef: z.string().min(2).max(256),
      consentRecordId: z.number().int().optional(),
      reason: z.string().max(2000).optional(),
      initiatedBy: z.enum(["subject", "org", "regulator"]).default("subject"),
    }))
    .mutation(async ({ input, ctx }) => {
      const purposes = await exec(`SELECT * FROM consent_purposes WHERE id = $1 AND is_active = true`, [input.purposeId]);
      if (!purposes[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Active purpose not found." });
      // subject_ref is PII: stored encrypted (encryptField / PII_FIELDS), with
      // a deterministic SHA-256 lookup hash alongside it (random-IV ciphertext
      // is not equality-searchable).
      const subjectRefHash = sha256Hex(input.subjectRef.trim().toLowerCase());
      // Withdrawal idempotency: the same subject withdrawing the same purpose
      // on the same day returns the existing event instead of duplicating the
      // downstream fan-out.
      const dupe = await exec(
        `SELECT * FROM withdrawal_events
         WHERE purpose_id = $1 AND subject_ref_hash = $2 AND withdrawn_at::date = CURRENT_DATE
         ORDER BY id DESC LIMIT 1`,
        [input.purposeId, subjectRefHash]
      );
      if (dupe[0]) {
        return { event: dupe[0], processorsNotified: 0, ackTokens: [], idempotent: true };
      }
      const events = await exec(
        `INSERT INTO withdrawal_events (purpose_id, organization_id, subject_ref, subject_ref_hash, consent_record_id, reason, initiated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [input.purposeId, purposes[0].organization_id, encryptField(input.subjectRef), subjectRefHash, input.consentRecordId ?? null,
         input.reason ?? null, input.initiatedBy]
      );
      const event = events[0];
      // Fan out: one propagation record per active downstream processor.
      // The raw ack token is returned to the caller EXACTLY ONCE (for secure
      // out-of-band delivery to the processor); only its SHA-256 hash is
      // persisted, so a database leak does not expose usable ack tokens.
      const processors = await exec(`SELECT * FROM downstream_processors WHERE purpose_id = $1 AND is_active = true`, [input.purposeId]);
      const ackTokens: Array<{ processorId: number; processorName: string; ackToken: string }> = [];
      for (const proc of processors) {
        const rawToken = crypto.randomBytes(24).toString("hex");
        await exec(
          `INSERT INTO propagation_records (withdrawal_event_id, processor_id, ack_token)
           VALUES ($1,$2,$3)
           ON CONFLICT (withdrawal_event_id, processor_id) DO NOTHING`,
          [event.id, proc.id, sha256Hex(rawToken)]
        );
        ackTokens.push({ processorId: proc.id, processorName: proc.processor_name, ackToken: rawToken });
      }
      // Optionally link back to the canonical consent_records row
      if (input.consentRecordId) {
        await exec(`UPDATE consent_records SET consent_status = 'withdrawn', consent_withdrawn_at = NOW(), updated_at = NOW() WHERE id = $1`, [input.consentRecordId]);
      }
      await logAuditEvent("consent_prop.withdrawal_recorded", "withdrawal_event", event?.id ?? "", String((ctx as any).user?.id ?? ""), { purposeId: input.purposeId, subjectRefHash, processors: processors.length });
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "consent_withdrawal_propagation", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { event, processorsNotified: processors.length, ackTokens };
    }),

  listWithdrawals: protectedProcedure
    .input(z.object({ purposeId: z.number().int().optional(), organizationId: z.number().int().optional() }))
    .query(async ({ input }) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.purposeId) { params.push(input.purposeId); conds.push(`we.purpose_id = $${params.length}`); }
      if (input.organizationId) { params.push(input.organizationId); conds.push(`we.organization_id = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      return exec(
        `SELECT we.*, p.name as purpose_name, p.purpose_key,
           (SELECT COUNT(*) FROM propagation_records pr WHERE pr.withdrawal_event_id = we.id) as propagation_total,
           (SELECT COUNT(*) FROM propagation_records pr WHERE pr.withdrawal_event_id = we.id AND pr.status = 'acknowledged') as propagation_acked
         FROM withdrawal_events we
         JOIN consent_purposes p ON we.purpose_id = p.id
         ${where} ORDER BY we.withdrawn_at DESC LIMIT 200`,
        params
      );
    }),

  // ─── Propagation records: notify + acknowledge ──────────────────────────
  listPropagationRecords: protectedProcedure
    .input(z.object({ withdrawalEventId: z.number().int().optional(), status: z.string().optional() }))
    .query(async ({ input }) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.withdrawalEventId) { params.push(input.withdrawalEventId); conds.push(`pr.withdrawal_event_id = $${params.length}`); }
      if (input.status) { params.push(input.status); conds.push(`pr.status = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const rows = await exec(
        `SELECT pr.id, pr.withdrawal_event_id, pr.status, pr.notified_at, pr.acked_at, pr.proof_ref,
                pr.notification_channel, pr.created_at, pr.updated_at,
                dp.processor_name, dp.contact_email, dp.sla_hours,
                CASE WHEN pr.acked_at IS NULL AND pr.notified_at IS NOT NULL
                          AND pr.notified_at + (dp.sla_hours || ' hours')::interval < NOW()
                     THEN true ELSE false END as ack_overdue
         FROM propagation_records pr
         JOIN downstream_processors dp ON pr.processor_id = dp.id
         ${where} ORDER BY pr.created_at DESC LIMIT 500`,
        params
      );
      // Never leak ack tokens on list endpoints
      return rows;
    }),

  /**
   * Mark a propagation record as notified, performing a real dispatch: when
   * the processor registered an ack_endpoint_url we POST the withdrawal
   * notification to it (best-effort, 5s timeout, HTTP status recorded). When
   * no URL is configured the record is still marked notified with a note so
   * the SLA clock runs from the manual/email notification. Dispatch failures
   * never block the state transition — they are recorded for retry/review.
   */
  markNotified: protectedProcedure
    .input(z.object({ id: z.number().int(), channel: z.enum(["email", "webhook", "manual"]) }))
    .mutation(async ({ input, ctx }) => {
      const found = await exec(
        `SELECT pr.id, pr.withdrawal_event_id, pr.status, dp.processor_name, dp.ack_endpoint_url
         FROM propagation_records pr
         JOIN downstream_processors dp ON dp.id = pr.processor_id
         WHERE pr.id = $1`,
        [input.id]
      );
      const rec = found[0];
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Propagation record not found." });
      if (!["pending", "notified"].includes(rec.status)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Propagation record not found or already acknowledged." });
      }
      let dispatchStatus: number | null = null;
      let dispatchNote: string | null = null;
      if (rec.ack_endpoint_url) {
        try {
          const res = await fetch(rec.ack_endpoint_url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              type: "consent.withdrawal",
              withdrawalEventId: rec.withdrawal_event_id,
              propagationRecordId: rec.id,
              notifiedAt: new Date().toISOString(),
            }),
            signal: AbortSignal.timeout(5_000),
          });
          dispatchStatus = res.status;
          if (!res.ok) dispatchNote = `Downstream ack endpoint responded HTTP ${res.status}`;
        } catch (err) {
          dispatchNote = `Dispatch failed (best-effort): ${err instanceof Error ? err.message : String(err)}`;
          logger.warn({ err, recordId: input.id }, "[consent-prop] Processor dispatch failed; marking notified anyway");
        }
      } else {
        dispatchNote = "No ack_endpoint_url configured; notification handled out-of-band";
      }
      const rows = await exec(
        `UPDATE propagation_records
         SET status = 'notified', notified_at = NOW(), notification_channel = $1,
             last_dispatch_status = $2, last_dispatch_note = $3, updated_at = NOW()
         WHERE id = $4 AND status IN ('pending','notified') RETURNING id`,
        [input.channel, dispatchStatus, dispatchNote, input.id]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Propagation record not found or already acknowledged." });
      await logAuditEvent("consent_prop.processor_notified", "propagation_record", input.id, String((ctx as any).user?.id ?? ""), { channel: input.channel, dispatchStatus, dispatchNote });
      return { success: true, dispatchStatus, dispatchNote };
    }),

  /** Public, token-based: processor acknowledges the withdrawal with proof */
  acknowledgeByToken: publicProcedure
    .input(z.object({
      ackToken: z.string().min(32).max(128),
      proofRef: z.string().min(4).max(1024), // reference to deletion/cessation proof
    }))
    .mutation(async ({ input }) => {
      // Tokens are stored as SHA-256 hashes at rest; the plaintext form is
      // also accepted for legacy rows created before hashing was introduced.
      const rows = await exec(
        `UPDATE propagation_records SET status = 'acknowledged', acked_at = NOW(), proof_ref = $1, updated_at = NOW()
         WHERE (ack_token = $2 OR ack_token = $3) AND status IN ('pending','notified','overdue')
         RETURNING id, withdrawal_event_id, processor_id`,
        [input.proofRef, sha256Hex(input.ackToken), input.ackToken]
      );
      if (!rows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid acknowledgment token or withdrawal already acknowledged." });
      }
      await logAuditEvent("consent_prop.processor_acknowledged", "propagation_record", rows[0].id, "public-token", { withdrawalEventId: rows[0].withdrawal_event_id, processorId: rows[0].processor_id });
      return { success: true, acknowledgedAt: new Date().toISOString() };
    }),

  /** Sweep: flag notified-but-unacked records past SLA as overdue */
  flagOverdue: adminProcedure.mutation(async ({ ctx }) => {
    const rows = await exec(
      `UPDATE propagation_records pr SET status = 'overdue', updated_at = NOW()
       FROM downstream_processors dp
       WHERE pr.processor_id = dp.id
         AND pr.status = 'notified'
         AND pr.notified_at + (dp.sla_hours || ' hours')::interval < NOW()
       RETURNING pr.id`
    );
    await logAuditEvent("consent_prop.overdue_flagged", "propagation_record", "", String((ctx as any).user?.id ?? ""), { count: rows.length });
    return { flagged: rows.length };
  }),

  /** Overdue-ack escalation report */
  overdueAckReport: protectedProcedure.query(async () => {
    const byProcessor = await exec(
      `SELECT dp.id as processor_id, dp.processor_name, dp.contact_email, dp.sla_hours,
              p.name as purpose_name, p.purpose_key, o.name as org_name,
              COUNT(*) as overdue_count,
              MIN(pr.notified_at) as oldest_notification,
              MAX(EXTRACT(EPOCH FROM (NOW() - (pr.notified_at + (dp.sla_hours || ' hours')::interval))) / 3600)::int as max_hours_overdue
       FROM propagation_records pr
       JOIN downstream_processors dp ON pr.processor_id = dp.id
       JOIN consent_purposes p ON dp.purpose_id = p.id
       JOIN organizations o ON p.organization_id = o.id
       WHERE pr.status IN ('notified','overdue')
         AND pr.notified_at + (dp.sla_hours || ' hours')::interval < NOW()
       GROUP BY dp.id, dp.processor_name, dp.contact_email, dp.sla_hours, p.name, p.purpose_key, o.name
       ORDER BY overdue_count DESC, max_hours_overdue DESC`
    );
    const [totals] = await exec(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'acknowledged') as acknowledged,
         COUNT(*) FILTER (WHERE status IN ('pending','notified')) as in_flight,
         COUNT(*) FILTER (WHERE status IN ('notified','overdue')
           AND notified_at + ((SELECT sla_hours FROM downstream_processors WHERE id = processor_id) || ' hours')::interval < NOW()) as overdue
       FROM propagation_records`
    );
    return { totals: totals ?? {}, byProcessor };
  }),
});
