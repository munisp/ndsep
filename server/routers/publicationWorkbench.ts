/**
 * Publication Workbench Router — NDPA 2023 ss.48-49
 * =================================================
 * Publication pipeline for enforcement decisions:
 *   draft -> legal_review -> redaction -> approval (dual control, two DISTINCT
 *   approvers, neither may be the drafter) -> published -> corrected/withdrawn
 *   (with a public notice).
 *
 * Redaction (services/redaction.ts) produces a redacted public text plus a
 * redaction MAP; the map is stored separately in redaction_tasks and exposed
 * ONLY via adminProcedure. Every redaction run requires reviewer sign-off
 * before the document can advance. Publishing follows the sanctions-register
 * display conventions (0050) but writes to publication_documents — the
 * sanctionsRegister tables are never edited here.
 *
 * Public endpoints (listPublished / getPublished) return only published and
 * corrected documents and write a disclosure_access_log entry for every read
 * (FOIA accountability).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField } from "../encryption";
import { applyRedactionRules } from "../services/redaction";

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
    logger.error({ err, query: query.slice(0, 200) }, "[publicationWorkbench] DB query error");
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
    logger.warn({ err, action, resourceType }, "[publicationWorkbench] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

const DOC_TYPES = ["final_order", "undertaking", "administrative_fine", "reprimand", "decision", "guidance", "other"] as const;
const PIPELINE_STATUSES = ["draft", "legal_review", "redaction", "approval", "published", "corrected", "withdrawn"] as const;

/** Columns that are safe to return to the public (never body_raw, never maps). */
const PUBLIC_COLUMNS = `id, case_id, organization_id, org_name, doc_type, title, summary,
  body_redacted, legal_instrument_ref, gazette_number, status, public_note,
  published_at, corrected_at`;

/** FOIA-accountability disclosure log for public reads. */
async function logDisclosureAccess(
  documentId: number | null,
  endpoint: "list" | "detail",
  user: { id?: unknown } | null | undefined
): Promise<void> {
  try {
    const authenticated = user?.id != null;
    await exec(
      `INSERT INTO disclosure_access_log (document_id, accessor_type, accessor_id, accessor_ref, endpoint)
       VALUES ($1, $2, $3, NULL, $4)`,
      [documentId, authenticated ? "authenticated" : "anonymous", authenticated ? String(user!.id) : null, endpoint]
    );
  } catch (err) {
    logger.warn({ err, documentId, endpoint }, "[publicationWorkbench] Disclosure access log write failed");
  }
}

async function getDocOr404(id: number): Promise<any> {
  const [row] = await exec(`SELECT * FROM publication_documents WHERE id = $1`, [id]);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Publication document not found" });
  return row;
}

async function transition(id: number, from: string[], to: string): Promise<any> {
  const placeholders = from.map((_, i) => `$${i + 2}`).join(",");
  const [row] = await exec(
    `UPDATE publication_documents SET status = $1, updated_at = NOW()
     WHERE id = $${from.length + 2} AND status IN (${placeholders}) RETURNING *`,
    [to, ...from, id]
  );
  return row;
}

export const publicationWorkbenchRouter = router({
  // ─── Draft creation (from an enforcement case) ────────────────────────────
  createDraft: protectedProcedure
    .input(z.object({
      caseId: z.number().int().positive().optional(),
      organizationId: z.number().int().positive().optional(),
      orgName: z.string().min(2).max(256).optional(),
      docType: z.enum(DOC_TYPES),
      title: z.string().min(4).max(512),
      summary: z.string().max(5000).optional(),
      bodyRaw: z.string().min(1).max(200_000),
      legalInstrumentRef: z.string().max(128).optional(),
      gazetteNumber: z.string().max(64).optional(),
      investigationSensitive: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.caseId != null) {
        // Defensive: the case must exist; a missing case is an error, not a silent pass.
        const cases = await exec(`SELECT id FROM enforcement_actions WHERE id = $1`, [input.caseId]);
        if (!cases[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Originating enforcement case not found" });
      }
      const [row] = await exec(
        `INSERT INTO publication_documents
           (case_id, organization_id, org_name, doc_type, title, summary, body_raw,
            legal_instrument_ref, gazette_number, investigation_sensitive, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11)
         RETURNING id, status, created_at`,
        [
          input.caseId ?? null, input.organizationId ?? null, input.orgName ?? null,
          input.docType, input.title, input.summary ?? null, encryptField(input.bodyRaw),
          input.legalInstrumentRef ?? null, input.gazetteNumber ?? null,
          input.investigationSensitive, ctx.user.name ?? String(ctx.user.id),
        ]
      );
      await logAudit("publication_draft_created", "publication_documents", row?.id, String(ctx.user.id), {
        doc_type: input.docType, case_id: input.caseId ?? null,
      });
      fireAndForget("publicationWorkbench.createDraft");
      return row;
    }),

  // ─── Pipeline transitions ─────────────────────────────────────────────────
  submitForLegalReview: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const row = await transition(input.id, ["draft"], "legal_review");
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Only a draft can enter legal review" });
      await logAudit("publication_submitted_legal_review", "publication_documents", input.id, String(ctx.user.id), {});
      fireAndForget("publicationWorkbench.submitForLegalReview");
      return { id: row.id, status: row.status };
    }),

  /** Legal reviewer records a decision; approval moves the doc to redaction. */
  recordLegalReview: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const doc = await getDocOr404(input.id);
      if (doc.status !== "legal_review") {
        throw new TRPCError({ code: "CONFLICT", message: "Document is not in legal review" });
      }
      try {
        await exec(
          `INSERT INTO publication_approvals (document_id, stage, approver_id, approver_name, decision, note)
           VALUES ($1, 'legal_review', $2, $3, $4, $5)`,
          [input.id, String(ctx.user.id), ctx.user.name ?? null, input.decision, input.note ?? null]
        );
      } catch (err) {
        throw new TRPCError({ code: "CONFLICT", message: "You have already recorded a legal review decision for this document" });
      }
      const next = input.decision === "approved" ? "redaction" : "draft";
      const row = await transition(input.id, ["legal_review"], next);
      await logAudit("publication_legal_review_recorded", "publication_documents", input.id, String(ctx.user.id), { decision: input.decision });
      fireAndForget("publicationWorkbench.recordLegalReview");
      return { id: row.id, status: row.status };
    }),

  /**
   * Run the redaction engine over body_raw. Stores the redacted text on the
   * document and the redaction MAP separately in redaction_tasks (admin-only).
   * Redaction is not complete until a reviewer signs off.
   */
  runRedaction: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      minorNames: z.array(z.string().min(1).max(256)).max(100).default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      const doc = await getDocOr404(input.id);
      if (doc.status !== "redaction") {
        throw new TRPCError({ code: "CONFLICT", message: "Document must be in the redaction stage" });
      }
      if (!doc.body_raw) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Document has no source text to redact" });
      }
      const result = applyRedactionRules(doc.body_raw, {
        minorNames: input.minorNames,
        investigationSensitive: !!doc.investigation_sensitive,
      });
      const [task] = await exec(
        `INSERT INTO redaction_tasks (document_id, redaction_map, rules_applied, minor_names_applied, status, created_by)
         VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING id, status, created_at`,
        [
          input.id,
          JSON.stringify(result.map),
          JSON.stringify(result.rulesApplied),
          JSON.stringify(result.minorNamesApplied),
          ctx.user.name ?? String(ctx.user.id),
        ]
      );
      await exec(
        `UPDATE publication_documents
         SET body_redacted = $2, redaction_complete = FALSE, updated_at = NOW()
         WHERE id = $1`,
        [input.id, result.redacted]
      );
      await logAudit("publication_redaction_run", "publication_documents", input.id, String(ctx.user.id), {
        redaction_task_id: task?.id,
        redactions_made: result.map.length,
        rules_applied: result.rulesApplied,
        minor_names_applied: result.minorNamesApplied.length,
        investigation_sensitive_applied: result.investigationSensitiveApplied,
      });
      fireAndForget("publicationWorkbench.runRedaction");
      return {
        redactionTaskId: task?.id,
        redactionsMade: result.map.length,
        rulesApplied: result.rulesApplied,
        preview: result.redacted.slice(0, 2000),
      };
    }),

  /** Reviewer sign-off on a redaction task; reviewer must differ from the redactor. */
  signOffRedaction: protectedProcedure
    .input(z.object({
      redactionTaskId: z.number().int().positive(),
      note: z.string().max(5000).optional(),
      reject: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const [task] = await exec(`SELECT * FROM redaction_tasks WHERE id = $1`, [input.redactionTaskId]);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Redaction task not found" });
      if (task.status !== "pending") {
        throw new TRPCError({ code: "CONFLICT", message: "Redaction task already decided" });
      }
      const reviewer = ctx.user.name ?? String(ctx.user.id);
      if (task.created_by && task.created_by === reviewer) {
        throw new TRPCError({ code: "FORBIDDEN", message: "The redactor cannot sign off their own redaction (second pair of eyes required)" });
      }
      const [updated] = await exec(
        `UPDATE redaction_tasks
         SET status = $2, reviewer_id = $3, reviewer_note = $4, signed_off_at = NOW()
         WHERE id = $1 AND status = 'pending' RETURNING id, status, document_id`,
        [input.redactionTaskId, input.reject ? "rejected" : "signed_off", reviewer, input.note ?? null]
      );
      if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Redaction task already decided" });
      if (!input.reject) {
        await exec(
          `UPDATE publication_documents SET redaction_complete = TRUE, updated_at = NOW() WHERE id = $1`,
          [updated.document_id]
        );
      }
      await logAudit("publication_redaction_signed_off", "redaction_tasks", input.redactionTaskId, String(ctx.user.id), {
        document_id: updated.document_id, rejected: input.reject,
      });
      fireAndForget("publicationWorkbench.signOffRedaction");
      return updated;
    }),

  /** Advance to approval: requires a signed-off redaction. */
  submitForApproval: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const doc = await getDocOr404(input.id);
      if (doc.status !== "redaction") {
        throw new TRPCError({ code: "CONFLICT", message: "Document must be in the redaction stage to enter approval" });
      }
      if (!doc.redaction_complete || !doc.body_redacted) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Redaction must be run and signed off before approval" });
      }
      const row = await transition(input.id, ["redaction"], "approval");
      await logAudit("publication_submitted_approval", "publication_documents", input.id, String(ctx.user.id), {});
      fireAndForget("publicationWorkbench.submitForApproval");
      return { id: row.id, status: row.status };
    }),

  /**
   * Dual-control approval: each DISTINCT approver records a decision; the
   * drafter may NOT approve their own document. Publication requires two
   * distinct approvals (enforced again at publish time).
   */
  approve: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const doc = await getDocOr404(input.id);
      if (doc.status !== "approval") {
        throw new TRPCError({ code: "CONFLICT", message: "Document is not in the approval stage" });
      }
      if (doc.created_by && doc.created_by === (ctx.user.name ?? String(ctx.user.id))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "The drafter cannot approve their own document (dual control)" });
      }
      try {
        await exec(
          `INSERT INTO publication_approvals (document_id, stage, approver_id, approver_name, decision, note)
           VALUES ($1, 'publication', $2, $3, $4, $5)`,
          [input.id, String(ctx.user.id), ctx.user.name ?? null, input.decision, input.note ?? null]
        );
      } catch (err) {
        throw new TRPCError({ code: "CONFLICT", message: "You have already recorded an approval decision for this document" });
      }
      if (input.decision === "rejected") {
        // Any rejection sends the document back to redaction for rework.
        await transition(input.id, ["approval"], "redaction");
      }
      const approvals = await exec(
        `SELECT COUNT(DISTINCT approver_id)::int AS n FROM publication_approvals
         WHERE document_id = $1 AND stage = 'publication' AND decision = 'approved'`,
        [input.id]
      );
      await logAudit("publication_approval_recorded", "publication_documents", input.id, String(ctx.user.id), {
        decision: input.decision, distinct_approvals: approvals[0]?.n ?? 0,
      });
      fireAndForget("publicationWorkbench.approve");
      return {
        id: input.id,
        decision: input.decision,
        distinctApprovals: approvals[0]?.n ?? 0,
        readyToPublish: input.decision !== "rejected" && (approvals[0]?.n ?? 0) >= 2,
      };
    }),

  /** Publish: re-verifies dual control + redaction sign-off before going public. */
  publish: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const doc = await getDocOr404(input.id);
      if (doc.status !== "approval") {
        throw new TRPCError({ code: "CONFLICT", message: "Document must be in the approval stage to publish" });
      }
      if (!doc.redaction_complete || !doc.body_redacted) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Redaction incomplete — refusing to publish unredacted content" });
      }
      const approvals = await exec(
        `SELECT DISTINCT approver_id FROM publication_approvals
         WHERE document_id = $1 AND stage = 'publication' AND decision = 'approved'`,
        [input.id]
      );
      const approverIds = approvals.map((a) => String(a.approver_id));
      if (approverIds.length < 2) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Dual control not satisfied: ${approverIds.length}/2 distinct approvals recorded` });
      }
      if (doc.created_by && approverIds.includes(doc.created_by)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Dual control violated: drafter counted among approvers" });
      }
      const [row] = await exec(
        `UPDATE publication_documents SET status = 'published', published_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'approval' RETURNING id, status, published_at`,
        [input.id]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Document state changed — re-attempt publish" });
      await logAudit("publication_published", "publication_documents", input.id, String(ctx.user.id), {
        approvers: approverIds,
      });
      fireAndForget("publicationWorkbench.publish");
      return row;
    }),

  /** Post-publication correction with a public notice. */
  correct: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      publicNote: z.string().min(10).max(5000),
      correctedBody: z.string().min(1).max(200_000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const doc = await getDocOr404(input.id);
      if (doc.status !== "published" && doc.status !== "corrected") {
        throw new TRPCError({ code: "CONFLICT", message: "Only a published document can be corrected" });
      }
      let bodyRedacted = doc.body_redacted;
      if (input.correctedBody != null) {
        // Corrections must also pass through the redaction engine before display.
        bodyRedacted = applyRedactionRules(input.correctedBody, {
          investigationSensitive: !!doc.investigation_sensitive,
        }).redacted;
      }
      const [row] = await exec(
        `UPDATE publication_documents
         SET status = 'corrected', public_note = $2, body_redacted = $3, corrected_at = NOW(), updated_at = NOW()
         WHERE id = $1 RETURNING id, status, corrected_at`,
        [input.id, input.publicNote, bodyRedacted]
      );
      await logAudit("publication_corrected", "publication_documents", input.id, String(ctx.user.id), {
        body_replaced: input.correctedBody != null,
      });
      fireAndForget("publicationWorkbench.correct");
      return row;
    }),

  /** Withdrawal with a public notice; document leaves the public register. */
  withdraw: adminProcedure
    .input(z.object({ id: z.number().int().positive(), publicNote: z.string().min(10).max(5000) }))
    .mutation(async ({ input, ctx }) => {
      const row = await transition(input.id, ["published", "corrected"], "withdrawn");
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Only a published or corrected document can be withdrawn" });
      await exec(
        `UPDATE publication_documents SET public_note = $2, withdrawn_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [input.id, input.publicNote]
      );
      await logAudit("publication_withdrawn", "publication_documents", input.id, String(ctx.user.id), {});
      fireAndForget("publicationWorkbench.withdraw");
      return { id: row.id, status: "withdrawn" };
    }),

  // ─── Public register (published/corrected only; disclosure-logged) ────────
  listPublished: publicProcedure
    .input(z.object({
      query: z.string().optional(),
      docType: z.enum(DOC_TYPES).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      const conds: string[] = [`status IN ('published','corrected')`, `published_at IS NOT NULL`];
      if (input.query) {
        params.push(`%${input.query}%`);
        conds.push(`(org_name ILIKE $${params.length} OR title ILIKE $${params.length} OR gazette_number ILIKE $${params.length})`);
      }
      if (input.docType) { params.push(input.docType); conds.push(`doc_type = $${params.length}`); }
      const where = `WHERE ${conds.join(" AND ")}`;
      params.push(input.limit, offset);
      const rows = await exec(
        `SELECT ${PUBLIC_COLUMNS} FROM publication_documents ${where}
         ORDER BY published_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const cnt = await exec(`SELECT COUNT(*) as total FROM publication_documents ${where}`, params.slice(0, -2));
      await logDisclosureAccess(null, "list", ctx.user);
      return { data: rows, total: parseInt(cnt[0]?.total ?? "0", 10) };
    }),

  getPublished: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const [row] = await exec(
        `SELECT ${PUBLIC_COLUMNS} FROM publication_documents
         WHERE id = $1 AND status IN ('published','corrected') AND published_at IS NOT NULL`,
        [input.id]
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found in the public register" });
      await logDisclosureAccess(input.id, "detail", ctx.user);
      return row;
    }),

  // ─── Internal reads ───────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      status: z.enum(PIPELINE_STATUSES).optional(),
      docType: z.enum(DOC_TYPES).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.status) { params.push(input.status); conds.push(`status = $${params.length}`); }
      if (input.docType) { params.push(input.docType); conds.push(`doc_type = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      params.push(input.limit, offset);
      const rows = await exec(
        `SELECT id, case_id, organization_id, org_name, doc_type, title, summary,
                redaction_complete, investigation_sensitive, legal_instrument_ref,
                gazette_number, status, public_note, published_at, corrected_at,
                withdrawn_at, created_by, created_at, updated_at
         FROM publication_documents ${where}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const cnt = await exec(`SELECT COUNT(*) as total FROM publication_documents ${where}`, params.slice(0, -2));
      return { data: rows, total: parseInt(cnt[0]?.total ?? "0", 10) };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const doc = await getDocOr404(input.id);
      const tasks = await exec(
        `SELECT id, status, reviewer_id, signed_off_at, created_by, created_at, rules_applied, minor_names_applied
         FROM redaction_tasks WHERE document_id = $1 ORDER BY created_at DESC`,
        [input.id]
      );
      const approvals = await exec(
        `SELECT id, stage, approver_id, approver_name, decision, note, created_at
         FROM publication_approvals WHERE document_id = $1 ORDER BY created_at ASC`,
        [input.id]
      );
      // body_raw is included for internal users only; redaction_map is NOT (admin-only endpoint below).
      return { ...doc, redaction_tasks: tasks, approvals };
    }),

  /** ADMIN-ONLY: the redaction map (original values). Never exposed elsewhere. */
  getRedactionMap: adminProcedure
    .input(z.object({ redactionTaskId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const [task] = await exec(`SELECT * FROM redaction_tasks WHERE id = $1`, [input.redactionTaskId]);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Redaction task not found" });
      await logAudit("redaction_map_accessed", "redaction_tasks", input.redactionTaskId, String(ctx.user.id), {
        document_id: task.document_id,
      });
      return task;
    }),

  /** ADMIN-ONLY: disclosure access log (FOIA accountability). */
  listDisclosureAccess: adminProcedure
    .input(z.object({
      documentId: z.number().int().positive().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      let where = "";
      if (input.documentId) { params.push(input.documentId); where = `WHERE document_id = $1`; }
      params.push(input.limit, offset);
      const rows = await exec(
        `SELECT * FROM disclosure_access_log ${where}
         ORDER BY accessed_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const cnt = await exec(`SELECT COUNT(*) as total FROM disclosure_access_log ${where}`, params.slice(0, -2));
      return { data: rows, total: parseInt(cnt[0]?.total ?? "0", 10) };
    }),

  stats: protectedProcedure.query(async () => {
    const rows = await exec(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft')         AS drafts,
        COUNT(*) FILTER (WHERE status = 'legal_review')  AS in_legal_review,
        COUNT(*) FILTER (WHERE status = 'redaction')     AS in_redaction,
        COUNT(*) FILTER (WHERE status = 'approval')      AS awaiting_approval,
        COUNT(*) FILTER (WHERE status IN ('published','corrected')) AS published,
        COUNT(*) FILTER (WHERE status = 'withdrawn')     AS withdrawn,
        (SELECT COUNT(*) FROM redaction_tasks WHERE status = 'pending') AS pending_redaction_signoffs
      FROM publication_documents
    `);
    return rows[0] ?? {};
  }),
});
