/**
 * AI-Regulation Instruments Router (Gap 16)
 * Risk-tier assessments, high-risk permits, unacceptable-tier prohibition
 * orders, conformity assessment lifecycle, AI incident reporting, and
 * escalation of AI findings into the existing enforcement flow via the
 * ai_enforcement_links linkage table (no changes to existing tables).
 *
 * LEGAL FRAMING: the risk tiers, permits and prohibition orders below are
 * NDPC POLICY INSTRUMENTS adopted under the Commission's general NDPA 2023
 * mandate — there is (as of implementation) no dedicated Nigerian AI statute
 * establishing an EU-AI-Act-style tier regime. They are published as
 * anticipatory supervisory guidance pending an explicit statutory basis and
 * must be reviewed by counsel before being relied on in enforcement.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getPool } from "../db";
import { logger } from "../logger";
import { logAuditEvent } from "../middlewareHelpers";
import { emitMutationEvent, EVENTS } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import { encryptField } from "../encryption";

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
    logger.error({ err, query: query.slice(0, 200) }, "[ai-reg] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

// NDPC policy-instrument risk tiers (see LEGAL FRAMING in the file header) —
// not yet grounded in a dedicated AI statute.
const TIERS = ["minimal", "limited", "high", "unacceptable"] as const;
const HARM_CATEGORIES = [
  "discrimination", "privacy_harm", "physical_harm", "financial_harm",
  "psychological_harm", "manipulation", "misinformation", "other",
] as const;

async function nextRef(seq: string, prefix: string, pad = 5): Promise<string> {
  const rows = await exec(`SELECT nextval('${seq}') AS n`);
  return `${prefix}-${new Date().getFullYear()}-${String(Number(rows[0]?.n ?? 0)).padStart(pad, "0")}`;
}

export const aiRegulationRouter = router({
  // ─── Risk-tier assessments ──────────────────────────────────────────────
  listAssessments: protectedProcedure
    .input(z.object({ tier: z.enum(TIERS).optional(), orgId: z.number().int().optional() }))
    .query(async ({ input }) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.tier) { params.push(input.tier); conds.push(`a.tier = $${params.length}`); }
      if (input.orgId) { params.push(input.orgId); conds.push(`a.organization_id = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      return exec(
        `SELECT a.*, o.name as org_name,
           (SELECT COUNT(*) FROM ai_permits p WHERE p.assessment_id = a.id) as instruments,
           (SELECT COUNT(*) FROM ai_conformity_assessments c WHERE c.assessment_id = a.id) as conformity_assessments
         FROM ai_risk_tier_assessments a
         LEFT JOIN organizations o ON a.organization_id = o.id
         ${where} ORDER BY a.assessed_at DESC LIMIT 200`,
        params
      );
    }),

  createAssessment: adminProcedure
    .input(z.object({
      organizationId: z.number().int().optional(),
      systemName: z.string().min(2).max(256),
      systemPurpose: z.string().max(5000).optional(),
      tier: z.enum(TIERS),
      rationale: z.string().min(20).max(10000),
      reviewDueAt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const ref = await nextRef("airt_ref_seq", "AIRT");
      const rows = await exec(
        `INSERT INTO ai_risk_tier_assessments
          (system_ref, organization_id, system_name, system_purpose, tier, rationale, assessor_id, assessor_name, review_due_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ref, input.organizationId ?? null, input.systemName, input.systemPurpose ?? null,
         input.tier, input.rationale, (ctx as any).user?.id ?? null, (ctx as any).user?.name ?? null, input.reviewDueAt ?? null]
      );
      // Unacceptable-tier systems automatically attract a prohibition order
      if (input.tier === "unacceptable" && rows[0]) {
        const pRef = await nextRef("ai_permit_ref_seq", "AIP");
        await exec(
          `INSERT INTO ai_permits (assessment_id, permit_ref, organization_id, instrument_type, status, decision_notes, reviewed_by, reviewed_at)
           VALUES ($1,$2,$3,'prohibition_order','in_force',$4,$5,NOW())`,
          [rows[0].id, pRef, input.organizationId ?? null,
           "Automatic prohibition order — system classified as unacceptable risk.", (ctx as any).user?.id ?? null]
        );
      }
      await logAuditEvent("ai_reg.assessment_created", "ai_risk_tier_assessment", rows[0]?.id ?? "", String((ctx as any).user?.id ?? ""), { tier: input.tier, systemRef: ref });
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "ai_reg_assessment", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  // ─── Permits (high-risk) & prohibition orders (unacceptable) ────────────
  applyForPermit: protectedProcedure
    .input(z.object({ assessmentId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const assessments = await exec(`SELECT * FROM ai_risk_tier_assessments WHERE id = $1`, [input.assessmentId]);
      const a = assessments[0];
      if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Risk-tier assessment not found." });
      // IDOR guard: only staff or members of the assessed organisation may
      // file a permit application for it.
      if (!["admin", "government_staff"].includes(ctx.user.role)) {
        if (a.organization_id == null) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Only staff may apply for permits on unowned assessments." });
        }
        const membership = await exec(
          `SELECT 1 AS member FROM organization_users WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
          [ctx.user.id, a.organization_id]
        );
        if (membership.length === 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can only apply for permits for organisations you belong to." });
        }
      }
      if (a.tier !== "high") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Only high-risk systems require a permit (this system is '${a.tier}').` });
      }
      const existing = await exec(
        `SELECT id FROM ai_permits WHERE assessment_id = $1 AND instrument_type = 'permit' AND status IN ('applied','under_review','granted')`,
        [input.assessmentId]
      );
      if (existing[0]) throw new TRPCError({ code: "CONFLICT", message: "A live permit application already exists for this system." });
      const ref = await nextRef("ai_permit_ref_seq", "AIP");
      const rows = await exec(
        `INSERT INTO ai_permits (assessment_id, permit_ref, organization_id, instrument_type, status)
         VALUES ($1,$2,$3,'permit','applied') RETURNING *`,
        [input.assessmentId, ref, a.organization_id ?? null]
      );
      await logAuditEvent("ai_reg.permit_applied", "ai_permit", rows[0]?.id ?? "", String((ctx as any).user?.id ?? ""), { permitRef: ref });
      return rows[0];
    }),

  listPermits: protectedProcedure
    .input(z.object({ status: z.string().optional(), instrumentType: z.enum(["permit", "prohibition_order"]).optional() }))
    .query(async ({ input }) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.status) { params.push(input.status); conds.push(`p.status = $${params.length}`); }
      if (input.instrumentType) { params.push(input.instrumentType); conds.push(`p.instrument_type = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      return exec(
        `SELECT p.*, a.system_name, a.system_ref, a.tier, o.name as org_name
         FROM ai_permits p
         JOIN ai_risk_tier_assessments a ON p.assessment_id = a.id
         LEFT JOIN organizations o ON p.organization_id = o.id
         ${where} ORDER BY p.created_at DESC LIMIT 200`,
        params
      );
    }),

  reviewPermit: adminProcedure
    .input(z.object({
      id: z.number().int(),
      decision: z.enum(["under_review", "granted", "suspended", "revoked"]),
      conditions: z.array(z.string().max(512)).max(50).optional(),
      decisionNotes: z.string().max(5000).optional(),
      expiresAt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE ai_permits SET
           status = $1,
           conditions = COALESCE($2, conditions),
           decision_notes = COALESCE($3, decision_notes),
           reviewed_by = $4, reviewed_at = NOW(),
           granted_at = CASE WHEN $1 = 'granted' THEN NOW() ELSE granted_at END,
           expires_at = CASE WHEN $1 = 'granted' THEN $5 ELSE expires_at END,
           suspended_at = CASE WHEN $1 = 'suspended' THEN NOW() ELSE suspended_at END,
           revoked_at = CASE WHEN $1 = 'revoked' THEN NOW() ELSE revoked_at END,
           updated_at = NOW()
         WHERE id = $6 AND instrument_type = 'permit' RETURNING id, permit_ref, status`,
        [input.decision, input.conditions ?? null, input.decisionNotes ?? null,
         (ctx as any).user?.id ?? null, input.expiresAt ?? null, input.id]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Permit not found." });
      await logAuditEvent(`ai_reg.permit_${input.decision}`, "ai_permit", input.id, String((ctx as any).user?.id ?? ""), { permitRef: rows[0].permit_ref });
      return rows[0];
    }),

  liftProhibitionOrder: adminProcedure
    .input(z.object({ id: z.number().int(), decisionNotes: z.string().min(10).max(5000) }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE ai_permits SET status = 'lifted', decision_notes = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
         WHERE id = $3 AND instrument_type = 'prohibition_order' AND status = 'in_force' RETURNING id`,
        [input.decisionNotes, (ctx as any).user?.id ?? null, input.id]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "In-force prohibition order not found." });
      await logAuditEvent("ai_reg.prohibition_lifted", "ai_permit", input.id, String((ctx as any).user?.id ?? ""), {});
      return { success: true };
    }),

  // ─── Conformity assessment lifecycle ────────────────────────────────────
  startConformityAssessment: protectedProcedure
    .input(z.object({ assessmentId: z.number().int(), permitId: z.number().int().optional() }))
    .mutation(async ({ input, ctx }) => {
      const ref = await nextRef("aica_ref_seq", "AICA");
      const rows = await exec(
        `INSERT INTO ai_conformity_assessments (assessment_id, permit_id, ref, assessor_id)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [input.assessmentId, input.permitId ?? null, ref, (ctx as any).user?.id ?? null]
      );
      return rows[0];
    }),

  recordChecklistResults: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      checklistResults: z.record(z.string(), z.enum(["pass", "fail", "n/a"])),
      overallResult: z.enum(["pass", "conditional", "fail"]),
    }))
    .mutation(async ({ input }) => {
      // The checklist is LOCKED once a certificate has been issued: editing
      // results post-issuance would retroactively falsify the basis of an
      // issued conformity certificate.
      const rows = await exec(
        `UPDATE ai_conformity_assessments SET checklist_results = $1, overall_result = $2, updated_at = NOW()
         WHERE id = $3 AND certificate_issued_at IS NULL RETURNING id`,
        [input.checklistResults, input.overallResult, input.id]
      );
      if (!rows[0]) {
        const existing = await exec(`SELECT certificate_issued_at FROM ai_conformity_assessments WHERE id = $1`, [input.id]);
        if (existing[0]?.certificate_issued_at) {
          throw new TRPCError({ code: "CONFLICT", message: "Checklist is locked: a certificate has already been issued for this conformity assessment." });
        }
        throw new TRPCError({ code: "NOT_FOUND", message: "Conformity assessment not found." });
      }
      return { success: true };
    }),

  issueCertificate: adminProcedure
    .input(z.object({ id: z.number().int(), certificateExpiresAt: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const cas = await exec(`SELECT * FROM ai_conformity_assessments WHERE id = $1`, [input.id]);
      if (!cas[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Conformity assessment not found." });
      if (cas[0].overall_result !== "pass") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Certificates can only be issued for a passing conformity assessment." });
      }
      const certRef = `AICERT-${new Date().getFullYear()}-${String(cas[0].id).padStart(5, "0")}`;
      const rows = await exec(
        `UPDATE ai_conformity_assessments SET certificate_ref = $1, certificate_issued_at = NOW(),
           certificate_expires_at = $2, completed_at = NOW(), updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [certRef, input.certificateExpiresAt ?? null, input.id]
      );
      await logAuditEvent("ai_reg.certificate_issued", "ai_conformity_assessment", input.id, String((ctx as any).user?.id ?? ""), { certificateRef: certRef });
      return rows[0];
    }),

  listConformityAssessments: protectedProcedure
    .input(z.object({ assessmentId: z.number().int().optional() }))
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input.assessmentId) { params.push(input.assessmentId); where = `WHERE c.assessment_id = $${params.length}`; }
      return exec(
        `SELECT c.*, a.system_name, a.system_ref FROM ai_conformity_assessments c
         JOIN ai_risk_tier_assessments a ON c.assessment_id = a.id
         ${where} ORDER BY c.started_at DESC LIMIT 200`,
        params
      );
    }),

  // ─── AI incident reporting channel (public + org) ───────────────────────
  reportIncident: publicProcedure
    .input(z.object({
      reporterType: z.enum(["public", "org"]).default("public"),
      reporterName: z.string().max(256).optional(),
      reporterEmail: z.string().email().optional(),
      organizationId: z.number().int().optional(),
      systemName: z.string().min(2).max(256),
      description: z.string().min(20).max(10000),
      severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      harmCategories: z.array(z.enum(HARM_CATEGORIES)).min(1).max(8),
      occurredAt: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (input.reporterType === "org" && !input.organizationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Organisation incident reports must include organizationId." });
      }
      const ref = await nextRef("ai_incident_ref_seq", "AIINC");
      const rows = await exec(
        `INSERT INTO ai_incidents
          (incident_ref, organization_id, reporter_type, reporter_name, reporter_email,
           system_name, description, severity, harm_categories, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, incident_ref, status, reported_at`,
        [ref, input.organizationId ?? null, input.reporterType, input.reporterName ? encryptField(input.reporterName) : null, input.reporterEmail ? encryptField(input.reporterEmail) : null,
         input.systemName, input.description, input.severity, input.harmCategories, input.occurredAt ?? null]
      );
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "ai_incident_reported", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  listIncidents: protectedProcedure
    .input(z.object({ status: z.string().optional(), severity: z.enum(["low", "medium", "high", "critical"]).optional() }))
    .query(async ({ input }) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.status) { params.push(input.status); conds.push(`i.status = $${params.length}`); }
      if (input.severity) { params.push(input.severity); conds.push(`i.severity = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      return exec(
        `SELECT i.*, o.name as org_name FROM ai_incidents i
         LEFT JOIN organizations o ON i.organization_id = o.id
         ${where} ORDER BY i.reported_at DESC LIMIT 200`,
        params
      );
    }),

  triageIncident: adminProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(["triaged", "investigating", "resolved", "closed"]),
      triageNotes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(
        `UPDATE ai_incidents SET status = $1, triaged_by = $2, triage_notes = $3,
           resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END, updated_at = NOW()
         WHERE id = $4 RETURNING id`,
        [input.status, (ctx as any).user?.id ?? null, input.triageNotes ?? null, input.id]
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Incident not found." });
      await logAuditEvent(`ai_reg.incident_${input.status}`, "ai_incident", input.id, String((ctx as any).user?.id ?? ""), {});
      return { success: true };
    }),

  // ─── Escalate an AI finding into the existing enforcement flow ──────────
  escalateToEnforcement: adminProcedure
    .input(z.object({
      sourceType: z.enum(["risk_assessment", "permit", "conformity", "incident"]),
      sourceId: z.number().int(),
      enforcementCaseId: z.number().int().optional(),
      financialPenaltyId: z.number().int().optional(),
      linkNotes: z.string().min(10).max(5000),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!input.enforcementCaseId && !input.financialPenaltyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provide an enforcementCaseId or financialPenaltyId to link against." });
      }
      // Verify the source record exists
      const sourceTables: Record<string, string> = {
        risk_assessment: "ai_risk_tier_assessments",
        permit: "ai_permits",
        conformity: "ai_conformity_assessments",
        incident: "ai_incidents",
      };
      const src = await exec(`SELECT id FROM ${sourceTables[input.sourceType]} WHERE id = $1`, [input.sourceId]);
      if (!src[0]) throw new TRPCError({ code: "NOT_FOUND", message: "AI source record not found." });
      // Verify the enforcement target exists (existing tables, read-only)
      if (input.enforcementCaseId) {
        const ec = await exec(`SELECT id FROM enforcement_cases WHERE id = $1`, [input.enforcementCaseId]);
        if (!ec[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Enforcement case not found." });
      }
      if (input.financialPenaltyId) {
        const fp = await exec(`SELECT id FROM financial_penalties WHERE id = $1`, [input.financialPenaltyId]);
        if (!fp[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Financial penalty not found." });
      }
      const rows = await exec(
        `INSERT INTO ai_enforcement_links (source_type, source_id, enforcement_case_id, financial_penalty_id, link_notes, escalated_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [input.sourceType, input.sourceId, input.enforcementCaseId ?? null, input.financialPenaltyId ?? null,
         input.linkNotes, (ctx as any).user?.id ?? null]
      );
      await logAuditEvent("ai_reg.escalated_to_enforcement", "ai_enforcement_link", rows[0]?.id ?? "", String((ctx as any).user?.id ?? ""), {
        sourceType: input.sourceType, sourceId: input.sourceId,
        enforcementCaseId: input.enforcementCaseId ?? null, financialPenaltyId: input.financialPenaltyId ?? null,
      });
      emitMutationEvent(EVENTS.COMPLIANCE_SCORE_UPDATED, { action: "ai_reg_enforcement_link", ts: new Date().toISOString() }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
      return rows[0];
    }),

  listEnforcementLinks: protectedProcedure
    .input(z.object({ sourceType: z.enum(["risk_assessment", "permit", "conformity", "incident"]).optional(), sourceId: z.number().int().optional() }))
    .query(async ({ input }) => {
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.sourceType) { params.push(input.sourceType); conds.push(`l.source_type = $${params.length}`); }
      if (input.sourceId) { params.push(input.sourceId); conds.push(`l.source_id = $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      return exec(
        `SELECT l.*, ec.case_reference, fp.amount as penalty_amount, fp.currency as penalty_currency
         FROM ai_enforcement_links l
         LEFT JOIN enforcement_cases ec ON l.enforcement_case_id = ec.id
         LEFT JOIN financial_penalties fp ON l.financial_penalty_id = fp.id
         ${where} ORDER BY l.escalated_at DESC LIMIT 200`,
        params
      );
    }),
});
