import { z } from "zod";

import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import pg from "pg";
import { emitEvent, logAuditEvent, broadcastEvent, cacheGetJson, cacheSetJson, cacheDel, triggerWorkflow } from "../middlewareHelpers";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { getPgSslConfig } from "../dbSslConfig";
import { getDatabaseUrl } from "../config";
import { logger } from "../logger";
const { Pool } = pg;
let _pool: InstanceType<typeof Pool> | null = null;
function getPool(): InstanceType<typeof Pool> {
  if (!_pool) {
    _pool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: getPgSslConfig(),
    });
  }
  return _pool;
}
async function q(sql: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  const res = await pool.query(sql, params);
  return autoDecryptRows(sql, res.rows);
}

export const telecomRouter = router({
  // ── Operators ──────────────────────────────────────────────────────────────
  listOperators: protectedProcedure
    .input(z.object({ search: z.string().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT * FROM telecom_operators
         WHERE ($1::text IS NULL OR operator_name ILIKE '%' || $1 || '%' OR operator_code ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR operator_type = $2)
         ORDER BY subscriber_base DESC NULLS LAST`,
        [input?.search ?? null, input?.status ?? null]
      );
      return rows;
    }),

  getOperator: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT o.*, 
          (SELECT COUNT(*) FROM spectrum_licences WHERE operator_id = o.id) as licence_count,
          (SELECT COUNT(*) FROM qos_violations WHERE operator_id = o.id AND status = 'open') as open_violations
         FROM telecom_operators o WHERE o.id = $1`,
        [input.id]
      );
      return rows[0] ?? null;
    }),

  // ── Spectrum Licences ──────────────────────────────────────────────────────
  listSpectrumLicences: protectedProcedure
    .input(z.object({
      operatorId: z.number().optional(),
      band: z.string().optional(),
      status: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 20;
      const offset = ((input?.page ?? 1) - 1) * limit;
      const rows = await q(
        `SELECT s.*, o.operator_name, o.operator_code
         FROM spectrum_licences s
         LEFT JOIN telecom_operators o ON s.operator_id = o.id
         WHERE ($1::int IS NULL OR s.operator_id = $1)
         AND ($2::text IS NULL OR s.band::text = $2)
         AND ($3::text IS NULL OR s.status::text = $3)
         ORDER BY s.created_at DESC
         LIMIT $4 OFFSET $5`,
        [input?.operatorId ?? null, input?.band ?? null, input?.status ?? null, limit, offset]
      );
      const countRows = await q(
        `SELECT COUNT(*) FROM spectrum_licences WHERE ($1::int IS NULL OR operator_id = $1)`,
        [input?.operatorId ?? null]
      );
      return { data: rows, total: parseInt(countRows[0]?.count ?? '0') };
    }),

  createSpectrumLicence: adminProcedure
    .input(z.object({
      licenceRef: z.string(),
      operatorId: z.number(),
      band: z.string(),
      frequencyRangeMhz: z.string(),
      bandwidthMhz: z.number(),
      annualFeeNgn: z.number().optional(),
      issuedAt: z.string().optional(),
      expiresAt: z.string().optional(),
      dataLocalisationCompliant: z.boolean().default(false),
      lawfulInterceptEnabled: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const rows = await q(
        `INSERT INTO spectrum_licences (licence_ref,operator_id,band,frequency_range_mhz,bandwidth_mhz,annual_fee_ngn,issued_at,expires_at,data_localisation_compliant,lawful_intercept_enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [input.licenceRef, input.operatorId, input.band, input.frequencyRangeMhz, input.bandwidthMhz,
         input.annualFeeNgn ?? null, input.issuedAt ?? null, input.expiresAt ?? null,
         input.dataLocalisationCompliant, input.lawfulInterceptEnabled]
      );
      emitMutationEvent(EVENTS.TELECOM_MONITORING, { action: "telecom_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  // ── QoS Violations ────────────────────────────────────────────────────────
  listQosViolations: protectedProcedure
    .input(z.object({
      operatorId: z.number().optional(),
      violationType: z.string().optional(),
      severity: z.string().optional(),
      status: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 20;
      const offset = ((input?.page ?? 1) - 1) * limit;
      const rows = await q(
        `SELECT q.*, o.operator_name, o.operator_code
         FROM qos_violations q
         LEFT JOIN telecom_operators o ON q.operator_id = o.id
         WHERE ($1::int IS NULL OR q.operator_id = $1)
         AND ($2::text IS NULL OR q.violation_type::text = $2)
         AND ($3::text IS NULL OR q.severity::text = $3)
         AND ($4::text IS NULL OR q.status = $4)
         ORDER BY q.detected_at DESC
         LIMIT $5 OFFSET $6`,
        [input?.operatorId ?? null, input?.violationType ?? null,
         input?.severity ?? null, input?.status ?? null, limit, offset]
      );
      const countRows = await q(`SELECT COUNT(*) FROM qos_violations`);
      return { data: rows, total: parseInt(countRows[0]?.count ?? '0') };
    }),

  createQosViolation: adminProcedure
    .input(z.object({
      violationRef: z.string(),
      operatorId: z.number(),
      violationType: z.string(),
      severity: z.string(),
      measuredValue: z.number().optional(),
      thresholdValue: z.number().optional(),
      measurementUnit: z.string().optional(),
      affectedRegion: z.string().optional(),
      affectedSubscribers: z.number().optional(),
      penaltyNgn: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const rows = await q(
        `INSERT INTO qos_violations (violation_ref,operator_id,violation_type,severity,measured_value,threshold_value,measurement_unit,affected_region,affected_subscribers,penalty_ngn,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [input.violationRef, input.operatorId, input.violationType, input.severity,
         input.measuredValue ?? null, input.thresholdValue ?? null, input.measurementUnit ?? null,
         input.affectedRegion ?? null, input.affectedSubscribers ?? null, input.penaltyNgn ?? null, input.notes ?? null]
      );
      emitMutationEvent(EVENTS.TELECOM_MONITORING, { action: "telecom_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  resolveQosViolation: adminProcedure
    .input(z.object({ id: z.number(), resolution: z.string().optional() }))
    .mutation(async ({ input }) => {
      const rows = await q(
        `UPDATE qos_violations SET status='resolved', resolved_at=NOW(), notes=COALESCE($2,notes), updated_at=NOW() WHERE id=$1 RETURNING *`,
        [input.id, input.resolution ?? null]
      );
      emitMutationEvent(EVENTS.TELECOM_MONITORING, { action: "telecom_event", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  // ── Interconnect Disputes ─────────────────────────────────────────────────
  listInterconnectDisputes: protectedProcedure
    .input(z.object({ status: z.string().optional(), page: z.number().default(1) }).optional())
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT d.*, c.operator_name as complainant_name, r.operator_name as respondent_name
         FROM interconnect_disputes d
         LEFT JOIN telecom_operators c ON d.complainant_operator_id = c.id
         LEFT JOIN telecom_operators r ON d.respondent_operator_id = r.id
         WHERE ($1::text IS NULL OR d.status::text = $1)
         ORDER BY d.filed_at DESC LIMIT 50`,
        [input?.status ?? null]
      );
      return rows;
    }),

  // ── Lawful Intercept ──────────────────────────────────────────────────────
  listLawfulIntercepts: protectedProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT li.*, o.operator_name FROM lawful_intercept_requests li
         LEFT JOIN telecom_operators o ON li.operator_id = o.id
         WHERE ($1::text IS NULL OR li.status = $1)
         ORDER BY li.requested_at DESC LIMIT 50`,
        [input?.status ?? null]
      );
      return rows;
    }),

  // ── Stats ─────────────────────────────────────────────────────────────────
  getStats: protectedProcedure.query(async () => {
    const rows = await q(`
      SELECT
        (SELECT COUNT(*) FROM telecom_operators WHERE is_active=true) as active_operators,
        (SELECT COUNT(*) FROM spectrum_licences WHERE status='active') as active_licences,
        (SELECT COUNT(*) FROM qos_violations WHERE status='open') as open_violations,
        (SELECT COUNT(*) FROM interconnect_disputes WHERE status NOT IN ('resolved')) as active_disputes,
        (SELECT COUNT(*) FROM lawful_intercept_requests WHERE status='pending') as pending_intercepts,
        (SELECT COALESCE(SUM(penalty_ngn),0) FROM qos_violations WHERE status='open') as total_penalties_open,
        (SELECT COUNT(*) FROM spectrum_licences WHERE data_localisation_compliant=true) as compliant_licences,
        (SELECT COUNT(*) FROM spectrum_licences WHERE lawful_intercept_enabled=true) as li_enabled_licences
    `);
    return rows[0];
  }),

  /** NCC compliance scoring for telecom operators — incorporates QoS thresholds, data localisation, and lawful intercept readiness */
  calculateOperatorCompliance: protectedProcedure
    .input(z.object({ operatorId: z.number() }))
    .query(async ({ input }) => {
      const oRows = await q(`SELECT * FROM telecom_operators WHERE id = $1`, [input.operatorId]);
      const op = oRows[0];
      if (!op) return { score: 0, grade: "F", breakdown: {} };
      const openViolations = await q(`SELECT COUNT(*) as cnt FROM qos_violations WHERE operator_id = $1 AND status = 'open'`, [input.operatorId]);
      const violationCount = parseInt(openViolations[0]?.cnt ?? '0');
      const criticalViolations = await q(`SELECT COUNT(*) as cnt FROM qos_violations WHERE operator_id = $1 AND status = 'open' AND severity IN ('critical', 'high')`, [input.operatorId]);
      const criticalCount = parseInt(criticalViolations[0]?.cnt ?? '0');
      const licences = await q(`SELECT COUNT(*) as total, SUM(CASE WHEN data_localisation_compliant THEN 1 ELSE 0 END) as compliant, SUM(CASE WHEN lawful_intercept_enabled THEN 1 ELSE 0 END) as li_enabled FROM spectrum_licences WHERE operator_id = $1`, [input.operatorId]);
      const totalLicences = parseInt(licences[0]?.total ?? '0');
      const compliantLicences = parseInt(licences[0]?.compliant ?? '0');
      const liEnabled = parseInt(licences[0]?.li_enabled ?? '0');
      const breakdown: Record<string, number> = {
        dataLocalisation: op.data_localisation_compliant ? 20 : 0,
        ndpcRegistered: op.ndpc_registered ? 10 : 0,
        licenceCompliance: totalLicences > 0 ? Math.round((compliantLicences / totalLicences) * 15) : 0,
        lawfulIntercept: totalLicences > 0 ? Math.round((liEnabled / totalLicences) * 15) : 0,
        qosPerformance: Math.max(0, 20 - violationCount * 3),
        criticalIncidentPenalty: Math.max(0, 20 - criticalCount * 7),
      };
      const score = Math.min(100, Object.values(breakdown).reduce((s, v) => s + v, 0));
      const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
      return { score, grade, breakdown, operatorName: op.operator_name };
    }),

  /** NCC QoS threshold enforcement — auto-escalate violations exceeding penalty thresholds */
  escalateQosViolations: adminProcedure
    .input(z.object({ operatorId: z.number().optional(), penaltyThresholdNgn: z.number().default(50_000_000) }))
    .mutation(async ({ input }) => {
      const rows = await q(
        `UPDATE qos_violations SET severity = 'critical', notes = COALESCE(notes, '') || ' [AUTO-ESCALATED: NCC penalty threshold exceeded]', updated_at = NOW()
         WHERE status = 'open' AND severity NOT IN ('critical')
         AND penalty_ngn >= $1
         ${input.operatorId ? 'AND operator_id = $2' : ''}
         RETURNING id, violation_ref, operator_id, penalty_ngn`,
        input.operatorId ? [input.penaltyThresholdNgn, input.operatorId] : [input.penaltyThresholdNgn]
      );
      emitMutationEvent(EVENTS.TELECOM_QOS_VIOLATION, { action: "qos_escalation", ts: new Date().toISOString(), count: rows.length }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { escalated: rows.length, violations: rows };
    }),

  /** NCC spectrum renewal check — flag licences expiring within N days */
  expiringLicences: protectedProcedure
    .input(z.object({ daysAhead: z.number().default(90) }))
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT s.*, o.operator_name FROM spectrum_licences s
         LEFT JOIN telecom_operators o ON s.operator_id = o.id
         WHERE s.status = 'active' AND s.expires_at IS NOT NULL
         AND s.expires_at <= NOW() + make_interval(days => $1)
         ORDER BY s.expires_at ASC`,
        [input.daysAhead]
      );
      return rows;
    }),
});
