/**
 * FOIA Module Router (Gap 14)
 * Freedom of Information Act 2011 — public request submission with
 * FOIA-YYYY-##### reference numbers, statutory 7-day deadline,
 * exemption-coded refusals, public tracking (ref + email) and an
 * internal task queue for NDPC officers.
 *
 * Round-9 remediation:
 *   - Statutory 7-day extension mechanism (FOIA 2011 s.6) with a recorded
 *     applicant-notice event (foia_events), one extension per request.
 *   - Requester notifications on submit / refuse / disclose via
 *     complaintNotify (honest channel status: sent/failed/UNCONFIGURED).
 *   - updateStatus is staffProcedure with an explicit transition table.
 *   - submit is rate limited (non-TOCTOU counter upsert, salted IP hash,
 *     trusted-proxy-aware extraction).
 *   - The auto-created triage task is staggered to day 2 of the 7-day
 *     statutory window (was due at the full deadline — too late to act on).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, staffProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { logAuditEvent } from "../middlewareHelpers";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField } from "../encryption";
import { sendEmail } from "../services/complaintNotify";
import { hashIp, ipHashSalt, extractClientIp, fixedWindowStart, counterExceedsLimit } from "../services/complaintLogic";

/** FOIA 2011 status transition table (one-way lifecycle). */
const FOIA_TRANSITIONS: Record<string, readonly string[]> = {
  received: ["processing"],
  processing: ["partial_disclosure", "disclosed", "refused"],
  partial_disclosure: ["disclosed", "closed"],
  disclosed: ["closed"],
  refused: ["closed"],
  closed: [],
};

const TRUSTED_PROXY_COUNT = Math.max(0, parseInt(process.env.NDSEP_TRUSTED_PROXY_COUNT ?? "0", 10) || 0);
const SUBMIT_RATE_LIMIT_PER_HOUR = Math.max(1, parseInt(process.env.FOIA_SUBMIT_RATE_LIMIT_PER_HOUR ?? "10", 10) || 10);

async function enforceSubmitRateLimit(req: any): Promise<void> {
  const ip = extractClientIp(req?.headers, req?.ip ?? req?.socket?.remoteAddress, TRUSTED_PROXY_COUNT);
  const key = hashIp(`foia.submit|${ip}`, ipHashSalt());
  const rows = await exec(
    `INSERT INTO rate_limit_counters (limiter_key, window_start, count, updated_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (limiter_key, window_start)
     DO UPDATE SET count = rate_limit_counters.count + 1, updated_at = NOW()
     RETURNING count`,
    [key, fixedWindowStart(Date.now(), 3_600_000)],
  );
  if (counterExceedsLimit(Number(rows[0]?.count ?? 1), SUBMIT_RATE_LIMIT_PER_HOUR)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Submission rate limit reached. Please try again later." });
  }
}

/** Record a lifecycle/notice event on the request (foia_events, migration 0103). */
async function addFoiaEvent(
  foiaRequestId: number,
  eventType: string,
  actor: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await exec(
    `INSERT INTO foia_events (foia_request_id, event_type, actor, details) VALUES ($1, $2, $3, $4)`,
    [foiaRequestId, eventType, actor, JSON.stringify(details)],
  );
}

/** Notify the requester by email; the channel result is recorded honestly. */
async function notifyRequester(args: {
  foiaRequestId: number;
  referenceNumber: string;
  to: string | null;
  subject: string;
  body: string;
  eventType: string;
}): Promise<void> {
  const result = await sendEmail({
    to: args.to,
    subject: args.subject,
    body: args.body,
    referenceCode: args.referenceNumber,
  });
  await addFoiaEvent(args.foiaRequestId, args.eventType, "system", {
    notification: { channel: result.channel, status: result.status, detail: result.detail ?? null },
  });
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
    logger.error({ err, query: query.slice(0, 200) }, "[foia] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

const EXEMPTIONS = ["national_security", "personal_privacy", "law_enforcement", "commercial_confidence"] as const;
const OPEN_STATUSES = ["received", "processing"] as const;

// Attach computed statutory-deadline fields (FOIA 2011 s.4: 7 days).
function withDeadlineFields<T extends Record<string, any>>(row: T) {
  const now = new Date();
  const deadline = row.statutory_deadline ? new Date(row.statutory_deadline) : null;
  const isOpen = (OPEN_STATUSES as readonly string[]).includes(row.status);
  const daysRemaining = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / 86400000) : null;
  return {
    ...row,
    days_to_deadline: daysRemaining,
    overdue: isOpen && deadline !== null && deadline < now,
  };
}

export const foiaRouter = router({
  // ─── Public: submit a FOIA request (no login required) ──────────────────
  submit: publicProcedure
    .input(z.object({
      requesterName: z.string().min(2).max(256),
      requesterEmail: z.string().email(),
      requesterPhone: z.string().max(64).optional(),
      subject: z.string().min(4).max(512),
      description: z.string().min(20).max(10000),
      preferredFormat: z.enum(["electronic", "paper", "inspect"]).default("electronic"),
    }))
    .mutation(async ({ input, ctx }) => {
      await enforceSubmitRateLimit((ctx as any).req);
      const seq = await exec("SELECT nextval('foia_requests_ref_seq') AS n");
      const n = Number(seq[0]?.n ?? Date.now() % 100000);
      const year = new Date().getFullYear();
      const referenceNumber = `FOIA-${year}-${String(n).padStart(5, "0")}`;
      // Statutory deadline: 7 days from receipt (FOIA 2011 s.4)
      const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const rows = await exec(
        `INSERT INTO foia_requests
          (reference_number, requester_name, requester_email, requester_phone, subject, description, preferred_format, statutory_deadline)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, reference_number, status, statutory_deadline`,
        [referenceNumber, encryptField(input.requesterName), encryptField(input.requesterEmail), input.requesterPhone ? encryptField(input.requesterPhone) : null,
         input.subject, input.description, input.preferredFormat, deadline]
      );
      // Auto-create triage task for the officer queue — staggered to day 2 of
      // the 7-day statutory window so officers act before the deadline, not at it.
      if (rows[0]) {
        const triageDue = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
        await exec(
          `INSERT INTO foia_tasks (foia_request_id, task_type, title, due_at)
           VALUES ($1, 'triage', $2, $3)`,
          [rows[0].id, `Triage FOIA request ${referenceNumber}: ${input.subject.slice(0, 120)}`, triageDue]
        );
        await addFoiaEvent(rows[0].id, "submitted", "public", { referenceNumber });
        // Acknowledge receipt to the requester (honest channel status).
        await notifyRequester({
          foiaRequestId: rows[0].id,
          referenceNumber,
          to: input.requesterEmail,
          subject: `FOIA request ${referenceNumber} received`,
          body: `Your Freedom of Information request "${input.subject.slice(0, 120)}" has been received. The statutory response deadline is ${deadline.toISOString().slice(0, 10)}. Track it with reference ${referenceNumber}.`,
          eventType: "notification_submit",
        });
      }
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "foia_request_submitted", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  // ─── Public: track by reference number + email (mirrors dsar.publicTrack) ─
  track: publicProcedure
    .input(z.object({
      referenceNumber: z.string().min(8).max(32),
      requesterEmail: z.string().email(),
    }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT id, reference_number, subject, status, preferred_format, received_at,
                statutory_deadline, exemption_code, refusal_reason, disclosure_notes,
                disclosed_at, closed_at, requester_email
         FROM foia_requests WHERE reference_number = $1`,
        [input.referenceNumber.trim().toUpperCase()]
      );
      const match = rows.find(
        (r) => (r.requester_email as string)?.toLowerCase() === input.requesterEmail.toLowerCase()
      );
      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No FOIA request found with that reference number and email." });
      }
      const { requester_email: _e, ...safe } = match;
      return withDeadlineFields(safe);
    }),

  // ─── Internal: officer queue & lifecycle ────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["received", "processing", "partial_disclosure", "disclosed", "refused", "closed"]).optional(),
      overdueOnly: z.boolean().default(false),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.status) { params.push(input.status); conds.push(`status = $${params.length}`); }
      if (input.overdueOnly) conds.push(`status IN ('received','processing') AND statutory_deadline < NOW()`);
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      params.push(input.limit, offset);
      const rows = await exec(
        `SELECT * FROM foia_requests ${where} ORDER BY statutory_deadline ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const cnt = await exec(`SELECT COUNT(*) as total FROM foia_requests ${where}`, params.slice(0, -2));
      return { data: rows.map(withDeadlineFields), total: parseInt(cnt[0]?.total ?? "0", 10) };
    }),

  stats: protectedProcedure.query(async () => {
    const rows = await exec(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('received','processing')) as open,
        COUNT(*) FILTER (WHERE status IN ('received','processing') AND statutory_deadline < NOW()) as overdue,
        COUNT(*) FILTER (WHERE status = 'disclosed') as disclosed,
        COUNT(*) FILTER (WHERE status = 'partial_disclosure') as partial,
        COUNT(*) FILTER (WHERE status = 'refused') as refused,
        COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '30 days') as received_last_30d
      FROM foia_requests
    `);
    return rows[0] ?? {};
  }),

  assign: adminProcedure
    .input(z.object({ id: z.number().int(), officerId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE foia_requests SET assigned_officer_id = $1, status = CASE WHEN status = 'received' THEN 'processing' ELSE status END, updated_at = NOW()
         WHERE id = $2 RETURNING id`,
        [input.officerId, input.id]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "FOIA request not found." });
      await logAuditEvent("foia.assigned", "foia_request", input.id, String((ctx as any).user?.id ?? ""), { officerId: input.officerId });
      return { success: true };
    }),

  updateStatus: staffProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(["processing", "partial_disclosure", "disclosed", "refused", "closed"]),
      exemptionCode: z.enum(EXEMPTIONS).optional(),
      refusalReason: z.string().max(5000).optional(),
      disclosureNotes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.status === "refused" && !input.exemptionCode) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Refusals must cite an exemption code (FOIA 2011 ss. 11-15)." });
      }
      // Transition table: only forward edges of the one-way lifecycle.
      const current = await exec(
        `SELECT id, status, reference_number, subject, requester_email FROM foia_requests WHERE id = $1`,
        [input.id],
      );
      if (!current[0]) throw new TRPCError({ code: "NOT_FOUND", message: "FOIA request not found." });
      const from = String(current[0].status);
      const allowed = FOIA_TRANSITIONS[from] ?? [];
      if (!allowed.includes(input.status)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Invalid status transition ${from} → ${input.status}. Allowed from ${from}: ${allowed.length ? allowed.join(", ") : "none (terminal)"}.`,
        });
      }
      const rows = await exec(
        `UPDATE foia_requests SET
           status = $1,
           exemption_code = CASE WHEN $1 = 'refused' THEN $2 ELSE exemption_code END,
           refusal_reason = CASE WHEN $1 = 'refused' THEN $3 ELSE refusal_reason END,
           disclosure_notes = COALESCE($4, disclosure_notes),
           disclosed_at = CASE WHEN $1 IN ('disclosed','partial_disclosure') THEN NOW() ELSE disclosed_at END,
           closed_at = CASE WHEN $1 = 'closed' THEN NOW() ELSE closed_at END,
           updated_at = NOW()
         WHERE id = $5 RETURNING id, reference_number, status`,
        [input.status, input.exemptionCode ?? null, input.refusalReason ?? null, input.disclosureNotes ?? null, input.id]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "FOIA request not found." });
      await logAuditEvent(`foia.status_${input.status}`, "foia_request", input.id, String((ctx as any).user?.id ?? ""), {
        exemptionCode: input.exemptionCode ?? null, from,
      });
      await addFoiaEvent(input.id, "status_change", String((ctx as any).user?.id ?? "staff"), { from, to: input.status });
      // Requester notifications on refuse / disclose decisions (FOIA 2011 —
      // the applicant must be told the outcome and the grounds).
      if (["refused", "disclosed", "partial_disclosure"].includes(input.status)) {
        const bodyByStatus: Record<string, string> = {
          refused: `Your FOIA request has been refused under exemption "${(input.exemptionCode ?? "").replace(/_/g, " ")}". ${input.refusalReason ?? ""}`.trim(),
          disclosed: `Your FOIA request has been disclosed. ${input.disclosureNotes ?? ""}`.trim(),
          partial_disclosure: `Your FOIA request has been partially disclosed. ${input.disclosureNotes ?? ""}`.trim(),
        };
        await notifyRequester({
          foiaRequestId: input.id,
          referenceNumber: current[0].reference_number,
          to: current[0].requester_email ?? null,
          subject: `FOIA request ${current[0].reference_number}: ${input.status.replace(/_/g, " ")}`,
          body: bodyByStatus[input.status],
          eventType: `notification_${input.status}`,
        });
      }
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "foia_status_updated", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  /**
   * Statutory extension (FOIA 2011 s.6): extend the response deadline by 7
   * days, ONCE per request, with the applicant notice recorded as a
   * foia_events row and sent by email (honest channel status).
   */
  extendDeadline: staffProcedure
    .input(z.object({
      id: z.number().int(),
      reason: z.string().min(10, "A reason for the extension is mandatory").max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE foia_requests
         SET statutory_deadline = statutory_deadline + interval '7 days',
             extension_granted = true, extension_days = 7, extension_reason = $2,
             extended_at = NOW(), updated_at = NOW()
         WHERE id = $1
           AND status IN ('received','processing')
           AND COALESCE(extension_granted, false) = false
         RETURNING id, reference_number, statutory_deadline, requester_email, subject`,
        [input.id, input.reason],
      );
      if (!rows[0]) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "FOIA request not found, not open, or the statutory extension was already granted (one 7-day extension per request).",
        });
      }
      const req = rows[0];
      await addFoiaEvent(input.id, "extension_granted", String((ctx as any).user?.id ?? "staff"), {
        reason: input.reason,
        newDeadline: req.statutory_deadline,
        extensionDays: 7,
      });
      // Mandatory applicant notice of the extension.
      await notifyRequester({
        foiaRequestId: input.id,
        referenceNumber: req.reference_number,
        to: req.requester_email ?? null,
        subject: `FOIA request ${req.reference_number}: response deadline extended`,
        body: `The statutory deadline for your FOIA request has been extended by 7 days to ${new Date(req.statutory_deadline).toISOString().slice(0, 10)}. Reason: ${input.reason}`,
        eventType: "notification_extension",
      });
      await logAuditEvent("foia.deadline_extended", "foia_request", input.id, String((ctx as any).user?.id ?? ""), { reason: input.reason });
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "foia_deadline_extended", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { id: req.id, referenceNumber: req.reference_number, statutoryDeadline: req.statutory_deadline, extensionDays: 7 };
    }),

  // ─── Internal task queue ────────────────────────────────────────────────
  listTasks: protectedProcedure
    .input(z.object({
      foiaRequestId: z.number().int().optional(),
      status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
      assignedToMe: z.boolean().default(false),
    }))
    .query(async ({ input, ctx }) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.foiaRequestId) { params.push(input.foiaRequestId); conds.push(`t.foia_request_id = $${params.length}`); }
      if (input.status) { params.push(input.status); conds.push(`t.status = $${params.length}`); }
      if (input.assignedToMe) { params.push((ctx as any).user?.id ?? -1); conds.push(`t.assigned_to = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      return exec(
        `SELECT t.*, f.reference_number, f.subject, f.statutory_deadline
         FROM foia_tasks t JOIN foia_requests f ON t.foia_request_id = f.id
         ${where} ORDER BY t.due_at ASC NULLS LAST, t.created_at DESC LIMIT 200`,
        params
      );
    }),

  createTask: protectedProcedure
    .input(z.object({
      foiaRequestId: z.number().int(),
      taskType: z.enum(["triage", "retrieve_records", "redact", "review_exemption", "release"]),
      title: z.string().min(4).max(512),
      notes: z.string().max(5000).optional(),
      assignedTo: z.number().int().optional(),
      dueAt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `INSERT INTO foia_tasks (foia_request_id, task_type, title, notes, assigned_to, due_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [input.foiaRequestId, input.taskType, input.title, input.notes ?? null,
         input.assignedTo ?? null, input.dueAt ?? null, (ctx as any).user?.id ?? null]
      );
      return rows[0];
    }),

  completeTask: protectedProcedure
    .input(z.object({ id: z.number().int(), notes: z.string().max(5000).optional() }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE foia_tasks SET status = 'done', completed_at = NOW(), notes = COALESCE($2, notes), updated_at = NOW()
         WHERE id = $1 AND status IN ('open','in_progress') RETURNING id`,
        [input.id, input.notes ?? null]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Open task not found." });
      await logAuditEvent("foia.task_completed", "foia_task", input.id, String((ctx as any).user?.id ?? ""), {});
      return { success: true };
    }),
});
