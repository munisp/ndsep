/**
 * Bulk Queue Operations Router (round 12, wave 2 — roadmap §5 quick wins)
 * ============================================================================
 * Wires the previously-dormant bulkOperations.ts progress-tracking helpers to
 * the three worst one-at-a-time queues:
 *
 *   Complaint triage    bulkAssignComplaints / bulkSetComplaintStatus
 *   Compliance scanning bulkSetFindingStatus / bulkSuppressFindings
 *   Adverse media       bulkConfirmAdverseMedia / bulkRejectAdverseMedia
 *
 * DUAL CONTROL: none of these procedures touches fines, settlements or
 * publications, so dual_control_requests is never involved. Scan-finding
 * suppression keeps its existing dual control: bulkSuppressFindings only
 * creates PENDING scan_suppressions requests (scope='finding'), which still
 * require a DIFFERENT officer to approve via
 * complianceScanning.approveSuppression (requester ≠ approver is enforced
 * both in that procedure and by the table CHECK).
 *
 * Every bulk run:
 *   - enforces the same per-item guards as the single-item procedures
 *     (complaint status machine via canTransition, linked_to_case precondition,
 *     scan_finding closed-state guard, adverse-media pending-only transition);
 *   - returns a per-item outcome list — one bad item never fails the batch;
 *   - writes a bulk_operations tracking row (progress + undo window metadata);
 *   - writes one audit_logs row for the batch plus per-item complaint_events
 *     for complaint mutations (timeline parity with the single-item path).
 *
 * Also hosts the autocomplete search endpoints backing
 * client/src/components/pickers (searchOfficers, searchCases) because no
 * existing procedure exposes a lightweight officer/case autocomplete; the
 * duplicate-complaint picker reuses publicComplaints.list directly.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure, staffProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import {
  COMPLAINT_STATUSES,
  canTransition,
  statusTimestampColumn,
  type ComplaintStatus,
} from "../services/complaintLogic";
import {
  startBulkOperation,
  updateProgress,
  completeBulkOperation,
  type BulkOperationType,
} from "../bulkOperations";

const MAX_BULK = 200;

const idList = z.array(z.number().int().positive()).min(1).max(MAX_BULK);

const FINDING_SETTABLE_STATUSES = ["acknowledged", "resolved", "dismissed"] as const;

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
    return result.rows ?? [];
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[bulkOps] DB query error");
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
    logger.warn({ err, action, resourceType }, "[bulkOps] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

async function addComplaintEvent(
  complaintId: number,
  eventType: string,
  actor: string,
  details: Record<string, unknown> = {},
  fromStatus?: string,
  toStatus?: string,
): Promise<void> {
  await exec(
    `INSERT INTO complaint_events (complaint_id, event_type, from_status, to_status, actor, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [complaintId, eventType, fromStatus ?? null, toStatus ?? null, actor, JSON.stringify(details)],
  );
}

interface ItemOutcome {
  id: number;
  ok: boolean;
  reason?: string;
}

/** Open a bulk_operations tracking row; failures are non-fatal. */
async function trackStart(type: BulkOperationType, ids: number[], userId: string): Promise<string | null> {
  try {
    const pool = getPool();
    if (!pool) return null;
    const op = await startBulkOperation(pool, type, ids, userId);
    return op.id;
  } catch (err) {
    logger.warn({ err, type }, "[bulkOps] bulk_operations tracking write failed (non-fatal)");
    return null;
  }
}

async function trackFinish(operationId: string | null, outcomes: ItemOutcome[]): Promise<void> {
  if (!operationId) return;
  try {
    const pool = getPool();
    if (!pool) return;
    const success = outcomes.filter((o) => o.ok).length;
    await updateProgress(pool, operationId, outcomes.length, success, outcomes.length - success);
    await completeBulkOperation(pool, operationId, outcomes.some((o) => !o.ok) && success === 0 ? "failed" : "completed");
  } catch (err) {
    logger.warn({ err, operationId }, "[bulkOps] bulk_operations tracking close failed (non-fatal)");
  }
}

function summarize(operationId: string | null, outcomes: ItemOutcome[]) {
  return {
    operationId,
    total: outcomes.length,
    succeeded: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).map((o) => ({ id: o.id, reason: o.reason ?? "unknown" })),
  };
}

export const bulkOpsRouter = router({
  // ─── Picker search endpoints (autocomplete backends) ──────────────────────

  /** Officer autocomplete for triage assignment pickers. Staff-only; returns
   *  non-PII directory fields (id/name/email/role). */
  searchOfficers: staffProcedure
    .input(z.object({
      query: z.string().max(120).optional(),
      limit: z.number().int().min(1).max(25).default(10),
    }).optional())
    .query(async ({ input }) => {
      const q = input?.query?.trim() || null;
      return exec(
        `SELECT id, name, email, role
         FROM users
         WHERE is_active IS DISTINCT FROM false
           AND role IN ('admin', 'government_staff', 'auditor', 'regulator')
           AND ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
         ORDER BY name ASC NULLS LAST, id ASC
         LIMIT $2`,
        [q, input?.limit ?? 10],
      );
    }),

  /** Enforcement-case autocomplete for complaint linkToCase pickers. */
  searchCases: staffProcedure
    .input(z.object({
      query: z.string().max(120).optional(),
      limit: z.number().int().min(1).max(25).default(10),
    }).optional())
    .query(async ({ input }) => {
      const q = input?.query?.trim() || null;
      return exec(
        `SELECT ec.id, ec.case_reference, ec.status, ec.opened_at,
                o.name AS organization_name
         FROM enforcement_cases ec
         LEFT JOIN organizations o ON o.id = ec.organization_id
         WHERE ($1::text IS NULL OR ec.case_reference ILIKE '%' || $1 || '%'
                OR o.name ILIKE '%' || $1 || '%'
                OR CAST(ec.id AS text) = $1)
         ORDER BY ec.opened_at DESC NULLS LAST, ec.id DESC
         LIMIT $2`,
        [q, input?.limit ?? 10],
      );
    }),

  // ─── Complaint triage ─────────────────────────────────────────────────────

  /** Assign one officer to many complaints. Same write shape as
   *  publicComplaints.assign (no status change), with per-item events. */
  bulkAssignComplaints: adminProcedure
    .input(z.object({
      complaintIds: idList,
      officerId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const officer = await exec(`SELECT id, name FROM users WHERE id = $1`, [input.officerId]);
      if (!officer[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Officer user not found." });

      const operationId = await trackStart("complaint_assign_officer", input.complaintIds, String(ctx.user.id));
      const outcomes: ItemOutcome[] = [];
      for (const id of input.complaintIds) {
        try {
          const rows = await exec(
            `UPDATE public_complaints SET assigned_officer_id = $1, updated_at = NOW()
             WHERE id = $2 RETURNING id`,
            [input.officerId, id],
          );
          if (!rows[0]) { outcomes.push({ id, ok: false, reason: "Complaint not found" }); continue; }
          await addComplaintEvent(id, "assigned", String(ctx.user.id), {
            officerId: input.officerId, officerName: officer[0].name ?? null, bulk: true,
          });
          outcomes.push({ id, ok: true });
        } catch (err) {
          outcomes.push({ id, ok: false, reason: err instanceof Error ? err.message : "update failed" });
        }
      }
      await trackFinish(operationId, outcomes);
      await logAudit("complaints_bulk_assigned", "public_complaints", null, String(ctx.user.id), {
        officerId: input.officerId, ...summarize(operationId, outcomes),
      });
      fireAndForget("bulkOps.bulkAssignComplaints");
      return summarize(operationId, outcomes);
    }),

  /** Move many complaints to one status. Enforces the one-way status machine
   *  per item; invalid transitions are reported, never forced. The per-item
   *  complainant notification of publicComplaints.updateStatus is intentionally
   *  NOT sent here to avoid notification storms on large batches. */
  bulkSetComplaintStatus: adminProcedure
    .input(z.object({
      complaintIds: idList,
      status: z.enum(COMPLAINT_STATUSES),
      resolutionNotes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const tsCol = statusTimestampColumn(input.status as ComplaintStatus);
      if (!tsCol) throw new TRPCError({ code: "BAD_REQUEST", message: `Status ${input.status} has no timestamp column.` });

      const operationId = await trackStart("complaint_set_status", input.complaintIds, String(ctx.user.id));
      const outcomes: ItemOutcome[] = [];
      for (const id of input.complaintIds) {
        try {
          const current = await exec(
            `SELECT id, status, enforcement_case_id, merged_into_id FROM public_complaints WHERE id = $1`,
            [id],
          );
          if (!current[0]) { outcomes.push({ id, ok: false, reason: "Complaint not found" }); continue; }
          if (current[0].merged_into_id != null) {
            outcomes.push({ id, ok: false, reason: "Merged duplicate — act on the canonical complaint" });
            continue;
          }
          const from = current[0].status as ComplaintStatus;
          if (!canTransition(from, input.status as ComplaintStatus)) {
            outcomes.push({ id, ok: false, reason: `Invalid transition ${from} → ${input.status}` });
            continue;
          }
          if (input.status === "linked_to_case" && current[0].enforcement_case_id == null) {
            outcomes.push({ id, ok: false, reason: "Link an enforcement case before linked_to_case" });
            continue;
          }
          await exec(
            `UPDATE public_complaints SET
               status = $1, ${tsCol} = NOW(),
               resolution_notes = COALESCE($2, resolution_notes),
               updated_at = NOW()
             WHERE id = $3`,
            [input.status, input.resolutionNotes ?? null, id],
          );
          await addComplaintEvent(id, "status_change", String(ctx.user.id), {
            resolutionNotes: input.resolutionNotes ?? null, bulk: true,
          }, from, input.status);
          outcomes.push({ id, ok: true });
        } catch (err) {
          outcomes.push({ id, ok: false, reason: err instanceof Error ? err.message : "update failed" });
        }
      }
      await trackFinish(operationId, outcomes);
      await logAudit(`complaints_bulk_status_${input.status}`, "public_complaints", null, String(ctx.user.id), {
        status: input.status, ...summarize(operationId, outcomes),
      });
      fireAndForget("bulkOps.bulkSetComplaintStatus");
      return summarize(operationId, outcomes);
    }),

  // ─── Compliance scan findings ─────────────────────────────────────────────

  /** Set status on many findings. Uses the same closed-state guard as
   *  complianceScanning.setFindingStatus: open/acknowledged can move to any
   *  target status; referred can only move to resolved; suppressed/resolved/
   *  dismissed rows are skipped. */
  bulkSetFindingStatus: adminProcedure
    .input(z.object({
      findingIds: idList,
      status: z.enum(FINDING_SETTABLE_STATUSES),
      resolutionNotes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const operationId = await trackStart("scan_finding_set_status", input.findingIds, String(ctx.user.id));
      const actor = ctx.user.name ?? String(ctx.user.id);
      const outcomes: ItemOutcome[] = [];
      for (const id of input.findingIds) {
        try {
          const rows = await exec(
            `UPDATE scan_findings
                SET status = $2,
                    resolved_at = CASE WHEN $2 IN ('resolved', 'dismissed') THEN NOW() ELSE resolved_at END,
                    resolved_by = CASE WHEN $2 IN ('resolved', 'dismissed') THEN $3 ELSE resolved_by END,
                    resolution_notes = COALESCE($4, resolution_notes)
              WHERE id = $1
                AND (status IN ('open', 'acknowledged')
                     OR (status = 'referred' AND $2 = 'resolved'))
              RETURNING id`,
            [id, input.status, actor, input.resolutionNotes ?? null],
          );
          if (!rows[0]) { outcomes.push({ id, ok: false, reason: "Finding not found or already closed" }); continue; }
          outcomes.push({ id, ok: true });
        } catch (err) {
          outcomes.push({ id, ok: false, reason: err instanceof Error ? err.message : "update failed" });
        }
      }
      await trackFinish(operationId, outcomes);
      await logAudit("scan_findings_bulk_status_set", "scan_findings", null, String(ctx.user.id), {
        status: input.status, ...summarize(operationId, outcomes),
      });
      fireAndForget("bulkOps.bulkSetFindingStatus");
      return summarize(operationId, outcomes);
    }),

  /** Bulk suppression requests. DUAL CONTROL PRESERVED: this only creates
   *  PENDING scan_suppressions rows (scope='finding'); each still requires a
   *  different officer to approve via complianceScanning.approveSuppression,
   *  which is also where findings actually flip to 'suppressed'. Findings
   *  with an existing pending request are skipped. */
  bulkSuppressFindings: protectedProcedure
    .input(z.object({
      findingIds: idList,
      reason: z.string().min(20).max(2000),
      expiresInDays: z.number().int().min(1).max(365).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const operationId = await trackStart("scan_finding_suppress_request", input.findingIds, String(ctx.user.id));
      const requester = ctx.user.name ?? String(ctx.user.id);
      const outcomes: ItemOutcome[] = [];
      for (const id of input.findingIds) {
        try {
          const finding = await exec(`SELECT id, status FROM scan_findings WHERE id = $1`, [id]);
          if (!finding[0]) { outcomes.push({ id, ok: false, reason: "Finding not found" }); continue; }
          if (!["open", "acknowledged"].includes(finding[0].status)) {
            outcomes.push({ id, ok: false, reason: `Finding is ${finding[0].status} — only open/acknowledged can be suppressed` });
            continue;
          }
          const existing = await exec(
            `SELECT id FROM scan_suppressions WHERE scope = 'finding' AND finding_id = $1 AND status = 'pending'`,
            [id],
          );
          if (existing[0]) { outcomes.push({ id, ok: false, reason: "Pending suppression request already exists" }); continue; }
          await exec(
            `INSERT INTO scan_suppressions
               (scope, finding_id, reason, requested_by, expires_at)
             VALUES ('finding', $1, $2, $3,
                     CASE WHEN $4::int IS NOT NULL THEN NOW() + ($4 || ' days')::interval ELSE NULL END)`,
            [id, input.reason, requester, input.expiresInDays ?? null],
          );
          outcomes.push({ id, ok: true });
        } catch (err) {
          outcomes.push({ id, ok: false, reason: err instanceof Error ? err.message : "request failed" });
        }
      }
      await trackFinish(operationId, outcomes);
      await logAudit("scan_findings_bulk_suppression_requested", "scan_suppressions", null, String(ctx.user.id), {
        reason: input.reason.slice(0, 200), ...summarize(operationId, outcomes),
      });
      fireAndForget("bulkOps.bulkSuppressFindings");
      return summarize(operationId, outcomes);
    }),

  // ─── Adverse media review ─────────────────────────────────────────────────

  /** Confirm many pending items. Mirrors adverseMedia.confirmItem per item,
   *  including promotion of confirmed entity matches into
   *  supervision_risk_signals (idempotent via ON CONFLICT). */
  bulkConfirmAdverseMedia: staffProcedure
    .input(z.object({
      itemIds: idList,
      note: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const operationId = await trackStart("adverse_media_confirm", input.itemIds, String(ctx.user.id));
      const reviewer = ctx.user.name ?? String(ctx.user.id);
      const outcomes: ItemOutcome[] = [];
      let signalsPromoted = 0;
      for (const id of input.itemIds) {
        try {
          const rows = await exec(
            `UPDATE adverse_media_items
             SET review_status = 'confirmed', reviewed_by = $2, reviewed_at = NOW(), review_note = $3
             WHERE id = $1 AND review_status = 'pending' RETURNING *`,
            [id, reviewer, input.note ?? null],
          );
          if (!rows[0]) { outcomes.push({ id, ok: false, reason: "Item not found or already reviewed" }); continue; }
          const item = rows[0];
          const matches = await exec(
            `SELECT * FROM adverse_media_entity_matches WHERE item_id = $1 AND status = 'confirmed' AND organization_id IS NOT NULL`,
            [id],
          );
          for (const m of matches) {
            const r = await exec(
              `INSERT INTO supervision_risk_signals
                 (signal_type, organization_id, source_table, source_id, severity, title, summary, created_by)
               VALUES ('adverse_media', $1, 'adverse_media_items', $2, $3, $4, $5, $6)
               ON CONFLICT (source_table, source_id, signal_type) DO NOTHING
               RETURNING id`,
              [m.organization_id, item.id, item.severity, item.title, item.summary ?? null, reviewer],
            );
            signalsPromoted += r.length;
          }
          outcomes.push({ id, ok: true });
        } catch (err) {
          outcomes.push({ id, ok: false, reason: err instanceof Error ? err.message : "update failed" });
        }
      }
      await trackFinish(operationId, outcomes);
      await logAudit("adverse_media_items_bulk_confirmed", "adverse_media_items", null, String(ctx.user.id), {
        signals_promoted: signalsPromoted, ...summarize(operationId, outcomes),
      });
      fireAndForget("bulkOps.bulkConfirmAdverseMedia");
      return { ...summarize(operationId, outcomes), signals_promoted: signalsPromoted };
    }),

  /** Reject many pending items with a shared review note. */
  bulkRejectAdverseMedia: staffProcedure
    .input(z.object({
      itemIds: idList,
      note: z.string().min(3).max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      const operationId = await trackStart("adverse_media_reject", input.itemIds, String(ctx.user.id));
      const reviewer = ctx.user.name ?? String(ctx.user.id);
      const outcomes: ItemOutcome[] = [];
      for (const id of input.itemIds) {
        try {
          const rows = await exec(
            `UPDATE adverse_media_items
             SET review_status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), review_note = $3
             WHERE id = $1 AND review_status = 'pending' RETURNING id`,
            [id, reviewer, input.note],
          );
          if (!rows[0]) { outcomes.push({ id, ok: false, reason: "Item not found or already reviewed" }); continue; }
          outcomes.push({ id, ok: true });
        } catch (err) {
          outcomes.push({ id, ok: false, reason: err instanceof Error ? err.message : "update failed" });
        }
      }
      await trackFinish(operationId, outcomes);
      await logAudit("adverse_media_items_bulk_rejected", "adverse_media_items", null, String(ctx.user.id), {
        note: input.note, ...summarize(operationId, outcomes),
      });
      fireAndForget("bulkOps.bulkRejectAdverseMedia");
      return summarize(operationId, outcomes);
    }),
});
