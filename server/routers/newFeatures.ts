import { z } from "zod";
import { router, protectedProcedure, publicProcedure, deleteProcedure } from "../_core/trpc";
import { getDb, getSharedPool } from "../db";
import { sql } from "drizzle-orm";
import { emitEvent, logAuditEvent, broadcastEvent, cacheGetJson, cacheSetJson, cacheDel, triggerWorkflow } from "../middlewareHelpers";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { syncBreachIncident } from "../permifySync";
import { autoDecryptRows } from "../encryptionMiddleware";
import { startWorkflow } from "../temporal";
import { logger } from "../logger";

async function exec(query: any): Promise<[any[], any]> {
  const db = await getDb();
  if (!db) return [[] as any[], null] as [any[], any];
  const result = await db.execute(query);
  const [rows, meta] = result as unknown as [any[], any];
  return [autoDecryptRows(String(query), rows ?? []), meta] as [any[], any];
}

async function execRaw(rawSql: string, params?: any[]): Promise<[any[], any]> {
  const db = await getDb();
  if (!db) return [[] as any[], null] as [any[], any];
  if (params && params.length > 0) {
    const pool = (db as any).$client ?? (db as any).client;
    if (pool && typeof pool.query === 'function') {
      const res = await pool.query(rawSql, params);
      return [autoDecryptRows(rawSql, res.rows ?? []), res] as [any[], any];
    }
  }
  const result = await db.execute(sql.raw(rawSql));
  const [rows, meta] = result as unknown as [any[], any];
  return [autoDecryptRows(rawSql, rows ?? []), meta] as [any[], any];
}

// ─── NDPA Compliance Dashboard ───────────────────────────────────────────────
export const ndpaComplianceDashboardRouter = router({
  overview: protectedProcedure.query(async () => {
    const [snapshots] = await exec(sql`SELECT * FROM ndpa_compliance_snapshots WHERE organization_id IS NULL ORDER BY snapshot_date DESC LIMIT 6`);
    const [breachCount] = await exec(sql`SELECT COUNT(*) as total, SUM(CASE WHEN breach_incident_status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) as active, SUM(CASE WHEN ndpc_notified_at IS NULL AND ndpc_notification_deadline < NOW() THEN 1 ELSE 0 END) as overdue FROM breach_incidents`);
    const [consentCount] = await exec(sql`SELECT COUNT(*) as total, SUM(CASE WHEN consent_status = 'active' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN consent_status = 'withdrawn' THEN 1 ELSE 0 END) as withdrawn FROM consent_records`);
    const [dpoCount] = await exec(sql`SELECT COUNT(*) as total, SUM(CASE WHEN is_active = true AND credential_status = 'verified' THEN 1 ELSE 0 END) as verified, SUM(CASE WHEN certification_expires_at < NOW() + INTERVAL '30 days' THEN 1 ELSE 0 END) as expiring_soon FROM dpo_appointments`);
    const [dsarCount] = await exec(sql`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending FROM citizen_requests WHERE request_type = 'dsar'`);
    return {
      snapshots: (snapshots as any[]),
      breaches: (breachCount as any[])[0] ?? {},
      consents: (consentCount as any[])[0] ?? {},
      dpos: (dpoCount as any[])[0] ?? {},
      dsars: (dsarCount as any[])[0] ?? {},
    };
  }),
  article40Status: protectedProcedure.query(async () => {
    const [rows] = await exec(sql`
      SELECT b.*, o.name as org_name,
        EXTRACT(EPOCH FROM (b.ndpc_notification_deadline - NOW())) / 3600 as hours_remaining,
        CASE WHEN b.ndpc_notified_at IS NOT NULL THEN 'notified'
             WHEN b.ndpc_notification_deadline < NOW() THEN 'overdue'
             WHEN EXTRACT(EPOCH FROM (b.ndpc_notification_deadline - NOW())) / 3600 < 12 THEN 'critical'
             WHEN EXTRACT(EPOCH FROM (b.ndpc_notification_deadline - NOW())) / 3600 < 24 THEN 'warning'
             ELSE 'on_track' END as sla_status
      FROM breach_incidents b
      LEFT JOIN organizations o ON b.organization_id = o.id
      WHERE b.breach_incident_status NOT IN ('resolved', 'closed')
      ORDER BY b.ndpc_notification_deadline ASC LIMIT 50
    `);
    return rows as any[];
  }),
});

// ─── Breach Incident Center ───────────────────────────────────────────────────
export const breachIncidentRouter = router({
  list: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20), status: z.string().optional(), severity: z.string().optional(), orgId: z.number().int().optional() }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.status) { params.push(input.status); conds.push(`b.breach_incident_status = $${params.length}`); }
      if (input.severity) { params.push(input.severity); conds.push(`b.breach_incident_severity = $${params.length}`); }
      if (input.orgId) { params.push(input.orgId); conds.push(`b.organization_id = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const rows = await execRaw(`SELECT b.*, o.name as org_name, EXTRACT(EPOCH FROM (b.ndpc_notification_deadline - NOW())) / 3600 as hours_remaining FROM breach_incidents b LEFT JOIN organizations o ON b.organization_id = o.id ${where} ORDER BY b.detected_at DESC LIMIT ${input.limit} OFFSET ${offset}`, params);
      const cnt = await execRaw(`SELECT COUNT(*) as total FROM breach_incidents b ${where}`, params);
      return { data: rows as any[], total: parseInt((cnt as any[])[0]?.total ?? '0') };
    }),
  get: protectedProcedure.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const [rows] = await exec(sql`SELECT b.*, o.name as org_name FROM breach_incidents b LEFT JOIN organizations o ON b.organization_id = o.id WHERE b.id = ${input.id}`);
    return (rows as any[])[0] ?? null;
  }),
  create: protectedProcedure
    .input(z.object({ organizationId: z.number().int(), title: z.string().min(1), description: z.string().optional(), severity: z.enum(['low','medium','high','critical']).default('medium'), affectedIndividualsCount: z.number().int().default(0), dataTypesAffected: z.array(z.string()).default([]), breachCause: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const deadline = new Date(Date.now() + 72 * 60 * 60 * 1000);
      const [result] = await exec(sql`INSERT INTO breach_incidents (organization_id, title, description, breach_incident_severity, detected_at, ndpc_notification_deadline, affected_individuals_count, data_types_affected, breach_cause, reported_by) VALUES (${input.organizationId}, ${input.title}, ${input.description ?? null}, ${input.severity}, NOW(), ${deadline.toISOString()}, ${input.affectedIndividualsCount}, ${JSON.stringify(input.dataTypesAffected)}, ${input.breachCause ?? null}, ${ctx.user.id}) RETURNING *`);
      const created = (result as any[])[0];
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "breach_reported", entityId: created?.id, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      syncBreachIncident(String(created?.id ?? ""), String(ctx.user.id), input.organizationId).catch(() => {});
      // Trigger Temporal breach-response workflow (72-hour SLA)
      startWorkflow("breach-response", {
        workflowId: `breach-${created?.id ?? 0}`,
        taskQueue: "ndsep-breach",
        input: { breachId: String(created?.id ?? 0), orgId: input.organizationId, severity: input.severity, title: input.title, affectedCount: input.affectedIndividualsCount, steps: ["containment", "assessment", "ndpc-notification", "individual-notification", "remediation", "post-mortem"] },
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "temporal fire-and-forget"));
      return created;
    }),
  updateStatus: protectedProcedure
    .input(z.object({ id: z.number().int(), status: z.enum(['detected','assessing','ndpc_notified','individuals_notified','contained','resolved','closed']), ndpcReferenceNumber: z.string().optional(), remediationActions: z.string().optional() }))
    .mutation(async ({ input }) => {
      // Fully parameterized — no string interpolation of user input
      const params: unknown[] = [input.status];
      const sets: string[] = [`breach_incident_status = $1`, `updated_at = NOW()`];
      if (input.status === 'ndpc_notified') sets.push(`ndpc_notified_at = NOW()`);
      if (input.status === 'individuals_notified') sets.push(`individuals_notified_at = NOW()`);
      if (input.status === 'contained') sets.push(`contained_at = NOW()`);
      if (input.status === 'resolved') sets.push(`resolved_at = NOW()`);
      if (input.ndpcReferenceNumber) { params.push(input.ndpcReferenceNumber); sets.push(`ndpc_reference_number = $${params.length}`); }
      if (input.remediationActions) { params.push(input.remediationActions); sets.push(`remediation_actions = $${params.length}`); }
      params.push(input.id);
      await execRaw(`UPDATE breach_incidents SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),
  stats: protectedProcedure.query(async () => {
    const [rows] = await exec(sql`SELECT COUNT(*) as total, SUM(CASE WHEN breach_incident_status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) as active, SUM(CASE WHEN breach_incident_severity = 'critical' THEN 1 ELSE 0 END) as critical, SUM(CASE WHEN ndpc_notified_at IS NULL AND ndpc_notification_deadline < NOW() THEN 1 ELSE 0 END) as overdue_notifications, SUM(CASE WHEN ndpc_notified_at IS NOT NULL THEN 1 ELSE 0 END) as notified FROM breach_incidents`);
    return (rows as any[])[0] ?? {};
  }),
});

// ─── Consent Record Manager ───────────────────────────────────────────────────
export const consentRecordRouter = router({
  list: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20), status: z.string().optional(), orgId: z.number().int().optional(), search: z.string().optional() }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.status) { params.push(input.status); conds.push(`c.consent_status = $${params.length}`); }
      if (input.orgId) { params.push(input.orgId); conds.push(`c.organization_id = $${params.length}`); }
      if (input.search) { params.push(`%${input.search}%`); conds.push(`(c.data_subject_name ILIKE $${params.length} OR c.data_subject_email ILIKE $${params.length})`); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const rows = await execRaw(`SELECT c.*, o.name as org_name FROM consent_records c LEFT JOIN organizations o ON c.organization_id = o.id ${where} ORDER BY c.consent_given_at DESC LIMIT ${input.limit} OFFSET ${offset}`, params);
      const cnt = await execRaw(`SELECT COUNT(*) as total FROM consent_records c ${where}`, params);
      return { data: rows as any[], total: parseInt((cnt as any[])[0]?.total ?? '0') };
    }),
  create: protectedProcedure
    .input(z.object({ organizationId: z.number().int(), dataSubjectName: z.string().min(1), dataSubjectEmail: z.string().email(), dataSubjectNin: z.string().optional(), purpose: z.string().min(1), lawfulBasis: z.enum(['consent','contract','legal_obligation','vital_interests','public_task','legitimate_interests']), dataCategories: z.array(z.string()).default([]), processingActivities: z.array(z.string()).default([]), thirdPartySharing: z.boolean().default(false), crossBorderTransfer: z.boolean().default(false), expiresAt: z.string().optional() }))
    .mutation(async ({ input }) => {
      const [result] = await exec(sql`INSERT INTO consent_records (organization_id, data_subject_name, data_subject_email, data_subject_nin, purpose, lawful_basis, consent_status, data_categories, processing_activities, third_party_sharing, cross_border_transfer, expires_at) VALUES (${input.organizationId}, ${input.dataSubjectName}, ${input.dataSubjectEmail}, ${input.dataSubjectNin ?? null}, ${input.purpose}, ${input.lawfulBasis}, 'active', ${JSON.stringify(input.dataCategories)}, ${JSON.stringify(input.processingActivities)}, ${input.thirdPartySharing}, ${input.crossBorderTransfer}, ${input.expiresAt ?? null}) RETURNING *`);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return (result as any[])[0];
    }),
  withdraw: protectedProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    await exec(sql`UPDATE consent_records SET consent_status = 'withdrawn', consent_withdrawn_at = NOW(), updated_at = NOW() WHERE id = ${input.id}`);
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return { success: true };
  }),
  stats: protectedProcedure.query(async () => {
    const [rows] = await exec(sql`SELECT COUNT(*) as total, SUM(CASE WHEN consent_status = 'active' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN consent_status = 'withdrawn' THEN 1 ELSE 0 END) as withdrawn, SUM(CASE WHEN consent_status = 'expired' THEN 1 ELSE 0 END) as expired, SUM(CASE WHEN expires_at < NOW() + INTERVAL '30 days' AND expires_at > NOW() THEN 1 ELSE 0 END) as expiring_soon, SUM(CASE WHEN third_party_sharing = true THEN 1 ELSE 0 END) as with_third_party, SUM(CASE WHEN cross_border_transfer = true THEN 1 ELSE 0 END) as cross_border FROM consent_records`);
    return (rows as any[])[0] ?? {};
  }),
});

// ─── DPO Appointment Registry ─────────────────────────────────────────────────
export const dpoAppointmentRouter = router({
  list: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20), status: z.string().optional(), isActive: z.boolean().optional() }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.status) { params.push(input.status); conds.push(`d.credential_status = $${params.length}`); }
      if (input.isActive !== undefined) { params.push(input.isActive); conds.push(`d.is_active = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const rows = await execRaw(`SELECT d.*, o.name as org_name, o.sector as org_sector FROM dpo_appointments d LEFT JOIN organizations o ON d.organization_id = o.id ${where} ORDER BY d.appointed_at DESC LIMIT ${input.limit} OFFSET ${offset}`, params);
      const cnt = await execRaw(`SELECT COUNT(*) as total FROM dpo_appointments d ${where}`, params);
      return { data: rows as any[], total: parseInt((cnt as any[])[0]?.total ?? '0') };
    }),
  create: protectedProcedure
    .input(z.object({ organizationId: z.number().int(), dpoName: z.string().min(1), dpoEmail: z.string().email(), dpoPhone: z.string().optional(), dpcoId: z.string().optional(), dpcoName: z.string().optional(), certificationExpiresAt: z.string().optional(), trainingHoursCompleted: z.number().int().default(0), notes: z.string().optional() }))
    .mutation(async ({ input }) => {
      const [result] = await exec(sql`INSERT INTO dpo_appointments (organization_id, dpo_name, dpo_email, dpo_phone, dpco_id, dpco_name, certification_expires_at, training_hours_completed, notes) VALUES (${input.organizationId}, ${input.dpoName}, ${input.dpoEmail}, ${input.dpoPhone ?? null}, ${input.dpcoId ?? null}, ${input.dpcoName ?? null}, ${input.certificationExpiresAt ?? null}, ${input.trainingHoursCompleted}, ${input.notes ?? null}) RETURNING *`);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return (result as any[])[0];
    }),
  verify: protectedProcedure.input(z.object({ id: z.number().int(), independenceVerified: z.boolean() })).mutation(async ({ input }) => {
    await exec(sql`UPDATE dpo_appointments SET credential_status = 'verified', independence_verified = ${input.independenceVerified}, updated_at = NOW() WHERE id = ${input.id}`);
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return { success: true };
  }),
  stats: protectedProcedure.query(async () => {
    const [rows] = await exec(sql`SELECT COUNT(*) as total, SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active, SUM(CASE WHEN credential_status = 'verified' THEN 1 ELSE 0 END) as verified, SUM(CASE WHEN credential_status = 'expired' THEN 1 ELSE 0 END) as expired, SUM(CASE WHEN certification_expires_at < NOW() + INTERVAL '30 days' AND certification_expires_at > NOW() THEN 1 ELSE 0 END) as expiring_soon, SUM(CASE WHEN independence_verified = true THEN 1 ELSE 0 END) as independence_verified FROM dpo_appointments`);
    return (rows as any[])[0] ?? {};
  }),
});

// ─── Public Compliance Registry ───────────────────────────────────────────────
export const publicRegistryRouter = router({
  search: publicProcedure
    .input(z.object({ query: z.string().optional(), sector: z.string().optional(), page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      const conds: string[] = [];
      // Use parameterized queries to prevent SQL injection
      if (input.query) {
        params.push(`%${input.query}%`);
        conds.push(`(o.name ILIKE $${params.length} OR o.rc_number ILIKE $${params.length})`);
      }
      if (input.sector) {
        params.push(input.sector);
        conds.push(`o.sector = $${params.length}`);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      params.push(input.limit);
      params.push(offset);
      const [rows] = await execRaw(
        `SELECT o.id, o.name, o.sector, o.rc_number, o.state, o.country, o.compliance_score, o.ndpc_registration_status, o.ndpc_registration_date, o.last_audit_date, o.dpco_assigned FROM organizations o ${where} ORDER BY o.compliance_score DESC NULLS LAST, o.name ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const countParams = params.slice(0, params.length - 2);
      const [cnt] = await execRaw(`SELECT COUNT(*) as total FROM organizations o ${where}`, countParams);
      return { data: rows as any[], total: parseInt((cnt as any[])[0]?.total ?? '0') };
    }),
  orgDetail: publicProcedure.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const [rows] = await exec(sql`SELECT o.*, (SELECT COUNT(*) FROM financial_penalties fp WHERE fp.organization_id = o.id) as total_penalties, (SELECT COUNT(*) FROM breach_incidents bi WHERE bi.organization_id = o.id) as total_breaches FROM organizations o WHERE o.id = ${input.id}`);
    return (rows as any[])[0] ?? null;
  }),
  sectorStats: publicProcedure.query(async () => {
    const pool = getSharedPool();
    const result = await pool.query(`SELECT sector, COUNT(*) as org_count, AVG(compliance_score) as avg_score FROM organizations GROUP BY sector ORDER BY avg_score DESC NULLS LAST`);
    return result.rows as any[];
  }),
});

// ─── Penalty Calculator ───────────────────────────────────────────────────────
export const penaltyCalculatorRouter = router({
  calculate: protectedProcedure
    .input(z.object({ violationType: z.string(), sector: z.string(), severity: z.enum(['low','medium','high','critical']), organizationRevenue: z.number().optional(), affectedIndividuals: z.number().int().default(0), isRepeatOffender: z.boolean().default(false), hasCooperated: z.boolean().default(true), mitigatingFactors: z.array(z.string()).default([]), aggravatingFactors: z.array(z.string()).default([]) }))
    .mutation(async ({ input }) => {
      const basePenalties: Record<string, number> = { low: 2000000, medium: 10000000, high: 50000000, critical: 100000000 };
      let basePenalty = basePenalties[input.severity];
      let multiplier = 1.0;
      const revenueCap = input.organizationRevenue ? input.organizationRevenue * 0.02 : null;
      if (input.isRepeatOffender) multiplier += 0.5;
      if (!input.hasCooperated) multiplier += 0.3;
      if (input.affectedIndividuals > 10000) multiplier += 0.5;
      else if (input.affectedIndividuals > 1000) multiplier += 0.25;
      multiplier -= input.mitigatingFactors.length * 0.1;
      multiplier = Math.max(0.5, multiplier);
      const calculatedPenalty = Math.round(basePenalty * multiplier);
      const finalPenalty = revenueCap ? Math.min(calculatedPenalty, revenueCap) : calculatedPenalty;
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { basePenalty, multiplier, calculatedPenalty, revenueCap, finalPenalty, regulatoryBasis: 'NDPA 2023 Section 48 - Administrative Fines', appealPeriod: '30 days from penalty notice' };
    }),
  history: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(50).default(20) })).query(async ({ input }) => {
    const [rows] = await execRaw(`SELECT fp.*, o.name as org_name, o.sector FROM financial_penalties fp LEFT JOIN organizations o ON fp.organization_id = o.id ORDER BY fp.created_at DESC LIMIT $1`, [input.limit]);
    return rows as any[];
  }),
});

// ─── Risk Scorecard ───────────────────────────────────────────────────────────
export const riskScorecardRouter = router({
  orgScorecard: protectedProcedure.input(z.object({ orgId: z.number().int() })).query(async ({ input }) => {
    const [org] = await exec(sql`SELECT * FROM organizations WHERE id = ${input.orgId}`);
    const [violations] = await exec(sql`SELECT severity, COUNT(*) as count FROM compliance_violations WHERE organization_id = ${input.orgId} AND status = 'open' GROUP BY severity`);
    const [penalties] = await exec(sql`SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM financial_penalties WHERE organization_id = ${input.orgId}`);
    const [breaches] = await exec(sql`SELECT COUNT(*) as count FROM breach_incidents WHERE organization_id = ${input.orgId}`);
    const orgData = (org as any[])[0];
    const violationData = violations as any[];
    const penaltyData = (penalties as any[])[0];
    const breachData = (breaches as any[])[0];
    let riskScore = 100;
    const criticalViolations = violationData.find((v: any) => v.severity === 'critical')?.count ?? 0;
    const highViolations = violationData.find((v: any) => v.severity === 'high')?.count ?? 0;
    riskScore -= criticalViolations * 15;
    riskScore -= highViolations * 8;
    riskScore -= Math.min(parseInt(penaltyData?.count ?? '0') * 5, 25);
    riskScore -= Math.min(parseInt(breachData?.count ?? '0') * 10, 30);
    riskScore = Math.max(0, Math.min(100, riskScore));
    return { organization: orgData, riskScore, riskLevel: riskScore >= 80 ? 'low' : riskScore >= 60 ? 'medium' : riskScore >= 40 ? 'high' : 'critical', violations: violationData, penalties: penaltyData, breaches: breachData, complianceScore: orgData?.compliance_score ?? 0, dimensions: { dataProtection: Math.min(100, riskScore + 5), securityPosture: Math.min(100, riskScore - 3), regulatoryCompliance: orgData?.compliance_score ?? riskScore, incidentHistory: Math.max(0, 100 - parseInt(breachData?.count ?? '0') * 20), penaltyHistory: Math.max(0, 100 - parseInt(penaltyData?.count ?? '0') * 10) } };
  }),
  leaderboard: protectedProcedure.input(z.object({ sector: z.string().optional(), limit: z.number().int().default(20) })).query(async ({ input }) => {
    const sectorParam: unknown[] = input.sector ? [input.sector] : [];
    const where = input.sector ? `WHERE o.sector = $1` : '';
    const [rows] = await execRaw(`SELECT o.id, o.name, o.sector, o.compliance_score, COUNT(DISTINCT cv.id) as open_violations, COUNT(DISTINCT fp.id) as penalties, COUNT(DISTINCT bi.id) as breaches FROM organizations o LEFT JOIN compliance_violations cv ON cv.organization_id = o.id AND cv.status = 'open' LEFT JOIN financial_penalties fp ON fp.organization_id = o.id LEFT JOIN breach_incidents bi ON bi.organization_id = o.id ${where} GROUP BY o.id, o.name, o.sector, o.compliance_score ORDER BY o.compliance_score DESC NULLS LAST LIMIT ${input.limit}`);
    return rows as any[];
  }),
});

// ─── Enforcement Timeline ─────────────────────────────────────────────────────
export const enforcementTimelineRouter = router({
  timeline: protectedProcedure
    .input(z.object({ orgId: z.number().int().optional(), days: z.number().int().min(7).max(365).default(90), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const orgFilter = input.orgId ? `AND ea.organization_id = ${input.orgId}` : '';
      const enfDays = Math.max(1, Math.min(365, Math.floor(input.days)));
      const enfParams: unknown[] = [enfDays.toString()];
      const enfOrgFilter = input.orgId ? `AND ea.organization_id = $${enfParams.push(input.orgId)}` : '';
      enfParams.push(input.limit);
      const [rows] = await execRaw(`SELECT ea.*, o.name as org_name, o.sector, cv.title as violation_type, cv.severity as violation_severity FROM enforcement_actions ea LEFT JOIN organizations o ON ea.organization_id = o.id LEFT JOIN compliance_violations cv ON ea.violation_id = cv.id WHERE ea.created_at >= NOW() - ($1 || ' days')::interval ${enfOrgFilter} ORDER BY ea.created_at DESC LIMIT $${enfParams.length}`, enfParams);
      return rows as any[];
    }),
  milestones: protectedProcedure.input(z.object({ caseId: z.number().int() })).query(async ({ input }) => {
    const [rows] = await exec(sql`SELECT ct.*, u.name as performed_by_name FROM case_timeline ct LEFT JOIN users u ON ct.performed_by = u.id WHERE ct.case_id = ${input.caseId} ORDER BY ct.created_at ASC`);
    return rows as any[];
  }),
});

// ─── Compliance Calendar ──────────────────────────────────────────────────────
export const complianceCalendarRouter = router({
  events: protectedProcedure
    .input(z.object({ startDate: z.string(), endDate: z.string(), orgId: z.number().int().optional(), sector: z.string().optional() }))
    .query(async ({ input }) => {
      // Parameterized to prevent SQL injection
      const breachParams: unknown[] = [input.startDate, input.endDate];
      const orgFilter = input.orgId ? `AND b.organization_id = $${breachParams.push(input.orgId)}` : '';
      const [breaches] = await execRaw(`SELECT b.id, b.title, b.ndpc_notification_deadline as event_date, b.breach_incident_status as status, o.name as org_name, 'breach_deadline' as event_type, 'critical' as priority FROM breach_incidents b LEFT JOIN organizations o ON b.organization_id = o.id WHERE b.ndpc_notification_deadline BETWEEN $1 AND $2 ${orgFilter} AND b.breach_incident_status NOT IN ('resolved','closed')`, breachParams);
      const [dpos] = await execRaw(`SELECT d.id, d.dpo_name as title, d.certification_expires_at as event_date, d.credential_status as status, o.name as org_name, 'dpo_expiry' as event_type, 'warning' as priority FROM dpo_appointments d LEFT JOIN organizations o ON d.organization_id = o.id WHERE d.certification_expires_at BETWEEN $1 AND $2`, [input.startDate, input.endDate]);
      const events = [...(breaches as any[]), ...(dpos as any[])];
      return events.sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
    }),
  upcomingDeadlines: protectedProcedure.input(z.object({ days: z.number().int().default(30) })).query(async ({ input }) => {
    const daysInt = Math.max(1, Math.min(365, Math.floor(input.days)));
    const [rows] = await execRaw(`SELECT 'breach_deadline' as type, b.id, b.title, b.ndpc_notification_deadline as deadline, o.name as org_name, 'critical' as priority FROM breach_incidents b LEFT JOIN organizations o ON b.organization_id = o.id WHERE b.ndpc_notification_deadline BETWEEN NOW() AND NOW() + ($1 || ' days')::interval AND b.breach_incident_status NOT IN ('resolved','closed') UNION ALL SELECT 'dpo_expiry' as type, d.id, d.dpo_name as title, d.certification_expires_at as deadline, o.name as org_name, 'warning' as priority FROM dpo_appointments d LEFT JOIN organizations o ON d.organization_id = o.id WHERE d.certification_expires_at BETWEEN NOW() AND NOW() + ($1 || ' days')::interval UNION ALL SELECT 'custom_event' as type, e.id, e.title, e.event_date as deadline, COALESCE(o.name, e.sector) as org_name, e.priority FROM compliance_calendar_events e LEFT JOIN organizations o ON e.organization_id = o.id WHERE e.event_date BETWEEN NOW() AND NOW() + ($1 || ' days')::interval AND e.status NOT IN ('completed','cancelled') ORDER BY deadline ASC LIMIT 100`, [daysInt.toString()]);
    return rows as any[];
  }),
  listCustom: protectedProcedure
    .input(z.object({ page: z.number().int().default(1), limit: z.number().int().default(20), sector: z.string().optional(), priority: z.string().optional(), status: z.string().optional(), search: z.string().optional() }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      let where = 'WHERE 1=1';
      if (input.sector) { params.push(input.sector); where += ` AND (e.sector = $${params.length} OR e.sector = 'all')`; }
      if (input.priority) { params.push(input.priority); where += ` AND e.priority = $${params.length}`; }
      if (input.status) { params.push(input.status); where += ` AND e.status = $${params.length}`; }
      if (input.search) { params.push(`%${input.search}%`); where += ` AND (e.title ILIKE $${params.length} OR e.description ILIKE $${params.length})`; }
      const cntParams = [...params];
      const [cnt] = await execRaw(`SELECT COUNT(*) as total FROM compliance_calendar_events e ${where}`, cntParams);
      params.push(input.limit, offset);
      const [rows] = await execRaw(`SELECT e.*, o.name as org_name FROM compliance_calendar_events e LEFT JOIN organizations o ON e.organization_id = o.id ${where} ORDER BY e.event_date ASC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
      return { data: rows as any[], total: parseInt((cnt as any[])[0]?.total ?? '0'), page: input.page, limit: input.limit };
    }),
  createEvent: protectedProcedure
    .input(z.object({ title: z.string().min(1), description: z.string().optional(), eventType: z.string().default('deadline'), priority: z.enum(['critical','warning','info']).default('info'), eventDate: z.string(), endDate: z.string().optional(), organizationId: z.number().int().optional(), sector: z.string().optional(), assignedTo: z.string().optional(), status: z.string().default('upcoming'), recurrence: z.string().optional(), reminderDays: z.number().int().default(7), notes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const [result] = await exec(sql`INSERT INTO compliance_calendar_events (title, description, event_type, priority, event_date, end_date, organization_id, sector, assigned_to, status, recurrence, reminder_days, notes, created_by) VALUES (${input.title}, ${input.description ?? null}, ${input.eventType}, ${input.priority}, ${input.eventDate}::timestamptz, ${input.endDate ?? null}, ${input.organizationId ?? null}, ${input.sector ?? null}, ${input.assignedTo ?? null}, ${input.status}, ${input.recurrence ?? null}, ${input.reminderDays}, ${input.notes ?? null}, ${ctx.user.id}) RETURNING *`);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return (result as any[])[0];
    }),
  updateEvent: protectedProcedure
    .input(z.object({ id: z.number().int(), title: z.string().optional(), description: z.string().optional(), priority: z.enum(['critical','warning','info']).optional(), eventDate: z.string().optional(), status: z.string().optional(), assignedTo: z.string().optional(), notes: z.string().optional() }))
    .mutation(async ({ input }) => {
      const { id, ...fields } = input;
      const sets: string[] = [];
      const params: unknown[] = [];
      if (fields.title !== undefined) { params.push(fields.title); sets.push(`title = $${params.length}`); }
      if (fields.description !== undefined) { params.push(fields.description); sets.push(`description = $${params.length}`); }
      if (fields.priority !== undefined) { params.push(fields.priority); sets.push(`priority = $${params.length}`); }
      if (fields.eventDate !== undefined) { params.push(fields.eventDate); sets.push(`event_date = $${params.length}::timestamptz`); }
      if (fields.status !== undefined) { params.push(fields.status); sets.push(`status = $${params.length}`); }
      if (fields.assignedTo !== undefined) { params.push(fields.assignedTo); sets.push(`assigned_to = $${params.length}`); }
      if (fields.notes !== undefined) { params.push(fields.notes); sets.push(`notes = $${params.length}`); }
      if (sets.length === 0) return { success: false };
      sets.push(`updated_at = NOW()`);
      params.push(id);
      const [result] = await execRaw(`UPDATE compliance_calendar_events SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return (result as any[])[0];
    }),
  deleteEvent: deleteProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await exec(sql`DELETE FROM compliance_calendar_events WHERE id = ${input.id}`);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),
});

// ─── Notification Center ──────────────────────────────────────────────────────
export const notificationCenterRouter = router({
  list: protectedProcedure
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20), unreadOnly: z.boolean().default(false), category: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      const conds = [`(n.user_id = ${ctx.user.id} OR n.user_id IS NULL)`];
      if (input.unreadOnly) conds.push('n.is_read = false');
      if (input.category) { params.push(input.category); conds.push(`n.category = $${params.length}`); }
      const where = `WHERE ${conds.join(' AND ')}`;
      const rows = await execRaw(`SELECT n.* FROM in_app_notifications n ${where} ORDER BY n.created_at DESC LIMIT ${input.limit} OFFSET ${offset}`, params);
      const cnt = await execRaw(`SELECT COUNT(*) as total FROM in_app_notifications n ${where}`, params);
      const unread = await execRaw(`SELECT COUNT(*) as count FROM in_app_notifications n WHERE (n.user_id = ${ctx.user.id} OR n.user_id IS NULL) AND n.is_read = false`);
      return { data: rows as any[], total: parseInt((cnt as any[])[0]?.total ?? '0'), unreadCount: parseInt((unread as any[])[0]?.count ?? '0') };
    }),
  markRead: protectedProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input }) => {
    await exec(sql`UPDATE in_app_notifications SET is_read = true WHERE id = ${input.id}`);
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return { success: true };
  }),
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await exec(sql`UPDATE in_app_notifications SET is_read = true WHERE user_id = ${ctx.user.id} OR user_id IS NULL`);
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return { success: true };
  }),
  create: protectedProcedure
    .input(z.object({ title: z.string().min(1), message: z.string().min(1), severity: z.enum(['info','warning','error','success']).default('info'), category: z.string().default('system'), organizationId: z.number().int().optional(), userId: z.number().int().optional(), actionUrl: z.string().optional() }))
    .mutation(async ({ input }) => {
      const [result] = await exec(sql`INSERT INTO in_app_notifications (title, message, severity, category, organization_id, user_id, action_url) VALUES (${input.title}, ${input.message}, ${input.severity}, ${input.category}, ${input.organizationId ?? null}, ${input.userId ?? null}, ${input.actionUrl ?? null}) RETURNING *`);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return (result as any[])[0];
    }),
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const [rows] = await exec(sql`SELECT COUNT(*) as count FROM in_app_notifications WHERE (user_id = ${ctx.user.id} OR user_id IS NULL) AND is_read = false`);
    return parseInt((rows as any[])[0]?.count ?? '0');
  }),
});

// ─── Advanced Analytics ───────────────────────────────────────────────────────
export const advancedAnalyticsRouter = router({
  complianceTrend: protectedProcedure.input(z.object({ days: z.number().int().min(7).max(365).default(90) })).query(async ({ input }) => {
    const trendDays = Math.max(7, Math.min(365, Math.floor(input.days)));
    const [rows] = await execRaw(`SELECT DATE_TRUNC('week', snapshot_date) as week, AVG(overall_score) as avg_score, SUM(open_violations) as total_violations, SUM(active_breaches) as total_breaches FROM ndpa_compliance_snapshots WHERE snapshot_date >= NOW() - ($1 || ' days')::interval AND organization_id IS NULL GROUP BY DATE_TRUNC('week', snapshot_date) ORDER BY week ASC`, [trendDays.toString()]);
    return rows as any[];
  }),
  sectorComparison: protectedProcedure.query(async () => {
    const [rows] = await exec(sql`SELECT o.sector, COUNT(DISTINCT o.id) as org_count, AVG(o.compliance_score) as avg_compliance_score, COUNT(DISTINCT cv.id) as total_violations, COUNT(DISTINCT fp.id) as total_penalties, COUNT(DISTINCT bi.id) as total_breaches, COALESCE(SUM(fp.amount), 0) as total_penalties_ngn FROM organizations o LEFT JOIN compliance_violations cv ON cv.organization_id = o.id AND cv.status = 'open' LEFT JOIN financial_penalties fp ON fp.organization_id = o.id LEFT JOIN breach_incidents bi ON bi.organization_id = o.id GROUP BY o.sector ORDER BY avg_compliance_score DESC NULLS LAST`);
    return rows as any[];
  }),
  penaltyAnalytics: protectedProcedure.query(async () => {
    const [byStatus] = await exec(sql`SELECT status, COUNT(*) as count, COALESCE(SUM(amount), 0) as total_ngn FROM financial_penalties GROUP BY status`);
    const [bySector] = await exec(sql`SELECT o.sector, COUNT(fp.id) as count, COALESCE(SUM(fp.amount), 0) as total_ngn FROM financial_penalties fp LEFT JOIN organizations o ON fp.organization_id = o.id GROUP BY o.sector ORDER BY total_ngn DESC`);
    const [monthly] = await exec(sql`SELECT DATE_TRUNC('month', created_at) as month, COUNT(*) as count, COALESCE(SUM(amount), 0) as total_ngn FROM financial_penalties WHERE created_at >= NOW() - INTERVAL '12 months' GROUP BY DATE_TRUNC('month', created_at) ORDER BY month ASC`);
    return { byStatus: byStatus as any[], bySector: bySector as any[], monthly: monthly as any[] };
  }),
  topRisks: protectedProcedure.input(z.object({ limit: z.number().int().default(10) })).query(async ({ input }) => {
    const [rows] = await execRaw(`SELECT o.id, o.name, o.sector, o.compliance_score, COUNT(DISTINCT cv.id) as open_violations, COUNT(DISTINCT bi.id) as active_breaches, COUNT(DISTINCT fp.id) as penalties, COALESCE(SUM(fp.amount), 0) as total_penalties_ngn, (100 - COALESCE(o.compliance_score, 50) + COUNT(DISTINCT cv.id) * 2 + COUNT(DISTINCT bi.id) * 5) as risk_index FROM organizations o LEFT JOIN compliance_violations cv ON cv.organization_id = o.id AND cv.status = 'open' LEFT JOIN breach_incidents bi ON bi.organization_id = o.id AND bi.breach_incident_status NOT IN ('resolved','closed') LEFT JOIN financial_penalties fp ON fp.organization_id = o.id GROUP BY o.id, o.name, o.sector, o.compliance_score ORDER BY risk_index DESC LIMIT ${input.limit}`);
    return rows as any[];
  }),
});

// ─── NDPA Article 40 Tracker ──────────────────────────────────────────────────
export const article40TrackerRouter = router({
  activeTimers: protectedProcedure.query(async () => {
    const [rows] = await exec(sql`
      SELECT b.*, o.name as org_name, o.sector,
        EXTRACT(EPOCH FROM (b.ndpc_notification_deadline - NOW())) / 3600 as hours_remaining,
        EXTRACT(EPOCH FROM (NOW() - b.detected_at)) / 3600 as hours_since_detection,
        CASE WHEN b.ndpc_notified_at IS NOT NULL THEN 'completed'
             WHEN b.ndpc_notification_deadline < NOW() THEN 'overdue'
             WHEN EXTRACT(EPOCH FROM (b.ndpc_notification_deadline - NOW())) / 3600 < 6 THEN 'critical'
             WHEN EXTRACT(EPOCH FROM (b.ndpc_notification_deadline - NOW())) / 3600 < 24 THEN 'warning'
             ELSE 'on_track' END as timer_status
      FROM breach_incidents b LEFT JOIN organizations o ON b.organization_id = o.id
      WHERE b.breach_incident_status NOT IN ('closed')
      ORDER BY CASE WHEN b.ndpc_notified_at IS NULL THEN 0 ELSE 1 END, b.ndpc_notification_deadline ASC
    `);
    return rows as any[];
  }),
  notifyNdpc: protectedProcedure
    .input(z.object({ breachId: z.number().int(), ndpcReferenceNumber: z.string().optional() }))
    .mutation(async ({ input }) => {
      const ref = input.ndpcReferenceNumber ?? `NDPC/BR/${new Date().getFullYear()}/${String(input.breachId).padStart(4, '0')}`;
      await exec(sql`UPDATE breach_incidents SET ndpc_notified_at = NOW(), ndpc_reference_number = ${ref}, breach_incident_status = 'ndpc_notified', updated_at = NOW() WHERE id = ${input.breachId}`);
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, referenceNumber: ref };
    }),
  slaMetrics: protectedProcedure.query(async () => {
    const [rows] = await exec(sql`SELECT COUNT(*) as total_breaches, SUM(CASE WHEN ndpc_notified_at IS NOT NULL THEN 1 ELSE 0 END) as notified, SUM(CASE WHEN ndpc_notified_at IS NULL AND ndpc_notification_deadline < NOW() THEN 1 ELSE 0 END) as overdue, SUM(CASE WHEN ndpc_notified_at IS NOT NULL AND ndpc_notified_at <= ndpc_notification_deadline THEN 1 ELSE 0 END) as on_time, SUM(CASE WHEN ndpc_notified_at IS NOT NULL AND ndpc_notified_at > ndpc_notification_deadline THEN 1 ELSE 0 END) as late, AVG(CASE WHEN ndpc_notified_at IS NOT NULL THEN EXTRACT(EPOCH FROM (ndpc_notified_at - detected_at)) / 3600 END) as avg_notification_hours FROM breach_incidents`);
    return (rows as any[])[0] ?? {};
  }),
});

// ─── NDPA Compliance Snapshots ────────────────────────────────────────────────
export const ndpaSnapshotsRouter = router({
  list: protectedProcedure
    .input(z.object({ orgId: z.number().int().optional(), days: z.number().int().min(7).max(365).default(90) }))
    .query(async ({ input }) => {
      const orgFilter = input.orgId ? `AND organization_id = ${input.orgId}` : 'AND organization_id IS NULL';
      const histDays = Math.max(1, Math.min(365, Math.floor(input.days)));
      const histParams: unknown[] = [histDays.toString()];
      const histOrgFilter = input.orgId ? `AND organization_id = $${histParams.push(input.orgId)}` : (input.orgId === null ? 'AND organization_id IS NULL' : '');
      const [rows] = await execRaw(`SELECT * FROM ndpa_compliance_snapshots WHERE snapshot_date >= NOW() - ($1 || ' days')::interval ${histOrgFilter} ORDER BY snapshot_date DESC`, histParams);
      return rows as any[];
    }),
  latest: protectedProcedure.query(async () => {
    const [rows] = await exec(sql`SELECT * FROM ndpa_compliance_snapshots WHERE organization_id IS NULL ORDER BY snapshot_date DESC LIMIT 1`);
    return (rows as any[])[0] ?? null;
  }),
  createSnapshot: protectedProcedure.mutation(async () => {
    const [violations] = await exec(sql`SELECT COUNT(*) as total, SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical FROM compliance_violations WHERE status = 'open'`);
    const [breaches] = await exec(sql`SELECT COUNT(*) as total FROM breach_incidents WHERE breach_incident_status NOT IN ('resolved','closed')`);
    const [dsars] = await exec(sql`SELECT COUNT(*) as total FROM citizen_requests WHERE request_type = 'dsar' AND status = 'pending'`);
    const vd = (violations as any[])[0];
    const bd = (breaches as any[])[0];
    const dd = (dsars as any[])[0];
    const overallScore = Math.max(0, 100 - parseInt(vd?.critical ?? '0') * 10 - parseInt(vd?.total ?? '0') * 2 - parseInt(bd?.total ?? '0') * 5);
    const [result] = await exec(sql`INSERT INTO ndpa_compliance_snapshots (overall_score, open_violations, critical_violations, pending_dsars, active_breaches) VALUES (${overallScore}, ${parseInt(vd?.total ?? '0')}, ${parseInt(vd?.critical ?? '0')}, ${parseInt(dd?.total ?? '0')}, ${parseInt(bd?.total ?? '0')}) RETURNING *`);
    emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "compliance_feature", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    return (result as any[])[0];
  }),
});
