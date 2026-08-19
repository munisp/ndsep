import crypto from "crypto";
import { and, desc, eq, gte, ilike, isNotNull, lt, lte, or, sql, SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getPgSslConfig } from "./dbSslConfig";
import { encryptField } from "./encryption";
import {
  assets,
  auditLogs,
  compliancePolicies,
  complianceViolations,
  dataCatalogEntries,
  enforcementActions,
  financialPenalties,
  penaltyAppeals,
  portalSubmissions,
  InsertUser,
  mlRiskPredictions,
  networkEvents,
  organizations,
  securityAlerts,
  streamingEvents,
  threatIntelligence,
  users,
  policyTemplates,
  aiSystems,
  evidencePackages,
  sectors,
  citizenRequests,
  configSnapshots,
  tiaAssessments,
  remediationWorkflows,
  consentRecords,
  retentionPolicies,
  complianceAuditReturns,
  adequacyDeterminations,
  cookieConsentRecords,
  automatedDecisionRecords,
  parentalConsentRecords,
  staffTrainingRecords,
  dataExportJobs,
  enforcementCases,
  breachIncidents,
  dpoAppointments,
  dpiaAssessments,
  ropaRecords,
  dpoReports,
  dataProcessingAgreements,
  privacyNotices,
  transferInstruments,
  transferApprovals,
  organizationUsers,
  InsertOrganizationUser,
  sectorComplianceEvents,
  InsertSectorComplianceEvent,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

const { Pool } = pg;

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: InstanceType<typeof Pool> | null = null;

import { getDatabaseUrl } from "./config";
import { logger } from "./logger";
const PG_URL = getDatabaseUrl();

export async function getDb() {
  // Reinitialize if pool was ended (e.g., after graceful shutdown or test teardown)
  const poolEnded = _pool && (_pool as any).ended === true;
  if (!_db || poolEnded) {
    _db = null;
    _pool = null;
    try {
      _pool = new Pool({
        connectionString: PG_URL,
        ssl: getPgSslConfig(),
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
      _db = drizzle(_pool);
    } catch (error) {
      logger.warn({ data: error }, "[Database] Failed to connect:");
      _db = null;
    }
  }
  return _db;
}

// ── Users ──────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { logger.warn("[Database] Cannot upsert user"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    textFields.forEach((field) => {
      const value = user[field];
      if (value === undefined) return;
      values[field] = value ?? null;
      updateSet[field] = value ?? null;
    });
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
  } catch (error) { logger.error({ err: error instanceof Error ? error.message : String(error) }, "[Database] Failed to upsert user:"); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function getDashboardStats() {
  const db = await getDb();
  if (!db) return null;
  const [orgStats] = await db.select({
    total: sql<number>`count(*)`,
    compliant: sql<number>`count(*) filter (where compliance_status = 'compliant')`,
    nonCompliant: sql<number>`count(*) filter (where compliance_status = 'non_compliant')`,
    underReview: sql<number>`count(*) filter (where compliance_status = 'under_review')`,
    avgScore: sql<number>`avg(compliance_score)`,
    avgRisk: sql<number>`avg(risk_score)`,
  }).from(organizations);

  const [assetStats] = await db.select({
    total: sql<number>`count(*)`,
    outsideBorders: sql<number>`count(*) filter (where is_within_borders = false)`,
    quarantined: sql<number>`count(*) filter (where status = 'quarantined')`,
  }).from(assets);

  const [violationStats] = await db.select({
    total: sql<number>`count(*)`,
    critical: sql<number>`count(*) filter (where severity = 'critical')`,
    open: sql<number>`count(*) filter (where status = 'non_compliant')`,
  }).from(complianceViolations);

  const [alertStats] = await db.select({
    total: sql<number>`count(*)`,
    unresolved: sql<number>`count(*) filter (where is_resolved = false)`,
    critical: sql<number>`count(*) filter (where severity = 'critical' and is_resolved = false)`,
  }).from(securityAlerts);

  const [penaltyStats] = await db.select({
    total: sql<number>`count(*)`,
    totalAmount: sql<number>`sum(amount)`,
    pendingAmount: sql<number>`sum(amount) filter (where payment_status = 'pending')`,
    overdueAmount: sql<number>`sum(amount) filter (where payment_status = 'overdue')`,
    overdue: sql<number>`count(*) filter (where payment_status = 'overdue')`,
    pending: sql<number>`count(*) filter (where payment_status = 'pending')`,
  }).from(financialPenalties);

  const [networkStats] = await db.select({
    total: sql<number>`count(*)`,
    crossBorder: sql<number>`count(*) filter (where is_cross_border = true)`,
    blocked: sql<number>`count(*) filter (where is_blocked = true)`,
    exfiltration: sql<number>`count(*) filter (where event_type = 'exfiltration_attempt')`,
  }).from(networkEvents);

  // ── NDPA/GAID Compliance Stats (18 gap-closure tables) ──────────────────────
  const pool = _pool;
  let complianceGapStats = null;
  if (pool) {
    try {
      const [consentRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE consent_status = 'active')::int AS active, count(*) FILTER (WHERE consent_status = 'withdrawn')::int AS withdrawn FROM consent_records`)).rows;
      const [breachRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE breach_incident_status IN ('detected','assessing'))::int AS open, count(*) FILTER (WHERE breach_incident_severity IN ('critical','high'))::int AS critical FROM breach_incidents`)).rows;
      const [dpoRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active = true)::int AS active, count(*) FILTER (WHERE credential_status = 'verified')::int AS verified FROM dpo_appointments`)).rows;
      const [dpiaRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE dpia_risk_level IN ('high','critical'))::int AS highRisk, count(*) FILTER (WHERE dpia_status = 'approved')::int AS approved FROM dpia_assessments`)).rows;
      const [ropaRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active = true)::int AS active FROM ropa_records`)).rows;
      const [retentionRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active = true)::int AS active FROM retention_policies`)).rows;
      const [dpoReportRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE dpo_report_status = 'submitted')::int AS submitted FROM dpo_reports`)).rows;
      const [carRow] = (await pool.query(`SELECT count(*)::int AS total, avg(compliance_score)::numeric(5,1) AS "avgScore" FROM compliance_audit_returns`)).rows;
      const [adequacyRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE adequacy_status = 'adequate')::int AS adequate FROM adequacy_determinations`)).rows;
      const [dpaRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE dpa_status = 'active')::int AS active FROM data_processing_agreements`)).rows;
      const [privacyRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE privacy_notice_status = 'published')::int AS published FROM privacy_notices`)).rows;
      const [cookieRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE consent_given = true)::int AS consented FROM cookie_consent_records`)).rows;
      const [autoDecRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE significant_effect = true)::int AS significant, count(*) FILTER (WHERE human_review_completed_at IS NOT NULL)::int AS reviewed FROM automated_decision_records`)).rows;
      const [parentalRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE parental_consent_status = 'granted')::int AS granted FROM parental_consent_records`)).rows;
      const [trainingRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE training_status = 'completed')::int AS completed FROM staff_training_records`)).rows;
      const [transferRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE transfer_instrument_status = 'active')::int AS active FROM transfer_instruments`)).rows;
      const [exportRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE export_job_status = 'completed')::int AS completed, count(*) FILTER (WHERE export_job_status = 'failed')::int AS failed FROM data_export_jobs`)).rows;
      const [dcpmiRow] = (await pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active = true)::int AS active FROM dcpmi_thresholds`)).rows;

      complianceGapStats = {
        consent: consentRow, breaches: breachRow, dpoRegistry: dpoRow,
        dpia: dpiaRow, ropa: ropaRow, retention: retentionRow,
        dpoReports: dpoReportRow, auditReturns: carRow, adequacy: adequacyRow,
        dpa: dpaRow, privacyNotices: privacyRow, cookieConsent: cookieRow,
        automatedDecisions: autoDecRow, parentalConsent: parentalRow,
        staffTraining: trainingRow, transferInstruments: transferRow,
        dataExport: exportRow, dcpmi: dcpmiRow,
      };
    } catch { /* tables may not exist yet */ }
  }

  return { orgStats, assetStats, violationStats, alertStats, penaltyStats, networkStats, complianceGapStats };
}

// ── Organizations ─────────────────────────────────────────────────────────────

export async function getOrganizations(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(organizations).orderBy(desc(organizations.riskScore)).limit(limit).offset(offset);
}

export async function getOrganizationById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  return result[0];
}

export async function getOrganizationWithDetails(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org) return null;
  const orgAssets = await db.select().from(assets).where(eq(assets.organizationId, id)).limit(20);
  const orgViolations = await db.select().from(complianceViolations).where(eq(complianceViolations.organizationId, id)).orderBy(desc(complianceViolations.detectedAt)).limit(10);
  const orgAlerts = await db.select().from(securityAlerts).where(eq(securityAlerts.organizationId, id)).orderBy(desc(securityAlerts.detectedAt)).limit(10);
  const [mlPrediction] = await db.select().from(mlRiskPredictions).where(eq(mlRiskPredictions.organizationId, id)).orderBy(desc(mlRiskPredictions.createdAt)).limit(1);
  return { org, assets: orgAssets, violations: orgViolations, alerts: orgAlerts, mlPrediction };
}

// ── Assets ────────────────────────────────────────────────────────────────────

export async function getAssets(orgId?: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  if (orgId) return db.select().from(assets).where(eq(assets.organizationId, orgId)).orderBy(desc(assets.lastSeen)).limit(limit);
  return db.select().from(assets).orderBy(desc(assets.lastSeen)).limit(limit);
}

export async function getAssetsByType() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    assetType: assets.assetType,
    count: sql<number>`count(*)`,
    outsideBorders: sql<number>`count(*) filter (where is_within_borders = false)`,
  }).from(assets).groupBy(assets.assetType);
}

// ── Compliance ────────────────────────────────────────────────────────────────

export async function getCompliancePolicies() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(compliancePolicies).where(eq(compliancePolicies.isActive, true)).orderBy(desc(compliancePolicies.weight));
}

export async function getComplianceViolations(limit = 50, severity?: string) {
  const db = await getDb();
  if (!db) return [];
  const base = db.select({
    id: complianceViolations.id,
    title: complianceViolations.title,
    description: complianceViolations.description,
    severity: complianceViolations.severity,
    status: complianceViolations.status,
    organizationId: complianceViolations.organizationId,
    organizationName: organizations.name,
    organizationSector: organizations.sector,
    policyId: complianceViolations.policyId,
    enforcementStatus: complianceViolations.enforcementStatus,
    penaltyAmount: complianceViolations.penaltyAmount,
    detectedAt: complianceViolations.detectedAt,
    resolvedAt: complianceViolations.resolvedAt,
    createdAt: complianceViolations.createdAt,
  }).from(complianceViolations)
    .leftJoin(organizations, eq(complianceViolations.organizationId, organizations.id));
  if (severity) {
    return base.where(eq(complianceViolations.severity, severity as "critical" | "high" | "medium" | "low" | "info"))
      .orderBy(desc(complianceViolations.detectedAt)).limit(limit);
  }
  return base.orderBy(desc(complianceViolations.detectedAt)).limit(limit);
}

export async function getEnforcementActions(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: enforcementActions.id,
    workflowId: enforcementActions.workflowId,
    actionType: enforcementActions.actionType,
    status: enforcementActions.status,
    organizationId: enforcementActions.organizationId,
    organizationName: organizations.name,
    organizationSector: organizations.sector,
    violationId: enforcementActions.violationId,
    penaltyAmount: enforcementActions.penaltyAmount,
    notes: enforcementActions.notes,
    penaltyImposedAt: enforcementActions.penaltyImposedAt,
    createdAt: enforcementActions.createdAt,
    updatedAt: enforcementActions.updatedAt,
  }).from(enforcementActions)
    .leftJoin(organizations, eq(enforcementActions.organizationId, organizations.id))
    .orderBy(desc(enforcementActions.createdAt)).limit(limit);
}

// ── Data Catalog ──────────────────────────────────────────────────────────────

export async function getDataCatalogEntries(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dataCatalogEntries).orderBy(desc(dataCatalogEntries.updatedAt)).limit(limit);
}

export async function getDataResidencyMap() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: dataCatalogEntries.id,
    name: dataCatalogEntries.name,
    classification: dataCatalogEntries.classification,
    isWithinBorders: dataCatalogEntries.isWithinBorders,
    latitude: dataCatalogEntries.latitude,
    longitude: dataCatalogEntries.longitude,
    storageLocation: dataCatalogEntries.storageLocation,
    qualityScore: dataCatalogEntries.qualityScore,
    rowCount: dataCatalogEntries.rowCount,
  }).from(dataCatalogEntries);
}

// ── SIEM ──────────────────────────────────────────────────────────────────────

export async function getSecurityAlerts(limit = 50, resolved?: boolean) {
  const db = await getDb();
  if (!db) return [];
  if (resolved !== undefined) {
    return db.select().from(securityAlerts)
      .where(eq(securityAlerts.isResolved, resolved))
      .orderBy(desc(securityAlerts.detectedAt)).limit(limit);
  }
  return db.select().from(securityAlerts).orderBy(desc(securityAlerts.detectedAt)).limit(limit);
}

export async function getThreatIntelligence(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(threatIntelligence)
    .where(eq(threatIntelligence.isActive, true))
    .orderBy(desc(threatIntelligence.confidence)).limit(limit);
}

export async function getAuditLogs(
  limit = 100,
  search?: string,
  filters?: { action?: string; resourceType?: string; resourceId?: number; userId?: number }
) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (search) conditions.push(or(ilike(auditLogs.action, `%${search}%`), ilike(auditLogs.details, `%${search}%`)) as SQL);
  if (filters?.action) conditions.push(eq(auditLogs.action, filters.action));
  if (filters?.resourceType) conditions.push(eq(auditLogs.resourceType, filters.resourceType));
  if (filters?.resourceId) conditions.push(eq(auditLogs.resourceId, filters.resourceId));
  if (filters?.userId) conditions.push(eq(auditLogs.userId, filters.userId));
  const q = db.select().from(auditLogs);
  if (conditions.length > 0) {
    return q.where(and(...conditions)).orderBy(desc(auditLogs.createdAt)).limit(limit);
  }
  return q.orderBy(desc(auditLogs.createdAt)).limit(limit);
}

// ── Network ───────────────────────────────────────────────────────────────────

export async function getNetworkEvents(limit = 50, crossBorderOnly = false) {
  const db = await getDb();
  if (!db) return [];
  const base = db.select({
    id: networkEvents.id,
    eventType: networkEvents.eventType,
    sourceIp: networkEvents.sourceIp,
    destinationIp: networkEvents.destinationIp,
    protocol: networkEvents.protocol,
    bytesTransferred: networkEvents.bytesTransferred,
    isCrossBorder: networkEvents.isCrossBorder,
    isBlocked: networkEvents.isBlocked,
    ixpSite: networkEvents.ixpSite,
    organizationId: networkEvents.organizationId,
    organizationName: organizations.name,
    organizationSector: organizations.sector,
    detectedAt: networkEvents.detectedAt,
    createdAt: networkEvents.createdAt,
  }).from(networkEvents)
    .leftJoin(organizations, eq(networkEvents.organizationId, organizations.id));
  if (crossBorderOnly) {
    return base.where(eq(networkEvents.isCrossBorder, true))
      .orderBy(desc(networkEvents.detectedAt)).limit(limit);
  }
  return base.orderBy(desc(networkEvents.detectedAt)).limit(limit);
}

export async function getNetworkStats() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    eventType: networkEvents.eventType,
    count: sql<number>`count(*)`,
    totalBytes: sql<number>`sum(bytes_transferred)`,
    blocked: sql<number>`count(*) filter (where is_blocked = true)`,
  }).from(networkEvents).groupBy(networkEvents.eventType);
}

// ── Financial ─────────────────────────────────────────────────────────────────
export async function getFinancialPenalties(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: financialPenalties.id,
    organizationId: financialPenalties.organizationId,
    organizationName: organizations.name,
    organizationSector: organizations.sector,
    amount: financialPenalties.amount,
    currency: financialPenalties.currency,
    violationId: financialPenalties.violationId,
    description: financialPenalties.description,
    paymentStatus: financialPenalties.paymentStatus,
    tigerBeetleTransferId: financialPenalties.tigerBeetleTransferId,
    mojaloopTransferId: financialPenalties.mojaloopTransferId,
    dueDate: financialPenalties.dueDate,
    paidAt: financialPenalties.paidAt,
    createdAt: financialPenalties.createdAt,
  }).from(financialPenalties)
    .leftJoin(organizations, eq(financialPenalties.organizationId, organizations.id))
    .orderBy(desc(financialPenalties.createdAt)).limit(limit);
}

export async function getPenaltySummary() {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.select({
    totalAmount: sql<number>`sum(amount)`,
    pendingAmount: sql<number>`sum(amount) filter (where payment_status = 'pending')`,
    overdueAmount: sql<number>`sum(amount) filter (where payment_status = 'overdue')`,
    collectedAmount: sql<number>`sum(amount) filter (where payment_status = 'completed')`,
    count: sql<number>`count(*)`,
    overdueCount: sql<number>`count(*) filter (where payment_status = 'overdue')`,
  }).from(financialPenalties);
  return result;
}

// ── Streaming ─────────────────────────────────────────────────────────────────

export async function getStreamingEvents(limit = 30) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(streamingEvents).orderBy(desc(streamingEvents.createdAt)).limit(limit);
}

export async function getStreamingTopicStats() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    topic: streamingEvents.topic,
    count: sql<number>`count(*)`,
    latest: sql<Date>`max(created_at)`,
  }).from(streamingEvents).groupBy(streamingEvents.topic).orderBy(desc(sql`count(*)`));
}

// ── ML Predictions ────────────────────────────────────────────────────────────

export async function getMlPredictions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(mlRiskPredictions).orderBy(desc(mlRiskPredictions.predictedRiskScore));
}

export async function getMlPredictionByOrg(orgId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(mlRiskPredictions)
    .where(eq(mlRiskPredictions.organizationId, orgId))
    .orderBy(desc(mlRiskPredictions.createdAt)).limit(1);
  return result[0];
}

// ── User Management ───────────────────────────────────────────────────────────
export async function listUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: users.id,
    openId: users.openId,
    name: users.name,
    email: users.email,
    role: users.role,
    organizationId: users.organizationId,
    createdAt: users.createdAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).orderBy(users.createdAt);
}

export async function updateUserRole(userId: number, role: "user" | "admin" | "auditor" | "org_admin") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// ── Enforcement Action Creation ───────────────────────────────────────────────
export async function createEnforcementAction(data: {
  organizationId: number;
  violationId: number;
  actionType: string;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const workflowId = `wf-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const result = await db.insert(enforcementActions).values({
    organizationId: data.organizationId,
    violationId: data.violationId,
    workflowId,
    actionType: data.actionType,
    status: "pending",
    notes: data.notes ?? null,
  }).returning();
  return result[0];
}

export async function updateEnforcementStatus(actionId: number, status: "pending" | "notice_sent" | "audit_scheduled" | "penalty_imposed" | "settled" | "escalated") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData: { status: typeof status; completedAt?: Date } = { status };
  if (status === "settled" || status === "escalated") {
    updateData.completedAt = new Date();
  }
  await db.update(enforcementActions).set(updateData).where(eq(enforcementActions.id, actionId));
}

// ── Financial Penalty Creation ────────────────────────────────────────────────
export async function createFinancialPenalty(data: {
  organizationId: number;
  violationId?: number;
  enforcementActionId?: number;
  amount: number;
  currency: string;
  description: string;
  dueDate?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // External settlement identifiers are authoritative receipts. They must be
  // written only after TigerBeetle/Mojaloop confirms the corresponding transfer.
  // A newly issued penalty is therefore intentionally receipt-free and pending.
  const result = await db.insert(financialPenalties).values({
    organizationId: data.organizationId,
    violationId: data.violationId ?? null,
    enforcementActionId: data.enforcementActionId ?? null,
    amount: data.amount,
    currency: data.currency,
    description: data.description,
    paymentStatus: "pending",
    dueDate: data.dueDate ?? null,
  }).returning();
  return result[0];
}

export async function updatePenaltyStatus(penaltyId: number, status: "pending" | "processing" | "completed" | "failed" | "overdue") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData: { paymentStatus: typeof status; paidAt?: Date } = { paymentStatus: status };
  if (status === "completed") updateData.paidAt = new Date();
  await db.update(financialPenalties).set(updateData).where(eq(financialPenalties.id, penaltyId));
}

export async function getOrganizationsForSelect() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: organizations.id,
    name: organizations.name,
    sector: organizations.sector,
    complianceStatus: organizations.complianceStatus,
    riskScore: organizations.riskScore,
  }).from(organizations).orderBy(organizations.name);
}

// ─────────────────────────────────────────────────────────────────────────────
// BGP Route Validation (Rust Worker — L1)
// ─────────────────────────────────────────────────────────────────────────────

export async function getBgpRoutes(limit = 50, hijackedOnly = false) {
  const pool = getSharedPool();
  const where = hijackedOnly ? "WHERE is_hijacked = TRUE" : "";
  const result = await pool.query(
    `SELECT id, prefix, origin_asn, peer_asn, as_path, next_hop,
            rpki_status, is_hijacked, is_leaked, is_cross_border,
            organization_id, ixp_site, community_tags, metadata, detected_at
     FROM bgp_routes
     ${where}
     ORDER BY detected_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getBgpStats() {
  const pool = getSharedPool();
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE rpki_status = 'valid') AS valid,
      COUNT(*) FILTER (WHERE rpki_status = 'invalid') AS invalid,
      COUNT(*) FILTER (WHERE is_hijacked = TRUE) AS hijacked,
      COUNT(*) FILTER (WHERE is_leaked = TRUE) AS leaked,
      COUNT(*) FILTER (WHERE is_cross_border = TRUE) AS cross_border,
      COUNT(DISTINCT origin_asn) AS unique_asns
    FROM bgp_routes
    WHERE detected_at > NOW() - INTERVAL '24 hours'
  `);
  return result.rows[0] ?? {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Residency Checks (Rust Worker — L2)
// ─────────────────────────────────────────────────────────────────────────────

export async function getResidencyChecks(limit = 50, violationsOnly = false) {
  const pool = getSharedPool();
  const where = violationsOnly ? "WHERE rc.residency_status = 'violation'" : "";
  const result = await pool.query(
    `SELECT rc.id, rc.organization_id, o.name AS organization_name,
            rc.data_asset_name, rc.data_classification, rc.storage_location,
            rc.storage_country, rc.storage_latitude, rc.storage_longitude,
            rc.is_within_borders, rc.residency_status, rc.violation_reason,
            rc.remediation_action, rc.checked_at
     FROM residency_checks rc
     LEFT JOIN organizations o ON o.id = rc.organization_id
     ${where}
     ORDER BY rc.checked_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getResidencyStats() {
  const pool = getSharedPool();
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total_checks,
      COUNT(*) FILTER (WHERE residency_status = 'compliant') AS compliant,
      COUNT(*) FILTER (WHERE residency_status = 'violation') AS violations,
      COUNT(*) FILTER (WHERE residency_status = 'warning') AS warnings,
      COUNT(*) FILTER (WHERE is_within_borders = FALSE) AS outside_borders,
      COUNT(DISTINCT organization_id) AS orgs_checked
    FROM residency_checks
    WHERE checked_at > NOW() - INTERVAL '24 hours'
  `);
  return result.rows[0] ?? {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial Ledger (Rust Worker — TigerBeetle/Mojaloop)
// ─────────────────────────────────────────────────────────────────────────────

export async function getLedgerTransactions(limit = 50, status?: string) {
  const pool = getSharedPool();
  const where = status ? `WHERE fl.status = $2` : "";
  const params: (number | string)[] = status ? [limit, status] : [limit];
  const result = await pool.query(
    `SELECT fl.id, fl.transaction_id, fl.organization_id, o.name AS organization_name,
            fl.tx_type, fl.status, fl.amount, fl.currency,
            fl.debit_account, fl.credit_account,
            fl.tiger_beetle_id, fl.mojaloop_id,
            fl.description, fl.settled_at, fl.created_at
     FROM financial_ledger fl
     LEFT JOIN organizations o ON o.id = fl.organization_id
     ${where}
     ORDER BY fl.created_at DESC
     LIMIT $1`,
    params
  );
  return result.rows;
}

export async function getLedgerSummary() {
  const pool = getSharedPool();
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total_transactions,
      COUNT(*) FILTER (WHERE status = 'settled') AS settled,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COALESCE(SUM(amount) FILTER (WHERE status = 'settled'), 0) AS total_settled_amount,
      COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) AS total_pending_amount,
      COALESCE(SUM(amount) FILTER (WHERE tx_type = 'penalty'), 0) AS total_penalties,
      COUNT(DISTINCT organization_id) AS orgs_with_transactions
    FROM financial_ledger
  `);
  return result.rows[0] ?? {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Workers Status (aggregated from all 10 workers)
// ─────────────────────────────────────────────────────────────────────────────

export async function getWorkersStatus() {
  const workerDefs = [
    { id: "dpi-engine", name: "DPI Engine", port: 8081, layer: "L5", lang: "Go" },
    { id: "discovery-agent", name: "Discovery Agent", port: 8082, layer: "L1", lang: "Go" },
    { id: "compliance-engine", name: "Compliance Engine", port: 8083, layer: "L3", lang: "Go" },
    { id: "kafka-monitor", name: "Kafka Monitor", port: 8084, layer: "Streaming", lang: "Go" },
    { id: "ml-prediction", name: "ML Prediction", port: 8085, layer: "L6", lang: "Python" },
    { id: "siem-correlator", name: "SIEM Correlator", port: 8086, layer: "L4", lang: "Python" },
    { id: "fluvio-telemetry", name: "Fluvio Telemetry", port: 8087, layer: "L5", lang: "Python" },
    { id: "bgp-validator", name: "BGP Route Validator", port: 8088, layer: "L1", lang: "Rust" },
    { id: "residency-enforcer", name: "Residency Enforcer", port: 8089, layer: "L2", lang: "Rust" },
    { id: "financial-ledger", name: "Financial Ledger Engine", port: 8090, layer: "FIN", lang: "Rust" },
  ];

  const results = await Promise.allSettled(
    workerDefs.map(async (w) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        const [healthRes, metricsRes] = await Promise.allSettled([
          fetch(`http://localhost:${w.port}/health`, { signal: ctrl.signal }),
          fetch(`http://localhost:${w.port}/metrics`, { signal: ctrl.signal }),
        ]);
        clearTimeout(timer);
        const status = healthRes.status === "fulfilled" && healthRes.value.ok ? "running" : "error";
        let metrics: Record<string, unknown> = {};
        if (metricsRes.status === "fulfilled" && metricsRes.value.ok) {
          metrics = await metricsRes.value.json();
        }
        return { ...w, status, metrics };
      } catch {
        return { ...w, status: "offline", metrics: {} };
      }
    })
  );

  return results.map((r, i) =>
    r.status === "fulfilled" ? r.value : { ...workerDefs[i], status: "offline", metrics: {} }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Portal Submissions
// ─────────────────────────────────────────────────────────────────────────────

export async function createPortalSubmission(data: {
  orgName: string; orgSector: string; orgCountry: string; regulatoryId?: string;
  contactName: string; contactEmail: string; contactPhone?: string;
  assets: Array<{ type: string; name: string; count: number; location: string }>;
  datasets: Array<{ name: string; classification: string; storageLocation: string; containsPii: boolean; crossBorder: boolean; recordCount: string }>;
  selfAssessmentScore: number;
  assessmentAnswers: Record<string, boolean>;
}) {
  const pool = getSharedPool();
  try {
    const token = `NDSEP-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const result = await pool.query(
      `INSERT INTO portal_submissions
        (submission_token, org_name, org_sector, org_country, regulatory_id, contact_name, contact_email, contact_phone,
         asset_count, dataset_count, self_assessment_score, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, submission_token`,
      [
        token, data.orgName, data.orgSector, data.orgCountry, data.regulatoryId || null,
        encryptField(data.contactName), encryptField(data.contactEmail), data.contactPhone ? encryptField(data.contactPhone) : null,
        data.assets.reduce((a, x) => a + x.count, 0),
        data.datasets.length,
        data.selfAssessmentScore,
        JSON.stringify({ assets: data.assets, datasets: data.datasets, answers: data.assessmentAnswers }),
      ]
    );
    const sub = result.rows[0];
    const phases = ["registration", "asset_inventory", "data_catalog", "self_assessment", "initial_audit", "remediation", "certified"];
    for (let i = 0; i < phases.length; i++) {
      await pool.query(
        `INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [sub.id, phases[i], i === 0 ? "completed" : i === 1 ? "in_progress" : "pending",
         i <= 1 ? new Date() : null, i === 0 ? new Date() : null]
      );
    }
    return { id: sub.id as number, submissionToken: sub.submission_token as string };
  } catch (e) { throw e; }
}

export async function getPortalSubmissions(limit = 50, sector?: string, phase?: string) {
  const pool = getSharedPool();
  let q = `SELECT * FROM portal_submissions`;
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (sector) { params.push(sector); conditions.push(`org_sector = $${params.length}`); }
  if (phase) { params.push(phase); conditions.push(`current_phase = $${params.length}`); }
  if (conditions.length) q += ` WHERE ${conditions.join(" AND ")}`;
  q += ` ORDER BY submitted_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  const r = await pool.query(q, params);
  return r.rows;
}

export async function getPortalSubmission(token: string) {
  const pool = getSharedPool();
  const r = await pool.query(`SELECT * FROM portal_submissions WHERE submission_token = $1`, [token]);
  if (!r.rows[0]) return null;
  const phases = await pool.query(`SELECT * FROM onboarding_phases WHERE submission_id = $1 ORDER BY id`, [r.rows[0].id]);
  return { ...r.rows[0], phases: phases.rows };
}

export async function getPortalStats() {
  const pool = getSharedPool();
  const r = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE current_phase = 'certified') AS certified,
      COUNT(*) FILTER (WHERE current_phase = 'initial_audit') AS in_audit,
      COUNT(*) FILTER (WHERE current_phase = 'remediation') AS in_remediation,
      COUNT(*) FILTER (WHERE current_phase = 'registration') AS registered,
      AVG(self_assessment_score) AS avg_self_score,
      AVG(compliance_score) AS avg_compliance_score
    FROM portal_submissions
  `);
  return r.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfer Approvals
// ─────────────────────────────────────────────────────────────────────────────

export async function createTransferApproval(data: {
  organizationId: number; submissionId?: number; datasetName: string; datasetId?: number;
  sourceCountry: string; destinationCountry: string; destinationEntity: string;
  volumeGb: number; dataClassification: string; businessJustification: string;
  transferMethod?: string; encryptionMethod?: string;
}) {
  const pool = getSharedPool();
  const refId = `XFER-${Date.now()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
  const riskScore = Math.min(100, (data.volumeGb / 10) * 20 +
    (data.dataClassification === "tier1_pii" ? 40 : data.dataClassification === "tier3_health" ? 30 : 10));
  const r = await pool.query(
    `INSERT INTO transfer_approvals
      (reference_id, organization_id, submission_id, dataset_name, dataset_id, source_country, destination_country,
       destination_entity, volume_gb, data_classification, business_justification, transfer_method, encryption_method, risk_score,
       expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW() + INTERVAL '30 days')
     RETURNING *`,
    [refId, data.organizationId, data.submissionId || null, data.datasetName, data.datasetId || null,
     data.sourceCountry, data.destinationCountry, data.destinationEntity, data.volumeGb,
     data.dataClassification, data.businessJustification, data.transferMethod || null,
     data.encryptionMethod || null, riskScore]
  );
  return r.rows[0];
}

export async function getTransferApprovals(limit = 50, status?: string) {
  const pool = getSharedPool();
  let q = `SELECT ta.*, o.name AS org_name FROM transfer_approvals ta LEFT JOIN organizations o ON o.id = ta.organization_id`;
  const params: unknown[] = [];
  if (status) { params.push(status); q += ` WHERE ta.status = $1`; }
  q += ` ORDER BY ta.requested_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  const r = await pool.query(q, params);
  return r.rows;
}

export async function reviewTransferApproval(id: number, decision: "approved" | "denied", approverId: number, notes?: string) {
  const pool = getSharedPool();
  const col = decision === "approved" ? "approved_at" : "denied_at";
  const r = await pool.query(
    `UPDATE transfer_approvals SET status = $1, approver_id = $2, approver_notes = $3, ${col} = NOW(), updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [decision, approverId, notes || null, id]
  );
  return r.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Continuous Monitoring
// ─────────────────────────────────────────────────────────────────────────────

export async function getMonitoringSnapshots(limit = 100, orgId?: number, snapshotType?: string) {
  const pool = getSharedPool();
  let q = `SELECT ms.*, o.name AS org_name FROM monitoring_snapshots ms LEFT JOIN organizations o ON o.id = ms.organization_id`;
  const params: unknown[] = [];
  const conds: string[] = [];
  if (orgId) { params.push(orgId); conds.push(`ms.organization_id = $${params.length}`); }
  if (snapshotType) { params.push(snapshotType); conds.push(`ms.snapshot_type = $${params.length}`); }
  if (conds.length) q += ` WHERE ${conds.join(" AND ")}`;
  q += ` ORDER BY ms.captured_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  const r = await pool.query(q, params);
  return r.rows;
}

export async function getSlaBreaches(limit = 50, status?: string) {
  const pool = getSharedPool();
  let q = `SELECT sb.*, o.name AS org_name FROM sla_breaches sb LEFT JOIN organizations o ON o.id = sb.organization_id`;
  const params: unknown[] = [];
  if (status) { params.push(status); q += ` WHERE sb.status = $1`; params.push(limit); } else { params.push(limit); }
  q += ` ORDER BY sb.detected_at DESC LIMIT $${params.length}`;
  const r = await pool.query(q, params);
  return r.rows;
}

export async function getDriftAlerts(limit = 50, status?: string) {
  const pool = getSharedPool();
  let q = `SELECT da.*, o.name AS org_name FROM drift_alerts da LEFT JOIN organizations o ON o.id = da.organization_id`;
  const params: unknown[] = [];
  if (status) { params.push(status); q += ` WHERE da.status = $1`; params.push(limit); } else { params.push(limit); }
  q += ` ORDER BY da.detected_at DESC LIMIT $${params.length}`;
  const r = await pool.query(q, params);
  return r.rows;
}

export async function getMonitoringStats() {
  const pool = getSharedPool();
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM monitoring_snapshots WHERE status IN ('warning','breach','critical') AND resolved_at IS NULL) AS active_issues,
      (SELECT COUNT(*) FROM sla_breaches WHERE status = 'open') AS open_sla_breaches,
      (SELECT COUNT(*) FROM drift_alerts WHERE status = 'open') AS open_drift_alerts,
      (SELECT COUNT(*) FROM monitoring_snapshots WHERE captured_at > NOW() - INTERVAL '24 hours') AS snapshots_24h,
      (SELECT AVG(score) FROM monitoring_snapshots WHERE snapshot_type = 'compliance_score' AND captured_at > NOW() - INTERVAL '7 days') AS avg_compliance_7d
  `);
  return r.rows[0];
}

export async function getOrgScores() {
  const pool = getSharedPool();
  const r = await pool.query(`
    SELECT
      ms.organization_id,
      o.name AS org_name,
      MAX(ms.score) AS latest_score,
      COUNT(*) AS snapshot_count,
      MAX(ms.captured_at) AS last_updated,
      CASE
        WHEN (
          SELECT score FROM monitoring_snapshots ms2
          WHERE ms2.organization_id = ms.organization_id AND ms2.snapshot_type = 'compliance_score'
          ORDER BY captured_at DESC LIMIT 1
        ) < (
          SELECT score FROM monitoring_snapshots ms3
          WHERE ms3.organization_id = ms.organization_id AND ms3.snapshot_type = 'compliance_score'
          ORDER BY captured_at DESC OFFSET 1 LIMIT 1
        )
        THEN 'down'
        ELSE 'up'
      END AS trend_direction
    FROM monitoring_snapshots ms
    LEFT JOIN organizations o ON o.id = ms.organization_id
    WHERE ms.snapshot_type = 'compliance_score'
    GROUP BY ms.organization_id, o.name
    ORDER BY latest_score ASC
    LIMIT 20
  `);
  return r.rows;
}

export async function resolveDriftAlertById(id: number) {
  const pool = getSharedPool();
  await pool.query(
    `UPDATE drift_alerts SET status = 'resolved', resolved_at = NOW() WHERE id = $1`,
    [id]
  );
  return { success: true };
}

export async function resolveSlaBreachById(id: number) {
  const pool = getSharedPool();
  await pool.query(
    `UPDATE sla_breaches SET status = 'resolved', resolved_at = NOW() WHERE id = $1`,
    [id]
  );
  return { success: true };
}

// ── Trend & Chart Data ─────────────────────────────────────────────────────────
export async function getAlertTrendByHour() {
  const pool = getSharedPool();
  const r = await pool.query(`
    SELECT
      LPAD(EXTRACT(HOUR FROM detected_at)::text, 2, '0') || ':00' AS time,
      COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
      COUNT(*) FILTER (WHERE severity = 'high') AS high,
      COUNT(*) FILTER (WHERE severity = 'medium') AS medium,
      COUNT(*) FILTER (WHERE severity = 'low') AS low
    FROM security_alerts
    GROUP BY EXTRACT(HOUR FROM detected_at)
    ORDER BY EXTRACT(HOUR FROM detected_at)
  `);
  return r.rows;
}

export async function getAlertTypeBreakdown() {
  const pool = getSharedPool();
  const r = await pool.query(`
    SELECT alert_type AS category, COUNT(*) AS count
    FROM security_alerts
    WHERE alert_type IS NOT NULL AND alert_type != ''
    GROUP BY alert_type
    ORDER BY count DESC
    LIMIT 8
  `);
  return r.rows;
}

export async function getNetworkTrafficByHour() {
  const pool = getSharedPool();
  const r = await pool.query(`
    SELECT
      LPAD(EXTRACT(HOUR FROM detected_at)::text, 2, '0') || ':00' AS time,
      COUNT(*) AS inbound,
      COUNT(*) FILTER (WHERE is_cross_border) AS outbound,
      COUNT(*) FILTER (WHERE is_blocked) AS blocked,
      COUNT(*) FILTER (WHERE is_cross_border) AS cross_border
    FROM network_events
    GROUP BY EXTRACT(HOUR FROM detected_at)
    ORDER BY EXTRACT(HOUR FROM detected_at)
  `);
  return r.rows;
}

export async function getIxpSiteStats() {
  const pool = getSharedPool();
  const r = await pool.query(`
    SELECT
      ixp_site AS name,
      COUNT(*) AS events,
      COUNT(*) FILTER (WHERE is_blocked) AS blocked,
      SUM(bytes_transferred) AS bytes,
      COUNT(*) FILTER (WHERE is_cross_border) AS cross_border
    FROM network_events
    WHERE ixp_site IS NOT NULL AND ixp_site != ''
    GROUP BY ixp_site
    ORDER BY events DESC
    LIMIT 8
  `);
  return r.rows;
}

export async function getFinancialMonthlyTrend() {
  const pool = getSharedPool();
  const r = await pool.query(`
    SELECT
      TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') AS month,
      COALESCE(SUM(amount), 0) AS issued,
      COALESCE(SUM(amount) FILTER (WHERE payment_status = 'completed'), 0) AS collected,
      COALESCE(SUM(amount) FILTER (WHERE payment_status = 'overdue'), 0) AS overdue
    FROM financial_penalties
    GROUP BY DATE_TRUNC('month', created_at), TO_CHAR(DATE_TRUNC('month', created_at), 'Mon')
    ORDER BY DATE_TRUNC('month', created_at) DESC
    LIMIT 6
  `);
  return r.rows.reverse();
}

export async function getViolationTrendByWeek() {
  const pool = getSharedPool();
  const r = await pool.query(`
    SELECT
      TO_CHAR(DATE_TRUNC('week', detected_at), 'Mon DD') AS period,
      COUNT(*) AS violations,
      COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
      COUNT(*) FILTER (WHERE status = 'compliant') AS resolved
    FROM compliance_violations
    GROUP BY DATE_TRUNC('week', detected_at)
    ORDER BY DATE_TRUNC('week', detected_at) DESC
    LIMIT 8
  `);
  return r.rows.reverse();
}

export async function getOrgRiskScores() {
  const pool = getSharedPool();
  const r = await pool.query(`
    SELECT name, risk_score, compliance_score, compliance_status, sector
    FROM organizations
    ORDER BY risk_score DESC
  `);
  return r.rows;
}

export async function reviewPortalSubmission(id: number, decision: "advance" | "reject" | "certify", notes: string, reviewerId: number) {
  const pool = getSharedPool();
  try {
    const phaseOrder = ["registration", "asset_inventory", "data_catalog", "self_assessment", "initial_audit", "remediation", "certified"];
    const sub = await pool.query(`SELECT * FROM portal_submissions WHERE id = $1`, [id]);
    if (!sub.rows[0]) throw new Error("Submission not found");
    const current = sub.rows[0].current_phase as string;
    let nextPhase = current;
    if (decision === "advance") {
      const idx = phaseOrder.indexOf(current);
      nextPhase = idx >= 0 && idx < phaseOrder.length - 1 ? phaseOrder[idx + 1] : current;
    } else if (decision === "certify") {
      nextPhase = "certified";
    } else if (decision === "reject") {
      nextPhase = "remediation";
    }
    const certifiedAt = decision === "certify" ? ", certified_at = NOW()" : "";
    await pool.query(
      `UPDATE portal_submissions SET current_phase = $1, notes = $2, assigned_auditor_id = $3, updated_at = NOW()${certifiedAt} WHERE id = $4`,
      [nextPhase, notes, reviewerId, id]
    );
    await pool.query(
      `UPDATE onboarding_phases SET status = 'completed', completed_at = NOW() WHERE submission_id = $1 AND phase = $2`,
      [id, current]
    );
    if (nextPhase !== current) {
      await pool.query(
        `UPDATE onboarding_phases SET status = 'in_progress', started_at = NOW() WHERE submission_id = $1 AND phase = $2`,
        [id, nextPhase]
      );
    }
    return { success: true, newPhase: nextPhase };
  } catch (e) { throw e; }
}

// ─── Penalty Appeals ──────────────────────────────────────────────────────────

export async function createPenaltyAppeal(input: {
  penaltyId: number;
  organizationId: number;
  submittedBy: string;
  contactEmail: string;
  groundsForAppeal: string;
  evidenceSummary?: string;
  requestedOutcome?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .insert(penaltyAppeals)
    .values({
      penaltyId: input.penaltyId,
      organizationId: input.organizationId,
      submittedBy: input.submittedBy,
      contactEmail: input.contactEmail,
      groundsForAppeal: input.groundsForAppeal,
      evidenceSummary: input.evidenceSummary ?? null,
      requestedOutcome: input.requestedOutcome ?? "reduction",
      status: "submitted",
    })
    .returning();
  return row;
}

export async function getPenaltyAppeals(orgId?: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const q = db
    .select()
    .from(penaltyAppeals)
    .orderBy(desc(penaltyAppeals.createdAt))
    .limit(limit);
  if (orgId) {
    return q.where(eq(penaltyAppeals.organizationId, orgId));
  }
  return q;
}

export async function reviewPenaltyAppeal(
  id: number,
  decision: "upheld" | "dismissed" | "under_review",
  reviewedBy: number,
  notes?: string
) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .update(penaltyAppeals)
    .set({
      status: decision,
      reviewedBy,
      reviewNotes: notes ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(penaltyAppeals.id, id))
    .returning();
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compliance Leaderboard
// ─────────────────────────────────────────────────────────────────────────────
export async function getLeaderboard(sector?: string, limit = 50, anonymise = false) {
  // Use live scores from monitoring_snapshots (written by compliance_rescorer every 4h)
  // Fall back to organizations.compliance_score if no snapshot exists
  const pool = getSharedPool();
  try {
    const sectorClause = sector ? `AND o.sector = $2` : "";
    const params: (string | number)[] = sector ? [limit, sector] : [limit];
    const result = await pool.query(
      `SELECT
         o.id,
         o.name,
         o.sector,
         o.country,
         o.risk_score AS "riskScore",
         o.agent_installed AS "agentInstalled",
         o.compliance_status AS "complianceStatus",
         COALESCE(
           (SELECT ms.score FROM monitoring_snapshots ms
            WHERE ms.organization_id = o.id AND ms.snapshot_type = 'compliance_score' AND ms.score IS NOT NULL
            ORDER BY ms.captured_at DESC LIMIT 1),
           o.compliance_score
         ) AS "complianceScore",
         (SELECT ms.captured_at FROM monitoring_snapshots ms
          WHERE ms.organization_id = o.id AND ms.snapshot_type = 'compliance_score'
          ORDER BY ms.captured_at DESC LIMIT 1) AS "lastRescored"
       FROM organizations o
       WHERE 1=1 ${sectorClause}
       ORDER BY "complianceScore" DESC NULLS LAST
       LIMIT $1`,
      params
    );
    return result.rows.map((r: Record<string, unknown>, idx: number) => ({
      rank: idx + 1,
      id: Number(r.id),
      name: anonymise
        ? `Organisation ${String.fromCharCode(65 + (idx % 26))}${Math.floor(idx / 26) || ""}`
        : String(r.name),
      sector: String(r.sector ?? "Unknown"),
      country: String(r.country ?? "Nigeria"),
      complianceScore: Number(r.complianceScore ?? 0),
      complianceStatus: String(r.complianceStatus ?? "under_review"),
      riskScore: Number(r.riskScore ?? 50),
      agentInstalled: Boolean(r.agentInstalled ?? false),
      certified: Number(r.complianceScore ?? 0) >= 85,
      lastRescored: r.lastRescored ? String(r.lastRescored) : null,
    }));
  } finally {
    // pool is shared — no pool.end()
  }
}

export async function getLeaderboardStats(sector?: string) {
  const db = await getDb();
  if (!db) return { total: 0, certified: 0, avgScore: 0, sectors: [] as string[] };
  const rows = await db
    .select({ sector: organizations.sector, complianceScore: organizations.complianceScore })
    .from(organizations)
    .where(sector ? eq(organizations.sector, sector) : undefined);
  const total = rows.length;
  const certified = rows.filter(r => (r.complianceScore ?? 0) >= 85).length;
  const avg = total > 0 ? rows.reduce((s, r) => s + (r.complianceScore ?? 0), 0) / total : 0;
  const sectors = Array.from(new Set(rows.map(r => r.sector).filter(Boolean))) as string[];
  return { total, certified, avgScore: Math.round(avg * 10) / 10, sectors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Certificate Verification
// ─────────────────────────────────────────────────────────────────────────────
export async function getPortalSubmissionByCertToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(portalSubmissions)
    .where(eq(portalSubmissions.submissionToken, token))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPortalSubmissionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(portalSubmissions)
    .where(eq(portalSubmissions.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// ── Leaderboard: 30-day score trend per org ────────────────────────────────
export async function getOrgScoreTrend(orgId: number): Promise<{ day: string; score: number }[]> {
  const db = await getDb();
  if (!db) return [];
  // Use compliance_violations to infer daily score changes over 30 days
  // Score = 100 - (violations that day * 2), clamped to 0-100
  const rows = await db.select({
    day: sql<string>`to_char(${complianceViolations.detectedAt}, 'YYYY-MM-DD')`,
    violations: sql<number>`count(*)`,
  }).from(complianceViolations)
    .where(and(
      eq(complianceViolations.organizationId, orgId),
      gte(complianceViolations.detectedAt, sql`NOW() - INTERVAL '30 days'`),
    ))
    .groupBy(sql`to_char(${complianceViolations.detectedAt}, 'YYYY-MM-DD')`);
  const violationMap = new Map<string, number>();
  for (const r of rows) {
    violationMap.set(String(r.day), Number(r.violations));
  }
  // Build 30-day series
  const result: { day: string; score: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = d.toISOString().slice(0, 10);
    const v = violationMap.get(day) ?? 0;
    result.push({ day, score: Math.max(0, Math.min(100, 100 - v * 2)) });
  }
  return result;
}

// ─── Sector Benchmark Trend ──────────────────────────────────────────────────
export async function getSectorAvgTrend(sector: string): Promise<{ date: string; avgScore: number }[]> {
  const db = await getDb();
  if (!db) return [];

  const pool = getPool();
  if (!pool) return [];

  // Query real historical snapshots joined with organizations in this sector
  const { rows } = await pool.query(
    `SELECT s.snapshot_date::date AS snap_date,
            ROUND(AVG(s.overall_score))::int AS avg_score
     FROM ndpa_compliance_snapshots s
     JOIN organizations o ON o.id = s.organization_id
     WHERE o.sector = $1
       AND s.snapshot_date > NOW() - INTERVAL '30 days'
     GROUP BY s.snapshot_date::date
     ORDER BY snap_date ASC`,
    [sector]
  );

  if (rows.length > 0) {
    return rows.map((r: { snap_date: Date; avg_score: number }) => ({
      date: new Date(r.snap_date).toISOString().slice(0, 10),
      avgScore: Number(r.avg_score),
    }));
  }

  // Fallback: if no historical snapshots exist yet, use current scores as a single data point
  const orgs = await db.select({ complianceScore: organizations.complianceScore })
    .from(organizations)
    .where(and(eq(organizations.sector, sector), isNotNull(organizations.complianceScore)));

  if (orgs.length === 0) return [];

  const avg = Math.round(orgs.reduce((s, o) => s + (o.complianceScore ?? 0), 0) / orgs.length);
  return [{ date: new Date().toISOString().slice(0, 10), avgScore: avg }];
}

// ─── Penalty Receipt ─────────────────────────────────────────────────────────
export async function getPenaltyReceipt(penaltyId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({
    id: financialPenalties.id,
    amount: financialPenalties.amount,
    currency: financialPenalties.currency,
    paymentStatus: financialPenalties.paymentStatus,
    tigerBeetleTransferId: financialPenalties.tigerBeetleTransferId,
    mojaloopTransferId: financialPenalties.mojaloopTransferId,
    dueDate: financialPenalties.dueDate,
    paidAt: financialPenalties.paidAt,
    description: financialPenalties.description,
    createdAt: financialPenalties.createdAt,
    orgName: organizations.name,
    orgSector: organizations.sector,
    orgCountry: organizations.country,
  })
  .from(financialPenalties)
  .leftJoin(organizations, eq(financialPenalties.organizationId, organizations.id))
  .where(eq(financialPenalties.id, penaltyId))
  .limit(1);
  return rows[0] ?? null;
}

// ─── Regulatory Reports ───────────────────────────────────────────────────────
export async function getViolationsReport(opts: {
  fromDate?: Date;
  toDate?: Date;
  sector?: string;
  severity?: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (opts.fromDate) conditions.push(gte(complianceViolations.detectedAt, opts.fromDate));
  if (opts.toDate) conditions.push(lte(complianceViolations.detectedAt, opts.toDate));
  if (opts.severity) conditions.push(eq(complianceViolations.severity, opts.severity as "low" | "medium" | "high" | "critical"));

  const rows = await db
    .select({
      id: complianceViolations.id,
      orgId: complianceViolations.organizationId,
      orgName: organizations.name,
      orgSector: organizations.sector,
      title: complianceViolations.title,
      severity: complianceViolations.severity,
      status: complianceViolations.status,
      enforcementStatus: complianceViolations.enforcementStatus,
      penaltyAmount: complianceViolations.penaltyAmount,
      detectedAt: complianceViolations.detectedAt,
      resolvedAt: complianceViolations.resolvedAt,
    })
    .from(complianceViolations)
    .leftJoin(organizations, eq(complianceViolations.organizationId, organizations.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(complianceViolations.detectedAt))
    .limit(opts.limit ?? 1000);

  // Filter by sector in JS (since sector is on org not violation)
  if (opts.sector) return rows.filter(r => r.orgSector === opts.sector);
  return rows;
}

export async function getPenaltiesReport(opts: {
  fromDate?: Date;
  toDate?: Date;
  sector?: string;
  paymentStatus?: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (opts.fromDate) conditions.push(gte(financialPenalties.createdAt, opts.fromDate));
  if (opts.toDate) conditions.push(lte(financialPenalties.createdAt, opts.toDate));
  if (opts.paymentStatus) conditions.push(eq(financialPenalties.paymentStatus, opts.paymentStatus as "pending" | "processing" | "completed" | "failed" | "overdue"));

  const rows = await db
    .select({
      id: financialPenalties.id,
      orgId: financialPenalties.organizationId,
      orgName: organizations.name,
      orgSector: organizations.sector,
      amount: financialPenalties.amount,
      currency: financialPenalties.currency,
      paymentStatus: financialPenalties.paymentStatus,
      description: financialPenalties.description,
      dueDate: financialPenalties.dueDate,
      paidAt: financialPenalties.paidAt,
      createdAt: financialPenalties.createdAt,
    })
    .from(financialPenalties)
    .leftJoin(organizations, eq(financialPenalties.organizationId, organizations.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(financialPenalties.createdAt))
    .limit(opts.limit ?? 1000);

  if (opts.sector) return rows.filter(r => r.orgSector === opts.sector);
  return rows;
}

export async function getComplianceScoresReport(opts: { sector?: string; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      sector: organizations.sector,
      country: organizations.country,
      complianceScore: organizations.complianceScore,
      riskScore: organizations.riskScore,
      complianceStatus: organizations.complianceStatus,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .where(opts.sector ? eq(organizations.sector, opts.sector) : undefined)
    .orderBy(desc(organizations.complianceScore))
    .limit(opts.limit ?? 1000);
  return rows;
}

// ── SIEM Mutations ────────────────────────────────────────────────────────────

export async function resolveSecurityAlert(alertId: number, resolvedBy: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(securityAlerts)
    .set({ isResolved: true, resolvedAt: new Date(), resolvedBy })
    .where(eq(securityAlerts.id, alertId));
  return { success: true };
}

// ── Organization Mutations ────────────────────────────────────────────────────

export async function createOrganization(data: {
  name: string;
  sector?: string;
  country?: string;
  city?: string;
  registrationNumber?: string;
  contactEmail?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [org] = await db.insert(organizations).values({
    name: data.name,
    sector: data.sector,
    country: data.country,
    city: data.city,
    registrationNumber: data.registrationNumber,
    contactEmail: data.contactEmail,
  }).returning();
  return org;
}

export async function updateOrganization(id: number, data: {
  name?: string;
  sector?: string;
  country?: string;
  city?: string;
  complianceStatus?: "compliant" | "non_compliant" | "under_review" | "remediation";
  contactEmail?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [org] = await db.update(organizations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(organizations.id, id))
    .returning();
  return org;
}

export async function deleteOrganization(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(organizations).where(eq(organizations.id, id));
  return { success: true };
}

// ── Asset Mutations ───────────────────────────────────────────────────────────

export async function createAsset(data: {
  organizationId: number;
  name: string;
  assetType: "hardware" | "software" | "cloud" | "network" | "database" | "saas";
  ipAddress?: string;
  hostname?: string;
  location?: string;
  isWithinBorders?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [asset] = await db.insert(assets).values({
    organizationId: data.organizationId,
    name: data.name,
    assetType: data.assetType,
    ipAddress: data.ipAddress,
    hostname: data.hostname,
    location: data.location,
    isWithinBorders: data.isWithinBorders ?? true,
  }).returning();
  return asset;
}

export async function updateAsset(id: number, data: {
  name?: string;
  status?: "active" | "inactive" | "quarantined" | "decommissioned";
  isWithinBorders?: boolean;
  location?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [asset] = await db.update(assets)
    .set(data)
    .where(eq(assets.id, id))
    .returning();
  return asset;
}

export async function deleteAsset(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(assets).where(eq(assets.id, id));
  return { success: true };
}

// ── Data Catalog Mutations ────────────────────────────────────────────────────

export async function createCatalogEntry(data: {
  organizationId: number;
  name: string;
  description?: string;
  dataType?: string;
  classification?: "tier1_pii" | "tier2_financial" | "tier3_health" | "tier4_government" | "tier5_public";
  storageLocation?: string;
  isWithinBorders?: boolean;
  rowCount?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [entry] = await db.insert(dataCatalogEntries).values({
    organizationId: data.organizationId,
    name: data.name,
    description: data.description,
    dataType: data.dataType,
    classification: data.classification,
    storageLocation: data.storageLocation,
    isWithinBorders: data.isWithinBorders ?? true,
    rowCount: data.rowCount,
  }).returning();
  return entry;
}

export async function updateCatalogEntry(id: number, data: {
  name?: string;
  description?: string;
  storageLocation?: string;
  isWithinBorders?: boolean;
  qualityScore?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [entry] = await db.update(dataCatalogEntries)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(dataCatalogEntries.id, id))
    .returning();
  return entry;
}

export async function deleteCatalogEntry(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(dataCatalogEntries).where(eq(dataCatalogEntries.id, id));
  return { success: true };
}

// ── Audit Log Write ────────────────────────────────────────────────────────────
export async function createAuditLog(entry: {
  userId?: number;
  organizationId?: number;
  action: string;
  resourceType?: string;
  resourceId?: number;
  details?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const db = await getDb();
    if (!db) return null;
    const [log] = await db.insert(auditLogs).values({
      userId: entry.userId ?? null,
      organizationId: entry.organizationId ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      details: entry.details ?? null,
      ipAddress: entry.ipAddress ?? null,
      metadata: entry.metadata ?? null,
    }).returning();
    return log;
  } catch {
    // Audit log failures must never break the main operation
    return null;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 Feature DB Functions (BigID + Azure Arc inspired)
// ─────────────────────────────────────────────────────────────────────────────

// Policy Templates
export async function listPolicyTemplates(framework?: "NDPR" | "GDPR" | "PIPL" | "DPDP" | "HIPAA" | "SOC2" | "ISO27001" | "DOJ_EO_14117" | "CUSTOM", status?: "draft" | "active" | "deprecated") {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (framework) conditions.push(eq(policyTemplates.framework, framework));
  if (status) conditions.push(eq(policyTemplates.status, status));
  return db.select().from(policyTemplates)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(policyTemplates.createdAt));
}

export async function createPolicyTemplate(data: {
  name: string; framework: "NDPR" | "GDPR" | "PIPL" | "DPDP" | "HIPAA" | "SOC2" | "ISO27001" | "DOJ_EO_14117" | "CUSTOM"; description?: string;
  policyDefinition: string; version?: string; createdBy?: number;
}) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(policyTemplates).values({
    name: data.name,
    framework: data.framework,
    description: data.description,
    policyDefinition: data.policyDefinition,
    version: data.version || "1.0",
    status: "draft",
    createdBy: data.createdBy,
  }).returning();
  return row;
}

export async function instantiatePolicyTemplate(templateId: number, orgId: number) {
  const db = await getDb();
  if (!db) return null;
  const [tmpl] = await db.select().from(policyTemplates).where(eq(policyTemplates.id, templateId));
  if (!tmpl) return null;
  const [policy] = await db.insert(compliancePolicies).values({
    name: String(tmpl.name) + " (from template)",
    description: String(tmpl.description || ""),
    category: "data_sovereignty",
    opaRule: String(tmpl.policyDefinition || ""),
    severity: "high",
    isActive: true,
    createdBy: orgId,
  }).returning();
  await db.update(policyTemplates)
    .set({ instantiatedCount: sql`${policyTemplates.instantiatedCount} + 1` })
    .where(eq(policyTemplates.id, templateId));
  return policy;
}

// AI Systems
export async function listAiSystems(orgId?: number, riskLevel?: "minimal" | "limited" | "high" | "unacceptable") {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (orgId) conditions.push(eq(aiSystems.organizationId, orgId));
  if (riskLevel) conditions.push(eq(aiSystems.riskLevel, riskLevel));
  return db.select().from(aiSystems)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(aiSystems.registeredAt));
}

export async function createAiSystem(data: {
  organizationId: number; name: string; purpose?: string;
  vendor?: string; version?: string; personalDataProcessed?: boolean;
}) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(aiSystems).values({
    organizationId: data.organizationId,
    name: data.name,
    purpose: data.purpose,
    vendor: data.vendor,
    version: data.version,
    personalDataProcessed: data.personalDataProcessed || false,
    status: "registered",
    riskLevel: "limited",
  }).returning();
  return row;
}

export async function updateAiSystem(id: number, data: Partial<{ status: "registered" | "under_review" | "approved" | "suspended" | "decommissioned"; riskLevel: "minimal" | "limited" | "high" | "unacceptable"; auditNotes: string; nextAuditDue: Date }>) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(aiSystems).set({ ...data, updatedAt: new Date() }).where(eq(aiSystems.id, id)).returning();
  return row;
}

// Evidence Packages
export async function listEvidencePackages(orgId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (orgId) conditions.push(eq(evidencePackages.organizationId, orgId));
  return db.select().from(evidencePackages)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(evidencePackages.createdAt));
}

export async function createEvidencePackage(data: {
  organizationId?: number; packageType: string; referenceId?: number; referenceType?: string;
  contentHash: string; hmacSignature: string; generatedBy?: number; fileUrl?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  const [row] = await db.insert(evidencePackages).values({
    organizationId: data.organizationId,
    packageType: data.packageType,
    referenceId: data.referenceId,
    referenceType: data.referenceType,
    contentHash: data.contentHash,
    hmacSignature: data.hmacSignature,
    status: "ready",
    generatedBy: data.generatedBy,
    fileUrl: data.fileUrl,
    expiresAt,
  }).returning();
  return row;
}

// Sectors
export async function listSectors(parentId?: number | null) {
  const db = await getDb();
  if (!db) return [];
  if (parentId === null) {
    return db.select().from(sectors).where(sql`${sectors.parentId} IS NULL`).orderBy(sectors.name);
  }
  if (parentId !== undefined) {
    return db.select().from(sectors).where(eq(sectors.parentId, parentId)).orderBy(sectors.name);
  }
  return db.select().from(sectors).orderBy(sectors.name);
}

export async function createSector(data: { name: string; code: string; description?: string; parentId?: number; regulatoryFramework?: string }) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(sectors).values({
    name: data.name,
    code: data.code,
    description: data.description,
    parentId: data.parentId,
    regulatoryFramework: data.regulatoryFramework,
  }).returning();
  return row;
}

export async function updateSector(id: number, data: { name?: string; code?: string; description?: string; regulatoryFramework?: string }) {
  const db = await getDb();
  if (!db) return null;
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.code !== undefined) updateData.code = data.code;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.regulatoryFramework !== undefined) updateData.regulatoryFramework = data.regulatoryFramework;
  if (Object.keys(updateData).length === 0) return null;
  const [row] = await db.update(sectors).set(updateData).where(eq(sectors.id, id)).returning();
  return row;
}

export async function getSectorStats() {
  const db = await getDb();
  if (!db) return { total: 0, topLevel: 0 };
  const [total] = await db.select({ count: sql<number>`count(*)` }).from(sectors);
  const [topLevel] = await db.select({ count: sql<number>`count(*)` }).from(sectors).where(sql`${sectors.parentId} IS NULL`);
  return { total: Number(total.count), topLevel: Number(topLevel.count) };
}

// Citizen Requests
export async function listCitizenRequests(status?: "submitted" | "acknowledged" | "in_progress" | "completed" | "rejected" | "escalated", requestType?: "access" | "erasure" | "portability" | "rectification" | "restriction" | "objection") {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (status) conditions.push(eq(citizenRequests.status, status));
  if (requestType) conditions.push(eq(citizenRequests.requestType, requestType));
  return db.select().from(citizenRequests)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(citizenRequests.submittedAt));
}

export async function createCitizenRequest(data: {
  requestType: "access" | "erasure" | "portability" | "rectification" | "restriction" | "objection"; citizenName: string; citizenEmail: string;
  citizenNin?: string; organizationId?: number; description: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const [row] = await db.insert(citizenRequests).values({
    requestType: data.requestType,
    citizenName: data.citizenName,
    citizenEmail: data.citizenEmail,
    citizenNin: data.citizenNin,
    organizationId: data.organizationId,
    description: data.description,
    status: "submitted",
    dueDate,
  }).returning();
  return row;
}

export async function updateCitizenRequest(id: number, data: { status: "submitted" | "acknowledged" | "in_progress" | "completed" | "rejected" | "escalated"; responseNotes?: string }) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(citizenRequests).set({
    status: data.status,
    responseNotes: data.responseNotes,
    completedAt: data.status === 'completed' ? new Date() : undefined,
    updatedAt: new Date(),
  }).where(eq(citizenRequests.id, id)).returning();
  return row;
}

// Config Snapshots
export async function listConfigSnapshots(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(configSnapshots).orderBy(desc(configSnapshots.createdAt)).limit(limit);
}

export async function createConfigSnapshot(data: {
  snapshotName: string; source: "manual" | "git" | "api"; configData: string;
  status: "synced" | "drifted" | "pending" | "failed"; driftSummary?: string; commitHash?: string; createdBy?: number;
}) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(configSnapshots).values({
    snapshotName: data.snapshotName,
    source: data.source,
    configData: data.configData,
    status: data.status,
    driftSummary: data.driftSummary,
    commitHash: data.commitHash,
    createdBy: data.createdBy,
  }).returning();
  return row;
}

// TIA Assessments
export async function listTiaAssessments(orgId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (orgId) conditions.push(eq(tiaAssessments.organizationId, orgId));
  return db.select().from(tiaAssessments)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(tiaAssessments.createdAt));
}

export async function createTiaAssessment(data: {
  organizationId: number; transferApprovalId?: number; destinationCountry: string;
  dataCategories: string[]; legalBasis: string; riskLevel: "low" | "medium" | "high" | "critical";
  tiaDocument?: string; safeguards?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(tiaAssessments).values({
    organizationId: data.organizationId,
    transferApprovalId: data.transferApprovalId,
    destinationCountry: data.destinationCountry,
    dataCategories: data.dataCategories,
    legalBasis: data.legalBasis,
    riskLevel: data.riskLevel,
    tiaDocument: data.tiaDocument,
    safeguards: data.safeguards,
    status: "draft",
  }).returning();
  return row;
}

// Remediation Workflows
export async function createRemediationWorkflow(data: {
  violationId?: number; orgId: number; actionType: string; priority?: string;
  description?: string; assignedTo?: number; deadline?: Date;
}) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(remediationWorkflows).values({
    violationId: data.violationId,
    orgId: data.orgId,
    actionType: data.actionType,
    priority: data.priority ?? "medium",
    description: data.description,
    assignedTo: data.assignedTo,
    deadline: data.deadline,
    status: "pending",
  }).returning();
  return row;
}

export async function listRemediationWorkflows(orgId?: number, status?: "pending" | "in_progress" | "completed" | "overdue" | "cancelled") {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (orgId) conditions.push(eq(remediationWorkflows.orgId, orgId));
  if (status) conditions.push(eq(remediationWorkflows.status, status));
  return db.select().from(remediationWorkflows)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(remediationWorkflows.createdAt));
}

export async function updateRemediationWorkflow(id: number, data: { status: "pending" | "in_progress" | "completed" | "overdue" | "cancelled"; notes?: string }) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.update(remediationWorkflows).set({
    status: data.status,
    notes: data.notes,
    completedAt: data.status === 'completed' ? new Date() : undefined,
    updatedAt: new Date(),
  }).where(eq(remediationWorkflows.id, id)).returning();
  return row;
}

// Block Network IP (for NetworkDPI page)
export async function blockNetworkIp(orgId: number, ipAddress: string, reason: string, blockedBy: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(networkEvents).values({
    organizationId: orgId,
    sourceIp: ipAddress,
    destinationIp: "0.0.0.0",
    protocol: "TCP",
    bytesTransferred: 0,
    eventType: "policy_violation",
    isCrossBorder: false,
    isBlocked: true,
    metadata: { reason, blocked_by: blockedBy, original_ip: ipAddress },
  }).returning();
  return row;
}

// Report BGP Hijack (for BgpRoutes page)
export async function reportBgpHijack(orgId: number, prefix: string, asn: string, notes: string, reportedBy: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.insert(securityAlerts).values({
    organizationId: orgId,
    alertType: "bgp_hijack",
    severity: "critical",
    title: `BGP Hijack Reported: ${prefix}`,
    description: `Prefix ${prefix} (ASN ${asn}) reported as hijacked. Notes: ${notes}`,
    isResolved: false,
    source: "manual",
    metadata: { prefix, asn, reported_by: reportedBy, notes },
  }).returning();
  return row;
}

export async function updateTiaAssessment(id: number, data: {
  status?: "draft" | "submitted" | "approved" | "rejected"; reviewedBy?: number; tiaDocument?: string; safeguards?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const updateData: { updatedAt: Date; status?: "draft" | "submitted" | "approved" | "rejected"; reviewedBy?: number; tiaDocument?: string; safeguards?: string } = { updatedAt: new Date() };
  if (data.status) updateData.status = data.status;
  if (data.reviewedBy) updateData.reviewedBy = data.reviewedBy;
  if (data.tiaDocument !== undefined) updateData.tiaDocument = data.tiaDocument;
  if (data.safeguards !== undefined) updateData.safeguards = data.safeguards;
  const [row] = await db.update(tiaAssessments).set(updateData).where(eq(tiaAssessments.id, id)).returning();
  return row;
}

export async function deleteSector(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(sectors).where(eq(sectors.id, id));
  return { success: true };
}

export async function deleteCompliancePolicy(id: number) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  await db.delete(compliancePolicies).where(eq(compliancePolicies.id, id));
  return { success: true };
}

export async function createSecurityAlert(data: { organizationId: number; severity: "critical" | "high" | "medium" | "low" | "info"; alertType: string; title: string; description?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const [row] = await db.insert(securityAlerts).values({
    organizationId: data.organizationId,
    severity: data.severity,
    alertType: data.alertType,
    title: data.title,
    description: data.description ?? null,
    isResolved: false,
  }).returning();
  return row;
}

// ─── Compliance Violation CRUD ────────────────────────────────────────────────
export async function createComplianceViolation(data: {
  organizationId: number;
  policyId?: number;
  assetId?: number;
  title: string;
  description?: string;
  severity?: "low" | "medium" | "high" | "critical";
}) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(complianceViolations).values({
    organizationId: data.organizationId,
    policyId: data.policyId ?? null,
    assetId: data.assetId ?? null,
    title: data.title,
    description: data.description ?? null,
    severity: data.severity ?? "medium",
    status: "non_compliant",
    enforcementStatus: "pending",
  }).returning();
  return result[0];
}

export async function resolveComplianceViolation(id: number, notes?: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.update(complianceViolations)
    .set({ status: "compliant", resolvedAt: new Date() })
    .where(eq(complianceViolations.id, id))
    .returning();
  return result[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// BGP Route History (24h time-series for chart)
// ─────────────────────────────────────────────────────────────────────────────
export async function getBgpRouteHistory() {
  const pool = getSharedPool();
  const result = await pool.query(`
    SELECT
      date_trunc('hour', detected_at) AS hour,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE is_hijacked = TRUE) AS hijacked,
      COUNT(*) FILTER (WHERE is_leaked = TRUE) AS leaked,
      COUNT(*) FILTER (WHERE is_cross_border = TRUE) AS cross_border
    FROM bgp_routes
    WHERE detected_at > NOW() - INTERVAL '24 hours'
    GROUP BY hour
    ORDER BY hour ASC
  `);
  return result.rows.map(r => ({
    hour: r.hour,
    total: Number(r.total),
    hijacked: Number(r.hijacked),
    leaked: Number(r.leaked),
    crossBorder: Number(r.cross_border),
  }));
}

// ─── Enforcement Cases ────────────────────────────────────────────────────────

export async function getEnforcementCases(limit = 50, organizationId?: number) {
  const pool = getSharedPool();
  const params: unknown[] = [limit];
  const orgFilter = organizationId ? `AND ec.organization_id = $2` : "";
  if (organizationId) params.push(organizationId);
  const result = await pool.query(
    `SELECT ec.*, fp.amount, fp.currency, fp.description AS penalty_description,
            fp.due_date, fp.payment_status,
            o.name AS org_name, o.contact_email,
            u.name AS officer_name
     FROM enforcement_cases ec
     JOIN financial_penalties fp ON ec.penalty_id = fp.id
     JOIN organizations o ON ec.organization_id = o.id
     LEFT JOIN users u ON ec.assigned_officer_id = u.id
     WHERE 1=1 ${orgFilter}
     ORDER BY ec.opened_at DESC
     LIMIT $1`,
    params
  );
  return result.rows;
}

export async function createEnforcementCase(input: {
  penaltyId: number;
  organizationId: number;
  escalationReason?: string;
  assignedOfficerId?: number;
}) {
  const pool = getSharedPool();
  const caseRef = `NDSEP-ENF-${new Date().getFullYear()}-${String(input.penaltyId).padStart(6, "0")}`;
  const result = await pool.query(
    `INSERT INTO enforcement_cases
       (penalty_id, organization_id, case_reference, escalation_reason, assigned_officer_id, overdue_days)
     VALUES ($1, $2, $3, $4, $5,
       GREATEST(0, EXTRACT(DAY FROM NOW() - (SELECT due_date FROM financial_penalties WHERE id = $1))::int))
     ON CONFLICT (case_reference) DO UPDATE SET
       escalation_reason = COALESCE(EXCLUDED.escalation_reason, enforcement_cases.escalation_reason),
       updated_at = NOW()
     RETURNING *`,
    [input.penaltyId, input.organizationId, caseRef, input.escalationReason ?? null, input.assignedOfficerId ?? null]
  );
  return result.rows[0];
}

export async function updateEnforcementCase(input: {
  id: number;
  status?: string;
  nitdaReferenceNumber?: string;
  resolutionNotes?: string;
  assignedOfficerId?: number;
}) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [input.id];
  let i = 2;
  if (input.status) { sets.push(`status = $${i++}::enforcement_case_status`); params.push(input.status); }
  if (input.status === "escalated_to_nitda") { sets.push(`escalated_at = NOW()`); }
  if (input.status === "closed" || input.status === "settled") { sets.push(`closed_at = NOW()`); }
  if (input.nitdaReferenceNumber) { sets.push(`nitda_reference_number = $${i++}`); params.push(input.nitdaReferenceNumber); }
  if (input.resolutionNotes) { sets.push(`resolution_notes = $${i++}`); params.push(input.resolutionNotes); }
  if (input.assignedOfficerId) { sets.push(`assigned_officer_id = $${i++}`); params.push(input.assignedOfficerId); }
  const result = await pool.query(
    `UPDATE enforcement_cases SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
    params
  );
  return result.rows[0];
}

// ─── Certificate Expiry ───────────────────────────────────────────────────────

export async function getExpiringCertificates(withinDays = 90) {
  const pool = getSharedPool();
  const result = await pool.query(
    `SELECT id, org_name, org_sector, contact_email, certified_at,
            (certified_at + INTERVAL '365 days') AS expires_at,
            EXTRACT(DAY FROM (certified_at + INTERVAL '365 days') - NOW())::int AS days_remaining,
            compliance_score
     FROM portal_submissions
     WHERE current_phase = 'certified'
       AND certified_at IS NOT NULL
       AND (certified_at + INTERVAL '365 days') > NOW()
       AND (certified_at + INTERVAL '365 days') < NOW() + ($1 || ' days')::INTERVAL
     ORDER BY certified_at ASC`,
    [withinDays]
  );
  return result.rows;
}

export async function getHijackedBgpRoutes(limit = 5) {
  const pool = getSharedPool();
  const result = await pool.query(
    `SELECT id, prefix, origin_asn, as_path, rpki_status, is_hijacked, is_leaked,
            is_cross_border, ixp_site, detected_at
     FROM bgp_routes
     WHERE (is_hijacked = TRUE OR rpki_status = 'invalid')
     ORDER BY detected_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// ─── Case Timeline helpers ────────────────────────────────────────────────────

export async function getCaseTimeline(caseId: number) {
  const pool = getSharedPool();
  const result = await pool.query(
    `SELECT ct.*, u.name AS user_name
     FROM case_timeline ct
     LEFT JOIN users u ON u.id = ct.changed_by_user_id
     WHERE ct.case_id = $1
     ORDER BY ct.created_at ASC`,
    [caseId]
  );
  return result.rows;
}

export async function addCaseTimelineEntry(entry: {
  caseId: number;
  changedByUserId?: number | null;
  changedByName?: string | null;
  fromStatus?: string | null;
  toStatus: string;
  note?: string | null;
  nitdaRef?: string | null;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO case_timeline (case_id, changed_by_user_id, changed_by_name, from_status, to_status, note, nitda_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [entry.caseId, entry.changedByUserId ?? null, entry.changedByName ?? null,
     entry.fromStatus ?? null, entry.toStatus, entry.note ?? null, entry.nitdaRef ?? null]
  );
  return result.rows[0];
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAP CLOSURE: CRUD functions for 18 new NDPA/GAID compliance tables
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Gap 1: Consent Management ───────────────────────────────────────────────

export async function listConsentRecords(orgId?: number, status?: string, limit = 100) {
  const pool = getSharedPool();
  let q = `SELECT cr.*, o.name AS org_name FROM consent_records cr LEFT JOIN organizations o ON o.id = cr.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND cr.organization_id = $${params.length}`; }
  if (status) { params.push(status); q += ` AND cr.consent_status = $${params.length}`; }
  params.push(limit); q += ` ORDER BY cr.created_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createConsentRecord(data: {
  organizationId: number; dataSubjectName: string; dataSubjectEmail: string;
  dataSubjectNin?: string; purpose: string; lawfulBasis: string;
  dataCategories?: string[]; processingActivities?: string[];
  thirdPartySharing?: boolean; crossBorderTransfer?: boolean; evidenceRef?: string;
  expiresAt?: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO consent_records (organization_id, data_subject_name, data_subject_email, data_subject_nin,
      purpose, lawful_basis, data_categories, processing_activities, third_party_sharing,
      cross_border_transfer, evidence_ref, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [data.organizationId, data.dataSubjectName, data.dataSubjectEmail, data.dataSubjectNin ?? null,
     data.purpose, data.lawfulBasis, JSON.stringify(data.dataCategories ?? []),
     JSON.stringify(data.processingActivities ?? []), data.thirdPartySharing ?? false,
     data.crossBorderTransfer ?? false, data.evidenceRef ?? null,
     data.expiresAt ? new Date(data.expiresAt) : null]
  );
  return result.rows[0];
}

export async function updateConsentRecord(id: number, data: { consentStatus?: string; consentWithdrawnAt?: Date }) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.consentStatus) { params.push(data.consentStatus); sets.push(`consent_status = $${params.length}`); }
  if (data.consentWithdrawnAt) { params.push(data.consentWithdrawnAt); sets.push(`consent_withdrawn_at = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE consent_records SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

export async function getConsentStats(orgId?: number) {
  const pool = getSharedPool();
  const where = orgId ? `WHERE organization_id = $1` : ``;
  const params = orgId ? [orgId] : [];
  const result = await pool.query(
    `SELECT consent_status, COUNT(*)::int AS count FROM consent_records ${where} GROUP BY consent_status`, params
  );
  return result.rows;
}

// ─── Gap 2: Data Breach Notification ─────────────────────────────────────────

export async function listBreachIncidents(orgId?: number, status?: string, limit = 50) {
  const pool = getSharedPool();
  let q = `SELECT bi.*, o.name AS org_name FROM breach_incidents bi LEFT JOIN organizations o ON o.id = bi.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND bi.organization_id = $${params.length}`; }
  if (status) { params.push(status); q += ` AND bi.breach_incident_status = $${params.length}`; }
  params.push(limit); q += ` ORDER BY bi.detected_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createBreachIncident(data: {
  organizationId: number; title: string; description?: string;
  severity?: string; dataTypesAffected?: string[]; breachCause?: string;
  affectedIndividualsCount?: number; reportedBy?: number; assignedTo?: number;
  securityAlertId?: number;
}) {
  const pool = getSharedPool();
  const deadline = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours from now
  const result = await pool.query(
    `INSERT INTO breach_incidents (organization_id, title, description, breach_incident_severity,
      ndpc_notification_deadline, data_types_affected, breach_cause,
      affected_individuals_count, reported_by, assigned_to, security_alert_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [data.organizationId, data.title, data.description ?? null,
     data.severity ?? "medium", deadline,
     JSON.stringify(data.dataTypesAffected ?? []), data.breachCause ?? null,
     data.affectedIndividualsCount ?? 0, data.reportedBy ?? null,
     data.assignedTo ?? null, data.securityAlertId ?? null]
  );
  return result.rows[0];
}

export async function updateBreachIncident(id: number, data: {
  status?: string; ndpcNotifiedAt?: Date; individualsNotifiedAt?: Date;
  containedAt?: Date; resolvedAt?: Date; ndpcReferenceNumber?: string;
  remediationActions?: string; affectedIndividualsCount?: number;
}) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.status) { params.push(data.status); sets.push(`breach_incident_status = $${params.length}`); }
  if (data.ndpcNotifiedAt) { params.push(data.ndpcNotifiedAt); sets.push(`ndpc_notified_at = $${params.length}`); }
  if (data.individualsNotifiedAt) { params.push(data.individualsNotifiedAt); sets.push(`individuals_notified_at = $${params.length}`); }
  if (data.containedAt) { params.push(data.containedAt); sets.push(`contained_at = $${params.length}`); }
  if (data.resolvedAt) { params.push(data.resolvedAt); sets.push(`resolved_at = $${params.length}`); }
  if (data.ndpcReferenceNumber) { params.push(data.ndpcReferenceNumber); sets.push(`ndpc_reference_number = $${params.length}`); }
  if (data.remediationActions) { params.push(data.remediationActions); sets.push(`remediation_actions = $${params.length}`); }
  if (data.affectedIndividualsCount !== undefined) { params.push(data.affectedIndividualsCount); sets.push(`affected_individuals_count = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE breach_incidents SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 3: DPO Registry ─────────────────────────────────────────────────────

export async function listDpoAppointments(orgId?: number, limit = 100) {
  const pool = getSharedPool();
  let q = `SELECT d.*, o.name AS org_name FROM dpo_appointments d LEFT JOIN organizations o ON o.id = d.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND d.organization_id = $${params.length}`; }
  params.push(limit); q += ` ORDER BY d.created_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createDpoAppointment(data: {
  organizationId: number; dpoName: string; dpoEmail: string; dpoPhone?: string;
  dpcoId?: string; dpcoName?: string; certificationExpiresAt?: string; notes?: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO dpo_appointments (organization_id, dpo_name, dpo_email, dpo_phone, dpco_id, dpco_name, certification_expires_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [data.organizationId, data.dpoName, data.dpoEmail, data.dpoPhone ?? null,
     data.dpcoId ?? null, data.dpcoName ?? null,
     data.certificationExpiresAt ? new Date(data.certificationExpiresAt) : null, data.notes ?? null]
  );
  return result.rows[0];
}

export async function updateDpoAppointment(id: number, data: {
  credentialStatus?: string; independenceVerified?: boolean;
  trainingHoursCompleted?: number; lastReportSubmittedAt?: Date; isActive?: boolean; notes?: string;
}) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.credentialStatus) { params.push(data.credentialStatus); sets.push(`credential_status = $${params.length}`); }
  if (data.independenceVerified !== undefined) { params.push(data.independenceVerified); sets.push(`independence_verified = $${params.length}`); }
  if (data.trainingHoursCompleted !== undefined) { params.push(data.trainingHoursCompleted); sets.push(`training_hours_completed = $${params.length}`); }
  if (data.lastReportSubmittedAt) { params.push(data.lastReportSubmittedAt); sets.push(`last_report_submitted_at = $${params.length}`); }
  if (data.isActive !== undefined) { params.push(data.isActive); sets.push(`is_active = $${params.length}`); }
  if (data.notes) { params.push(data.notes); sets.push(`notes = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE dpo_appointments SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 4: DPIA Assessments ─────────────────────────────────────────────────

export async function listDpiaAssessments(orgId?: number, status?: string, limit = 50) {
  const pool = getSharedPool();
  let q = `SELECT d.*, o.name AS org_name FROM dpia_assessments d LEFT JOIN organizations o ON o.id = d.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND d.organization_id = $${params.length}`; }
  if (status) { params.push(status); q += ` AND d.dpia_status = $${params.length}`; }
  params.push(limit); q += ` ORDER BY d.created_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createDpiaAssessment(data: {
  organizationId: number; title: string; processingDescription: string;
  triggerCategory: string; riskLevel?: string; dataCategories?: string[];
  purposeOfProcessing?: string; necessityAssessment?: string;
  riskAssessment?: string; mitigationMeasures?: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO dpia_assessments (organization_id, title, processing_description, trigger_category,
      dpia_risk_level, data_categories, purpose_of_processing, necessity_assessment, risk_assessment, mitigation_measures)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [data.organizationId, data.title, data.processingDescription, data.triggerCategory,
     data.riskLevel ?? "medium", JSON.stringify(data.dataCategories ?? []),
     data.purposeOfProcessing ?? null, data.necessityAssessment ?? null,
     data.riskAssessment ?? null, data.mitigationMeasures ?? null]
  );
  return result.rows[0];
}

export async function updateDpiaAssessment(id: number, data: {
  status?: string; riskLevel?: string; reviewedBy?: number;
  mitigationMeasures?: string; residualRisk?: string;
  ndpcConsultationRequired?: boolean; ndpcConsultedAt?: Date; approvedAt?: Date;
}) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.status) { params.push(data.status); sets.push(`dpia_status = $${params.length}`); }
  if (data.riskLevel) { params.push(data.riskLevel); sets.push(`dpia_risk_level = $${params.length}`); }
  if (data.reviewedBy) { params.push(data.reviewedBy); sets.push(`reviewed_by = $${params.length}`); }
  if (data.mitigationMeasures) { params.push(data.mitigationMeasures); sets.push(`mitigation_measures = $${params.length}`); }
  if (data.residualRisk) { params.push(data.residualRisk); sets.push(`residual_risk = $${params.length}`); }
  if (data.ndpcConsultationRequired !== undefined) { params.push(data.ndpcConsultationRequired); sets.push(`ndpc_consultation_required = $${params.length}`); }
  if (data.ndpcConsultedAt) { params.push(data.ndpcConsultedAt); sets.push(`ndpc_consulted_at = $${params.length}`); }
  if (data.approvedAt) { params.push(data.approvedAt); sets.push(`approved_at = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE dpia_assessments SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 5: ROPA ─────────────────────────────────────────────────────────────

export async function listRopaRecords(orgId?: number, limit = 100) {
  const pool = getSharedPool();
  let q = `SELECT r.*, o.name AS org_name FROM ropa_records r LEFT JOIN organizations o ON o.id = r.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND r.organization_id = $${params.length}`; }
  params.push(limit); q += ` ORDER BY r.created_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createRopaRecord(data: {
  organizationId: number; processingActivityName: string; purpose: string;
  lawfulBasis: string; dataCategories?: string[]; dataSubjectCategories?: string[];
  recipients?: string[]; crossBorderTransfers?: boolean; transferDestinations?: string[];
  retentionPeriodDays?: number; securityMeasures?: string; dpiaRequired?: boolean; dpiaId?: number;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO ropa_records (organization_id, processing_activity_name, purpose, ropa_lawful_basis,
      data_categories, data_subject_categories, recipients, cross_border_transfers,
      transfer_destinations, retention_period_days, security_measures, dpia_required, dpia_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [data.organizationId, data.processingActivityName, data.purpose, data.lawfulBasis,
     JSON.stringify(data.dataCategories ?? []), JSON.stringify(data.dataSubjectCategories ?? []),
     JSON.stringify(data.recipients ?? []), data.crossBorderTransfers ?? false,
     JSON.stringify(data.transferDestinations ?? []), data.retentionPeriodDays ?? null,
     data.securityMeasures ?? null, data.dpiaRequired ?? false, data.dpiaId ?? null]
  );
  return result.rows[0];
}

export async function updateRopaRecord(id: number, data: {
  isActive?: boolean; dpoReviewed?: boolean; lastReviewedAt?: Date;
  retentionPeriodDays?: number; securityMeasures?: string;
}) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.isActive !== undefined) { params.push(data.isActive); sets.push(`is_active = $${params.length}`); }
  if (data.dpoReviewed !== undefined) { params.push(data.dpoReviewed); sets.push(`dpo_reviewed = $${params.length}`); }
  if (data.lastReviewedAt) { params.push(data.lastReviewedAt); sets.push(`last_reviewed_at = $${params.length}`); }
  if (data.retentionPeriodDays !== undefined) { params.push(data.retentionPeriodDays); sets.push(`retention_period_days = $${params.length}`); }
  if (data.securityMeasures) { params.push(data.securityMeasures); sets.push(`security_measures = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE ropa_records SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 6: Retention Policies ───────────────────────────────────────────────

export async function listRetentionPolicies(orgId?: number, limit = 100) {
  const pool = getSharedPool();
  let q = `SELECT * FROM retention_policies WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND (organization_id = $${params.length} OR is_global = true)`; }
  params.push(limit); q += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createRetentionPolicy(data: {
  organizationId?: number; name: string; dataCategory: string;
  retentionPeriodDays: number; archivalAction?: string; legalBasis?: string; isGlobal?: boolean;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO retention_policies (organization_id, name, data_category, retention_period_days, archival_action, legal_basis, is_global)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [data.organizationId ?? null, data.name, data.dataCategory, data.retentionPeriodDays,
     data.archivalAction ?? "delete", data.legalBasis ?? null, data.isGlobal ?? false]
  );
  return result.rows[0];
}

export async function updateRetentionPolicy(id: number, data: {
  isActive?: boolean; retentionPeriodDays?: number; lastExecutedAt?: Date;
  nextExecutionAt?: Date; recordsAffected?: number;
}) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.isActive !== undefined) { params.push(data.isActive); sets.push(`is_active = $${params.length}`); }
  if (data.retentionPeriodDays !== undefined) { params.push(data.retentionPeriodDays); sets.push(`retention_period_days = $${params.length}`); }
  if (data.lastExecutedAt) { params.push(data.lastExecutedAt); sets.push(`last_executed_at = $${params.length}`); }
  if (data.nextExecutionAt) { params.push(data.nextExecutionAt); sets.push(`next_execution_at = $${params.length}`); }
  if (data.recordsAffected !== undefined) { params.push(data.recordsAffected); sets.push(`records_affected = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE retention_policies SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 7: DPO Reports ─────────────────────────────────────────────────────

export async function listDpoReports(orgId?: number, limit = 50) {
  const pool = getSharedPool();
  let q = `SELECT dr.*, o.name AS org_name FROM dpo_reports dr LEFT JOIN organizations o ON o.id = dr.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND dr.organization_id = $${params.length}`; }
  params.push(limit); q += ` ORDER BY dr.report_period_end DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createDpoReport(data: {
  organizationId: number; dpoAppointmentId?: number;
  reportPeriodStart: string; reportPeriodEnd: string;
  privacyNoticesReview?: string; dataProcessingCategories?: string;
  lawfulBasesReview?: string; dpiaReview?: string; rightsExerciseReview?: string;
  complaintHandling?: string; securityMeasuresReview?: string;
  crossBorderReview?: string; breachNotifications?: string;
  trainingActivities?: string; recommendations?: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO dpo_reports (organization_id, dpo_appointment_id, report_period_start, report_period_end,
      privacy_notices_review, data_processing_categories, lawful_bases_review, dpia_review,
      rights_exercise_review, complaint_handling, security_measures_review, cross_border_review,
      breach_notifications, training_activities, recommendations)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [data.organizationId, data.dpoAppointmentId ?? null,
     new Date(data.reportPeriodStart), new Date(data.reportPeriodEnd),
     data.privacyNoticesReview ?? null, data.dataProcessingCategories ?? null,
     data.lawfulBasesReview ?? null, data.dpiaReview ?? null,
     data.rightsExerciseReview ?? null, data.complaintHandling ?? null,
     data.securityMeasuresReview ?? null, data.crossBorderReview ?? null,
     data.breachNotifications ?? null, data.trainingActivities ?? null,
     data.recommendations ?? null]
  );
  return result.rows[0];
}

export async function updateDpoReport(id: number, data: {
  status?: string; submittedAt?: Date; dpcoVerifiedAt?: Date; dpcoVerifierId?: string;
}) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.status) { params.push(data.status); sets.push(`dpo_report_status = $${params.length}`); }
  if (data.submittedAt) { params.push(data.submittedAt); sets.push(`submitted_at = $${params.length}`); }
  if (data.dpcoVerifiedAt) { params.push(data.dpcoVerifiedAt); sets.push(`dpco_verified_at = $${params.length}`); }
  if (data.dpcoVerifierId) { params.push(data.dpcoVerifierId); sets.push(`dpco_verifier_id = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE dpo_reports SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 8: Compliance Audit Returns ─────────────────────────────────────────

export async function listComplianceAuditReturns(orgId?: number, status?: string, limit = 50) {
  const pool = getSharedPool();
  let q = `SELECT c.*, o.name AS org_name FROM compliance_audit_returns c LEFT JOIN organizations o ON o.id = c.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND c.organization_id = $${params.length}`; }
  if (status) { params.push(status); q += ` AND c.car_status = $${params.length}`; }
  params.push(limit); q += ` ORDER BY c.audit_period_end DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createComplianceAuditReturn(data: {
  organizationId: number; auditPeriodStart: string; auditPeriodEnd: string;
  dpcoId?: string; dpcoName?: string; complianceScore?: number;
  findingsSummary?: string; nonConformities?: string[]; correctiveActions?: string[];
  dataProtectionPoliciesReview?: string; securityMeasuresAssessment?: string;
  staffTrainingAssessment?: string; incidentResponseAssessment?: string; crossBorderAssessment?: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO compliance_audit_returns (organization_id, audit_period_start, audit_period_end,
      dpco_id, dpco_name, compliance_score, findings_summary, non_conformities, corrective_actions,
      data_protection_policies_review, security_measures_assessment, staff_training_assessment,
      incident_response_assessment, cross_border_assessment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [data.organizationId, new Date(data.auditPeriodStart), new Date(data.auditPeriodEnd),
     data.dpcoId ?? null, data.dpcoName ?? null, data.complianceScore ?? null,
     data.findingsSummary ?? null, JSON.stringify(data.nonConformities ?? []),
     JSON.stringify(data.correctiveActions ?? []),
     data.dataProtectionPoliciesReview ?? null, data.securityMeasuresAssessment ?? null,
     data.staffTrainingAssessment ?? null, data.incidentResponseAssessment ?? null,
     data.crossBorderAssessment ?? null]
  );
  return result.rows[0];
}

export async function updateComplianceAuditReturn(id: number, data: {
  status?: string; reviewedBy?: number; reviewNotes?: string;
}) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.status) { params.push(data.status); sets.push(`car_status = $${params.length}`); }
  if (data.reviewedBy) { params.push(data.reviewedBy); sets.push(`reviewed_by = $${params.length}`); sets.push(`reviewed_at = NOW()`); }
  if (data.reviewNotes) { params.push(data.reviewNotes); sets.push(`review_notes = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE compliance_audit_returns SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 9: Adequacy Determinations ──────────────────────────────────────────

export async function listAdequacyDeterminations(limit = 200) {
  const pool = getSharedPool();
  const result = await pool.query(`SELECT * FROM adequacy_determinations ORDER BY country_name ASC LIMIT $1`, [limit]);
  return result.rows;
}

export async function createAdequacyDetermination(data: {
  countryCode: string; countryName: string; status?: string;
  dataProtectionLaw?: string; supervisoryAuthority?: string;
  requiresAdditionalSafeguards?: boolean; approvedTransferInstruments?: string[]; notes?: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO adequacy_determinations (country_code, country_name, adequacy_status,
      data_protection_law, supervisory_authority, requires_additional_safeguards,
      approved_transfer_instruments, notes, assessment_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (country_code) DO UPDATE SET
      adequacy_status = EXCLUDED.adequacy_status,
      data_protection_law = EXCLUDED.data_protection_law,
      updated_at = NOW()
     RETURNING *`,
    [data.countryCode, data.countryName, data.status ?? "pending",
     data.dataProtectionLaw ?? null, data.supervisoryAuthority ?? null,
     data.requiresAdditionalSafeguards ?? false,
     JSON.stringify(data.approvedTransferInstruments ?? []), data.notes ?? null]
  );
  return result.rows[0];
}

export async function updateAdequacyDetermination(id: number, data: { status?: string; notes?: string }) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.status) { params.push(data.status); sets.push(`adequacy_status = $${params.length}`); }
  if (data.notes) { params.push(data.notes); sets.push(`notes = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE adequacy_determinations SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 10: Data Processing Agreements ──────────────────────────────────────

export async function listDataProcessingAgreements(orgId?: number, status?: string, limit = 50) {
  const pool = getSharedPool();
  let q = `SELECT d.*, o.name AS org_name FROM data_processing_agreements d LEFT JOIN organizations o ON o.id = d.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND d.organization_id = $${params.length}`; }
  if (status) { params.push(status); q += ` AND d.dpa_status = $${params.length}`; }
  params.push(limit); q += ` ORDER BY d.created_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createDataProcessingAgreement(data: {
  organizationId: number; processorName: string; processorCountry?: string;
  processingPurpose?: string; dataCategories?: string[]; subProcessors?: string[];
  securityMeasures?: string; crossBorderTransfer?: boolean;
  agreementDate?: string; expiryDate?: string; documentUrl?: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO data_processing_agreements (organization_id, processor_name, processor_country,
      processing_purpose, data_categories, sub_processors, security_measures,
      cross_border_transfer, agreement_date, expiry_date, document_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [data.organizationId, data.processorName, data.processorCountry ?? null,
     data.processingPurpose ?? null, JSON.stringify(data.dataCategories ?? []),
     JSON.stringify(data.subProcessors ?? []), data.securityMeasures ?? null,
     data.crossBorderTransfer ?? false,
     data.agreementDate ? new Date(data.agreementDate) : null,
     data.expiryDate ? new Date(data.expiryDate) : null, data.documentUrl ?? null]
  );
  return result.rows[0];
}

export async function updateDataProcessingAgreement(id: number, data: { status?: string; reviewedBy?: number }) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.status) { params.push(data.status); sets.push(`dpa_status = $${params.length}`); }
  if (data.reviewedBy) { params.push(data.reviewedBy); sets.push(`reviewed_by = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE data_processing_agreements SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 11: Privacy Notices ─────────────────────────────────────────────────

export async function listPrivacyNotices(orgId?: number, status?: string, limit = 50) {
  const pool = getSharedPool();
  let q = `SELECT pn.*, o.name AS org_name FROM privacy_notices pn LEFT JOIN organizations o ON o.id = pn.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND pn.organization_id = $${params.length}`; }
  if (status) { params.push(status); q += ` AND pn.privacy_notice_status = $${params.length}`; }
  params.push(limit); q += ` ORDER BY pn.created_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createPrivacyNotice(data: {
  organizationId: number; title: string; content: string; noticeType?: string;
  version?: string; dataControllerInfo?: string; dpoContactInfo?: string;
  purposesOfProcessing?: string[]; lawfulBases?: string[];
  dataRetentionInfo?: string; rightsInfo?: string; crossBorderInfo?: string; cookieInfo?: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO privacy_notices (organization_id, title, content, notice_type, version,
      data_controller_info, dpo_contact_info, purposes_of_processing, lawful_bases,
      data_retention_info, rights_info, cross_border_info, cookie_info)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [data.organizationId, data.title, data.content, data.noticeType ?? "general",
     data.version ?? "1.0", data.dataControllerInfo ?? null, data.dpoContactInfo ?? null,
     JSON.stringify(data.purposesOfProcessing ?? []), JSON.stringify(data.lawfulBases ?? []),
     data.dataRetentionInfo ?? null, data.rightsInfo ?? null,
     data.crossBorderInfo ?? null, data.cookieInfo ?? null]
  );
  return result.rows[0];
}

export async function updatePrivacyNotice(id: number, data: {
  status?: string; publishedAt?: Date; approvedBy?: number; content?: string;
}) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.status) { params.push(data.status); sets.push(`privacy_notice_status = $${params.length}`); }
  if (data.publishedAt) { params.push(data.publishedAt); sets.push(`published_at = $${params.length}`); }
  if (data.approvedBy) { params.push(data.approvedBy); sets.push(`approved_by = $${params.length}`); }
  if (data.content) { params.push(data.content); sets.push(`content = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE privacy_notices SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 12: Cookie Consent ──────────────────────────────────────────────────

export async function listCookieConsentRecords(orgId?: number, limit = 100) {
  const pool = getSharedPool();
  let q = `SELECT * FROM cookie_consent_records WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND organization_id = $${params.length}`; }
  params.push(limit); q += ` ORDER BY COALESCE(consent_timestamp, created_at) DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createCookieConsentRecord(data: {
  organizationId: number; domain: string; visitorId?: string; consentGiven: boolean;
  analyticalCookies?: boolean; marketingCookies?: boolean; functionalCookies?: boolean;
  ipAddress?: string; userAgent?: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO cookie_consent_records (organization_id, domain, visitor_id, consent_given,
      analytical_cookies, marketing_cookies, functional_cookies, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [data.organizationId, data.domain, data.visitorId ?? null, data.consentGiven,
     data.analyticalCookies ?? false, data.marketingCookies ?? false,
     data.functionalCookies ?? false, data.ipAddress ?? null, data.userAgent ?? null]
  );
  return result.rows[0];
}

export async function getCookieConsentStats(orgId?: number) {
  const pool = getSharedPool();
  const where = orgId ? `WHERE organization_id = $1` : ``;
  const params = orgId ? [orgId] : [];
  const result = await pool.query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE consent_given = true)::int AS consented,
      COUNT(*) FILTER (WHERE analytical_cookies = true)::int AS analytical,
      COUNT(*) FILTER (WHERE marketing_cookies = true)::int AS marketing
     FROM cookie_consent_records ${where}`, params
  );
  return result.rows[0];
}

// ─── Gap 13: Automated Decision Records ──────────────────────────────────────

export async function listAutomatedDecisions(orgId?: number, limit = 50) {
  const pool = getSharedPool();
  let q = `SELECT ad.*, o.name AS org_name FROM automated_decision_records ad LEFT JOIN organizations o ON o.id = ad.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND ad.organization_id = $${params.length}`; }
  params.push(limit); q += ` ORDER BY ad.created_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createAutomatedDecision(data: {
  organizationId: number; aiSystemId?: number; dataSubjectEmail?: string;
  decisionType: string; decisionOutcome: string; significantEffect?: boolean;
  logicExplanation?: string; inputDataSummary?: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO automated_decision_records (organization_id, ai_system_id, data_subject_email,
      decision_type, decision_outcome, significant_effect, logic_explanation, input_data_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [data.organizationId, data.aiSystemId ?? null, data.dataSubjectEmail ?? null,
     data.decisionType, data.decisionOutcome, data.significantEffect ?? false,
     data.logicExplanation ?? null, data.inputDataSummary ?? null]
  );
  return result.rows[0];
}

export async function updateAutomatedDecision(id: number, data: {
  humanReviewRequested?: boolean; humanReviewCompletedAt?: Date;
  humanReviewOutcome?: string; optOutRequested?: boolean; optOutGrantedAt?: Date;
}) {
  const pool = getSharedPool();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (data.humanReviewRequested !== undefined) { params.push(data.humanReviewRequested); sets.push(`human_review_requested = $${params.length}`); }
  if (data.humanReviewCompletedAt) { params.push(data.humanReviewCompletedAt); sets.push(`human_review_completed_at = $${params.length}`); }
  if (data.humanReviewOutcome) { params.push(data.humanReviewOutcome); sets.push(`human_review_outcome = $${params.length}`); }
  if (data.optOutRequested !== undefined) { params.push(data.optOutRequested); sets.push(`opt_out_requested = $${params.length}`); }
  if (data.optOutGrantedAt) { params.push(data.optOutGrantedAt); sets.push(`opt_out_granted_at = $${params.length}`); }
  if (sets.length === 0) return null;
  params.push(id);
  const result = await pool.query(`UPDATE automated_decision_records SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 14: Parental Consent ────────────────────────────────────────────────

export async function listParentalConsents(orgId?: number, limit = 50) {
  const pool = getSharedPool();
  let q = `SELECT pc.*, o.name AS org_name FROM parental_consent_records pc LEFT JOIN organizations o ON o.id = pc.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND pc.organization_id = $${params.length}`; }
  params.push(limit); q += ` ORDER BY pc.created_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createParentalConsent(data: {
  organizationId: number; childName?: string; childAge?: number;
  parentName: string; parentEmail: string; purpose: string;
  verificationMethod?: string; ageVerificationMethod?: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO parental_consent_records (organization_id, child_name, child_age, parent_name,
      parent_email, purpose, verification_method, age_verification_method)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [data.organizationId, data.childName ?? null, data.childAge ?? null,
     data.parentName, data.parentEmail, data.purpose,
     data.verificationMethod ?? null, data.ageVerificationMethod ?? null]
  );
  return result.rows[0];
}

export async function updateParentalConsent(id: number, data: {
  consentStatus?: string; parentIdVerified?: boolean;
  consentGivenAt?: Date; consentWithdrawnAt?: Date;
}) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.consentStatus) { params.push(data.consentStatus); sets.push(`parental_consent_status = $${params.length}`); }
  if (data.parentIdVerified !== undefined) { params.push(data.parentIdVerified); sets.push(`parent_id_verified = $${params.length}`); }
  if (data.consentGivenAt) { params.push(data.consentGivenAt); sets.push(`consent_given_at = $${params.length}`); }
  if (data.consentWithdrawnAt) { params.push(data.consentWithdrawnAt); sets.push(`consent_withdrawn_at = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE parental_consent_records SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 15: Staff Training ──────────────────────────────────────────────────

export async function listStaffTraining(orgId?: number, status?: string, limit = 50) {
  const pool = getSharedPool();
  let q = `SELECT st.*, o.name AS org_name FROM staff_training_records st LEFT JOIN organizations o ON o.id = st.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND st.organization_id = $${params.length}`; }
  if (status && status !== 'all') { params.push(status); q += ` AND st.training_type = $${params.length}`; }
  params.push(limit); q += ` ORDER BY st.created_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createStaffTraining(data: {
  organizationId: number; trainingTitle: string; trainingType: string;
  description?: string; scheduledDate?: string; targetAudience?: string;
  trainerName?: string; durationHours?: number; isRecurring?: boolean; recurrenceMonths?: number;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO staff_training_records (organization_id, training_title, training_type,
      description, scheduled_date, target_audience, trainer_name, duration_hours,
      is_recurring, recurrence_months)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [data.organizationId, data.trainingTitle, data.trainingType,
     data.description ?? null, data.scheduledDate ? new Date(data.scheduledDate) : null,
     data.targetAudience ?? null, data.trainerName ?? null, data.durationHours ?? null,
     data.isRecurring ?? false, data.recurrenceMonths ?? null]
  );
  return result.rows[0];
}

export async function updateStaffTraining(id: number, data: {
  status?: string; completedDate?: Date; participantCount?: number; passRate?: number;
}) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.status) { params.push(data.status); sets.push(`training_status = $${params.length}`); }
  if (data.completedDate) { params.push(data.completedDate); sets.push(`completed_date = $${params.length}`); }
  if (data.participantCount !== undefined) { params.push(data.participantCount); sets.push(`participant_count = $${params.length}`); }
  if (data.passRate !== undefined) { params.push(data.passRate); sets.push(`pass_rate = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE staff_training_records SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 16: Transfer Instruments (BCR/SCC) ──────────────────────────────────

export async function listTransferInstruments(type?: string, status?: string, limit = 50) {
  const pool = getSharedPool();
  let q = `SELECT * FROM transfer_instruments WHERE 1=1`;
  const params: unknown[] = [];
  if (type) { params.push(type); q += ` AND instrument_type = $${params.length}`; }
  if (status) { params.push(status); q += ` AND transfer_instrument_status = $${params.length}`; }
  params.push(limit); q += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createTransferInstrument(data: {
  instrumentType: string; name: string; description?: string; templateContent?: string;
  applicableCountries?: string[]; organizationId?: number; ndpcApprovalRef?: string;
  effectiveDate?: string; expiryDate?: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO transfer_instruments (instrument_type, name, description, template_content,
      applicable_countries, organization_id, ndpc_approval_ref, effective_date, expiry_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [data.instrumentType, data.name, data.description ?? null, data.templateContent ?? null,
     JSON.stringify(data.applicableCountries ?? []), data.organizationId ?? null,
     data.ndpcApprovalRef ?? null,
     data.effectiveDate ? new Date(data.effectiveDate) : null,
     data.expiryDate ? new Date(data.expiryDate) : null]
  );
  return result.rows[0];
}

export async function updateTransferInstrument(id: number, data: { status?: string; approvedBy?: number }) {
  const pool = getSharedPool();
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (data.status) { params.push(data.status); sets.push(`transfer_instrument_status = $${params.length}`); }
  if (data.approvedBy) { params.push(data.approvedBy); sets.push(`approved_by = $${params.length}`); }
  params.push(id);
  const result = await pool.query(`UPDATE transfer_instruments SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 17: Data Export Jobs ────────────────────────────────────────────────

export async function listDataExportJobs(orgId?: number, limit = 50) {
  const pool = getSharedPool();
  let q = `SELECT dj.*, o.name AS org_name FROM data_export_jobs dj LEFT JOIN organizations o ON o.id = dj.organization_id WHERE 1=1`;
  const params: unknown[] = [];
  if (orgId) { params.push(orgId); q += ` AND dj.organization_id = $${params.length}`; }
  params.push(limit); q += ` ORDER BY dj.created_at DESC LIMIT $${params.length}`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createDataExportJob(data: {
  citizenRequestId?: number; organizationId: number; dataSubjectEmail: string;
  exportFormat?: string; dataCategories?: string[];
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO data_export_jobs (citizen_request_id, organization_id, data_subject_email, export_format, data_categories)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [data.citizenRequestId ?? null, data.organizationId, data.dataSubjectEmail,
     data.exportFormat ?? "json", JSON.stringify(data.dataCategories ?? [])]
  );
  return result.rows[0];
}

export async function updateDataExportJob(id: number, data: {
  status?: string; fileSizeBytes?: number; downloadUrl?: string;
  processedAt?: Date; errorMessage?: string; downloadExpiresAt?: Date;
}) {
  const pool = getSharedPool();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (data.status) { params.push(data.status); sets.push(`export_job_status = $${params.length}`); }
  if (data.fileSizeBytes !== undefined) { params.push(data.fileSizeBytes); sets.push(`file_size_bytes = $${params.length}`); }
  if (data.downloadUrl) { params.push(data.downloadUrl); sets.push(`download_url = $${params.length}`); }
  if (data.processedAt) { params.push(data.processedAt); sets.push(`processed_at = $${params.length}`); }
  if (data.errorMessage) { params.push(data.errorMessage); sets.push(`error_message = $${params.length}`); }
  if (data.downloadExpiresAt) { params.push(data.downloadExpiresAt); sets.push(`download_expires_at = $${params.length}`); }
  if (sets.length === 0) return null;
  params.push(id);
  const result = await pool.query(`UPDATE data_export_jobs SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
  return result.rows[0];
}

// ─── Gap 18: DCPMI Thresholds ────────────────────────────────────────────────

export async function listDcpmiThresholds(sectorCode?: string) {
  const pool = getSharedPool();
  let q = `SELECT * FROM dcpmi_thresholds WHERE is_active = true`;
  const params: unknown[] = [];
  if (sectorCode) { params.push(sectorCode); q += ` AND (sector_code = $${params.length} OR sector_code IS NULL)`; }
  q += ` ORDER BY criterion_name ASC`;
  const result = await pool.query(q, params);
  return result.rows;
}

export async function createDcpmiThreshold(data: {
  sectorCode?: string; criterionName: string; criterionDescription?: string;
  thresholdValue: number; thresholdUnit: string;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO dcpmi_thresholds (sector_code, criterion_name, criterion_description, threshold_value, threshold_unit, effective_date)
     VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
    [data.sectorCode ?? null, data.criterionName, data.criterionDescription ?? null,
     data.thresholdValue, data.thresholdUnit]
  );
  return result.rows[0];
}

export async function deleteDcpmiThreshold(id: number) {
  const pool = getSharedPool();
  await pool.query(`DELETE FROM dcpmi_thresholds WHERE id = $1`, [id]);
  return { success: true };
}

export async function evaluateDcpmiStatus(orgId: number) {
  const pool = getSharedPool();
  try {
    const orgRes = await pool.query(
      `SELECT o.*, s.code AS sector_code FROM organizations o LEFT JOIN sectors s ON s.name = o.sector WHERE o.id = $1`, [orgId]
    );
    const org = orgRes.rows[0];
    if (!org) return { isMajorImportance: false, reason: "Organization not found" };

    const thresholds = await pool.query(
      `SELECT * FROM dcpmi_thresholds WHERE is_active = true AND (sector_code = $1 OR sector_code IS NULL)`,
      [org.sector_code ?? null]
    );

    const results: Array<{ criterion: string; threshold: number; actual: number; unit: string; met: boolean }> = [];
    for (const t of thresholds.rows) {
      let actual = 0;
      if (t.criterion_name === "annual_turnover") actual = Number(org.annual_turnover ?? 0);
      else if (t.criterion_name === "data_subject_count") actual = Number(org.declared_asset_count ?? 0);
      else if (t.criterion_name === "employee_count") actual = Number(org.employee_count ?? 0);
      else actual = Number(org.declared_asset_count ?? 0);
      results.push({ criterion: t.criterion_name, threshold: t.threshold_value, actual, unit: t.threshold_unit, met: actual >= t.threshold_value });
    }
    const isMajorImportance = results.some(r => r.met);
    return { orgId, orgName: org.name, sector: org.sector, isMajorImportance, criteria: results };
  } catch (e) { throw e; }
}

// ─── Pool accessors (used by _core/index.ts for health checks) ───────────────
export function getPool(): InstanceType<typeof Pool> | null {
  return _pool;
}














export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding Phase helpers (Phase 25)
// ─────────────────────────────────────────────────────────────────────────────
export async function getOnboardingPhases(submissionId: number) {
  const pool = getSharedPool();
  const result = await pool.query(
    `SELECT * FROM onboarding_phases WHERE submission_id = $1 ORDER BY phase_order ASC`,
    [submissionId]
  );
  return result.rows;
}

export async function updateOnboardingPhase(input: {
  id: number;
  status?: string;
  completedAt?: Date;
  notes?: string;
}) {
  const pool = getSharedPool();
  const sets: string[] = [];
  const params: unknown[] = [input.id];
  if (input.status !== undefined) { params.push(input.status); sets.push(`status = $${params.length}`); }
  if (input.completedAt !== undefined) { params.push(input.completedAt); sets.push(`completed_at = $${params.length}`); }
  if (input.notes !== undefined) { params.push(input.notes); sets.push(`notes = $${params.length}`); }
  if (sets.length === 0) return null;
  const result = await pool.query(
    `UPDATE onboarding_phases SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
    params
  );
  return result.rows[0];
}

export async function listOnboardingPhases() {
  const pool = getSharedPool();
  const result = await pool.query(`SELECT op.*, ps.organization_id, ps.status as submission_status FROM onboarding_phases op LEFT JOIN portal_submissions ps ON ps.id = op.submission_id ORDER BY op.created_at DESC LIMIT 200`);
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification Settings helpers (Phase 25)
// ─────────────────────────────────────────────────────────────────────────────
export async function getNotificationSettings(organizationId: number) {
  const pool = getSharedPool();
  const result = await pool.query(
    `SELECT * FROM notification_settings WHERE organization_id = $1 LIMIT 1`,
    [organizationId]
  );
  return result.rows[0] ?? null;
}

export async function upsertNotificationSettings(organizationId: number, settings: Record<string, unknown>) {
  const pool = getSharedPool();
  const fields = [
    "email_enabled", "slack_enabled", "in_app_enabled",
    "breach_alerts", "penalty_alerts", "compliance_alerts", "system_alerts",
    "slack_webhook_url", "notification_email", "legal_email", "digest_frequency",
  ];
  const values = fields.map(f => {
    const camel = f.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    return settings[camel] !== undefined ? settings[camel] : (settings[f] !== undefined ? settings[f] : null);
  });
  const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const result = await pool.query(
    `INSERT INTO notification_settings (organization_id, ${fields.join(", ")}, updated_at)
     VALUES ($1, ${fields.map((_, i) => `$${i + 2}`).join(", ")}, NOW())
     ON CONFLICT (organization_id) DO UPDATE SET ${setClauses}, updated_at = NOW()
     RETURNING *`,
    [organizationId, ...values]
  );
  return result.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// In-App Notifications (Phase 25)
// ─────────────────────────────────────────────────────────────────────────────
export async function createInAppNotification(data: {
  title: string;
  message: string;
  severity?: string;
  category?: string;
  organizationId?: number;
  userId?: number;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}) {
  const pool = getSharedPool();
  const result = await pool.query(
    `INSERT INTO in_app_notifications (title, message, severity, category, organization_id, user_id, action_url, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *`,
    [
      data.title, data.message,
      data.severity ?? "info", data.category ?? "system",
      data.organizationId ?? null, data.userId ?? null,
      data.actionUrl ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ]
  );
  return result.rows[0];
}

export async function getInAppNotifications(limit = 50, onlyUnread = false) {
  const pool = getSharedPool();
  const where = onlyUnread ? "WHERE n.is_read = FALSE" : "";
  const result = await pool.query(
    `SELECT n.*, o.name as org_name FROM in_app_notifications n
     LEFT JOIN organizations o ON n.organization_id = o.id
     ${where} ORDER BY n.created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function markNotificationRead(id: number) {
  const pool = getSharedPool();
  await pool.query("UPDATE in_app_notifications SET is_read = TRUE WHERE id = $1", [id]);
}

export async function markAllNotificationsRead() {
  const pool = getSharedPool();
  await pool.query("UPDATE in_app_notifications SET is_read = TRUE WHERE is_read = FALSE");
}

export async function getUnreadNotificationCount() {
  const pool = getSharedPool();
  const result = await pool.query("SELECT COUNT(*)::int AS count FROM in_app_notifications WHERE is_read = FALSE");
  return result.rows[0]?.count ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sector Benchmark (Phase 25)
// ─────────────────────────────────────────────────────────────────────────────
export async function getSectorBenchmark(): Promise<{
  sector: string; orgCount: number; avgComplianceScore: number;
  certifiedCount: number; totalPenaltyAmount: number; penaltyCount: number;
  violationCount: number; openEnforcementCases: number; avgRemediationDays: number;
}[]> {
  const pool = getSharedPool();
  const result = await pool.query(`
    SELECT
      COALESCE(o.sector, 'Unknown') AS sector,
      COUNT(DISTINCT o.id)::int AS org_count,
      ROUND(AVG(COALESCE(o.compliance_score, 0))::numeric, 1) AS avg_compliance_score,
      COUNT(DISTINCT CASE WHEN o.compliance_status = 'certified' THEN o.id END)::int AS certified_count,
      COALESCE(SUM(fp.amount), 0)::float AS total_penalty_amount,
      COUNT(DISTINCT fp.id)::int AS penalty_count,
      COUNT(DISTINCT cv.id)::int AS violation_count,
      COUNT(DISTINCT CASE WHEN ec.status NOT IN ('settled','closed') THEN ec.id END)::int AS open_enforcement_cases,
      COALESCE(ROUND(AVG(
        CASE WHEN rw.completed_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (rw.completed_at - rw.created_at)) / 86400.0
        END
      )::numeric, 1), 0)::float AS avg_remediation_days
    FROM organizations o
    LEFT JOIN financial_penalties fp ON fp.organization_id = o.id
    LEFT JOIN compliance_violations cv ON cv.organization_id = o.id
    LEFT JOIN enforcement_cases ec ON ec.organization_id = o.id
    LEFT JOIN remediation_workflows rw ON rw.org_id = o.id::text
    GROUP BY COALESCE(o.sector, 'Unknown')
    ORDER BY avg_compliance_score DESC
  `);
  return result.rows.map((r: Record<string, unknown>) => ({
    sector: String(r.sector), orgCount: Number(r.org_count),
    avgComplianceScore: Number(r.avg_compliance_score),
    certifiedCount: Number(r.certified_count),
    totalPenaltyAmount: Number(r.total_penalty_amount),
    penaltyCount: Number(r.penalty_count), violationCount: Number(r.violation_count),
    openEnforcementCases: Number(r.open_enforcement_cases),
    avgRemediationDays: Number(r.avg_remediation_days),
  }));
}

export async function getNdpaComplianceIndex() {
  const pool = getSharedPool();
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM breach_incidents WHERE breach_incident_status = 'resolved')::int AS breaches_resolved,
      (SELECT COUNT(*) FROM breach_incidents)::int AS breaches_total,
      (SELECT COUNT(*) FROM breach_incidents WHERE ndpc_notified_at IS NOT NULL AND ndpc_notified_at <= detected_at + INTERVAL '72 hours')::int AS breaches_notified_on_time,
      (SELECT COUNT(*) FROM dpo_appointments WHERE credential_status = 'verified')::int AS dpo_verified,
      (SELECT COUNT(*) FROM dpo_appointments)::int AS dpo_total,
      (SELECT COUNT(*) FROM dpia_assessments WHERE dpia_status = 'approved')::int AS dpia_approved,
      (SELECT COUNT(*) FROM dpia_assessments)::int AS dpia_total,
      (SELECT COUNT(*) FROM consent_records WHERE consent_status = 'active')::int AS consent_active,
      (SELECT COUNT(*) FROM consent_records)::int AS consent_total,
      (SELECT COUNT(*) FROM staff_training_records WHERE training_status = 'completed')::int AS training_completed,
      (SELECT COUNT(*) FROM staff_training_records)::int AS training_total,
      (SELECT COUNT(*) FROM compliance_audit_returns WHERE car_status = 'accepted')::int AS car_accepted,
      (SELECT COUNT(*) FROM compliance_audit_returns)::int AS car_total,
      (SELECT COUNT(*) FROM privacy_notices WHERE privacy_notice_status = 'published')::int AS notices_published,
      (SELECT COUNT(*) FROM privacy_notices)::int AS notices_total,
      (SELECT COUNT(*) FROM ropa_records)::int AS ropa_count,
      (SELECT COUNT(*) FROM data_processing_agreements WHERE dpa_status = 'active')::int AS dpa_active,
      (SELECT COUNT(*) FROM data_processing_agreements)::int AS dpa_total
  `);
  const row = r.rows[0];
  const safeRate = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0;
  const breachResolutionRate = safeRate(Number(row.breaches_resolved), Number(row.breaches_total));
  const breachNotificationRate = safeRate(Number(row.breaches_notified_on_time), Math.max(Number(row.breaches_total), 1));
  const dpoAppointmentRate = safeRate(Number(row.dpo_verified), Math.max(Number(row.dpo_total), 1));
  const dpiaCompletionRate = safeRate(Number(row.dpia_approved), Math.max(Number(row.dpia_total), 1));
  const consentComplianceRate = safeRate(Number(row.consent_active), Number(row.consent_total));
  const trainingCompletionRate = safeRate(Number(row.training_completed), Math.max(Number(row.training_total), 1));
  const auditReturnRate = safeRate(Number(row.car_accepted), Math.max(Number(row.car_total), 1));
  const privacyNoticeRate = safeRate(Number(row.notices_published), Math.max(Number(row.notices_total), 1));
  const ndpaIndex = Math.round(
    breachResolutionRate * 0.20 + breachNotificationRate * 0.15 +
    dpoAppointmentRate * 0.15 + dpiaCompletionRate * 0.15 +
    consentComplianceRate * 0.10 + trainingCompletionRate * 0.10 +
    auditReturnRate * 0.10 + privacyNoticeRate * 0.05
  );
  return {
    ndpaIndex,
    metrics: { breachResolutionRate, breachNotificationRate, dpoAppointmentRate, dpiaCompletionRate, consentComplianceRate, trainingCompletionRate, auditReturnRate, privacyNoticeRate },
    counts: { breachesTotal: Number(row.breaches_total), breachesResolved: Number(row.breaches_resolved), dpoVerified: Number(row.dpo_verified), dpiaApproved: Number(row.dpia_approved), consentActive: Number(row.consent_active), ropaCount: Number(row.ropa_count), dpaActive: Number(row.dpa_active) }
  };
}

export async function getBreachTimeline(limit = 20) {
  const pool = getSharedPool();
  const result = await pool.query(`
    SELECT b.id, b.title, b.breach_incident_severity AS severity, b.breach_incident_status AS status,
      b.detected_at, b.ndpc_notification_deadline, b.ndpc_notified_at,
      b.individuals_notified_at, b.contained_at, b.resolved_at,
      b.affected_individuals_count, b.data_types_affected, b.breach_cause,
      b.ndpc_reference_number,
      o.name AS org_name, o.sector
    FROM breach_incidents b
    LEFT JOIN organizations o ON o.id = b.organization_id
    ORDER BY b.detected_at DESC
    LIMIT $1
  `, [limit]);
  return result.rows.map((r: Record<string, unknown>) => ({
    id: Number(r.id), title: r.title, severity: r.severity, status: r.status,
    detectedAt: r.detected_at, ndpcDeadline: r.ndpc_notification_deadline,
    ndpcNotifiedAt: r.ndpc_notified_at, individualsNotifiedAt: r.individuals_notified_at,
    containedAt: r.contained_at, resolvedAt: r.resolved_at,
    affectedCount: Number(r.affected_individuals_count || 0),
    dataTypes: r.data_types_affected || [], breachCause: r.breach_cause,
    ndpcRef: r.ndpc_reference_number, orgName: r.org_name, sector: r.sector,
  }));
}

// ─── NDPA Compliance Snapshots ────────────────────────────────────────────────
export async function getNdpaComplianceTrend(days = 180) {
  const pool = getSharedPool();
  const result = await pool.query(`
    SELECT
      snapshot_date, ndpa_index,
      breach_resolution_rate, breach_notification_rate,
      dpo_appointment_rate, dpia_completion_rate,
      consent_compliance_rate, training_completion_rate,
      audit_return_rate, privacy_notice_rate
    FROM ndpa_compliance_snapshots
    WHERE snapshot_date >= NOW() - INTERVAL '1 day' * $1
    ORDER BY snapshot_date ASC
  `, [days]);
  return result.rows.map((r: Record<string, unknown>) => ({
    date: r.snapshot_date,
    ndpaIndex: Number(r.ndpa_index),
    breachResolutionRate: Number(r.breach_resolution_rate),
    breachNotificationRate: Number(r.breach_notification_rate),
    dpoAppointmentRate: Number(r.dpo_appointment_rate),
    dpiaCompletionRate: Number(r.dpia_completion_rate),
    consentComplianceRate: Number(r.consent_compliance_rate),
    trainingCompletionRate: Number(r.training_completion_rate),
    auditReturnRate: Number(r.audit_return_rate),
    privacyNoticeRate: Number(r.privacy_notice_rate),
  }));
}

export async function saveNdpaComplianceSnapshot() {
  const pool = getSharedPool();
  const idx = await getNdpaComplianceIndex();
  await pool.query(`
    INSERT INTO ndpa_compliance_snapshots
      (snapshot_date, ndpa_index, breach_resolution_rate, breach_notification_rate,
       dpo_appointment_rate, dpia_completion_rate, consent_compliance_rate,
       training_completion_rate, audit_return_rate, privacy_notice_rate,
       breaches_total, dpo_verified, dpia_approved, consent_active)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `, [
    new Date(), idx.ndpaIndex,
    idx.metrics.breachResolutionRate, idx.metrics.breachNotificationRate,
    idx.metrics.dpoAppointmentRate, idx.metrics.dpiaCompletionRate,
    idx.metrics.consentComplianceRate, idx.metrics.trainingCompletionRate,
    idx.metrics.auditReturnRate, idx.metrics.privacyNoticeRate,
    idx.counts.breachesTotal, idx.counts.dpoVerified,
    idx.counts.dpiaApproved, idx.counts.consentActive,
  ]);
  return { success: true };
}

// ─── Breach SLA Heatmap (calendar view) ──────────────────────────────────────
export async function getBreachSlaHeatmap(days = 365) {
  const pool = getSharedPool();
  const result = await pool.query(`
    SELECT
      DATE_TRUNC('day', detected_at) AS day,
      COUNT(*) AS total_breaches,
      COUNT(*) FILTER (WHERE ndpc_notified_at IS NOT NULL AND ndpc_notified_at <= detected_at + INTERVAL '72 hours') AS sla_met,
      COUNT(*) FILTER (WHERE ndpc_notified_at IS NULL AND detected_at + INTERVAL '72 hours' < NOW()) AS sla_breached,
      COUNT(*) FILTER (WHERE breach_incident_severity = 'critical') AS critical_count,
      COUNT(*) FILTER (WHERE breach_incident_severity = 'high') AS high_count
    FROM breach_incidents
    WHERE detected_at >= NOW() - INTERVAL '1 day' * $1
    GROUP BY DATE_TRUNC('day', detected_at)
    ORDER BY day ASC
  `, [days]);
  return result.rows.map((r: Record<string, unknown>) => ({
    day: r.day,
    totalBreaches: Number(r.total_breaches),
    slaMet: Number(r.sla_met),
    slaBreached: Number(r.sla_breached),
    criticalCount: Number(r.critical_count),
    highCount: Number(r.high_count),
    slaRate: Number(r.total_breaches) > 0
      ? Math.round((Number(r.sla_met) / Number(r.total_breaches)) * 100)
      : 100,
  }));
}

// ─── Audit Return Generator ───────────────────────────────────────────────────
export async function generateAuditReturnData(year: number) {
  const pool = getSharedPool();
  const [breachR, dpoR, dpiaR, consentR, trainingR, ropaR, dpaR, noticeR, cookieR] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE breach_incident_status='resolved') AS resolved,
      COUNT(*) FILTER (WHERE ndpc_notified_at IS NOT NULL AND ndpc_notified_at <= detected_at + INTERVAL '72 hours') AS notified_on_time,
      SUM(affected_individuals_count) AS total_affected
      FROM breach_incidents WHERE EXTRACT(YEAR FROM detected_at) = $1`, [year]),
    pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE credential_status='verified') AS verified FROM dpo_appointments WHERE EXTRACT(YEAR FROM created_at) = $1`, [year]),
    pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE dpia_status='approved') AS approved FROM dpia_assessments WHERE EXTRACT(YEAR FROM created_at) = $1`, [year]),
    pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE consent_status='active') AS active, COUNT(*) FILTER (WHERE consent_status='withdrawn') AS withdrawn FROM consent_records WHERE EXTRACT(YEAR FROM created_at) = $1`, [year]),
    pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE training_status='completed') AS completed FROM staff_training_records WHERE EXTRACT(YEAR FROM created_at) = $1`, [year]),
    pool.query(`SELECT COUNT(*) AS total FROM ropa_records WHERE EXTRACT(YEAR FROM created_at) = $1`, [year]),
    pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE dpa_status='active') AS active FROM data_processing_agreements WHERE EXTRACT(YEAR FROM created_at) = $1`, [year]),
    pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE privacy_notice_status='published') AS published FROM privacy_notices WHERE EXTRACT(YEAR FROM created_at) = $1`, [year]),
    pool.query(`SELECT COUNT(*) AS total FROM cookie_consent_records WHERE EXTRACT(YEAR FROM created_at) = $1`, [year]),
  ]);
  const b = breachR.rows[0]; const dpo = dpoR.rows[0]; const dpia = dpiaR.rows[0];
  const con = consentR.rows[0]; const tr = trainingR.rows[0]; const ropa = ropaR.rows[0];
  const dpa = dpaR.rows[0]; const pn = noticeR.rows[0]; const ck = cookieR.rows[0];
  return {
    year,
    generatedAt: new Date().toISOString(),
    jurisdiction: "NG",
    authority: "Nigeria Data Protection Commission (NDPC)",
    reportingPeriod: `January 1 – December 31, ${year}`,
    breachIncidents: {
      total: Number(b.total), resolved: Number(b.resolved),
      notifiedOnTime: Number(b.notified_on_time),
      totalAffectedIndividuals: Number(b.total_affected || 0),
      slaComplianceRate: Number(b.total) > 0 ? Math.round((Number(b.notified_on_time) / Number(b.total)) * 100) : 100,
    },
    dpoAppointments: { total: Number(dpo.total), verified: Number(dpo.verified) },
    dpiaAssessments: { total: Number(dpia.total), approved: Number(dpia.approved) },
    consentManagement: { total: Number(con.total), active: Number(con.active), withdrawn: Number(con.withdrawn) },
    staffTraining: { total: Number(tr.total), completed: Number(tr.completed) },
    ropaRecords: { total: Number(ropa.total) },
    dataProcessingAgreements: { total: Number(dpa.total), active: Number(dpa.active) },
    privacyNotices: { total: Number(pn.total), published: Number(pn.published) },
    cookieConsent: { total: Number(ck.total) },
  };
}

// ─── Breach incidents for a specific day (heatmap drill-down) ─────────────────
export async function getBreachesForDay(date: string) {
  const pool = getSharedPool();
  const result = await pool.query(`
    SELECT
      b.id, b.title, b.breach_incident_severity AS severity,
      b.breach_incident_status AS status,
      b.detected_at, b.ndpc_notification_deadline,
      b.ndpc_notified_at, b.affected_individuals_count,
      b.breach_cause, b.ndpc_reference_number,
      o.name AS org_name
    FROM breach_incidents b
    LEFT JOIN organizations o ON o.id = b.organization_id
    WHERE DATE(b.detected_at) = $1::date
    ORDER BY b.detected_at DESC
  `, [date]);
  return result.rows.map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    title: r.title,
    severity: r.severity,
    status: r.status,
    detectedAt: r.detected_at,
    ndpcDeadline: r.ndpc_notification_deadline,
    ndpcNotifiedAt: r.ndpc_notified_at,
    affectedCount: Number(r.affected_individuals_count || 0),
    breachCause: r.breach_cause,
    ndpcRef: r.ndpc_reference_number,
    orgName: r.org_name,
    slaBreached: r.ndpc_notification_deadline && !r.ndpc_notified_at
      ? new Date(String(r.ndpc_notification_deadline)) < new Date()
      : false,
  }));
}

export async function deleteConsentRecord(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(consentRecords).where(eq(consentRecords.id, id));
  return { success: true };
}

export async function deleteBreachIncident(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(breachIncidents).where(eq(breachIncidents.id, id));
  return { success: true };
}

export async function deleteDpoAppointment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(dpoAppointments).where(eq(dpoAppointments.id, id));
  return { success: true };
}

export async function deleteDpiaAssessment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(dpiaAssessments).where(eq(dpiaAssessments.id, id));
  return { success: true };
}

export async function deleteRopaRecord(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(ropaRecords).where(eq(ropaRecords.id, id));
  return { success: true };
}

export async function deleteRetentionPolicy(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(retentionPolicies).where(eq(retentionPolicies.id, id));
  return { success: true };
}

export async function deleteDpoReport(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(dpoReports).where(eq(dpoReports.id, id));
  return { success: true };
}

export async function deleteComplianceAuditReturn(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(complianceAuditReturns).where(eq(complianceAuditReturns.id, id));
  return { success: true };
}

export async function deleteAdequacyDetermination(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(adequacyDeterminations).where(eq(adequacyDeterminations.id, id));
  return { success: true };
}

export async function deleteDataProcessingAgreement(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(dataProcessingAgreements).where(eq(dataProcessingAgreements.id, id));
  return { success: true };
}

export async function deletePrivacyNotice(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(privacyNotices).where(eq(privacyNotices.id, id));
  return { success: true };
}

export async function deleteCookieConsentRecord(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(cookieConsentRecords).where(eq(cookieConsentRecords.id, id));
  return { success: true };
}

export async function deleteAutomatedDecision(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(automatedDecisionRecords).where(eq(automatedDecisionRecords.id, id));
  return { success: true };
}

export async function deleteParentalConsent(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(parentalConsentRecords).where(eq(parentalConsentRecords.id, id));
  return { success: true };
}

export async function deleteStaffTraining(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(staffTrainingRecords).where(eq(staffTrainingRecords.id, id));
  return { success: true };
}

export async function deleteTransferInstrument(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(transferInstruments).where(eq(transferInstruments.id, id));
  return { success: true };
}

export async function deleteTransferApproval(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(transferApprovals).where(eq(transferApprovals.id, id));
  return { success: true };
}

export async function deleteDataExportJob(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(dataExportJobs).where(eq(dataExportJobs.id, id));
  return { success: true };
}

export async function deleteAiSystem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(aiSystems).where(eq(aiSystems.id, id));
  return { success: true };
}

export async function deletePolicyTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(policyTemplates).where(eq(policyTemplates.id, id));
  return { success: true };
}

export async function deleteEvidencePackage(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(evidencePackages).where(eq(evidencePackages.id, id));
  return { success: true };
}

export async function deleteTiaAssessment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(tiaAssessments).where(eq(tiaAssessments.id, id));
  return { success: true };
}

export async function deleteRemediationWorkflow(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(remediationWorkflows).where(eq(remediationWorkflows.id, id));
  return { success: true };
}

export async function deleteEnforcementCase(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(enforcementCases).where(eq(enforcementCases.id, id));
  return { success: true };
}

export async function deleteCitizenRequest(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(citizenRequests).where(eq(citizenRequests.id, id));
  return { success: true };
}

export async function deleteConfigSnapshot(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(configSnapshots).where(eq(configSnapshots.id, id));
  return { success: true };
}

// ─── Shared pool accessor for db helpers (avoids creating new Pool per call) ─
// This replaces the 112 individual new Pool() instances that were causing
// connection exhaustion. All db helpers now use this shared singleton.

// ─── Organization Users CRUD ──────────────────────────────────────────────────
export async function listOrganizationUsers(organizationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.select().from(organizationUsers).where(eq(organizationUsers.organizationId, organizationId)).orderBy(desc(organizationUsers.joinedAt));
}
export async function getOrganizationUserByUserId(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db.select().from(organizationUsers).where(eq(organizationUsers.userId, userId));
  return rows[0] ?? null;
}
export async function createOrganizationUser(data: InsertOrganizationUser) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db.insert(organizationUsers).values(data).returning();
  return rows[0];
}
export async function updateOrganizationUserRole(id: number, role: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db.update(organizationUsers).set({ role }).where(eq(organizationUsers.id, id)).returning();
  return rows[0];
}
export async function deleteOrganizationUser(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.delete(organizationUsers).where(eq(organizationUsers.id, id));
  return { success: true };
}
// ── Sector Compliance Events ─────────────────────────────────────────────────
export async function listSectorComplianceEvents(opts?: { orgId?: number; sector?: string; severity?: string; resolved?: boolean; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (opts?.orgId !== undefined) conditions.push(eq(sectorComplianceEvents.orgId, opts.orgId));
  if (opts?.sector) conditions.push(eq(sectorComplianceEvents.sector, opts.sector));
  if (opts?.severity) conditions.push(eq(sectorComplianceEvents.severity, opts.severity));
  if (opts?.resolved !== undefined) conditions.push(eq(sectorComplianceEvents.resolved, opts.resolved));
  const q = db.select().from(sectorComplianceEvents);
  const rows = conditions.length > 0
    ? await q.where(and(...conditions)).orderBy(desc(sectorComplianceEvents.createdAt)).limit(opts?.limit ?? 100)
    : await q.orderBy(desc(sectorComplianceEvents.createdAt)).limit(opts?.limit ?? 100);
  return rows;
}

export async function createSectorComplianceEvent(data: InsertSectorComplianceEvent) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db.insert(sectorComplianceEvents).values(data).returning();
  return rows[0];
}

export async function resolveSectorComplianceEvent(id: number, resolvedBy: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db.update(sectorComplianceEvents)
    .set({ resolved: true, resolvedAt: new Date(), resolvedBy })
    .where(eq(sectorComplianceEvents.id, id))
    .returning();
  return rows[0];
}

export async function getSectorComplianceEventStats() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    sector: sectorComplianceEvents.sector,
    severity: sectorComplianceEvents.severity,
    resolved: sectorComplianceEvents.resolved,
    count: sql<number>`cast(count(*) as int)`,
  }).from(sectorComplianceEvents).groupBy(sectorComplianceEvents.sector, sectorComplianceEvents.severity, sectorComplianceEvents.resolved);
  return rows;
}

export function getSharedPool(): InstanceType<typeof Pool> {
  if (!_pool) {
    _pool = new Pool({
      connectionString: PG_URL,
      ssl: getPgSslConfig(),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return _pool;
}
