/**
 * Settlement Recommender Service (round 12, wave 8 — roadmap P2)
 * ===============================================================
 * Scores a PROPOSED settlement term sheet with the learned fulfillment
 * model (ml/models/settlement_recommender.py — HistGradientBoosting over
 * settlement outcome labels, served from the exported JSON artifact via
 * ./hgbArtifact; pure TS, no Python runtime call) and derives advisory
 * adjustments from FULFILLED similar settlements retrieved through
 * casePrecedents (ndsep_cases collection).
 *
 * Response contract: { predictionId, fulfillmentProbability,
 * suggestedAdjustments[], precedentStats, degraded, reason }.
 *
 * Feedback loop (roadmap §4.1 keystone): every recommendation mints a
 * decision_feedback prediction (surface='settlement_terms'); the
 * SettlementWorkflow "Recommendation" card records accept / edit / reject
 * via client/src/lib/feedback.ts.
 *
 * Advisory only: this service NEVER writes to settlements/settlement_terms
 * and never blocks a proposal — the officer's term sheet stays
 * authoritative. Degradation is explicit (degraded flag + reason), never a
 * fabricated probability.
 *
 * PRIVACY: the minted suggestion payload carries only aggregate term-sheet
 * features and precedent statistics — no party identifiers.
 */
import { getPool } from "../db";
import { logger } from "../logger";
import { mintPrediction } from "../routers/decisionFeedback";
import { redactQueryText, searchCases } from "../routers/casePrecedents";
import { loadArtifact, predictProba, type HgbArtifact } from "./hgbArtifact";

export const SETTLEMENT_TERMS_SURFACE = "settlement_terms";
export const RECOMMENDER_ARTIFACT = "settlement_recommender.json";

/** Mirrors DATA_VOLUME_SCORE in ml/models/settlement_recommender.py. */
export const DATA_VOLUME_SCORE: Record<string, number> = {
  low: 0.1,
  medium: 0.4,
  high: 0.7,
  very_high: 1.0,
};

export interface TermSheetInput {
  monetaryAmount: number;
  /** Original (pre-reduction) claim amount, for reduction_ratio. */
  originalAmount?: number | null;
  instalmentSchedule?: Array<{ dueDate?: string; due_date?: string; amount?: number }>;
  nonMonetaryObligations?: string[];
  confidentialityFlag?: boolean;
  orgSector?: string;
  orgDataVolumeClass?: string;
  actorId: string | number;
  /** Free text for precedent retrieval (PII-scrubbed server-side). */
  queryText?: string;
}

export interface SuggestedAdjustment {
  parameter: string;
  current: number | string;
  suggested: number | string;
  rationale: string;
}

export interface SettlementRecommendation {
  predictionId: string;
  fulfillmentProbability: number | null;
  suggestedAdjustments: SuggestedAdjustment[];
  precedentStats: {
    fulfilledCases: number;
    medianInstalments: number | null;
    medianReductionRatio: number | null;
  };
  modelVersion: string | null;
  degraded: boolean;
  reason: string | null;
}

// ─── Feature building (mirrors settlement_recommender.py exactly) ────────────

export function buildFeatureValues(
  artifact: HgbArtifact,
  input: TermSheetInput,
): Record<string, number> {
  const schedule = input.instalmentSchedule ?? [];
  const amount = Math.max(0, Number(input.monetaryAmount) || 0);
  const original = Number(input.originalAmount);
  const reductionRatio =
    Number.isFinite(original) && original > 0
      ? Math.min(1, Math.max(0, (original - amount) / original))
      : 0;

  const dueDates = schedule
    .map((i) => new Date(i.dueDate ?? i.due_date ?? "").getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const durationDays =
    dueDates.length >= 2
      ? Math.round((dueDates[dueDates.length - 1] - dueDates[0]) / 86_400_000)
      : 0;

  const values: Record<string, number> = {
    log_monetary_amount: Math.log1p(amount),
    n_instalments: Math.min(36, Math.max(0, schedule.length)),
    n_obligations: Math.min(50, Math.max(0, (input.nonMonetaryObligations ?? []).length)),
    confidential: input.confidentialityFlag ? 1 : 0,
    reduction_ratio: reductionRatio,
    duration_days: durationDays,
    org_size_score:
      DATA_VOLUME_SCORE[(input.orgDataVolumeClass ?? "").toLowerCase()] ?? 0.4,
  };

  // One-hot sector expansion, 'unknown' for unseen levels.
  const sectorLevels = artifact.categorical_levels?.sector ?? [];
  if (sectorLevels.length) {
    const raw = (input.orgSector ?? "unknown").trim().toLowerCase();
    const level = sectorLevels.includes(raw) ? raw : "unknown";
    for (const lv of sectorLevels) values[`sector=${lv}`] = lv === level ? 1 : 0;
  }
  return values;
}

// ─── Precedent statistics ────────────────────────────────────────────────────

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface FulfilledTerms {
  instalments: number;
  reductionRatio: number | null;
}

/**
 * Statistics over FULFILLED similar settlements: retrieve precedent cards
 * via casePrecedents.searchCases (caseType='settlement', outcome='fulfilled'
 * only), then pull their final terms from settlement_terms. Degrades to
 * {fulfilledCases: 0, ...} when the worker or DB is unavailable.
 */
export async function fulfilledPrecedentStats(queryText: string): Promise<{
  stats: { fulfilledCases: number; medianInstalments: number | null; medianReductionRatio: number | null };
  terms: FulfilledTerms[];
  degraded: boolean;
}> {
  const empty = {
    stats: { fulfilledCases: 0, medianInstalments: null, medianReductionRatio: null },
    terms: [] as FulfilledTerms[],
    degraded: true,
  };
  const hits = await searchCases(redactQueryText(queryText), 15);
  if (hits === null) return empty;
  const fulfilledIds = hits
    .map((h) => (h.payload ?? {}) as Record<string, unknown>)
    .filter((p) => p.case_type === "settlement" && p.outcome === "fulfilled")
    .map((p) => Number(p.case_id))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!fulfilledIds.length) return { ...empty, degraded: false };

  const pool = getPool();
  if (!pool) return empty;
  let rows: any[];
  try {
    const result = await pool.query(
      `SELECT s.id, s.original_amount, s.reduction_amount,
              t.instalment_schedule
         FROM settlements s
         JOIN LATERAL (
           SELECT instalment_schedule FROM settlement_terms st
           WHERE st.settlement_id = s.id
           ORDER BY st.version DESC LIMIT 1
         ) t ON true
        WHERE s.id = ANY($1::int[]) AND s.status = 'fulfilled'`,
      [fulfilledIds],
    );
    rows = result.rows ?? [];
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) },
      "[settlementRecommender] fulfilled terms query failed");
    return empty;
  }

  const terms: FulfilledTerms[] = rows.map((r) => {
    let schedule: unknown[] = [];
    try {
      schedule = Array.isArray(r.instalment_schedule)
        ? r.instalment_schedule
        : JSON.parse(r.instalment_schedule ?? "[]");
    } catch {
      schedule = [];
    }
    const original = Number(r.original_amount);
    const reduction = Number(r.reduction_amount);
    return {
      instalments: schedule.length,
      reductionRatio:
        Number.isFinite(original) && original > 0 && Number.isFinite(reduction)
          ? Math.min(1, Math.max(0, reduction / original))
          : null,
    };
  });
  const stats = {
    fulfilledCases: terms.length,
    medianInstalments: median(terms.map((t) => t.instalments)),
    medianReductionRatio: median(
      terms.map((t) => t.reductionRatio).filter((v): v is number => v != null),
    ),
  };
  return { stats, terms, degraded: false };
}

/** Advisory adjustments: nudge the proposal toward fulfilled-case norms. */
export function buildAdjustments(
  input: TermSheetInput,
  stats: { medianInstalments: number | null; medianReductionRatio: number | null; fulfilledCases: number },
): SuggestedAdjustment[] {
  const adjustments: SuggestedAdjustment[] = [];
  if (stats.fulfilledCases < 3) return adjustments; // too thin to advise
  const currentInstalments = (input.instalmentSchedule ?? []).length;
  const original = Number(input.originalAmount);
  const amount = Math.max(0, Number(input.monetaryAmount) || 0);
  const currentReduction =
    Number.isFinite(original) && original > 0
      ? Math.min(1, Math.max(0, (original - amount) / original))
      : null;

  if (
    stats.medianInstalments != null &&
    currentInstalments > 0 &&
    currentInstalments < Math.floor(stats.medianInstalments)
  ) {
    adjustments.push({
      parameter: "n_instalments",
      current: currentInstalments,
      suggested: Math.round(stats.medianInstalments),
      rationale:
        `Fulfilled similar settlements carried a median of ` +
        `${Math.round(stats.medianInstalments)} instalments; a longer schedule ` +
        `historically correlates with fulfillment.`,
    });
  }
  if (
    stats.medianReductionRatio != null &&
    currentReduction != null &&
    currentReduction > stats.medianReductionRatio + 0.1
  ) {
    adjustments.push({
      parameter: "reduction_ratio",
      current: Math.round(currentReduction * 100) / 100,
      suggested: Math.round(stats.medianReductionRatio * 100) / 100,
      rationale:
        `The proposed reduction (${Math.round(currentReduction * 100)}%) is well ` +
        `above the fulfilled-case median (${Math.round(stats.medianReductionRatio * 100)}%); ` +
        `similar cases closed with less write-off.`,
    });
  }
  if (currentInstalments === 0 && amount > 0) {
    adjustments.push({
      parameter: "n_instalments",
      current: 0,
      suggested: stats.medianInstalments ?? 3,
      rationale:
        `A single-bullet payment was proposed; fulfilled similar settlements ` +
        `used instalment schedules (median ${stats.medianInstalments ?? 3}).`,
    });
  }
  return adjustments;
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Recommend on a proposed term sheet. Never throws; degradation is explicit.
 */
export async function recommendTerms(input: TermSheetInput): Promise<SettlementRecommendation> {
  const artifact = loadArtifact(RECOMMENDER_ARTIFACT);
  let fulfillmentProbability: number | null = null;
  let degraded = false;
  const reasons: string[] = [];

  if (artifact) {
    fulfillmentProbability = Math.round(
      predictProba(artifact, buildFeatureValues(artifact, input)) * 10_000,
    ) / 10_000;
    if (artifact.usable === false) {
      reasons.push(artifact.warning ?? "model provisional (small training set)");
    }
  } else {
    degraded = true;
    reasons.push("recommender model artifact unavailable — run ml.models.settlement_recommender");
  }

  const amount = Math.max(0, Number(input.monetaryAmount) || 0);
  const queryText =
    input.queryText ??
    `Settlement proposal: monetary amount NGN ${amount}, ` +
    `${(input.instalmentSchedule ?? []).length} instalments, ` +
    `${(input.nonMonetaryObligations ?? []).length} obligations, ` +
    `sector ${input.orgSector ?? "unknown"}`;
  const prec = await fulfilledPrecedentStats(queryText);
  if (prec.degraded) {
    degraded = true;
    reasons.push("settlement precedent retrieval unavailable");
  }
  const suggestedAdjustments = buildAdjustments(input, prec.stats);

  const predictionId = await mintPrediction({
    surface: SETTLEMENT_TERMS_SURFACE,
    suggestion: {
      monetary_amount: amount,
      n_instalments: (input.instalmentSchedule ?? []).length,
      n_obligations: (input.nonMonetaryObligations ?? []).length,
      fulfillment_probability: fulfillmentProbability,
      suggested_adjustments: suggestedAdjustments,
      precedent_stats: prec.stats,
      degraded,
    },
    actorId: input.actorId,
    modelVersion: artifact?.version ?? null,
  });

  return {
    predictionId,
    fulfillmentProbability,
    suggestedAdjustments,
    precedentStats: prec.stats,
    modelVersion: artifact?.version ?? null,
    degraded,
    reason: reasons.length ? reasons.join("; ") : null,
  };
}
