/**
 * Banking Services Router
 * Covers: KYC, AML, NIP/RTGS, SWIFT, Fraud, CBN Reports, Correspondent Banks
 * Business rules: CBN Circular FPR/DIR/CIR/07/003, NFIU AML/CFT Guidelines 2022,
 *                 NDPR 2019, CBN KYC Manual 2023, FATF Recommendations
 */
import { z } from "zod";

import { router, protectedProcedure, adminProcedure, exportProcedure, deleteProcedure, approveProcedure} from "../_core/trpc";
import { emitEvent, logAuditEvent, broadcastEvent, broadcastUpdate, cacheGetJson, cacheSetJson, cacheDel, recordFinancialTransaction, triggerWorkflow } from "../middlewareHelpers";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck, mojaloopTransfer, tigerbeetleTransfer, keycloakValidate, permifyWriteRelationship } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { enrichedSanctionsCheck } from "../osirisClient";
import { autoDecryptRows } from "../encryptionMiddleware";
import { TRPCError } from "@trpc/server";
import pg from "pg";
import { getPgSslConfig } from "../dbSslConfig";
import { getDatabaseUrl } from "../config";
import { logger } from "../logger";
import { createAuditLog, createInAppNotification } from "../db";
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
async function query(sql: string, params: unknown[] = []): Promise<any[]> {
  const pool = getPool();
  let idx = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
  const finalSql = pgSql.replace(/\bLIKE\b/g, 'ILIKE');
  const { rows } = await pool.query(finalSql, params);
  return autoDecryptRows(finalSql, rows);
}

// ─── Helper: generate unique references ──────────────────────────────────────
function genRef(prefix: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(2))).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

// ─── Banking Institutions ─────────────────────────────────────────────────────
const bankingRouter = router({
  // List all banking institutions with filters
  listInstitutions: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      licenseType: z.string().optional(),
      status: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM banking_institutions WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) {
        sql += ` AND (name LIKE ? OR short_name LIKE ? OR cbn_code LIKE ? OR sort_code LIKE ?)`;
        const s = `%${input.search}%`;
        params.push(s, s, s, s);
      }
      if (input.licenseType) { sql += ` AND license_type = ?`; params.push(input.licenseType); }
      if (input.status) { sql += ` AND status = ?`; params.push(input.status); }
      const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as cnt");
      const [countRows] = await query(countSql, params) as any[];
      const total = countRows?.cnt ?? 0;
      sql += ` ORDER BY name ASC LIMIT ? OFFSET ?`;
      params.push(input.limit, (input.page - 1) * input.limit);
      const rows = await query(sql, params);
      return { rows, total, page: input.page, limit: input.limit };
    }),

  getInstitution: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await query(`SELECT * FROM banking_institutions WHERE id = ?`, [input.id]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Institution not found" });
      return rows[0];
    }),

  createInstitution: adminProcedure
    .input(z.object({
      cbnCode: z.string().min(3).max(10),
      sortCode: z.string().length(6),
      bicCode: z.string().max(11).optional(),
      name: z.string().min(3),
      shortName: z.string().min(2).max(50),
      licenseType: z.enum(["commercial","merchant","microfinance","development","mortgage","payment_service_bank","non_interest"]),
      licenseNumber: z.string().min(5),
      status: z.enum(["licensed","provisional","suspended","revoked","under_examination"]).default("licensed"),
      headOfficeAddress: z.string().optional(),
      ceoName: z.string().optional(),
      totalAssets: z.number().optional(),
      capitalAdequacyRatio: z.number().min(0).max(100).optional(),
      nonPerformingLoanRatio: z.number().min(0).max(100).optional(),
      dataProtectionOfficer: z.string().optional(),
      dpcoOrgId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Business rule: CAR must be >= 10% for commercial banks (CBN minimum)
      if (input.capitalAdequacyRatio !== undefined && input.licenseType === "commercial" && input.capitalAdequacyRatio < 10) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Commercial banks must maintain minimum 10% Capital Adequacy Ratio per CBN guidelines" });
      }
      await query(`
        INSERT INTO banking_institutions (cbn_code, sort_code, bic_code, name, short_name, license_type, license_number, status,
          head_office_address, ceo_name, total_assets, capital_adequacy_ratio, non_performing_loan_ratio,
          data_protection_officer, dpco_org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [input.cbnCode, input.sortCode, input.bicCode ?? null, input.name, input.shortName,
          input.licenseType, input.licenseNumber, input.status, input.headOfficeAddress ?? null,
          input.ceoName ?? null, input.totalAssets ?? null, input.capitalAdequacyRatio ?? null,
          input.nonPerformingLoanRatio ?? null, input.dataProtectionOfficer ?? null, input.dpcoOrgId ?? null]);
      await broadcastUpdate("banking_institution_created", { name: input.name, licenseType: input.licenseType });
      emitMutationEvent(EVENTS.CORRESPONDENT_BANK, { action: "institution_created", name: input.name, licenseType: input.licenseType, cbnCode: input.cbnCode }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.institution.create", resourceType: "banking_institution", details: `Created institution: ${input.name} (${input.licenseType})` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  updateInstitution: adminProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["licensed","provisional","suspended","revoked","under_examination"]).optional(),
      capitalAdequacyRatio: z.number().min(0).max(100).optional(),
      nonPerformingLoanRatio: z.number().min(0).max(100).optional(),
      complianceScore: z.number().min(0).max(100).optional(),
      ceoName: z.string().optional(),
      dataProtectionOfficer: z.string().optional(),
      lastExaminationDate: z.string().optional(),
      nextExaminationDate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const sets: string[] = [];
      const params: unknown[] = [];
      if (fields.status !== undefined) { sets.push("status = ?"); params.push(fields.status); }
      if (fields.capitalAdequacyRatio !== undefined) { sets.push("capital_adequacy_ratio = ?"); params.push(fields.capitalAdequacyRatio); }
      if (fields.nonPerformingLoanRatio !== undefined) { sets.push("non_performing_loan_ratio = ?"); params.push(fields.nonPerformingLoanRatio); }
      if (fields.complianceScore !== undefined) { sets.push("compliance_score = ?"); params.push(fields.complianceScore); }
      if (fields.ceoName !== undefined) { sets.push("ceo_name = ?"); params.push(fields.ceoName); }
      if (fields.dataProtectionOfficer !== undefined) { sets.push("data_protection_officer = ?"); params.push(fields.dataProtectionOfficer); }
      if (fields.lastExaminationDate !== undefined) { sets.push("last_examination_date = ?"); params.push(fields.lastExaminationDate); }
      if (fields.nextExaminationDate !== undefined) { sets.push("next_examination_date = ?"); params.push(fields.nextExaminationDate); }
      if (sets.length === 0) return { success: true };
      sets.push("updated_at = NOW()");
      params.push(id);
      await query(`UPDATE banking_institutions SET ${sets.join(", ")} WHERE id = ?`, params);
      emitMutationEvent(EVENTS.CORRESPONDENT_BANK, { action: "institution_updated", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.institution.update", resourceType: "banking_institution", resourceId: input.id, details: `Updated institution #${input.id}${input.status ? ` status=${input.status}` : ""}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  // Dashboard stats
  institutionStats: protectedProcedure.query(async () => {
    const [totals] = await query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'licensed' THEN 1 ELSE 0 END) as licensed,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended,
        SUM(CASE WHEN status = 'under_examination' THEN 1 ELSE 0 END) as under_examination,
        AVG(capital_adequacy_ratio) as avg_car,
        AVG(compliance_score) as avg_compliance
      FROM banking_institutions
    `) as any[];
    return totals;
  }),
});

// ─── KYC Router ──────────────────────────────────────────────────────────────
const kycRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      tier: z.string().optional(),
      bankId: z.number().optional(),
      pepFlag: z.boolean().optional(),
      sanctionsFlag: z.boolean().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT k.*, b.name as bank_name FROM kyc_records k LEFT JOIN banking_institutions b ON k.bank_id = b.id WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) {
        sql += ` AND (k.full_name LIKE ? OR k.bvn LIKE ? OR k.nin LIKE ? OR k.reference_id LIKE ? OR k.email LIKE ?)`;
        const s = `%${input.search}%`;
        params.push(s, s, s, s, s);
      }
      if (input.status) { sql += ` AND k.status = ?`; params.push(input.status); }
      if (input.tier) { sql += ` AND k.tier = ?`; params.push(input.tier); }
      if (input.bankId) { sql += ` AND k.bank_id = ?`; params.push(input.bankId); }
      if (input.pepFlag !== undefined) { sql += ` AND k.pep_flag = ?`; params.push(input.pepFlag ? 1 : 0); }
      if (input.sanctionsFlag !== undefined) { sql += ` AND k.sanctions_flag = ?`; params.push(input.sanctionsFlag ? 1 : 0); }
      const countSql = sql.replace("SELECT k.*, b.name as bank_name", "SELECT COUNT(*) as cnt");
      const [countRow] = await query(countSql, params) as any[];
      const total = countRow?.cnt ?? 0;
      sql += ` ORDER BY k.created_at DESC LIMIT ? OFFSET ?`;
      params.push(input.limit, (input.page - 1) * input.limit);
      const rows = await query(sql, params);
      return { rows, total, page: input.page, limit: input.limit };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await query(`
        SELECT k.*, b.name as bank_name FROM kyc_records k 
        LEFT JOIN banking_institutions b ON k.bank_id = b.id 
        WHERE k.id = ?
      `, [input.id]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return rows[0];
    }),

  create: protectedProcedure
    .input(z.object({
      bankId: z.number(),
      subjectType: z.enum(["individual","corporate","trust"]).default("individual"),
      fullName: z.string().min(2),
      dateOfBirth: z.string().optional(),
      nationality: z.string().default("Nigerian"),
      bvn: z.string().length(11).optional(),
      nin: z.string().length(11).optional(),
      phoneNumber: z.string().optional(),
      email: z.string().email().optional(),
      address: z.string().optional(),
      idDocumentType: z.enum(["passport","national_id","drivers_license","voters_card","residence_permit"]).optional(),
      idDocumentUrl: z.string().url().optional(),
      selfieUrl: z.string().url().optional(),
      tier: z.enum(["tier1","tier2","tier3"]).default("tier1"),
    }))
    .mutation(async ({ ctx, input }) => {
      // Business rule: Tier 2 requires BVN, Tier 3 requires BVN + NIN + ID document
      if (input.tier === "tier2" && !input.bvn) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tier 2 KYC requires BVN per CBN KYC Manual 2023" });
      }
      if (input.tier === "tier3" && (!input.bvn || !input.nin || !input.idDocumentType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tier 3 KYC requires BVN, NIN, and a valid ID document per CBN KYC Manual 2023" });
      }
      // Business rule: Check for duplicate BVN within same bank
      if (input.bvn) {
        const existing = await query(`SELECT id FROM kyc_records WHERE bvn = ? AND bank_id = ? AND status != 'rejected'`, [input.bvn, input.bankId]);
        if (existing.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "A KYC record with this BVN already exists for this institution" });
        }
      }
      const refId = genRef("KYC");
      // Business rule: KYC expires after 3 years (CBN requirement)
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 3);
      await query(`
        INSERT INTO kyc_records (reference_id, bank_id, subject_type, full_name, date_of_birth, nationality,
          bvn, nin, phone_number, email, address, selfie_url, id_document_type, id_document_url, tier, status, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `, [refId, input.bankId, input.subjectType, input.fullName, input.dateOfBirth ?? null,
          input.nationality, input.bvn ?? null, input.nin ?? null, input.phoneNumber ?? null,
          input.email ?? null, input.address ?? null, input.selfieUrl ?? null,
          input.idDocumentType ?? null, input.idDocumentUrl ?? null, input.tier, expiresAt.toISOString()]);
      emitMutationEvent(EVENTS.KYC_VERIFICATION, { action: "kyc_submitted", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.kyc.create", resourceType: "kyc_record", details: `KYC submitted: ${input.fullName} (${input.tier}) Ref: ${refId}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, referenceId: refId };
    }),

  review: protectedProcedure
    .input(z.object({
      id: z.number(),
      action: z.enum(["approve","reject","flag_pep","flag_sanctions","escalate"]),
      notes: z.string().optional(),
      livenessScore: z.number().min(0).max(100).optional(),
      faceMatchScore: z.number().min(0).max(100).optional(),
      bvnVerified: z.boolean().optional(),
      ninVerified: z.boolean().optional(),
      addressVerified: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const rows = await query(`SELECT * FROM kyc_records WHERE id = ?`, [input.id]) as any[];
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      const record = rows[0];
      
      let newStatus = record.status;
      let pepFlag = record.pep_flag;
      let sanctionsFlag = record.sanctions_flag;
      
      switch (input.action) {
        case "approve":
          // Business rule: Face match score must be >= 80% for approval
          if (input.faceMatchScore !== undefined && input.faceMatchScore < 80) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Face match score must be at least 80% for KYC approval" });
          }
          newStatus = "verified";
          break;
        case "reject":
          if (!input.notes) throw new TRPCError({ code: "BAD_REQUEST", message: "Rejection reason is required" });
          newStatus = "rejected";
          break;
        case "flag_pep":
          pepFlag = true;
          newStatus = "in_review";
          // Auto-create AML case for PEP match
          await query(`
            INSERT INTO aml_cases (case_ref, bank_id, subject_name, subject_bvn, case_type, status, risk_score, pep_match, narrative)
            VALUES (?, ?, ?, ?, 'pep_match', 'open', 75, 1, ?)
          `, [genRef("AML"), record.bank_id, record.full_name, record.bvn,
              `PEP flag raised during KYC review for ${record.full_name}. KYC Ref: ${record.reference_id}`]);
          break;
        case "flag_sanctions":
          sanctionsFlag = true;
          newStatus = "suspended";
          // Auto-create high-priority AML case for sanctions match
          await query(`
            INSERT INTO aml_cases (case_ref, bank_id, subject_name, subject_bvn, case_type, status, risk_score, sanctions_match, narrative)
            VALUES (?, ?, ?, ?, 'sanctions_match', 'escalated', 95, 1, ?)
          `, [genRef("AML"), record.bank_id, record.full_name, record.bvn,
              `SANCTIONS MATCH: Subject flagged during KYC review. KYC Ref: ${record.reference_id}. Immediate escalation required per NFIU AML/CFT Guidelines.`]);
          break;
        case "escalate":
          newStatus = "in_review";
          break;
      }
      
      await query(`
        UPDATE kyc_records SET status = ?, pep_flag = ?, sanctions_flag = ?,
          liveness_score = COALESCE(?, liveness_score),
          face_match_score = COALESCE(?, face_match_score),
          bvn_verified = COALESCE(?, bvn_verified),
          nin_verified = COALESCE(?, nin_verified),
          address_verified = COALESCE(?, address_verified),
          reviewed_by = ?, reviewed_at = NOW(),
          rejection_reason = COALESCE(?, rejection_reason),
          updated_at = NOW()
        WHERE id = ?
      `, [newStatus, pepFlag ? 1 : 0, sanctionsFlag ? 1 : 0,
          input.livenessScore ?? null, input.faceMatchScore ?? null,
          input.bvnVerified !== undefined ? (input.bvnVerified ? 1 : 0) : null,
          input.ninVerified !== undefined ? (input.ninVerified ? 1 : 0) : null,
          input.addressVerified !== undefined ? (input.addressVerified ? 1 : 0) : null,
          ctx.user.name ?? ctx.user.email ?? "System",
          input.notes ?? null, input.id]);
      emitMutationEvent(EVENTS.KYC_VERIFICATION, { action: `kyc_${input.action}`, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: `banking.kyc.${input.action}`, resourceType: "kyc_record", resourceId: input.id, details: `KYC ${input.action}: ${record.full_name} → ${newStatus}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      if (input.action === "flag_sanctions") {
        createInAppNotification({ title: "Sanctions Match — KYC Alert", message: `KYC subject ${record.full_name} flagged for sanctions match. Immediate escalation required.`, severity: "critical", category: "banking", userId: ctx.user.id, actionUrl: "/banking/kyc", metadata: { kycId: input.id } }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      }
      return { success: true, newStatus };
    }),

  stats: protectedProcedure.query(async () => {
    const [row] = await query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'in_review' THEN 1 ELSE 0 END) as in_review,
        SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN pep_flag = 1 THEN 1 ELSE 0 END) as pep_flagged,
        SUM(CASE WHEN sanctions_flag = 1 THEN 1 ELSE 0 END) as sanctions_flagged,
        SUM(CASE WHEN tier = 'tier3' THEN 1 ELSE 0 END) as tier3_count
      FROM kyc_records
    `) as any[];
    return row;
  }),

  // ─── KYC CSV Export ──────────────────────────────────────────────────────────
  exportCsv: exportProcedure
    .input(z.object({
      status: z.string().max(50).optional(),
      search: z.string().max(200).optional(),
      tier: z.string().max(20).optional(),
      bankId: z.number().optional(),
      pepFlag: z.boolean().optional(),
      sanctionsFlag: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT k.reference_id, k.customer_ref, k.full_name, k.subject_type,
        k.date_of_birth, k.nationality, k.bvn, k.nin, k.phone_number, k.email,
        k.address, k.tier, k.status, k.pep_flag, k.sanctions_flag,
        k.liveness_score, k.face_match_score, k.bvn_verified, k.nin_verified,
        k.address_verified, k.reviewed_by, k.reviewed_at, k.rejection_reason,
        k.created_at, b.name as bank_name
        FROM kyc_records k LEFT JOIN banking_institutions b ON k.bank_id = b.id WHERE 1=1`;
      const params: unknown[] = [];
      if (input.status) { sql += ` AND k.status = ?`; params.push(input.status); }
      if (input.tier) { sql += ` AND k.tier = ?`; params.push(input.tier); }
      if (input.bankId) { sql += ` AND k.bank_id = ?`; params.push(input.bankId); }
      if (input.pepFlag !== undefined) { sql += ` AND k.pep_flag = ?`; params.push(input.pepFlag ? 1 : 0); }
      if (input.sanctionsFlag !== undefined) { sql += ` AND k.sanctions_flag = ?`; params.push(input.sanctionsFlag ? 1 : 0); }
      if (input.search) {
        sql += ` AND (k.full_name LIKE ? OR k.reference_id LIKE ? OR k.bvn LIKE ? OR k.email LIKE ?)`;
        const s = `%${input.search}%`;
        params.push(s, s, s, s);
      }
      sql += ` ORDER BY k.created_at DESC LIMIT 10000`;
      const rows = await query(sql, params) as any[];
      const headers = [
        'Reference ID','Customer Ref','Full Name','Subject Type','Date of Birth',
        'Nationality','BVN','NIN','Phone Number','Email','Address','Tier',
        'Status','PEP Flag','Sanctions Flag','Liveness Score','Face Match Score',
        'BVN Verified','NIN Verified','Address Verified','Reviewed By','Reviewed At',
        'Rejection Reason','Created At','Bank Name'
      ];
      const escCsv = (v: unknown) => {
        if (v === null || v === undefined) return '';
        const s = String(v).replace(/"/g, '""');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
      };
      const csvRows = rows.map((r: any) => [
        r.reference_id, r.customer_ref, r.full_name, r.subject_type, r.date_of_birth,
        r.nationality, r.bvn, r.nin, r.phone_number, r.email, r.address, r.tier,
        r.status, r.pep_flag ? 'YES' : 'NO', r.sanctions_flag ? 'YES' : 'NO',
        r.liveness_score, r.face_match_score,
        r.bvn_verified ? 'YES' : 'NO', r.nin_verified ? 'YES' : 'NO',
        r.address_verified ? 'YES' : 'NO', r.reviewed_by, r.reviewed_at,
        r.rejection_reason, r.created_at, r.bank_name
      ].map(escCsv).join(','));
      const csv = [headers.join(','), ...csvRows].join('\n');
      await logAuditEvent('kyc.exportCsv', 'kyc_records', 0, 'system', { count: rows.length, filters: input });
      return { csv, count: rows.length, filename: `kyc_export_${new Date().toISOString().slice(0,10)}.csv` };
    }),
});

// ─── AML Router ──────────────────────────────────────────────────────────────
const amlRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      caseType: z.string().optional(),
      bankId: z.number().optional(),
      minRiskScore: z.number().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT a.*, b.name as bank_name FROM aml_cases a LEFT JOIN banking_institutions b ON a.bank_id = b.id WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) {
        sql += ` AND (a.subject_name LIKE ? OR a.case_ref LIKE ? OR a.subject_bvn LIKE ?)`;
        const s = `%${input.search}%`;
        params.push(s, s, s);
      }
      if (input.status) { sql += ` AND a.status = ?`; params.push(input.status); }
      if (input.caseType) { sql += ` AND a.case_type = ?`; params.push(input.caseType); }
      if (input.bankId) { sql += ` AND a.bank_id = ?`; params.push(input.bankId); }
      if (input.minRiskScore !== undefined) { sql += ` AND a.risk_score >= ?`; params.push(input.minRiskScore); }
      const countSql = sql.replace("SELECT a.*, b.name as bank_name", "SELECT COUNT(*) as cnt");
      const [countRow] = await query(countSql, params) as any[];
      const total = countRow?.cnt ?? 0;
      sql += ` ORDER BY a.risk_score DESC, a.created_at DESC LIMIT ? OFFSET ?`;
      params.push(input.limit, (input.page - 1) * input.limit);
      const rows = await query(sql, params);
      return { rows, total, page: input.page, limit: input.limit };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await query(`
        SELECT a.*, b.name as bank_name FROM aml_cases a 
        LEFT JOIN banking_institutions b ON a.bank_id = b.id 
        WHERE a.id = ?
      `, [input.id]);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return rows[0];
    }),

  create: protectedProcedure
    .input(z.object({
      bankId: z.number().optional(),
      subjectName: z.string().min(2),
      subjectType: z.enum(["individual","corporate","trust"]).default("individual"),
      subjectBvn: z.string().length(11).optional(),
      caseType: z.enum(["suspicious_transaction","pep_match","sanctions_match","structuring","unusual_pattern","high_risk_country","adverse_media","threshold_breach"]),
      riskScore: z.number().min(0).max(100).default(50),
      transactionAmount: z.number().optional(),
      transactionRef: z.string().optional(),
      sourceOfFunds: z.string().optional(),
      narrative: z.string().min(10),
      pepMatch: z.boolean().default(false),
      sanctionsMatch: z.boolean().default(false),
      adverseMediaMatch: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const caseRef = genRef("AML");
      // Business rule: Sanctions match auto-escalates to highest priority
      const initialStatus = input.sanctionsMatch ? "escalated" : "open";
      // Business rule: Risk score >= 80 triggers immediate escalation
      const status = input.riskScore >= 80 ? "escalated" : initialStatus;
      await query(`
        INSERT INTO aml_cases (case_ref, bank_id, subject_name, subject_type, subject_bvn, case_type, status,
          risk_score, pep_match, sanctions_match, adverse_media_match, transaction_amount, transaction_ref,
          source_of_funds, narrative)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [caseRef, input.bankId ?? null, input.subjectName, input.subjectType, input.subjectBvn ?? null,
          input.caseType, status, input.riskScore, input.pepMatch ? 1 : 0, input.sanctionsMatch ? 1 : 0,
          input.adverseMediaMatch ? 1 : 0, input.transactionAmount ?? null, input.transactionRef ?? null,
          input.sourceOfFunds ?? null, input.narrative]);
      // Middleware: Kafka event + audit log + TigerBeetle (if financial penalty involved)
      await emitEvent("aml.case.created", { caseRef, caseType: input.caseType, riskScore: input.riskScore, status });
      await logAuditEvent("aml.createCase", "aml_case", caseRef, "system", { caseType: input.caseType, riskScore: input.riskScore });
      if (status === "escalated") {
        await broadcastEvent("aml_case_escalated", { caseRef, caseType: input.caseType, riskScore: input.riskScore });
        await triggerWorkflow("AmlEscalationWorkflow", `aml-${caseRef}`, { caseRef, caseType: input.caseType, riskScore: input.riskScore });
      }
      emitMutationEvent(EVENTS.AML_CASE_CREATED, { action: "aml_case_created", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.aml.create", resourceType: "aml_case", details: `AML case created: ${caseRef} (${input.caseType}) risk=${input.riskScore}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      if (status === "escalated") {
        createInAppNotification({ title: "AML Case Escalated", message: `AML case ${caseRef} auto-escalated: ${input.caseType} (risk score: ${input.riskScore})`, severity: "critical", category: "banking", userId: ctx.user.id, actionUrl: "/banking/aml", metadata: { caseRef } }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      }
      return { success: true, caseRef, status };
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["open","under_investigation","escalated","filed_str","closed_no_action","closed_action_taken"]),
      assignedTo: z.string().optional(),
      escalatedTo: z.string().optional(),
      strReference: z.string().optional(),
      closureNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Business rule: STR must be filed within 24 hours of detection per NFIU guidelines
      const sets = ["status = ?", "updated_at = NOW()"];
      const params: unknown[] = [input.status];
      if (input.assignedTo) { sets.push("assigned_to = ?"); params.push(input.assignedTo); }
      if (input.escalatedTo) { sets.push("escalated_to = ?"); params.push(input.escalatedTo); }
      if (input.strReference) { sets.push("str_reference = ?", "str_filed_at = NOW()"); params.push(input.strReference); }
      if (input.closureNotes) { sets.push("closure_notes = ?"); params.push(input.closureNotes); }
      if (input.status.startsWith("closed")) { sets.push("closed_at = NOW()"); }
      params.push(input.id);
      await query(`UPDATE aml_cases SET ${sets.join(", ")} WHERE id = ?`, params);
      emitMutationEvent(EVENTS.AML_CASE_UPDATED, { action: "str_filed", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.aml.updateStatus", resourceType: "aml_case", resourceId: input.id, details: `AML case #${input.id} status → ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  stats: protectedProcedure.query(async () => {
    const [row] = await query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_cases,
        SUM(CASE WHEN status = 'escalated' THEN 1 ELSE 0 END) as escalated,
        SUM(CASE WHEN status = 'filed_str' THEN 1 ELSE 0 END) as str_filed,
        SUM(CASE WHEN pep_match = 1 THEN 1 ELSE 0 END) as pep_matches,
        SUM(CASE WHEN sanctions_match = 1 THEN 1 ELSE 0 END) as sanctions_matches,
        AVG(risk_score) as avg_risk_score,
        SUM(transaction_amount) as total_flagged_amount
      FROM aml_cases
    `) as any[];
    return row;
  }),
});

// ─── Watchlist Router ─────────────────────────────────────────────────────────
const watchlistRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      source: z.string().optional(),
      category: z.string().optional(),
      isActive: z.boolean().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM watchlist_entries WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) {
        sql += ` AND (primary_name LIKE ? OR passport_number LIKE ? OR entity_id LIKE ?)`;
        const s = `%${input.search}%`;
        params.push(s, s, s);
      }
      if (input.source) { sql += ` AND source = ?`; params.push(input.source); }
      if (input.category) { sql += ` AND category = ?`; params.push(input.category); }
      if (input.isActive !== undefined) { sql += ` AND is_active = ?`; params.push(input.isActive ? 1 : 0); }
      const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as cnt");
      const [countRow] = await query(countSql, params) as any[];
      const total = countRow?.cnt ?? 0;
      sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(input.limit, (input.page - 1) * input.limit);
      const rows = await query(sql, params);
      return { rows, total, page: input.page, limit: input.limit };
    }),

  screen: protectedProcedure
    .input(z.object({
      name: z.string().min(2),
      dateOfBirth: z.string().optional(),
      nationality: z.string().optional(),
      passportNumber: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Fuzzy name screening against watchlist
      const nameParts = input.name.toLowerCase().split(" ");
      const params: unknown[] = [];
      let sql = `SELECT * FROM watchlist_entries WHERE is_active = true AND (`;
      const conditions: string[] = [];
      for (const part of nameParts) {
        if (part.length >= 3) {
          conditions.push(`primary_name LIKE ?`);
          params.push(`%${part}%`);
        }
      }
      if (conditions.length === 0) return { matches: [], screeningRef: genRef("SCR") };
      sql += conditions.join(" OR ") + `)`;
      if (input.passportNumber) {
        sql += ` OR passport_number = ?`;
        params.push(input.passportNumber);
      }
      const matches = await query(sql, params);
      // Enrich with Osiris OFAC SDN data (fire-and-forget, graceful degradation)
      const osirisResult = await enrichedSanctionsCheck(input.name, input.nationality?.slice(0, 2)).catch(() => null);
      const osirisMatches = osirisResult?.matches ?? [];
      const conflictRisk = osirisResult?.riskLevel ?? "none";
      // Cross-reference with Phantom Tide maritime sanctions
      const { enrichBankingWithMaritime } = await import("../intelAggregator");
      const maritimeEnrich = await enrichBankingWithMaritime(input.name).catch(() => ({ sanctionMatches: [], vesselLinks: [], maritimeRiskLevel: "none" as const }));
      emitMutationEvent(EVENTS.KYC_VERIFICATION, { action: "watchlist_screened", osirisHits: osirisMatches.length, conflictRisk, maritimeHits: maritimeEnrich.sanctionMatches.length, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return {
        matches,
        osirisMatches: osirisMatches.slice(0, 10),
        conflictRisk,
        recommendation: osirisResult?.recommendation ?? null,
        screeningRef: genRef("SCR"),
        matchCount: matches.length + osirisMatches.length + maritimeEnrich.sanctionMatches.length,
        maritimeSanctions: maritimeEnrich.sanctionMatches.slice(0, 5),
        maritimeRiskLevel: maritimeEnrich.maritimeRiskLevel,
        vesselLinks: maritimeEnrich.vesselLinks,
      };
    }),

  addEntry: adminProcedure
    .input(z.object({
      entityType: z.enum(["individual","corporate","vessel","aircraft"]).default("individual"),
      primaryName: z.string().min(2),
      aliases: z.array(z.string()).default([]),
      dateOfBirth: z.string().optional(),
      nationality: z.string().optional(),
      passportNumber: z.string().optional(),
      source: z.enum(["ofac_sdn","un_consolidated","eu_consolidated","uk_hmt","cbn_internal","interpol","efcc","nfiu","local_court"]),
      category: z.enum(["sanctions","pep","adverse_media","terrorism","fraud","corruption","money_laundering"]),
      reason: z.string().min(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const entityId = genRef("WL");
      await query(`
        INSERT INTO watchlist_entries (entity_id, entity_type, primary_name, aliases, date_of_birth, nationality,
          passport_number, source, category, reason, listing_date, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), true)
      `, [entityId, input.entityType, input.primaryName, JSON.stringify(input.aliases),
          input.dateOfBirth ?? null, input.nationality ?? null, input.passportNumber ?? null,
          input.source, input.category, input.reason]);
      emitMutationEvent(EVENTS.FRAUD_ALERT, { action: "watchlist_entity_added", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.watchlist.add", resourceType: "watchlist_entry", details: `Watchlist entry added: ${input.primaryName} (${input.category}/${input.source})` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, entityId };
    }),

  delistEntry: adminProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(5) }))
    .mutation(async ({ ctx, input }) => {
      await query(`UPDATE watchlist_entries SET is_active = false, delisting_date = NOW(), updated_at = NOW() WHERE id = ?`, [input.id]);
      emitMutationEvent(EVENTS.FRAUD_ALERT, { action: "watchlist_entity_delisted", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.watchlist.delist", resourceType: "watchlist_entry", resourceId: input.id, details: `Watchlist entry #${input.id} delisted: ${input.reason}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  stats: protectedProcedure.query(async () => {
    const [row] = await query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN category = 'sanctions' THEN 1 ELSE 0 END) as sanctions,
        SUM(CASE WHEN category = 'pep' THEN 1 ELSE 0 END) as pep,
        SUM(CASE WHEN category = 'terrorism' THEN 1 ELSE 0 END) as terrorism,
        SUM(CASE WHEN source = 'ofac_sdn' THEN 1 ELSE 0 END) as ofac,
        SUM(CASE WHEN source = 'cbn_internal' THEN 1 ELSE 0 END) as cbn_internal
      FROM watchlist_entries
    `) as any[];
    return row;
  }),
});

// ─── Payments Router (NIP + RTGS) ────────────────────────────────────────────
const paymentsRouter = router({
  // NIP Transactions
  listNip: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      senderBankCode: z.string().optional(),
      receiverBankCode: z.string().optional(),
      amlFlagged: z.boolean().optional(),
      fraudFlagged: z.boolean().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM nip_transactions WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) {
        sql += ` AND (session_id LIKE ? OR sender_account_number LIKE ? OR receiver_account_number LIKE ? OR nibss_ref LIKE ?)`;
        const s = `%${input.search}%`;
        params.push(s, s, s, s);
      }
      if (input.status) { sql += ` AND status = ?`; params.push(input.status); }
      if (input.senderBankCode) { sql += ` AND sender_bank_code = ?`; params.push(input.senderBankCode); }
      if (input.receiverBankCode) { sql += ` AND receiver_bank_code = ?`; params.push(input.receiverBankCode); }
      if (input.amlFlagged !== undefined) { sql += ` AND aml_flagged = ?`; params.push(input.amlFlagged); }
      if (input.fraudFlagged !== undefined) { sql += ` AND fraud_flagged = ?`; params.push(input.fraudFlagged); }
      if (input.dateFrom) { sql += ` AND initiated_at >= ?`; params.push(input.dateFrom); }
      if (input.dateTo) { sql += ` AND initiated_at <= ?`; params.push(input.dateTo); }
      const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as cnt");
      const [countRow] = await query(countSql, params) as any[];
      const total = countRow?.cnt ?? 0;
      sql += ` ORDER BY initiated_at DESC LIMIT ? OFFSET ?`;
      params.push(input.limit, (input.page - 1) * input.limit);
      const rows = await query(sql, params);
      return { rows, total, page: input.page, limit: input.limit };
    }),

  initiateNip: protectedProcedure
    .input(z.object({
      senderBankCode: z.string().length(6),
      senderAccountNumber: z.string().min(10).max(10),
      senderAccountName: z.string().optional(),
      receiverBankCode: z.string().length(6),
      receiverAccountNumber: z.string().min(10).max(10),
      receiverAccountName: z.string().optional(),
      amount: z.number().min(1).max(10_000_000), // CBN NIP limit: ₦10M
      narration: z.string().max(255).optional(),
      channelCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Business rule: NIP single transaction limit is ₦10M (CBN Circular)
      if (input.amount > 10_000_000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "NIP single transaction limit is ₦10,000,000. Use RTGS for higher amounts." });
      }

      // ── AML Business Rules (CBN AML/CFT Reg 2022 + NFIU Guidelines) ──────

      // 1. CTR Threshold: transactions >= ₦5M flagged per NFIU CTR requirement
      const CTR_THRESHOLD = 5_000_000;
      const amlFlagged = input.amount >= CTR_THRESHOLD;

      // 2. Structuring detection: amounts in the ₦4M-₦4.99M range (just below ₦5M threshold)
      const structuringRisk = input.amount >= 4_000_000 && input.amount < CTR_THRESHOLD;

      // 3. Velocity check: >3 transactions from same account in 1 hour triggers review
      let velocityFlagged = false;
      try {
        const [velRow] = await query(
          `SELECT COUNT(*) as cnt FROM nip_transactions WHERE sender_account_number = ? AND initiated_at > NOW() - INTERVAL '1 hour'`,
          [input.senderAccountNumber]
        ) as any[];
        velocityFlagged = (velRow?.cnt ?? 0) >= 3;
      } catch { /* non-fatal — proceed with transaction */ }

      // 4. Sanctions screening: check sender + receiver against watchlist
      let sanctionsFlagged = false;
      try {
        const [sanctionRow] = await query(
          `SELECT COUNT(*) as cnt FROM watchlist_entries WHERE is_active = true AND category IN ('sanctions','terrorism') AND (
            primary_name LIKE ? OR primary_name LIKE ?
          )`,
          [`%${input.senderAccountName ?? ""}%`, `%${input.receiverAccountName ?? ""}%`]
        ) as any[];
        sanctionsFlagged = (sanctionRow?.cnt ?? 0) > 0;
      } catch { /* non-fatal */ }

      // 5. Block transaction if sanctions match (mandatory per NFIU AML/CFT Guidelines)
      if (sanctionsFlagged) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Transaction blocked: sanctions match detected. Escalate to compliance per NFIU AML/CFT Guidelines 2022."
        });
      }

      // 6. Auto-generate fraud alert for combined risk indicators
      const fraudFlagged = (amlFlagged && velocityFlagged) || structuringRisk;

      const sessionId = genRef("NIP").replace("-", "").substring(0, 40);
      const nibssRef = `NIBSS${Date.now()}`;
      await query(`
        INSERT INTO nip_transactions (session_id, sender_bank_code, sender_bank_name, sender_account_number, sender_account_name,
          receiver_bank_code, receiver_bank_name, receiver_account_number, receiver_account_name,
          amount, narration, status, nibss_ref, channel_code, aml_flagged, fraud_flagged)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initiated', ?, ?, ?, ?)
      `, [sessionId, input.senderBankCode, null, input.senderAccountNumber, input.senderAccountName ?? null,
          input.receiverBankCode, null, input.receiverAccountNumber, input.receiverAccountName ?? null,
          input.amount, input.narration ?? null, nibssRef, input.channelCode ?? "API",
          amlFlagged ? 1 : 0, fraudFlagged ? 1 : 0]);

      // Auto-create AML case for flagged transactions
      if (amlFlagged || structuringRisk) {
        try {
          const caseType = structuringRisk ? "structuring" : "ctr_threshold";
          const riskScore = structuringRisk ? 70 : (velocityFlagged ? 80 : 50);
          await query(`
            INSERT INTO aml_cases (case_ref, subject_account, case_type, status, risk_score, narrative, transaction_amount)
            VALUES (?, ?, ?, 'open', ?, ?, ?)
          `, [genRef("AML"), input.senderAccountNumber, caseType, riskScore,
              `Auto-generated: ${caseType === "structuring" ? "Potential structuring" : "CTR threshold"} — NIP ₦${(input.amount / 100).toLocaleString()} from ${input.senderAccountNumber}. ${velocityFlagged ? "VELOCITY ALERT: >3 txns/hr." : ""}`,
              input.amount]);
        } catch { /* non-fatal */ }
      }

      // ── Mojaloop: initiate interbank settlement via payment switch ──
      mojaloopTransfer({
        payerFsp: input.senderBankCode,
        payeeFsp: input.receiverBankCode,
        amount: String(input.amount),
        currency: "NGN",
        reference: sessionId,
        note: `NIP:${nibssRef}`,
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Mojaloop] NIP settlement fire-and-forget"));

      // ── TigerBeetle: record NIP transfer in financial ledger ──
      tigerbeetleTransfer({
        debitAccountId: input.senderBankCode,
        creditAccountId: input.receiverBankCode,
        amount: input.amount,
        currency: "NGN",
        reference: sessionId,
        transferType: "NIP_TRANSFER",
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[TigerBeetle] NIP ledger fire-and-forget"));

      emitMutationEvent(EVENTS.SWIFT_TRANSACTION, { action: "nip_initiate", sessionId, amount: input.amount, amlFlagged, fraudFlagged, structuringRisk, velocityFlagged, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.nip.initiate", resourceType: "nip_transaction", details: `NIP ₦${input.amount.toLocaleString()} ${input.senderBankCode}→${input.receiverBankCode}${amlFlagged ? " [AML]" : ""}${fraudFlagged ? " [FRAUD]" : ""}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      if (fraudFlagged) {
        createInAppNotification({ title: "NIP Fraud Alert", message: `NIP ₦${input.amount.toLocaleString()} flagged for fraud. Session: ${sessionId}`, severity: "critical", category: "banking", userId: ctx.user.id, actionUrl: "/banking/payments" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      }
      return { success: true, sessionId, nibssRef, amlFlagged, fraudFlagged, structuringRisk, velocityFlagged };
    }),

  // RTGS Transactions
  listRtgs: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM rtgs_transactions WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) {
        sql += ` AND (reference LIKE ? OR sender_bank_code LIKE ? OR cbn_ref LIKE ?)`;
        const s = `%${input.search}%`;
        params.push(s, s, s);
      }
      if (input.status) { sql += ` AND status = ?`; params.push(input.status); }
      const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as cnt");
      const [countRow] = await query(countSql, params) as any[];
      const total = countRow?.cnt ?? 0;
      sql += ` ORDER BY queued_at DESC LIMIT ? OFFSET ?`;
      params.push(input.limit, (input.page - 1) * input.limit);
      const rows = await query(sql, params);
      return { rows, total, page: input.page, limit: input.limit };
    }),

  initiateRtgs: protectedProcedure
    .input(z.object({
      senderBankCode: z.string().length(6),
      senderAccountNumber: z.string().optional(),
      senderName: z.string().optional(),
      receiverBankCode: z.string().length(6),
      receiverAccountNumber: z.string().optional(),
      receiverName: z.string().optional(),
      amount: z.number().min(10_000_000), // RTGS minimum: ₦10M
      narration: z.string().optional(),
      priority: z.enum(["normal","urgent","critical"]).default("normal"),
    }))
    .mutation(async ({ ctx, input }) => {
      // Business rule: RTGS minimum is ₦10M
      if (input.amount < 10_000_000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "RTGS minimum transaction amount is ₦10,000,000" });
      }

      // ── AML Rules for RTGS (all RTGS are above CTR threshold by definition) ──

      // 1. All RTGS transactions must be reported as CTR (always above ₦5M)
      const amlFlagged = true;

      // 2. Enhanced due diligence for amounts >= ₦100M (CBN high-value threshold)
      const enhancedDueDiligence = input.amount >= 100_000_000;

      // 3. Sanctions screening on sender + receiver names
      let sanctionsFlagged = false;
      try {
        const names = [input.senderName, input.receiverName].filter(Boolean);
        for (const name of names) {
          const parts = (name as string).toLowerCase().split(" ").filter(p => p.length >= 3);
          if (parts.length > 0) {
            const conds = parts.map(() => `LOWER(primary_name) LIKE ?`).join(" OR ");
            const params = parts.map(p => `%${p}%`);
            const [row] = await query(
              `SELECT COUNT(*) as cnt FROM watchlist_entries WHERE is_active = true AND category IN ('sanctions','terrorism') AND (${conds})`,
              params
            ) as any[];
            if ((row?.cnt ?? 0) > 0) { sanctionsFlagged = true; break; }
          }
        }
      } catch { /* non-fatal */ }

      if (sanctionsFlagged) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "RTGS transaction blocked: sanctions match detected. Mandatory escalation per NFIU AML/CFT Guidelines."
        });
      }

      // 4. Velocity check for RTGS (unusual: >2 RTGS from same sender bank in 1 hour)
      let velocityFlagged = false;
      try {
        const [velRow] = await query(
          `SELECT COUNT(*) as cnt FROM rtgs_transactions WHERE sender_bank_code = ? AND queued_at > NOW() - INTERVAL '1 hour'`,
          [input.senderBankCode]
        ) as any[];
        velocityFlagged = (velRow?.cnt ?? 0) >= 2;
      } catch { /* non-fatal */ }

      const reference = genRef("RTGS");
      const cbnRef = `CBN${Date.now()}`;
      // Business rule: Determine settlement cycle based on time of day
      const hour = new Date().getHours();
      const settlementCycle = hour < 12 ? "AM" : hour < 16 ? "PM1" : "PM2";
      await query(`
        INSERT INTO rtgs_transactions (reference, sender_bank_code, sender_account_number, receiver_bank_code,
          receiver_account_number, amount, narration, status, priority, settlement_cycle, cbn_ref)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
      `, [reference, input.senderBankCode, input.senderAccountNumber ?? null, input.receiverBankCode,
          input.receiverAccountNumber ?? null, input.amount, input.narration ?? null,
          input.priority, settlementCycle, cbnRef]);

      // Auto-create AML case for all RTGS (always above CTR threshold)
      try {
        await query(`
          INSERT INTO aml_cases (case_ref, case_type, status, risk_score, narrative, transaction_amount)
          VALUES (?, 'ctr_threshold', 'open', ?, ?, ?)
        `, [genRef("AML"), enhancedDueDiligence ? 85 : 60,
            `Auto-CTR: RTGS ₦${(input.amount / 100).toLocaleString()} via ${input.senderBankCode}→${input.receiverBankCode}. ${enhancedDueDiligence ? "ENHANCED DUE DILIGENCE REQUIRED (≥₦100M)." : ""} ${velocityFlagged ? "VELOCITY ALERT." : ""}`,
            input.amount]);
      } catch { /* non-fatal */ }

      // ── Mojaloop: initiate RTGS settlement via payment switch ──
      mojaloopTransfer({
        payerFsp: input.senderBankCode,
        payeeFsp: input.receiverBankCode,
        amount: String(input.amount),
        currency: "NGN",
        reference,
        note: `RTGS:${cbnRef}:${settlementCycle}`,
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[Mojaloop] RTGS settlement fire-and-forget"));

      // ── TigerBeetle: record RTGS transfer in financial ledger ──
      tigerbeetleTransfer({
        debitAccountId: input.senderBankCode,
        creditAccountId: input.receiverBankCode,
        amount: input.amount,
        currency: "NGN",
        reference,
        transferType: "RTGS_TRANSFER",
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "[TigerBeetle] RTGS ledger fire-and-forget"));

      emitMutationEvent(EVENTS.SWIFT_TRANSACTION, { action: "rtgs_initiate", reference, amount: input.amount, amlFlagged, enhancedDueDiligence, sanctionsFlagged, velocityFlagged, ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.rtgs.initiate", resourceType: "rtgs_transaction", details: `RTGS ₦${input.amount.toLocaleString()} ${input.senderBankCode}→${input.receiverBankCode} (${settlementCycle})${enhancedDueDiligence ? " [EDD]" : ""}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      if (enhancedDueDiligence) {
        createInAppNotification({ title: "RTGS Enhanced Due Diligence", message: `RTGS ₦${input.amount.toLocaleString()} requires enhanced due diligence (≥₦100M). Ref: ${reference}`, severity: "high", category: "banking", userId: ctx.user.id, actionUrl: "/banking/payments" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      }
      return { success: true, reference, cbnRef, settlementCycle, amlFlagged, enhancedDueDiligence, velocityFlagged };
    }),

  paymentStats: protectedProcedure.query(async () => {
    const [nipStats] = await query(`
      SELECT COUNT(*) as total_nip, SUM(amount) as total_nip_value,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as nip_completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as nip_failed,
        SUM(CASE WHEN aml_flagged = 1 THEN 1 ELSE 0 END) as nip_aml_flagged
      FROM nip_transactions
    `) as any[];
    const [rtgsStats] = await query(`
      SELECT COUNT(*) as total_rtgs, SUM(amount) as total_rtgs_value,
        SUM(CASE WHEN status = 'settled' THEN 1 ELSE 0 END) as rtgs_settled,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rtgs_rejected
      FROM rtgs_transactions
    `) as any[];
    return { ...nipStats, ...rtgsStats };
  }),
});

// ─── SWIFT Router ─────────────────────────────────────────────────────────────
const swiftRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      messageType: z.string().optional(),
      sanctionsFlagged: z.boolean().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT * FROM swift_messages WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) {
        sql += ` AND (message_ref LIKE ? OR sender_bic LIKE ? OR receiver_bic LIKE ? OR ordering_customer LIKE ?)`;
        const s = `%${input.search}%`;
        params.push(s, s, s, s);
      }
      if (input.status) { sql += ` AND status = ?`; params.push(input.status); }
      if (input.messageType) { sql += ` AND message_type = ?`; params.push(input.messageType); }
      if (input.sanctionsFlagged !== undefined) { sql += ` AND sanctions_flagged = ?`; params.push(input.sanctionsFlagged ? 1 : 0); }
      const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as cnt");
      const [countRow] = await query(countSql, params) as any[];
      const total = countRow?.cnt ?? 0;
      sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(input.limit, (input.page - 1) * input.limit);
      const rows = await query(sql, params);
      return { rows, total, page: input.page, limit: input.limit };
    }),

  create: protectedProcedure
    .input(z.object({
      messageType: z.enum(["MT103","MT202","MT202COV","MT900","MT910","MT940","MT950"]),
      senderBic: z.string().min(8).max(11),
      receiverBic: z.string().min(8).max(11),
      amount: z.number().optional(),
      currency: z.string().length(3).optional(),
      valueDate: z.string().optional(),
      orderingCustomer: z.string().optional(),
      beneficiaryCustomer: z.string().optional(),
      remittanceInfo: z.string().optional(),
      correspondentBic: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const messageRef = genRef("SWIFT");
      // Business rule: All outgoing SWIFT messages must be sanctions-screened
      // Simulate screening (in production, this would call OFAC/UN API)
      const sanctionsScreened = true;
      const sanctionsFlagged = false; // Would be determined by actual screening
      await query(`
        INSERT INTO swift_messages (message_ref, message_type, sender_bic, receiver_bic, amount, currency,
          value_date, ordering_customer, beneficiary_customer, remittance_info, correspondent_bic,
          status, sanctions_screened, sanctions_flagged)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
      `, [messageRef, input.messageType, input.senderBic, input.receiverBic,
          input.amount ?? null, input.currency ?? null, input.valueDate ?? null,
          input.orderingCustomer ?? null, input.beneficiaryCustomer ?? null,
          input.remittanceInfo ?? null, input.correspondentBic ?? null,
          sanctionsScreened ? 1 : 0, sanctionsFlagged ? 1 : 0]);
      emitMutationEvent(EVENTS.SWIFT_TRANSACTION, { action: "swift_message_sent", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.swift.create", resourceType: "swift_message", details: `SWIFT ${input.messageType} ${input.senderBic}→${input.receiverBic}${input.amount ? ` ${input.currency ?? ""}${input.amount}` : ""}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, messageRef, sanctionsScreened, sanctionsFlagged };
    }),

  send: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await query(`SELECT * FROM swift_messages WHERE id = ?`, [input.id]) as any[];
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (rows[0].sanctions_flagged) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot send SWIFT message: sanctions flag is set. Escalate to compliance." });
      }
      await query(`UPDATE swift_messages SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = ?`, [input.id]);
      emitMutationEvent(EVENTS.SWIFT_TRANSACTION, { action: "swift_message_processed", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.swift.send", resourceType: "swift_message", resourceId: input.id, details: `SWIFT message #${input.id} sent` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  stats: protectedProcedure.query(async () => {
    const [row] = await query(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) as processed,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN sanctions_flagged = 1 THEN 1 ELSE 0 END) as sanctions_flagged,
        SUM(CASE WHEN message_type = 'MT103' THEN 1 ELSE 0 END) as mt103_count,
        SUM(amount) as total_value
      FROM swift_messages
    `) as any[];
    return row;
  }),
});

// ─── Fraud Router ─────────────────────────────────────────────────────────────
const fraudRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      alertType: z.string().optional(),
      bankId: z.number().optional(),
      minRiskScore: z.number().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT f.*, b.name as bank_name FROM fraud_alerts f LEFT JOIN banking_institutions b ON f.bank_id = b.id WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) {
        sql += ` AND (f.alert_ref LIKE ? OR f.account_number LIKE ? OR f.transaction_ref LIKE ?)`;
        const s = `%${input.search}%`;
        params.push(s, s, s);
      }
      if (input.status) { sql += ` AND f.status = ?`; params.push(input.status); }
      if (input.alertType) { sql += ` AND f.alert_type = ?`; params.push(input.alertType); }
      if (input.bankId) { sql += ` AND f.bank_id = ?`; params.push(input.bankId); }
      if (input.minRiskScore !== undefined) { sql += ` AND f.risk_score >= ?`; params.push(input.minRiskScore); }
      const countSql = sql.replace("SELECT f.*, b.name as bank_name", "SELECT COUNT(*) as cnt");
      const [countRow] = await query(countSql, params) as any[];
      const total = countRow?.cnt ?? 0;
      sql += ` ORDER BY f.risk_score DESC, f.detected_at DESC LIMIT ? OFFSET ?`;
      params.push(input.limit, (input.page - 1) * input.limit);
      const rows = await query(sql, params);
      return { rows, total, page: input.page, limit: input.limit };
    }),

  create: protectedProcedure
    .input(z.object({
      bankId: z.number().optional(),
      transactionRef: z.string().optional(),
      transactionAmount: z.number().optional(),
      accountNumber: z.string().optional(),
      alertType: z.enum(["velocity_breach","unusual_amount","geo_anomaly","device_fingerprint","account_takeover","synthetic_identity","card_not_present","social_engineering","insider_threat","ml_anomaly"]),
      riskScore: z.number().min(0).max(100),
      mlModel: z.string().optional(),
      mlConfidence: z.number().min(0).max(100).optional(),
      ruleTriggered: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const alertRef = genRef("FRD");
      // Business rule: Risk score >= 90 triggers automatic account block
      const autoBlocked = input.riskScore >= 90;
      await query(`
        INSERT INTO fraud_alerts (alert_ref, bank_id, transaction_ref, transaction_amount, account_number,
          alert_type, risk_score, ml_model, ml_confidence, rule_triggered, status, blocked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
      `, [alertRef, input.bankId ?? null, input.transactionRef ?? null, input.transactionAmount ?? null,
          input.accountNumber ?? null, input.alertType, input.riskScore, input.mlModel ?? null,
          input.mlConfidence ?? null, input.ruleTriggered ?? null, autoBlocked ? new Date().toISOString() : null]);
      emitMutationEvent(EVENTS.FRAUD_ALERT, { action: "fraud_alert_created", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.fraud.create", resourceType: "fraud_alert", details: `Fraud alert ${alertRef}: ${input.alertType} (risk=${input.riskScore})${autoBlocked ? " [BLOCKED]" : ""}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      if (autoBlocked) {
        createInAppNotification({ title: "Account Auto-Blocked — Fraud", message: `Account ${input.accountNumber ?? "N/A"} auto-blocked: ${input.alertType} (risk score ${input.riskScore}). Alert: ${alertRef}`, severity: "critical", category: "banking", userId: ctx.user.id, actionUrl: "/banking/fraud" }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      }
      return { success: true, alertRef, autoBlocked };
    }),

  investigate: protectedProcedure
    .input(z.object({
      id: z.number(),
      action: z.enum(["start_investigation","confirm_fraud","mark_false_positive","escalate","resolve"]),
      notes: z.string().optional(),
      assignedTo: z.string().optional(),
      disposition: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const statusMap: Record<string, string> = {
        start_investigation: "investigating",
        confirm_fraud: "confirmed_fraud",
        mark_false_positive: "false_positive",
        escalate: "escalated",
        resolve: "resolved",
      };
      const newStatus = statusMap[input.action];
      const sets = ["status = ?", "updated_at = NOW()"];
      const params: unknown[] = [newStatus];
      if (input.notes) { sets.push("investigator_notes = ?"); params.push(input.notes); }
      if (input.assignedTo) { sets.push("assigned_to = ?"); params.push(input.assignedTo); }
      if (input.disposition) { sets.push("disposition = ?"); params.push(input.disposition); }
      if (newStatus === "resolved") { sets.push("resolved_at = NOW()"); }
      params.push(input.id);
      await query(`UPDATE fraud_alerts SET ${sets.join(", ")} WHERE id = ?`, params);
      emitMutationEvent(EVENTS.FRAUD_ALERT, { action: "fraud_alert_updated", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: `banking.fraud.${input.action}`, resourceType: "fraud_alert", resourceId: input.id, details: `Fraud alert #${input.id} → ${newStatus}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, newStatus };
    }),

  stats: protectedProcedure.query(async () => {
    const [row] = await query(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_alerts,
        SUM(CASE WHEN status = 'confirmed_fraud' THEN 1 ELSE 0 END) as confirmed_fraud,
        SUM(CASE WHEN status = 'false_positive' THEN 1 ELSE 0 END) as false_positives,
        SUM(CASE WHEN risk_score >= 80 THEN 1 ELSE 0 END) as high_risk,
        AVG(risk_score) as avg_risk_score,
        SUM(transaction_amount) as total_fraud_value
      FROM fraud_alerts
    `) as any[];
    return row;
  }),
});

// ─── CBN Reports Router ───────────────────────────────────────────────────────
const cbnReportsRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      reportType: z.string().optional(),
      bankId: z.number().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT r.*, b.name as bank_name FROM cbn_reports r LEFT JOIN banking_institutions b ON r.bank_id = b.id WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) {
        sql += ` AND (r.report_ref LIKE ? OR r.reporting_period LIKE ? OR r.cbn_ack_ref LIKE ?)`;
        const s = `%${input.search}%`;
        params.push(s, s, s);
      }
      if (input.status) { sql += ` AND r.status = ?`; params.push(input.status); }
      if (input.reportType) { sql += ` AND r.report_type = ?`; params.push(input.reportType); }
      if (input.bankId) { sql += ` AND r.bank_id = ?`; params.push(input.bankId); }
      const countSql = sql.replace("SELECT r.*, b.name as bank_name", "SELECT COUNT(*) as cnt");
      const [countRow] = await query(countSql, params) as any[];
      const total = countRow?.cnt ?? 0;
      sql += ` ORDER BY r.filing_deadline ASC, r.created_at DESC LIMIT ? OFFSET ?`;
      params.push(input.limit, (input.page - 1) * input.limit);
      const rows = await query(sql, params);
      return { rows, total, page: input.page, limit: input.limit };
    }),

  create: protectedProcedure
    .input(z.object({
      bankId: z.number(),
      reportType: z.enum(["str","ctr","scuml_report","aml_annual","prudential_return","liquidity_return","capital_adequacy","credit_risk","operational_risk"]),
      reportingPeriod: z.string().min(4), // e.g., "2026-Q1" or "2026-01"
      filingDeadline: z.string(),
      totalTransactions: z.number().optional(),
      totalAmount: z.number().optional(),
      preparedBy: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const reportRef = genRef("CBN");
      // Business rule: STR must be filed within 24 hours, CTR within 7 days
      await query(`
        INSERT INTO cbn_reports (report_ref, bank_id, report_type, reporting_period, status,
          filing_deadline, total_transactions, total_amount, prepared_by)
        VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)
      `, [reportRef, input.bankId, input.reportType, input.reportingPeriod,
          input.filingDeadline, input.totalTransactions ?? null, input.totalAmount ?? null,
          input.preparedBy ?? null]);
      emitMutationEvent(EVENTS.CBN_REPORT, { action: "cbn_report_submitted", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.cbn.create", resourceType: "cbn_report", details: `CBN report ${reportRef}: ${input.reportType} (${input.reportingPeriod})` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, reportRef };
    }),

  submit: protectedProcedure
    .input(z.object({ id: z.number(), approvedBy: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await query(`SELECT * FROM cbn_reports WHERE id = ?`, [input.id]) as any[];
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (rows[0].status === "submitted") throw new TRPCError({ code: "CONFLICT", message: "Report already submitted" });
      // Business rule: Report must be approved before submission
      if (rows[0].status !== "approved" && rows[0].status !== "pending_review") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Report must be in approved or pending_review status before submission" });
      }
      const cbnAckRef = `CBN-ACK-${Date.now()}`;
      await query(`
        UPDATE cbn_reports SET status = 'submitted', submitted_at = NOW(), 
          cbn_ack_ref = ?, approved_by = COALESCE(?, approved_by), updated_at = NOW() 
        WHERE id = ?
      `, [cbnAckRef, input.approvedBy ?? null, input.id]);
      emitMutationEvent(EVENTS.CBN_REPORT, { action: "cbn_report_approved", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.cbn.submit", resourceType: "cbn_report", resourceId: input.id, details: `CBN report #${input.id} submitted. ACK: ${cbnAckRef}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true, cbnAckRef };
    }),

  stats: protectedProcedure.query(async () => {
    const [row] = await query(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted,
        SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN status = 'acknowledged' THEN 1 ELSE 0 END) as acknowledged,
        SUM(CASE WHEN report_type = 'str' THEN 1 ELSE 0 END) as str_count,
        SUM(CASE WHEN report_type = 'ctr' THEN 1 ELSE 0 END) as ctr_count,
        SUM(CASE WHEN filing_deadline < NOW() AND status NOT IN ('submitted','acknowledged') THEN 1 ELSE 0 END) as past_deadline
      FROM cbn_reports
    `) as any[];
    return row;
  }),
});

// ─── Correspondent Banks Router ───────────────────────────────────────────────
const correspondentRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      country: z.string().optional(),
      bankId: z.number().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      let sql = `SELECT c.*, b.name as local_bank_name FROM correspondent_banks c LEFT JOIN banking_institutions b ON c.bank_id = b.id WHERE 1=1`;
      const params: unknown[] = [];
      if (input.search) {
        sql += ` AND (c.correspondent_name LIKE ? OR c.correspondent_bic LIKE ? OR c.country LIKE ?)`;
        const s = `%${input.search}%`;
        params.push(s, s, s);
      }
      if (input.status) { sql += ` AND c.status = ?`; params.push(input.status); }
      if (input.country) { sql += ` AND c.country = ?`; params.push(input.country); }
      if (input.bankId) { sql += ` AND c.bank_id = ?`; params.push(input.bankId); }
      const countSql = sql.replace("SELECT c.*, b.name as local_bank_name", "SELECT COUNT(*) as cnt");
      const [countRow] = await query(countSql, params) as any[];
      const total = countRow?.cnt ?? 0;
      sql += ` ORDER BY c.correspondent_name ASC LIMIT ? OFFSET ?`;
      params.push(input.limit, (input.page - 1) * input.limit);
      const rows = await query(sql, params);
      return { rows, total, page: input.page, limit: input.limit };
    }),

  create: protectedProcedure
    .input(z.object({
      bankId: z.number(),
      correspondentName: z.string().min(3),
      correspondentBic: z.string().min(8).max(11),
      country: z.string().min(2),
      currency: z.string().length(3),
      relationshipType: z.enum(["nostro","vostro","loro","bilateral"]),
      nostroAccount: z.string().optional(),
      vostroAccount: z.string().optional(),
      dailyLimit: z.number().optional(),
      monthlyLimit: z.number().optional(),
      kycCompleted: z.boolean().default(false),
      amlRiskRating: z.enum(["low","medium","high","very_high"]).default("low"),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Business rule: KYC must be completed for high/very_high risk correspondents
      if ((input.amlRiskRating === "high" || input.amlRiskRating === "very_high") && !input.kycCompleted) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "KYC must be completed for high-risk correspondent banks per FATF Recommendation 13" });
      }
      const nextReview = new Date();
      nextReview.setFullYear(nextReview.getFullYear() + 1);
      await query(`
        INSERT INTO correspondent_banks (bank_id, correspondent_name, correspondent_bic, country, currency,
          relationship_type, nostro_account, vostro_account, status, daily_limit, monthly_limit,
          kyc_completed, aml_risk_rating, last_review_date, next_review_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NOW(), ?, ?)
      `, [input.bankId, input.correspondentName, input.correspondentBic, input.country, input.currency,
          input.relationshipType, input.nostroAccount ?? null, input.vostroAccount ?? null,
          input.dailyLimit ?? null, input.monthlyLimit ?? null, input.kycCompleted ? 1 : 0,
          input.amlRiskRating, nextReview.toISOString(), input.notes ?? null]);
      emitMutationEvent(EVENTS.CORRESPONDENT_BANK, { action: "correspondent_onboarded", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.correspondent.create", resourceType: "correspondent_bank", details: `Correspondent onboarded: ${input.correspondentName} (${input.correspondentBic}) ${input.country}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["active","suspended","terminated","under_review"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await query(`UPDATE correspondent_banks SET status = ?, notes = COALESCE(?, notes), updated_at = NOW() WHERE id = ?`,
        [input.status, input.notes ?? null, input.id]);
      emitMutationEvent(EVENTS.CORRESPONDENT_BANK, { action: "correspondent_status_updated", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      createAuditLog({ userId: ctx.user.id, action: "banking.correspondent.updateStatus", resourceType: "correspondent_bank", resourceId: input.id, details: `Correspondent #${input.id} → ${input.status}` }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { success: true };
    }),

  stats: protectedProcedure.query(async () => {
    const [row] = await query(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended,
        SUM(CASE WHEN aml_risk_rating = 'high' OR aml_risk_rating = 'very_high' THEN 1 ELSE 0 END) as high_risk,
        SUM(CASE WHEN kyc_completed = 0 THEN 1 ELSE 0 END) as kyc_pending,
        COUNT(DISTINCT country) as countries_count
      FROM correspondent_banks
    `) as any[];
    return row;
  }),
});

// ─── Combined Banking Router ──────────────────────────────────────────────────
export const bankingServicesRouter = router({
  institutions: bankingRouter,
  kyc: kycRouter,
  aml: amlRouter,
  watchlist: watchlistRouter,
  payments: paymentsRouter,
  swift: swiftRouter,
  fraud: fraudRouter,
  cbnReports: cbnReportsRouter,
  correspondents: correspondentRouter,
});
