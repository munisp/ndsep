/**
 * USSD/SMS Public Complaint Intake Router
 *
 * Channels for citizens without smartphones/web access to lodge NDPA 2023
 * complaints with the Commission:
 *
 *   - Gateway adapter (Africa's Talking / Twilio-compatible REST):
 *     env SMS_GATEWAY_BASE + SMS_GATEWAY_API_KEY. Without BOTH, every
 *     delivery path reports status UNCONFIGURED explicitly — SMS rows are
 *     marked 'unconfigured', never faked as 'sent'.
 *   - USSD session state machine (see ./ussdStateMachine for the pure logic):
 *     language select (en/ha/yo/ig) → category menu → controller lookup by
 *     short-code/name fragment (organizations.name / registration_number)
 *     → free-text description → NDPC-CMP-YYYY-NNNNNN reference.
 *     Sessions expire after 180s of inactivity; per-MSISDN rate limiting.
 *   - Reference codes come from ndsep_complaint_ref_seq (migration 0092) —
 *     the SAME sequence family web complaint intake uses, so USSD and web
 *     references never collide.
 *   - DUAL-PATH persistence: at submit time the router checks
 *     to_regclass('complaints'). If the platform complaints table exists the
 *     complaint is inserted there directly (sync_target='complaints',
 *     status='synced' bookkeeping row kept in ussd_intake_queue for the
 *     audit trail); otherwise the fully-formed complaint is parked in
 *     ussd_intake_queue (status='pending_sync') for later sync once the web
 *     complaints module lands.
 *   - MSISDN privacy: only HMAC-SHA256(msisdn) + last4 are ever persisted.
 *   - SMS outbox (sms_outbox) with delivery-status tracking for intake
 *     confirmations and status-change notifications.
 */
import { createHmac, createHash } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { encryptField } from "../encryption";
import {
  advance,
  resolveControllerLookup,
  createSession,
  buildComplaintReference,
  USSD_SESSION_TTL_SECONDS,
  type UssdSessionState,
  type ControllerOption,
} from "./ussdStateMachine";

const SMS_GATEWAY_BASE = process.env.SMS_GATEWAY_BASE ?? "";
const SMS_GATEWAY_API_KEY = process.env.SMS_GATEWAY_API_KEY ?? "";
const SMS_GATEWAY_SENDER_ID = process.env.SMS_GATEWAY_SENDER_ID ?? "NDPC";
const SMS_GATEWAY_TIMEOUT_MS = Number(process.env.SMS_GATEWAY_TIMEOUT_MS ?? 10000);
// HMAC key for MSISDN pseudonymisation. Falls back to a process-stable dev
// key with a loud warning — production deployments MUST set USSD_HMAC_KEY.
const MSISDN_HMAC_KEY = process.env.USSD_HMAC_KEY ?? "";
const RATE_LIMIT_MAX_SESSIONS = Number(process.env.USSD_RATE_LIMIT_MAX ?? 5);
const RATE_LIMIT_WINDOW_MINUTES = Number(process.env.USSD_RATE_LIMIT_WINDOW_MINUTES ?? 10);

if (!MSISDN_HMAC_KEY) {
  logger.warn("[ussd] USSD_HMAC_KEY is not set — using a derived process key for MSISDN HMAC. Set USSD_HMAC_KEY in production.");
}

function msisdnHmac(msisdn: string): string {
  const key = MSISDN_HMAC_KEY || createHash("sha256").update(`ndsep-ussd-dev-key:${process.env.DATABASE_URL ?? "local"}`).digest("hex");
  return createHmac("sha256", key).update(msisdn.replace(/\s+/g, "")).digest("hex");
}

function msisdnLast4(msisdn: string): string {
  return msisdn.replace(/\D/g, "").slice(-4).padStart(4, "0");
}

/** Explicit gateway configuration status — the adapter never pretends. */
export function getGatewayStatus(): { status: "configured" | "UNCONFIGURED"; base?: string; senderId?: string; reason?: string } {
  if (!SMS_GATEWAY_BASE || !SMS_GATEWAY_API_KEY) {
    return {
      status: "UNCONFIGURED",
      reason: "SMS_GATEWAY_BASE and/or SMS_GATEWAY_API_KEY not set; SMS delivery disabled (no silent mock)",
    };
  }
  return { status: "configured", base: SMS_GATEWAY_BASE, senderId: SMS_GATEWAY_SENDER_ID };
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
    logger.error({ err, query: query.slice(0, 200) }, "[ussd] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

async function logAudit(
  action: string,
  resourceType: string,
  resourceId: string | number | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    const toInt = (v: string | number | null): number | null => {
      if (v == null) return null;
      const n = typeof v === "number" ? v : parseInt(v, 10);
      return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
    };
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
       VALUES ($1, $2, $3, NULL, $4, NOW())`,
      [action, resourceType, toInt(resourceId), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[ussd] Audit log write failed");
  }
}

/** Africa's Talking / Twilio-compatible send. Returns the gateway HTTP outcome. */
async function deliverSms(toMsisdn: string, message: string): Promise<{ ok: boolean; httpStatus?: number; body?: string }> {
  const gateway = getGatewayStatus();
  if (gateway.status === "UNCONFIGURED") {
    return { ok: false, body: "UNCONFIGURED" };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SMS_GATEWAY_TIMEOUT_MS);
    const resp = await fetch(`${SMS_GATEWAY_BASE.replace(/\/$/, "")}/messaging`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        apiKey: SMS_GATEWAY_API_KEY,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        username: process.env.SMS_GATEWAY_USERNAME ?? "ndsep",
        to: toMsisdn,
        message,
        from: SMS_GATEWAY_SENDER_ID,
      }).toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = (await resp.text()).slice(0, 500);
    return { ok: resp.ok, httpStatus: resp.status, body };
  } catch (err) {
    return { ok: false, body: err instanceof Error ? err.message : String(err) };
  }
}

/** Resolve controller name fragment / short code against organizations. */
async function lookupControllers(fragment: string): Promise<ControllerOption[]> {
  const rows = await exec(
    `SELECT id::text AS ref, name
     FROM organizations
     WHERE LOWER(name) LIKE LOWER($1)
        OR LOWER(registration_number) = LOWER($2)
     ORDER BY name
     LIMIT 8`,
    [`%${fragment}%`, fragment],
  );
  return rows.map((r) => ({ ref: r.ref, name: r.name }));
}

// Cached existence check for the dual-path complaints insert.
let complaintsTableExists: boolean | null = null;
async function hasComplaintsTable(): Promise<boolean> {
  if (complaintsTableExists !== null) return complaintsTableExists;
  const rows = await exec(`SELECT to_regclass('public.complaints') AS t`);
  complaintsTableExists = rows[0]?.t != null;
  if (!complaintsTableExists) {
    logger.info("[ussd] platform 'complaints' table not present — USSD complaints will park in ussd_intake_queue (dual-path design)");
  }
  return complaintsTableExists;
}

/**
 * Enqueue an outbox row and attempt immediate delivery while the raw MSISDN
 * is still in memory. Only HMAC + last4 are persisted; the delivery outcome
 * (sent / failed / unconfigured) is tracked on the row. Rows whose immediate
 * delivery failed can be retried via processOutbox with an explicit recipient.
 */
async function enqueueAndDeliver(
  rawMsisdn: string,
  message: string,
  relatedRef: string | null,
  notificationType: "status_change" | "intake_confirmation" | "otp",
): Promise<{ outboxId: number | null; delivery: string }> {
  const rows = await exec(
    `INSERT INTO sms_outbox (msisdn_hmac, msisdn_last4, message, related_ref, notification_type)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [msisdnHmac(rawMsisdn), msisdnLast4(rawMsisdn), message, relatedRef, notificationType],
  );
  const outboxId: number | null = rows[0]?.id ?? null;
  const gateway = getGatewayStatus();
  let delivery: string;
  if (gateway.status === "UNCONFIGURED") {
    delivery = "unconfigured";
    await exec(
      `UPDATE sms_outbox SET status = 'unconfigured', attempts = attempts + 1, last_attempt_at = NOW(),
              gateway_response = $2 WHERE id = $1`,
      [outboxId, JSON.stringify({ reason: gateway.reason })],
    );
  } else {
    const outcome = await deliverSms(rawMsisdn, message);
    delivery = outcome.ok ? "sent" : "failed";
    await exec(
      `UPDATE sms_outbox SET status = $2, attempts = attempts + 1, last_attempt_at = NOW(),
              sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
              gateway_response = $3 WHERE id = $1`,
      [outboxId, delivery, JSON.stringify({ httpStatus: outcome.httpStatus, body: outcome.body })],
    );
  }
  return { outboxId, delivery };
}

function deserializeSession(row: any, nowMs: number): UssdSessionState {
  return {
    state: row.state,
    language: row.language,
    payload: row.payload ?? {},
    updatedAtMs: row.updated_at ? new Date(row.updated_at).getTime() : nowMs,
  };
}

async function persistSession(
  sessionId: string,
  hmac: string,
  last4: string,
  session: UssdSessionState,
  complaintRef?: string | null,
): Promise<void> {
  await exec(
    `INSERT INTO ussd_sessions (session_id, msisdn_hmac, msisdn_last4, state, language, payload, expires_at, updated_at, complaint_ref)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' seconds')::interval, NOW(), $8)
     ON CONFLICT (session_id) DO UPDATE SET
       state = EXCLUDED.state, language = EXCLUDED.language, payload = EXCLUDED.payload,
       expires_at = EXCLUDED.expires_at, updated_at = NOW(),
       complaint_ref = COALESCE(EXCLUDED.complaint_ref, ussd_sessions.complaint_ref),
       completed_at = CASE WHEN EXCLUDED.state IN ('DONE','CANCELLED') THEN NOW() ELSE ussd_sessions.completed_at END`,
    [sessionId, hmac, last4, session.state, session.language, JSON.stringify(session.payload), String(USSD_SESSION_TTL_SECONDS), complaintRef ?? null],
  );
}

export const ussdChannelRouter = router({
  /** Explicit gateway adapter status (no secrets returned). */
  gatewayStatus: publicProcedure.query(() => getGatewayStatus()),

  /**
   * USSD gateway callback (Africa's Talking / Twilio-style webhook).
   * Returns { response, endSession } — the gateway wrapper maps these onto
   * "CON ..." / "END ..." wire format.
   */
  handleUssd: publicProcedure
    .input(z.object({
      sessionId: z.string().min(4).max(128),
      msisdn: z.string().min(7).max(20),
      input: z.string().max(1000).default(""),
    }))
    .mutation(async ({ input }) => {
      const nowMs = Date.now();
      const hmac = msisdnHmac(input.msisdn);
      const last4 = msisdnLast4(input.msisdn);

      // Per-MSISDN rate limiting: count sessions opened in the window.
      const recent = await exec(
        `SELECT COUNT(*)::int AS n FROM ussd_sessions
         WHERE msisdn_hmac = $1 AND created_at > NOW() - ($2 || ' minutes')::interval`,
        [hmac, String(RATE_LIMIT_WINDOW_MINUTES)],
      );
      if ((recent[0]?.n ?? 0) >= RATE_LIMIT_MAX_SESSIONS) {
        await logAudit("ussd.rate_limited", "ussd_session", null, { msisdn_last4: last4 });
        return {
          response: "Too many sessions. Please wait a few minutes and dial again.",
          endSession: true,
          rateLimited: true,
        };
      }

      const existing = await exec(
        `SELECT * FROM ussd_sessions WHERE session_id = $1`,
        [input.sessionId],
      );
      let session: UssdSessionState = existing[0]
        ? deserializeSession(existing[0], nowMs)
        : createSession(nowMs);

      let result = advance(session, input.input, nowMs);

      // Controller handshake: the machine asks us to resolve the fragment.
      if (result.lookupRequest !== undefined) {
        const options = result.lookupRequest === "0" ? [] : await lookupControllers(result.lookupRequest);
        result = resolveControllerLookup(result.session, options, nowMs);
      }

      let complaintRef: string | null = null;
      let intake: Record<string, unknown> | null = null;

      if (result.session.state === "DONE" && result.response === "COMPLAINT_ACCEPTED") {
        // Issue the reference from the shared complaint sequence family.
        const [seqRow] = await exec(`SELECT nextval('ndsep_complaint_ref_seq') AS n`);
        complaintRef = buildComplaintReference(new Date().getFullYear(), Number(seqRow?.n ?? 1));

        // DUAL PATH: insert into platform complaints table if it exists,
        // else park in ussd_intake_queue for later sync.
        const p = result.session.payload;
        const landedInComplaints = await hasComplaintsTable();
        let syncStatus = "pending_sync";
        if (landedInComplaints) {
          try {
            await exec(
              `INSERT INTO complaints (reference_number, category, description, channel, language, created_at)
               VALUES ($1, $2, $3, 'ussd', $4, NOW())`,
              [complaintRef, p.category ?? "other", encryptField(p.description ?? ""), result.session.language ?? "en"],
            );
            syncStatus = "synced";
          } catch (err) {
            // complaints table shape mismatch — fall back to the queue.
            logger.warn({ err }, "[ussd] complaints insert failed; parking in ussd_intake_queue");
            syncStatus = "pending_sync";
          }
        }
        const queueRows = await exec(
          `INSERT INTO ussd_intake_queue
             (complaint_ref, session_id, msisdn_hmac, msisdn_last4, language, category, controller_ref, controller_name, description, sync_target, status, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $11 = 'synced' THEN NOW() ELSE NULL END)
           ON CONFLICT (complaint_ref) DO NOTHING
           RETURNING id, status`,
          [
            complaintRef, input.sessionId, hmac, last4,
            result.session.language ?? "en", p.category ?? "other",
            p.controllerRef ?? null, p.controllerName ?? null,
            encryptField(p.description ?? ""),
            landedInComplaints && syncStatus === "synced" ? "complaints" : "ussd_intake_queue",
            syncStatus,
          ],
        );
        // Intake-confirmation SMS via the outbox: enqueued + immediate
        // delivery attempt while the raw MSISDN is in memory (HMAC-only at rest).
        const sms = await enqueueAndDeliver(
          input.msisdn,
          `NDPC: Your complaint ${complaintRef} has been received. You will be notified of status changes by SMS.`,
          complaintRef,
          "intake_confirmation",
        );
        await logAudit("ussd.complaint_submitted", "ussd_intake", queueRows[0]?.id ?? null, {
          complaint_ref: complaintRef, category: p.category, language: result.session.language, msisdn_last4: last4, sync_status: syncStatus,
        });
        emitMutationEvent("ndsep.ussd.complaint", { action: "submitted", complaintRef, ts: new Date().toISOString() })
          .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        result = {
          ...result,
          response: `Complaint received.\nReference: ${complaintRef}\nKeep this code. Status updates will be sent by SMS.`,
        };
        intake = { complaintRef, syncStatus, queueId: queueRows[0]?.id ?? null, smsDelivery: sms.delivery };
      }

      await persistSession(input.sessionId, hmac, last4, result.session, complaintRef);
      return {
        response: result.response,
        endSession: result.endSession,
        state: result.session.state,
        ...(intake ?? {}),
      };
    }),

  /** Officer view of queued (not-yet-synced) USSD complaints. */
  listIntakeQueue: adminProcedure
    .input(z.object({
      status: z.enum(["pending_sync", "synced", "failed"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }).optional())
    .query(async ({ input }) => {
      let sql = `SELECT id, complaint_ref, language, category, controller_ref, controller_name,
                        description, sync_target, status, synced_at, sync_error, created_at
                 FROM ussd_intake_queue`;
      const params: unknown[] = [];
      if (input?.status) {
        params.push(input.status);
        sql += ` WHERE status = $1`;
      }
      params.push(input?.limit ?? 50);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      return exec(sql, params);
    }),

  /**
   * Enqueue a status-change SMS for a complaint. The raw MSISDN is used only
   * for the immediate delivery attempt; only its HMAC + last4 are persisted.
   */
  notifyStatusChange: adminProcedure
    .input(z.object({
      msisdn: z.string().min(7).max(20),
      complaintRef: z.string().regex(/^NDPC-CMP-\d{4}-\d{6}$/),
      newStatus: z.string().min(2).max(64),
    }))
    .mutation(async ({ input, ctx }) => {
      const message = `NDPC: Complaint ${input.complaintRef} status update: ${input.newStatus}.`;
      const { outboxId, delivery } = await enqueueAndDeliver(input.msisdn, message, input.complaintRef, "status_change");
      await logAudit("ussd.sms_enqueued", "sms_outbox", outboxId, { ref: input.complaintRef, delivery, by: String(ctx.user.id) });
      return { success: true, outboxId, delivery, gateway: getGatewayStatus().status };
    }),

  /**
   * Retry failed/unconfigured outbox rows. Because MSISDN is stored HMAC-only,
   * a retry requires the caller to supply the recipient explicitly per row
   * (recipients[]). Without gateway credentials the procedure is an explicit
   * no-op returning UNCONFIGURED — rows are NOT touched and NOT faked 'sent'.
   */
  processOutbox: adminProcedure
    .input(z.object({
      recipients: z.array(z.object({
        outboxId: z.number(),
        msisdn: z.string().min(7).max(20),
      })).min(1).max(200),
    }))
    .mutation(async ({ input, ctx }) => {
      const gateway = getGatewayStatus();
      if (gateway.status === "UNCONFIGURED") {
        await logAudit("ussd.outbox_unconfigured", "sms_outbox", null, { requested: input.recipients.length, by: String(ctx.user.id) });
        return { gateway, attempted: 0, sent: 0, failed: 0, retried: [] as number[] };
      }
      let sent = 0;
      let failed = 0;
      const retried: number[] = [];
      for (const { outboxId, msisdn } of input.recipients) {
        const rows = await exec(
          `SELECT id, message, msisdn_hmac FROM sms_outbox
           WHERE id = $1 AND status IN ('failed', 'unconfigured', 'pending')`,
          [outboxId],
        );
        if (!rows[0]) continue;
        // HMAC binding: refuse delivery if the supplied MSISDN does not match
        // the recipient recorded at enqueue time (prevents misdelivery).
        if (rows[0].msisdn_hmac !== msisdnHmac(msisdn)) {
          await exec(
            `UPDATE sms_outbox SET attempts = attempts + 1, last_attempt_at = NOW(),
                    gateway_response = $2 WHERE id = $1`,
            [outboxId, JSON.stringify({ reason: "supplied recipient MSISDN does not match enqueue-time HMAC; delivery refused" })],
          );
          failed++;
          continue;
        }
        const outcome = await deliverSms(msisdn, rows[0].message);
        await exec(
          `UPDATE sms_outbox SET status = $2, attempts = attempts + 1, last_attempt_at = NOW(),
                  sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
                  gateway_response = $3 WHERE id = $1`,
          [outboxId, outcome.ok ? "sent" : "failed", JSON.stringify({ httpStatus: outcome.httpStatus, body: outcome.body })],
        );
        outcome.ok ? sent++ : failed++;
        retried.push(outboxId);
      }
      await logAudit("ussd.outbox_processed", "sms_outbox", null, { requested: input.recipients.length, sent, failed, by: String(ctx.user.id) });
      return { gateway, attempted: input.recipients.length, sent, failed, retried };
    }),

  /** Outbox with delivery-status tracking (admin). */
  listOutbox: adminProcedure
    .input(z.object({
      status: z.enum(["pending", "sent", "failed", "unconfigured"]).optional(),
      relatedRef: z.string().max(32).optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      if (input?.relatedRef) { params.push(input.relatedRef); conditions.push(`related_ref = $${params.length}`); }
      params.push(input?.limit ?? 50);
      const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT id, msisdn_last4, message, related_ref, notification_type, status, attempts,
                gateway_response, last_attempt_at, sent_at, created_at
         FROM sms_outbox${where} ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      );
    }),
});
