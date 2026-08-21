import { z } from "zod";

import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { notifyOwner } from "../_core/notification";
import crypto from "crypto";
import pg from "pg";
import { emitEvent, logAuditEvent, broadcastEvent, cacheGetJson, cacheSetJson, cacheDel, triggerWorkflow } from "../middlewareHelpers";
import { emitComplianceEvent, opensearchIndex, lakehouseIngest, daprPublish, fluvioPublish, permifyCheck } from "../middlewareExtensions";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { getPgSslConfig } from "../dbSslConfig";
import { getDatabaseUrl } from "../config";
import { logger } from "../logger";
const { Pool } = pg;
let _pool: InstanceType<typeof Pool> | null = null;
function getPool() {
  if (!_pool) {
    _pool = new Pool({ connectionString: getDatabaseUrl(), ssl: getPgSslConfig() });
  }
  return _pool;
}
async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  let idx = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
  const result = await getPool().query(pgSql, params);
  return result.rows as T[];
}

export const REVIEW_CHECKLIST_KEYS = [
  "legal_incorporation_verified",
  "rc_number_valid",
  "lead_auditor_qualifications_met",
  "audit_methodology_adequate",
  "indemnity_insurance_sufficient",
  "conflict_of_interest_clear",
  "financial_statements_reviewed",
  "independence_confirmed",
  "no_outstanding_sanctions",
  "fee_payment_confirmed",
];

const NEW_APP_FEE_KOBO = 15_000_000;
const RENEWAL_FEE_KOBO = 7_500_000;

function generateToken() {
  return "NDPC-DPCO-" + crypto.randomBytes(8).toString("hex").toUpperCase();
}
function generateLicenceNumber(id: number) {
  const year = new Date().getFullYear();
  return `NDPC-DPCO-${year}-${String(id).padStart(4, "0")}`;
}

export const accreditationRouter = router({

  // ── Submit new accreditation application ──────────────────────────────────
  submitApplication: publicProcedure
    .input(z.object({
      orgName: z.string().min(2),
      rcNumber: z.string().min(2),
      cacNumber: z.string().optional(),
      taxId: z.string().optional(),
      address: z.string().min(5),
      website: z.string().optional(),
      email: z.string().email(),
      phone: z.string().optional(),
      leadAuditors: z.array(z.object({
        name: z.string().min(2),
        email: z.string().email(),
        certifications: z.array(z.string()),
      })).min(1),
      sectors: z.array(z.string()).min(1),
      incorporationDocUrl: z.string().optional(),
      financialStatementsUrl: z.string().optional(),
      indemnityInsuranceUrl: z.string().optional(),
      auditMethodologyUrl: z.string().optional(),
      conflictDeclaration: z.boolean(),
      applicationType: z.enum(["new", "renewal"]).default("new"),
      existingDpcoOrgId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const token = generateToken();
      const fee = input.applicationType === "renewal" ? RENEWAL_FEE_KOBO : NEW_APP_FEE_KOBO;
      const [app] = await q<any>(
        `INSERT INTO dpco_accreditation_applications
         (org_name, rc_number, cac_number, tax_id, address, website, email, phone,
          lead_auditors, sectors, incorporation_doc_url, financial_statements_url,
          indemnity_insurance_url, audit_methodology_url, conflict_declaration,
          declaration_signed_at, application_type, existing_dpco_org_id,
          application_fee, status, reference_token, submitted_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?::jsonb,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),NOW())
         RETURNING *`,
        [
          input.orgName, input.rcNumber, input.cacNumber ?? null, input.taxId ?? null,
          input.address, input.website ?? null, input.email, input.phone ?? null,
          JSON.stringify(input.leadAuditors), input.sectors,
          input.incorporationDocUrl ?? null, input.financialStatementsUrl ?? null,
          input.indemnityInsuranceUrl ?? null, input.auditMethodologyUrl ?? null,
          input.conflictDeclaration, input.conflictDeclaration ? new Date() : null,
          input.applicationType, input.existingDpcoOrgId ?? null,
          fee, "submitted", token,
        ]
      );
      // Notify NDPC admin of new application
      try {
        await notifyOwner({
          title: `New DPCO Accreditation Application — ${input.orgName}`,
          content: `A new ${input.applicationType === 'new' ? 'initial' : 'renewal'} DPCO accreditation application has been submitted.\n\n**Organisation:** ${input.orgName}\n**RC Number:** ${input.rcNumber}\n**Email:** ${input.email}\n**Reference:** ${token}\n\nReview at: /admin/accreditation`,
        });
      } catch { /* notification failure is non-blocking */ }
      emitMutationEvent(EVENTS.ACCREDITATION_SUBMITTED, {
        applicationId: app?.id, orgName: input.orgName, type: input.applicationType,
        referenceToken: token, fee,
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      emitMutationEvent("ndsep.accreditation.mutation", { action: "accreditation", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { application: app, referenceToken: token, applicationFee: fee };
    }),
  // ── Get application status by reference token (public) ─────────────────────
  getApplicationStatus: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const [app] = await q<any>(
        `SELECT reference_token, org_name, application_type, status, submitted_at,
                decision, decision_at, decision_reason, conditions, info_request_note,
                issued_licence_number, licence_issued_at, licence_expires_at,
                licence_certificate_url, competency_scheduled_at
         FROM dpco_accreditation_applications WHERE reference_token = ?`,
        [input.token]
      );
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
      return app;
    }),

  // ── Admin: list all applications ──────────────────────────────────────────
  adminListApplications: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input.status) { conditions.push("status = ?"); params.push(input.status); }
      if (input.search) {
        conditions.push("(org_name ILIKE ? OR email ILIKE ? OR rc_number ILIKE ? OR reference_token ILIKE ?)");
        const s = `%${input.search}%`;
        params.push(s, s, s, s);
      }
      const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      const rows = await q<any>(
        `SELECT * FROM dpco_accreditation_applications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, input.limit, input.offset]
      );
      const [{ count }] = await q<any>(
        `SELECT COUNT(*) as count FROM dpco_accreditation_applications ${where}`,
        params
      );
      return { rows, total: parseInt(count) };
    }),

  // ── Admin: get single application ─────────────────────────────────────────
  adminGetApplication: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [app] = await q<any>(
        `SELECT * FROM dpco_accreditation_applications WHERE id = ?`,
        [input.id]
      );
      if (!app) throw new Error("Application not found");
      return app;
    }),

  // ── Admin: start review ───────────────────────────────────────────────────
  adminStartReview: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const reviewer = (ctx.user as any).name ?? (ctx.user as any).email ?? "NDPC Reviewer";
      const [updated] = await q<any>(
        `UPDATE dpco_accreditation_applications
         SET status='under_review', reviewed_by=?, review_started_at=NOW(), updated_at=NOW()
         WHERE id=? RETURNING *`,
        [reviewer, input.id]
      );
      emitMutationEvent("ndsep.accreditation.mutation", { action: "accreditation", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return updated;
    }),

  // ── Admin: update review checklist ───────────────────────────────────────
  adminUpdateChecklist: protectedProcedure
    .input(z.object({ id: z.number(), checklist: z.record(z.string(), z.boolean()) }))
    .mutation(async ({ input }) => {
      const [updated] = await q<any>(
        `UPDATE dpco_accreditation_applications
         SET review_checklist=?::jsonb, updated_at=NOW()
         WHERE id=? RETURNING *`,
        [JSON.stringify(input.checklist), input.id]
      );
      emitMutationEvent("ndsep.accreditation.mutation", { action: "accreditation", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return updated;
    }),

  // ── Admin: request additional information ────────────────────────────────
  adminRequestInfo: protectedProcedure
    .input(z.object({ id: z.number(), note: z.string().min(10) }))
    .mutation(async ({ input }) => {
      const [updated] = await q<any>(
        `UPDATE dpco_accreditation_applications
         SET status='info_requested', info_request_note=?, info_requested_at=NOW(), updated_at=NOW()
         WHERE id=? RETURNING *`,
        [input.note, input.id]
      );
      emitMutationEvent("ndsep.accreditation.mutation", { action: "accreditation", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return updated;
    }),

  // ── Admin: schedule competency assessment ────────────────────────────────
  adminScheduleCompetency: protectedProcedure
    .input(z.object({ id: z.number(), scheduledAt: z.string() }))
    .mutation(async ({ input }) => {
      const [updated] = await q<any>(
        `UPDATE dpco_accreditation_applications
         SET status='competency_scheduled', competency_scheduled_at=?, updated_at=NOW()
         WHERE id=? RETURNING *`,
        [new Date(input.scheduledAt), input.id]
      );
      emitMutationEvent("ndsep.accreditation.mutation", { action: "accreditation", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return updated;
    }),

  // ── Admin: make decision ──────────────────────────────────────────────────
  adminMakeDecision: protectedProcedure
    .input(z.object({
      id: z.number(),
      decision: z.enum(["approved", "conditionally_approved", "rejected"]),
      reason: z.string().min(5),
      conditions: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const decisionBy = (ctx.user as any).name ?? (ctx.user as any).email ?? "NDPC";
      const now = new Date();
      const licenceExpiry = new Date(now);
      licenceExpiry.setFullYear(licenceExpiry.getFullYear() + 1);

      const [app] = await q<any>(
        `SELECT * FROM dpco_accreditation_applications WHERE id = ?`, [input.id]
      );
      if (!app) throw new Error("Application not found");

      const isApproved = input.decision === "approved" || input.decision === "conditionally_approved";
      let dpcoOrgId = app.existing_dpco_org_id;

      if (isApproved) {
        if (app.existing_dpco_org_id) {
          await q(
            `UPDATE dpco_organisations SET status='active', licence_expires_at=?, approved_at=NOW(), approved_by=?, updated_at=NOW() WHERE id=?`,
            [licenceExpiry, decisionBy, app.existing_dpco_org_id]
          );
        } else {
          const [newOrg] = await q<any>(
            `INSERT INTO dpco_organisations (name, email, phone, address, rc_number, cac_number, tax_id, website, sectors, status, licence_expires_at, approved_at, approved_by, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),?,NOW(),NOW()) RETURNING id`,
            [
              app.org_name, app.email, app.phone, app.address, app.rc_number,
              app.cac_number, app.tax_id, app.website, app.sectors,
              "active", licenceExpiry, decisionBy,
            ]
          );
          dpcoOrgId = newOrg.id;
        }
      }

      const licenceNumber = isApproved ? generateLicenceNumber(dpcoOrgId ?? input.id) : null;

      if (isApproved && dpcoOrgId && licenceNumber) {
        await q(
          `UPDATE dpco_organisations SET licence_number=?, updated_at=NOW() WHERE id=?`,
          [licenceNumber, dpcoOrgId]
        );
      }

      const [updated] = await q<any>(
        `UPDATE dpco_accreditation_applications
         SET status=?, decision=?, decision_at=NOW(), decision_by=?, decision_reason=?,
             conditions=?, issued_licence_number=?, licence_issued_at=?,
             licence_expires_at=?, existing_dpco_org_id=COALESCE(existing_dpco_org_id, ?), updated_at=NOW()
         WHERE id=? RETURNING *`,
        [
          input.decision, input.decision, decisionBy, input.reason,
          input.conditions ?? null, licenceNumber,
          isApproved ? now : null, isApproved ? licenceExpiry : null,
          dpcoOrgId ?? null, input.id,
        ]
      );
      // Notify applicant of decision
      try {
        const decisionLabel = input.decision === 'approved' ? 'Approved'
          : input.decision === 'conditionally_approved' ? 'Conditionally Approved'
          : 'Rejected';
        await notifyOwner({
          title: `DPCO Accreditation Decision: ${decisionLabel} — ${updated?.org_name ?? ''}`,
          content: `The NDPC has made a decision on the DPCO accreditation application.\n\n**Organisation:** ${updated?.org_name ?? ''}\n**Decision:** ${decisionLabel}\n**Licence Number:** ${licenceNumber ?? 'N/A'}\n**Reason:** ${input.reason ?? 'None provided'}\n\nThe applicant can check their status at: /accreditation/status`,
        });
      } catch { /* notification failure is non-blocking */ }
      emitMutationEvent("ndsep.accreditation.mutation", { action: "accreditation", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { application: updated, licenceNumber, dpcoOrgId };
    }),

  // ── Admin: suspend DPCO accreditation ────────────────────────────────────
  adminSuspend: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(5) }))
    .mutation(async ({ input }) => {
      const [updated] = await q<any>(
        `UPDATE dpco_accreditation_applications
         SET status='suspended', suspended_at=NOW(), suspension_reason=?, updated_at=NOW()
         WHERE id=? RETURNING *`,
        [input.reason, input.id]
      );
      if (updated?.existing_dpco_org_id) {
        await q(
          `UPDATE dpco_organisations SET status='suspended', updated_at=NOW() WHERE id=?`,
          [updated.existing_dpco_org_id]
        );
      }
      try {
        await notifyOwner({
          title: `DPCO Accreditation Suspended — ${updated?.org_name ?? ''}`,
          content: `The DPCO accreditation for **${updated?.org_name ?? ''}** has been suspended.\n\n**Reason:** ${input.reason}\n\nThe DPCO cannot file new CARs until the suspension is lifted. Review at: /admin/accreditation`,
        });
      } catch { /* non-blocking */ }
      emitMutationEvent("ndsep.accreditation.mutation", { action: "accreditation", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return updated;
    }),

  // ── Admin: revoke DPCO accreditation ─────────────────────────────────────
  adminRevoke: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(5) }))
    .mutation(async ({ input }) => {
      const [updated] = await q<any>(
        `UPDATE dpco_accreditation_applications
         SET status='revoked', revoked_at=NOW(), revocation_reason=?, updated_at=NOW()
         WHERE id=? RETURNING *`,
        [input.reason, input.id]
      );
      if (updated?.existing_dpco_org_id) {
        await q(
          `UPDATE dpco_organisations SET status='revoked', updated_at=NOW() WHERE id=?`,
          [updated.existing_dpco_org_id]
        );
      }
      try {
        await notifyOwner({
          title: `DPCO Accreditation Revoked — ${updated?.org_name ?? ''}`,
          content: `The DPCO accreditation for **${updated?.org_name ?? ''}** has been permanently revoked.\n\n**Reason:** ${input.reason}\n\nThis DPCO has been removed from the active registry and cannot file CARs. Review at: /admin/accreditation`,
        });
      } catch { /* non-blocking */ }
      emitMutationEvent("ndsep.accreditation.mutation", { action: "accreditation", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return updated;
    }),

  // ── Get renewal eligibility for a DPCO org ───────────────────────────────
  getRenewalEligibility: publicProcedure
    .input(z.object({ dpcoOrgId: z.number() }))
    .query(async ({ input }) => {
      const [org] = await q<any>(
        `SELECT * FROM dpco_organisations WHERE id = ?`, [input.dpcoOrgId]
      );
      if (!org) throw new Error("DPCO not found");
      const now = Date.now();
      const expiresAt = org.licence_expires_at ? new Date(org.licence_expires_at).getTime() : null;
      const daysUntilExpiry = expiresAt ? Math.ceil((expiresAt - now) / 86_400_000) : null;
      return {
        org,
        daysUntilExpiry,
        isExpired: expiresAt ? expiresAt < now : false,
        isExpiringSoon: daysUntilExpiry !== null && daysUntilExpiry <= 90,
        canRenew: daysUntilExpiry !== null && daysUntilExpiry <= 90,
        renewalFeeKobo: RENEWAL_FEE_KOBO,
      };
    }),

  // ── DPCO: get my licence status ────────────────────────────────────────────
  getMyLicence: protectedProcedure.query(async ({ ctx }) => {
    const [app] = await q<any>(
      `SELECT a.*, o.licence_number, o.licence_expires_at, o.status as org_status
       FROM dpco_accreditation_applications a
       LEFT JOIN dpco_organisations o ON o.id = a.existing_dpco_org_id
       WHERE a.email = ? AND a.status IN ('approved','conditionally_approved')
       ORDER BY a.decision_at DESC LIMIT 1`,
      [ctx.user.email]
    );
    if (!app) return null;
    return {
      licenceNumber: app.issued_licence_number ?? app.licence_number,
      licenceExpiresAt: app.licence_expires_at,
      orgName: app.org_name,
      status: app.org_status ?? app.status,
    };
  }),

  // ── DPCO: submit renewal application ─────────────────────────────────────
  submitRenewal: protectedProcedure
    .input(z.object({
      indemnityInsuranceUrl: z.string().optional(),
      financialStatementsUrl: z.string().optional(),
      auditMethodologyUrl: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Find the approved application for this user
      const [existing] = await q<any>(
        `SELECT * FROM dpco_accreditation_applications
         WHERE email = ? AND status IN ('approved','conditionally_approved')
         ORDER BY decision_at DESC LIMIT 1`,
        [ctx.user.email]
      );
      if (!existing) throw new Error("No approved accreditation found for this account");
      const token = `NDPC-DPCO-RNW-${Date.now().toString(36).toUpperCase()}`;
      await q(
        `INSERT INTO dpco_accreditation_applications
         (reference_token, org_name, rc_number, address, email, lead_auditors, sectors,
          indemnity_insurance_url, financial_statements_url, audit_methodology_url,
          application_type, status, existing_dpco_org_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'renewal','submitted',?,NOW(),NOW())`,
        [
          token, existing.org_name, existing.rc_number, existing.address, existing.email,
          existing.lead_auditors, existing.sectors,
          input.indemnityInsuranceUrl ?? existing.indemnity_insurance_url,
          input.financialStatementsUrl ?? existing.financial_statements_url,
          input.auditMethodologyUrl ?? existing.audit_methodology_url,
          existing.existing_dpco_org_id,
        ]
      );
      emitMutationEvent("ndsep.accreditation.mutation", { action: "accreditation", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return { referenceToken: token };
    }),

  // ── Get current DPCO tier for logged-in user ────────────────────────────
  getMyTier: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await q<any>(
      `SELECT d.tier, d.status, d.licence_number, d.licence_expires_at, d.name
       FROM dpco_organisations d
       INNER JOIN users u ON u.email = d.email
       WHERE u.id = ?
       LIMIT 1`,
      [ctx.user.id]
    );
    if (!row) return { tier: "starter" as const, status: "unknown", licenceNumber: null, licenceExpiresAt: null, name: null };
    return {
      tier: (row.tier ?? "starter") as "starter" | "professional" | "enterprise",
      status: row.status,
      licenceNumber: row.licence_number,
      licenceExpiresAt: row.licence_expires_at ? new Date(row.licence_expires_at).toISOString() : null,
      name: row.name,
    };
  }),

  // ── Public list of active DPCOs for the registry search widget ────────────
  publicListDpcos: publicProcedure
    .input(z.object({
      search: z.string().optional(),
      sector: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const conditions: string[] = ["status = 'active'"];
      const params: unknown[] = [];
      if (input?.search) {
        conditions.push("(name ILIKE ? OR email ILIKE ?)");
        params.push(`%${input.search}%`, `%${input.search}%`);
      }
      if (input?.sector) {
        conditions.push("sectors ILIKE ?");
        params.push(`%${input.sector}%`);
      }
      const where = conditions.join(" AND ");
      const rows = await q<any>(
        `SELECT id, name, email, phone, dpo_name, dpo_email, sectors, tier, licence_number, licence_expires_at, created_at
         FROM dpco_organisations
         WHERE ${where}
         ORDER BY name ASC
         LIMIT 50`,
        params
      );
      return rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        dpoName: r.dpo_name,
        sectors: r.sectors,
        tier: r.tier,
        licenceNumber: r.licence_number,
        licenceExpiresAt: r.licence_expires_at,
      }));
    }),

  // ── Generate certificate data for approved applications ───────────────────
  generateCertificate: protectedProcedure
    .input(z.object({ applicationId: z.number().int() }))
    .mutation(async ({ input }) => {
      const [app] = await q<any>(
        `SELECT a.*, o.name as dpco_name, o.licence_number, o.licence_expires_at
         FROM dpco_accreditation_applications a
         LEFT JOIN dpco_organisations o ON o.id = a.existing_dpco_org_id
         WHERE a.id = ?`,
        [input.applicationId]
      );
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
      if (app.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "Certificate only available for approved applications" });
      const issuedDate = app.approved_at
        ? new Date(app.approved_at).toLocaleDateString("en-NG", { day: "2-digit", month: "long", year: "numeric" })
        : new Date().toLocaleDateString("en-NG", { day: "2-digit", month: "long", year: "numeric" });
      const expiryDate = app.licence_expires_at
        ? new Date(app.licence_expires_at).toLocaleDateString("en-NG", { day: "2-digit", month: "long", year: "numeric" })
        : "N/A";
      const certNumber = `NDPC/DPCO/${app.licence_number ?? app.reference_token.slice(0, 8).toUpperCase()}`;
      emitMutationEvent("ndsep.accreditation.mutation", { action: "accreditation", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return {
        certNumber,
        dpcoName: app.dpco_name ?? app.org_name,
        licenceNumber: app.licence_number ?? "Pending",
        issuedDate,
        expiryDate,
        rcNumber: app.rc_number,
        sectors: app.sectors,
        signatoryName: "Director General, NDPC",
        verifyUrl: `https://ndsep.ndpc.gov.ng/verify/${app.reference_token}`,
      };
    }),

  // ── Public: verify DPCO certificate by reference token ─────────────────
  verifyDpcoCertificate: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ input }) => {
      const [app] = await q<any>(
        `SELECT a.*, o.name as dpco_name, o.licence_number, o.status as org_status,
                o.licence_expires_at, o.tier
         FROM dpco_accreditation_applications a
         LEFT JOIN dpco_organisations o ON o.id = a.existing_dpco_org_id
         WHERE a.reference_token = ? AND a.status = 'approved'
         LIMIT 1`,
        [input.token]
      );
      if (!app) {
        return { valid: false, message: "Certificate not found or not yet approved" };
      }
      const now = new Date();
      const expiresAt = app.licence_expires_at ? new Date(app.licence_expires_at) : null;
      const isExpired = expiresAt ? expiresAt < now : false;
      const isRevoked = app.org_status === "revoked" || app.org_status === "suspended";
      if (isRevoked) {
        return { valid: false, message: `DPCO licence has been ${app.org_status}` };
      }
      if (isExpired) {
        return {
          valid: false,
          message: "DPCO licence has expired",
          expiredAt: expiresAt?.toISOString(),
        };
      }
      return {
        valid: true,
        dpcoName: app.dpco_name ?? app.org_name,
        licenceNumber: app.licence_number ?? `NDPC/DPCO/${app.reference_token.slice(0, 8).toUpperCase()}`,
        tier: app.tier ?? "starter",
        sectors: app.sectors,
        rcNumber: app.rc_number,
        approvedAt: app.approved_at,
        expiresAt: expiresAt?.toISOString() ?? null,
        status: app.org_status ?? "active",
        verifyUrl: `https://ndsep.ndpc.gov.ng/verify/${app.reference_token}`,
        message: "DPCO licence is valid and active",
      };
    }),

  // ── Admin: get accreditation stats ───────────────────────────────────────
  adminGetStats: protectedProcedure.query(async () => {
    const rows = await q<any>(
      `SELECT status, COUNT(*) as count FROM dpco_accreditation_applications GROUP BY status`
    );
    const stats: Record<string, number> = {};
    for (const r of rows) stats[r.status] = parseInt(r.count);
    const [{ total }] = await q<any>(`SELECT COUNT(*) as total FROM dpco_accreditation_applications`);
    const [{ active }] = await q<any>(`SELECT COUNT(*) as active FROM dpco_organisations WHERE status='active'`);
    return { byStatus: stats, total: parseInt(total), activeDpcos: parseInt(active) };
  }),
});
