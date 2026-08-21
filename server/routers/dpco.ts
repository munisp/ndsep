import { z } from "zod";

import { router, protectedProcedure, publicProcedure, deleteProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import pg from "pg";
import { emitEvent, logAuditEvent, broadcastEvent, cacheGetJson, cacheSetJson, cacheDel, triggerWorkflow } from "../middlewareHelpers";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { getPgSslConfig } from "../dbSslConfig";
import { encryptField } from "../encryption";
import { getDatabaseUrl } from "../config";
import { logger } from "../logger";

const { Pool } = pg;
let _dpcoPool: InstanceType<typeof Pool> | null = null;

function getPool(): InstanceType<typeof Pool> {
  if (!_dpcoPool) {
    _dpcoPool = new Pool({ connectionString: getDatabaseUrl(), ssl: getPgSslConfig() });
  }
  return _dpcoPool;
}

// ─── Helper: raw query ────────────────────────────────────────────────────────
async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  // Convert MySQL-style ? to PostgreSQL $N placeholders at runtime
  let idx = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
  const result = await getPool().query(pgSql, params);
  return result.rows as T[];
}

// ─── DPCO Registry ────────────────────────────────────────────────────────────
async function listDpcoOrganisations(opts: {
  status?: string;
  state?: string;
  type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }
  if (opts.state) { conditions.push("state = ?"); params.push(opts.state); }
  if (opts.type) { conditions.push("organisation_type = ?"); params.push(opts.type); }
  if (opts.search) {
    conditions.push("(name LIKE ? OR email LIKE ? OR licence_number LIKE ?)");
    const s = `%${opts.search}%`;
    params.push(s, s, s);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const rows = await q(`SELECT * FROM dpco_organisations ${where} ORDER BY name ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const [{ total }] = await q<{ total: number }>(`SELECT COUNT(*) as total FROM dpco_organisations ${where}`, params);
  return { rows, total, limit, offset };
}

async function getDpcoOrganisation(id: number) {
  const [row] = await q("SELECT * FROM dpco_organisations WHERE id = ?", [id]);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "DPCO not found" });
  return row;
}

async function upsertDpcoOrganisation(data: Record<string, unknown>) {
  if (data.id) {
    await q(
      `UPDATE dpco_organisations SET name=?, licence_number=?, licence_date=?, licence_expires_at=?, status=?, organisation_type=?, email=?, phone=?, website=?, state=?, address=?, services=?, staff_count=?, ndpc_reference=?, cac_number=?, tax_clearance_verified=?, ng_domain_verified=?, updated_at=NOW() WHERE id=?`,
      [data.name, data.licenceNumber, data.licenceDate, data.licenceExpiresAt, data.status, data.organisationType, data.email, data.phone, data.website, data.state, data.address, JSON.stringify(data.services ?? []), data.staffCount ?? 0, data.ndpcReference, data.cacNumber, data.taxClearanceVerified ? 1 : 0, data.ngDomainVerified ? 1 : 0, data.id]
    );
    return getDpcoOrganisation(Number(data.id));
  }
  const [result] = await q<any>(
    `INSERT INTO dpco_organisations (name, licence_number, licence_date, licence_expires_at, status, organisation_type, email, phone, website, state, address, services, staff_count, ndpc_reference, cac_number, tax_clearance_verified, ng_domain_verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    [data.name, data.licenceNumber, data.licenceDate, data.licenceExpiresAt, data.status ?? "pending", data.organisationType ?? "consultancy", data.email, data.phone, data.website, data.state, data.address, JSON.stringify(data.services ?? []), data.staffCount ?? 0, data.ndpcReference, data.cacNumber, data.taxClearanceVerified ? 1 : 0, data.ngDomainVerified ? 1 : 0]
  );
  return getDpcoOrganisation(result.id);
}

async function deleteDpcoOrganisation(id: number) {
  await q(`DELETE FROM dpco_organisations WHERE id = ?`, [id]);
  return { success: true };
}

// ─── DPCO Clients ─────────────────────────────────────────────────────────────
async function listDpcoClients(dpcoOrgId?: number, status?: string) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (dpcoOrgId) { conditions.push("c.dpco_org_id = ?"); params.push(dpcoOrgId); }
  if (status) { conditions.push("c.status = ?"); params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return q(`
    SELECT c.*, d.name as dpco_name, d.licence_number as dpco_licence
    FROM dpco_clients c
    LEFT JOIN dpco_organisations d ON d.id = c.dpco_org_id
    ${where}
    ORDER BY c.updated_at DESC
  `, params);
}

async function upsertDpcoClient(data: Record<string, unknown>) {
  if (data.id) {
    await q(
      `UPDATE dpco_clients SET org_name=COALESCE(?,org_name), org_sector=COALESCE(?,org_sector), org_location=COALESCE(?,org_location), contact_name=COALESCE(?,contact_name), contact_email=COALESCE(?,contact_email), contact_phone=COALESCE(?,contact_phone), status=COALESCE(?,status), risk_level=COALESCE(?,risk_level), updated_at=NOW() WHERE id=?`,
      [data.orgName, data.orgSector, data.orgLocation, data.contactName ? encryptField(String(data.contactName)) : data.contactName, data.contactEmail ? encryptField(String(data.contactEmail)) : data.contactEmail, data.contactPhone ? encryptField(String(data.contactPhone)) : data.contactPhone, data.status, data.riskLevel, data.id]
    );
    const [row] = await q("SELECT * FROM dpco_clients WHERE id = ?", [data.id]);
    return row;
  }
  const [result] = await q<any>(
    `INSERT INTO dpco_clients (dpco_org_id, org_name, org_sector, org_location, contact_name, contact_email, contact_phone, status, risk_level) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
    [data.dpcoOrganisationId ?? data.dpcoOrgId, data.orgName ?? data.organisationName ?? 'New Client', data.orgSector, data.orgLocation, data.contactName ? encryptField(String(data.contactName)) : null, data.contactEmail ? encryptField(String(data.contactEmail)) : null, data.contactPhone ? encryptField(String(data.contactPhone)) : null, data.status ?? 'active', data.riskLevel ?? 'medium']
  );
  const [row] = await q("SELECT * FROM dpco_clients WHERE id = ?", [result.id]);
  return row;
}

// ─── DPCO Verification Statements ────────────────────────────────────────────
async function listVerificationStatements(opts: { dpcoOrgId?: number; orgId?: number; status?: string }) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.dpcoOrgId) { conditions.push("v.dpco_org_id = ?"); params.push(opts.dpcoOrgId); }
  if (opts.orgId) { conditions.push("v.org_id = ?"); params.push(opts.orgId); }
  if (opts.status) { conditions.push("v.status = ?"); params.push(opts.status); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return q(`
    SELECT v.*, o.name as org_name, d.name as dpco_name, d.licence_number as dpco_licence
    FROM dpco_verification_statements v
    LEFT JOIN organizations o ON o.id = v.org_id
    LEFT JOIN dpco_organisations d ON d.id = v.dpco_org_id
    ${where}
    ORDER BY v.created_at DESC
    LIMIT 100
  `, params);
}

async function createVerificationStatement(data: Record<string, unknown>) {
  const [result] = await q<any>(
    `INSERT INTO dpco_verification_statements (dpco_id, dpco_org_id, filing_type, filing_reference_id, organisation_id, statement_date, audit_scope, findings_summary, compliance_score, non_conformities, corrective_actions, dpco_licence_number, dpco_signatory_name, dpco_signatory_role, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    [data.dpcoId ?? 0, data.dpcoOrganisationId, data.filingType ?? "compliance_audit_return", data.filingReferenceId, data.organisationId, data.statementDate, data.auditScope, data.findingsSummary, data.complianceScore, JSON.stringify(data.nonConformities ?? []), JSON.stringify(data.correctiveActions ?? []), data.dpcoLicenceNumber, data.dpcoSignatoryName, data.dpcoSignatoryRole, "draft"]
  );
  const [row] = await q("SELECT * FROM dpco_verification_statements WHERE id = ?", [result.id]);
  return row;
}

async function submitVerificationStatement(id: number, signatureHash: string) {
  await q("UPDATE dpco_verification_statements SET status='signed', signature_hash=?, submitted_at=NOW(), updated_at=NOW() WHERE id=?", [signatureHash, id]);
  const [row] = await q("SELECT * FROM dpco_verification_statements WHERE id = ?", [id]);
  return row;
}

// ─── DPCO Audit Engagements ───────────────────────────────────────────────────
async function listAuditEngagements(opts: { dpcoOrgId?: number; clientOrgId?: number; status?: string }) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.dpcoOrgId) { conditions.push("e.dpco_org_id = ?"); params.push(opts.dpcoOrgId); }
  if (opts.clientOrgId) { conditions.push("e.client_id = ?"); params.push(opts.clientOrgId); }
  if (opts.status) { conditions.push("e.current_stage = ?"); params.push(opts.status); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return q(`
    SELECT e.*, c.org_name as client_name, c.org_sector as client_sector, d.name as dpco_name, d.licence_number as dpco_licence
    FROM dpco_audit_engagements e
    LEFT JOIN dpco_clients c ON c.id = e.client_id
    LEFT JOIN dpco_organisations d ON d.id = e.dpco_org_id
    ${where}
    ORDER BY e.updated_at DESC
    LIMIT 100
  `, params);
}

async function upsertAuditEngagement(data: Record<string, unknown>) {
  if (data.id) {
    await q(
      `UPDATE dpco_audit_engagements SET current_stage=COALESCE(?,current_stage), critical_findings=COALESCE(?,critical_findings), high_findings=COALESCE(?,high_findings), medium_findings=COALESCE(?,medium_findings), low_findings=COALESCE(?,low_findings), compliance_score=COALESCE(?,compliance_score), lead_auditor=COALESCE(?,lead_auditor), actual_start=COALESCE(?,actual_start), actual_end=COALESCE(?,actual_end), notes=COALESCE(?,notes), updated_at=NOW() WHERE id=?`,
      [data.status ?? data.currentStage, data.criticalFindings, data.highFindings, data.mediumFindings, data.lowFindings, data.complianceScore, data.leadAuditor, data.actualStart, data.actualEnd, data.notes, data.id]
    );
    const [row] = await q("SELECT * FROM dpco_audit_engagements WHERE id = ?", [data.id]);
    return row;
  }
  const [result] = await q<any>(
    `INSERT INTO dpco_audit_engagements (dpco_org_id, client_id, title, current_stage, lead_auditor, planned_start, planned_end, notes) VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
    [data.dpcoOrganisationId ?? data.dpcoOrgId, data.clientOrganisationId ?? data.clientId, data.title ?? data.scope ?? 'New Audit', data.status ?? 'initiated', data.leadAuditor, data.plannedStart, data.plannedEnd, data.notes]
  );
  const [row] = await q("SELECT * FROM dpco_audit_engagements WHERE id = ?", [result.id]);
  return row;
}

// ─── DPCO Training ────────────────────────────────────────────────────────────
async function listTrainingSessions(opts: { dpcoOrgId?: number; clientOrgId?: number; status?: string }) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.dpcoOrgId) { conditions.push("t.dpco_org_id = ?"); params.push(opts.dpcoOrgId); }
  if (opts.clientOrgId) { conditions.push("t.client_id = ?"); params.push(opts.clientOrgId); }
  if (opts.status) { conditions.push("t.status = ?"); params.push(opts.status); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return q(`
    SELECT t.*, o.name as client_name, d.name as dpco_name
    FROM dpco_training_sessions t
    LEFT JOIN organizations o ON o.id = t.client_id
    LEFT JOIN dpco_organisations d ON d.id = t.dpco_org_id
    ${where}
    ORDER BY t.scheduled_date DESC
    LIMIT 100
  `, params);
}

async function upsertTrainingSession(data: Record<string, unknown>) {
  if (data.id) {
    await q(
      `UPDATE dpco_training_sessions SET title=?, training_type=?, delivery_mode=?, status=?, scheduled_date=?, duration_hours=?, max_participants=?, venue=?, meeting_link=?, trainer_name=?, description=?, ndpc_accredited=?, cpe_credits=?, updated_at=NOW() WHERE id=?`,
      [data.title, data.trainingType, data.deliveryMode, data.status, data.scheduledDate, data.durationHours, data.maxParticipants, data.venue, data.meetingLink, data.trainerName, data.description, data.ndpcAccredited ? 1 : 0, data.cpeCredits ?? 0, data.id]
    );
    const [row] = await q("SELECT * FROM dpco_training_sessions WHERE id = ?", [data.id]);
    return row;
  }
  const [result] = await q<any>(
    `INSERT INTO dpco_training_sessions (dpco_id, dpco_org_id, client_organisation_id, title, training_type, delivery_mode, status, scheduled_date, duration_hours, max_participants, venue, meeting_link, trainer_name, description, ndpc_accredited, cpe_credits) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    [data.dpcoId ?? 0, data.dpcoOrganisationId, data.clientOrganisationId, data.title, data.trainingType ?? "ndpa_overview", data.deliveryMode ?? "virtual", "scheduled", data.scheduledDate, data.durationHours, data.maxParticipants, data.venue, data.meetingLink, data.trainerName, data.description, data.ndpcAccredited ? 1 : 0, data.cpeCredits ?? 0]
  );
  const [row] = await q("SELECT * FROM dpco_training_sessions WHERE id = ?", [result.id]);
  return row;
}

async function enrollParticipant(data: Record<string, unknown>) {
  const [result] = await q<any>(
    `INSERT INTO dpco_training_participants (session_id, participant_name, participant_email, organisation_id, role_title) VALUES (?,?,?,?,?) RETURNING id`,
    [data.sessionId, data.participantName, data.participantEmail, data.organisationId, data.roleTitle]
  );
  await q("UPDATE dpco_training_sessions SET enrolled_count = enrolled_count + 1 WHERE id = ?", [data.sessionId]);
  const [row] = await q("SELECT * FROM dpco_training_participants WHERE id = ?", [result.id]);
  return row;
}

async function issueCertificate(participantId: number) {
  const certNumber = `NDSEP-CERT-${Date.now()}-${participantId}`;
  await q(
    "UPDATE dpco_training_participants SET certificate_issued=1, certificate_number=?, certificate_issued_at=NOW(), passed=1 WHERE id=?",
    [certNumber, participantId]
  );
  const [row] = await q("SELECT * FROM dpco_training_participants WHERE id = ?", [participantId]);
  return { ...row, certificateNumber: certNumber };
}

// ─── DPCO Policy Drafts ───────────────────────────────────────────────────────
async function listPolicyDrafts(opts: { dpcoOrgId?: number; clientOrgId?: number; docType?: string; status?: string }) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.dpcoOrgId) { conditions.push("p.dpco_org_id = ?"); params.push(opts.dpcoOrgId); }
  if (opts.clientOrgId) { conditions.push("p.client_organisation_id = ?"); params.push(opts.clientOrgId); }
  if (opts.docType) { conditions.push("p.document_type = ?"); params.push(opts.docType); }
  if (opts.status) { conditions.push("p.status = ?"); params.push(opts.status); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return q(`
    SELECT p.*, o.name as client_name, d.name as dpco_name
    FROM dpco_policy_drafts p
    LEFT JOIN organizations o ON o.id = p.client_organisation_id
    LEFT JOIN dpco_organisations d ON d.id = p.dpco_org_id
    ${where}
    ORDER BY p.updated_at DESC
    LIMIT 100
  `, params);
}

async function upsertPolicyDraft(data: Record<string, unknown>) {
  if (data.id) {
    await q(
      `UPDATE dpco_policy_drafts SET title=?, document_type=?, status=?, version=?, content=?, effective_date=?, review_date=?, approved_by=?, notes=?, ndpc_filed=?, ndpc_reference=?, updated_at=NOW() WHERE id=?`,
      [data.title, data.documentType, data.status, data.version, data.content, data.effectiveDate, data.reviewDate, data.approvedBy, data.notes, data.ndpcFiled ? 1 : 0, data.ndpcReference, data.id]
    );
    const [row] = await q("SELECT * FROM dpco_policy_drafts WHERE id = ?", [data.id]);
    return row;
  }
  const [result] = await q<any>(
    `INSERT INTO dpco_policy_drafts (dpco_id, dpco_org_id, client_organisation_id, document_type, title, status, version, content, effective_date, review_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    [data.dpcoId ?? 0, data.dpcoOrganisationId, data.clientOrganisationId, data.documentType ?? "privacy_policy", data.title, "draft", data.version ?? "1.0", data.content, data.effectiveDate, data.reviewDate, data.notes]
  );
  const [row] = await q("SELECT * FROM dpco_policy_drafts WHERE id = ?", [result.id]);
  return row;
}

// ─── DPCO Dashboard Stats ─────────────────────────────────────────────────────
async function getDpcoDashboardStats(dpcoOrgId?: number) {
  const filter = dpcoOrgId ? "WHERE dpco_org_id = ?" : "";
  // Note: q() converts ? to $N placeholders for PostgreSQL
  const params = dpcoOrgId ? [dpcoOrgId] : [];

  const [totalDpcos] = await q<{ c: number }>("SELECT COUNT(*) as c FROM dpco_organisations");
  const [activeDpcos] = await q<{ c: number }>("SELECT COUNT(*) as c FROM dpco_organisations WHERE status = 'active'");
  const [expiredDpcos] = await q<{ c: number }>("SELECT COUNT(*) as c FROM dpco_organisations WHERE status = 'expired'");
  const [expiringDpcos] = await q<{ c: number }>("SELECT COUNT(*) as c FROM dpco_organisations WHERE status = 'active' AND licence_expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'");
  const clientFilter = dpcoOrgId ? `WHERE dpco_org_id = ? AND status = 'active'` : `WHERE status = 'active'`;
  const [activeClients] = await q<{ c: number }>(`SELECT COUNT(*) as c FROM dpco_clients ${clientFilter}`, params);
  const engFilter = dpcoOrgId ? `WHERE dpco_org_id = ? AND current_stage NOT IN ('car_filed','report_issued')` : `WHERE current_stage NOT IN ('car_filed','report_issued')`;
  const [pendingCars] = await q<{ c: number }>(`SELECT COUNT(*) as c FROM dpco_audit_engagements ${engFilter}`, params);
  const genFilter = dpcoOrgId ? `WHERE dpco_org_id = ?` : ``;
  const [trainingSessions] = await q<{ c: number }>(`SELECT COUNT(*) as c FROM dpco_training_sessions ${genFilter}`, params);
  const [verificationStatements] = await q<{ c: number }>(`SELECT COUNT(*) as c FROM dpco_verification_statements ${genFilter}`, params);
  const [policyDrafts] = await q<{ c: number }>(`SELECT COUNT(*) as c FROM dpco_policy_drafts ${genFilter}`, params);

  const stateBreakdown = await q<{ tier: string; c: number }>(
    "SELECT tier::text as tier, COUNT(*) as c FROM dpco_organisations WHERE status = 'active' GROUP BY tier ORDER BY c DESC LIMIT 10"
  );
  const typeBreakdown = await q<{ tier: string; c: number }>(
    "SELECT tier::text as tier, COUNT(*) as c FROM dpco_organisations GROUP BY tier"
  );

  return {
    totalDpcos: totalDpcos.c,
    activeDpcos: activeDpcos.c,
    expiredDpcos: expiredDpcos.c,
    expiringDpcos: expiringDpcos.c,
    activeClients: activeClients.c,
    pendingCars: pendingCars.c,
    trainingSessions: trainingSessions.c,
    verificationStatements: verificationStatements.c,
    policyDrafts: policyDrafts.c,
    stateBreakdown,
    typeBreakdown,
  };
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────
const dpcoOrgInput = z.object({
  id: z.number().int().optional(),
  name: z.string().min(2).max(512),
  licenceNumber: z.string().max(128).optional(),
  licenceDate: z.string().optional(),
  licenceExpiresAt: z.string().optional(),
  status: z.enum(["active", "expired", "suspended", "revoked", "pending"]).optional(),
  organisationType: z.enum(["law_firm", "it_provider", "audit_firm", "consultancy", "other"]).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(32).optional(),
  website: z.string().url().optional().or(z.literal("")),
  state: z.string().max(128).optional(),
  address: z.string().optional(),
  services: z.array(z.string()).optional(),
  staffCount: z.number().int().optional(),
  ndpcReference: z.string().max(128).optional(),
  cacNumber: z.string().max(64).optional(),
  taxClearanceVerified: z.boolean().optional(),
  ngDomainVerified: z.boolean().optional(),
});

const dpcoClientInput = z.object({
  id: z.number().int().optional(),
  dpcoId: z.number().int().optional(),
  dpcoOrganisationId: z.number().int(),
  organisationId: z.number().int(),
  engagementType: z.enum(["audit", "dpo_outsourced", "training", "advisory", "policy_drafting", "breach_support", "due_diligence", "full_service"]).optional(),
  status: z.enum(["active", "completed", "suspended", "terminated"]).optional(),
  engagementStart: z.string().optional(),
  engagementEnd: z.string().optional(),
  contractReference: z.string().max(128).optional(),
  scope: z.string().optional(),
  retainerFee: z.number().optional(),
  nextAuditDue: z.string().optional(),
  notes: z.string().optional(),
});

const verificationStatementInput = z.object({
  dpcoId: z.number().int().optional(),
  dpcoOrganisationId: z.number().int(),
  filingType: z.enum(["compliance_audit_return", "dpo_report", "breach_notification", "registration", "transfer_approval", "dpia", "other"]).optional(),
  filingReferenceId: z.number().int().optional(),
  organisationId: z.number().int(),
  statementDate: z.string(),
  auditScope: z.string().optional(),
  findingsSummary: z.string().optional(),
  complianceScore: z.number().min(0).max(100).optional(),
  nonConformities: z.array(z.string()).optional(),
  correctiveActions: z.array(z.string()).optional(),
  dpcoLicenceNumber: z.string().max(128).optional(),
  dpcoSignatoryName: z.string().max(256).optional(),
  dpcoSignatoryRole: z.string().max(128).optional(),
});

const auditEngagementInput = z.object({
  id: z.number().int().optional(),
  dpcoId: z.number().int().optional(),
  dpcoOrganisationId: z.number().int(),
  clientOrganisationId: z.number().int(),
  auditType: z.enum(["initial", "annual", "follow_up", "special", "due_diligence", "transfer_impact"]).optional(),
  status: z.enum(["planned", "data_collection", "data_mapping", "assessment", "findings", "report_draft", "report_final", "car_filed", "closed"]).optional(),
  auditPeriodStart: z.string().optional(),
  auditPeriodEnd: z.string().optional(),
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
  actualStart: z.string().optional(),
  actualEnd: z.string().optional(),
  leadAuditor: z.string().max(256).optional(),
  scope: z.string().optional(),
  dataMappingComplete: z.boolean().optional(),
  policyReviewComplete: z.boolean().optional(),
  securityAssessmentComplete: z.boolean().optional(),
  staffInterviewsComplete: z.boolean().optional(),
  findingsCount: z.number().int().optional(),
  criticalFindings: z.number().int().optional(),
  highFindings: z.number().int().optional(),
  mediumFindings: z.number().int().optional(),
  lowFindings: z.number().int().optional(),
  complianceScore: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

const trainingSessionInput = z.object({
  id: z.number().int().optional(),
  dpcoId: z.number().int().optional(),
  dpcoOrganisationId: z.number().int(),
  clientOrganisationId: z.number().int().optional(),
  title: z.string().min(2).max(512),
  trainingType: z.enum(["data_protection_basics", "ndpa_overview", "dpo_certification", "breach_response", "consent_management", "dpia_workshop", "ropa_workshop", "cross_border", "ai_governance", "custom"]).optional(),
  deliveryMode: z.enum(["in_person", "virtual", "hybrid", "self_paced"]).optional(),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]).optional(),
  scheduledDate: z.string().optional(),
  durationHours: z.number().optional(),
  maxParticipants: z.number().int().optional(),
  venue: z.string().optional(),
  meetingLink: z.string().optional(),
  trainerName: z.string().max(256).optional(),
  description: z.string().optional(),
  ndpcAccredited: z.boolean().optional(),
  cpeCredits: z.number().optional(),
});

const policyDraftInput = z.object({
  id: z.number().int().optional(),
  dpcoId: z.number().int().optional(),
  dpcoOrganisationId: z.number().int(),
  clientOrganisationId: z.number().int().optional(),
  documentType: z.enum(["privacy_policy", "data_protection_policy", "cookie_policy", "dpa", "dsa", "bcr", "sar_procedure", "breach_response_plan", "retention_policy", "dpia_template", "training_policy", "ai_governance_policy", "custom"]).optional(),
  title: z.string().min(2).max(512),
  status: z.enum(["draft", "review", "approved", "signed", "published", "archived"]).optional(),
  version: z.string().max(32).optional(),
  content: z.string().optional(),
  effectiveDate: z.string().optional(),
  reviewDate: z.string().optional(),
  approvedBy: z.string().max(256).optional(),
  notes: z.string().optional(),
  ndpcFiled: z.boolean().optional(),
  ndpcReference: z.string().max(128).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────
export const dpcoRouter = router({
  // Registry
  listOrganisations: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      state: z.string().optional(),
      type: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    }).optional())
    .query(async ({ input }) => listDpcoOrganisations(input ?? {})),

  getOrganisation: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => getDpcoOrganisation(input.id)),

  upsertOrganisation: protectedProcedure
    .input(dpcoOrgInput)
    .mutation(async ({ input }) => upsertDpcoOrganisation(input)),

  // Dashboard stats
  dashboardStats: protectedProcedure
    .input(z.object({ dpcoOrgId: z.number().int().optional() }).optional())
    .query(async ({ input }) => getDpcoDashboardStats(input?.dpcoOrgId)),

  // Clients
  listClients: protectedProcedure
    .input(z.object({ dpcoOrgId: z.number().int().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => listDpcoClients(input?.dpcoOrgId, input?.status)),

  upsertClient: protectedProcedure
    .input(dpcoClientInput)
    .mutation(async ({ input }) => upsertDpcoClient(input)),

  // Verification Statements
  listVerificationStatements: protectedProcedure
    .input(z.object({ dpcoOrgId: z.number().int().optional(), orgId: z.number().int().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => listVerificationStatements(input ?? {})),

  createVerificationStatement: protectedProcedure
    .input(verificationStatementInput)
    .mutation(async ({ input }) => createVerificationStatement(input)),

  submitVerificationStatement: protectedProcedure
    .input(z.object({ id: z.number().int(), signatureHash: z.string() }))
    .mutation(async ({ input }) => submitVerificationStatement(input.id, input.signatureHash)),

  // Audit Engagements
  listAuditEngagements: protectedProcedure
    .input(z.object({ dpcoOrgId: z.number().int().optional(), clientOrgId: z.number().int().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => listAuditEngagements(input ?? {})),

  upsertAuditEngagement: protectedProcedure
    .input(auditEngagementInput)
    .mutation(async ({ input }) => upsertAuditEngagement(input)),

  // Training
  listTrainingSessions: protectedProcedure
    .input(z.object({ dpcoOrgId: z.number().int().optional(), clientOrgId: z.number().int().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => listTrainingSessions(input ?? {})),

  upsertTrainingSession: protectedProcedure
    .input(trainingSessionInput)
    .mutation(async ({ input }) => upsertTrainingSession(input)),

  enrollParticipant: protectedProcedure
    .input(z.object({ sessionId: z.number().int(), participantName: z.string(), participantEmail: z.string().email(), organisationId: z.number().int().optional(), roleTitle: z.string().optional() }))
    .mutation(async ({ input }) => enrollParticipant(input)),

  issueCertificate: protectedProcedure
    .input(z.object({ participantId: z.number().int() }))
    .mutation(async ({ input }) => issueCertificate(input.participantId)),

  listParticipants: protectedProcedure
    .input(z.object({ sessionId: z.number().int() }))
    .query(async ({ input }) => q("SELECT * FROM dpco_training_participants WHERE session_id = ? ORDER BY enrolled_at DESC", [input.sessionId])),

  // Policy Drafts
  listPolicyDrafts: protectedProcedure
    .input(z.object({ dpcoOrgId: z.number().int().optional(), clientOrgId: z.number().int().optional(), docType: z.string().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => listPolicyDrafts(input ?? {})),

  upsertPolicyDraft: protectedProcedure
    .input(policyDraftInput)
    .mutation(async ({ input }) => upsertPolicyDraft(input)),

  getPolicyDraft: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const [row] = await q("SELECT * FROM dpco_policy_drafts WHERE id = ?", [input.id]);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Policy draft not found" });
      return row;
    }),

  // ── Microservice Bridge Procedures ──────────────────────────────────────────────────
  // Proxy to Go/Python DPCO microservices; fallback to DB when services are not reachable.

  analyticsComplianceTrends: protectedProcedure
    .query(async () => {
      try {
        const res = await fetch(`http://localhost:${process.env.DPCO_ANALYTICS_PORT ?? 8330}/api/dpco/analytics/trends`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) return res.json();
      } catch (e: unknown) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "DPCO analytics trends service unavailable, falling back to DB"); }
      const rows = await q("SELECT TO_CHAR(snapshot_date, 'IYYY-IW') as week, ROUND(AVG(composite_score)::numeric,1) as avg_score, COUNT(*) as audits FROM ndpa_compliance_snapshots GROUP BY week ORDER BY week DESC LIMIT 26", []);
      return { weeks: rows, total_weeks: rows.length, source: "db-fallback" };
    }),

  analyticsPortfolio: protectedProcedure
    .query(async () => {
      try {
        const res = await fetch(`http://localhost:${process.env.DPCO_ANALYTICS_PORT ?? 8330}/api/dpco/analytics/portfolio`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) return res.json();
      } catch (e: unknown) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "DPCO analytics portfolio service unavailable, falling back to DB"); }
      const rows = await q("SELECT dpco_org_id, COUNT(*) as total_clients, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active_clients FROM dpco_clients GROUP BY dpco_org_id", []);
      return { dpcos: rows, source: "db-fallback" };
    }),

  analyticsHeatmap: protectedProcedure
    .query(async () => {
      try {
        const res = await fetch(`http://localhost:${process.env.DPCO_ANALYTICS_PORT ?? 8330}/api/dpco/analytics/heatmap`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) return res.json();
      } catch (e: unknown) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "DPCO analytics heatmap service unavailable, falling back to DB"); }
      const rows = await q("SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(*) as count FROM dpco_audit_engagements WHERE created_at >= NOW() - INTERVAL '365 days' GROUP BY date ORDER BY date", []);
      return { heatmap: rows, days: rows.length, source: "db-fallback" };
    }),

  listNotifications: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50), severity: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;
      const severity = input?.severity;
      try {
        const url = new URL(`http://localhost:${process.env.DPCO_NOTIFICATION_PORT ?? 8340}/api/dpco/notifications`);
        url.searchParams.set("limit", String(limit));
        if (severity) url.searchParams.set("severity", severity);
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
        if (res.ok) return res.json();
      } catch (e: unknown) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "DPCO notification service unavailable"); }
      return { notifications: [], total: 0, source: "service-unavailable" };
    }),

  sendNotification: protectedProcedure
    .input(z.object({ ruleId: z.string(), entityId: z.string(), eventData: z.record(z.string(), z.unknown()).optional() }))
    .mutation(async ({ input }) => {
      try {
        const res = await fetch(`http://localhost:${process.env.DPCO_NOTIFICATION_PORT ?? 8340}/api/dpco/notifications/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rule_id: input.ruleId, entity_id: input.entityId, event_data: input.eventData ?? {} }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) return res.json();
      } catch (e: unknown) { logger.debug({ err: e instanceof Error ? e.message : String(e) }, "DPCO notification send service unavailable"); }
      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { ok: false, error: "notification-service-unavailable" };
    }),

  signVerificationStatement: protectedProcedure
    .input(z.object({ statementId: z.string(), signedBy: z.string(), userId: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const res = await fetch(`http://localhost:${process.env.DPCO_VERIFICATION_PORT ?? 8320}/api/dpco/verification/statements/${input.statementId}/sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signed_by: input.signedBy, user_id: input.userId ?? ctx.user.id }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) return res.json();
        const err = await res.json().catch(() => ({}));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (err as Record<string, unknown>).error ? String((err as Record<string, unknown>).error) : "Signing failed" });
      } catch (e: unknown) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "dpco-verification-service unavailable" });
      }
    }),

  microserviceHealth: protectedProcedure
    .query(async () => {
      const services = [
        { name: "dpco-audit-service", port: Number(process.env.DPCO_AUDIT_PORT ?? 8300), stack: "Go/Temporal/Keycloak/Permify/Kafka/Redis" },
        { name: "dpco-registry-service", port: Number(process.env.DPCO_REGISTRY_PORT ?? 8310), stack: "Go/Dapr/TigerBeetle/Redis/APISIX" },
        { name: "dpco-verification-service", port: Number(process.env.DPCO_VERIFICATION_PORT ?? 8320), stack: "Go/Temporal/Permify/PKCS7/Kafka" },
        { name: "dpco-analytics-service", port: Number(process.env.DPCO_ANALYTICS_PORT ?? 8330), stack: "Python/Kafka/Fluvio/Lakehouse/Dapr" },
        { name: "dpco-notification-service", port: Number(process.env.DPCO_NOTIFICATION_PORT ?? 8340), stack: "Python/Dapr/Kafka/Fluvio/Redis" },
      ];
      const results = await Promise.all(
        services.map(async (svc) => {
          const start = Date.now();
          try {
            const res = await fetch(`http://localhost:${svc.port}/health`, { signal: AbortSignal.timeout(3000) });
            const data = res.ok ? await res.json().catch(() => null) : null;
            return { ...svc, status: res.ok ? "healthy" : "degraded", latencyMs: Date.now() - start, details: data };
          } catch {
            return { ...svc, status: "unreachable", latencyMs: Date.now() - start, details: null };
          }
        })
      );
      return { services: results, checkedAt: new Date() };
    }),

  // ── Evidence Vault ────────────────────────────────────────────────────────
  listEvidence: protectedProcedure
    .input(z.object({
      engagement_id: z.string().optional(),
      dpco_org_id:   z.string().optional(),
      category:      z.string().optional(),
      limit:         z.number().default(50),
      offset:        z.number().default(0),
    }))
    .query(async ({ input }) => {
      const conditions: string[] = ["1=1"];
      const params: unknown[] = [];
      if (input.engagement_id) { conditions.push("engagement_id = $" + (params.length + 1)); params.push(input.engagement_id); }
      if (input.dpco_org_id)   { conditions.push("dpco_org_id = $" + (params.length + 1));   params.push(input.dpco_org_id); }
      if (input.category)      { conditions.push("category = $" + (params.length + 1));       params.push(input.category); }
      const where = conditions.join(" AND ");
      const rows = await q(
        `SELECT * FROM dpco_evidence_items WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, input.limit, input.offset]
      );
      const [{ total }] = await q<{ total: string }>(
        `SELECT COUNT(*) as total FROM dpco_evidence_items WHERE ${where}`, params
      );
      return { rows, total: Number(total), limit: input.limit, offset: input.offset };
    }),

  addEvidence: protectedProcedure
    .input(z.object({
      engagement_id:   z.string().optional(),
      dpco_org_id:     z.string().optional(),
      file_name:       z.string(),
      file_key:        z.string(),
      file_url:        z.string().url(),
      file_size_bytes: z.number().default(0),
      mime_type:       z.string().optional(),
      sha256_hash:     z.string().length(64),
      category:        z.enum(["privacy_policy","dpia","training_record","ropa","dpa_contract","breach_report","consent_record","audit_report","other"]).default("other"),
      description:     z.string().optional(),
      finding_ref:     z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const existing = await q("SELECT id, file_name FROM dpco_evidence_items WHERE sha256_hash = $1", [input.sha256_hash]);
      if (existing.length > 0) {
        const dup = existing[0] as any;
        emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
        return { id: dup.id, duplicate: true, message: `Identical file already exists: ${dup.file_name}` };
      }
      const id = crypto.randomUUID();
      await q(
        `INSERT INTO dpco_evidence_items
          (id, engagement_id, dpco_org_id, uploaded_by, file_name, file_key, file_url,
           file_size_bytes, mime_type, sha256_hash, category, description, finding_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id, input.engagement_id ?? null, input.dpco_org_id ?? null, ctx.user.id,
          input.file_name, input.file_key, input.file_url, input.file_size_bytes,
          input.mime_type ?? null, input.sha256_hash, input.category,
          input.description ?? null, input.finding_ref ?? null,
        ]
      );
      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { id, duplicate: false, message: "Evidence item added successfully" };
    }),

  verifyEvidence: protectedProcedure
    .input(z.object({ id: z.string(), sha256_hash: z.string().length(64) }))
    .mutation(async ({ input, ctx }) => {
      const [item] = await q("SELECT * FROM dpco_evidence_items WHERE id = $1", [input.id]) as Record<string, unknown>[];
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Evidence item not found" });
      const tampered = item.sha256_hash !== input.sha256_hash;
      await q(
        "UPDATE dpco_evidence_items SET is_tampered = $1, verified_at = NOW(), verified_by = $2 WHERE id = $3",
        [tampered, ctx.user.id, input.id]
      );
      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { id: input.id, tampered, storedHash: item.sha256_hash, providedHash: input.sha256_hash };
    }),

  deleteEvidence: deleteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await q("DELETE FROM dpco_evidence_items WHERE id = $1", [input.id]);
      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  // ── Client Compliance Dashboard ──────────────────────────────────────────
  getClientDetail: protectedProcedure
    .input(z.object({ clientId: z.number().int() }))
    .query(async ({ input }) => {
      const [client] = await q<any>(
        `SELECT dc.*, o.name as org_name, o.sector, o.compliance_score, o.registration_number
         FROM dpco_clients dc
         LEFT JOIN organizations o ON o.id = dc.organisation_id
         WHERE dc.id = $1`,
        [input.clientId]
      );
      if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
      const correctiveActions = await q<any>(
        `SELECT id, findings_summary, corrective_actions, statement_date, status, compliance_score
         FROM dpco_verification_statements
         WHERE organisation_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [client.organisation_id]
      );
      const dpiaRenewals = await q<any>(
        `SELECT id, title, review_date, risk_level, status
         FROM dpia_assessments
         WHERE organization_id = $1 AND review_date >= CURRENT_DATE
         ORDER BY review_date ASC LIMIT 5`,
        [client.organisation_id]
      );
      const [trainingStats] = await q<any>(
        `SELECT COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'completed') as completed
         FROM staff_training_records
         WHERE organization_id = $1`,
        [client.organisation_id]
      );
      const recentBreaches = await q<any>(
        `SELECT id, title, severity, status, detected_at, ndpc_notified_at
         FROM breach_incidents
         WHERE organization_id = $1
         ORDER BY detected_at DESC LIMIT 5`,
        [client.organisation_id]
      );
      return {
        client,
        correctiveActions,
        dpiaRenewals,
        trainingCompletion: trainingStats
          ? { total: Number(trainingStats.total), completed: Number(trainingStats.completed) }
          : { total: 0, completed: 0 },
        recentBreaches,
      };
    }),

  clientComplianceTrend: protectedProcedure
    .input(z.object({ organisationId: z.number().int() }))
    .query(async ({ input }) => {
      const platformTrend = await q<any>(
        `SELECT TO_CHAR(DATE_TRUNC('month', snapshot_date), 'Mon YYYY') as month,
                ROUND(AVG(composite_score)::numeric, 1) as avg_score
         FROM ndpa_compliance_snapshots
         WHERE snapshot_date >= CURRENT_DATE - INTERVAL '12 months'
         GROUP BY DATE_TRUNC('month', snapshot_date)
         ORDER BY DATE_TRUNC('month', snapshot_date) ASC`,
        []
      );
      const orgTrend = await q<any>(
        `SELECT TO_CHAR(DATE_TRUNC('month', submitted_at), 'Mon YYYY') as month,
                ROUND(AVG(compliance_score)::numeric, 1) as avg_score
         FROM portal_submissions
         WHERE org_name = (SELECT name FROM organizations WHERE id = $1 LIMIT 1)
           AND submitted_at >= CURRENT_DATE - INTERVAL '12 months'
         GROUP BY DATE_TRUNC('month', submitted_at)
         ORDER BY DATE_TRUNC('month', submitted_at) ASC`,
        [input.organisationId]
      );
      return { platformTrend, orgTrend };
    }),

  submitRenewalApplication: protectedProcedure
    .input(z.object({
      dpcoOrgId: z.number().int(),
      renewalYear: z.number().int(),
      piInsuranceValue: z.number().optional(),
      piInsuranceExpiry: z.string().optional(),
      staffCount: z.number().int().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await q(
        `UPDATE dpco_organisations SET status = 'pending', updated_at = NOW() WHERE id = $1`,
        [input.dpcoOrgId]
      );
      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, message: "Renewal application submitted to NDPC for review" };
    }),
  deleteOrganisation: deleteProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }: { input: { id: number } }) => deleteDpcoOrganisation(input.id)),

  // ── Self-Registration Portal (public) ───────────────────────────────────────────

  registerOrganisation: publicProcedure
    .input(
      z.object({
        name: z.string().min(2).max(200),
        organisationType: z.enum(["private", "public", "ngo", "academic", "government"]).default("private"),
        email: z.string().email(),
        phone: z.string().min(7).max(20),
        website: z.string().url().optional(),
        state: z.string().min(2).max(50),
        address: z.string().min(5).max(500),
        cacNumber: z.string().min(3).max(50),
        ndpcReference: z.string().optional(),
        services: z.array(z.string()).min(1),
        staffCount: z.number().int().min(1).optional(),
        contactPersonName: z.string().min(2).max(200),
        contactPersonRole: z.string().min(2).max(100),
        declarationAccepted: z.literal(true),
      })
    )
    .mutation(async ({ input }) => {
      // Check for duplicate email or CAC number
      const [existing] = await q<any>(
        `SELECT id FROM dpco_organisations WHERE email = ? OR cac_number = ?`,
        [input.email, input.cacNumber]
      );
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An organisation with this email or CAC number is already registered.",
        });
      }

      // Generate provisional licence number
      const year = new Date().getFullYear();
      const seq = String(Date.now()).slice(-6);
      const provisionalLicence = `NDPC-DPCO-PROV-${year}-${seq}`;

      const [result] = await q<any>(
        `INSERT INTO dpco_organisations
          (name, licence_number, status, organisation_type, email, phone, website,
           state, address, cac_number, ndpc_reference, services, staff_count)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         RETURNING id`,
        [
          input.name,
          provisionalLicence,
          "pending",
          input.organisationType,
          input.email,
          input.phone,
          input.website ?? null,
          input.state,
          input.address,
          input.cacNumber,
          input.ndpcReference ?? null,
          JSON.stringify(input.services),
          input.staffCount ?? null,
        ]
      );

      // Notify platform owner of new registration
      try {
        const { notifyOwner } = await import("../_core/notification");
        await notifyOwner({
          title: `New DPCO Registration: ${input.name}`,
          content: [
            `Organisation: ${input.name}`,
            `Type: ${input.organisationType}`,
            `Email: ${input.email}`,
            `Phone: ${input.phone}`,
            `State: ${input.state}`,
            `CAC Number: ${input.cacNumber}`,
            `Services: ${input.services.join(", ")}`,
            `Contact: ${input.contactPersonName} (${input.contactPersonRole})`,
            `Provisional Licence: ${provisionalLicence}`,
          ].join("\n"),
        });
      } catch (_) { /* non-fatal */ }

      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return {
        success: true,
        organisationId: result.id,
        provisionalLicence,
        message: "Your registration has been submitted. NDPC will review your application within 5-10 business days.",
      };
    }),

  listPendingRegistrations: protectedProcedure
    .input(
      z.object({
        status: z.enum(["pending", "active", "suspended", "revoked", "all"]).default("pending"),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }).optional()
    )
    .query(async ({ input }) => {
      const status = input?.status ?? "pending";
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;
      const where = status === "all" ? "" : `WHERE status = '${status}'`;
      const rows = await q<any>(
        `SELECT * FROM dpco_organisations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      const [{ total }] = await q<{ total: string }>(
        `SELECT COUNT(*) as total FROM dpco_organisations ${where}`
      );
      return { rows, total: Number(total) };
    }),

  approveRegistration: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        licenceNumber: z.string().min(5).optional(),
        licenceDate: z.string().optional(),
        licenceExpiresAt: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const year = new Date().getFullYear();
      const seq = String(Date.now()).slice(-5);
      const licenceNumber = input.licenceNumber ?? `NDPC-DPCO-${year}-${seq}`;
      const licenceDate = input.licenceDate ?? new Date().toISOString().split("T")[0];
      const licenceExpiresAt = input.licenceExpiresAt ??
        new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      await q(
        `UPDATE dpco_organisations
         SET status = 'active', licence_number = ?, licence_date = ?,
             licence_expires_at = ?, updated_at = NOW()
         WHERE id = ?`,
        [licenceNumber, licenceDate, licenceExpiresAt, input.id]
      );

      const [org] = await q<any>(`SELECT * FROM dpco_organisations WHERE id = ?`, [input.id]);

      try {
        const { notifyOwner } = await import("../_core/notification");
        await notifyOwner({
          title: `DPCO Registration Approved: ${org?.name}`,
          content: `Licence ${licenceNumber} issued to ${org?.name}. Expires: ${licenceExpiresAt}.`,
        });
      } catch (_) { /* non-fatal */ }

      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, licenceNumber, org };
    }),

  rejectRegistration: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        reason: z.string().min(10),
      })
    )
    .mutation(async ({ input }) => {
      await q(
        `UPDATE dpco_organisations SET status = 'revoked', updated_at = NOW() WHERE id = ?`,
        [input.id]
      );
      const [org] = await q<any>(`SELECT * FROM dpco_organisations WHERE id = ?`, [input.id]);

      try {
        const { notifyOwner } = await import("../_core/notification");
        await notifyOwner({
          title: `DPCO Registration Rejected: ${org?.name}`,
          content: `Reason: ${input.reason}`,
        });
      } catch (_) { /* non-fatal */ }

      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, org };
    }),

  // ─── NDPA Control Ratings ────────────────────────────────────────────────────
  getControlRatings: protectedProcedure
    .input(z.object({ engagementId: z.number().int() }))
    .query(async ({ input }) => {
      const rows = await q<any>(
        `SELECT control_id, control_ref, control_title, rating, notes, rated_by, rated_at
         FROM dpco_audit_control_ratings
         WHERE engagement_id = ?
         ORDER BY control_id`,
        [input.engagementId]
      );
      return { ratings: rows };
    }),

  saveControlRatings: protectedProcedure
    .input(
      z.object({
        engagementId: z.number().int(),
        dpcoOrgId: z.number().int(),
        ratings: z.array(
          z.object({
            controlId: z.string(),
            controlRef: z.string().optional(),
            controlTitle: z.string().optional(),
            rating: z.enum(["compliant", "partial", "non_compliant", "not_assessed"]),
            notes: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input, ctx }) => {
      for (const r of input.ratings) {
        await q(
          `INSERT INTO dpco_audit_control_ratings
             (engagement_id, dpco_org_id, control_id, control_ref, control_title, rating, notes, rated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             rating = VALUES(rating),
             notes = VALUES(notes),
             rated_by = VALUES(rated_by),
             updated_at = NOW()`,
          [
            input.engagementId,
            input.dpcoOrgId,
            r.controlId,
            r.controlRef ?? null,
            r.controlTitle ?? null,
            r.rating,
            r.notes ?? null,
            ctx.user?.name ?? "DPCO User",
          ]
        );
      }
      // Auto-calculate and write compliance_score back to the engagement
      const compliantCount = input.ratings.filter(r => r.rating === "compliant").length;
      const totalControls = input.ratings.length;
      const score = totalControls > 0 ? Math.round((compliantCount / totalControls) * 100) : null;
      if (score !== null) {
        await q(
          `UPDATE dpco_audit_engagements SET compliance_score = ?, updated_at = NOW() WHERE id = ?`,
          [score, input.engagementId]
        );
      }
      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, saved: input.ratings.length, complianceScore: score };
    }),

  // ─── Client Policy Assignments ────────────────────────────────────────────────
  listClientPolicies: protectedProcedure
    .input(z.object({
      dpcoOrgId: z.number().int(),
      clientId: z.number().int().optional(),
    }))
    .query(async ({ input }) => {
      const conditions = ["dpco_org_id = ?"];
      const params: unknown[] = [input.dpcoOrgId];
      if (input.clientId) { conditions.push("client_id = ?"); params.push(input.clientId); }
      const rows = await q<any>(
        `SELECT p.*, c.org_name AS client_name
         FROM dpco_client_policies p
         LEFT JOIN dpco_clients c ON c.id = p.client_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY p.assigned_at DESC`,
        params
      );
      return { policies: rows };
    }),

  assignClientPolicy: protectedProcedure
    .input(z.object({
      dpcoOrgId: z.number().int(),
      clientId: z.number().int(),
      templateId: z.string(),
      templateTitle: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await q(
        `INSERT INTO dpco_client_policies (dpco_org_id, client_id, template_id, template_title, notes, assigned_by, assigned_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE template_title = VALUES(template_title), notes = VALUES(notes), updated_at = NOW()`,
        [input.dpcoOrgId, input.clientId, input.templateId, input.templateTitle, input.notes ?? null, ctx.user?.name ?? "DPCO User"]
      );
      const [row] = await q<any>(`SELECT * FROM dpco_client_policies WHERE dpco_org_id = ? AND client_id = ? AND template_id = ?`, [input.dpcoOrgId, input.clientId, input.templateId]);
      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, policy: row };
    }),

  updateClientPolicyStatus: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(["draft", "customised", "reviewed", "signed", "delivered"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await q(
        `UPDATE dpco_client_policies SET status = ?, notes = COALESCE(?, notes), updated_at = NOW() WHERE id = ?`,
        [input.status, input.notes ?? null, input.id]
      );
      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  // ─── Evidence Control Tagging ─────────────────────────────────────────────────
  tagEvidenceControls: protectedProcedure
    .input(z.object({
      evidenceItemId: z.number().int(),
      controlIds: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      await q(
        `UPDATE dpco_evidence_items SET control_ids = ?, updated_at = NOW() WHERE id = ?`,
        [JSON.stringify(input.controlIds), input.evidenceItemId]
      );
      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, controlIds: input.controlIds };
    }),

  getEvidenceCoverage: protectedProcedure
    .input(z.object({ engagementId: z.number().int() }))
    .query(async ({ input }) => {
      const rows = await q<any>(
        `SELECT e.id, e.file_name, e.control_ids, e.created_at
         FROM dpco_evidence_items e
         WHERE e.engagement_id = ? AND e.control_ids IS NOT NULL`,
        [input.engagementId]
      );
      const coverage: Record<string, number> = {};
      for (const row of rows) {
        const ids: string[] = row.control_ids ? JSON.parse(row.control_ids) : [];
        for (const id of ids) {
          coverage[id] = (coverage[id] ?? 0) + 1;
        }
      }
      return { coverage, evidenceItems: rows };
    }),

  // ─── Engagement Requests (Org Portal → DPCO) ─────────────────────────────────

  // Public: list active DPCOs for the Org Portal DPCO browser
  listActiveDpcos: publicProcedure
    .input(z.object({
      search: z.string().optional(),
      sector: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const conditions: string[] = ["status = 'active'"];
      const params: unknown[] = [];
      if (input.search) {
        conditions.push("(name ILIKE ? OR email ILIKE ?)");
        const s = `%${input.search}%`;
        params.push(s, s);
      }
      if (input.sector) {
        conditions.push("? = ANY(sectors)");
        params.push(input.sector);
      }
      const where = `WHERE ${conditions.join(" AND ")}`;
      const rows = await q(
        `SELECT id, name, licence_number, status, tier, email, phone, dpo_name, dpo_email,
                services, sectors, website, logo_url, licence_expires_at, approved_at
         FROM dpco_organisations ${where}
         ORDER BY name ASC LIMIT ? OFFSET ?`,
        [...params, input.limit, input.offset]
      );
      const [{ total }] = await q<{ total: number }>(
        `SELECT COUNT(*) as total FROM dpco_organisations ${where}`, params
      );
      return { rows, total };
    }),

  // Public: submit an engagement request from the Org Portal
  submitEngagementRequest: publicProcedure
    .input(z.object({
      orgName: z.string().min(2),
      orgSector: z.string().optional(),
      orgCountry: z.string().optional(),
      orgRegistrationNumber: z.string().optional(),
      contactName: z.string().min(2),
      contactEmail: z.string().email(),
      contactPhone: z.string().optional(),
      dpcoOrgId: z.number().int(),
      auditScope: z.string().optional(),
      preferredStartDate: z.string().optional(),
      estimatedDataSubjects: z.string().optional(),
      processingActivities: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      // Verify DPCO exists and is active
      const [dpco] = await q("SELECT id, name FROM dpco_organisations WHERE id = ? AND status = 'active'", [input.dpcoOrgId]);
      if (!dpco) throw new TRPCError({ code: "NOT_FOUND", message: "DPCO not found or not active" });
      // Generate reference token
      const token = `ENG-${Date.now().toString(36).toUpperCase()}-${Array.from(crypto.getRandomValues(new Uint8Array(3))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
      const [row] = await q(
        `INSERT INTO dpco_engagement_requests
           (org_name, org_sector, org_country, org_registration_number,
            contact_name, contact_email, contact_phone,
            dpco_org_id, audit_scope, preferred_start_date,
            estimated_data_subjects, processing_activities,
            status, reference_token, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,\'pending\',?,NOW(),NOW())
         RETURNING *`,
        [
          input.orgName, input.orgSector ?? null, input.orgCountry ?? null,
          input.orgRegistrationNumber ?? null, input.contactName, input.contactEmail,
          input.contactPhone ?? null, input.dpcoOrgId, input.auditScope ?? null,
          input.preferredStartDate ? new Date(input.preferredStartDate) : null,
          input.estimatedDataSubjects ?? null,
          input.processingActivities ? JSON.stringify(input.processingActivities) : null,
          token,
        ]
      );
      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, referenceToken: token, dpcoName: dpco.name, request: row };
    }),

  // Public: check status of an engagement request by reference token
  getEngagementRequestStatus: publicProcedure
    .input(z.object({ referenceToken: z.string() }))
    .query(async ({ input }) => {
      const [row] = await q(
        `SELECT r.*, d.name as dpco_name, d.email as dpco_email, d.phone as dpco_phone
         FROM dpco_engagement_requests r
         JOIN dpco_organisations d ON d.id = r.dpco_org_id
         WHERE r.reference_token = ?`,
        [input.referenceToken]
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      return row;
    }),

  // Protected (DPCO): list incoming engagement requests for this DPCO
  listIncomingRequests: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const dpcoOrgId = (ctx.user as Record<string, unknown>).dpcoOrgId;
      if (!dpcoOrgId) throw new TRPCError({ code: "FORBIDDEN", message: "Not a DPCO user" });
      const conditions = ["dpco_org_id = ?"];
      const params: unknown[] = [dpcoOrgId];
      if (input.status) { conditions.push("status = ?"); params.push(input.status); }
      const where = `WHERE ${conditions.join(" AND ")}`;
      const rows = await q(
        `SELECT * FROM dpco_engagement_requests ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, input.limit, input.offset]
      );
      const [{ total }] = await q<{ total: number }>(
        `SELECT COUNT(*) as total FROM dpco_engagement_requests ${where}`, params
      );
      return { rows, total };
    }),

  // Protected (DPCO): respond to an engagement request (accept/decline)
  respondToEngagementRequest: protectedProcedure
    .input(z.object({
      requestId: z.number().int(),
      decision: z.enum(["accepted", "declined"]),
      responseNote: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const dpcoOrgId = (ctx.user as Record<string, unknown>).dpcoOrgId;
      if (!dpcoOrgId) throw new TRPCError({ code: "FORBIDDEN", message: "Not a DPCO user" });
      const [req] = await q(
        "SELECT * FROM dpco_engagement_requests WHERE id = ? AND dpco_org_id = ?",
        [input.requestId, dpcoOrgId]
      );
      if (!req) throw new TRPCError({ code: "NOT_FOUND", message: "Request not found" });
      if (req.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Request already responded to" });
      await q(
        `UPDATE dpco_engagement_requests
         SET status = ?, dpco_response_note = ?, responded_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [input.decision, input.responseNote ?? null, input.requestId]
      );

      // Auto-create audit engagement when accepted
      let engagementId: number | null = null;
      if (input.decision === "accepted") {
        const title = `${req.org_name ?? "Organisation"} — NDPA 2023 Compliance Audit`;
        const plannedStart = new Date().toISOString().split("T")[0];
        const plannedEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        const [result] = await q<any>(
          `INSERT INTO dpco_audit_engagements (dpco_org_id, client_id, title, current_stage, lead_auditor, planned_start, planned_end, notes)
           VALUES (?, ?, ?, 'initiated', ?, ?, ?, ?) RETURNING id`,
          [
            dpcoOrgId,
            null, // client_id will be linked manually if needed
            title,
            ctx.user.name ?? "Lead Auditor",
            plannedStart,
            plannedEnd,
            `Auto-created from engagement request #${input.requestId}. Scope: ${req.audit_scope ?? "Full NDPA 2023 compliance audit"}. Contact: ${req.contact_name ?? ""} <${req.contact_email ?? ""}>`,
          ]
        );
        engagementId = result?.id ?? null;
      }

      emitMutationEvent("ndsep.dpco.mutation", { action: "dpco", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, decision: input.decision, engagementId };
    }),

  getPerformanceMetrics: protectedProcedure
    .input(z.object({ dpcoOrgId: z.number().optional() }))
    .query(async ({ input }) => {
      const where = input.dpcoOrgId ? "WHERE dpco_org_id = ?" : "";
      const params = input.dpcoOrgId ? [input.dpcoOrgId] : [];
      const rows = await q<any>(
        `SELECT dpco_org_id, metric_name, metric_value, period_start, period_end, recorded_at
         FROM dpco_performance_metrics ${where}
         ORDER BY dpco_org_id, period_end DESC, metric_name`,
        params
      );
      // Group by dpco_org_id — take most recent value per metric
      const grouped: Record<number, Record<string, number>> = {};
      for (const row of rows) {
        const orgId = Number(row.dpco_org_id);
        if (!grouped[orgId]) grouped[orgId] = {};
        if (grouped[orgId][row.metric_name] === undefined) {
          grouped[orgId][row.metric_name] = Number(row.metric_value);
        }
      }
      return { metrics: grouped, rows };
    }),
});
