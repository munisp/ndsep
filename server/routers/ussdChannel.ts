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
 *   - Gateway AUTHENTICATION: handleUssd verifies the caller is the real
 *     gateway before processing. Set USSD_GATEWAY_SECRET and have the gateway
 *     send either `x-gateway-secret: <secret>` or an HMAC-SHA256 hex signature
 *     header `x-ussd-signature: HMAC(secret, "<sessionId>|<msisdn>|<input>")`.
 *     In production an unset secret FAILS CLOSED; in dev it warns loudly.
 *   - USSD session state machine (see ./ussdStateMachine for the pure logic):
 *     language select (en/ha/yo/ig) → category menu → controller lookup by
 *     short-code/name fragment (organizations.name / registration_number)
 *     → free-text description → NDPC-CMP-YYYY-NNNNNN reference.
 *     Sessions expire after 180s of inactivity; per-MSISDN rate limiting
 *     counts only NEW sessions (in-progress continuation is never blocked).
 *     Session resume is bound to BOTH session_id and msisdn_hmac so a session
 *     id can never be replayed from a different handset.
 *   - Reference codes come from ndsep_complaint_ref_seq (migration 0092) —
 *     the SAME sequence family web complaint intake uses, so USSD and web
 *     references never collide.
 *   - PRIMARY persistence path: complaints land directly in public_complaints
 *     (migration 0081), with the USSD category vocabulary mapped onto the web
 *     vocabulary via mapUssdCategoryToWeb (services/complaintLogic). A
 *     bookkeeping row is kept in ussd_intake_queue (sync_target
 *     'public_complaints', status 'synced'). Only when the primary insert
 *     FAILS is the complaint parked in ussd_intake_queue as 'pending_sync';
 *     the syncPendingIntake procedure replays those rows into
 *     public_complaints (idempotent on reference_code).
 *   - Duplicate-confirm idempotency: once a session reaches DONE the issued
 *     complaint_ref is persisted on the session; a retried CONFIRM (network
 *     replay) re-returns the SAME reference instead of filing a duplicate.
 *   - MSISDN privacy: only HMAC-SHA256(msisdn) + last4 are ever persisted.
 *     notifyStatusChange derives the recipient HMAC from the intake row and
 *     never accepts a raw MSISDN as the routing source of truth — a supplied
 *     MSISDN is only used for immediate delivery AFTER its HMAC matches the
 *     intake row.
 *   - SMS outbox (sms_outbox) with delivery-status tracking for intake
 *     confirmations and status-change notifications.
 */
import { createHmac, createHash, timingSafeEqual } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { encryptField, decryptField } from "../encryption";
import { mapUssdCategoryToWeb, computeAckSlaDueAt } from "../services/complaintLogic";
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
// Shared secret / HMAC key the USSD gateway uses to authenticate its callbacks.
const USSD_GATEWAY_SECRET = process.env.USSD_GATEWAY_SECRET ?? "";

if (!MSISDN_HMAC_KEY) {
  logger.warn("[ussd] USSD_HMAC_KEY is not set — using a derived process key for MSISDN HMAC. Set USSD_HMAC_KEY in production.");
}
if (!USSD_GATEWAY_SECRET) {
  logger.warn("[ussd] USSD_GATEWAY_SECRET is not set — gateway callbacks are unauthenticated outside production. Set USSD_GATEWAY_SECRET.");
}

function msisdnHmac(msisdn: string): string {
  const key = MSISDN_HMAC_KEY || createHash("sha256").update(`ndsep-ussd-dev-key:${process.env.DATABASE_URL ?? "local"}`).digest("hex");
  return createHmac("sha256", key).update(msisdn.replace(/\s+/g, "")).digest("hex");
}

function msisdnLast4(msisdn: string): string {
  return msisdn.replace(/\D/g, "").slice(-4).padStart(4, "0");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify the USSD gateway callback is authentic. Accepts either:
 *   x-gateway-secret: <USSD_GATEWAY_SECRET>                    (shared secret)
 *   x-ussd-signature: hex HMAC-SHA256(secret, "sessionId|msisdn|input")
 * Fails closed in production when the secret is unset; dev mode warns.
 */
function verifyGatewayAuth(
  headers: Record<string, unknown> | undefined,
  payload: { sessionId: string; msisdn: string; input: string },
): void {
  if (!USSD_GATEWAY_SECRET) {
    if (process.env.NODE_ENV === "production") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "USSD gateway authentication is not configured (USSD_GATEWAY_SECRET unset); refusing callback in production.",
      });
    }
    return; // dev mode — the module-load warning above makes this loud.
  }
  const h = headers ?? {};
  const get = (k: string): string | undefined => {
    const v = h[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };
  const shared = get("x-gateway-secret");
  if (shared && safeEqual(shared, USSD_GATEWAY_SECRET)) return;
  const sig = get("x-ussd-signature");
  if (sig) {
    const expected = createHmac("sha256", USSD_GATEWAY_SECRET)
      .update(`${payload.sessionId}|${payload.msisdn}|${payload.input}`)
      .digest("hex");
    if (safeEqual(sig.toLowerCase(), expected)) return;
  }
  throw new TRPCError({ code: "UNAUTHORIZED", message: "USSD gateway authentication failed." });
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

function toIntOrNull(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isInteger(n) && Math.abs(n) < 2147483647 ? n : null;
}

/**
 * Land a completed USSD complaint in public_complaints (primary path) and keep
 * the ussd_intake_queue bookkeeping row, atomically. Returns the sync status.
 * On primary-insert failure the complaint is parked in the queue as
 * 'pending_sync' (fallback path) — never dropped.
 */
async function landComplaint(args: {
  complaintRef: string;
  sessionId: string;
  hmac: string;
  last4: string;
  language: string;
  ussdCategory: string;
  controllerRef: string | null;
  controllerName: string | null;
  description: string;
}): Promise<{ syncStatus: "synced" | "pending_sync"; syncTarget: "public_complaints" | "ussd_intake_queue"; queueId: number | null }> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const webCategory = mapUssdCategoryToWeb(args.ussdCategory) ?? "other";
  const controllerId = toIntOrNull(args.controllerRef);
  const ackDue = computeAckSlaDueAt();
  const subject = `USSD complaint (${args.ussdCategory})${args.controllerName ? ` — ${args.controllerName}` : ""}`.slice(0, 512);

  // ── Primary path: public_complaints + queue bookkeeping in ONE transaction.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const complaint = await client.query(
      `INSERT INTO public_complaints
         (reference_code, category, subject, description,
          controller_id, controller_name, is_anonymous, status, ack_sla_due_at)
       VALUES ($1,$2,$3,$4,$5,$6,true,'received',$7)
       ON CONFLICT (reference_code) DO NOTHING
       RETURNING id`,
      [args.complaintRef, webCategory, subject, encryptField(args.description), controllerId, args.controllerName, ackDue],
    );
    if (complaint.rows[0]) {
      await client.query(
        `INSERT INTO complaint_events (complaint_id, event_type, from_status, to_status, actor, details)
         VALUES ($1, 'submitted', NULL, 'received', 'ussd', $2)`,
        [complaint.rows[0].id, JSON.stringify({ channel: "ussd", ussd_category: args.ussdCategory, language: args.language })],
      );
    }
    const queue = await client.query(
      `INSERT INTO ussd_intake_queue
         (complaint_ref, session_id, msisdn_hmac, msisdn_last4, language, category, controller_ref, controller_name, description, sync_target, status, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'public_complaints', 'synced', NOW())
       ON CONFLICT (complaint_ref) DO UPDATE SET status = 'synced', sync_target = 'public_complaints', synced_at = NOW()
       RETURNING id`,
      [args.complaintRef, args.sessionId, args.hmac, args.last4, args.language, args.ussdCategory, args.controllerRef, args.controllerName, encryptField(args.description)],
    );
    await client.query("COMMIT");
    return { syncStatus: "synced", syncTarget: "public_complaints", queueId: queue.rows[0]?.id ?? null };
  } catch (err) {
    await client.query("ROLLBACK");
    logger.warn({ err, ref: args.complaintRef }, "[ussd] public_complaints landing failed; parking in ussd_intake_queue (fallback path)");
  } finally {
    client.release();
  }

  // ── Fallback path: park the fully-formed complaint for later sync.
  const queueRows = await exec(
    `INSERT INTO ussd_intake_queue
       (complaint_ref, session_id, msisdn_hmac, msisdn_last4, language, category, controller_ref, controller_name, description, sync_target, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ussd_intake_queue', 'pending_sync')
     ON CONFLICT (complaint_ref) DO NOTHING
     RETURNING id`,
    [args.complaintRef, args.sessionId, args.hmac, args.last4, args.language, args.ussdCategory, args.controllerRef, args.controllerName, encryptField(args.description)],
  );
  return { syncStatus: "pending_sync", syncTarget: "ussd_intake_queue", queueId: queueRows[0]?.id ?? null };
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
  const outboxId = await enqueuePending(msisdnHmac(rawMsisdn), msisdnLast4(rawMsisdn), message, relatedRef, notificationType);
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

/** Enqueue an outbox row in 'pending' state (HMAC-only recipient, no delivery attempt). */
async function enqueuePending(
  hmac: string,
  last4: string,
  message: string,
  relatedRef: string | null,
  notificationType: "status_change" | "intake_confirmation" | "otp",
): Promise<number | null> {
  const rows = await exec(
    `INSERT INTO sms_outbox (msisdn_hmac, msisdn_last4, message, related_ref, notification_type)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [hmac, last4, message, relatedRef, notificationType],
  );
  return rows[0]?.id ?? null;
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
   * Authenticated via USSD_GATEWAY_SECRET (shared-secret or HMAC signature
   * header — see verifyGatewayAuth). Returns { response, endSession } — the
   * gateway wrapper maps these onto "CON ..." / "END ..." wire format.
   */
  handleUssd: publicProcedure
    .input(z.object({
      sessionId: z.string().min(4).max(128),
      msisdn: z.string().min(7).max(20),
      input: z.string().max(1000).default(""),
    }))
    .mutation(async ({ input, ctx }) => {
      verifyGatewayAuth((ctx as any).req?.headers, input);

      const nowMs = Date.now();
      const hmac = msisdnHmac(input.msisdn);
      const last4 = msisdnLast4(input.msisdn);

      // Session resume is bound to BOTH session_id and msisdn_hmac: a session
      // id replayed from a different handset never attaches to the original
      // subscriber's in-flight complaint.
      const existing = await exec(
        `SELECT * FROM ussd_sessions WHERE session_id = $1 AND msisdn_hmac = $2`,
        [input.sessionId, hmac],
      );

      // Duplicate-confirm idempotency: a session that already completed with an
      // issued reference returns the SAME reference (network retries of the
      // final "1. Confirm" must never file a second complaint).
      if (existing[0]?.state === "DONE" && existing[0]?.complaint_ref) {
        return {
          response: `Complaint already received.\nReference: ${existing[0].complaint_ref}\nKeep this code. Status updates will be sent by SMS.`,
          endSession: true,
          state: "DONE",
          complaintRef: existing[0].complaint_ref,
          duplicate: true,
        };
      }

      // Per-MSISDN rate limiting applies to NEW sessions only — continuing an
      // in-progress session must never be blocked by the session-opening cap.
      if (!existing[0]) {
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
      }

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

        const p = result.session.payload;
        const landing = await landComplaint({
          complaintRef,
          sessionId: input.sessionId,
          hmac,
          last4,
          language: result.session.language ?? "en",
          ussdCategory: String(p.category ?? "other"),
          controllerRef: p.controllerRef ?? null,
          controllerName: p.controllerName ?? null,
          description: p.description ?? "",
        });

        // Intake-confirmation SMS via the outbox: enqueued + immediate
        // delivery attempt while the raw MSISDN is in memory (HMAC-only at rest).
        const sms = await enqueueAndDeliver(
          input.msisdn,
          `NDPC: Your complaint ${complaintRef} has been received. You will be notified of status changes by SMS.`,
          complaintRef,
          "intake_confirmation",
        );
        await logAudit("ussd.complaint_submitted", "ussd_intake", landing.queueId, {
          complaint_ref: complaintRef, category: p.category, language: result.session.language, msisdn_last4: last4, sync_status: landing.syncStatus,
        });
        emitMutationEvent("ndsep.ussd.complaint", { action: "submitted", complaintRef, ts: new Date().toISOString() })
          .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        result = {
          ...result,
          response: `Complaint received.\nReference: ${complaintRef}\nKeep this code. Status updates will be sent by SMS.`,
        };
        intake = { complaintRef, syncStatus: landing.syncStatus, queueId: landing.queueId, smsDelivery: sms.delivery };
      }

      await persistSession(input.sessionId, hmac, last4, result.session, complaintRef);
      return {
        response: result.response,
        endSession: result.endSession,
        state: result.session.state,
        ...(intake ?? {}),
      };
    }),

  /** Officer view of queued USSD complaints (descriptions decrypted). */
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
      const rows = await exec(sql, params);
      // description is encrypted at rest (PII); decrypt explicitly for the
      // officer view. decryptField passes plaintext through when encryption
      // is disabled or the value was written before encryption landed.
      return rows.map((r) => ({ ...r, description: decryptField(r.description) }));
    }),

  /**
   * Replay parked (pending_sync / failed) intake rows into public_complaints.
   * Idempotent on reference_code; each row is synced in its own transaction so
   * one bad row never blocks the rest.
   */
  syncPendingIntake: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .mutation(async ({ input, ctx }) => {
      const pending = await exec(
        `SELECT * FROM ussd_intake_queue WHERE status IN ('pending_sync','failed')
         ORDER BY created_at ASC LIMIT $1`,
        [input?.limit ?? 50],
      );
      let synced = 0;
      let failed = 0;
      const pool = getPool();
      for (const row of pending) {
        const webCategory = mapUssdCategoryToWeb(String(row.category)) ?? "other";
        const client = pool ? await pool.connect() : null;
        if (!client) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
        try {
          await client.query("BEGIN");
          const ins = await client.query(
            `INSERT INTO public_complaints
               (reference_code, category, subject, description, controller_id, controller_name, is_anonymous, status, ack_sla_due_at)
             VALUES ($1,$2,$3,$4,$5,$6,true,'received', COALESCE($7::timestamptz, NOW() + interval '72 hours'))
             ON CONFLICT (reference_code) DO NOTHING
             RETURNING id`,
            [
              row.complaint_ref,
              webCategory,
              `USSD complaint (${row.category})${row.controller_name ? ` — ${row.controller_name}` : ""}`.slice(0, 512),
              row.description, // already encrypted at rest in the queue
              toIntOrNull(row.controller_ref),
              row.controller_name ?? null,
              computeAckSlaDueAt(new Date(row.created_at)).toISOString(),
            ],
          );
          if (ins.rows[0]) {
            await client.query(
              `INSERT INTO complaint_events (complaint_id, event_type, from_status, to_status, actor, details)
               VALUES ($1, 'submitted', NULL, 'received', 'ussd-sync', $2)`,
              [ins.rows[0].id, JSON.stringify({ channel: "ussd", synced_from_queue: row.id, ussd_category: row.category })],
            );
          }
          await client.query(
            `UPDATE ussd_intake_queue SET status = 'synced', sync_target = 'public_complaints', synced_at = NOW(), sync_error = NULL
             WHERE id = $1`,
            [row.id],
          );
          await client.query("COMMIT");
          synced++;
        } catch (err) {
          await client.query("ROLLBACK");
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          await exec(
            `UPDATE ussd_intake_queue SET status = 'failed', sync_error = $2 WHERE id = $1`,
            [row.id, msg.slice(0, 1000)],
          );
        } finally {
          client.release();
        }
      }
      await logAudit("ussd.intake_synced", "ussd_intake", null, { synced, failed, requested: pending.length, by: String(ctx.user.id) });
      return { synced, failed, requested: pending.length };
    }),

  /**
   * Enqueue a status-change SMS for a USSD-originated complaint. The recipient
   * is DERIVED from the intake row's stored MSISDN HMAC — a raw MSISDN is
   * never accepted as the routing source of truth. When the caller supplies a
   * raw MSISDN it is used ONLY for the immediate delivery attempt, and only
   * after its HMAC matches the intake row; otherwise the message is parked as
   * 'pending' for processOutbox (which enforces the same HMAC binding).
   */
  notifyStatusChange: adminProcedure
    .input(z.object({
      complaintRef: z.string().regex(/^NDPC-CMP-\d{4}-\d{6}$/),
      newStatus: z.string().min(2).max(64),
      /** Optional raw MSISDN for immediate delivery — must HMAC-match the intake row. */
      msisdn: z.string().min(7).max(20).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const intake = await exec(
        `SELECT msisdn_hmac, msisdn_last4 FROM ussd_intake_queue
         WHERE complaint_ref = $1 ORDER BY id DESC LIMIT 1`,
        [input.complaintRef],
      );
      if (!intake[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No USSD intake found for that complaint reference." });
      }
      const message = `NDPC: Complaint ${input.complaintRef} status update: ${input.newStatus}.`;
      let outboxId: number | null;
      let delivery: string;
      if (input.msisdn) {
        if (msisdnHmac(input.msisdn) !== intake[0].msisdn_hmac) {
          await logAudit("ussd.notify_msisdn_mismatch", "ussd_intake", null, { ref: input.complaintRef, by: String(ctx.user.id) });
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Supplied MSISDN does not match the intake recipient on record; delivery refused.",
          });
        }
        ({ outboxId, delivery } = await enqueueAndDeliver(input.msisdn, message, input.complaintRef, "status_change"));
      } else {
        outboxId = await enqueuePending(intake[0].msisdn_hmac, intake[0].msisdn_last4, message, input.complaintRef, "status_change");
        delivery = "pending";
      }
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
