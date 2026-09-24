/**
 * Public Complaint Portal Router (NDPA 2023 s.46 — complaints to the
 * Commission), modeled on the CFPB Consumer Complaint Database pattern.
 *
 * Public (no login):
 *   submitComplaint  anonymous-optional submission, rate-limited by salted
 *                    IP hash; reference code NDPC-CMP-YYYY-NNNNNN from the
 *                    ndsep_complaint_ref_seq sequence; controller linked by
 *                    NDPC registration ref (organizations.registration_number)
 *                    or free-text name; attachments are content-hashed into
 *                    the anti-wipe evidence vault when reachable and degrade
 *                    to hash-record-only otherwise (never fake storage).
 *   trackComplaint   public status read by reference code. When the
 *                    complaint carries a contact email, the matching email
 *                    must be supplied (same privacy rule as foia.track).
 *
 * Admin triage:
 *   list / get / assign / updateStatus (one-way status machine with per-status
 *   timestamps) / linkToCase (enforcement_cases) / mergeDuplicates /
 *   slaBreaches (72h acknowledgement clock) / notificationStatus.
 *
 * Every mutation writes a complaint_events timeline row, an audit_logs row
 * and emits a mutation event.
 */
import { createHash } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField, decryptField } from "../encryption";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_STATUSES,
  canTransition,
  STATUS_TRANSITIONS,
  statusTimestampColumn,
  formatReferenceCode,
  isValidReferenceCode,
  computeAckSlaDueAt,
  ackSlaState,
  slaHoursRemaining,
  hashIp,
  isRateLimited,
  toPublicTrackingView,
  canMergeInto,
  canBeMerged,
  type ComplaintStatus,
} from "../services/complaintLogic";
import { notifyComplainant, notificationChannelStatus } from "../services/complaintNotify";

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  try {
    const safeParams = params.map((p) =>
      Array.isArray(p) || (p !== null && typeof p === "object" && !(p instanceof Date) && !(p instanceof Buffer))
        ? JSON.stringify(p)
        : p
    );
    const result = await pool.query(query, safeParams);
    return autoDecryptRows(query, result.rows ?? []);
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[publicComplaints] DB query error");
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
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[publicComplaints] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

/**
 * public_complaints PII columns use the "complainant_" prefix and are NOT in
 * the shared encryption.ts PII_FIELDS registry (a read-only shared file), so
 * autoDecryptRows cannot see them. Decrypt explicitly on read; decryptField
 * passes plaintext through unchanged when encryption is disabled.
 */
const PII_COLUMNS = ["complainant_name", "complainant_email", "complainant_phone"] as const;
function decryptPii<T extends Record<string, any>>(row: T): T {
  const out = { ...row };
  for (const col of PII_COLUMNS) {
    if (typeof out[col] === "string") (out as any)[col] = decryptField(out[col]);
  }
  return out;
}

// ─── Rate limiting ───────────────────────────────────────────────────────────
function rateLimitConfig(): { maxPerHour: number; salt: string } {
  return {
    maxPerHour: Math.max(1, parseInt(process.env.COMPLAINT_SUBMIT_RATE_LIMIT_PER_HOUR ?? "5", 10) || 5),
    // Stable default keeps limiting functional without config; operators
    // should set COMPLAINT_IP_HASH_SALT in production so hashes are not
    // cross-deployment comparable.
    salt: process.env.COMPLAINT_IP_HASH_SALT ?? "ndsep-complaints",
  };
}

function clientIp(req: any): string {
  const fwd = req?.headers?.["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req?.ip ?? req?.socket?.remoteAddress ?? "unknown";
}

async function enforceSubmitRateLimit(ipHash: string): Promise<void> {
  const { maxPerHour } = rateLimitConfig();
  const rows = await exec(
    `SELECT COUNT(*)::int AS n FROM public_complaints
     WHERE submitter_ip_hash = $1 AND received_at > NOW() - INTERVAL '1 hour'`,
    [ipHash],
  );
  if (isRateLimited(Number(rows[0]?.n ?? 0), maxPerHour)) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Submission rate limit reached. Please try again later.",
    });
  }
}

// ─── Attachments: evidence vault with explicit hash-only degradation ────────
type VaultOutcome = { status: "stored"; ref: string } | { status: "hash_record_only" | "failed"; error: string };

async function vaultStore(content: Buffer, referenceCode: string, contentType: string | null): Promise<VaultOutcome> {
  try {
    const vault = await import("../antiwipe/vault");
    const { entry } = await vault.putEvidence(content, {
      uploaderId: null,
      uploaderName: "public-complaint-portal",
      caseRef: referenceCode,
      contentType,
    });
    return { status: "stored", ref: entry.path };
  } catch (err) {
    // Vault endpoint absent/unwritable — degrade to hash-record-only. The
    // bytes are NOT stored anywhere else; only the content hash is kept.
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, ref: referenceCode }, "[publicComplaints] evidence vault unavailable; hash-record-only");
    return { status: "hash_record_only", error: msg };
  }
}

// ─── Timeline helper ─────────────────────────────────────────────────────────
async function addEvent(
  complaintId: number,
  eventType: string,
  actor: string,
  details: Record<string, unknown> = {},
  fromStatus: string | null = null,
  toStatus: string | null = null,
): Promise<void> {
  await exec(
    `INSERT INTO complaint_events (complaint_id, event_type, from_status, to_status, actor, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [complaintId, eventType, fromStatus, toStatus, actor, details],
  );
}

function withSlaFields<T extends Record<string, any>>(row: T) {
  return {
    ...row,
    ack_sla_state: ackSlaState(row),
    ack_sla_hours_remaining: slaHoursRemaining(row),
  };
}

const attachmentInput = z.object({
  filename: z.string().min(1).max(256),
  contentType: z.string().max(128).optional(),
  /** Base64-encoded bytes, max ~2 MiB decoded. Omit for a hash-only record. */
  contentBase64: z.string().max(3_000_000).optional(),
  /** Client-computed SHA-256 (verified against content when bytes provided). */
  sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
});

export const publicComplaintsRouter = router({
  // ─── Public: submit a complaint ────────────────────────────────────────────
  submitComplaint: publicProcedure
    .input(z.object({
      category: z.enum(COMPLAINT_CATEGORIES),
      subject: z.string().min(4).max(512),
      description: z.string().min(20).max(20000),
      controllerRegistrationRef: z.string().max(64).optional(),
      controllerName: z.string().max(256).optional(),
      state: z.string().max(64).optional(),
      lga: z.string().max(128).optional(),
      complainantName: z.string().max(256).optional(),
      complainantEmail: z.string().email().optional(),
      complainantPhone: z.string().max(64).optional(),
      attachments: z.array(attachmentInput).max(5).default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!input.controllerRegistrationRef && !input.controllerName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Identify the data controller by registration reference or by name.",
        });
      }

      const ipHash = hashIp(clientIp(ctx.req), rateLimitConfig().salt);
      await enforceSubmitRateLimit(ipHash);

      // Pre-validate attachments (decode + hash-verify) BEFORE inserting the
      // complaint so a bad attachment never leaves an orphan row or consumes
      // a reference-code sequence value.
      const preparedAttachments = input.attachments.map((att) => {
        const bytes = att.contentBase64 ? Buffer.from(att.contentBase64, "base64") : null;
        const sha = bytes
          ? createHash("sha256").update(bytes).digest("hex")
          : (att.sha256?.toLowerCase() ?? null);
        if (bytes && att.sha256 && att.sha256.toLowerCase() !== sha) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Attachment ${att.filename}: sha256 mismatch` });
        }
        return { att, bytes, sha };
      }).filter((p) => p.sha != null);

      // Resolve registered controller by NDPC registration reference.
      let controllerId: number | null = null;
      if (input.controllerRegistrationRef) {
        const orgs = await exec(
          `SELECT id FROM organizations WHERE registration_number = $1 LIMIT 1`,
          [input.controllerRegistrationRef.trim()],
        );
        controllerId = orgs[0] ? Number(orgs[0].id) : null;
      }

      const seq = await exec(`SELECT nextval('ndsep_complaint_ref_seq') AS n`);
      const referenceCode = formatReferenceCode(Number(seq[0]?.n ?? 0));
      const ackDue = computeAckSlaDueAt();
      const isAnonymous = !input.complainantName && !input.complainantEmail && !input.complainantPhone;

      const rows = await exec(
        `INSERT INTO public_complaints
           (reference_code, category, subject, description,
            controller_id, controller_registration_ref, controller_name,
            state, lga,
            complainant_name, complainant_email, complainant_phone, is_anonymous,
            submitter_ip_hash, status, ack_sla_due_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'received',$15)
         RETURNING id, reference_code, status, ack_sla_due_at, received_at`,
        [
          referenceCode, input.category, input.subject, input.description,
          controllerId, input.controllerRegistrationRef?.trim() ?? null, input.controllerName?.trim() ?? null,
          input.state?.trim() ?? null, input.lga?.trim() ?? null,
          input.complainantName ? encryptField(input.complainantName) : null,
          input.complainantEmail ? encryptField(input.complainantEmail) : null,
          input.complainantPhone ? encryptField(input.complainantPhone) : null,
          isAnonymous, ipHash, ackDue,
        ],
      );
      const complaint = rows[0];
      if (!complaint) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Complaint insert failed" });

      await addEvent(complaint.id, "submitted", "public", {
        category: input.category,
        controller_id: controllerId,
        is_anonymous: isAnonymous,
      }, null, "received");

      // Attachments: content-hash always; vault storage only when reachable.
      const attachmentResults: Array<{ filename: string; sha256: string; vault_status: string }> = [];
      for (const { att, bytes, sha } of preparedAttachments) {
        let vaultStatus: "stored" | "hash_record_only" | "failed" = "hash_record_only";
        let vaultRef: string | null = null;
        let vaultError: string | null = "hash-only record (no bytes supplied)";
        if (bytes) {
          const outcome = await vaultStore(bytes, referenceCode, att.contentType ?? null);
          vaultStatus = outcome.status;
          if (outcome.status === "stored") {
            vaultRef = outcome.ref;
            vaultError = null;
          } else {
            vaultError = outcome.error;
          }
        }
        await exec(
          `INSERT INTO complaint_attachments
             (complaint_id, filename, content_type, size_bytes, sha256, vault_status, vault_ref, vault_error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [complaint.id, att.filename, att.contentType ?? null, bytes ? bytes.length : 0, sha as string, vaultStatus, vaultRef, vaultError],
        );
        attachmentResults.push({ filename: att.filename, sha256: sha as string, vault_status: vaultStatus });
      }

      // Notification hooks (UNCONFIGURED without gateway config — recorded honestly).
      const notifications = await notifyComplainant({
        emailTo: input.complainantEmail ?? null,
        smsTo: input.complainantPhone ?? null,
        subject: `NDPC complaint ${referenceCode} received`,
        body: `Your complaint (${input.category}) has been received by the Nigeria Data Protection Commission. Acknowledgement is due within 72 hours. Track it with reference ${referenceCode}.`,
        referenceCode,
      });
      await addEvent(complaint.id, "notification", "system", { results: notifications });

      await logAudit("complaint_submitted", "public_complaints", complaint.id, null, {
        referenceCode, category: input.category, controllerId, isAnonymous,
      });
      fireAndForget("publicComplaints.submitComplaint");

      return {
        referenceCode,
        status: "received" as const,
        receivedAt: complaint.received_at,
        ackSlaDueAt: complaint.ack_sla_due_at,
        controllerLinked: controllerId != null,
        attachments: attachmentResults,
        notifications,
      };
    }),

  // ─── Public: track by reference code ───────────────────────────────────────
  trackComplaint: publicProcedure
    .input(z.object({
      referenceCode: z.string().min(10).max(32),
      complainantEmail: z.string().email().optional(),
    }))
    .query(async ({ input }) => {
      const code = input.referenceCode.trim().toUpperCase();
      if (!isValidReferenceCode(code)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid complaint reference format (NDPC-CMP-YYYY-NNNNNN)." });
      }
      const rows = await exec(`SELECT * FROM public_complaints WHERE reference_code = $1`, [code]);
      const row = rows[0] ? decryptPii(rows[0]) : null;
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No complaint found with that reference code." });
      }
      // Privacy rule (mirrors foia.track): if the complaint carries a contact
      // email, the tracker must prove knowledge of it. Fully anonymous
      // complaints are trackable by reference code alone.
      if (row.complainant_email) {
        const supplied = input.complainantEmail?.toLowerCase();
        if (!supplied || supplied !== String(row.complainant_email).toLowerCase()) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No complaint found with that reference code and email.",
          });
        }
      }
      return { ...toPublicTrackingView(row), ack_sla_state: ackSlaState(row) };
    }),

  // ─── Admin: triage queue ───────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      status: z.enum(COMPLAINT_STATUSES).optional(),
      category: z.enum(COMPLAINT_CATEGORIES).optional(),
      controllerId: z.number().int().optional(),
      state: z.string().max(64).optional(),
      assignedOfficerId: z.number().int().optional(),
      slaBreachedOnly: z.boolean().default(false),
      unassignedOnly: z.boolean().default(false),
      search: z.string().max(256).optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input }) => {
      const opts = input ?? { slaBreachedOnly: false, unassignedOnly: false, page: 1, limit: 20 };
      const params: unknown[] = [];
      const conds: string[] = ["merged_into_id IS NULL"];
      if (opts.status) { params.push(opts.status); conds.push(`status = $${params.length}`); }
      if (opts.category) { params.push(opts.category); conds.push(`category = $${params.length}`); }
      if (opts.controllerId) { params.push(opts.controllerId); conds.push(`controller_id = $${params.length}`); }
      if (opts.state) { params.push(opts.state); conds.push(`state = $${params.length}`); }
      if (opts.assignedOfficerId) { params.push(opts.assignedOfficerId); conds.push(`assigned_officer_id = $${params.length}`); }
      if (opts.slaBreachedOnly) conds.push(`acknowledged_at IS NULL AND ack_sla_due_at < NOW()`);
      if (opts.unassignedOnly) conds.push(`assigned_officer_id IS NULL`);
      if (opts.search) {
        params.push(`%${opts.search}%`);
        conds.push(`(reference_code ILIKE $${params.length} OR subject ILIKE $${params.length} OR controller_name ILIKE $${params.length})`);
      }
      const where = `WHERE ${conds.join(" AND ")}`;
      const page = opts.page ?? 1;
      const limit = opts.limit ?? 20;
      params.push(limit, (page - 1) * limit);
      const rows = await exec(
        `SELECT * FROM public_complaints ${where}
         ORDER BY (acknowledged_at IS NULL AND ack_sla_due_at < NOW()) DESC, received_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const cnt = await exec(`SELECT COUNT(*)::int AS total FROM public_complaints ${where}`, params.slice(0, -2));
      return { data: rows.map((r) => withSlaFields(decryptPii(r))), total: Number(cnt[0]?.total ?? 0), page, limit };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await exec(`SELECT * FROM public_complaints WHERE id = $1`, [input.id]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Complaint not found." });
      const events = await exec(
        `SELECT id, event_type, from_status, to_status, actor, details, created_at
         FROM complaint_events WHERE complaint_id = $1 ORDER BY created_at ASC`,
        [input.id],
      );
      const attachments = await exec(
        `SELECT id, filename, content_type, size_bytes, sha256, vault_status, vault_ref, vault_error, created_at
         FROM complaint_attachments WHERE complaint_id = $1 ORDER BY id ASC`,
        [input.id],
      );
      const merges = await exec(
        `SELECT id, reference_code, category, subject, status FROM public_complaints WHERE merged_into_id = $1`,
        [input.id],
      );
      return { ...withSlaFields(decryptPii(rows[0])), events, attachments, merged_duplicates: merges };
    }),

  stats: protectedProcedure.query(async () => {
    const rows = await exec(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'received')::int AS received,
        COUNT(*) FILTER (WHERE status = 'acknowledged')::int AS acknowledged,
        COUNT(*) FILTER (WHERE status = 'under_review')::int AS under_review,
        COUNT(*) FILTER (WHERE status = 'linked_to_case')::int AS linked_to_case,
        COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'closed')::int AS closed,
        COUNT(*) FILTER (WHERE acknowledged_at IS NULL AND ack_sla_due_at < NOW())::int AS ack_sla_breached,
        COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '7 days')::int AS received_last_7d,
        COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '30 days')::int AS received_last_30d
      FROM public_complaints WHERE merged_into_id IS NULL
    `);
    return rows[0] ?? {};
  }),

  assign: adminProcedure
    .input(z.object({ id: z.number().int().positive(), officerId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE public_complaints SET assigned_officer_id = $1, updated_at = NOW()
         WHERE id = $2 RETURNING id, reference_code, status`,
        [input.officerId, input.id],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Complaint not found." });
      await addEvent(input.id, "assigned", String(ctx.user.id), { officerId: input.officerId });
      await logAudit("complaint_assigned", "public_complaints", input.id, String(ctx.user.id), { officerId: input.officerId });
      fireAndForget("publicComplaints.assign");
      return rows[0];
    }),

  updateStatus: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(COMPLAINT_STATUSES),
      resolutionNotes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const current = await exec(`SELECT * FROM public_complaints WHERE id = $1`, [input.id]);
      if (!current[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Complaint not found." });
      const from = current[0].status as ComplaintStatus;
      if (!canTransition(from, input.status)) {
        const allowed = (STATUS_TRANSITIONS as Record<string, readonly string[]>)[from] ?? [];
        throw new TRPCError({
          code: "CONFLICT",
          message: `Invalid status transition ${from} → ${input.status}. Allowed from ${from}: ${allowed.length ? allowed.join(", ") : "none (terminal)"}.`,
        });
      }
      if (input.status === "linked_to_case" && current[0].enforcement_case_id == null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Link an enforcement case (linkToCase) before moving to linked_to_case.",
        });
      }
      const tsCol = statusTimestampColumn(input.status);
      const rows = await exec(
        `UPDATE public_complaints SET
           status = $1,
           ${tsCol} = NOW(),
           resolution_notes = COALESCE($2, resolution_notes),
           updated_at = NOW()
         WHERE id = $3 RETURNING id, reference_code, status, ${tsCol}`,
        [input.status, input.resolutionNotes ?? null, input.id],
      );
      await addEvent(input.id, "status_change", String(ctx.user.id), { resolutionNotes: input.resolutionNotes ?? null }, from, input.status);
      await logAudit(`complaint_status_${input.status}`, "public_complaints", input.id, String(ctx.user.id), { from });
      fireAndForget("publicComplaints.updateStatus");

      // Notify the complainant of the transition (hooks only; honest status).
      const row = decryptPii(current[0]);
      if (row.complainant_email || row.complainant_phone) {
        const notifications = await notifyComplainant({
          emailTo: row.complainant_email ?? null,
          smsTo: row.complainant_phone ?? null,
          subject: `NDPC complaint ${row.reference_code}: ${input.status}`,
          body: `Your complaint status is now "${input.status}".`,
          referenceCode: row.reference_code,
        });
        await addEvent(input.id, "notification", "system", { results: notifications });
      }
      return rows[0];
    }),

  linkToCase: adminProcedure
    .input(z.object({ id: z.number().int().positive(), enforcementCaseId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const cases = await exec(`SELECT id, case_reference FROM enforcement_cases WHERE id = $1`, [input.enforcementCaseId]);
      if (!cases[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Enforcement case not found." });
      const rows = await exec(
        `UPDATE public_complaints SET enforcement_case_id = $1, updated_at = NOW()
         WHERE id = $2 RETURNING id, reference_code, status`,
        [input.enforcementCaseId, input.id],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Complaint not found." });
      await addEvent(input.id, "linked_to_case", String(ctx.user.id), {
        enforcementCaseId: input.enforcementCaseId,
        caseReference: cases[0].case_reference,
      });
      await logAudit("complaint_linked_to_case", "public_complaints", input.id, String(ctx.user.id), {
        enforcementCaseId: input.enforcementCaseId,
      });
      fireAndForget("publicComplaints.linkToCase");
      return { ...rows[0], enforcement_case_id: input.enforcementCaseId };
    }),

  mergeDuplicates: adminProcedure
    .input(z.object({
      canonicalId: z.number().int().positive(),
      duplicateId: z.number().int().positive(),
      reason: z.string().min(5).max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.canonicalId === input.duplicateId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A complaint cannot be merged into itself." });
      }
      const [canonical, duplicate] = await Promise.all([
        exec(`SELECT id, reference_code, status, merged_into_id FROM public_complaints WHERE id = $1`, [input.canonicalId]),
        exec(`SELECT id, reference_code, status, merged_into_id FROM public_complaints WHERE id = $1`, [input.duplicateId]),
      ]);
      if (!canonical[0] || !duplicate[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Both complaints must exist." });
      }
      if (!canMergeInto(canonical[0])) {
        throw new TRPCError({ code: "CONFLICT", message: "Canonical complaint is closed or already merged." });
      }
      if (!canBeMerged(duplicate[0])) {
        throw new TRPCError({ code: "CONFLICT", message: "Duplicate complaint is already merged." });
      }
      await exec(
        `UPDATE public_complaints SET merged_into_id = $1, status = 'closed', closed_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [input.canonicalId, input.duplicateId],
      );
      // Carry the duplicate's attachments and timeline forward so evidence stays reachable.
      await exec(`UPDATE complaint_attachments SET complaint_id = $1 WHERE complaint_id = $2`, [input.canonicalId, input.duplicateId]);
      await addEvent(input.duplicateId, "merged", String(ctx.user.id), { into: input.canonicalId, reason: input.reason }, duplicate[0].status, "closed");
      await addEvent(input.canonicalId, "merged", String(ctx.user.id), { absorbed: input.duplicateId, duplicateRef: duplicate[0].reference_code, reason: input.reason });
      await logAudit("complaint_merged", "public_complaints", input.duplicateId, String(ctx.user.id), {
        into: input.canonicalId, reason: input.reason,
      });
      fireAndForget("publicComplaints.mergeDuplicates");
      return { canonicalId: input.canonicalId, mergedDuplicateId: input.duplicateId };
    }),

  slaBreaches: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT id, reference_code, category, subject, controller_name, controller_id,
                status, received_at, ack_sla_due_at, assigned_officer_id
         FROM public_complaints
         WHERE acknowledged_at IS NULL AND ack_sla_due_at < NOW() AND merged_into_id IS NULL
         ORDER BY ack_sla_due_at ASC LIMIT $1`,
        [input?.limit ?? 50],
      );
      return rows.map((r) => ({ ...r, ack_sla_state: "breached" as const, ack_sla_hours_remaining: slaHoursRemaining(r) }));
    }),

  notificationStatus: protectedProcedure.query(() => notificationChannelStatus()),
});
