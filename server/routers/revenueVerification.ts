/**
 * Revenue Verification Router — FIRS / CAC integration + NDPA s.48 wiring
 *
 * Revenue provenance for penalty computation (NDPA 2023 s.48: 2% of annual
 * gross revenue of the preceding financial year):
 *
 *   FIRS  TIN verification + filed-revenue lookup      (source 'firs')
 *   CAC   RC-number corporate record lookup            (source 'cac')
 *   Manual dual-attested filing (CFO + external auditor) (source 'manual_filing')
 *
 * ── NO SYNTHETIC VERIFICATION ────────────────────────────────────────────────
 * The FIRS/CAC adapters FAIL CLOSED. When FIRS_API_BASE/FIRS_API_KEY or
 * CAC_API_BASE/CAC_API_KEY are absent the adapters return
 * { status: "unconfigured" } and NOTHING is persisted as verified revenue.
 * No code path returns a fabricated verification as a real one.
 *
 * ── PROD INTEGRATION NOTES ───────────────────────────────────────────────────
 * Point the Http*Clients at the contracted endpoints:
 *   FIRS e-services:  GET {FIRS_API_BASE}/tin/{tin}            -> TIN record
 *                     GET {FIRS_API_BASE}/tin/{tin}/returns?year=YYYY -> filed revenue
 *   CAC public search: GET {CAC_API_BASE}/companies/{rcNumber} -> corporate record
 * Auth: Authorization: Bearer {API_KEY}. Align the response mappers
 * (mapFirsTin / mapFirsRevenue / mapCacRecord) with the signed API contracts
 * before go-live; the adapter interface below is the stable seam.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Verification status machine:
 *   unverified -> pending -> verified -> disputed -> superseded (terminal)
 *   disputed may return to verified (re-affirmed) or be superseded.
 */
import { createHash } from "crypto";
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import {
  computeSection48Penalty,
  recomputePenalty,
  selectBestRevenue,
  type VerifiedRevenueRecord,
} from "../services/penaltyEngine";

// ─── Shared helpers (crossBorderAdequacy conventions) ────────────────────────
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
    logger.error({ err, query: query.slice(0, 200) }, "[revenueVerification] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

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
    logger.warn({ err, action, resourceType }, "[revenueVerification] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

// ─── External adapter interfaces (stable seam for the real APIs) ─────────────
export type AdapterOutcome = "success" | "unconfigured" | "unavailable" | "error";

export interface FirsTinResult {
  status: AdapterOutcome;
  tin: string;
  registeredName?: string;
  active?: boolean;
  evidenceHash?: string;
  message?: string;
}

export interface FirsRevenueResult {
  status: AdapterOutcome;
  tin: string;
  fiscalYear: number;
  amount?: number;
  currency?: string;
  evidenceHash?: string;
  message?: string;
}

export interface CacRecordResult {
  status: AdapterOutcome;
  rcNumber: string;
  companyName?: string;
  companyType?: string;
  registrationDate?: string;
  companyStatus?: string;
  evidenceHash?: string;
  message?: string;
}

export interface FirsClient {
  verifyTin(tin: string): Promise<FirsTinResult>;
  lookupFiledRevenue(tin: string, fiscalYear: number): Promise<FirsRevenueResult>;
}

export interface CacClient {
  lookupRcNumber(rcNumber: string): Promise<CacRecordResult>;
}

/** Fail-closed adapter used whenever credentials/endpoints are absent. */
class UnconfiguredFirsClient implements FirsClient {
  async verifyTin(tin: string): Promise<FirsTinResult> {
    return { status: "unconfigured", tin, message: "FIRS_API_BASE/FIRS_API_KEY not configured; no verification performed" };
  }
  async lookupFiledRevenue(tin: string, fiscalYear: number): Promise<FirsRevenueResult> {
    return { status: "unconfigured", tin, fiscalYear, message: "FIRS_API_BASE/FIRS_API_KEY not configured; no revenue lookup performed" };
  }
}

class UnconfiguredCacClient implements CacClient {
  async lookupRcNumber(rcNumber: string): Promise<CacRecordResult> {
    return { status: "unconfigured", rcNumber, message: "CAC_API_BASE/CAC_API_KEY not configured; no lookup performed" };
  }
}

async function httpGetJson(base: string, path: string, apiKey: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Real FIRS client. Response mappers are the single place to align with the
 * contracted FIRS schema; on any transport/parse failure the adapter reports
 * "unavailable"/"error" — it never fabricates a successful verification.
 */
class HttpFirsClient implements FirsClient {
  constructor(private readonly base: string, private readonly apiKey: string) {}
  async verifyTin(tin: string): Promise<FirsTinResult> {
    try {
      const body = await httpGetJson(this.base, `/tin/${encodeURIComponent(tin)}`, this.apiKey);
      const name = body?.registeredName ?? body?.taxpayer_name ?? body?.name;
      if (!name) return { status: "error", tin, message: "FIRS response did not contain a registered name" };
      return {
        status: "success",
        tin,
        registeredName: String(name),
        active: Boolean(body?.active ?? body?.status === "ACTIVE"),
        evidenceHash: sha256(JSON.stringify(body)),
      };
    } catch (err) {
      logger.warn({ err, tin }, "[firs] verifyTin failed");
      return { status: "unavailable", tin, message: `FIRS lookup failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  async lookupFiledRevenue(tin: string, fiscalYear: number): Promise<FirsRevenueResult> {
    try {
      const body = await httpGetJson(
        this.base,
        `/tin/${encodeURIComponent(tin)}/returns?year=${fiscalYear}`,
        this.apiKey,
      );
      const amount = Number(body?.grossRevenue ?? body?.gross_revenue ?? body?.turnover);
      if (!Number.isFinite(amount) || amount < 0) {
        return { status: "error", tin, fiscalYear, message: "FIRS response did not contain a usable revenue figure" };
      }
      return {
        status: "success",
        tin,
        fiscalYear,
        amount,
        currency: String(body?.currency ?? "NGN"),
        evidenceHash: sha256(JSON.stringify(body)),
      };
    } catch (err) {
      logger.warn({ err, tin, fiscalYear }, "[firs] lookupFiledRevenue failed");
      return { status: "unavailable", tin, fiscalYear, message: `FIRS revenue lookup failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

class HttpCacClient implements CacClient {
  constructor(private readonly base: string, private readonly apiKey: string) {}
  async lookupRcNumber(rcNumber: string): Promise<CacRecordResult> {
    try {
      const body = await httpGetJson(this.base, `/companies/${encodeURIComponent(rcNumber)}`, this.apiKey);
      const name = body?.companyName ?? body?.company_name ?? body?.name;
      if (!name) return { status: "error", rcNumber, message: "CAC response did not contain a company name" };
      return {
        status: "success",
        rcNumber,
        companyName: String(name),
        companyType: body?.companyType ?? body?.company_type ?? undefined,
        registrationDate: body?.registrationDate ?? body?.registration_date ?? undefined,
        companyStatus: body?.status ?? undefined,
        evidenceHash: sha256(JSON.stringify(body)),
      };
    } catch (err) {
      logger.warn({ err, rcNumber }, "[cac] lookupRcNumber failed");
      return { status: "unavailable", rcNumber, message: `CAC lookup failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

export function getFirsClient(): FirsClient {
  const base = process.env.FIRS_API_BASE;
  const key = process.env.FIRS_API_KEY;
  if (base && key) return new HttpFirsClient(base, key);
  return new UnconfiguredFirsClient();
}

export function getCacClient(): CacClient {
  const base = process.env.CAC_API_BASE;
  const key = process.env.CAC_API_KEY;
  if (base && key) return new HttpCacClient(base, key);
  return new UnconfiguredCacClient();
}

/** Fingerprint the configured credential (never log/store the secret). */
function credentialFingerprint(key: string | undefined): string | null {
  return key ? sha256(key).slice(0, 12) : null;
}

async function auditIntegration(
  service: "firs" | "cac",
  operation: string,
  outcome: AdapterOutcome,
  actor: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const env = service === "firs"
    ? { base: process.env.FIRS_API_BASE, key: process.env.FIRS_API_KEY }
    : { base: process.env.CAC_API_BASE, key: process.env.CAC_API_KEY };
  try {
    await exec(
      `INSERT INTO integration_credentials_audit
         (service, operation, endpoint, credential_fingerprint, outcome, detail, actor, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [service, operation, env.base ?? null, credentialFingerprint(env.key), outcome, JSON.stringify(detail), actor],
    );
  } catch (err) {
    logger.warn({ err, service, operation }, "[revenueVerification] integration audit write failed");
  }
}

// ─── Status machine ──────────────────────────────────────────────────────────
export const REVENUE_STATUSES = ["unverified", "pending", "verified", "disputed", "superseded"] as const;
export type RevenueStatus = (typeof REVENUE_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<RevenueStatus, RevenueStatus[]> = {
  unverified: ["pending"],
  pending: ["verified", "disputed"],
  verified: ["disputed", "superseded"],
  disputed: ["verified", "superseded"],
  superseded: [],
};

function mapRevenueRow(r: any): VerifiedRevenueRecord {
  return {
    id: r.id,
    orgId: r.org_id,
    source: r.source,
    amount: Number(r.amount),
    currency: r.currency,
    fiscalYear: r.fiscal_year,
    status: r.status,
    verifiedAt: r.verified_at,
  };
}

const factorsSchema = z.object({
  natureGravityDuration: z.number().min(0).max(1),
  categoriesOfData: z.number().min(0).max(1),
  dataSubjectCount: z.number().int().min(0),
  intent: z.enum(["intentional", "negligent", "unintentional"]),
  priorInfringements: z.number().int().min(0),
  cooperationDegree: z.number().min(0).max(1),
  remediation: z.enum(["none", "partial", "full"]),
});

export const revenueVerificationRouter = router({
  // ─── Integration status (config-gated, no secrets) ────────────────────────
  integrationStatus: adminProcedure.query(async () => {
    return {
      firs: {
        configured: Boolean(process.env.FIRS_API_BASE && process.env.FIRS_API_KEY),
        endpoint: process.env.FIRS_API_BASE ?? null,
        credentialFingerprint: credentialFingerprint(process.env.FIRS_API_KEY),
      },
      cac: {
        configured: Boolean(process.env.CAC_API_BASE && process.env.CAC_API_KEY),
        endpoint: process.env.CAC_API_BASE ?? null,
        credentialFingerprint: credentialFingerprint(process.env.CAC_API_KEY),
      },
    };
  }),

  // ─── FIRS: TIN verification ────────────────────────────────────────────────
  verifyTin: protectedProcedure
    .input(z.object({ tin: z.string().min(8).max(20).regex(/^\d[\d-]*$/, "TIN must be numeric") }))
    .mutation(async ({ input, ctx }) => {
      const result = await getFirsClient().verifyTin(input.tin);
      await auditIntegration("firs", "verify_tin", result.status, String(ctx.user.id), { tin: input.tin });
      fireAndForget("revenueVerification.verifyTin");
      return result; // status "unconfigured" when the adapter is not set up — never synthetic
    }),

  // ─── FIRS: filed-revenue lookup, optionally persisted as verified revenue ──
  lookupFiledRevenue: adminProcedure
    .input(z.object({
      tin: z.string().min(8).max(20),
      fiscalYear: z.number().int().min(1990).max(2100),
      orgId: z.number().int().positive().optional(),
      persist: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await getFirsClient().lookupFiledRevenue(input.tin, input.fiscalYear);
      const actor = ctx.user.name ?? String(ctx.user.id);
      await auditIntegration("firs", "lookup_filed_revenue", result.status, String(ctx.user.id), {
        tin: input.tin, fiscal_year: input.fiscalYear,
      });

      let record: any = null;
      if (input.persist && result.status === "success" && input.orgId && result.evidenceHash) {
        [record] = await exec(
          `INSERT INTO verified_revenues
             (org_id, source, amount, currency, fiscal_year, evidence_hash, external_ref,
              status, verifier, verified_at, created_by)
           VALUES ($1,'firs',$2,$3,$4,$5,$6,'verified',$7,NOW(),$7)
           RETURNING *`,
          [input.orgId, result.amount, result.currency ?? "NGN", input.fiscalYear, result.evidenceHash, input.tin, actor],
        );
        await logAudit("revenue.firs_verified_recorded", "verified_revenues", record?.id, String(ctx.user.id), {
          org_id: input.orgId, fiscal_year: input.fiscalYear, amount: result.amount,
        });
      }
      fireAndForget("revenueVerification.lookupFiledRevenue");
      return { result, record };
    }),

  // ─── CAC: RC-number corporate record lookup ────────────────────────────────
  lookupCorporateRecord: protectedProcedure
    .input(z.object({ rcNumber: z.string().min(2).max(32).regex(/^(RC|BN)?\s?\d+$/i, "Invalid RC/BN number") }))
    .query(async ({ input, ctx }) => {
      const result = await getCacClient().lookupRcNumber(input.rcNumber);
      await auditIntegration("cac", "lookup_rc_number", result.status, String(ctx.user.id), { rc_number: input.rcNumber });
      return result; // status "unconfigured" when the adapter is not set up
    }),

  // ─── Manual filing path: dual attestation (CFO + external auditor) ─────────
  submitManualFiling: protectedProcedure
    .input(z.object({
      orgId: z.number().int().positive(),
      amount: z.number().min(0),
      currency: z.string().length(3).default("NGN"),
      fiscalYear: z.number().int().min(1990).max(2100),
      documentHash: z.string().regex(/^[a-f0-9]{64}$/i, "documentHash must be a sha256 hex digest"),
      cfoName: z.string().min(2).max(255),
      cfoTitle: z.string().min(2).max(128),
      cfoAttestedAt: z.string(),
      auditorName: z.string().min(2).max(255),
      auditorFirm: z.string().min(2).max(255),
      auditorAttestedAt: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const attestation = {
        cfo_name: input.cfoName,
        cfo_title: input.cfoTitle,
        cfo_attested_at: input.cfoAttestedAt,
        auditor_name: input.auditorName,
        auditor_firm: input.auditorFirm,
        auditor_attested_at: input.auditorAttestedAt,
      };
      const evidenceHash = sha256(JSON.stringify({ doc: input.documentHash.toLowerCase(), attestation }));
      const [row] = await exec(
        `INSERT INTO verified_revenues
           (org_id, source, amount, currency, fiscal_year, evidence_hash, external_ref,
            status, attestation, document_hash, created_by)
         VALUES ($1,'manual_filing',$2,$3,$4,$5,NULL,'pending',$6,$7,$8)
         RETURNING *`,
        [input.orgId, input.amount, input.currency, input.fiscalYear, evidenceHash,
         JSON.stringify(attestation), input.documentHash.toLowerCase(), String(ctx.user.id)],
      );
      await logAudit("revenue.manual_filing_submitted", "verified_revenues", row?.id, String(ctx.user.id), {
        org_id: input.orgId, fiscal_year: input.fiscalYear, amount: input.amount,
        dual_attestation: true,
      });
      fireAndForget("revenueVerification.submitManualFiling");
      return row;
    }),

  /** NDPC officer verifies (or disputes) a pending manual filing. */
  verifyManualFiling: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["verified", "disputed"]),
      reason: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.decision === "disputed" && !input.reason) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A reason is required to dispute a filing" });
      }
      const rows = await exec(`SELECT * FROM verified_revenues WHERE id = $1`, [input.id]);
      const current = rows[0];
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Revenue record not found" });
      if (current.source !== "manual_filing") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only manual filings use this verification path" });
      }
      if (!ALLOWED_TRANSITIONS[current.status as RevenueStatus]?.includes(input.decision)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Illegal transition ${current.status} -> ${input.decision}` });
      }
      const verifier = ctx.user.name ?? String(ctx.user.id);
      const [row] = await exec(
        `UPDATE verified_revenues
            SET status = $1,
                verifier = CASE WHEN $1 = 'verified' THEN $2 ELSE verifier END,
                verified_at = CASE WHEN $1 = 'verified' THEN NOW() ELSE verified_at END,
                dispute_reason = CASE WHEN $1 = 'disputed' THEN $3 ELSE NULL END,
                updated_at = NOW()
          WHERE id = $4
          RETURNING *`,
        [input.decision, verifier, input.reason ?? null, input.id],
      );
      await logAudit(`revenue.manual_filing_${input.decision}`, "verified_revenues", input.id, String(ctx.user.id), {
        prior_status: current.status, reason: input.reason ?? null,
      });
      fireAndForget("revenueVerification.verifyManualFiling");
      return row;
    }),

  /** Status-machine transition for adapter-sourced records (dispute/supersede). */
  transitionRevenueStatus: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      to: z.enum(REVENUE_STATUSES),
      reason: z.string().max(2000).optional(),
      supersededBy: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rows = await exec(`SELECT * FROM verified_revenues WHERE id = $1`, [input.id]);
      const current = rows[0];
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Revenue record not found" });
      if (!ALLOWED_TRANSITIONS[current.status as RevenueStatus]?.includes(input.to)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Illegal transition ${current.status} -> ${input.to}` });
      }
      if (input.to === "superseded" && !input.supersededBy) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "supersededBy is required when superseding a record" });
      }
      if (input.to === "disputed" && !input.reason) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A reason is required to dispute a record" });
      }
      const [row] = await exec(
        `UPDATE verified_revenues
            SET status = $1,
                superseded_by = CASE WHEN $1 = 'superseded' THEN $2 ELSE superseded_by END,
                dispute_reason = CASE WHEN $1 = 'disputed' THEN $3 ELSE dispute_reason END,
                updated_at = NOW()
          WHERE id = $4
          RETURNING *`,
        [input.to, input.supersededBy ?? null, input.reason ?? null, input.id],
      );
      await logAudit("revenue.status_transition", "verified_revenues", input.id, String(ctx.user.id), {
        from: current.status, to: input.to, reason: input.reason ?? null, superseded_by: input.supersededBy ?? null,
      });
      fireAndForget("revenueVerification.transitionRevenueStatus");
      return row;
    }),

  // ─── Queries ───────────────────────────────────────────────────────────────
  listVerifiedRevenues: protectedProcedure
    .input(z.object({
      orgId: z.number().int().positive(),
      status: z.enum(REVENUE_STATUSES).optional(),
    }))
    .query(async ({ input }) => {
      const params: unknown[] = [input.orgId];
      let where = `WHERE org_id = $1`;
      if (input.status) { params.push(input.status); where += ` AND status = $2`; }
      return exec(`SELECT * FROM verified_revenues ${where} ORDER BY fiscal_year DESC, created_at DESC`, params);
    }),

  getRevenueHistory: protectedProcedure
    .input(z.object({ orgId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT * FROM verified_revenues WHERE org_id = $1 ORDER BY fiscal_year DESC, created_at DESC`,
        [input.orgId],
      );
      const best = selectBestRevenue(rows.map(mapRevenueRow));
      return { records: rows, bestAvailable: best };
    }),

  listIntegrationAudit: adminProcedure
    .input(z.object({ service: z.enum(["firs", "cac"]).optional(), limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let where = "";
      if (input?.service) { params.push(input.service); where = `WHERE service = $1`; }
      params.push(input?.limit ?? 100);
      return exec(
        `SELECT * FROM integration_credentials_audit ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      );
    }),

  // ─── s.48 penalty wiring ───────────────────────────────────────────────────
  /** Dry-run s.48 computation for a controller (no persistence). */
  computePenaltyPreview: adminProcedure
    .input(z.object({
      orgId: z.number().int().positive(),
      isDcpmi: z.boolean(),
      factors: factorsSchema,
    }))
    .mutation(async ({ input }) => {
      const rows = await exec(
        `SELECT * FROM verified_revenues WHERE org_id = $1 AND status = 'verified' ORDER BY created_at DESC`,
        [input.orgId],
      );
      const best = selectBestRevenue(rows.map(mapRevenueRow));
      return computeSection48Penalty({
        isDcpmi: input.isDcpmi,
        verifiedRevenue: best ? best.amount : null,
        revenueSource: best ? best.source : "none",
        revenueFiscalYear: best ? best.fiscalYear : null,
        verifiedRevenueId: best ? best.id : null,
        factors: input.factors,
      });
    }),

  /**
   * Recompute an existing enforcement fine (enforcement_fines.id or
   * fine_reference) with fresh revenue/factors; updates the fine amount and
   * appends a penalty_computations ledger row recording prior vs new amount.
   */
  recomputeFine: adminProcedure
    .input(z.object({
      fineRef: z.union([z.number().int().positive(), z.string().min(1)]),
      factors: factorsSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      const actor = ctx.user.name ?? String(ctx.user.id);
      let result;
      try {
        result = await recomputePenalty(exec, input.fineRef, input.factors, actor);
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "Recomputation failed" });
      }
      await logAudit("penalty.recomputed", "enforcement_fines", result.fineId, String(ctx.user.id), {
        fine_reference: result.fineReference,
        prior_amount: result.priorAmount,
        new_amount: result.newAmount,
        computation_id: result.computationId,
      });
      fireAndForget("revenueVerification.recomputeFine");
      return result;
    }),

  /** Computation ledger for appeal defence. */
  listPenaltyComputations: protectedProcedure
    .input(z.object({ fineId: z.number().int().positive().optional(), orgId: z.number().int().positive().optional() }))
    .query(async ({ input }) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (input.fineId) { params.push(input.fineId); conditions.push(`fine_id = $${params.length}`); }
      if (input.orgId) { params.push(input.orgId); conditions.push(`org_id = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      return exec(`SELECT * FROM penalty_computations ${where} ORDER BY created_at DESC LIMIT 200`, params);
    }),
});
