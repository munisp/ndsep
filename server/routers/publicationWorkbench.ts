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
 * Round-scoped approvals (migration 0102): every approval row carries an
 * approval_round; any rejection or correction supersedes the prior round's
 * approvals and increments the document's round, so publish counts ONLY
 * current-round, non-superseded approvals. Corrections run a sub-pipeline
 * (0102 pending_* columns): the live version stays public while the corrected
 * text goes through redaction sign-off + dual re-approval before re-publish.
 *
 * Public endpoints (listPublished / getPublished) return only published and
 * corrected documents and write a disclosure_access_log entry for every read
 * (FOIA accountability), including a salted accessor_ref hash.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, staffProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField, decryptField } from "../encryption";
import { applyRedactionRules } from "../services/redaction";
import { hmacSha256Hex, ipHashSalt, extractClientIp } from "../services/complaintLogic";

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

type TxClient = { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> };

function safeParams(params: unknown[]): unknown[] {
  return params.map((p) =>
    Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date))
      ? JSON.stringify(p)
      : p
  );
}

/**
 * Multi-write mutations run inside a real PostgreSQL transaction so a
 * half-applied pipeline transition (e.g. approvals superseded but the status
 * flip lost) is impossible. Decryption is applied per statement.
 */
async function withTransaction<T>(fn: (tx: (q: string, p?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const client = (await pool.connect()) as unknown as TxClient & { release: () => void };
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
    logger.error({ err }, "[publicationWorkbench] transaction failed — rolled back");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error", cause: err });
  } finally {
    client.release();
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

/** Roles allowed to see unredacted source text (mirrors staffProcedure). */
const STAFF_ROLES = ["admin", "government_staff", "auditor"];

/** Columns that are safe to return to the public (never body_raw, never maps). */
const PUBLIC_COLUMNS = `id, case_id, organization_id, org_name, doc_type, title, summary,
  body_redacted, legal_instrument_ref, gazette_number, status, public_note,
  published_at, corrected_at`;

const TRUSTED_PROXY_COUNT = Math.max(0, parseInt(process.env.NDSEP_TRUSTED_PROXY_COUNT ?? "0", 10) || 0);

/**
 * Salted, keyed hash of the accessor identity for disclosure_access_log.
 * Never stores a raw user id / IP in accessor_ref — the salt comes from the
 * mandatory env secret (ipHashSalt fails closed in production when unset).
 */
function accessorRefHash(user: { id?: unknown } | null | undefined, req: any): string {
  const authenticated = user?.id != null;
  const identity = authenticated
    ? `user:${String(user!.id)}`
    : `ip:${extractClientIp(req?.headers, req?.ip ?? req?.socket?.remoteAddress, TRUSTED_PROXY_COUNT)}`;
  return hmacSha256Hex(ipHashSalt(), `publication-disclosure|${identity}`);
}

/** FOIA-accountability disclosure log for public reads. */
async function logDisclosureAccess(
  documentId: number | null,
  endpoint: "list" | "detail",
  user: { id?: unknown } | null | undefined,
  req: any
): Promise<void> {
  try {
    const authenticated = user?.id != null;
    await exec(
      `INSERT INTO disclosure_access_log (document_id, accessor_type, accessor_id, accessor_ref, endpoint)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        documentId,
        authenticated ? "authenticated" : "anonymous",
        authenticated ? String(user!.id) : null,
        accessorRefHash(user, req),
        endpoint,
      ]
    );
  } catch (err) {
    logger.warn({ err, documentId, endpoint }, "[publicationWorkbench] Disclosure access log write failed");
  }
}

async function getDocOr404(id: number): Promise<any> {
  const [row] = await exec(`SELECT * FROM publication_documents WHERE id = $1`, [id]);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Publication document not found" });
  // Defence in depth: autoDecryptRows already decrypts body_raw for queries
  // against publication_documents (it is registered in PII_FIELDS), but if a
  // row predates the middleware or the registry mapping ever misses, decrypt
  // explicitly. decryptField passes plaintext through unchanged.
  if (typeof row.body_raw === "string") {
    row.body_raw = decryptField(row.body_raw, { table: "publication_documents", column: "body_raw" });
  }
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

/**
 * Round-scoped approval bookkeeping: supersede every live approval row for
 * the document (the old round is closed) and return the NEW approval round.
 * Callers must run this inside withTransaction with the accompanying state
 * change so the bump is atomic with the rejection/correction.
 */
const SUPERSEDE_APPROVALS_SQL =
  `UPDATE publication_approvals SET superseded = TRUE
   WHERE document_id = $1 AND superseded = FALSE`;
const BUMP_ROUND_SQL =
  `UPDATE publication_documents SET approval_round = approval_round + 1, updated_at = NOW()
   WHERE id = $1 RETURNING approval_round`;

/** Count DISTINCT approvers in the CURRENT round for a stage (publish gate). */
async function currentRoundApprovals(
  query: (q: string, p?: unknown[]) => Promise<any[]>,
  documentId: number,
  stage: "publication" | "correction",
  round: number
): Promise<string[]> {
  const rows = await query(
    `SELECT DISTINCT approver_id FROM publication_approvals
     WHERE document_id = $1 AND stage = $2 AND decision = 'approved'
       AND approval_round = $3 AND superseded = FALSE`,
    [documentId, stage, round]
  );
  return rows.map((r) => String(r.approver_id));
}

export const publicationWorkbenchRouter = router({
  // ─── Draft creation (from an enforcement case) ────────────────────────────
  createDraft: staffProcedure
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

  // ─── Pipeline transitions (staff-only drivers) ────────────────────────────
  submitForLegalReview: staffProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const row = await transition(input.id, ["draft"], "legal_review");
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Only a draft can enter legal review" });
      await logAudit("publication_submitted_legal_review", "publication_documents", input.id, String(ctx.user.id), {});
      fireAndForget("publicationWorkbench.submitForLegalReview");
      return { id: row.id, status: row.status };
    }),

  /**
   * Legal reviewer records a decision in the CURRENT approval round; approval
   * moves the doc to redaction. A rejection supersedes the round's
   * legal_review approvals, bumps the round and sends the doc back to draft.
   */
  recordLegalReview: staffProcedure
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
      const round = Number(doc.approval_round ?? 1);
      let nextStatus: string;
      try {
        nextStatus = await withTransaction(async (tx) => {
          await tx(
            `INSERT INTO publication_approvals (document_id, stage, approver_id, approver_name, decision, note, approval_round)
             VALUES ($1, 'legal_review', $2, $3, $4, $5, $6)`,
            [input.id, String(ctx.user.id), ctx.user.name ?? null, input.decision, input.note ?? null, round]
          );
          const next = input.decision === "approved" ? "redaction" : "draft";
          if (input.decision === "rejected") {
            // Round-scoped approvals: a rejection expires the round's prior
            // decisions and opens a fresh round for the reworked draft.
            await tx(SUPERSEDE_APPROVALS_SQL, [input.id]);
            await tx(BUMP_ROUND_SQL, [input.id]);
          }
          const [row] = await tx(
            `UPDATE publication_documents SET status = $1, updated_at = NOW()
             WHERE id = $2 AND status = 'legal_review' RETURNING id, status`,
            [next, input.id]
          );
          if (!row) throw new TRPCError({ code: "CONFLICT", message: "Document state changed — re-attempt" });
          return row.status as string;
        });
      } catch (err) {
        // Unique-violation (23505) on (document, stage, approver, round):
        // the reviewer already decided in this round.
        if (err instanceof TRPCError && (err as { cause?: { code?: string } }).cause?.code === "23505") {
          throw new TRPCError({ code: "CONFLICT", message: "You have already recorded a legal review decision for this document in this round" });
        }
        throw err;
      }
      await logAudit("publication_legal_review_recorded", "publication_documents", input.id, String(ctx.user.id), { decision: input.decision, approval_round: round });
      fireAndForget("publicationWorkbench.recordLegalReview");
      return { id: input.id, status: nextStatus };
    }),

  /**
   * Run the redaction engine over body_raw. Stores the redacted text on the
   * document and the redaction MAP separately in redaction_tasks (admin-only).
   * Redaction is not complete until a reviewer signs off.
   */
  runRedaction: staffProcedure
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

  /**
   * Reviewer sign-off on a redaction task; reviewer must differ from the
   * redactor. Sign-off on a correction task (pending_redaction_task_id) gates
   * the correction re-publish; sign-off on a main-pipeline task sets
   * redaction_complete.
   */
  signOffRedaction: staffProcedure
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
      // Main-pipeline sign-off completes redaction only when this task is the
      // document's latest run (not a correction task, not a superseded run).
      if (!input.reject) {
        await exec(
          `UPDATE publication_documents SET redaction_complete = TRUE, updated_at = NOW()
           WHERE id = $1 AND status = 'redaction'
             AND (pending_redaction_task_id IS NULL OR pending_redaction_task_id <> $2)`,
          [updated.document_id, input.redactionTaskId]
        );
      }
      await logAudit("publication_redaction_signed_off", "redaction_tasks", input.redactionTaskId, String(ctx.user.id), {
        document_id: updated.document_id, rejected: input.reject,
      });
      fireAndForget("publicationWorkbench.signOffRedaction");
      return updated;
    }),

  /** Advance to approval: requires a signed-off redaction. */
  submitForApproval: staffProcedure
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
   * Dual-control approval in the CURRENT approval round: each DISTINCT
   * approver records a decision; the drafter may NOT approve their own
   * document. Publication requires two distinct current-round approvals
   * (enforced again at publish time). For documents with a pending correction
   * the decision is recorded at the 'correction' stage.
   *
   * Any rejection expires the round's approvals (superseded = TRUE), bumps
   * the approval round and sends the document back: main-pipeline rejections
   * return to redaction; correction rejections drop the pending correction
   * (the live published version is untouched).
   */
  approve: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const doc = await getDocOr404(input.id);
      const isCorrection = doc.correction_pending === true;
      if (!isCorrection && doc.status !== "approval") {
        throw new TRPCError({ code: "CONFLICT", message: "Document is not in the approval stage" });
      }
      if (isCorrection && doc.status !== "published" && doc.status !== "corrected") {
        throw new TRPCError({ code: "CONFLICT", message: "Correction approval requires a published document" });
      }
      if (doc.created_by && doc.created_by === (ctx.user.name ?? String(ctx.user.id))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "The drafter cannot approve their own document (dual control)" });
      }
      const stage = isCorrection ? "correction" : "publication";
      const round = Number(doc.approval_round ?? 1);
      let distinctApprovals = 0;
      try {
        distinctApprovals = await withTransaction(async (tx) => {
          await tx(
            `INSERT INTO publication_approvals (document_id, stage, approver_id, approver_name, decision, note, approval_round)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [input.id, stage, String(ctx.user.id), ctx.user.name ?? null, input.decision, input.note ?? null, round]
          );
          if (input.decision === "rejected") {
            // Round-scoped: expire every live approval, open a fresh round.
            await tx(SUPERSEDE_APPROVALS_SQL, [input.id]);
            await tx(BUMP_ROUND_SQL, [input.id]);
            if (isCorrection) {
              // Correction rejected: drop the pending correction; the live
              // version stays public. A new correct() call restarts the
              // sub-pipeline (fresh redaction run + sign-off required).
              await tx(
                `UPDATE redaction_tasks SET status = 'rejected', reviewer_note = 'correction rejected at approval', signed_off_at = NOW()
                 WHERE id = (SELECT pending_redaction_task_id FROM publication_documents WHERE id = $1)
                   AND status = 'pending'`,
                [input.id]
              );
              await tx(
                `UPDATE publication_documents
                 SET correction_pending = FALSE, pending_body_redacted = NULL,
                     pending_public_note = NULL, pending_redaction_task_id = NULL, updated_at = NOW()
                 WHERE id = $1`,
                [input.id]
              );
            } else {
              // Any rejection sends the document back to redaction for rework.
              await tx(
                `UPDATE publication_documents SET status = 'redaction', updated_at = NOW()
                 WHERE id = $1 AND status = 'approval'`,
                [input.id]
              );
            }
            return 0;
          }
          const approvers = await currentRoundApprovals(tx, input.id, stage, round);
          return approvers.length;
        });
      } catch (err) {
        if (err instanceof TRPCError && (err as { cause?: { code?: string } }).cause?.code === "23505") {
          throw new TRPCError({ code: "CONFLICT", message: "You have already recorded an approval decision for this document in this round" });
        }
        throw err;
      }
      await logAudit("publication_approval_recorded", "publication_documents", input.id, String(ctx.user.id), {
        decision: input.decision, stage, approval_round: round, distinct_approvals: distinctApprovals,
      });
      fireAndForget("publicationWorkbench.approve");
      return {
        id: input.id,
        decision: input.decision,
        stage,
        approvalRound: round,
        distinctApprovals,
        readyToPublish: input.decision !== "rejected" && distinctApprovals >= 2,
      };
    }),

  /**
   * Publish: re-verifies dual control + redaction sign-off in the CURRENT
   * approval round before going public.
   *
   * Two paths:
   *  - normal: status 'approval' -> 'published' (stage 'publication' x2).
   *  - correction: correction_pending -> applies the pending redacted body and
   *    public note (stage 'correction' x2 + signed-off correction redaction
   *    task), flipping status to 'corrected'.
   */
  publish: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const doc = await getDocOr404(input.id);
      const round = Number(doc.approval_round ?? 1);

      if (doc.correction_pending === true) {
        // ── Correction re-publish path ────────────────────────────────────
        if (doc.status !== "published" && doc.status !== "corrected") {
          throw new TRPCError({ code: "CONFLICT", message: "Only a published document can publish a correction" });
        }
        // Redaction sign-off is mandatory when the body was replaced.
        if (doc.pending_redaction_task_id != null) {
          const [task] = await exec(
            `SELECT status FROM redaction_tasks WHERE id = $1`,
            [doc.pending_redaction_task_id]
          );
          if (!task || task.status !== "signed_off") {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Correction redaction has not been signed off — refusing to re-publish" });
          }
        }
        const result = await withTransaction(async (tx) => {
          const approverIds = await currentRoundApprovals(tx, input.id, "correction", round);
          if (approverIds.length < 2) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Dual control not satisfied: ${approverIds.length}/2 distinct current-round correction approvals recorded` });
          }
          if (doc.created_by && approverIds.includes(doc.created_by)) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Dual control violated: drafter counted among approvers" });
          }
          const [row] = await tx(
            `UPDATE publication_documents
             SET status = 'corrected',
                 body_redacted = COALESCE(pending_body_redacted, body_redacted),
                 public_note = pending_public_note,
                 corrected_at = NOW(), updated_at = NOW(),
                 correction_pending = FALSE, pending_body_redacted = NULL,
                 pending_public_note = NULL, pending_redaction_task_id = NULL
             WHERE id = $1 AND correction_pending = TRUE AND status IN ('published','corrected')
             RETURNING id, status, corrected_at`,
            [input.id]
          );
          if (!row) throw new TRPCError({ code: "CONFLICT", message: "Document state changed — re-attempt publish" });
          return { row, approverIds };
        });
        await logAudit("publication_correction_published", "publication_documents", input.id, String(ctx.user.id), {
          approvers: result.approverIds, approval_round: round,
        });
        fireAndForget("publicationWorkbench.publish");
        return result.row;
      }

      // ── Normal first-publish path ───────────────────────────────────────
      if (doc.status !== "approval") {
        throw new TRPCError({ code: "CONFLICT", message: "Document must be in the approval stage to publish" });
      }
      if (!doc.redaction_complete || !doc.body_redacted) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Redaction incomplete — refusing to publish unredacted content" });
      }
      const result = await withTransaction(async (tx) => {
        const approverIds = await currentRoundApprovals(tx, input.id, "publication", round);
        if (approverIds.length < 2) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Dual control not satisfied: ${approverIds.length}/2 distinct current-round approvals recorded` });
        }
        if (doc.created_by && approverIds.includes(doc.created_by)) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Dual control violated: drafter counted among approvers" });
        }
        const [row] = await tx(
          `UPDATE publication_documents SET status = 'published', published_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status = 'approval' RETURNING id, status, published_at`,
          [input.id]
        );
        if (!row) throw new TRPCError({ code: "CONFLICT", message: "Document state changed — re-attempt publish" });
        return { row, approverIds };
      });
      await logAudit("publication_published", "publication_documents", input.id, String(ctx.user.id), {
        approvers: result.approverIds, approval_round: round,
      });
      fireAndForget("publicationWorkbench.publish");
      return result.row;
    }),

  /**
   * Post-publication correction with a public notice. This does NOT edit the
   * live document: it opens a correction sub-pipeline (migration 0102
   * pending_* columns). The corrected body is redacted and queued behind a
   * fresh redaction sign-off; every live approval is superseded and the
   * approval round is bumped, so the correction can only go live via two
   * distinct current-round 'correction' approvals + publish(). The currently
   * published version remains public (flagged correction_pending) meanwhile.
   */
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
      if (doc.correction_pending === true) {
        throw new TRPCError({ code: "CONFLICT", message: "A correction is already pending for this document" });
      }
      const actor = ctx.user.name ?? String(ctx.user.id);
      const outcome = await withTransaction(async (tx) => {
        let redactionTaskId: number | null = null;
        let pendingBodyRedacted: string | null = null;
        if (input.correctedBody != null) {
          // Corrections must pass through the redaction engine before display,
          // and the run requires a fresh reviewer sign-off before re-publish.
          const result = applyRedactionRules(input.correctedBody, {
            investigationSensitive: !!doc.investigation_sensitive,
          });
          pendingBodyRedacted = result.redacted;
          const [task] = await tx(
            `INSERT INTO redaction_tasks (document_id, redaction_map, rules_applied, minor_names_applied, status, created_by)
             VALUES ($1, $2, $3, '[]'::jsonb, 'pending', $4) RETURNING id`,
            [input.id, JSON.stringify(result.map), JSON.stringify(result.rulesApplied), actor]
          );
          redactionTaskId = task?.id ?? null;
        }
        // Round-scoped approvals: expire every live approval and open a new
        // round — the correction needs fresh dual control.
        await tx(SUPERSEDE_APPROVALS_SQL, [input.id]);
        await tx(BUMP_ROUND_SQL, [input.id]);
        const [row] = await tx(
          `UPDATE publication_documents
           SET correction_pending = TRUE, pending_public_note = $2,
               pending_body_redacted = $3, pending_redaction_task_id = $4,
               updated_at = NOW()
           WHERE id = $1 AND status IN ('published','corrected') AND correction_pending = FALSE
           RETURNING id, status, approval_round`,
          [input.id, input.publicNote, pendingBodyRedacted, redactionTaskId]
        );
        if (!row) throw new TRPCError({ code: "CONFLICT", message: "Document state changed — re-attempt correction" });
        return { row, redactionTaskId };
      });
      await logAudit("publication_correction_pending", "publication_documents", input.id, String(ctx.user.id), {
        body_replaced: input.correctedBody != null,
        redaction_task_id: outcome.redactionTaskId,
        approval_round: outcome.row.approval_round,
      });
      fireAndForget("publicationWorkbench.correct");
      return {
        id: outcome.row.id,
        status: outcome.row.status,
        correctionPending: true,
        approvalRound: outcome.row.approval_round,
        redactionTaskId: outcome.redactionTaskId,
        nextSteps: [
          ...(outcome.redactionTaskId != null ? ["signOffRedaction"] : []),
          "approve (x2 distinct approvers)",
          "publish",
        ],
      };
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
      await logDisclosureAccess(null, "list", ctx.user, ctx.req);
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
      await logDisclosureAccess(input.id, "detail", ctx.user, ctx.req);
      return row;
    }),

  // ─── Internal reads ───────────────────────────────────────────────────────
  list: staffProcedure
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
                withdrawn_at, created_by, created_at, updated_at,
                approval_round, correction_pending
         FROM publication_documents ${where}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const cnt = await exec(`SELECT COUNT(*) as total FROM publication_documents ${where}`, params.slice(0, -2));
      return { data: rows, total: parseInt(cnt[0]?.total ?? "0", 10) };
    }),

  /**
   * Internal detail read. body_raw (unredacted source) is ONLY returned to
   * staff roles; any other authenticated caller gets the row with body_raw
   * stripped. redaction_map is never included (admin-only endpoint below).
   */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const doc = await getDocOr404(input.id);
      const tasks = await exec(
        `SELECT id, status, reviewer_id, signed_off_at, created_by, created_at, rules_applied, minor_names_applied
         FROM redaction_tasks WHERE document_id = $1 ORDER BY created_at DESC`,
        [input.id]
      );
      const approvals = await exec(
        `SELECT id, stage, approver_id, approver_name, decision, note, approval_round, superseded, created_at
         FROM publication_approvals WHERE document_id = $1 ORDER BY created_at ASC`,
        [input.id]
      );
      const isStaff = STAFF_ROLES.includes(ctx.user.role);
      if (!isStaff) {
        delete doc.body_raw;
      }
      // body_raw is included for staff users only; redaction_map is NOT (admin-only endpoint below).
      return { ...doc, body_raw_included: isStaff, redaction_tasks: tasks, approvals };
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

  stats: staffProcedure.query(async () => {
    const rows = await exec(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft')         AS drafts,
        COUNT(*) FILTER (WHERE status = 'legal_review')  AS in_legal_review,
        COUNT(*) FILTER (WHERE status = 'redaction')     AS in_redaction,
        COUNT(*) FILTER (WHERE status = 'approval')      AS awaiting_approval,
        COUNT(*) FILTER (WHERE status IN ('published','corrected')) AS published,
        COUNT(*) FILTER (WHERE status = 'withdrawn')     AS withdrawn,
        COUNT(*) FILTER (WHERE correction_pending)       AS corrections_pending,
        (SELECT COUNT(*) FROM redaction_tasks WHERE status = 'pending') AS pending_redaction_signoffs
      FROM publication_documents
    `);
    return rows[0] ?? {};
  }),
});
