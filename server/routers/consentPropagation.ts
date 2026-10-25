/**
 * Consent Propagation Router (Gap 17)
 * Purpose-by-purpose withdrawal propagation: consent purpose registry,
 * withdrawal events, downstream processor tracking, token-based public
 * acknowledgment with proof references, and overdue-ack escalation reports.
 *
 * Round-9 remediation:
 *   - Org scoping: recordWithdrawal / createPurpose / registerProcessor /
 *     deactivatePurpose verify the caller's organisation matches the target
 *     row (org_admin callers are confined to their own organization_id).
 *   - SSRF hardening on markNotified: ack_endpoint_url must be https with a
 *     public hostname (no RFC1918/loopback/link-local, no credentials; DNS is
 *     resolved and every resolved address is checked at registration AND at
 *     dispatch time).
 *   - Dispatch failures set status 'failed' with retry metadata — the record
 *     is NOT marked 'notified' and the SLA clock only starts on a confirmed
 *     dispatch. retryFailedDispatches re-attempts outbox-style.
 *   - subject_ref_hash is a KEYED HMAC (env SUBJECT_HMAC_KEY, fail-closed in
 *     production); legacy SHA-256 rows are matched and lazily upgraded.
 *   - acknowledgeByToken matches ONLY the hashed token (plaintext fallback
 *     removed; migration 0103 hashes legacy rows). reissueAckToken (admin)
 *     rotates a token for unacknowledged records.
 *   - NDPA s.35 withdrawal parity: public self-service withdrawal via a
 *     signed one-time token link (createWithdrawalLink / withdrawByToken).
 */
import { z } from "zod";
import crypto from "crypto";
import { promises as dns } from "dns";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { logAuditEvent } from "../middlewareHelpers";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField } from "../encryption";
import {
  sha256Hex,
  hmacSha256Hex,
  requireHmacKey,
  validateOutboundUrl,
  assertPublicHostname,
} from "../services/complaintLogic";

const SUBJECT_HMAC_KEY = process.env.SUBJECT_HMAC_KEY ?? "";
if (!SUBJECT_HMAC_KEY) {
  logger.warn("[consent-prop] SUBJECT_HMAC_KEY is not set — subject_ref hashes use a dev-only key outside production. Set SUBJECT_HMAC_KEY.");
}

/** Keyed HMAC of the normalized subject ref; fail-closed in production. */
function subjectRefHash(subjectRef: string): string {
  const { key } = requireHmacKey(SUBJECT_HMAC_KEY, "SUBJECT_HMAC_KEY", { devSeed: "consent-prop-subject" });
  return hmacSha256Hex(key, subjectRef.trim().toLowerCase());
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

/**
 * Org scoping: org_admin callers may only touch their own organisation's
 * consent propagation data; platform roles (admin / government_staff /
 * auditor) are cross-org by design.
 */
function assertOrgScope(ctx: any, organizationId: number): void {
  const role = ctx?.user?.role;
  if (role === "org_admin" || role === "user") {
    const userOrg = ctx?.user?.organizationId ?? ctx?.user?.organization_id ?? null;
    if (userOrg == null || Number(userOrg) !== Number(organizationId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not authorised for this organisation." });
    }
  }
}

/** DNS lookup adapter (injectable for tests). */
const dnsLookup = async (hostname: string) => {
  const res = await dns.lookup(hostname, { all: true, verbatim: true });
  return res.map((r) => ({ address: r.address, family: r.family }));
};

/**
 * Full SSRF validation for an outbound ack endpoint: synchronous URL rules
 * plus a live DNS check that every resolved address is public.
 */
async function assertSafeAckEndpoint(rawUrl: string): Promise<void> {
  const sync = validateOutboundUrl(rawUrl);
  if (!sync.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `ack_endpoint_url rejected: ${sync.reason}` });
  }
  const dnsCheck = await assertPublicHostname(sync.hostname as string, dnsLookup);
  if (!dnsCheck.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `ack_endpoint_url rejected: ${dnsCheck.reason}` });
  }
}

export const consentPropagationRouter = router({
  // ─── Consent purposes registry ──────────────────────────────────────────
  listPurposes: protectedProcedure
    .input(z.object({ organizationId: z.number().int(), activeOnly: z.boolean().default(true) }))
    .query(async ({ input, ctx }) => {
      assertOrgScope(ctx, input.organizationId);
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
      assertOrgScope(ctx, input.organizationId);
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
      const purpose = await exec(`SELECT id, organization_id FROM consent_purposes WHERE id = $1`, [input.id]);
      if (!purpose[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Purpose not found." });
      assertOrgScope(ctx, Number(purpose[0].organization_id));
      const rows = await exec(`UPDATE consent_purposes SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`, [input.id]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Purpose not found." });
      await logAuditEvent("consent_prop.purpose_deactivated", "consent_purpose", input.id, String((ctx as any).user?.id ?? ""), {});
      return { success: true };
    }),

  // ─── Downstream processors per purpose ──────────────────────────────────
  listProcessors: protectedProcedure
    .input(z.object({ purposeId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const purpose = await exec(`SELECT organization_id FROM consent_purposes WHERE id = $1`, [input.purposeId]);
      if (purpose[0]) assertOrgScope(ctx, Number(purpose[0].organization_id));
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
      const purposes = await exec(`SELECT id, organization_id FROM consent_purposes WHERE id = $1`, [input.purposeId]);
      if (!purposes[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Purpose not found." });
      assertOrgScope(ctx, Number(purposes[0].organization_id));
      // SSRF: validate the ack endpoint at registration time (https only,
      // public hostname, DNS-resolved addresses all public).
      if (input.ackEndpointUrl) {
        await assertSafeAckEndpoint(input.ackEndpointUrl);
      }
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
      const organizationId = Number(purposes[0].organization_id);
      assertOrgScope(ctx, organizationId);

      // If a consent record is linked, it MUST belong to the same organisation
      // (prevents cross-org consent records being withdrawn through this path).
      if (input.consentRecordId != null) {
        const cr = await exec(`SELECT id, organization_id FROM consent_records WHERE id = $1`, [input.consentRecordId]);
        if (!cr[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Consent record not found." });
        if (Number(cr[0].organization_id) !== organizationId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Consent record belongs to a different organisation." });
        }
      }

      // subject_ref is PII: stored encrypted (encryptField / PII_FIELDS), with
      // a keyed HMAC alongside for equality lookups (random-IV ciphertext is
      // not equality-searchable). Legacy rows used an unkeyed SHA-256; they
      // are matched and lazily upgraded to the keyed form.
      const keyedHash = subjectRefHash(input.subjectRef);
      const legacyHash = sha256Hex(input.subjectRef.trim().toLowerCase());
      // Withdrawal idempotency: the same subject withdrawing the same purpose
      // on the same day returns the existing event instead of duplicating the
      // downstream fan-out.
      const dupe = await exec(
        `SELECT * FROM withdrawal_events
         WHERE purpose_id = $1 AND subject_ref_hash IN ($2, $3) AND withdrawn_at::date = CURRENT_DATE
         ORDER BY id DESC LIMIT 1`,
        [input.purposeId, keyedHash, legacyHash]
      );
      if (dupe[0]) {
        if (dupe[0].subject_ref_hash !== keyedHash) {
          await exec(`UPDATE withdrawal_events SET subject_ref_hash = $1 WHERE id = $2`, [keyedHash, dupe[0].id]);
        }
        return { event: dupe[0], processorsNotified: 0, ackTokens: [], idempotent: true };
      }

      // Fan out atomically: withdrawal event + one propagation record per
      // active processor + consent_records link update in ONE transaction.
      // The propagation rows themselves are the outbox: they start 'pending'
      // and carry retry metadata (retry_count / next_retry_at) for
      // dispatch-failure replays via retryFailedDispatches.
      const pool = getPool();
      if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const client = await pool.connect();
      let event: any;
      const ackTokens: Array<{ processorId: number; processorName: string; ackToken: string }> = [];
      let processorCount = 0;
      try {
        await client.query("BEGIN");
        const events = await client.query(
          `INSERT INTO withdrawal_events (purpose_id, organization_id, subject_ref, subject_ref_hash, consent_record_id, reason, initiated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [input.purposeId, organizationId, encryptField(input.subjectRef), keyedHash, input.consentRecordId ?? null,
           input.reason ?? null, input.initiatedBy]
        );
        event = events.rows[0];
        const processors = await client.query(
          `SELECT * FROM downstream_processors WHERE purpose_id = $1 AND is_active = true`,
          [input.purposeId],
        );
        processorCount = processors.rows.length;
        // The raw ack token is returned to the caller EXACTLY ONCE (for secure
        // out-of-band delivery to the processor); only its SHA-256 hash is
        // persisted, so a database leak does not expose usable ack tokens.
        for (const proc of processors.rows) {
          const rawToken = crypto.randomBytes(24).toString("hex");
          await client.query(
            `INSERT INTO propagation_records (withdrawal_event_id, processor_id, ack_token)
             VALUES ($1,$2,$3)
             ON CONFLICT (withdrawal_event_id, processor_id) DO NOTHING`,
            [event.id, proc.id, sha256Hex(rawToken)]
          );
          ackTokens.push({ processorId: proc.id, processorName: proc.processor_name, ackToken: rawToken });
        }
        if (input.consentRecordId) {
          await client.query(
            `UPDATE consent_records SET consent_status = 'withdrawn', consent_withdrawn_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [input.consentRecordId],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        logger.error({ err, purposeId: input.purposeId }, "[consent-prop] withdrawal fan-out failed");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Withdrawal could not be recorded; nothing was persisted." });
      } finally {
        client.release();
      }
      await logAuditEvent("consent_prop.withdrawal_recorded", "withdrawal_event", event?.id ?? "", String((ctx as any).user?.id ?? ""), { purposeId: input.purposeId, subjectRefHash: keyedHash, processors: processorCount });
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "consent_withdrawal_propagation", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { event, processorsNotified: processorCount, ackTokens };
    }),

  listWithdrawals: protectedProcedure
    .input(z.object({ purposeId: z.number().int().optional(), organizationId: z.number().int().optional() }))
    .query(async ({ input, ctx }) => {
      if (input.organizationId) assertOrgScope(ctx, input.organizationId);
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
                pr.notification_channel, pr.retry_count, pr.next_retry_at, pr.created_at, pr.updated_at,
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
   * Mark a propagation record as notified, performing a real dispatch. The
   * ack endpoint is re-validated at dispatch time (DNS re-resolution) so a
   * hostname that was public at registration but now resolves privately is
   * refused. On dispatch failure the record goes to 'failed' with retry
   * metadata — NOT 'notified' — so the acknowledgement SLA clock only starts
   * on a confirmed dispatch.
   */
  markNotified: protectedProcedure
    .input(z.object({ id: z.number().int(), channel: z.enum(["email", "webhook", "manual"]) }))
    .mutation(async ({ input, ctx }) => {
      const found = await exec(
        `SELECT pr.id, pr.withdrawal_event_id, pr.status, dp.processor_name, dp.ack_endpoint_url,
                p.organization_id
         FROM propagation_records pr
         JOIN downstream_processors dp ON dp.id = pr.processor_id
         JOIN consent_purposes p ON p.id = dp.purpose_id
         WHERE pr.id = $1`,
        [input.id]
      );
      const rec = found[0];
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Propagation record not found." });
      assertOrgScope(ctx, Number(rec.organization_id));
      if (!["pending", "failed"].includes(rec.status)) {
        throw new TRPCError({ code: "CONFLICT", message: "Propagation record already notified or acknowledged." });
      }
      let dispatchStatus: number | null = null;
      let dispatchNote: string | null = null;
      let dispatchOk = false;
      if (rec.ack_endpoint_url) {
        try {
          // SSRF defense-in-depth at dispatch time (DNS re-resolution).
          await assertSafeAckEndpoint(rec.ack_endpoint_url);
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
          dispatchOk = res.ok;
          if (!res.ok) dispatchNote = `Downstream ack endpoint responded HTTP ${res.status}`;
        } catch (err) {
          dispatchNote = `Dispatch failed: ${err instanceof Error ? err.message : String(err)}`;
          logger.warn({ err, recordId: input.id }, "[consent-prop] Processor dispatch failed; record stays un-notified and is queued for retry");
        }
      } else {
        // No endpoint configured: manual/email notification, confirmed by the
        // staff action itself — SLA clock starts now.
        dispatchOk = true;
        dispatchNote = "No ack_endpoint_url configured; notification handled out-of-band";
      }

      if (!dispatchOk) {
        // Failed: park for outbox-style retry. SLA clock does NOT start.
        await exec(
          `UPDATE propagation_records
           SET status = 'failed', last_dispatch_status = $2, last_dispatch_note = $3,
               retry_count = COALESCE(retry_count, 0) + 1,
               next_retry_at = NOW() + (interval '1 hour' * (COALESCE(retry_count, 0) + 1)),
               notification_channel = $1, updated_at = NOW()
           WHERE id = $4 AND status IN ('pending','failed')`,
          [input.channel, dispatchStatus, dispatchNote, input.id]
        );
        await logAuditEvent("consent_prop.processor_dispatch_failed", "propagation_record", input.id, String((ctx as any).user?.id ?? ""), { channel: input.channel, dispatchStatus, dispatchNote });
        return { success: false, status: "failed", dispatchStatus, dispatchNote };
      }

      const rows = await exec(
        `UPDATE propagation_records
         SET status = 'notified', notified_at = NOW(), notification_channel = $1,
             last_dispatch_status = $2, last_dispatch_note = $3, updated_at = NOW()
         WHERE id = $4 AND status IN ('pending','failed') RETURNING id`,
        [input.channel, dispatchStatus, dispatchNote, input.id]
      );
      if (!rows[0]) throw new TRPCError({ code: "CONFLICT", message: "Propagation record state changed concurrently." });
      await logAuditEvent("consent_prop.processor_notified", "propagation_record", input.id, String((ctx as any).user?.id ?? ""), { channel: input.channel, dispatchStatus, dispatchNote });
      return { success: true, status: "notified", dispatchStatus, dispatchNote };
    }),

  /** Outbox-style replay of failed dispatch attempts whose retry time is due. */
  retryFailedDispatches: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
    .mutation(async ({ ctx }) => {
      const due = await exec(
        `SELECT pr.id, pr.withdrawal_event_id, dp.ack_endpoint_url
         FROM propagation_records pr
         JOIN downstream_processors dp ON dp.id = pr.processor_id
         WHERE pr.status = 'failed'
           AND COALESCE(pr.next_retry_at, NOW()) <= NOW()
           AND COALESCE(pr.retry_count, 0) < 5
         ORDER BY pr.next_retry_at ASC NULLS FIRST LIMIT $1`,
        [25],
      );
      let notified = 0;
      let stillFailed = 0;
      for (const rec of due) {
        if (!rec.ack_endpoint_url) {
          // Manual channel: cannot be retried automatically.
          continue;
        }
        let ok = false;
        let status: number | null = null;
        let note: string | null = null;
        try {
          await assertSafeAckEndpoint(rec.ack_endpoint_url);
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
          ok = res.ok;
          status = res.status;
          if (!res.ok) note = `HTTP ${res.status}`;
        } catch (err) {
          note = err instanceof Error ? err.message : String(err);
        }
        if (ok) {
          await exec(
            `UPDATE propagation_records SET status = 'notified', notified_at = NOW(), last_dispatch_status = $2,
                    last_dispatch_note = NULL, updated_at = NOW() WHERE id = $1 AND status = 'failed'`,
            [rec.id, status],
          );
          notified++;
        } else {
          await exec(
            `UPDATE propagation_records SET retry_count = COALESCE(retry_count, 0) + 1,
                    next_retry_at = NOW() + (interval '1 hour' * (COALESCE(retry_count, 0) + 1)),
                    last_dispatch_status = $2, last_dispatch_note = $3, updated_at = NOW()
             WHERE id = $1 AND status = 'failed'`,
            [rec.id, status, note],
          );
          stillFailed++;
        }
      }
      await logAuditEvent("consent_prop.dispatch_retried", "propagation_record", "", String((ctx as any).user?.id ?? ""), { attempted: due.length, notified, stillFailed });
      return { attempted: due.length, notified, stillFailed };
    }),

  /** Public, token-based: processor acknowledges the withdrawal with proof */
  acknowledgeByToken: publicProcedure
    .input(z.object({
      ackToken: z.string().min(32).max(128),
      proofRef: z.string().min(4).max(1024), // reference to deletion/cessation proof
    }))
    .mutation(async ({ input }) => {
      // Tokens are stored as SHA-256 hashes at rest. Legacy plaintext tokens
      // were hashed in place by migration 0103 — only the hashed form matches.
      const rows = await exec(
        `UPDATE propagation_records SET status = 'acknowledged', acked_at = NOW(), proof_ref = $1, updated_at = NOW()
         WHERE ack_token = $2 AND status IN ('pending','notified','overdue','failed')
         RETURNING id, withdrawal_event_id, processor_id`,
        [input.proofRef, sha256Hex(input.ackToken)]
      );
      if (!rows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid acknowledgment token or withdrawal already acknowledged." });
      }
      await logAuditEvent("consent_prop.processor_acknowledged", "propagation_record", rows[0].id, "public-token", { withdrawalEventId: rows[0].withdrawal_event_id, processorId: rows[0].processor_id });
      return { success: true, acknowledgedAt: new Date().toISOString() };
    }),

  /**
   * Admin: reissue an ack token for an unacknowledged propagation record
   * (e.g. the processor lost the original). The previous token is invalidated
   * immediately; the new raw token is returned exactly once.
   */
  reissueAckToken: adminProcedure
    .input(z.object({ propagationRecordId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const rawToken = crypto.randomBytes(24).toString("hex");
      const rows = await exec(
        `UPDATE propagation_records SET ack_token = $2, updated_at = NOW()
         WHERE id = $1 AND status IN ('pending','notified','overdue','failed')
         RETURNING id`,
        [input.propagationRecordId, sha256Hex(rawToken)],
      );
      if (!rows[0]) {
        throw new TRPCError({ code: "CONFLICT", message: "Propagation record not found or already acknowledged." });
      }
      await logAuditEvent("consent_prop.ack_token_reissued", "propagation_record", input.propagationRecordId, String((ctx as any).user?.id ?? ""), {});
      return { success: true, ackToken: rawToken, message: "Deliver this token to the processor via a secure channel; it is shown only once." };
    }),

  // ─── Public self-service withdrawal (NDPA s.35 withdrawal parity) ───────
  /**
   * Staff/org: create a signed one-time withdrawal link token for a consent
   * record. The raw token is returned exactly once for delivery to the data
   * subject (e.g. by email); only its hash is persisted.
   */
  createWithdrawalLink: protectedProcedure
    .input(z.object({
      consentRecordId: z.number().int().positive(),
      ttlHours: z.number().int().min(1).max(720).default(72),
    }))
    .mutation(async ({ input, ctx }) => {
      const cr = await exec(`SELECT id, organization_id, consent_status FROM consent_records WHERE id = $1`, [input.consentRecordId]);
      if (!cr[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Consent record not found." });
      assertOrgScope(ctx, Number(cr[0].organization_id));
      if (cr[0].consent_status === "withdrawn") {
        throw new TRPCError({ code: "CONFLICT", message: "Consent already withdrawn." });
      }
      const rawToken = crypto.randomBytes(32).toString("base64url");
      await exec(
        `INSERT INTO consent_withdrawal_links (consent_record_id, organization_id, token_hash, expires_at, created_by)
         VALUES ($1, $2, $3, NOW() + ($4 || ' hours')::interval, $5)`,
        [input.consentRecordId, cr[0].organization_id, sha256Hex(rawToken), String(input.ttlHours), String((ctx as any).user?.id ?? "")],
      );
      await logAuditEvent("consent_prop.withdrawal_link_created", "consent_record", input.consentRecordId, String((ctx as any).user?.id ?? ""), {});
      return {
        token: rawToken,
        expiresInHours: input.ttlHours,
        message: "Send this token to the data subject via a verified channel; it is shown only once and can be used exactly once.",
      };
    }),

  /**
   * Public: data subject withdraws consent with their one-time token —
   * withdrawal must be as easy as giving consent (NDPA 2023 s.35 parity).
   */
  withdrawByToken: publicProcedure
    .input(z.object({
      token: z.string().min(20).max(128),
      reason: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input }) => {
      const pool = getPool();
      if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const links = await client.query(
          `UPDATE consent_withdrawal_links SET used_at = NOW()
           WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
           RETURNING id, consent_record_id, organization_id`,
          [sha256Hex(input.token)],
        );
        if (!links.rows[0]) {
          await client.query("ROLLBACK");
          throw new TRPCError({ code: "NOT_FOUND", message: "Invalid, expired or already-used withdrawal token." });
        }
        const link = links.rows[0];
        const updated = await client.query(
          `UPDATE consent_records
           SET consent_status = 'withdrawn', consent_withdrawn_at = NOW(),
               metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
               updated_at = NOW()
           WHERE id = $1 AND consent_status <> 'withdrawn'
           RETURNING id`,
          [link.consent_record_id, JSON.stringify({ withdrawal_reason: input.reason ?? "Self-service withdrawal", withdrawal_channel: "self_service_token" })],
        );
        await client.query(
          `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
           VALUES ('consent_self_service_withdrawal', 'consent_records', $1, NULL, $2, NOW())`,
          [link.consent_record_id, JSON.stringify({ organizationId: link.organization_id, linkId: link.id, alreadyWithdrawn: !updated.rows[0] })],
        );
        await client.query("COMMIT");
        emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "consent_self_service_withdrawal", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return { success: true, consentRecordId: link.consent_record_id, alreadyWithdrawn: !updated.rows[0] };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        if (err instanceof TRPCError) throw err;
        logger.error({ err }, "[consent-prop] self-service withdrawal failed");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Withdrawal failed" });
      } finally {
        client.release();
      }
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
         COUNT(*) FILTER (WHERE status = 'failed') as failed,
         COUNT(*) FILTER (WHERE status IN ('notified','overdue')
           AND notified_at + ((SELECT sla_hours FROM downstream_processors WHERE id = processor_id) || ' hours')::interval < NOW()) as overdue
       FROM propagation_records`
    );
    return { totals: totals ?? {}, byProcessor };
  }),
});
