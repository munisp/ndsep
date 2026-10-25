/**
 * Public Sanctions Register Router (Gap 13)
 * NDPA 2023 ss. 48-49 — public register of enforcement notices
 * (final orders, undertakings, administrative fines, reprimands),
 * with a delisting-after-remediation workflow and sanction-period
 * expiry computed fields.
 */
import { z } from "zod";
import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, staffProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { logAuditEvent } from "../middlewareHelpers";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField, decryptField } from "../encryption";
import { withCache, CK, TTL } from "../queryCache";
import { sha256Hex } from "../services/complaintLogic";

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
    logger.error({ err, query: query.slice(0, 200) }, "[sanctions] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

function safeParams(params: unknown[]): unknown[] {
  return params.map((p) =>
    Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
      ? JSON.stringify(p)
      : p
  );
}

/** Multi-write mutations (publish + consume, consume + insert) run atomically. */
async function withTransaction<T>(fn: (tx: (q: string, p?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const client = (await pool.connect()) as unknown as {
    query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }>;
    release: () => void;
  };
  const tx = async (q: string, p: unknown[] = []): Promise<any[]> => {
    const r = await client.query(q, safeParams(p));
    return autoDecryptRows(q, r.rows ?? []);
  };
  try {
    await client.query("BEGIN");
    const out = await fn(tx);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (err instanceof TRPCError) throw err;
    logger.error({ err }, "[sanctions] transaction failed — rolled back");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  } finally {
    client.release();
  }
}

const NOTICE_TYPES = ["final_order", "undertaking", "administrative_fine", "reprimand"] as const;

// Computed sanction-period expiry fields, attached to any notice row.
function withExpiryFields<T extends Record<string, any>>(row: T) {
  const now = new Date();
  // A NULL sanction_start means the sanction took effect at publication and
  // runs until sanction_end — previously such rows displayed as "not active"
  // (indefinite-sanction display bug).
  const start = row.sanction_start ? new Date(row.sanction_start) : (row.published_at ? new Date(row.published_at) : null);
  const end = row.sanction_end ? new Date(row.sanction_end) : null;
  const sanctionActive = !!start && start <= now && (!end || end >= now);
  const sanctionExpired = !!end && end < now;
  // No end date => indefinite sanction (in force until remediated/lifted).
  const sanctionIndefinite = !!start && !end && !sanctionExpired;
  const daysRemaining = end && end >= now ? Math.ceil((end.getTime() - now.getTime()) / 86400000) : null;
  const daysSinceStart = start ? Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400000)) : null;
  return { ...row, sanction_active: sanctionActive, sanction_expired: sanctionExpired, sanction_indefinite: sanctionIndefinite, days_remaining: daysRemaining, days_since_start: daysSinceStart };
}

export const sanctionsRegisterRouter = router({
  // ─── Public endpoints (published notices only) ──────────────────────────
  search: publicProcedure
    .input(z.object({
      query: z.string().optional(),
      noticeType: z.enum(NOTICE_TYPES).optional(),
      status: z.enum(["published", "remediated", "expired"]).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      // Public hot path: cache per filter combination for TTL.SEARCH seconds.
      // NOTE: the cached payload includes computed expiry fields, so
      // days_remaining can be stale by up to the TTL — acceptable for a
      // public register; the DB-backed detail endpoint stays authoritative.
      const cacheKey = CK.sanctionsSearch(
        `${input.query ?? ""}|${input.noticeType ?? ""}|${input.status ?? ""}|${input.page}|${input.limit}`
      );
      return withCache(cacheKey, TTL.SEARCH, async () => {
        const offset = (input.page - 1) * input.limit;
        const params: unknown[] = [];
        // Only publicly-visible notices: published (incl. remediated), never drafts
        const conds: string[] = ["n.status IN ('published','remediated','expired')", "n.published_at IS NOT NULL"];
        if (input.query) {
          params.push(`%${input.query}%`);
          conds.push(`(n.org_name ILIKE $${params.length} OR n.title ILIKE $${params.length} OR n.gazette_number ILIKE $${params.length})`);
        }
        if (input.noticeType) { params.push(input.noticeType); conds.push(`n.notice_type = $${params.length}`); }
        if (input.status) { params.push(input.status); conds.push(`n.status = $${params.length}`); }
        const where = `WHERE ${conds.join(" AND ")}`;
        params.push(input.limit, offset);
        const rows = await exec(
          `SELECT n.id, n.org_name, n.notice_type, n.title, n.summary, n.legal_instrument_ref,
                  n.gazette_number, n.published_at, n.sanction_start, n.sanction_end, n.status, n.public_note
           FROM enforcement_notices n ${where}
           ORDER BY n.published_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params
        );
        const cnt = await exec(`SELECT COUNT(*) as total FROM enforcement_notices n ${where}`, params.slice(0, -2));
        return { data: rows.map(withExpiryFields), total: parseInt(cnt[0]?.total ?? "0", 10) };
      });
    }),

  detail: publicProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT id, org_name, notice_type, title, summary, legal_instrument_ref, gazette_number,
                published_at, sanction_start, sanction_end, status, pdf_ref, public_note
         FROM enforcement_notices
         WHERE id = $1 AND status IN ('published','remediated','expired') AND published_at IS NOT NULL`,
        [input.id]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Notice not found in the public register." });
      return withExpiryFields(rows[0]);
    }),

  stats: publicProcedure.query(async () => {
    // Aggregate over the full register on a public endpoint — cache for
    // TTL.COMPLIANCE seconds; the register changes on admin publish events.
    return withCache(CK.sanctionsStats(), TTL.COMPLIANCE, async () => {
      const rows = await exec(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'published')  as published,
        COUNT(*) FILTER (WHERE status = 'remediated') as remediated,
        COUNT(*) FILTER (WHERE notice_type = 'administrative_fine' AND status IN ('published','remediated')) as fines,
        COUNT(*) FILTER (WHERE sanction_end IS NOT NULL AND sanction_end < CURRENT_DATE AND status = 'published') as expired_periods,
        COUNT(*) FILTER (WHERE published_at > NOW() - INTERVAL '12 months') as published_last_12m
      FROM enforcement_notices
      WHERE published_at IS NOT NULL
    `);
      return rows[0] ?? {};
    });
  }),

  /**
   * Public: organisation applies for delisting after remediation.
   * Requires a single-use org-proof token issued by an NDPC admin (see
   * issueDelistingProof) after verifying the applicant actually represents
   * the sanctioned organisation — otherwise anyone could delist any org.
   * The token is consumed atomically with the request insert.
   */
  requestDelisting: publicProcedure
    .input(z.object({
      noticeId: z.number().int(),
      applicantName: z.string().min(2).max(256),
      applicantEmail: z.string().email(),
      remediationSummary: z.string().min(20).max(5000),
      evidenceRefs: z.array(z.string().max(1024)).max(20).default([]),
      proofToken: z.string().min(32).max(128),
    }))
    .mutation(async ({ input }) => {
      const notice = await exec(
        `SELECT id, organization_id, status FROM enforcement_notices WHERE id = $1 AND status = 'published' AND published_at IS NOT NULL`,
        [input.noticeId]
      );
      if (!notice[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Published notice not found." });
      if (notice[0].organization_id == null) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This notice is not linked to a registered organisation — contact the NDPC directly to request delisting." });
      }
      // Validate the org-proof token: hash-only lookup, active, unexpired,
      // issued for THIS organisation and THIS applicant email.
      const tokenHash = sha256Hex(input.proofToken);
      const tokenRows = await exec(
        `SELECT * FROM delisting_proof_tokens WHERE token_hash = $1`,
        [tokenHash]
      );
      const token = tokenRows[0];
      if (!token || token.status !== "active" || new Date(token.expires_at) <= new Date()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Invalid or expired org-proof token. Request one from the NDPC after verifying your representation of the organisation." });
      }
      if (Number(token.organization_id) !== Number(notice[0].organization_id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Org-proof token was not issued for the sanctioned organisation." });
      }
      const tokenEmail = typeof token.applicant_email === "string" ? decryptField(token.applicant_email) : null;
      if (!tokenEmail || tokenEmail.toLowerCase() !== input.applicantEmail.toLowerCase()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Org-proof token was issued to a different applicant email." });
      }
      const existing = await exec(
        `SELECT id FROM delisting_requests WHERE notice_id = $1 AND status IN ('pending','under_review')`,
        [input.noticeId]
      );
      if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: "A delisting request is already under review for this notice." });
      const rows = await withTransaction(async (tx) => {
        // Consume the token atomically — single-use, replay-proof.
        const consumed = await tx(
          `UPDATE delisting_proof_tokens SET status = 'consumed', consumed_at = NOW()
           WHERE id = $1 AND status = 'active' RETURNING id`,
          [token.id]
        );
        if (!consumed[0]) throw new TRPCError({ code: "CONFLICT", message: "Org-proof token has already been used." });
        return tx(
          `INSERT INTO delisting_requests (notice_id, organization_id, applicant_name, applicant_email, remediation_summary, evidence_refs)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, status, submitted_at`,
          [input.noticeId, notice[0].organization_id ?? null, encryptField(input.applicantName), encryptField(input.applicantEmail), input.remediationSummary, input.evidenceRefs]
        );
      });
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "sanctions_delisting_requested", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  /**
   * Admin: issue a single-use org-proof token for a delisting request. Call
   * this ONLY after verifying (out of band) that the applicant represents the
   * sanctioned organisation. The plaintext token is returned exactly once;
   * only its sha256 hash is stored.
   */
  issueDelistingProof: adminProcedure
    .input(z.object({
      organizationId: z.number().int().positive(),
      applicantEmail: z.string().email(),
      expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgs = await exec(`SELECT id, name FROM organizations WHERE id = $1`, [input.organizationId]);
      if (!orgs[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found." });
      const token = crypto.randomBytes(24).toString("hex");
      const rows = await exec(
        `INSERT INTO delisting_proof_tokens (organization_id, token_hash, applicant_email, issued_by, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5))
         RETURNING id, organization_id, status, expires_at`,
        [input.organizationId, sha256Hex(token), encryptField(input.applicantEmail), String((ctx as any).user?.id ?? "admin"), input.expiresInHours]
      );
      await logAuditEvent("sanctions.delisting_proof_issued", "delisting_proof_token", rows[0]?.id ?? "", String((ctx as any).user?.id ?? ""), { organizationId: input.organizationId });
      return { ...rows[0], token };
    }),

  // ─── NDPC internal: notice lifecycle ────────────────────────────────────
  listAll: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      noticeType: z.enum(NOTICE_TYPES).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.status) { params.push(input.status); conds.push(`n.status = $${params.length}`); }
      if (input.noticeType) { params.push(input.noticeType); conds.push(`n.notice_type = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      params.push(input.limit, offset);
      const rows = await exec(
        `SELECT n.*, o.name as linked_org_name FROM enforcement_notices n
         LEFT JOIN organizations o ON n.organization_id = o.id ${where}
         ORDER BY n.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const cnt = await exec(`SELECT COUNT(*) as total FROM enforcement_notices n ${where}`, params.slice(0, -2));
      return { data: rows.map(withExpiryFields), total: parseInt(cnt[0]?.total ?? "0", 10) };
    }),

  createNotice: adminProcedure
    .input(z.object({
      organizationId: z.number().int().optional(),
      orgName: z.string().min(2).max(256),
      noticeType: z.enum(NOTICE_TYPES),
      title: z.string().min(4).max(512),
      summary: z.string().max(5000).optional(),
      legalInstrumentRef: z.string().max(128).optional(),
      gazetteNumber: z.string().max(64).optional(),
      sanctionStart: z.string().optional(), // ISO date
      sanctionEnd: z.string().optional(),
      pdfRef: z.string().max(1024).optional(),
      publishImmediately: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const publish = input.publishImmediately;
      const rows = await exec(
        `INSERT INTO enforcement_notices
          (organization_id, org_name, notice_type, title, summary, legal_instrument_ref, gazette_number,
           published_at, sanction_start, sanction_end, status, pdf_ref, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7, ${publish ? "NOW()" : "NULL"}, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          input.organizationId ?? null, input.orgName, input.noticeType, input.title,
          input.summary ?? null, input.legalInstrumentRef ?? null, input.gazetteNumber ?? null,
          input.sanctionStart ?? null, input.sanctionEnd ?? null,
          publish ? "published" : "draft", input.pdfRef ?? null, (ctx as any).user?.id ?? null,
        ]
      );
      await logAuditEvent("sanctions.notice_created", "enforcement_notice", rows[0]?.id ?? "", String((ctx as any).user?.id ?? ""), { noticeType: input.noticeType, orgName: input.orgName, published: publish });
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "sanctions_notice_created", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  /**
   * Publish a notice to the public register — DUAL CONTROL (maker-checker,
   * migration 0080 queue + 0102 notice columns):
   *  - Without dualControlRequestId: queues a 'sanction_publication'
   *    dual-control request (the requester can never be an approver) and
   *    records the pending publish on the notice. Nothing goes public yet.
   *  - With dualControlRequestId: verifies the request is approved,
   *    unexpired, unconsumed and refers to THIS notice, then publishes and
   *    consumes the request in one transaction (replay-proof).
   * Approvals are recorded via insiderThreat.approveDualControl (two DISTINCT
   * admins, neither being the requester).
   */
  publishNotice: adminProcedure
    .input(z.object({
      id: z.number().int(),
      gazetteNumber: z.string().max(64).optional(),
      dualControlRequestId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const actor = String((ctx as any).user?.id ?? "");
      if (input.dualControlRequestId == null) {
        // ── Step 1: queue the maker-checker request ──────────────────────
        const notice = await exec(
          `SELECT id, status FROM enforcement_notices WHERE id = $1 AND status = 'draft'`,
          [input.id]
        );
        if (!notice[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Draft notice not found." });
        const pending = await exec(
          `SELECT id FROM dual_control_requests
           WHERE action_type = 'sanction_publication' AND status = 'pending'
             AND (payload->>'notice_id')::int = $1`,
          [input.id]
        );
        if (pending[0]) {
          return { queued: true as const, requestId: pending[0].id, status: "pending" as const };
        }
        const rows = await withTransaction(async (tx) => {
          const req = await tx(
            `INSERT INTO dual_control_requests (action_type, payload, requested_by, threshold_snapshot)
             VALUES ('sanction_publication', $1, $2, $3) RETURNING id`,
            [
              { kind: "sanction_publication", notice_id: input.id, gazette_number: input.gazetteNumber ?? null },
              actor,
              { approvers_required: 2, requester_may_not_approve: true },
            ]
          );
          await tx(
            `UPDATE enforcement_notices
             SET publish_requested_by = $2, publish_requested_at = NOW(), publish_expires_at = NOW() + INTERVAL '72 hours',
                 updated_at = NOW()
             WHERE id = $1`,
            [input.id, actor]
          );
          return req;
        });
        await logAuditEvent("sanctions.notice_publish_requested", "enforcement_notice", input.id, actor, { dualControlRequestId: rows[0]?.id });
        emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "sanctions_notice_publish_requested", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return { queued: true as const, requestId: rows[0]?.id, status: "pending" as const };
      }

      // ── Step 2: execute after two distinct approvals ────────────────────
      const reqs = await exec(
        `SELECT id, action_type, payload, requested_by, first_approver, second_approver, status, expires_at
         FROM dual_control_requests WHERE id = $1`,
        [input.dualControlRequestId]
      );
      const req = reqs[0];
      if (!req || req.action_type !== "sanction_publication") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sanction-publication dual-control request not found." });
      }
      if (req.status !== "approved") {
        throw new TRPCError({ code: "CONFLICT", message: `Dual-control request is '${req.status}' — publication requires an approved request (two distinct approvers).` });
      }
      if (new Date(req.expires_at) <= new Date()) {
        throw new TRPCError({ code: "CONFLICT", message: "Dual-control request has expired — re-request publication." });
      }
      const payload = (req.payload ?? {}) as Record<string, unknown>;
      if (payload.kind !== "sanction_publication" || Number(payload.notice_id) !== input.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Dual-control request does not refer to this notice." });
      }
      const gazette = input.gazetteNumber ?? (payload.gazette_number as string | null) ?? null;
      const rows = await withTransaction(async (tx) => {
        // Consume the request in the same transaction so it cannot be replayed.
        const consumed = await tx(
          `UPDATE dual_control_requests SET status = 'consumed', decided_at = now()
           WHERE id = $1 AND status = 'approved' RETURNING id`,
          [input.dualControlRequestId]
        );
        if (!consumed[0]) {
          throw new TRPCError({ code: "CONFLICT", message: "Dual-control request is no longer approved — it may have been consumed already." });
        }
        return tx(
          `UPDATE enforcement_notices
           SET status = 'published', published_at = NOW(),
               gazette_number = COALESCE($2, gazette_number),
               publish_first_approver = $3, publish_second_approver = $4, updated_at = NOW()
           WHERE id = $1 AND status = 'draft' RETURNING id`,
          [input.id, gazette, req.first_approver ?? null, req.second_approver ?? null]
        );
      });
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Draft notice not found." });
      await logAuditEvent("sanctions.notice_published", "enforcement_notice", input.id, actor, { gazetteNumber: gazette, dualControlRequestId: input.dualControlRequestId, firstApprover: req.first_approver, secondApprover: req.second_approver });
      return { success: true as const, queued: false as const, dualControlRequestId: input.dualControlRequestId };
    }),

  // ─── NDPC internal: delisting review workflow ───────────────────────────
  listDelistingRequests: staffProcedure
    .input(z.object({ status: z.enum(["pending", "under_review", "approved", "rejected"]).optional() }))
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input.status) { params.push(input.status); where = `WHERE d.status = $${params.length}`; }
      return exec(
        `SELECT d.*, n.title as notice_title, n.org_name, n.notice_type
         FROM delisting_requests d
         JOIN enforcement_notices n ON d.notice_id = n.id
         ${where} ORDER BY d.submitted_at ASC`
      , params);
    }),

  reviewDelistingRequest: adminProcedure
    .input(z.object({
      id: z.number().int(),
      decision: z.enum(["under_review", "approved", "rejected"]),
      reviewerNotes: z.string().max(5000).optional(),
      publicNote: z.string().max(2000).optional(), // shown publicly when approved
    }))
    .mutation(async ({ input, ctx }) => {
      const reqs = await exec(`SELECT * FROM delisting_requests WHERE id = $1 AND status IN ('pending','under_review')`, [input.id]);
      if (!reqs[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Open delisting request not found." });
      const userId = String((ctx as any).user?.id ?? "");
      await exec(
        `UPDATE delisting_requests SET status = $1, reviewer_id = $2, reviewer_notes = $3,
           reviewed_at = CASE WHEN $1 IN ('approved','rejected') THEN NOW() ELSE reviewed_at END, updated_at = NOW()
         WHERE id = $4`,
        [input.decision, (ctx as any).user?.id ?? null, input.reviewerNotes ?? null, input.id]
      );
      // On approval the notice flips to 'remediated' with a public note
      if (input.decision === "approved") {
        await exec(
          `UPDATE enforcement_notices SET status = 'remediated', public_note = $2, updated_at = NOW() WHERE id = $1`,
          [reqs[0].notice_id, input.publicNote ?? "Sanction remediated — organisation delisted following verified remediation."]
        );
      }
      await logAuditEvent(`sanctions.delisting_${input.decision}`, "delisting_request", input.id, userId, { noticeId: reqs[0].notice_id });
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "sanctions_delisting_reviewed", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, decision: input.decision };
    }),

  /**
   * Expiry sweep (admin / cron): flips published notices whose sanction_end
   * has passed to status='expired'. Idempotent — safe to run daily.
   */
  expireSweep: adminProcedure
    .mutation(async ({ ctx }) => {
      const rows = await exec(
        `UPDATE enforcement_notices SET status = 'expired', updated_at = NOW()
         WHERE status = 'published' AND sanction_end IS NOT NULL AND sanction_end < CURRENT_DATE
         RETURNING id`,
      );
      await logAuditEvent("sanctions.expire_sweep", "enforcement_notice", "", String((ctx as any).user?.id ?? ""), { expired: rows.length });
      return { expired: rows.length };
    }),
});
