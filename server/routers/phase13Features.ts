import { z } from "zod";
import { router, protectedProcedure, publicProcedure, exportProcedure, deleteProcedure, approveProcedure} from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { getConflictRiskLevel, isConflictCountry } from "../osirisClient";
import { autoDecryptRows } from "../encryptionMiddleware";

async function exec(query: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    // Stringify arrays and plain objects so pg passes them as valid JSON to JSONB columns
    const safeParams = params.map((p) =>
      Array.isArray(p) || (p !== null && typeof p === 'object' && !(p instanceof Date))
        ? JSON.stringify(p)
        : p
    );
    const result = await pool.query(query, safeParams);
    const rows = result.rows ?? [];
    return autoDecryptRows(query, rows);
  } catch (err) {
    logger.error({ err, query: query.slice(0, 200) }, "[p13] DB query error");
    return [];
  }
}

// ─── Phase 13 Audit Logging Helper ────────────────────────────────────────────────────
async function logAudit(
  action: string,
  resourceType: string,
  resourceId: string | number | null,
  userId: string | null,
  details: Record<string, unknown> = {},
  ipAddress?: string
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [action, resourceType, String(resourceId ?? ''), userId, JSON.stringify(details), ipAddress ?? null]
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, '[p13] Audit log write failed');
  }
}

// ─── Advanced Analytics Router ───────────────────────────────────────────────
export const p13AdvancedAnalyticsRouter = router({
  getSnapshots: protectedProcedure
    .input(z.object({
      metric: z.string().optional(),
      dimension: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM analytics_snapshots WHERE 1=1`;
      const params: unknown[] = [];
      if (input.metric) { params.push(input.metric); sql += ` AND metric_name = $${params.length}`; }
      if (input.dimension) { params.push(input.dimension); sql += ` AND dimension = $${params.length}`; }
      if (input.from) { params.push(input.from); sql += ` AND snapshot_date >= $${params.length}`; }
      if (input.to) { params.push(input.to); sql += ` AND snapshot_date <= $${params.length}`; }
      sql += ` ORDER BY snapshot_date DESC LIMIT 200`;
      return exec(sql, params);
    }),

  getSummary: protectedProcedure.query(async () => {
    const [totals] = await exec(`
      SELECT
        (SELECT COUNT(*) FROM organizations) as total_orgs,
        (SELECT COUNT(*) FROM organizations WHERE compliance_score >= 70) as compliant_orgs,
        (SELECT COUNT(*) FROM breach_incidents WHERE detected_at > NOW() - INTERVAL '30 days') as recent_breaches,
        (SELECT COUNT(*) FROM citizen_requests WHERE status IN ('submitted', 'acknowledged')) as pending_dsars,
        (SELECT COALESCE(SUM(amount), 0) FROM financial_penalties WHERE payment_status = 'completed') as total_fines_collected,
        (SELECT COUNT(*) FROM compliance_violations WHERE status = 'non_compliant') as open_violations
    `);
    return totals;
  }),

  getTimeSeries: protectedProcedure
    .input(z.object({ metric: z.string(), days: z.number().default(30) }))
    .query(async ({ input }) => {
      return exec(
        `SELECT snapshot_date, AVG(metric_value) as value, dimension_value
         FROM analytics_snapshots
         WHERE metric_name = $1 AND snapshot_date >= CURRENT_DATE - INTERVAL '1 day' * $2
         GROUP BY snapshot_date, dimension_value
         ORDER BY snapshot_date ASC`,
        [input.metric, input.days]
      );
    }),

  exportReport: protectedProcedure
    .input(z.object({ format: z.enum(["csv", "json", "pdf"]), metrics: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      const data = await exec(
        `SELECT * FROM analytics_snapshots WHERE metric_name = ANY($1) ORDER BY snapshot_date DESC LIMIT 1000`,
        [input.metrics]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { format: input.format, rows: data.length, downloadUrl: `/api/export/analytics?format=${input.format}` };
    }),
});

// ─── Article 40 Codes of Conduct Router ──────────────────────────────────────
export const p13Article40Router = router({
  list: protectedProcedure
    .input(z.object({ search: z.string().optional(), sector: z.string().optional(), status: z.string().optional() }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM article40_codes WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) { params.push(`%${input.search}%`); sql += ` AND (code_name ILIKE $${params.length} OR description ILIKE $${params.length})`; }
      if (input.sector) { params.push(input.sector); sql += ` AND sector = $${params.length}`; }
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      sql += ` ORDER BY created_at DESC`;
      return exec(sql, params);
    }),

  create: protectedProcedure
    .input(z.object({
      code_name: z.string().min(3),
      sector: z.string(),
      description: z.string().optional(),
      submitted_by: z.string().optional(),
      document_url: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const [row] = await exec(
        `INSERT INTO article40_codes (code_name, sector, description, submitted_by, document_url, status)
         VALUES ($1, $2, $3, $4, $5, 'draft') RETURNING *`,
        [input.code_name, input.sector, input.description, input.submitted_by, input.document_url]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  updateStatus: protectedProcedure
    .input(z.object({ id: z.number(), status: z.enum(["draft", "under_review", "approved", "rejected"]), approved_by: z.string().optional() }))
    .mutation(async ({ input }) => {
      const [row] = await exec(
        `UPDATE article40_codes SET status = $1, approved_by = $2, approval_date = CASE WHEN $1 = 'approved' THEN CURRENT_DATE ELSE NULL END, updated_at = NOW() WHERE id = $3 RETURNING *`,
        [input.status, input.approved_by, input.id]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  delete: deleteProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await exec(`DELETE FROM article40_codes WHERE id = $1`, [input.id]);
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),
});

// ─── Compliance Calendar Router ───────────────────────────────────────────────
export const p13ComplianceCalendarRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM compliance_calendar_events WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) { params.push(`%${input.search}%`); sql += ` AND title ILIKE $${params.length}`; }
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      if (input.priority) { params.push(input.priority); sql += ` AND priority = $${params.length}`; }
      if (input.from) { params.push(input.from); sql += ` AND due_date >= $${params.length}`; }
      if (input.to) { params.push(input.to); sql += ` AND due_date <= $${params.length}`; }
      sql += ` ORDER BY due_date ASC`;
      return exec(sql, params);
    }),

  create: protectedProcedure
    .input(z.object({
      title: z.string().min(3),
      event_type: z.string(),
      due_date: z.string(),
      priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      description: z.string().optional(),
      assigned_to: z.string().optional(),
      reminder_days: z.number().default(14),
      org_id: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const [row] = await exec(
        `INSERT INTO compliance_calendar_events (title, event_type, due_date, priority, description, assigned_to, reminder_days, org_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [input.title, input.event_type, input.due_date, input.priority, input.description, input.assigned_to, input.reminder_days, input.org_id]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  complete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [row] = await exec(
        `UPDATE compliance_calendar_events SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
        [input.id]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      due_date: z.string().optional(),
      priority: z.string().optional(),
      status: z.string().optional(),
      assigned_to: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const sets = Object.entries(fields).filter(([, v]) => v !== undefined).map(([k], i) => `${k} = $${i + 2}`);
      const vals = Object.values(fields).filter(v => v !== undefined);
      const [row] = await exec(
        `UPDATE compliance_calendar_events SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, ...vals]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  delete: deleteProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await exec(`DELETE FROM compliance_calendar_events WHERE id = $1`, [input.id]);
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  getUpcoming: protectedProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ input }) => {
      return exec(
        `SELECT * FROM compliance_calendar_events WHERE due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day' * $1 AND status = 'pending' ORDER BY due_date ASC`,
        [input.days]
      );
    }),
});

// ─── Consent Records V2 Router ────────────────────────────────────────────────
export const p13ConsentRecordsRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      org_id: z.number().optional(),
      legal_basis: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM consent_records_v2 WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) { params.push(`%${input.search}%`); sql += ` AND (data_subject_email ILIKE $${params.length} OR purpose ILIKE $${params.length})`; }
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      if (input.org_id) { params.push(input.org_id); sql += ` AND organization_id = $${params.length}`; }
      if (input.legal_basis) { params.push(input.legal_basis); sql += ` AND legal_basis = $${params.length}`; }
      const offset = (input.page - 1) * input.limit;
      params.push(input.limit); sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      params.push(offset); sql += ` OFFSET $${params.length}`;
      const [countResult] = await exec(`SELECT COUNT(*) FROM consent_records_v2 WHERE 1=1`);
      return { records: await exec(sql, params), total: Number(countResult.count) };
    }),

  create: protectedProcedure
    .input(z.object({
      org_id: z.number().optional(),
      data_subject_id: z.string(),
      data_subject_email: z.string().email().optional(),
      purpose: z.string(),
      legal_basis: z.enum(["consent", "contract", "legal_obligation", "vital_interests", "public_task", "legitimate_interests"]).default("consent"),
      data_categories: z.array(z.string()).default([]),
      third_party_sharing: z.boolean().default(false),
      third_parties: z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await exec(
        `INSERT INTO consent_records_v2 (organization_id, data_subject_id, data_subject_email, purpose, legal_basis, data_categories, third_party_sharing)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [input.org_id, input.data_subject_id, input.data_subject_email, input.purpose, input.legal_basis, input.data_categories, input.third_party_sharing]
      );
      await logAudit('consent.create', 'consent_record', row?.id ?? null, String(ctx.user.id), { purpose: input.purpose, legal_basis: input.legal_basis, data_subject_email: input.data_subject_email });
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  withdraw: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await exec(
        `UPDATE consent_records_v2 SET status = 'withdrawn', consent_given = false, withdrawal_date = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
        [input.id]
      );
      await logAudit('consent.withdraw', 'consent_record', input.id, String(ctx.user.id), { withdrawn_by: ctx.user.email });
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  getStats: protectedProcedure.query(async () => {
    const [stats] = await exec(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active' AND consent_given = true) as active,
        COUNT(*) FILTER (WHERE status = 'withdrawn') as withdrawn,
        COUNT(*) FILTER (WHERE expiry_date < NOW()) as expired,
        COUNT(*) FILTER (WHERE third_party_sharing = true) as with_third_party
      FROM consent_records_v2
    `);
    return stats;
  }),
});

// ─── DPO Appointment Registry Router ─────────────────────────────────────────
export const p13DpoRegistryRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT da.*, o.name as org_name FROM dpo_appointments da LEFT JOIN organizations o ON da.organization_id = o.id WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) { params.push(`%${input.search}%`); sql += ` AND (da.dpo_name ILIKE $${params.length} OR da.dpo_email ILIKE $${params.length})`; }
      if (input.status) { params.push(input.status); sql += ` AND da.credential_status = $${params.length}`; }
      sql += ` ORDER BY da.appointed_at DESC`;
      return exec(sql, params);
    }),

  create: protectedProcedure
    .input(z.object({
      organization_id: z.number(),
      dpo_name: z.string(),
      dpo_email: z.string().email(),
      dpo_phone: z.string().optional(),
      dpco_name: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await exec(
        `INSERT INTO dpo_appointments (organization_id, dpo_name, dpo_email, dpo_phone, dpco_name, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [input.organization_id, input.dpo_name, input.dpo_email, input.dpo_phone, input.dpco_name, input.notes]
      );
      await logAudit('dpo.appoint', 'dpo_appointment', row?.id ?? null, String(ctx.user.id), { dpo_name: input.dpo_name, dpo_email: input.dpo_email, organization_id: input.organization_id });
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  verify: protectedProcedure
    .input(z.object({ id: z.number(), credential_status: z.enum(["verified", "pending", "rejected"]) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await exec(
        `UPDATE dpo_appointments SET credential_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [input.credential_status, input.id]
      );
      await logAudit('dpo.verify', 'dpo_appointment', input.id, String(ctx.user.id), { credential_status: input.credential_status });
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  getStats: protectedProcedure.query(async () => {
    const [stats] = await exec(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE credential_status = 'verified') as verified,
        COUNT(*) FILTER (WHERE credential_status = 'pending') as pending,
        COUNT(*) FILTER (WHERE is_active = false) as inactive
      FROM dpo_appointments
    `);
    return stats;
  }),
});

// ─── Notification Center Router ───────────────────────────────────────────────
export const p13NotificationCenterRouter = router({
  list: protectedProcedure
    .input(z.object({
      is_read: z.boolean().optional(),
      notification_type: z.string().optional(),
      priority: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ ctx, input }) => {
      let sql = `SELECT * FROM notification_inbox WHERE (user_id = $1 OR user_id IS NULL)`;
      const params: unknown[] = [ctx.user.id];
      if (input.is_read !== undefined) { params.push(input.is_read); sql += ` AND is_read = $${params.length}`; }
      if (input.notification_type) { params.push(input.notification_type); sql += ` AND notification_type = $${params.length}`; }
      if (input.priority) { params.push(input.priority); sql += ` AND priority = $${params.length}`; }
      const offset = (input.page - 1) * input.limit;
      params.push(input.limit); sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      params.push(offset); sql += ` OFFSET $${params.length}`;
      return exec(sql, params);
    }),

  markRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [row] = await exec(
        `UPDATE notification_inbox SET is_read = true, read_at = NOW() WHERE id = $1 RETURNING *`,
        [input.id]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await exec(`UPDATE notification_inbox SET is_read = true, read_at = NOW() WHERE user_id = $1 AND is_read = false`, [ctx.user.id]);
    emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return { success: true };
  }),

  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await exec(
      `SELECT COUNT(*) as count FROM notification_inbox WHERE (user_id = $1 OR user_id IS NULL) AND is_read = false`,
      [ctx.user.id]
    );
    return { count: Number(row.count) };
  }),

  delete: deleteProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await exec(`DELETE FROM notification_inbox WHERE id = $1`, [input.id]);
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),
});

// ─── Penalty Calculator Router ────────────────────────────────────────────────
export const p13PenaltyCalculatorRouter = router({
  list: protectedProcedure
    .input(z.object({ search: z.string().optional(), status: z.string().optional() }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM penalty_calculations WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) { params.push(`%${input.search}%`); sql += ` AND (org_name ILIKE $${params.length} OR violation_type ILIKE $${params.length})`; }
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      sql += ` ORDER BY created_at DESC`;
      return exec(sql, params);
    }),

  calculate: protectedProcedure
    .input(z.object({
      org_name: z.string(),
      org_id: z.number().optional(),
      violation_type: z.string(),
      violation_date: z.string().optional(),
      annual_turnover: z.number(),
      aggravating_factors: z.array(z.string()).default([]),
      mitigating_factors: z.array(z.string()).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      // NDPA 2023 penalty calculation business logic
      // Section 48: Up to 2% of annual gross revenue or N10 million (whichever is higher) for first offence
      // Section 48: Up to 2.5% or N20 million for subsequent offences
      const isRepeatOffender = input.aggravating_factors.includes("repeat_offender");
      const baseRate = isRepeatOffender ? 0.025 : 0.02;
      const minimumFine = isRepeatOffender ? 20000000 : 10000000; // NGN
      const calculatedBase = input.annual_turnover * baseRate;
      const base_penalty = Math.max(calculatedBase, minimumFine);

      // Aggravating factors: +10% each
      const aggravatingMultiplier = 1 + (input.aggravating_factors.length * 0.1);
      // Mitigating factors: -5% each (max 30% reduction)
      const mitigatingReduction = Math.min(input.mitigating_factors.length * 0.05, 0.30);

      const final_penalty = base_penalty * aggravatingMultiplier * (1 - mitigatingReduction);
      // Cap at 2.5% of turnover
      const penalty_cap = input.annual_turnover * 0.025;

      const [row] = await exec(
        `INSERT INTO penalty_calculations (org_id, org_name, violation_type, violation_date, annual_turnover, base_penalty, aggravating_factors, mitigating_factors, aggravating_multiplier, mitigating_reduction, final_penalty, penalty_cap, calculation_basis)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [input.org_id, input.org_name, input.violation_type, input.violation_date, input.annual_turnover, base_penalty, input.aggravating_factors, input.mitigating_factors, aggravatingMultiplier, mitigatingReduction, Math.min(final_penalty, penalty_cap), penalty_cap, `NDPA 2023 Section 48: Base ${(baseRate * 100).toFixed(1)}% of NGN ${input.annual_turnover.toLocaleString()} turnover`]
      );
      await logAudit('penalty.calculate', 'penalty_calculation', row?.id ?? null, String(ctx.user.id), { org_name: input.org_name, violation_type: input.violation_type, final_penalty: Math.min(final_penalty, penalty_cap) });
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  approve: approveProcedure
    .input(z.object({ id: z.number(), approved_by: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await exec(
        `UPDATE penalty_calculations SET status = 'approved', approved_by = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [input.approved_by, input.id]
      );
      await logAudit('penalty.approve', 'penalty_calculation', input.id, String(ctx.user.id), { approved_by: input.approved_by });
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  listFiltered: protectedProcedure
    .input(z.object({
      violationType: z.string().optional(),
      status: z.string().optional(),
      orgName: z.string().optional(),
      page: z.number().int().default(1),
      limit: z.number().int().default(20),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (input.violationType) { conditions.push(`violation_type = $${idx++}`); params.push(input.violationType); }
      if (input.status) { conditions.push(`status = $${idx++}`); params.push(input.status); }
      if (input.orgName) { conditions.push(`org_name ILIKE $${idx++}`); params.push(`%${input.orgName}%`); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await exec(`SELECT * FROM penalty_calculations ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`, [...params, input.limit, offset]);
      const [cnt] = await exec(`SELECT COUNT(*) as total FROM penalty_calculations ${where}`, params);
      return { items: rows, total: parseInt(cnt?.total ?? '0'), page: input.page, limit: input.limit };
    }),

  // ─── Penalty Dashboard Stats ─────────────────────────────────────────────────────────
  dashboardStats: protectedProcedure.query(async () => {
    const [totals] = await exec(`
      SELECT
        COUNT(*) as total_calculations,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_count,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
        COALESCE(SUM(final_penalty::numeric), 0) as total_penalty_value,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN final_penalty::numeric ELSE 0 END), 0) as approved_penalty_value,
        COALESCE(AVG(final_penalty::numeric), 0) as avg_penalty_value,
        COALESCE(MAX(final_penalty::numeric), 0) as max_penalty_value
      FROM penalty_calculations
    `);
    const byViolationType = await exec(`
      SELECT violation_type, COUNT(*) as count,
        COALESCE(SUM(final_penalty::numeric), 0) as total_amount
      FROM penalty_calculations
      GROUP BY violation_type ORDER BY count DESC
    `);
    const byStatus = await exec(`
      SELECT status, COUNT(*) as count,
        COALESCE(SUM(final_penalty::numeric), 0) as total_amount
      FROM penalty_calculations
      GROUP BY status ORDER BY count DESC
    `);
    const monthlyTrend = await exec(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as count,
        COALESCE(SUM(final_penalty::numeric), 0) as total_amount
      FROM penalty_calculations
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month ASC
    `);
    const topOrgs = await exec(`
      SELECT org_name,
        COUNT(*) as case_count,
        COALESCE(SUM(final_penalty::numeric), 0) as total_penalties
      FROM penalty_calculations
      GROUP BY org_name ORDER BY total_penalties DESC LIMIT 10
    `);
    return { totals, byViolationType, byStatus, monthlyTrend, topOrgs };
  }),
});

// ─── Public Compliance Registry Router ───────────────────────────────────────
export const p13PublicRegistryRouter = router({
  list: publicProcedure
    .input(z.object({
      search: z.string().optional(),
      sector: z.string().optional(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM public_compliance_registry WHERE is_published = true`;
      const params: unknown[] = [];
      if (input.search) { params.push(`%${input.search}%`); sql += ` AND (org_name ILIKE $${params.length} OR registration_number ILIKE $${params.length})`; }
      if (input.sector) { params.push(input.sector); sql += ` AND sector = $${params.length}`; }
      if (input.status) { params.push(input.status); sql += ` AND compliance_status = $${params.length}`; }
      sql += ` ORDER BY compliance_score DESC`;
      return exec(sql, params);
    }),

  getStats: publicProcedure.query(async () => {
    const [stats] = await exec(`
      SELECT
        COUNT(*) as total_registered,
        COUNT(*) FILTER (WHERE compliance_status = 'compliant') as compliant,
        COUNT(*) FILTER (WHERE compliance_status = 'partially_compliant') as partial,
        COUNT(*) FILTER (WHERE compliance_status = 'non_compliant') as non_compliant,
        ROUND(AVG(compliance_score), 1) as avg_score
      FROM public_compliance_registry WHERE is_published = true
    `);
    return stats;
  }),

  publish: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const [row] = await exec(
        `UPDATE public_compliance_registry SET is_published = true, published_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
        [input.id]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  upsert: protectedProcedure
    .input(z.object({
      org_id: z.number(),
      org_name: z.string(),
      registration_number: z.string().optional(),
      sector: z.string().optional(),
      compliance_status: z.enum(["compliant", "partially_compliant", "non_compliant", "pending"]).default("pending"),
      compliance_score: z.number().min(0).max(100).default(0),
    }))
    .mutation(async ({ input }) => {
      const [row] = await exec(
        `INSERT INTO public_compliance_registry (org_id, org_name, registration_number, sector, compliance_status, compliance_score, last_assessment_date)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)
         ON CONFLICT (org_id) DO UPDATE SET compliance_status = $5, compliance_score = $6, last_assessment_date = CURRENT_DATE, updated_at = NOW()
         RETURNING *`,
        [input.org_id, input.org_name, input.registration_number, input.sector, input.compliance_status, input.compliance_score]
      ).catch(async () => {
        // If no unique constraint, just insert
        emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return exec(
          `INSERT INTO public_compliance_registry (org_id, org_name, registration_number, sector, compliance_status, compliance_score, last_assessment_date)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE) RETURNING *`,
          [input.org_id, input.org_name, input.registration_number, input.sector, input.compliance_status, input.compliance_score]
        );
      });
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return Array.isArray(row) ? row[0] : row;
    }),
});

// ─── Risk Scorecard Router ────────────────────────────────────────────────────
export const p13RiskScorecardRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      org_id: z.number().optional(),
      risk_category: z.string().optional(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM risk_scorecard_entries WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) { params.push(`%${input.search}%`); sql += ` AND (risk_name ILIKE $${params.length} OR risk_category ILIKE $${params.length})`; }
      if (input.org_id) { params.push(input.org_id); sql += ` AND org_id = $${params.length}`; }
      if (input.risk_category) { params.push(input.risk_category); sql += ` AND risk_category = $${params.length}`; }
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      sql += ` ORDER BY risk_score DESC NULLS LAST`;
      return exec(sql, params);
    }),

  create: protectedProcedure
    .input(z.object({
      org_id: z.number().optional(),
      risk_category: z.string(),
      risk_name: z.string(),
      likelihood: z.number().min(1).max(5),
      impact: z.number().min(1).max(5),
      owner: z.string().optional(),
      mitigation_plan: z.string().optional(),
      review_date: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const risk_score = input.likelihood * input.impact;
      const risk_level = risk_score >= 20 ? "critical" : risk_score >= 12 ? "high" : risk_score >= 6 ? "medium" : "low";
      const [row] = await exec(
        `INSERT INTO risk_scorecard_entries (org_id, risk_category, risk_name, likelihood, impact, risk_level, owner, mitigation_plan, review_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [input.org_id, input.risk_category, input.risk_name, input.likelihood, input.impact, risk_level, input.owner, input.mitigation_plan, input.review_date]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      likelihood: z.number().min(1).max(5).optional(),
      impact: z.number().min(1).max(5).optional(),
      status: z.string().optional(),
      mitigation_plan: z.string().optional(),
      control_effectiveness: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const sets = Object.entries(fields).filter(([, v]) => v !== undefined).map(([k], i) => `${k} = $${i + 2}`);
      const vals = Object.values(fields).filter(v => v !== undefined);
      const [row] = await exec(
        `UPDATE risk_scorecard_entries SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id, ...vals]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  getMatrix: protectedProcedure.query(async () => {
    return exec(`
      SELECT risk_level, COUNT(*) as count, AVG(risk_score) as avg_score
      FROM risk_scorecard_entries
      GROUP BY risk_level
      ORDER BY avg_score DESC
    `);
  }),
});

// ─── Data Residency Router ────────────────────────────────────────────────────
export const dataResidencyRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      country: z.string().optional(),
      org_id: z.number().optional(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM data_residency_locations WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) { params.push(`%${input.search}%`); sql += ` AND (data_category ILIKE $${params.length} OR provider_name ILIKE $${params.length})`; }
      if (input.country) { params.push(input.country); sql += ` AND storage_country = $${params.length}`; }
      if (input.org_id) { params.push(input.org_id); sql += ` AND org_id = $${params.length}`; }
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      sql += ` ORDER BY created_at DESC`;
      return exec(sql, params);
    }),

  create: protectedProcedure
    .input(z.object({
      org_id: z.number().optional(),
      data_category: z.string(),
      storage_country: z.string(),
      storage_region: z.string().optional(),
      provider_name: z.string().optional(),
      provider_type: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      transfer_mechanism: z.string().optional(),
      volume_gb: z.number().optional(),
      adequacy_decision: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const [row] = await exec(
        `INSERT INTO data_residency_locations (org_id, data_category, storage_country, storage_region, provider_name, provider_type, latitude, longitude, transfer_mechanism, volume_gb, adequacy_decision)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [input.org_id, input.data_category, input.storage_country, input.storage_region, input.provider_name, input.provider_type, input.latitude, input.longitude, input.transfer_mechanism, input.volume_gb, input.adequacy_decision]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  getByCountry: protectedProcedure.query(async () => {
    return exec(`
      SELECT storage_country, COUNT(*) as locations, SUM(volume_gb) as total_volume_gb,
             COUNT(*) FILTER (WHERE adequacy_decision = true) as adequate_locations
      FROM data_residency_locations
      GROUP BY storage_country
      ORDER BY total_volume_gb DESC NULLS LAST
    `);
  }),

  delete: deleteProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await exec(`DELETE FROM data_residency_locations WHERE id = $1`, [input.id]);
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),
});

// ─── Rate Limit Dashboard Router ──────────────────────────────────────────────
export const rateLimitRouter = router({
  getStats: protectedProcedure
    .input(z.object({ hours: z.number().default(24) }))
    .query(async ({ input }) => {
      return exec(
        `SELECT endpoint, SUM(requests_count) as total_requests, SUM(blocked_count) as total_blocked,
                ROUND(100.0 * SUM(blocked_count) / NULLIF(SUM(requests_count), 0), 2) as block_rate
         FROM api_rate_limit_stats
         WHERE window_start >= NOW() - INTERVAL '1 hour' * $1
         GROUP BY endpoint ORDER BY total_requests DESC LIMIT 20`,
        [input.hours]
      );
    }),

  getTimeline: protectedProcedure
    .input(z.object({ endpoint: z.string().optional(), hours: z.number().default(24) }))
    .query(async ({ input }) => {
      let sql = `SELECT DATE_TRUNC('hour', window_start) as hour, SUM(requests_count) as requests, SUM(blocked_count) as blocked
                 FROM api_rate_limit_stats WHERE window_start >= NOW() - INTERVAL '1 hour' * $1`;
      const params: unknown[] = [input.hours];
      if (input.endpoint) { params.push(input.endpoint); sql += ` AND endpoint = $${params.length}`; }
      sql += ` GROUP BY hour ORDER BY hour ASC`;
      return exec(sql, params);
    }),

  getSummary: protectedProcedure.query(async () => {
    const [stats] = await exec(`
      SELECT
        SUM(requests_count) as total_requests_24h,
        SUM(blocked_count) as total_blocked_24h,
        COUNT(DISTINCT endpoint) as monitored_endpoints,
        COUNT(DISTINCT client_ip) as unique_ips
      FROM api_rate_limit_stats
      WHERE window_start >= NOW() - INTERVAL '24 hours'
    `);
    return stats;
  }),
});

// ─── Bulk DSAR Router ─────────────────────────────────────────────────────────
export const bulkDsarRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      org_id: z.number().optional(),
      search: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      let baseSql = `SELECT * FROM bulk_dsar_jobs WHERE 1=1`;
      const params: unknown[] = [];
      if (input.status) { params.push(input.status); baseSql += ` AND status = $${params.length}`; }
      if (input.org_id) { params.push(input.org_id); baseSql += ` AND org_id = $${params.length}`; }
      if (input.search) { params.push(`%${input.search}%`); baseSql += ` AND job_name ILIKE $${params.length}`; }
      // Count total
      const countParams = [...params];
      const countSql = baseSql.replace('SELECT *', 'SELECT COUNT(*) as total');
      const [countRow] = await exec(countSql, countParams);
      const total = Number((countRow as any)?.total ?? 0);
      // Paginate
      const offset = (input.page - 1) * input.limit;
      params.push(input.limit); baseSql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      params.push(offset); baseSql += ` OFFSET $${params.length}`;
      const items = await exec(baseSql, params);
      return { items, total, page: input.page, limit: input.limit, totalPages: Math.ceil(total / input.limit) };
    }),

  create: protectedProcedure
    .input(z.object({
      org_id: z.number().optional(),
      job_name: z.string(),
      job_type: z.enum(["data_export", "erasure", "portability", "consent_withdrawal", "rectification"]),
      total_subjects: z.number().default(0),
      input_file_url: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await exec(
        `INSERT INTO bulk_dsar_jobs (org_id, job_name, job_type, total_subjects, input_file_url, created_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING *`,
        [input.org_id, input.job_name, input.job_type, input.total_subjects, input.input_file_url, ctx.user.id]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  process: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // Simulate batch processing
      const [job] = await exec(`SELECT * FROM bulk_dsar_jobs WHERE id = $1`, [input.id]);
      if (!job) throw new Error("Job not found");
      await exec(
        `UPDATE bulk_dsar_jobs SET status = 'in_progress', started_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [input.id]
      );
      // Simulate processing
      const processed = job.total_subjects || 0;
      await exec(
        `UPDATE bulk_dsar_jobs SET status = 'completed', processed_count = $1, completed_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [processed, input.id]
      );
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, processed };
    }),

  cancel: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await exec(`UPDATE bulk_dsar_jobs SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [input.id]);
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),
});

// ─── Whistleblower Case Management Router ────────────────────────────────────
export const whistleblowerCasesRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      severity: z.string().optional(),
      category: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM whistleblower_cases WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) { params.push(`%${input.search}%`); sql += ` AND (case_reference ILIKE $${params.length} OR description ILIKE $${params.length})`; }
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      if (input.severity) { params.push(input.severity); sql += ` AND severity = $${params.length}`; }
      if (input.category) { params.push(input.category); sql += ` AND category = $${params.length}`; }
      sql += ` ORDER BY opened_at DESC`;
      return exec(sql, params);
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["new", "under_investigation", "resolved", "closed", "escalated"]),
      assigned_to: z.string().optional(),
      investigation_notes: z.string().optional(),
      resolution: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await exec(
        `UPDATE whistleblower_cases SET status = $1, assigned_to = COALESCE($2, assigned_to),
         investigation_notes = COALESCE($3, investigation_notes), resolution = COALESCE($4, resolution),
         closed_at = CASE WHEN $1 IN ('resolved', 'closed') THEN NOW() ELSE NULL END,
         updated_at = NOW() WHERE id = $5 RETURNING *`,
        [input.status, input.assigned_to, input.investigation_notes, input.resolution, input.id]
      );
      await logAudit('whistleblower.updateStatus', 'whistleblower_case', input.id, String(ctx.user.id), { new_status: input.status, assigned_to: input.assigned_to });
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  getStats: protectedProcedure.query(async () => {
    const [stats] = await exec(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'new') as new_cases,
        COUNT(*) FILTER (WHERE status = 'under_investigation') as investigating,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
        COUNT(*) FILTER (WHERE severity = 'critical') as critical
      FROM whistleblower_cases
    `);
    return stats;
  }),
});

// ─── Cross-Border Transfer Monitor Router ────────────────────────────────────
export const crossBorderMonitorRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      country: z.string().optional(),
      risk_level: z.string().optional(),
      status: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM cross_border_transfers WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) { params.push(`%${input.search}%`); sql += ` AND (org_name ILIKE $${params.length} OR destination_country ILIKE $${params.length})`; }
      if (input.country) { params.push(input.country); sql += ` AND destination_country = $${params.length}`; }
      if (input.risk_level) { params.push(input.risk_level); sql += ` AND risk_level = $${params.length}`; }
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      sql += ` ORDER BY created_at DESC`;
      return exec(sql, params);
    }),

  create: protectedProcedure
    .input(z.object({
      org_id: z.number().optional(),
      org_name: z.string(),
      destination_country: z.string(),
      data_category: z.string().optional(),
      transfer_mechanism: z.string().optional(),
      volume_records: z.number().optional(),
      safeguards: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Business rule: Use Osiris conflict zone intelligence for dynamic risk assessment
      const criticalCountries = ["China", "Russia", "North Korea", "Iran"];
      const staticRisk = criticalCountries.includes(input.destination_country) ? "critical" : null;
      // Extract ISO code from country name for Osiris conflict zone lookup
      const countryIso = input.destination_country.slice(0, 2).toUpperCase();
      const conflictRisk = getConflictRiskLevel(countryIso);
      const conflictZone = isConflictCountry(countryIso);
      // Combine static list + Osiris dynamic intelligence
      let risk_level: string;
      if (staticRisk === "critical" || conflictRisk === "critical") risk_level = "critical";
      else if (conflictRisk === "high") risk_level = "high";
      else if (conflictRisk === "elevated" || input.transfer_mechanism === "none") risk_level = "high";
      else risk_level = "medium";
      const [row] = await exec(
        `INSERT INTO cross_border_transfers (org_id, org_name, destination_country, data_category, transfer_mechanism, volume_records, safeguards, risk_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [input.org_id, input.org_name, input.destination_country, input.data_category, input.transfer_mechanism, input.volume_records, input.safeguards, risk_level]
      );
      await logAudit('crossBorder.create', 'cross_border_transfer', row?.id ?? null, String(ctx.user.id), { destination_country: input.destination_country, risk_level, transfer_mechanism: input.transfer_mechanism, conflictZone: conflictZone?.name ?? null, osirisRisk: conflictRisk });
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  getByCountry: protectedProcedure.query(async () => {
    return exec(`
      SELECT destination_country, COUNT(*) as transfer_count, SUM(volume_records) as total_records,
             MAX(risk_level) as max_risk, COUNT(*) FILTER (WHERE nitda_notified = false) as unnotified
      FROM cross_border_transfers
      GROUP BY destination_country ORDER BY transfer_count DESC
    `);
  }),

  notifyNITDA: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await exec(
        `UPDATE cross_border_transfers SET nitda_notified = true, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [input.id]
      );
      await logAudit('crossBorder.notifyNITDA', 'cross_border_transfer', input.id, String(ctx.user.id), { notified_by: ctx.user.email });
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),
});

// ─── Regulatory Reporting Engine Router ──────────────────────────────────────
export const regulatoryReportingRouter = router({
  list: protectedProcedure
    .input(z.object({ search: z.string().optional(), status: z.string().optional(), report_type: z.string().optional() }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM regulatory_reports WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) { params.push(`%${input.search}%`); sql += ` AND report_name ILIKE $${params.length}`; }
      if (input.status) { params.push(input.status); sql += ` AND status = $${params.length}`; }
      if (input.report_type) { params.push(input.report_type); sql += ` AND report_type = $${params.length}`; }
      sql += ` ORDER BY created_at DESC`;
      return exec(sql, params);
    }),

  generate: protectedProcedure
    .input(z.object({
      report_name: z.string(),
      report_type: z.enum(["quarterly_national", "annual_breach", "sector_benchmark", "cross_border_annual", "dsar_summary", "enforcement_summary"]),
      reporting_period_start: z.string(),
      reporting_period_end: z.string(),
      org_id: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Gather data snapshot based on report type
      let snapshot: Record<string, unknown> = {};
      if (input.report_type === "quarterly_national") {
        const [data] = await exec(`
          SELECT
            (SELECT COUNT(*) FROM organizations) as total_orgs,
            (SELECT COUNT(*) FROM breach_incidents WHERE detected_at BETWEEN $1 AND $2) as breaches,
            (SELECT COUNT(*) FROM citizen_requests WHERE submitted_at BETWEEN $1 AND $2) as dsars,
            (SELECT COALESCE(SUM(amount), 0) FROM financial_penalties WHERE created_at BETWEEN $1 AND $2) as fines
        `, [input.reporting_period_start, input.reporting_period_end]);
        snapshot = data;
      }
      const [row] = await exec(
        `INSERT INTO regulatory_reports (report_name, report_type, reporting_period_start, reporting_period_end, org_id, status, generated_by, data_snapshot)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7) RETURNING *`,
        [input.report_name, input.report_type, input.reporting_period_start, input.reporting_period_end, input.org_id, ctx.user.name || ctx.user.email, JSON.stringify(snapshot)]
      );
      await logAudit('report.generate', 'regulatory_report', row?.id ?? null, String(ctx.user.id), { report_name: input.report_name, report_type: input.report_type });
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),

  submit: protectedProcedure
    .input(z.object({ id: z.number(), submitted_to: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await exec(
        `UPDATE regulatory_reports SET status = 'submitted', submitted_to = $1, submission_date = CURRENT_DATE, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [input.submitted_to, input.id]
      );
      await logAudit('report.submit', 'regulatory_report', input.id, String(ctx.user.id), { submitted_to: input.submitted_to, submitted_by: ctx.user.email });
      emitMutationEvent("ndsep.regulatory.mutation", { action: "phase13Features", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return row;
    }),
});

// ─── Phase 13 Combined Router ─────────────────────────────────────────────────
export const phase13Router = router({
  advancedAnalytics: p13AdvancedAnalyticsRouter,
  article40: p13Article40Router,
  complianceCalendar: p13ComplianceCalendarRouter,
  consentRecords: p13ConsentRecordsRouter,
  dpoRegistry: p13DpoRegistryRouter,
  notificationCenter: p13NotificationCenterRouter,
  penaltyCalculator: p13PenaltyCalculatorRouter,
  publicRegistry: p13PublicRegistryRouter,
  riskScorecard: p13RiskScorecardRouter,
  dataResidency: dataResidencyRouter,
  rateLimit: rateLimitRouter,
  bulkDsar: bulkDsarRouter,
  whistleblowerCases: whistleblowerCasesRouter,
  crossBorderMonitor: crossBorderMonitorRouter,
  regulatoryReporting: regulatoryReportingRouter,
});
