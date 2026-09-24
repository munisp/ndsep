/**
 * Cross-Border Transfer Declarations Router — NDPA 2023 ss.41-43
 * ==============================================================
 * Periodic (annual + on-change) machine-readable transfer declarations by
 * controllers: destination, legal basis, data categories, subject/volume bands,
 * processors/sub-processors. Server-side validation runs DEFENSIVELY against
 * the 0030 registries (adequacy_decisions, binding_corporate_rules, and the
 * SCC registry when present) plus the 0089 destination_risk_register:
 * missing registry rows are treated as NON-COMPLIANT — never assumed valid.
 *
 *  - basis = none_claimed, or destination with no valid safeguard
 *      -> automatic non-compliance finding + enforcement referral event
 *  - amendment history is append-only (DB trigger enforces immutability)
 *  - anomaly scans (z-score volume outliers, no-transfer contradictions) and
 *    adequacy-suspension cascade re-validation live in services/transferAnomaly
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import {
  LEGAL_BASES,
  SUBJECT_COUNT_BANDS,
  VOLUME_BANDS,
  validateDeclarationBasis,
  type LegalBasis,
  type RegistrySnapshot,
} from "../services/transferValidation";
import {
  runContradictionScan,
  runVolumeAnomalyScan,
  revalidateDeclarationsForAdequacy,
} from "../services/transferAnomaly";

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
    logger.error({ err, query: query.slice(0, 200) }, "[transferDeclarations] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

/** audit_logs.resource_id / user_id are int4; coerce non-numeric refs to NULL. */
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
  details: Record<string, unknown> = {}
): Promise<void> {
  try {
    await exec(
      `INSERT INTO audit_logs (action, resource_type, resource_id, user_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NOW())`,
      [action, resourceType, toIntOrNull(resourceId), toIntOrNull(userId), JSON.stringify(details)]
    );
  } catch (err) {
    logger.warn({ err, action, resourceType }, "[transferDeclarations] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

const PROCESSOR_SCHEMA = z.object({
  name: z.string().min(1).max(256),
  country: z.string().min(2).max(128),
  role: z.enum(["processor", "sub_processor"]).default("processor"),
});

const DECLARATION_INPUT = z.object({
  organization_id: z.number().int().positive(),
  declaration_type: z.enum(["annual", "on_change"]).default("annual"),
  period_start: z.string().min(8).max(10),
  period_end: z.string().min(8).max(10),
  destination_country: z.string().min(2).max(128),
  legal_basis: z.enum(LEGAL_BASES),
  data_categories: z.array(z.string().min(1).max(64)).max(50).default([]),
  subject_count_band: z.enum(SUBJECT_COUNT_BANDS),
  volume_band: z.enum(VOLUME_BANDS),
  volume_estimate_gb: z.number().min(0).max(1_000_000_000).optional(),
  processors: z.array(PROCESSOR_SCHEMA).max(200).default([]),
  declares_no_transfers: z.boolean().default(false),
});

// ─── Defensive registry lookups (0030 tables + 0089 risk register) ──────────
// Every lookup treats a missing row (or missing table) as "no valid safeguard".
async function gatherRegistrySnapshot(
  organizationId: number,
  destinationCountry: string
): Promise<RegistrySnapshot> {
  // 1. Adequacy decision for the destination (0030). Latest decision wins.
  const adequacy = await exec(
    `SELECT id, decision_status FROM adequacy_decisions
     WHERE country ILIKE $1 ORDER BY id DESC LIMIT 1`,
    [destinationCountry]
  );
  const adequacyDecisionStatus = (adequacy[0]?.decision_status ?? null) as RegistrySnapshot["adequacyDecisionStatus"];
  const adequacyDecisionId = adequacy[0]?.id ?? null;

  // 2. BCR for the organisation (0030). Most advanced status wins.
  const bcr = await exec(
    `SELECT status FROM binding_corporate_rules
     WHERE organization_id = $1
     ORDER BY CASE status WHEN 'approved' THEN 0 WHEN 'under_review' THEN 1 WHEN 'submitted' THEN 2 ELSE 3 END, id DESC
     LIMIT 1`,
    [organizationId]
  );
  const bcrStatus = (bcr[0]?.status ?? null) as RegistrySnapshot["bcrStatus"];

  // 3. SCC registry — defensive: the table may not exist yet in all
  //    environments; absence of table OR row means NO active registration.
  let sccRegistrationActive = false;
  const reg = await exec(`SELECT to_regclass('public.scc_registrations') AS reg`);
  if (reg[0]?.reg) {
    const scc = await exec(
      `SELECT id FROM scc_registrations
       WHERE organization_id = $1 AND status = 'active'
         AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
      [organizationId]
    );
    sccRegistrationActive = !!scc[0];
  }

  // 4. Destination risk register (0089).
  const risk = await exec(
    `SELECT adequacy_status FROM destination_risk_register WHERE country ILIKE $1 LIMIT 1`,
    [destinationCountry]
  );
  const destinationAdequacyStatus = (risk[0]?.adequacy_status ?? null) as RegistrySnapshot["destinationAdequacyStatus"];

  return { adequacyDecisionStatus, adequacyDecisionId, bcrStatus, sccRegistrationActive, destinationAdequacyStatus };
}

/** Persist validation findings; returns created finding rows. */
async function persistFindings(
  declarationId: number,
  organizationId: number,
  findings: ReturnType<typeof validateDeclarationBasis>["findings"]
): Promise<any[]> {
  const created: any[] = [];
  for (const f of findings) {
    const [row] = await exec(
      `INSERT INTO transfer_findings
         (declaration_id, organization_id, finding_type, severity, description, evidence, enforcement_referral, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'system:validation')
       RETURNING *`,
      [
        declarationId,
        organizationId,
        f.findingType,
        f.severity,
        f.message,
        JSON.stringify({ code: f.code }),
        f.enforcementReferral,
      ]
    );
    created.push(row);
    if (f.enforcementReferral) {
      // Enforcement referral event (fire-and-forget; finding row is the durable record).
      emitMutationEvent("ndsep.enforcement.referral", {
        action: "transfer_declaration_referral",
        declaration_id: declarationId,
        organization_id: organizationId,
        finding_id: row?.id,
        code: f.code,
        ts: new Date().toISOString(),
      }).catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
    }
  }
  return created;
}

export const crossBorderDeclarationsRouter = router({
  // ─── Submit a declaration (annual / on-change) ────────────────────────────
  submit: protectedProcedure
    .input(DECLARATION_INPUT)
    .mutation(async ({ input, ctx }) => {
      if (input.period_end < input.period_start) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "period_end must not precede period_start" });
      }
      const registry = await gatherRegistrySnapshot(input.organization_id, input.destination_country);
      const outcome = validateDeclarationBasis({
        legalBasis: input.legal_basis as LegalBasis,
        destinationCountry: input.destination_country,
        declaresNoTransfers: input.declares_no_transfers,
        registry,
      });
      const [row] = await exec(
        `INSERT INTO transfer_declarations
           (organization_id, declaration_type, period_start, period_end, destination_country,
            legal_basis, data_categories, subject_count_band, volume_band, volume_estimate_gb,
            processors, declares_no_transfers, adequacy_decision_id, compliance_status, status, submitted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'submitted',$15)
         RETURNING *`,
        [
          input.organization_id, input.declaration_type, input.period_start, input.period_end,
          input.destination_country, input.legal_basis, input.data_categories, input.subject_count_band,
          input.volume_band, input.volume_estimate_gb ?? null, input.processors, input.declares_no_transfers,
          outcome.adequacyDecisionId, outcome.complianceStatus, ctx.user.name ?? String(ctx.user.id),
        ]
      );
      const findings = await persistFindings(row.id, input.organization_id, outcome.findings);
      await logAudit("transfer_declaration_submitted", "transfer_declarations", row?.id, String(ctx.user.id), {
        organization_id: input.organization_id,
        destination: input.destination_country,
        legal_basis: input.legal_basis,
        compliance_status: outcome.complianceStatus,
        findings_raised: findings.length,
      });
      fireAndForget("crossBorderDeclarations.submit");
      return { ...row, validation: { compliant: outcome.compliant, findings: outcome.findings } };
    }),

  // ─── Amend a declaration (immutable history: prior state snapshotted) ─────
  amend: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      reason: z.string().min(10),
      changes: DECLARATION_INPUT.partial().omit({ organization_id: true }),
    }))
    .mutation(async ({ input, ctx }) => {
      const [existing] = await exec(`SELECT * FROM transfer_declarations WHERE id = $1`, [input.id]);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      if (["withdrawn", "superseded"].includes(existing.status)) {
        throw new TRPCError({ code: "CONFLICT", message: "Withdrawn or superseded declarations cannot be amended" });
      }
      const changedFields = Object.keys(input.changes).filter(
        (k) => JSON.stringify((input.changes as any)[k]) !== JSON.stringify(existing[k])
      );
      if (changedFields.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No effective changes supplied" });
      }
      // 1. Snapshot prior state into append-only history (trigger blocks UPDATE/DELETE).
      await exec(
        `INSERT INTO declaration_amendments (declaration_id, prior_state, changed_fields, reason, amended_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.id, JSON.stringify(existing), JSON.stringify(changedFields), input.reason, ctx.user.name ?? String(ctx.user.id)]
      );
      // 2. Apply changes; re-validate if destination/basis/zero-transfer flag moved.
      const merged = { ...existing, ...input.changes };
      let complianceStatus = existing.compliance_status;
      let adequacyDecisionId = existing.adequacy_decision_id;
      let newFindings: any[] = [];
      const revalidate = changedFields.some((f) =>
        ["destination_country", "legal_basis", "declares_no_transfers"].includes(f)
      );
      if (revalidate) {
        const registry = await gatherRegistrySnapshot(existing.organization_id, merged.destination_country);
        const outcome = validateDeclarationBasis({
          legalBasis: merged.legal_basis,
          destinationCountry: merged.destination_country,
          declaresNoTransfers: merged.declares_no_transfers,
          registry,
        });
        complianceStatus = outcome.complianceStatus;
        adequacyDecisionId = outcome.adequacyDecisionId;
        newFindings = await persistFindings(input.id, existing.organization_id, outcome.findings);
      }
      const [row] = await exec(
        `UPDATE transfer_declarations SET
           declaration_type = $2, period_start = $3, period_end = $4, destination_country = $5,
           legal_basis = $6, data_categories = $7, subject_count_band = $8, volume_band = $9,
           volume_estimate_gb = $10, processors = $11, declares_no_transfers = $12,
           adequacy_decision_id = $13, compliance_status = $14, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [
          input.id, merged.declaration_type, merged.period_start, merged.period_end, merged.destination_country,
          merged.legal_basis, merged.data_categories, merged.subject_count_band, merged.volume_band,
          merged.volume_estimate_gb ?? null, merged.processors, merged.declares_no_transfers,
          adequacyDecisionId, complianceStatus,
        ]
      );
      await logAudit("transfer_declaration_amended", "transfer_declarations", input.id, String(ctx.user.id), {
        changed_fields: changedFields, revalidated: revalidate, findings_raised: newFindings.length,
      });
      fireAndForget("crossBorderDeclarations.amend");
      return row;
    }),

  amendmentHistory: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return exec(
        `SELECT id, declaration_id, prior_state, changed_fields, reason, amended_by, created_at
         FROM declaration_amendments WHERE declaration_id = $1 ORDER BY created_at ASC`,
        [input.id]
      );
    }),

  withdraw: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), reason: z.string().min(10) }))
    .mutation(async ({ input, ctx }) => {
      const [existing] = await exec(`SELECT id, status FROM transfer_declarations WHERE id = $1`, [input.id]);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      // Withdrawal is itself an amendment: snapshot prior state first.
      await exec(
        `INSERT INTO declaration_amendments (declaration_id, prior_state, changed_fields, reason, amended_by)
         VALUES ($1, (SELECT to_jsonb(t) FROM transfer_declarations t WHERE t.id = $1), '["status"]', $2, $3)`,
        [input.id, input.reason, ctx.user.name ?? String(ctx.user.id)]
      );
      const [row] = await exec(
        `UPDATE transfer_declarations SET status = 'withdrawn', updated_at = NOW()
         WHERE id = $1 AND status <> 'withdrawn' RETURNING *`,
        [input.id]
      );
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "Declaration already withdrawn" });
      await logAudit("transfer_declaration_withdrawn", "transfer_declarations", input.id, String(ctx.user.id), { reason: input.reason });
      fireAndForget("crossBorderDeclarations.withdraw");
      return row;
    }),

  // ─── Reads ────────────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      organizationId: z.number().int().optional(),
      status: z.string().optional(),
      complianceStatus: z.enum(["compliant", "non_compliant", "pending_review"]).optional(),
      country: z.string().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.organizationId) { params.push(input.organizationId); conds.push(`organization_id = $${params.length}`); }
      if (input.status) { params.push(input.status); conds.push(`status = $${params.length}`); }
      if (input.complianceStatus) { params.push(input.complianceStatus); conds.push(`compliance_status = $${params.length}`); }
      if (input.country) { params.push(`%${input.country}%`); conds.push(`destination_country ILIKE $${params.length}`); }
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      params.push(input.limit, offset);
      const rows = await exec(
        `SELECT * FROM transfer_declarations ${where}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const cnt = await exec(`SELECT COUNT(*) as total FROM transfer_declarations ${where}`, params.slice(0, -2));
      return { data: rows, total: parseInt(cnt[0]?.total ?? "0", 10) };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [row] = await exec(`SELECT * FROM transfer_declarations WHERE id = $1`, [input.id]);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      const findings = await exec(
        `SELECT * FROM transfer_findings WHERE declaration_id = $1 ORDER BY created_at DESC`,
        [input.id]
      );
      return { ...row, findings };
    }),

  // ─── Destination risk register (admin-editable reference data) ────────────
  listDestinationRisk: protectedProcedure
    .input(z.object({ adequacyStatus: z.enum(["adequate", "partial", "none", "under_review"]).optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.adequacyStatus) { params.push(input.adequacyStatus); where = `WHERE adequacy_status = $1`; }
      return exec(`SELECT * FROM destination_risk_register ${where} ORDER BY risk_score DESC, country ASC`, params);
    }),

  upsertDestinationRisk: adminProcedure
    .input(z.object({
      country: z.string().min(2).max(128),
      iso_code: z.string().min(2).max(3).optional(),
      adequacy_status: z.enum(["adequate", "partial", "none", "under_review"]),
      risk_score: z.number().min(0).max(100),
      notes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `INSERT INTO destination_risk_register (country, iso_code, adequacy_status, risk_score, notes, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (country) DO UPDATE SET
           iso_code = COALESCE(EXCLUDED.iso_code, destination_risk_register.iso_code),
           adequacy_status = EXCLUDED.adequacy_status,
           risk_score = EXCLUDED.risk_score,
           notes = COALESCE(EXCLUDED.notes, destination_risk_register.notes),
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
         RETURNING *`,
        [input.country, input.iso_code ?? null, input.adequacy_status, input.risk_score, input.notes ?? null, ctx.user.name ?? String(ctx.user.id)]
      );
      await logAudit("destination_risk_upserted", "destination_risk_register", row?.id, String(ctx.user.id), {
        country: input.country, adequacy_status: input.adequacy_status, risk_score: input.risk_score,
      });
      fireAndForget("crossBorderDeclarations.upsertDestinationRisk");
      return row;
    }),

  // ─── Findings ─────────────────────────────────────────────────────────────
  listFindings: protectedProcedure
    .input(z.object({
      organizationId: z.number().int().optional(),
      findingType: z.string().optional(),
      status: z.string().optional(),
      enforcementReferralOnly: z.boolean().default(false),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [];
      const conds: string[] = [];
      if (input.organizationId) { params.push(input.organizationId); conds.push(`organization_id = $${params.length}`); }
      if (input.findingType) { params.push(input.findingType); conds.push(`finding_type = $${params.length}`); }
      if (input.status) { params.push(input.status); conds.push(`status = $${params.length}`); }
      if (input.enforcementReferralOnly) conds.push(`enforcement_referral = TRUE`);
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      params.push(input.limit, offset);
      const rows = await exec(
        `SELECT * FROM transfer_findings ${where}
         ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const cnt = await exec(`SELECT COUNT(*) as total FROM transfer_findings ${where}`, params.slice(0, -2));
      return { data: rows, total: parseInt(cnt[0]?.total ?? "0", 10) };
    }),

  updateFindingStatus: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["open", "referred", "under_investigation", "resolved", "dismissed"]),
      resolution_notes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE transfer_findings SET
           status = $2,
           resolved_by = CASE WHEN $2 IN ('resolved','dismissed') THEN $3 ELSE resolved_by END,
           resolved_at = CASE WHEN $2 IN ('resolved','dismissed') THEN NOW() ELSE resolved_at END,
           resolution_notes = COALESCE($4, resolution_notes)
         WHERE id = $1 RETURNING *`,
        [input.id, input.status, ctx.user.name ?? String(ctx.user.id), input.resolution_notes ?? null]
      );
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Finding not found" });
      await logAudit("transfer_finding_status_updated", "transfer_findings", input.id, String(ctx.user.id), { status: input.status });
      fireAndForget("crossBorderDeclarations.updateFindingStatus");
      return row;
    }),

  // ─── Anomaly detection + cascade re-validation (admin / scheduler) ────────
  runAnomalyScans: adminProcedure
    .input(z.object({
      zScoreThreshold: z.number().min(1).max(6).default(2.5),
      minPoints: z.number().int().min(3).max(20).default(4),
    }).optional())
    .mutation(async ({ input, ctx }) => {
      const contradiction = await runContradictionScan(exec);
      const volume = await runVolumeAnomalyScan(exec, {
        threshold: input?.zScoreThreshold ?? 2.5,
        minPoints: input?.minPoints ?? 4,
      });
      await logAudit("transfer_anomaly_scans_run", "transfer_findings", null, String(ctx.user.id), {
        contradiction_findings: contradiction.findingsCreated,
        volume_findings: volume.findingsCreated,
        scan_findings_available: contradiction.scanFindingsAvailable,
      });
      fireAndForget("crossBorderDeclarations.runAnomalyScans");
      return { contradiction, volume };
    }),

  /** Scheduled re-validation: adequacy suspended/revoked -> cascade findings. */
  revalidateAdequacyCascade: adminProcedure
    .input(z.object({ adequacyDecisionId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const report = await revalidateDeclarationsForAdequacy(exec, input.adequacyDecisionId);
      await logAudit("adequacy_cascade_revalidated", "adequacy_decisions", input.adequacyDecisionId, String(ctx.user.id), {
        adequacy_status: report.adequacyStatus,
        declarations_revalidated: report.declarationsRevalidated,
        cascade_findings: report.cascadeFindingsCreated,
      });
      fireAndForget("crossBorderDeclarations.revalidateAdequacyCascade");
      return report;
    }),

  stats: protectedProcedure.query(async () => {
    const rows = await exec(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('submitted','under_review','accepted')) AS active_declarations,
        COUNT(*) FILTER (WHERE compliance_status = 'non_compliant') AS non_compliant,
        COUNT(*) FILTER (WHERE compliance_status = 'pending_review') AS pending_review,
        COUNT(*) FILTER (WHERE declares_no_transfers) AS zero_transfer_attestations,
        (SELECT COUNT(*) FROM transfer_findings WHERE status IN ('open','referred','under_investigation')) AS open_findings,
        (SELECT COUNT(*) FROM transfer_findings WHERE enforcement_referral AND status IN ('open','referred')) AS pending_referrals
      FROM transfer_declarations
    `);
    return rows[0] ?? {};
  }),
});
