/**
 * Public Sanctions Register Router (Gap 13)
 * NDPA 2023 ss. 48-49 — public register of enforcement notices
 * (final orders, undertakings, administrative fines, reprimands),
 * with a delisting-after-remediation workflow and sanction-period
 * expiry computed fields.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { logAuditEvent } from "../middlewareHelpers";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { withCache, CK, TTL } from "../queryCache";

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
    return autoDecryptRows(query, result.rows ?? []);
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[sanctions] DB query error");
    return [];
  }
}

const NOTICE_TYPES = ["final_order", "undertaking", "administrative_fine", "reprimand"] as const;

// Computed sanction-period expiry fields, attached to any notice row.
function withExpiryFields<T extends Record<string, any>>(row: T) {
  const now = new Date();
  const start = row.sanction_start ? new Date(row.sanction_start) : null;
  const end = row.sanction_end ? new Date(row.sanction_end) : null;
  const sanctionActive = !!start && start <= now && (!end || end >= now);
  const sanctionExpired = !!end && end < now;
  const daysRemaining = end && end >= now ? Math.ceil((end.getTime() - now.getTime()) / 86400000) : null;
  const daysSinceStart = start ? Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400000)) : null;
  return { ...row, sanction_active: sanctionActive, sanction_expired: sanctionExpired, days_remaining: daysRemaining, days_since_start: daysSinceStart };
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

  /** Public: organisation applies for delisting after remediation */
  requestDelisting: publicProcedure
    .input(z.object({
      noticeId: z.number().int(),
      applicantName: z.string().min(2).max(256),
      applicantEmail: z.string().email(),
      remediationSummary: z.string().min(20).max(5000),
      evidenceRefs: z.array(z.string().max(1024)).max(20).default([]),
    }))
    .mutation(async ({ input }) => {
      const notice = await exec(
        `SELECT id, organization_id, status FROM enforcement_notices WHERE id = $1 AND status = 'published' AND published_at IS NOT NULL`,
        [input.noticeId]
      );
      if (!notice[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Published notice not found." });
      const existing = await exec(
        `SELECT id FROM delisting_requests WHERE notice_id = $1 AND status IN ('pending','under_review')`,
        [input.noticeId]
      );
      if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: "A delisting request is already under review for this notice." });
      const rows = await exec(
        `INSERT INTO delisting_requests (notice_id, organization_id, applicant_name, applicant_email, remediation_summary, evidence_refs)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, status, submitted_at`,
        [input.noticeId, notice[0].organization_id ?? null, input.applicantName, input.applicantEmail, input.remediationSummary, input.evidenceRefs]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "sanctions_delisting_requested", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
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

  publishNotice: adminProcedure
    .input(z.object({ id: z.number().int(), gazetteNumber: z.string().max(64).optional() }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE enforcement_notices
         SET status = 'published', published_at = NOW(),
             gazette_number = COALESCE($2, gazette_number), updated_at = NOW()
         WHERE id = $1 AND status = 'draft' RETURNING id`,
        [input.id, input.gazetteNumber ?? null]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Draft notice not found." });
      await logAuditEvent("sanctions.notice_published", "enforcement_notice", input.id, String((ctx as any).user?.id ?? ""), { gazetteNumber: input.gazetteNumber ?? null });
      return { success: true };
    }),

  // ─── NDPC internal: delisting review workflow ───────────────────────────
  listDelistingRequests: protectedProcedure
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
});
