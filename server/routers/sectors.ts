/**
 * Sector-Specific Routers: Healthcare (NHIA/FMOH), Energy (NERC/NUPRC), Insurance (NAICOM), Fintech (CBN/SEC)
 */
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

// ═══════════════════════════════════════════════════════════════════════════
// HEALTHCARE ROUTER
// ═══════════════════════════════════════════════════════════════════════════
export const healthcareRouter = router({
  listFacilities: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      facilityType: z.string().optional(),
      state: z.string().optional(),
      compliant: z.boolean().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 20;
      const offset = ((input?.page ?? 1) - 1) * limit;
      const rows = await q(
        `SELECT * FROM health_facilities
         WHERE ($1::text IS NULL OR facility_name ILIKE '%'||$1||'%' OR facility_code ILIKE '%'||$1||'%')
         AND ($2::text IS NULL OR facility_type::text = $2)
         AND ($3::text IS NULL OR state ILIKE '%'||$3||'%')
         AND ($4::boolean IS NULL OR data_localisation_compliant = $4)
         ORDER BY compliance_score DESC NULLS LAST LIMIT $5 OFFSET $6`,
        [input?.search ?? null, input?.facilityType ?? null, input?.state ?? null,
         input?.compliant ?? null, limit, offset]
      );
      const count = await q(`SELECT COUNT(*) FROM health_facilities`);
      return { data: rows, total: parseInt(count[0]?.count ?? '0') };
    }),

  getFacility: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT f.*,
          (SELECT COUNT(*) FROM patient_data_localisation_checks WHERE facility_id = f.id) as check_count,
          (SELECT COUNT(*) FROM patient_data_localisation_checks WHERE facility_id = f.id AND status = 'violation') as violation_count,
          (SELECT COUNT(*) FROM clinical_trials WHERE facility_id = f.id) as trial_count
         FROM health_facilities f WHERE f.id = $1`,
        [input.id]
      );
      return rows[0] ?? null;
    }),

  createFacility: adminProcedure
    .input(z.object({
      facilityName: z.string(),
      facilityCode: z.string(),
      facilityType: z.string(),
      state: z.string(),
      lga: z.string().optional(),
      nhiaAccreditationNumber: z.string().optional(),
      fmohLicenceNumber: z.string().optional(),
      bedCapacity: z.number().optional(),
      emrSystem: z.string().optional(),
      dataLocalisationCompliant: z.boolean().default(false),
      ndpcRegistered: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const rows = await q(
        `INSERT INTO health_facilities (facility_name,facility_code,facility_type,state,lga,nhia_accreditation_number,fmoh_licence_number,bed_capacity,emr_system,data_localisation_compliant,ndpc_registered)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [input.facilityName, input.facilityCode, input.facilityType, input.state,
         input.lga ?? null, input.nhiaAccreditationNumber ?? null, input.fmohLicenceNumber ?? null,
         input.bedCapacity ?? null, input.emrSystem ?? null, input.dataLocalisationCompliant, input.ndpcRegistered]
      );
      emitMutationEvent(EVENTS.SECTOR_BENCHMARK, { action: "sector_updated", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  listDataChecks: protectedProcedure
    .input(z.object({
      facilityId: z.number().optional(),
      status: z.string().optional(),
      dataCategory: z.string().optional(),
      page: z.number().default(1),
    }).optional())
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT c.*, f.facility_name, f.facility_code
         FROM patient_data_localisation_checks c
         LEFT JOIN health_facilities f ON c.facility_id = f.id
         WHERE ($1::int IS NULL OR c.facility_id = $1)
         AND ($2::text IS NULL OR c.status::text = $2)
         AND ($3::text IS NULL OR c.data_category::text = $3)
         ORDER BY c.checked_at DESC LIMIT 50`,
        [input?.facilityId ?? null, input?.status ?? null, input?.dataCategory ?? null]
      );
      return rows;
    }),

  listClinicalTrials: protectedProcedure
    .input(z.object({
      facilityId: z.number().optional(),
      status: z.string().optional(),
      foreignSponsor: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT t.*, f.facility_name FROM clinical_trials t
         LEFT JOIN health_facilities f ON t.facility_id = f.id
         WHERE ($1::int IS NULL OR t.facility_id = $1)
         AND ($2::text IS NULL OR t.status::text = $2)
         AND ($3::boolean IS NULL OR t.foreign_sponsor = $3)
         ORDER BY t.created_at DESC LIMIT 50`,
        [input?.facilityId ?? null, input?.status ?? null, input?.foreignSponsor ?? null]
      );
      return rows;
    }),

  getStats: protectedProcedure.query(async () => {
    const rows = await q(`
      SELECT
        (SELECT COUNT(*) FROM health_facilities WHERE is_active=true) as total_facilities,
        (SELECT COUNT(*) FROM health_facilities WHERE data_localisation_compliant=true) as compliant_facilities,
        (SELECT COUNT(*) FROM patient_data_localisation_checks WHERE status='violation') as active_violations,
        (SELECT COUNT(*) FROM clinical_trials WHERE status='active') as active_trials,
        (SELECT COUNT(*) FROM clinical_trials WHERE foreign_sponsor=true AND data_localisation_compliant=false) as non_compliant_trials,
        (SELECT COUNT(*) FROM health_facilities WHERE ndpc_registered=true) as ndpc_registered,
        (SELECT COUNT(*) FROM health_facilities WHERE dpia_completed=true) as dpia_completed,
        (SELECT COALESCE(SUM(patient_records_count),0) FROM health_facilities) as total_patient_records
    `);
    return rows[0];
  }),

  /** NDPA S.30 — Compute weighted compliance score for a healthcare facility */
  calculateFacilityCompliance: protectedProcedure
    .input(z.object({ facilityId: z.number() }))
    .query(async ({ input }) => {
      const fRows = await q(`SELECT * FROM health_facilities WHERE id = $1`, [input.facilityId]);
      const facility = fRows[0];
      if (!facility) return { score: 0, grade: "F", breakdown: {} };
      const violations = await q(`SELECT COUNT(*) as cnt FROM patient_data_localisation_checks WHERE facility_id = $1 AND status = 'violation'`, [input.facilityId]);
      const violationCount = parseInt(violations[0]?.cnt ?? '0');
      const breakdown: Record<string, number> = {
        dataLocalisation: facility.data_localisation_compliant ? 20 : 0,
        ndpcRegistered: facility.ndpc_registered ? 15 : 0,
        dpiaCompleted: facility.dpia_completed ? 15 : 0,
        emrSystem: facility.emr_system ? 10 : 0,
        nhiaAccreditation: facility.nhia_accreditation_number ? 10 : 0,
        fmohLicence: facility.fmoh_licence_number ? 10 : 0,
        violationPenalty: Math.max(0, 20 - violationCount * 5),
      };
      const score = Math.min(100, Object.values(breakdown).reduce((s, v) => s + v, 0));
      const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
      return { score, grade, breakdown, facilityName: facility.facility_name };
    }),

  /** NDPA S.26 — Flag non-compliant clinical trials with foreign sponsors */
  flagNonCompliantTrials: adminProcedure
    .input(z.object({ facilityId: z.number().optional() }))
    .mutation(async ({ input }) => {
      const rows = await q(
        `UPDATE clinical_trials SET status = 'suspended', notes = COALESCE(notes, '') || ' [AUTO-SUSPENDED: NDPA S.26 violation — foreign sponsor with non-local data]', updated_at = NOW()
         WHERE foreign_sponsor = true AND data_localisation_compliant = false AND status NOT IN ('suspended', 'closed')
         ${input.facilityId ? 'AND facility_id = $1' : ''}
         RETURNING id, trial_name, facility_id`,
        input.facilityId ? [input.facilityId] : []
      );
      emitMutationEvent(EVENTS.SECTOR_ALERT, { action: "healthcare_flagTrials", ts: new Date().toISOString(), count: rows.length }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { suspended: rows.length, trials: rows };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════
// ENERGY ROUTER
// ═══════════════════════════════════════════════════════════════════════════
export const energyRouter = router({
  listCompanies: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      sector: z.string().optional(),
      compliant: z.boolean().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 20;
      const offset = ((input?.page ?? 1) - 1) * limit;
      const rows = await q(
        `SELECT * FROM energy_companies
         WHERE ($1::text IS NULL OR company_name ILIKE '%'||$1||'%' OR company_code ILIKE '%'||$1||'%')
         AND ($2::text IS NULL OR sector = $2)
         AND ($3::boolean IS NULL OR data_localisation_compliant = $3)
         ORDER BY company_name LIMIT $4 OFFSET $5`,
        [input?.search ?? null, input?.sector ?? null, input?.compliant ?? null, limit, offset]
      );
      const count = await q(`SELECT COUNT(*) FROM energy_companies`);
      return { data: rows, total: parseInt(count[0]?.count ?? '0') };
    }),

  getCompany: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT c.*,
          (SELECT COUNT(*) FROM energy_licences WHERE company_id = c.id) as licence_count,
          (SELECT COUNT(*) FROM grid_monitoring_events WHERE company_id = c.id AND data_localisation_violation=true) as violation_count
         FROM energy_companies c WHERE c.id = $1`,
        [input.id]
      );
      return rows[0] ?? null;
    }),

  listLicences: protectedProcedure
    .input(z.object({
      companyId: z.number().optional(),
      licenceType: z.string().optional(),
      status: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT l.*, c.company_name, c.company_code FROM energy_licences l
         LEFT JOIN energy_companies c ON l.company_id = c.id
         WHERE ($1::int IS NULL OR l.company_id = $1)
         AND ($2::text IS NULL OR l.licence_type::text = $2)
         AND ($3::text IS NULL OR l.status::text = $3)
         ORDER BY l.issued_at DESC LIMIT 50`,
        [input?.companyId ?? null, input?.licenceType ?? null, input?.status ?? null]
      );
      return rows;
    }),

  listGridEvents: protectedProcedure
    .input(z.object({
      companyId: z.number().optional(),
      eventType: z.string().optional(),
      severity: z.string().optional(),
      violationOnly: z.boolean().optional(),
      page: z.number().default(1),
    }).optional())
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT e.*, c.company_name FROM grid_monitoring_events e
         LEFT JOIN energy_companies c ON e.company_id = c.id
         WHERE ($1::int IS NULL OR e.company_id = $1)
         AND ($2::text IS NULL OR e.event_type::text = $2)
         AND ($3::text IS NULL OR e.severity::text = $3)
         AND ($4::boolean IS NULL OR e.data_localisation_violation = $4)
         ORDER BY e.occurred_at DESC LIMIT 50`,
        [input?.companyId ?? null, input?.eventType ?? null, input?.severity ?? null,
         input?.violationOnly ?? null]
      );
      return rows;
    }),

  listOilGasReports: protectedProcedure
    .input(z.object({
      companyId: z.number().optional(),
      status: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT r.*, c.company_name FROM oil_gas_data_reports r
         LEFT JOIN energy_companies c ON r.company_id = c.id
         WHERE ($1::int IS NULL OR r.company_id = $1)
         AND ($2::text IS NULL OR r.status = $2)
         ORDER BY r.created_at DESC LIMIT 50`,
        [input?.companyId ?? null, input?.status ?? null]
      );
      return rows;
    }),

  getStats: protectedProcedure.query(async () => {
    const rows = await q(`
      SELECT
        (SELECT COUNT(*) FROM energy_companies WHERE is_active=true) as total_companies,
        (SELECT COUNT(*) FROM energy_companies WHERE data_localisation_compliant=true) as compliant_companies,
        (SELECT COUNT(*) FROM energy_licences WHERE status='active') as active_licences,
        (SELECT COUNT(*) FROM grid_monitoring_events WHERE data_localisation_violation=true) as data_violations,
        (SELECT COUNT(*) FROM grid_monitoring_events WHERE event_type='cyber_incident') as cyber_incidents,
        (SELECT COUNT(*) FROM oil_gas_data_reports WHERE is_locally_stored=false) as offshore_reports,
        (SELECT COALESCE(SUM(customer_base),0) FROM energy_companies WHERE sector='electricity') as total_electricity_customers,
        (SELECT COALESCE(SUM(installed_capacity_mw),0) FROM energy_companies WHERE sector='electricity') as total_capacity_mw
    `);
    return rows[0];
  }),

  /** NERC compliance scoring for energy companies */
  calculateCompanyCompliance: protectedProcedure
    .input(z.object({ companyId: z.number() }))
    .query(async ({ input }) => {
      const cRows = await q(`SELECT * FROM energy_companies WHERE id = $1`, [input.companyId]);
      const company = cRows[0];
      if (!company) return { score: 0, grade: "F", breakdown: {} };
      const violations = await q(`SELECT COUNT(*) as cnt FROM grid_monitoring_events WHERE company_id = $1 AND data_localisation_violation = true`, [input.companyId]);
      const violationCount = parseInt(violations[0]?.cnt ?? '0');
      const cyberIncidents = await q(`SELECT COUNT(*) as cnt FROM grid_monitoring_events WHERE company_id = $1 AND event_type = 'cyber_incident'`, [input.companyId]);
      const cyberCount = parseInt(cyberIncidents[0]?.cnt ?? '0');
      const breakdown: Record<string, number> = {
        dataLocalisation: company.data_localisation_compliant ? 25 : 0,
        ndpcRegistered: company.ndpc_registered ? 15 : 0,
        licenceActive: company.status === 'active' ? 10 : 0,
        scadaSecurity: company.scada_security_audit ? 15 : 0,
        cyberPenalty: Math.max(0, 15 - cyberCount * 5),
        violationPenalty: Math.max(0, 20 - violationCount * 4),
      };
      const score = Math.min(100, Object.values(breakdown).reduce((s, v) => s + v, 0));
      const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
      return { score, grade, breakdown, companyName: company.company_name };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════
// INSURANCE ROUTER
// ═══════════════════════════════════════════════════════════════════════════
export const insuranceRouter = router({
  listCompanies: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      licenceType: z.string().optional(),
      status: z.string().optional(),
      compliant: z.boolean().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 20;
      const offset = ((input?.page ?? 1) - 1) * limit;
      const rows = await q(
        `SELECT * FROM insurance_companies
         WHERE ($1::text IS NULL OR company_name ILIKE '%'||$1||'%')
         AND ($2::text IS NULL OR licence_type::text = $2)
         AND ($3::text IS NULL OR status::text = $3)
         AND ($4::boolean IS NULL OR data_localisation_compliant = $4)
         ORDER BY gross_premium_ngn DESC NULLS LAST LIMIT $5 OFFSET $6`,
        [input?.search ?? null, input?.licenceType ?? null, input?.status ?? null,
         input?.compliant ?? null, limit, offset]
      );
      const count = await q(`SELECT COUNT(*) FROM insurance_companies`);
      return { data: rows, total: parseInt(count[0]?.count ?? '0') };
    }),

  getCompany: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT c.*,
          (SELECT COUNT(*) FROM insurance_policies WHERE company_id = c.id) as policy_count_actual,
          (SELECT COUNT(*) FROM insurance_claims WHERE company_id = c.id AND status NOT IN ('settled','closed')) as open_claims,
          (SELECT COUNT(*) FROM insurance_claims WHERE company_id = c.id AND fraud_flag=true) as fraud_claims
         FROM insurance_companies c WHERE c.id = $1`,
        [input.id]
      );
      return rows[0] ?? null;
    }),

  listPolicies: protectedProcedure
    .input(z.object({
      companyId: z.number().optional(),
      status: z.string().optional(),
      crossBorderReinsurance: z.boolean().optional(),
      page: z.number().default(1),
    }).optional())
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT p.*, c.company_name FROM insurance_policies p
         LEFT JOIN insurance_companies c ON p.company_id = c.id
         WHERE ($1::int IS NULL OR p.company_id = $1)
         AND ($2::text IS NULL OR p.status = $2)
         AND ($3::boolean IS NULL OR p.cross_border_reinsurance = $3)
         ORDER BY p.created_at DESC LIMIT 50`,
        [input?.companyId ?? null, input?.status ?? null, input?.crossBorderReinsurance ?? null]
      );
      return rows;
    }),

  listClaims: protectedProcedure
    .input(z.object({
      companyId: z.number().optional(),
      status: z.string().optional(),
      fraudFlag: z.boolean().optional(),
      page: z.number().default(1),
    }).optional())
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT cl.*, c.company_name, p.policy_type, p.policyholder_name
         FROM insurance_claims cl
         LEFT JOIN insurance_companies c ON cl.company_id = c.id
         LEFT JOIN insurance_policies p ON cl.policy_id = p.id
         WHERE ($1::int IS NULL OR cl.company_id = $1)
         AND ($2::text IS NULL OR cl.status::text = $2)
         AND ($3::boolean IS NULL OR cl.fraud_flag = $3)
         ORDER BY cl.submitted_at DESC LIMIT 50`,
        [input?.companyId ?? null, input?.status ?? null, input?.fraudFlag ?? null]
      );
      return rows;
    }),

  updateClaimStatus: adminProcedure
    .input(z.object({
      id: z.number(),
      status: z.string(),
      approvedAmountNgn: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const rows = await q(
        `UPDATE insurance_claims SET status=$2::insurance_claim_status, approved_amount_ngn=COALESCE($3,approved_amount_ngn),
         notes=COALESCE($4,notes), settled_at=CASE WHEN $2='settled' THEN NOW() ELSE settled_at END, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [input.id, input.status, input.approvedAmountNgn ?? null, input.notes ?? null]
      );
      emitMutationEvent(EVENTS.SECTOR_BENCHMARK, { action: "sector_updated", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  getStats: protectedProcedure.query(async () => {
    const rows = await q(`
      SELECT
        (SELECT COUNT(*) FROM insurance_companies WHERE is_active=true) as total_companies,
        (SELECT COUNT(*) FROM insurance_companies WHERE data_localisation_compliant=true) as compliant_companies,
        (SELECT COUNT(*) FROM insurance_companies WHERE status='suspended') as suspended_companies,
        (SELECT COUNT(*) FROM insurance_claims WHERE status='under_investigation') as claims_under_investigation,
        (SELECT COUNT(*) FROM insurance_claims WHERE fraud_flag=true) as fraud_claims,
        (SELECT COALESCE(SUM(gross_premium_ngn),0) FROM insurance_companies WHERE is_active=true) as total_gross_premium,
        (SELECT COUNT(*) FROM insurance_policies WHERE cross_border_reinsurance=true) as cross_border_policies,
        (SELECT COUNT(*) FROM insurance_companies WHERE ndpc_registered=true) as ndpc_registered
    `);
    return rows[0];
  }),

  /** NAICOM compliance scoring for insurance companies */
  calculateCompanyCompliance: protectedProcedure
    .input(z.object({ companyId: z.number() }))
    .query(async ({ input }) => {
      const cRows = await q(`SELECT * FROM insurance_companies WHERE id = $1`, [input.companyId]);
      const company = cRows[0];
      if (!company) return { score: 0, grade: "F", breakdown: {} };
      const fraudClaims = await q(`SELECT COUNT(*) as cnt FROM insurance_claims WHERE company_id = $1 AND fraud_flag = true`, [input.companyId]);
      const fraudCount = parseInt(fraudClaims[0]?.cnt ?? '0');
      const crossBorder = await q(`SELECT COUNT(*) as cnt FROM insurance_policies WHERE company_id = $1 AND cross_border_reinsurance = true`, [input.companyId]);
      const crossBorderCount = parseInt(crossBorder[0]?.cnt ?? '0');
      const breakdown: Record<string, number> = {
        dataLocalisation: company.data_localisation_compliant ? 25 : 0,
        ndpcRegistered: company.ndpc_registered ? 15 : 0,
        licenceActive: company.status === 'active' ? 10 : 0,
        dpiaCompleted: company.dpia_completed ? 10 : 0,
        fraudPenalty: Math.max(0, 20 - fraudCount * 4),
        crossBorderCompliance: Math.max(0, 20 - crossBorderCount * 3),
      };
      const score = Math.min(100, Object.values(breakdown).reduce((s, v) => s + v, 0));
      const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
      return { score, grade, breakdown, companyName: company.company_name };
    }),
});

// ═══════════════════════════════════════════════════════════════════════════
// FINTECH ROUTER
// ═══════════════════════════════════════════════════════════════════════════
export const fintechRouter = router({
  listCompanies: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      licenceType: z.string().optional(),
      status: z.string().optional(),
      compliant: z.boolean().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 20;
      const offset = ((input?.page ?? 1) - 1) * limit;
      const rows = await q(
        `SELECT * FROM fintech_companies
         WHERE ($1::text IS NULL OR company_name ILIKE '%'||$1||'%')
         AND ($2::text IS NULL OR licence_type::text = $2)
         AND ($3::text IS NULL OR status::text = $3)
         AND ($4::boolean IS NULL OR data_localisation_compliant = $4)
         ORDER BY monthly_transaction_volume_ngn DESC NULLS LAST LIMIT $5 OFFSET $6`,
        [input?.search ?? null, input?.licenceType ?? null, input?.status ?? null,
         input?.compliant ?? null, limit, offset]
      );
      const count = await q(`SELECT COUNT(*) FROM fintech_companies`);
      return { data: rows, total: parseInt(count[0]?.count ?? '0') };
    }),

  getCompany: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT c.*,
          (SELECT COUNT(*) FROM fintech_data_events WHERE company_id = c.id AND violation_detected=true) as violation_count,
          (SELECT COUNT(*) FROM open_banking_consents WHERE company_id = c.id AND consent_status='active') as active_consents
         FROM fintech_companies c WHERE c.id = $1`,
        [input.id]
      );
      return rows[0] ?? null;
    }),

  listDataEvents: protectedProcedure
    .input(z.object({
      companyId: z.number().optional(),
      eventType: z.string().optional(),
      violationOnly: z.boolean().optional(),
      page: z.number().default(1),
    }).optional())
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT e.*, c.company_name FROM fintech_data_events e
         LEFT JOIN fintech_companies c ON e.company_id = c.id
         WHERE ($1::int IS NULL OR e.company_id = $1)
         AND ($2::text IS NULL OR e.event_type::text = $2)
         AND ($3::boolean IS NULL OR e.violation_detected = $3)
         ORDER BY e.occurred_at DESC LIMIT 50`,
        [input?.companyId ?? null, input?.eventType ?? null, input?.violationOnly ?? null]
      );
      return rows;
    }),

  listOpenBankingConsents: protectedProcedure
    .input(z.object({
      companyId: z.number().optional(),
      status: z.string().optional(),
      crossBorder: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      const rows = await q(
        `SELECT ob.*, c.company_name FROM open_banking_consents ob
         LEFT JOIN fintech_companies c ON ob.company_id = c.id
         WHERE ($1::int IS NULL OR ob.company_id = $1)
         AND ($2::text IS NULL OR ob.consent_status::text = $2)
         AND ($3::boolean IS NULL OR ob.cross_border_transfer = $3)
         ORDER BY ob.granted_at DESC LIMIT 50`,
        [input?.companyId ?? null, input?.status ?? null, input?.crossBorder ?? null]
      );
      return rows;
    }),

  revokeConsent: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const rows = await q(
        `UPDATE open_banking_consents SET consent_status='revoked', revoked_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`,
        [input.id]
      );
      emitMutationEvent(EVENTS.SECTOR_BENCHMARK, { action: "sector_updated", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  getStats: protectedProcedure.query(async () => {
    const rows = await q(`
      SELECT
        (SELECT COUNT(*) FROM fintech_companies WHERE is_active=true) as total_companies,
        (SELECT COUNT(*) FROM fintech_companies WHERE data_localisation_compliant=true) as compliant_companies,
        (SELECT COUNT(*) FROM fintech_companies WHERE status='suspended') as suspended_companies,
        (SELECT COUNT(*) FROM fintech_data_events WHERE violation_detected=true) as data_violations,
        (SELECT COUNT(*) FROM open_banking_consents WHERE consent_status='active') as active_consents,
        (SELECT COUNT(*) FROM open_banking_consents WHERE cross_border_transfer=true) as cross_border_consents,
        (SELECT COALESCE(SUM(monthly_transaction_volume_ngn),0) FROM fintech_companies WHERE is_active=true) as total_monthly_volume,
        (SELECT COALESCE(SUM(active_users),0) FROM fintech_companies WHERE is_active=true) as total_active_users
    `);
    return rows[0];
  }),

  /** CBN compliance scoring for fintech companies */
  calculateCompanyCompliance: protectedProcedure
    .input(z.object({ companyId: z.number() }))
    .query(async ({ input }) => {
      const cRows = await q(`SELECT * FROM fintech_companies WHERE id = $1`, [input.companyId]);
      const company = cRows[0];
      if (!company) return { score: 0, grade: "F", breakdown: {} };
      const violations = await q(`SELECT COUNT(*) as cnt FROM fintech_data_events WHERE company_id = $1 AND violation_detected = true`, [input.companyId]);
      const violationCount = parseInt(violations[0]?.cnt ?? '0');
      const crossBorderConsents = await q(`SELECT COUNT(*) as cnt FROM open_banking_consents WHERE company_id = $1 AND cross_border_transfer = true AND consent_status = 'active'`, [input.companyId]);
      const crossBorderCount = parseInt(crossBorderConsents[0]?.cnt ?? '0');
      const breakdown: Record<string, number> = {
        dataLocalisation: company.data_localisation_compliant ? 25 : 0,
        ndpcRegistered: company.ndpc_registered ? 15 : 0,
        cbnLicence: company.status === 'active' ? 10 : 0,
        dpiaCompleted: company.dpia_completed ? 10 : 0,
        violationPenalty: Math.max(0, 20 - violationCount * 4),
        crossBorderRisk: crossBorderCount > 0 ? Math.max(0, 20 - crossBorderCount * 2) : 20,
      };
      const score = Math.min(100, Object.values(breakdown).reduce((s, v) => s + v, 0));
      const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
      return { score, grade, breakdown, companyName: company.company_name };
    }),

  /** CBN regulation — Bulk revoke expired or non-compliant open banking consents */
  revokeNonCompliantConsents: adminProcedure
    .input(z.object({ companyId: z.number().optional() }))
    .mutation(async ({ input }) => {
      const rows = await q(
        `UPDATE open_banking_consents SET consent_status = 'revoked', revoked_at = NOW(), updated_at = NOW()
         WHERE consent_status = 'active' AND cross_border_transfer = true
         AND company_id IN (SELECT id FROM fintech_companies WHERE data_localisation_compliant = false)
         ${input.companyId ? 'AND company_id = $1' : ''}
         RETURNING id, company_id`,
        input.companyId ? [input.companyId] : []
      );
      emitMutationEvent(EVENTS.SECTOR_ALERT, { action: "fintech_revokeConsents", ts: new Date().toISOString(), count: rows.length }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { revoked: rows.length, consents: rows };
    }),
});
