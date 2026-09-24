/**
 * Supervision Risk Router — risk-based supervision scheduling
 *
 * Composite risk score per registered controller (0..1) from defensively
 * sourced signals:
 *   complaint_volume     complaints in trailing 12 months   (complaints)
 *   complaint_surge      surge alert flag                   (surge_alerts)
 *   scan_findings        severity-weighted open findings    (scan_findings)
 *   prior_sanctions      published sanctions register rows  (enforcement_notices)
 *   filing_delinquency   overdue CAR/registration filings   (car_filings)
 *   data_volume_class    declared data-volume class         (organizations)
 *
 * Optional source tables are probed with to_regclass and, when absent or
 * unreadable, contribute 0 — the probe result is persisted per sweep in
 * risk_score_inputs.source_tables so the score is always explainable. The
 * sanctions register (enforcement_notices, migration 0050) is authoritative.
 *
 * Score = weighted normalised sum (weights from risk_weights, renormalised),
 * with an explanation payload [{signal, contribution, detail}] mirroring the
 * ml/insider fusion explanation pattern.
 *
 * generateAnnualPlan builds a risk-ranked inspection schedule under a hard
 * capacity constraint (available inspector-days); plan items can be referred
 * to field inspection (inspection_cases, migration 0034).
 */
import { randomUUID } from "crypto";
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getPool } from "../db";
import { logger } from "../logger";
import { emitMutationEvent } from "../middlewareIntegration";
import { autoDecryptRows } from "../encryptionMiddleware";
import {
  computeCompositeScore,
  normalizeInputs,
  DEFAULT_RISK_WEIGHTS,
  NORMALIZATION_CAPS,
  RISK_FACTOR_KEYS,
  type RiskWeights,
  type RiskFactorKey,
  type RiskBand,
  type RawRiskInputs,
  type DataVolumeClass,
} from "../services/supervisionRiskScoring";

// Re-exported so existing consumers/tests can import the pure scoring API
// from either this router or server/services/supervisionRiskScoring.
export {
  computeCompositeScore,
  normalizeInputs,
  riskBand,
  DEFAULT_RISK_WEIGHTS,
  NORMALIZATION_CAPS,
  DATA_VOLUME_CLASS_SCORE,
  RISK_FACTOR_KEYS,
} from "../services/supervisionRiskScoring";
export type {
  RiskWeights,
  RiskFactorKey,
  RiskBand,
  RawRiskInputs,
  DataVolumeClass,
  RiskExplanationEntry,
  CompositeScoreResult,
} from "../services/supervisionRiskScoring";

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
    logger.error({ err, query: query.slice(0, 200) }, "[supervisionRisk] DB query error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database error" });
  }
}

/** Like exec() but returns null instead of throwing — defensive optional-source probes. */
async function tryExec(query: string, params: unknown[] = []): Promise<any[] | null> {
  const pool = getPool();
  if (!pool) return null;
  try {
    const result = await pool.query(query, params);
    return result.rows ?? [];
  } catch {
    return null;
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
    logger.warn({ err, action, resourceType }, "[supervisionRisk] Audit log write failed");
  }
}

function fireAndForget(action: string): void {
  emitMutationEvent("ndsep.regulatory.mutation", { action, ts: new Date().toISOString() })
    .catch((e: unknown) => logger.debug({ err: e instanceof Error ? e.message : String(e) }, "fire-and-forget failed"));
}

// ═══ Defensive source collection ════════════════════════════════════════════
async function tableExists(table: string): Promise<boolean> {
  const rows = await tryExec(`SELECT to_regclass($1) AS t`, [`public.${table}`]);
  return rows?.[0]?.t != null;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await tryExec(
    `SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, column],
  );
  return rows != null && rows.length > 0;
}

export interface CollectedInputs {
  raw: RawRiskInputs;
  sourceTables: Record<string, boolean>;
}

/**
 * Gather raw risk inputs for one controller. Optional tables (complaints,
 * surge_alerts, scan_findings, car_filings) are probed defensively; when a
 * source is absent the factor contributes 0 and source_tables records false.
 */
export async function collectRiskInputs(orgId: number): Promise<CollectedInputs> {
  const sourceTables: Record<string, boolean> = {};

  // complaints (optional): prefer organization_id, fall back to org_id
  let complaintVolume = 0;
  if (await tableExists("complaints")) {
    const col = (await columnExists("complaints", "organization_id")) ? "organization_id"
      : (await columnExists("complaints", "org_id")) ? "org_id" : null;
    if (col) {
      const rows = await tryExec(
        `SELECT count(*)::int AS n FROM complaints WHERE ${col} = $1 AND created_at > NOW() - INTERVAL '12 months'`,
        [orgId],
      );
      complaintVolume = rows?.[0]?.n ?? 0;
      sourceTables.complaints = rows != null;
    } else {
      sourceTables.complaints = false;
    }
  } else {
    sourceTables.complaints = false;
  }

  // surge_alerts (optional)
  let complaintSurge = false;
  if (await tableExists("surge_alerts")) {
    const col = (await columnExists("surge_alerts", "organization_id")) ? "organization_id"
      : (await columnExists("surge_alerts", "org_id")) ? "org_id" : null;
    if (col) {
      const rows = await tryExec(
        `SELECT count(*)::int AS n FROM surge_alerts WHERE ${col} = $1 AND created_at > NOW() - INTERVAL '30 days'`,
        [orgId],
      );
      complaintSurge = (rows?.[0]?.n ?? 0) > 0;
      sourceTables.surge_alerts = rows != null;
    } else {
      sourceTables.surge_alerts = false;
    }
  } else {
    sourceTables.surge_alerts = false;
  }

  // scan_findings (optional): severity-weighted open findings
  let scanFindingsWeighted = 0;
  if (await tableExists("scan_findings")) {
    const col = (await columnExists("scan_findings", "organization_id")) ? "organization_id"
      : (await columnExists("scan_findings", "org_id")) ? "org_id" : null;
    if (col) {
      const rows = await tryExec(
        `SELECT COALESCE(SUM(CASE lower(severity::text)
               WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 1 END), 0)::int AS w
           FROM scan_findings
          WHERE ${col} = $1 AND (status IS NULL OR lower(status::text) IN ('open', 'unresolved', 'new'))`,
        [orgId],
      );
      scanFindingsWeighted = rows?.[0]?.w ?? 0;
      sourceTables.scan_findings = rows != null;
    } else {
      sourceTables.scan_findings = false;
    }
  } else {
    sourceTables.scan_findings = false;
  }

  // Sanctions register (authoritative — migration 0050)
  const sanctionRows = await tryExec(
    `SELECT count(*)::int AS n FROM enforcement_notices
      WHERE organization_id = $1 AND status IN ('published', 'remediated')`,
    [orgId],
  );
  const priorSanctions = sanctionRows?.[0]?.n ?? 0;
  sourceTables.enforcement_notices = sanctionRows != null;

  // Filing delinquency (optional CAR/registration filings)
  let filingDelinquencyDays = 0;
  if (await tableExists("car_filings")) {
    const col = (await columnExists("car_filings", "organization_id")) ? "organization_id"
      : (await columnExists("car_filings", "org_id")) ? "org_id" : null;
    if (col) {
      const rows = await tryExec(
        `SELECT COALESCE(MAX(EXTRACT(DAY FROM NOW() - due_date)), 0)::int AS d
           FROM car_filings
          WHERE ${col} = $1 AND due_date < NOW() AND (status IS NULL OR status NOT IN ('filed', 'accepted'))`,
        [orgId],
      );
      filingDelinquencyDays = rows?.[0]?.d ?? 0;
      sourceTables.car_filings = rows != null;
    } else {
      sourceTables.car_filings = false;
    }
  } else {
    sourceTables.car_filings = false;
  }

  // Data-volume class (optional column on organizations; default 'medium')
  let dataVolumeClass: DataVolumeClass = "medium";
  if (await columnExists("organizations", "data_volume_class")) {
    const rows = await tryExec(`SELECT data_volume_class FROM organizations WHERE id = $1`, [orgId]);
    const v = String(rows?.[0]?.data_volume_class ?? "").toLowerCase();
    if (v === "low" || v === "medium" || v === "high" || v === "very_high") dataVolumeClass = v;
    sourceTables.organizations_data_volume_class = true;
  } else {
    sourceTables.organizations_data_volume_class = false;
  }

  return {
    raw: { complaintVolume, complaintSurge, scanFindingsWeighted, priorSanctions, filingDelinquencyDays, dataVolumeClass },
    sourceTables,
  };
}

async function loadWeights(): Promise<RiskWeights> {
  const rows = await tryExec(`SELECT key, weight::float8 AS weight FROM risk_weights`);
  const weights: RiskWeights = { ...DEFAULT_RISK_WEIGHTS };
  for (const r of rows ?? []) {
    if ((RISK_FACTOR_KEYS as readonly string[]).includes(r.key)) {
      weights[r.key as RiskFactorKey] = Math.max(0, Number(r.weight) || 0);
    }
  }
  return weights;
}

// ═══ Router ═════════════════════════════════════════════════════════════════
export const supervisionRiskRouter = router({
  // ─── Weights ───────────────────────────────────────────────────────────────
  getWeights: protectedProcedure.query(async () => {
    const rows = await exec(`SELECT * FROM risk_weights ORDER BY key`);
    return { weights: rows, defaults: DEFAULT_RISK_WEIGHTS, caps: NORMALIZATION_CAPS };
  }),

  updateWeight: adminProcedure
    .input(z.object({
      key: z.enum(RISK_FACTOR_KEYS),
      weight: z.number().min(0).max(1),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `INSERT INTO risk_weights (key, weight, description, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (key) DO UPDATE
           SET weight = EXCLUDED.weight,
               description = COALESCE(EXCLUDED.description, risk_weights.description),
               updated_by = EXCLUDED.updated_by,
               updated_at = NOW()
         RETURNING *`,
        [input.key, input.weight, input.description ?? null, String(ctx.user.id)],
      );
      await logAudit("risk_weight_updated", "risk_weights", null, String(ctx.user.id), input);
      fireAndForget("supervisionRisk.updateWeight");
      return row;
    }),

  // ─── Scoring ───────────────────────────────────────────────────────────────
  /** Score one controller on demand (collect → persist inputs + score). */
  scoreOrganization: adminProcedure
    .input(z.object({ orgId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const collected = await collectRiskInputs(input.orgId);
      const weights = await loadWeights();
      const result = computeCompositeScore(collected.raw, weights);
      const normalized = normalizeInputs(collected.raw);

      const [inputsRow] = await exec(
        `INSERT INTO risk_score_inputs (org_id, inputs, normalized, source_tables, collected_at)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
        [input.orgId, JSON.stringify(collected.raw), JSON.stringify(normalized), JSON.stringify(collected.sourceTables)],
      );
      const [scoreRow] = await exec(
        `INSERT INTO risk_scores (org_id, inputs_id, score, band, weights, explanation, computed_by, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
        [input.orgId, inputsRow?.id ?? null, result.score, result.band,
         JSON.stringify(result.weightsUsed), JSON.stringify(result.explanation), String(ctx.user.id)],
      );
      await logAudit("risk_score_computed", "risk_scores", scoreRow?.id ?? null, String(ctx.user.id), {
        org_id: input.orgId, score: result.score, band: result.band,
      });
      fireAndForget("supervisionRisk.scoreOrganization");
      return { score: scoreRow, inputs: collected, result };
    }),

  /** Sweep: score every registered controller (or a supplied subset). */
  computeRiskScores: adminProcedure
    .input(z.object({ orgIds: z.array(z.number().int().positive()).optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      const weights = await loadWeights();
      const orgs = input?.orgIds?.length
        ? await exec(`SELECT id FROM organizations WHERE id = ANY($1::int[])`, [input.orgIds])
        : await exec(`SELECT id FROM organizations ORDER BY id`);
      const results: Array<{ orgId: number; score: number; band: RiskBand }> = [];
      for (const org of orgs) {
        const collected = await collectRiskInputs(org.id);
        const result = computeCompositeScore(collected.raw, weights);
        const normalized = normalizeInputs(collected.raw);
        const [inputsRow] = await exec(
          `INSERT INTO risk_score_inputs (org_id, inputs, normalized, source_tables, collected_at)
           VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
          [org.id, JSON.stringify(collected.raw), JSON.stringify(normalized), JSON.stringify(collected.sourceTables)],
        );
        await exec(
          `INSERT INTO risk_scores (org_id, inputs_id, score, band, weights, explanation, computed_by, computed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [org.id, inputsRow?.id ?? null, result.score, result.band,
           JSON.stringify(result.weightsUsed), JSON.stringify(result.explanation), String(ctx.user.id)],
        );
        results.push({ orgId: org.id, score: result.score, band: result.band });
      }
      results.sort((a, b) => b.score - a.score);
      await logAudit("risk_scores_swept", "risk_scores", null, String(ctx.user.id), { scored: results.length });
      fireAndForget("supervisionRisk.computeRiskScores");
      return { scored: results.length, results };
    }),

  getRiskScore: protectedProcedure
    .input(z.object({ orgId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await exec(
        `SELECT * FROM risk_scores WHERE org_id = $1 ORDER BY computed_at DESC LIMIT 1`,
        [input.orgId],
      );
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No risk score computed for this controller" });
      return rows[0];
    }),

  /** Latest score per controller, ranked (risk register view). */
  listRiskScores: protectedProcedure
    .input(z.object({
      band: z.enum(["low", "medium", "high", "critical"]).optional(),
      limit: z.number().int().min(1).max(1000).default(200),
    }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      let having = "";
      if (input?.band) { params.push(input.band); having = `WHERE band = $${params.length}`; }
      params.push(input?.limit ?? 200);
      return exec(
        `SELECT * FROM (
           SELECT DISTINCT ON (org_id) * FROM risk_scores ORDER BY org_id, computed_at DESC
         ) latest ${having} ORDER BY score DESC LIMIT $${params.length}`,
        params,
      );
    }),

  // ─── Annual supervision plans ──────────────────────────────────────────────
  /**
   * Risk-ranked inspection schedule under a hard capacity constraint:
   * controllers are taken in descending latest-risk-score order until the
   * available inspector-days are exhausted. Idempotent per (year, name) —
   * re-running with the same key returns the existing plan.
   */
  generateAnnualPlan: adminProcedure
    .input(z.object({
      year: z.number().int().min(2020).max(2100),
      name: z.string().min(3).max(128).optional(),
      capacityInspectorDays: z.number().int().min(0),
      estimatedDaysPerInspection: z.number().int().min(1).max(60).default(5),
      dueStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dueEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      scope: z.string().min(3).max(1000).default("NDPA 2023 compliance inspection (risk-based supervision)"),
      minBand: z.enum(["low", "medium", "high", "critical"]).default("low"),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.dueEnd < input.dueStart) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "dueEnd must not precede dueStart" });
      }
      const actor = ctx.user.name ?? String(ctx.user.id);
      let name = input.name;
      if (!name) {
        const [seq] = await exec(`SELECT nextval('ndsep_supervision_plan_seq') AS n`);
        name = `NDPC-SUP-${input.year}-${String(seq?.n ?? 1).padStart(5, "0")}`;
      }

      // Idempotency: same (year, name) returns the existing plan unchanged.
      const existing = await exec(`SELECT * FROM supervision_plans WHERE year = $1 AND name = $2`, [input.year, name]);
      if (existing[0]) {
        const items = await exec(`SELECT * FROM supervision_plan_items WHERE plan_id = $1 ORDER BY rank`, [existing[0].id]);
        return { plan: existing[0], items, alreadyExisted: true };
      }

      const bandOrder = ["low", "medium", "high", "critical"];
      const minIdx = bandOrder.indexOf(input.minBand);
      const ranked = await exec(
        `SELECT latest.*, o.name AS org_name FROM (
           SELECT DISTINCT ON (org_id) * FROM risk_scores ORDER BY org_id, computed_at DESC
         ) latest JOIN organizations o ON o.id = latest.org_id
         ORDER BY latest.score DESC, latest.org_id ASC`,
      );

      let remaining = input.capacityInspectorDays;
      const selected: any[] = [];
      for (const row of ranked) {
        if (bandOrder.indexOf(row.band) < minIdx) continue;
        if (remaining < input.estimatedDaysPerInspection) break; // capacity constraint
        selected.push(row);
        remaining -= input.estimatedDaysPerInspection;
      }

      const [plan] = await exec(
        `INSERT INTO supervision_plans (year, name, status, capacity_inspector_days, allocated_inspector_days, generated_by)
         VALUES ($1, $2, 'draft', $3, $4, $5) RETURNING *`,
        [input.year, name, input.capacityInspectorDays, selected.length * input.estimatedDaysPerInspection, actor],
      );

      const items: any[] = [];
      for (let i = 0; i < selected.length; i++) {
        const s = selected[i];
        const [item] = await exec(
          `INSERT INTO supervision_plan_items
             (plan_id, org_id, risk_score_id, rank, scope, estimated_inspector_days, due_start, due_end, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled') RETURNING *`,
          [plan.id, s.org_id, s.id, i + 1, input.scope, input.estimatedDaysPerInspection, input.dueStart, input.dueEnd],
        );
        items.push(item);
      }

      await logAudit("supervision_plan_generated", "supervision_plans", plan?.id ?? null, String(ctx.user.id), {
        year: input.year, name, capacity: input.capacityInspectorDays,
        allocated: selected.length * input.estimatedDaysPerInspection, items: items.length,
      });
      fireAndForget("supervisionRisk.generateAnnualPlan");
      return { plan, items, alreadyExisted: false };
    }),

  getPlan: protectedProcedure
    .input(z.object({ planId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const plans = await exec(`SELECT * FROM supervision_plans WHERE id = $1`, [input.planId]);
      if (!plans[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Supervision plan not found" });
      const items = await exec(
        `SELECT i.*, o.name AS org_name FROM supervision_plan_items i
           LEFT JOIN organizations o ON o.id = i.org_id
          WHERE i.plan_id = $1 ORDER BY i.rank`,
        [input.planId],
      );
      return { plan: plans[0], items };
    }),

  listPlans: protectedProcedure
    .input(z.object({ year: z.number().int().optional() }).optional())
    .query(async ({ input }) => {
      const params: unknown[] = [];
      const where = input?.year ? (params.push(input.year), `WHERE year = $1`) : "";
      return exec(`SELECT * FROM supervision_plans ${where} ORDER BY year DESC, generated_at DESC`, params);
    }),

  approvePlan: adminProcedure
    .input(z.object({ planId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE supervision_plans SET status = 'approved', approved_by = $1, approved_at = NOW()
          WHERE id = $2 AND status = 'draft' RETURNING *`,
        [String(ctx.user.id), input.planId],
      );
      if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "Plan not found or not in draft status" });
      await logAudit("supervision_plan_approved", "supervision_plans", input.planId, String(ctx.user.id), {});
      fireAndForget("supervisionRisk.approvePlan");
      return row;
    }),

  /** Assign a team to a plan item. */
  assignPlanItem: adminProcedure
    .input(z.object({ planItemId: z.number().int().positive(), assignedTeam: z.string().min(1).max(255) }))
    .mutation(async ({ input, ctx }) => {
      const [row] = await exec(
        `UPDATE supervision_plan_items SET assigned_team = $1, updated_at = NOW()
          WHERE id = $2 AND status IN ('scheduled', 'deferred') RETURNING *`,
        [input.assignedTeam, input.planItemId],
      );
      if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "Plan item not found or not assignable" });
      await logAudit("supervision_plan_item_assigned", "supervision_plan_items", input.planItemId, String(ctx.user.id), {
        assigned_team: input.assignedTeam,
      });
      fireAndForget("supervisionRisk.assignPlanItem");
      return row;
    }),

  /**
   * Refer a plan item to field inspection: opens an inspection_cases row
   * (migration 0034, idempotent on case_uuid) and links it back on the item.
   */
  referToFieldInspection: adminProcedure
    .input(z.object({
      planItemId: z.number().int().positive(),
      title: z.string().min(3).max(256).optional(),
      scope: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!(await tableExists("inspection_cases"))) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Field-inspection module (inspection_cases) is not provisioned" });
      }
      const items = await exec(`SELECT * FROM supervision_plan_items WHERE id = $1`, [input.planItemId]);
      const item = items[0];
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Plan item not found" });
      if (item.status === "referred" && item.referral_ref) {
        return { item, inspectionCaseUuid: item.referral_ref, alreadyReferred: true };
      }
      if (!["scheduled", "deferred"].includes(item.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Plan item is ${item.status}; cannot refer` });
      }

      const caseUuid = randomUUID();
      const actor = String(ctx.user.id);
      await exec(
        `INSERT INTO inspection_cases (case_uuid, organization_id, inspector_id, title, scope, status)
         VALUES ($1, $2, $3, $4, $5, 'open')
         ON CONFLICT (case_uuid) DO NOTHING`,
        [caseUuid, item.org_id, actor,
         input.title ?? `Supervision plan inspection — org ${item.org_id} (plan item ${item.id})`,
         input.scope ?? item.scope],
      );
      const [updated] = await exec(
        `UPDATE supervision_plan_items
            SET status = 'referred', referral_ref = $1, referred_at = NOW(), referred_by = $2, updated_at = NOW()
          WHERE id = $3 RETURNING *`,
        [caseUuid, actor, item.id],
      );
      await logAudit("supervision_plan_item_referred", "supervision_plan_items", item.id, actor, {
        inspection_case_uuid: caseUuid, org_id: item.org_id,
      });
      fireAndForget("supervisionRisk.referToFieldInspection");
      return { item: updated, inspectionCaseUuid: caseUuid, alreadyReferred: false };
    }),
});
