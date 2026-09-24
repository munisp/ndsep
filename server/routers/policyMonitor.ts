/**
 * Policy Monitor Router — privacy-policy change monitoring (NDPA 2023
 * ss. 34-35 transparency / privacy-notice obligations).
 *
 * - Monitored-policy registry (controller privacy-notice URLs)
 * - Version history + semantic diffs (heuristic + ollama_llm_worker;
 *   UNCONFIGURED diffs stay queued for retry — never silently dropped)
 * - Officer review-task queue: assign / decide / escalate to investigation
 * - Policy-change → controller notification (in_app_notifications)
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";

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
    logger.error({ err, query: query.slice(0, 200) }, "[policyMonitor] DB query error");
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
    logger.warn({ err, action, resourceType }, "[policyMonitor] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

const CLASSIFICATIONS = ["pending", "none", "minor", "material_neutral", "material_beneficial", "material_adverse"] as const;
const REVIEW_STATUSES = ["open", "assigned", "in_progress", "decided", "escalated", "closed"] as const;
const PRIORITIES = ["critical", "high", "medium", "low"] as const;

const urlSchema = z.string().url().max(2048).refine(
  (u) => /^https?:\/\//i.test(u),
  { message: "policy_url must include http(s) scheme" }
);

export const policyMonitorRouter = router({
  // ─── Policy registry ─────────────────────────────────────────────────────
  listPolicies: protectedProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      organizationId: z.number().int().positive().optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.enabled !== undefined) { params.push(input.enabled); conditions.push(`p.enabled = $${params.length}`); }
      if (input?.organizationId) { params.push(input.organizationId); conditions.push(`p.organization_id = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT p.*, o.name AS organization_name,
                (SELECT COUNT(*) FROM policy_versions v WHERE v.policy_id = p.id) AS version_count,
                (SELECT COUNT(*) FROM policy_reviews r WHERE r.policy_id = p.id
                   AND r.status IN ('open','assigned','in_progress')) AS open_reviews
           FROM monitored_policies p
           LEFT JOIN organizations o ON o.id = p.organization_id
           ${where} ORDER BY p.created_at DESC LIMIT 500`,
        params
      );
    }),

  getPolicy: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await exec(`SELECT * FROM monitored_policies WHERE id = $1`, [input.id]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Monitored policy not found" });
      return rows[0];
    }),

  registerPolicy: adminProcedure
    .input(z.object({
      organization_id: z.number().int().positive().optional(),
      controller_name: z.string().min(2).max(256),
      policy_url: urlSchema,
      check_interval_hours: z.number().int().min(1).max(8760).default(24),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.organization_id) {
        const org = await exec(`SELECT id FROM organizations WHERE id = $1`, [input.organization_id]);
        if (!org[0]) throw new TRPCError({ code: "BAD_REQUEST", message: "organization_id not found" });
      }
      const [row] = await exec(
        `INSERT INTO monitored_policies
           (organization_id, controller_name, policy_url, check_interval_hours, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (policy_url) DO NOTHING RETURNING *`,
        [input.organization_id ?? null, input.controller_name, input.policy_url,
         input.check_interval_hours, input.notes ?? null, ctx.user.name ?? String(ctx.user.id)]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "This policy URL is already monitored" });
      await logAudit("policy_registered", "monitored_policies", row.id, String(ctx.user.id), { policy_url: input.policy_url });
      fireAndForget("policyMonitor.registerPolicy");
      return row;
    }),

  updatePolicy: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      enabled: z.boolean().optional(),
      check_interval_hours: z.number().int().min(1).max(8760).optional(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE monitored_policies
            SET enabled = COALESCE($2, enabled),
                check_interval_hours = COALESCE($3, check_interval_hours),
                notes = COALESCE($4, notes), updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [input.id, input.enabled ?? null, input.check_interval_hours ?? null, input.notes ?? null]
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Monitored policy not found" });
      await logAudit("policy_updated", "monitored_policies", input.id, String(ctx.user.id), { enabled: input.enabled });
      fireAndForget("policyMonitor.updatePolicy");
      return row;
    }),

  /** Force an immediate check on the next worker tick (the policy_monitor
   *  worker polls next_check_at). */
  checkNow: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE monitored_policies SET next_check_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND enabled = TRUE RETURNING id, controller_name, policy_url`,
        [input.id]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Policy not found or disabled" });
      await logAudit("policy_check_forced", "monitored_policies", input.id, String(ctx.user.id), {});
      fireAndForget("policyMonitor.checkNow");
      return { ...row, queued: true };
    }),

  // ─── Versions & diffs ────────────────────────────────────────────────────
  listVersions: protectedProcedure
    .input(z.object({
      policy_id: z.number().int().positive(),
      classification: z.enum(CLASSIFICATIONS).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const conditions = [`v.policy_id = $1`];
      const params: unknown[] = [input.policy_id];
      if (input.classification) { params.push(input.classification); conditions.push(`v.change_classification = $${params.length}`); }
      params.push(input.limit);
      return exec(
        `SELECT v.id, v.policy_id, v.content_hash, v.fetched_at, v.http_status,
                v.content_length, v.change_classification, v.diff_status, v.diff_summary,
                v.retry_count, v.next_retry_at, v.classifier, v.created_at
           FROM policy_versions v
           WHERE ${conditions.join(" AND ")}
           ORDER BY v.fetched_at DESC LIMIT $${params.length}`,
        params
      );
    }),

  /** Full diff detail for one version, side-by-side with its predecessor. */
  getVersionDiff: protectedProcedure
    .input(z.object({ version_id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT v.*, p.controller_name, p.policy_url
           FROM policy_versions v JOIN monitored_policies p ON p.id = v.policy_id
          WHERE v.id = $1`,
        [input.version_id]
      );
      const version = rows[0];
      if (!version) throw new TRPCError({ code: "NOT_FOUND", message: "Policy version not found" });
      const prev = await exec(
        `SELECT id, content_hash, fetched_at, content_text
           FROM policy_versions
          WHERE policy_id = $1 AND fetched_at < $2
          ORDER BY fetched_at DESC LIMIT 1`,
        [version.policy_id, version.fetched_at]
      );
      return {
        version,
        previous: prev[0]
          ? { id: prev[0].id, content_hash: prev[0].content_hash, fetched_at: prev[0].fetched_at, content_text: prev[0].content_text }
          : null,
      };
    }),

  /** Semantic-diff retry queue (UNCONFIGURED / failed) — visible so officers
   *  can confirm nothing is being silently dropped while the LLM worker is
   *  down. */
  listDiffQueue: protectedProcedure.query(async () => {
    return exec(
      `SELECT v.id, v.policy_id, v.content_hash, v.fetched_at, v.diff_status,
              v.retry_count, v.next_retry_at, v.diff_summary,
              p.controller_name, p.policy_url
         FROM policy_versions v JOIN monitored_policies p ON p.id = v.policy_id
        WHERE v.diff_status IN ('UNCONFIGURED', 'failed', 'pending')
        ORDER BY v.next_retry_at NULLS FIRST, v.fetched_at ASC LIMIT 200`
    );
  }),

  /** Manual re-queue of a version for semantic diff (e.g. after the LLM
   *  worker comes back online). */
  requeueDiff: adminProcedure
    .input(z.object({ version_id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE policy_versions
            SET next_retry_at = NOW(),
                diff_status = CASE WHEN diff_status = 'completed' THEN diff_status ELSE 'UNCONFIGURED' END
          WHERE id = $1 RETURNING id, diff_status, next_retry_at`,
        [input.version_id]
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Policy version not found" });
      await logAudit("policy_diff_requeued", "policy_versions", input.version_id, String(ctx.user.id), {});
      fireAndForget("policyMonitor.requeueDiff");
      return row;
    }),

  // ─── Review-task queue ───────────────────────────────────────────────────
  listReviews: protectedProcedure
    .input(z.object({
      status: z.enum(REVIEW_STATUSES).optional(),
      priority: z.enum(PRIORITIES).optional(),
      assigned_to: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.status) { params.push(input.status); conditions.push(`r.status = $${params.length}`); }
      if (input?.priority) { params.push(input.priority); conditions.push(`r.priority = $${params.length}`); }
      if (input?.assigned_to) { params.push(input.assigned_to); conditions.push(`r.assigned_to = $${params.length}`); }
      params.push(input?.limit ?? 100);
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(
        `SELECT r.*, p.controller_name, p.policy_url,
                v.content_hash, v.change_classification, v.diff_summary
           FROM policy_reviews r
           JOIN monitored_policies p ON p.id = r.policy_id
           JOIN policy_versions v ON v.id = r.version_id
           ${where}
           ORDER BY CASE r.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                                    WHEN 'medium' THEN 2 ELSE 3 END,
                    r.created_at ASC
           LIMIT $${params.length}`,
        params
      );
    }),

  getReview: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT r.*, p.controller_name, p.policy_url, p.organization_id,
                v.content_hash, v.change_classification, v.diff_status, v.diff_summary, v.diff_detail
           FROM policy_reviews r
           JOIN monitored_policies p ON p.id = r.policy_id
           JOIN policy_versions v ON v.id = r.version_id
          WHERE r.id = $1`,
        [input.id]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Review task not found" });
      return rows[0];
    }),

  assignReview: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      assigned_to: z.string().min(2).max(128),
      priority: z.enum(PRIORITIES).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE policy_reviews
            SET status = 'assigned', assigned_to = $2, assigned_by = $3, assigned_at = NOW(),
                priority = COALESCE($4, priority), updated_at = NOW()
          WHERE id = $1 AND status IN ('open', 'assigned', 'in_progress') RETURNING *`,
        [input.id, input.assigned_to, ctx.user.name ?? String(ctx.user.id), input.priority ?? null]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Review task not found or already closed" });
      await logAudit("policy_review_assigned", "policy_reviews", input.id, String(ctx.user.id), { assigned_to: input.assigned_to });
      fireAndForget("policyMonitor.assignReview");
      return row;
    }),

  decideReview: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["upheld", "dismissed", "referred"]),
      decision_notes: z.string().min(10).max(4000),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE policy_reviews
            SET status = 'decided', decision = $2, decision_notes = $3,
                decided_by = $4, decided_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status IN ('open', 'assigned', 'in_progress') RETURNING *`,
        [input.id, input.decision, input.decision_notes, ctx.user.name ?? String(ctx.user.id)]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Review task not found or already decided" });
      await logAudit("policy_review_decided", "policy_reviews", input.id, String(ctx.user.id), { decision: input.decision });
      fireAndForget("policyMonitor.decideReview");
      return row;
    }),

  /** Escalate a review to a formal investigation. The escalation is recorded
   *  on the review + audit trail; if the controller is a registered
   *  organization a compliance_violations record is opened as the
   *  investigation hook. */
  escalateReview: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      escalation_reason: z.string().min(10).max(4000),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `SELECT r.*, p.organization_id, p.controller_name, p.policy_url
           FROM policy_reviews r JOIN monitored_policies p ON p.id = r.policy_id WHERE r.id = $1`,
        [input.id]
      );
      const review = rows[0];
      if (!review) throw new TRPCError({ code: "NOT_FOUND", message: "Review task not found" });
      if (review.status === "escalated") throw new TRPCError({ code: "CONFLICT", message: "Review already escalated" });
      let violationId: number | null = null;
      if (review.organization_id) {
        const [violation] = await exec(
          `INSERT INTO compliance_violations
             (organization_id, title, description, severity, status, enforcement_status, metadata)
           VALUES ($1, $2, $3, 'high', 'under_review', 'pending', $4) RETURNING id`,
          [
            review.organization_id,
            `Privacy notice material adverse change — ${review.controller_name}`,
            `Escalated from policy review #${review.id}. ${input.escalation_reason}`,
            { source: "policyMonitor", review_id: review.id, policy_url: review.policy_url },
          ]
        );
        violationId = violation?.id ?? null;
      }
      const [row] = await exec(
        `UPDATE policy_reviews
            SET status = 'escalated', escalated_to_investigation = TRUE,
                escalation_reason = $2, escalated_by = $3, escalated_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status <> 'escalated' RETURNING *`,
        [input.id, input.escalation_reason, ctx.user.name ?? String(ctx.user.id)]
      );
      await logAudit("policy_review_escalated", "policy_reviews", input.id, String(ctx.user.id), {
        violation_id: violationId,
        organization_linked: Boolean(review.organization_id),
      });
      fireAndForget("policyMonitor.escalateReview");
      return {
        review: row,
        investigation_violation_id: violationId,
        note: violationId
          ? "compliance_violations record opened as investigation hook"
          : "no linked organization — escalation recorded on review + audit trail only",
      };
    }),

  closeReview: adminProcedure
    .input(z.object({ id: z.number().int().positive(), notes: z.string().max(2000).optional() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE policy_reviews
            SET status = 'closed', decision_notes = COALESCE($2, decision_notes), updated_at = NOW()
          WHERE id = $1 AND status IN ('decided', 'escalated') RETURNING *`,
        [input.id, input.notes ?? null]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Only decided or escalated reviews can be closed" });
      await logAudit("policy_review_closed", "policy_reviews", input.id, String(ctx.user.id), {});
      fireAndForget("policyMonitor.closeReview");
      return row;
    }),

  // ─── Controller notification ─────────────────────────────────────────────
  /**
   * Notify a controller of a detected policy change (e.g. after a review
   * upholds a material adverse change). Writes an in_app_notifications row
   * addressed to the controller's organization account and records the
   * notification on the review. Channel 'email'/'letter' records the
   * officer-supplied external reference (dispatch is performed by the
   * notifications subsystem / manually — never faked here).
   */
  notifyController: adminProcedure
    .input(z.object({
      review_id: z.number().int().positive(),
      channel: z.enum(["in_app", "email", "letter"]).default("in_app"),
      message: z.string().min(20).max(4000),
      external_reference: z.string().max(256).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `SELECT r.*, p.organization_id, p.controller_name, p.policy_url
           FROM policy_reviews r JOIN monitored_policies p ON p.id = r.policy_id WHERE r.id = $1`,
        [input.review_id]
      );
      const review = rows[0];
      if (!review) throw new TRPCError({ code: "NOT_FOUND", message: "Review task not found" });
      if (input.channel !== "in_app" && !input.external_reference) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "external_reference is required for non-in_app channels (dispatch proof)",
        });
      }
      let notificationId: number | null = null;
      if (input.channel === "in_app") {
        if (!review.organization_id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No linked organization account — use email/letter channel with an external reference",
          });
        }
        const [notif] = await exec(
          `INSERT INTO in_app_notifications
             (title, message, severity, category, organization_id, action_url, metadata)
           VALUES ($1, $2, 'warning', 'policy_change', $3, $4, $5) RETURNING id`,
          [
            `NDPC: privacy notice change under review — ${review.controller_name}`,
            input.message,
            review.organization_id,
            review.policy_url,
            JSON.stringify({ review_id: review.id, version_id: review.version_id, source: "policyMonitor" }),
          ]
        );
        notificationId = notif?.id ?? null;
      }
      const reference = input.channel === "in_app"
        ? `in_app:${notificationId}`
        : `${input.channel}:${input.external_reference}`;
      const [row] = await exec(
        `UPDATE policy_reviews
            SET controller_notified = TRUE, controller_notified_at = NOW(),
                controller_notified_by = $2, notification_channel = $3,
                notification_reference = $4, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [input.review_id, ctx.user.name ?? String(ctx.user.id), input.channel, reference]
      );
      await logAudit("policy_controller_notified", "policy_reviews", input.review_id, String(ctx.user.id), {
        channel: input.channel, reference, notification_id: notificationId,
      });
      fireAndForget("policyMonitor.notifyController");
      return { review: row, notification_id: notificationId, reference };
    }),

  /** Dashboard rollup. */
  monitorOverview: protectedProcedure.query(async () => {
    const [row] = await exec(
      `SELECT
         (SELECT COUNT(*) FROM monitored_policies WHERE enabled = TRUE) AS enabled_policies,
         (SELECT COUNT(*) FROM policy_versions) AS total_versions,
         (SELECT COUNT(*) FROM policy_versions WHERE change_classification = 'material_adverse') AS material_adverse_changes,
         (SELECT COUNT(*) FROM policy_versions WHERE diff_status IN ('UNCONFIGURED','failed','pending')) AS diff_queue_depth,
         (SELECT COUNT(*) FROM policy_reviews WHERE status IN ('open','assigned','in_progress')) AS open_reviews,
         (SELECT COUNT(*) FROM policy_reviews WHERE status = 'escalated') AS escalated_reviews,
         (SELECT COUNT(*) FROM monitored_policies WHERE consecutive_failures >= 3) AS failing_policies`
    );
    return row ?? {};
  }),
});
