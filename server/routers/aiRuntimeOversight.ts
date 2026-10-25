/**
 * AI-system runtime oversight router (FEAT-E, round 9).
 *
 * Extends the aiRegulation register (0053) with:
 *   - runtime AI system register (model version + hash tracked);
 *   - mandatory AI-incident reporting with severity classes and a 72h
 *     substantive-response clock for class_1_serious incidents (mirroring the
 *     breach workflow);
 *   - periodic algorithmic audit submissions with due-date tracking and
 *     overdue flags;
 *   - material-change re-audit triggers: registered model version/hash change
 *     opens a sandbox review task;
 *   - incident -> enforcement referral;
 *   - public transparency register of approved high-risk systems (minimal
 *     fields only).
 * Every mutation writes an audit_logs row and emits a mutation event.
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure, adminProcedure, staffProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import {
  AI_SEVERITY_CLASSES,
  responseDueAt,
  incidentSlaState,
  isAuditOverdue,
  materialChangeTrigger,
  formatIncidentRef,
  formatSystemRef,
} from "../services/aiOversightLogic";

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
    logger.error({ err, query: query.slice(0, 200) }, "[aiRuntimeOversight] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

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
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[aiRuntimeOversight] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

const INCIDENT_STATUSES = ["reported", "acknowledged", "investigating", "contained", "closed", "referred_enforcement"] as const;

export const aiRuntimeOversightRouter = router({
  // ─── Runtime system register ─────────────────────────────────────────────
  registerSystem: protectedProcedure
    .input(z.object({
      organization_id: z.number().int().positive(),
      system_name: z.string().min(2).max(256),
      purpose: z.string().max(4000).optional(),
      risk_tier: z.enum(["minimal", "limited", "high", "unacceptable"]).default("limited"),
      model_version: z.string().max(128).optional(),
      model_hash: z.string().regex(/^[a-f0-9]{64}$/i, "sha256 hex").optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const year = new Date().getUTCFullYear();
      const [{ nextval }] = await exec(`SELECT nextval('airs_ref_seq') AS nextval`);
      const ref = formatSystemRef(year, Number(nextval));
      const [row] = await exec(
        `INSERT INTO ai_system_registry
           (system_ref, organization_id, system_name, purpose, risk_tier, model_version, model_hash, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [ref, input.organization_id, input.system_name, input.purpose ?? null,
         input.risk_tier, input.model_version ?? null, input.model_hash ?? null,
         ctx.user.name ?? String(ctx.user.id)],
      );
      await logAudit("ai_system_registered", "ai_system_registry", row.id, String(ctx.user.id), { system_ref: ref, risk_tier: input.risk_tier });
      fireAndForget("aiRuntimeOversight.registerSystem");
      return row;
    }),

  listSystems: protectedProcedure
    .input(z.object({
      organization_id: z.number().int().positive().optional(),
      risk_tier: z.enum(["minimal", "limited", "high", "unacceptable"]).optional(),
      status: z.enum(["registered", "approved", "suspended", "retired"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.organization_id) { params.push(input.organization_id); conditions.push(`organization_id = $${params.length}`); }
      if (input?.risk_tier) { params.push(input.risk_tier); conditions.push(`risk_tier = $${params.length}`); }
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(`SELECT * FROM ai_system_registry ${where} ORDER BY created_at DESC LIMIT 500`, params);
    }),

  /** Approve a high-risk system (adds it to the public transparency register). */
  approveSystem: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE ai_system_registry SET status = 'approved', approved_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'registered' RETURNING *`,
        [input.id],
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "System not found or not in registered state" });
      await logAudit("ai_system_approved", "ai_system_registry", input.id, String(ctx.user.id), { risk_tier: row.risk_tier });
      fireAndForget("aiRuntimeOversight.approveSystem");
      return row;
    }),

  /**
   * Update registered model version/hash. A change is a MATERIAL CHANGE and
   * opens a re-audit trigger with a sandbox review task reference.
   */
  updateModelVersion: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      model_version: z.string().max(128).optional(),
      model_hash: z.string().regex(/^[a-f0-9]{64}$/i, "sha256 hex").optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const sys = await exec(`SELECT * FROM ai_system_registry WHERE id = $1`, [input.id]);
      if (!sys[0]) throw new TRPCError({ code: "NOT_FOUND", message: "System not found" });
      const decision = materialChangeTrigger(
        { model_version: sys[0].model_version, model_hash: sys[0].model_hash },
        { model_version: input.model_version, model_hash: input.model_hash },
      );
      const [row] = await exec(
        `UPDATE ai_system_registry SET
           model_version = COALESCE($2, model_version),
           model_hash = COALESCE($3, model_hash),
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [input.id, input.model_version ?? null, input.model_hash ?? null],
      );
      let trigger = null;
      if (decision.trigger) {
        const sandboxRef = `SBX-R9-${input.id}-${Date.now()}`;
        const [t] = await exec(
          `INSERT INTO ai_reaudit_triggers
             (system_id, trigger_type, old_version, new_version, old_hash, new_hash, status, sandbox_task_ref, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8) RETURNING *`,
          [input.id, decision.trigger_type, sys[0].model_version ?? null, input.model_version ?? null,
           sys[0].model_hash ?? null, input.model_hash ?? null, sandboxRef, ctx.user.name ?? String(ctx.user.id)],
        );
        trigger = t;
      }
      await logAudit("ai_system_model_updated", "ai_system_registry", input.id, String(ctx.user.id), {
        material_change: decision.trigger, trigger_type: decision.trigger_type,
      });
      fireAndForget("aiRuntimeOversight.updateModelVersion");
      return { system: row, reaudit_trigger: trigger };
    }),

  listReauditTriggers: staffProcedure
    .input(z.object({ status: z.enum(["open", "sandbox_review", "cleared"]).optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.status) { params.push(input.status); where = `WHERE t.status = $1`; }
      return exec(
        `SELECT t.*, s.system_ref, s.system_name, s.risk_tier
         FROM ai_reaudit_triggers t JOIN ai_system_registry s ON s.id = t.system_id
         ${where} ORDER BY t.created_at DESC LIMIT 200`,
        params,
      );
    }),

  resolveReauditTrigger: staffProcedure
    .input(z.object({ id: z.number().int().positive(), resolution: z.enum(["sandbox_review", "cleared"]), reason: z.string().min(5) }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE ai_reaudit_triggers
         SET status = $2, reason = $3, resolved_by = $4, resolved_at = NOW()
         WHERE id = $1 AND status IN ('open', 'sandbox_review') RETURNING *`,
        [input.id, input.resolution, input.reason, ctx.user.name ?? String(ctx.user.id)],
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Trigger not found or already resolved" });
      await logAudit("ai_reaudit_trigger_resolved", "ai_reaudit_triggers", input.id, String(ctx.user.id), { resolution: input.resolution });
      fireAndForget("aiRuntimeOversight.resolveReauditTrigger");
      return row;
    }),

  // ─── Incident reporting (72h clock for serious incidents) ────────────────
  reportIncident: protectedProcedure
    .input(z.object({
      system_id: z.number().int().positive().optional(),
      organization_id: z.number().int().positive(),
      severity_class: z.enum(AI_SEVERITY_CLASSES),
      description: z.string().min(10),
      occurred_at: z.string().optional(),
      reporter_type: z.enum(["org", "public", "regulator"]).default("org"),
      reporter_name: z.string().max(256).optional(),
      reporter_email: z.string().email().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const year = new Date().getUTCFullYear();
      const [{ nextval }] = await exec(`SELECT nextval('airt_rt_ref_seq') AS nextval`);
      const ref = formatIncidentRef(year, Number(nextval));
      const now = new Date();
      const due = responseDueAt(input.severity_class, now);
      const [row] = await exec(
        `INSERT INTO ai_runtime_incidents
           (incident_ref, system_id, organization_id, reporter_type, reporter_name, reporter_email,
            severity_class, description, occurred_at, reported_at, response_due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, NOW()), $10, $11)
         RETURNING *`,
        [ref, input.system_id ?? null, input.organization_id, input.reporter_type,
         input.reporter_name ?? null, input.reporter_email ?? null,
         input.severity_class, input.description, input.occurred_at ?? null,
         now.toISOString(), due ? due.toISOString() : null],
      );
      await logAudit("ai_runtime_incident_reported", "ai_runtime_incidents", row.id, String(ctx.user.id), {
        incident_ref: ref, severity_class: input.severity_class, response_due_at: due?.toISOString() ?? null,
      });
      fireAndForget("aiRuntimeOversight.reportIncident");
      return row;
    }),

  listIncidents: staffProcedure
    .input(z.object({
      status: z.enum(INCIDENT_STATUSES).optional(),
      severity_class: z.enum(AI_SEVERITY_CLASSES).optional(),
      sla_breached_only: z.boolean().default(false),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input?.status) { params.push(input.status); conditions.push(`status = $${params.length}`); }
      if (input?.severity_class) { params.push(input.severity_class); conditions.push(`severity_class = $${params.length}`); }
      if (input?.sla_breached_only) {
        conditions.push(`response_due_at IS NOT NULL AND responded_at IS NULL AND response_due_at < NOW()
                         AND status IN ('reported', 'acknowledged', 'investigating')`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = await exec(`SELECT * FROM ai_runtime_incidents ${where} ORDER BY reported_at DESC LIMIT 500`, params);
      return rows.map((r) => ({ ...r, sla_state: incidentSlaState(r) }));
    }),

  updateIncidentStatus: staffProcedure
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(INCIDENT_STATUSES),
      note: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.status === "referred_enforcement") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Use referIncidentToEnforcement for enforcement referrals" });
      }
      // responded_at stamps the first substantive response (contained/closed),
      // closing the 72h clock for class_1 incidents.
      const substantive = ["contained", "closed"].includes(input.status);
      const [row] = await exec(
        `UPDATE ai_runtime_incidents
         SET status = $2,
             responded_at = CASE WHEN $3::boolean AND responded_at IS NULL THEN NOW() ELSE responded_at END,
             updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [input.id, input.status, substantive],
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Incident not found" });
      await logAudit("ai_runtime_incident_status_updated", "ai_runtime_incidents", input.id, String(ctx.user.id), {
        status: input.status, note: input.note ?? null,
      });
      fireAndForget("aiRuntimeOversight.updateIncidentStatus");
      return { ...row, sla_state: incidentSlaState(row) };
    }),

  /** Incident -> enforcement referral: links to an enforcement case and
   *  records the referral in the shared ai_enforcement_links table (0053). */
  referIncidentToEnforcement: adminProcedure
    .input(z.object({
      incident_id: z.number().int().positive(),
      enforcement_case_id: z.number().int().positive(),
      link_notes: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const inc = await exec(`SELECT * FROM ai_runtime_incidents WHERE id = $1`, [input.incident_id]);
      if (!inc[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Incident not found" });
      const ec = await exec(`SELECT id FROM enforcement_cases WHERE id = $1`, [input.enforcement_case_id]);
      if (!ec[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Enforcement case not found" });
      const [row] = await exec(
        `UPDATE ai_runtime_incidents
         SET status = 'referred_enforcement', enforcement_case_id = $2,
             responded_at = COALESCE(responded_at, NOW()), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [input.incident_id, input.enforcement_case_id],
      );
      await exec(
        `INSERT INTO ai_enforcement_links (source_type, source_id, enforcement_case_id, link_notes, escalated_by)
         VALUES ('incident', $1, $2, $3, $4)`,
        [input.incident_id, input.enforcement_case_id, input.link_notes, toIntOrNull(String(ctx.user.id))],
      );
      await logAudit("ai_runtime_incident_referred", "ai_runtime_incidents", input.incident_id, String(ctx.user.id), {
        enforcement_case_id: input.enforcement_case_id,
      });
      fireAndForget("aiRuntimeOversight.referIncidentToEnforcement");
      return row;
    }),

  // ─── Periodic algorithmic audits ─────────────────────────────────────────
  scheduleAudit: staffProcedure
    .input(z.object({
      system_id: z.number().int().positive(),
      audit_period: z.string().min(4).max(16),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `INSERT INTO ai_algorithmic_audits (system_id, audit_period, due_date, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (system_id, audit_period) DO UPDATE SET due_date = EXCLUDED.due_date, updated_at = NOW()
         RETURNING *`,
        [input.system_id, input.audit_period, input.due_date, ctx.user.name ?? String(ctx.user.id)],
      );
      await logAudit("ai_audit_scheduled", "ai_algorithmic_audits", row.id, String(ctx.user.id), input);
      fireAndForget("aiRuntimeOversight.scheduleAudit");
      return row;
    }),

  submitAudit: protectedProcedure
    .input(z.object({
      system_id: z.number().int().positive(),
      audit_period: z.string().min(4).max(16),
      auditor_name: z.string().min(2).max(256),
      findings_summary: z.string().min(10),
      report_ref: z.string().max(1024).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE ai_algorithmic_audits
         SET status = 'submitted', submitted_at = NOW(), auditor_name = $3,
             findings_summary = $4, report_ref = $5, updated_at = NOW()
         WHERE system_id = $1 AND audit_period = $2 AND status IN ('due', 'submitted')
         RETURNING *`,
        [input.system_id, input.audit_period, input.auditor_name, input.findings_summary, input.report_ref ?? null],
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "No due audit obligation found for this system/period" });
      await logAudit("ai_audit_submitted", "ai_algorithmic_audits", row.id, String(ctx.user.id), {
        system_id: input.system_id, audit_period: input.audit_period,
      });
      fireAndForget("aiRuntimeOversight.submitAudit");
      return row;
    }),

  reviewAudit: staffProcedure
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["accepted", "rejected"]),
      review_notes: z.string().min(5),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE ai_algorithmic_audits
         SET status = $2, review_notes = $3, reviewed_by = $4, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'submitted' RETURNING *`,
        [input.id, input.decision, input.review_notes, ctx.user.name ?? String(ctx.user.id)],
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Audit not found or not submitted" });
      await logAudit("ai_audit_reviewed", "ai_algorithmic_audits", input.id, String(ctx.user.id), { decision: input.decision });
      fireAndForget("aiRuntimeOversight.reviewAudit");
      return row;
    }),

  /** Audit obligations with computed overdue flags. */
  listAudits: staffProcedure
    .input(z.object({ system_id: z.number().int().positive().optional(), overdue_only: z.boolean().default(false) }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.system_id) { params.push(input.system_id); where = `WHERE a.system_id = $1`; }
      const rows = await exec(
        `SELECT a.*, s.system_ref, s.system_name FROM ai_algorithmic_audits a
         JOIN ai_system_registry s ON s.id = a.system_id
         ${where} ORDER BY a.due_date ASC LIMIT 500`,
        params,
      );
      const withFlags = rows.map((r) => ({ ...r, overdue: isAuditOverdue(r) }));
      return input?.overdue_only ? withFlags.filter((r) => r.overdue) : withFlags;
    }),

  // ─── Public transparency register (approved high-risk systems, minimal) ──
  transparencyRegister: publicProcedure.query(async () => {
    return exec(
      `SELECT system_ref, system_name, purpose, risk_tier, approved_at
       FROM ai_system_registry
       WHERE status = 'approved' AND risk_tier = 'high'
       ORDER BY approved_at DESC`,
    );
  }),
});
