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
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField } from "../encryption";
import { sendCitizenRequestUpdate } from "../emailNotification";

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
const APPEAL_POINTER =
  "You may lodge a complaint with the Nigeria Data Protection Commission (NDPC) against this refusal, " +
  "or apply to a competent court for judicial review, within 30 days of this notice.";

async function createBaseRequest(input: {
  requestType: string;
  citizenName: string;
  citizenEmail: string;
  citizenNin?: string;
  organizationId?: number;
  description: string;
  supportingDocUrl?: string;
}): Promise<{ id: number; referenceNumber: string }> {
  const seq = await exec("SELECT nextval('citizen_requests_id_seq') AS id");
  const id = Number(seq[0].id);
  const referenceNumber = `NDSEP-CR-${String(id).padStart(6, "0")}`;
  const responseDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await exec(
    `INSERT INTO citizen_requests
       (id, citizen_name, citizen_email, citizen_nin, request_type, status,
        organization_id, description, reference_number, response_deadline,
        supporting_doc_url, is_third_party, submitted_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'submitted',$6,$7,$8,$9,$10,true,NOW(),NOW())`,
    [
      id, input.citizenName, encryptField(input.citizenEmail),
      input.citizenNin ? encryptField(input.citizenNin) : null,
      input.requestType, input.organizationId ?? null, input.description,
      referenceNumber, responseDeadline, input.supportingDocUrl ?? null,
    ]
  );
  return { id, referenceNumber };
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
    .mutation(async ({ input }) => {
      if (!input.authorityEvidenceDocUrl && !input.authorityEvidenceDocKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Evidence of authority to act (e.g. letter of authority, guardianship order, power of attorney) is required.",
        });
      }
      const base = await createBaseRequest(input);
      const [rep] = await exec(
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
      await logAudit("dsar_third_party_submitted", "citizen_requests", base.id, null, {
        reference: base.referenceNumber, relationship: input.relationship,
      });
      fireAndForget("dsarEdgeCases.submitOnBehalf");
      return { ...base, thirdPartySubmission: rep };
    }),

  verifyRepresentative: protectedProcedure
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
    .mutation(async ({ input }) => {
      const base = await createBaseRequest({
        requestType: input.requestType,
        citizenName: input.deceasedName,
        citizenEmail: input.executorEmail,
        organizationId: input.organizationId,
        description: `[DECEASED DATA SUBJECT] ${input.description}`,
      });
      const [row] = await exec(
        `INSERT INTO dsar_deceased_subjects
           (request_id, deceased_name, death_certificate_ref, executor_name, executor_contact)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [base.id, encryptField(input.deceasedName), input.deathCertificateRef, encryptField(input.executorName), encryptField(input.executorContact ?? input.executorEmail)]
      );
      await logAudit("dsar_deceased_submitted", "citizen_requests", base.id, null, { reference: base.referenceNumber });
      fireAndForget("dsarEdgeCases.submitDeceasedSubjectRequest");
      return { ...base, deceasedSubject: row };
    }),

  verifyExecutor: protectedProcedure
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
      if (["completed", "rejected"].includes(req[0].status)) {
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
      // Notify the data subject (fire-and-forget; email is decrypted by the pool proxy)
      if (req[0].citizen_email) {
        sendCitizenRequestUpdate({
          to: req[0].citizen_email,
          citizenName: req[0].citizen_name ?? "Data Subject",
          requestType: req[0].request_type,
          requestRef: req[0].reference_number,
          newStatus: "rejected",
          orgName: "NDPC / Data Controller",
          message: `Your request was refused as ${input.refusalGround.replace(/_/g, " ")}. Justification: ${input.writtenJustification}. ${APPEAL_POINTER}`,
        }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "refusal email failed"));
      }
      fireAndForget("dsarEdgeCases.refuseRequest");
      return refusal;
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
      const [merged] = await exec(
        `UPDATE citizen_requests
         SET merged_into_request_id = $1, status = 'completed',
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
      const [thirdParty, deceased, refusals, links, redactions] = await Promise.all([
        exec(`SELECT * FROM dsar_third_party_submissions WHERE request_id = $1`, [input.requestId]),
        exec(`SELECT * FROM dsar_deceased_subjects WHERE request_id = $1`, [input.requestId]),
        exec(`SELECT * FROM dsar_refusals WHERE request_id = $1`, [input.requestId]),
        exec(`SELECT * FROM dsar_request_links WHERE request_id = $1 OR related_request_id = $1`, [input.requestId]),
        exec(`SELECT * FROM dsar_redactions WHERE request_id = $1`, [input.requestId]),
      ]);
      return {
        thirdParty: thirdParty[0] ?? null,
        deceased: deceased[0] ?? null,
        refusals,
        links,
        redactions,
      };
    }),
});
