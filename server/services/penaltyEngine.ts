/**
 * Penalty Engine — NDPA 2023 s.48 administrative-fine computation.
 *
 * Statutory basis (NDPA 2023):
 *   s.48(7): where the Commission is satisfied that a data controller or data
 *     processor of MAJOR importance (DCPMI) has violated the Act, the remedial
 *     fee is the GREATER of ₦10,000,000 or 2% of its annual gross revenue in
 *     the preceding financial year.
 *   s.48(8): for any OTHER data controller/processor: the GREATER of
 *     ₦2,000,000 or 2% of annual gross revenue in the preceding financial
 *     year.
 *   s.48(6): in determining the amount the Commission has regard to the
 *     aggravating/mitigating factors (nature/gravity/duration, categories of
 *     personal data, number of data subjects, intentional/negligent character,
 *     prior infringements, degree of cooperation, remediation).
 *
 * Model: the s.48(7)/(8) greater-of figure is the STATUTORY CAP. The s.48(6)
 * factors produce a severity score in [0,1] which maps to a multiplier in
 * [MIN_MULTIPLIER, 1]; the final amount = cap × multiplier, so the computed
 * penalty can never exceed the statutory cap. Every input and intermediate
 * value is returned in `breakdown` and persisted to penalty_computations for
 * appeal defence.
 *
 * The pure functions (computeSection48Penalty, selectBestRevenue, …) are
 * DB-free so they are unit-testable. recomputePenalty() takes an injected
 * `exec` so the router owns the connection/audit conventions.
 */

// ─── Statutory constants ─────────────────────────────────────────────────────
export const DCPMI_FLOOR_NGN = 10_000_000;
export const NON_MAJOR_FLOOR_NGN = 2_000_000;
export const REVENUE_RATE = 0.02;

/** Minimum fraction of the statutory cap a s.48 penalty may fall to. */
export const MIN_MULTIPLIER = 0.1;

// ─── Revenue provenance ──────────────────────────────────────────────────────
export type RevenueSource = "firs" | "cac" | "manual_filing";

export interface VerifiedRevenueRecord {
  id: number | string;
  orgId: number;
  source: RevenueSource;
  amount: number;
  currency: string;
  fiscalYear: number;
  status: "unverified" | "pending" | "verified" | "disputed" | "superseded";
  verifiedAt?: string | Date | null;
}

/**
 * Source authority ranking: FIRS (tax authority filed revenue) outranks CAC
 * (corporate registry filing) which outranks an internally-prepared manual
 * filing, even when dual-attested.
 */
export const SOURCE_RANK: Record<RevenueSource, number> = {
  firs: 3,
  cac: 2,
  manual_filing: 1,
};

/**
 * Pick the best-available verified revenue record for penalty computation:
 * only `verified` rows qualify; order by source authority, then most recent
 * fiscal year, then most recently verified. Returns null when nothing is
 * verified — callers must then fall back to the statutory floor and record
 * revenue_source 'none' (never guess a revenue figure).
 */
export function selectBestRevenue(
  records: VerifiedRevenueRecord[],
): VerifiedRevenueRecord | null {
  const eligible = records.filter((r) => r.status === "verified" && r.amount >= 0);
  if (eligible.length === 0) return null;
  return eligible.sort((a, b) => {
    const bySource = SOURCE_RANK[b.source] - SOURCE_RANK[a.source];
    if (bySource !== 0) return bySource;
    if (b.fiscalYear !== a.fiscalYear) return b.fiscalYear - a.fiscalYear;
    const ta = a.verifiedAt ? new Date(a.verifiedAt).getTime() : 0;
    const tb = b.verifiedAt ? new Date(b.verifiedAt).getTime() : 0;
    return tb - ta;
  })[0];
}

// ─── s.48(6) aggravating / mitigating factors ────────────────────────────────
export interface Section48Factors {
  /** Nature, gravity and duration of the infringement, 0 (trivial) .. 1 (grave). */
  natureGravityDuration: number;
  /** Sensitivity of categories of personal data affected, 0 .. 1 (1 = sensitive/special categories). */
  categoriesOfData: number;
  /** Number of data subjects affected, raw count (normalised internally). */
  dataSubjectCount: number;
  /** Intentional or negligent character of the infringement. */
  intent: "intentional" | "negligent" | "unintentional";
  /** Number of relevant prior infringements by the controller. */
  priorInfringements: number;
  /** Degree of cooperation with the Commission, 0 (obstructive) .. 1 (full). Mitigating. */
  cooperationDegree: number;
  /** Remediation undertaken by the controller. Mitigating. */
  remediation: "none" | "partial" | "full";
}

export interface FactorContribution {
  factor: string;
  value: number | string;
  weight: number;
  points: number; // signed: aggravating positive, mitigating negative
  detail: string;
}

/**
 * Weights over the s.48(6) factor space; the aggravating sub-weights sum to 1
 * so severity stays in [0,1]. Mitigating factors subtract from the score.
 */
export const FACTOR_WEIGHTS = {
  natureGravityDuration: 0.30,
  categoriesOfData: 0.20,
  dataSubjectCount: 0.15,
  intent: 0.20,
  priorInfringements: 0.15,
} as const;

/** Cooperation can offset up to 20% of severity; remediation up to 15%. */
export const MITIGATION_MAX = { cooperation: 0.2, remediation: 0.15 } as const;

const INTENT_SCORE: Record<Section48Factors["intent"], number> = {
  intentional: 1,
  negligent: 0.6,
  unintentional: 0.2,
};

const REMEDIATION_CREDIT: Record<Section48Factors["remediation"], number> = {
  none: 0,
  partial: 0.5,
  full: 1,
};

/** 10,000,000+ affected data subjects saturates the count factor. */
export const DATA_SUBJECT_SATURATION = 10_000_000;

const PRIOR_INFRINGEMENT_SATURATION = 3;

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Score the s.48(6) factors into a severity in [0,1] plus the per-factor
 * contribution trail used in the persisted breakdown.
 */
export function scoreFactors(factors: Section48Factors): {
  severity: number;
  contributions: FactorContribution[];
} {
  const ngd = clamp01(factors.natureGravityDuration);
  const cat = clamp01(factors.categoriesOfData);
  const subjects = clamp01(factors.dataSubjectCount / DATA_SUBJECT_SATURATION);
  const intent = INTENT_SCORE[factors.intent] ?? INTENT_SCORE.unintentional;
  const priors = clamp01(factors.priorInfringements / PRIOR_INFRINGEMENT_SATURATION);
  const cooperation = clamp01(factors.cooperationDegree);
  const remediation = REMEDIATION_CREDIT[factors.remediation] ?? 0;

  const contributions: FactorContribution[] = [
    {
      factor: "nature_gravity_duration",
      value: ngd,
      weight: FACTOR_WEIGHTS.natureGravityDuration,
      points: FACTOR_WEIGHTS.natureGravityDuration * ngd,
      detail: "Nature, gravity and duration of the infringement (s.48(6)(a))",
    },
    {
      factor: "categories_of_data",
      value: cat,
      weight: FACTOR_WEIGHTS.categoriesOfData,
      points: FACTOR_WEIGHTS.categoriesOfData * cat,
      detail: "Categories of personal data affected (s.48(6))",
    },
    {
      factor: "data_subject_count",
      value: factors.dataSubjectCount,
      weight: FACTOR_WEIGHTS.dataSubjectCount,
      points: FACTOR_WEIGHTS.dataSubjectCount * subjects,
      detail: `${factors.dataSubjectCount.toLocaleString()} data subjects affected (saturates at ${DATA_SUBJECT_SATURATION.toLocaleString()})`,
    },
    {
      factor: "intent",
      value: factors.intent,
      weight: FACTOR_WEIGHTS.intent,
      points: FACTOR_WEIGHTS.intent * intent,
      detail: `Intentional/negligent character: ${factors.intent}`,
    },
    {
      factor: "prior_infringements",
      value: factors.priorInfringements,
      weight: FACTOR_WEIGHTS.priorInfringements,
      points: FACTOR_WEIGHTS.priorInfringements * priors,
      detail: `${factors.priorInfringements} relevant prior infringement(s) (saturates at ${PRIOR_INFRINGEMENT_SATURATION})`,
    },
    {
      factor: "cooperation_degree",
      value: cooperation,
      weight: MITIGATION_MAX.cooperation,
      points: -MITIGATION_MAX.cooperation * cooperation,
      detail: "Degree of cooperation with the Commission (mitigating)",
    },
    {
      factor: "remediation",
      value: factors.remediation,
      weight: MITIGATION_MAX.remediation,
      points: -MITIGATION_MAX.remediation * remediation,
      detail: `Remediation undertaken: ${factors.remediation} (mitigating)`,
    },
  ];

  const raw = contributions.reduce((sum, c) => sum + c.points, 0);
  return { severity: clamp01(raw), contributions };
}

// ─── s.48 computation ────────────────────────────────────────────────────────
export interface PenaltyComputationInput {
  isDcpmi: boolean;
  /** Best-available verified annual gross revenue (preceding FY), NGN. Null = unverified. */
  verifiedRevenue: number | null;
  revenueSource: RevenueSource | "none";
  revenueFiscalYear?: number | null;
  verifiedRevenueId?: number | string | null;
  factors: Section48Factors;
}

export interface PenaltyBreakdown {
  legalBasis: string;
  isDcpmi: boolean;
  statutoryFloor: number;
  revenueRate: number;
  verifiedRevenue: number | null;
  revenueSource: RevenueSource | "none";
  revenueFiscalYear: number | null;
  verifiedRevenueId: number | string | null;
  revenueComponent: number;
  statutoryCap: number;
  capDriver: "floor" | "revenue";
  severityScore: number;
  multiplier: number;
  finalAmount: number;
  currency: "NGN";
  factorContributions: FactorContribution[];
  warnings: string[];
}

/** Round to kobo (2dp) deterministically. */
function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Compute a s.48 administrative fine.
 *
 *   statutoryCap = max(floor, 2% × verifiedRevenue)     [s.48(7)/(8)]
 *   multiplier   = MIN_MULTIPLIER + (1 - MIN_MULTIPLIER) × severity
 *   finalAmount  = min(cap, round2(cap × multiplier))   [never exceeds cap]
 *
 * When no verified revenue exists, the revenue component is 0 (cap = floor)
 * and a warning is recorded — the computation NEVER invents a revenue figure.
 */
export function computeSection48Penalty(input: PenaltyComputationInput): PenaltyBreakdown {
  const floor = input.isDcpmi ? DCPMI_FLOOR_NGN : NON_MAJOR_FLOOR_NGN;
  const warnings: string[] = [];

  let revenue: number | null = null;
  if (input.verifiedRevenue != null && Number.isFinite(input.verifiedRevenue) && input.verifiedRevenue >= 0) {
    revenue = input.verifiedRevenue;
  } else {
    warnings.push(
      "No verified revenue record available; statutory floor applied. " +
        "Verify revenue via FIRS/CAC or dual-attested manual filing before relying on this figure.",
    );
  }

  const revenueComponent = revenue != null ? round2(revenue * REVENUE_RATE) : 0;
  const statutoryCap = Math.max(floor, revenueComponent);
  const capDriver = revenueComponent > floor ? "revenue" : "floor";

  const { severity, contributions } = scoreFactors(input.factors);
  const multiplier = round2((MIN_MULTIPLIER + (1 - MIN_MULTIPLIER) * severity) * 100) / 100;
  let finalAmount = round2(statutoryCap * multiplier);
  if (finalAmount > statutoryCap) finalAmount = statutoryCap; // hard cap guard

  return {
    legalBasis: input.isDcpmi ? "NDPA 2023 s.48(7) (DCPMI)" : "NDPA 2023 s.48(8) (non-major)",
    isDcpmi: input.isDcpmi,
    statutoryFloor: floor,
    revenueRate: REVENUE_RATE,
    verifiedRevenue: revenue,
    revenueSource: revenue != null ? input.revenueSource : "none",
    revenueFiscalYear: revenue != null ? input.revenueFiscalYear ?? null : null,
    verifiedRevenueId: revenue != null ? input.verifiedRevenueId ?? null : null,
    revenueComponent,
    statutoryCap,
    capDriver,
    severityScore: severity,
    multiplier,
    finalAmount,
    currency: "NGN",
    factorContributions: contributions,
    warnings,
  };
}

// ─── recomputePenalty: DB wiring against enforcement_fines (migration 0075) ──
export type SqlExec = (query: string, params?: unknown[]) => Promise<any[]>;

export interface RecomputeResult {
  fineId: number;
  fineReference: string | null;
  priorAmount: number;
  newAmount: number;
  changed: boolean;
  computationId: number | null;
  breakdown: PenaltyBreakdown;
}

/**
 * Recompute the s.48 penalty for an existing enforcement fine and update
 * enforcement_fines.amount, recording prior vs new amount in
 * penalty_computations (append-only ledger; the previous computation row is
 * never mutated, preserving the appeal record).
 *
 * @param exec       router-provided SQL executor (owns error/audit handling)
 * @param fineRef    enforcement_fines.id or fine_reference
 * @param factors    s.48(6) factor inputs for this recomputation
 * @param actor      officer performing the recomputation (audit trail)
 */
export async function recomputePenalty(
  exec: SqlExec,
  fineRef: number | string,
  factors: Section48Factors,
  actor: string,
): Promise<RecomputeResult> {
  const isNumericId = typeof fineRef === "number" || /^\d+$/.test(String(fineRef));
  const fineRows = await exec(
    `SELECT id, org_id, amount, currency, status, fine_reference
       FROM enforcement_fines
      WHERE ${isNumericId ? "id = $1" : "fine_reference = $1"}`,
    [isNumericId ? Number(fineRef) : String(fineRef)],
  );
  const fine = fineRows[0];
  if (!fine) {
    throw new Error(`Enforcement fine not found: ${fineRef}`);
  }
  if (["paid", "waived", "cancelled"].includes(String(fine.status))) {
    throw new Error(`Fine ${fineRef} is ${fine.status}; recomputation not permitted`);
  }

  // Best-available verified revenue for the controller (migration 0087).
  const revenueRows = await exec(
    `SELECT id, org_id, source, amount::float8 AS amount, currency, fiscal_year, status, verified_at
       FROM verified_revenues
      WHERE org_id = $1 AND status = 'verified'
      ORDER BY created_at DESC`,
    [fine.org_id],
  );
  const best = selectBestRevenue(
    revenueRows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      source: r.source,
      amount: Number(r.amount),
      currency: r.currency,
      fiscalYear: r.fiscal_year,
      status: r.status,
      verifiedAt: r.verified_at,
    })),
  );

  // DCPMI classification: latest prior computation for the org wins; default
  // non-major (conservative — DCPMI status raises the floor).
  const priorRows = await exec(
    `SELECT is_dcpmi FROM penalty_computations WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [fine.org_id],
  );
  const isDcpmi = priorRows[0]?.is_dcpmi === true;

  const breakdown = computeSection48Penalty({
    isDcpmi,
    verifiedRevenue: best ? best.amount : null,
    revenueSource: best ? best.source : "none",
    revenueFiscalYear: best ? best.fiscalYear : null,
    verifiedRevenueId: best ? best.id : null,
    factors,
  });

  const inserted = await exec(
    `INSERT INTO penalty_computations
       (fine_id, org_id, is_dcpmi, verified_revenue_id, revenue_amount, revenue_currency,
        revenue_fiscal_year, revenue_source, statutory_floor, revenue_component, statutory_cap,
        factors, factor_contributions, severity_score, multiplier, final_amount, currency,
        prior_amount, breakdown, computed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'NGN',$17,$18,$19)
     RETURNING id`,
    [
      fine.id,
      fine.org_id,
      isDcpmi,
      breakdown.verifiedRevenueId != null ? Number(breakdown.verifiedRevenueId) : null,
      breakdown.verifiedRevenue,
      best?.currency ?? null,
      breakdown.revenueFiscalYear,
      breakdown.revenueSource,
      breakdown.statutoryFloor,
      breakdown.revenueComponent,
      breakdown.statutoryCap,
      JSON.stringify(factors),
      JSON.stringify(breakdown.factorContributions),
      breakdown.severityScore,
      breakdown.multiplier,
      breakdown.finalAmount,
      Number(fine.amount),
      JSON.stringify(breakdown),
      actor,
    ],
  );

  await exec(
    `UPDATE enforcement_fines SET amount = $1, updated_at = NOW() WHERE id = $2`,
    [breakdown.finalAmount, fine.id],
  );

  return {
    fineId: fine.id,
    fineReference: fine.fine_reference ?? null,
    priorAmount: Number(fine.amount),
    newAmount: breakdown.finalAmount,
    changed: Number(fine.amount) !== breakdown.finalAmount,
    computationId: inserted[0]?.id != null ? Number(inserted[0].id) : null,
    breakdown,
  };
}
