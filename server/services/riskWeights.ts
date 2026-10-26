/**
 * Risk Weights Service (round 12, wave 8 — roadmap P2)
 * =====================================================
 * Fail-closed accessor for ML-learned supervision risk weights.
 *
 * ml/models/risk_weight_learner.py trains a weight vector over the six
 * supervisionRisk factors from prior enforcement outcomes and inserts a row
 * into learned_risk_weights (migration 0137) with active=false. Activation
 * is deliberate SQL only:
 *
 *     UPDATE learned_risk_weights SET active = false WHERE active;
 *     UPDATE learned_risk_weights SET active = true WHERE version = '<v>';
 *
 * getActiveWeights() returns the learned vector ONLY when:
 *   1. an active row exists, AND
 *   2. it is fresh (trained_at within FRESHNESS_WINDOW_MS = 30 days), AND
 *   3. the weights jsonb is complete and sane (covers exactly the six
 *      RISK_FACTOR_KEYS, all finite and >= 0, positive sum).
 * Otherwise it FAILS CLOSED to the hand-seeded DEFAULT_RISK_WEIGHTS from
 * supervisionRiskScoring.ts — a broken/absent/stale learned model can never
 * silently change supervision scoring.
 *
 * Consumed by server/routers/supervisionRisk.ts (loadWeights); admin-tuned
 * rows in the legacy risk_weights table still layer on top of whatever base
 * this returns (explicit human override outranks the learned model).
 */
import { getPool } from "../db";
import { logger } from "../logger";
import {
  DEFAULT_RISK_WEIGHTS,
  RISK_FACTOR_KEYS,
  type RiskWeights,
} from "./supervisionRiskScoring";

export const FRESHNESS_WINDOW_MS = 30 * 24 * 3600 * 1000; // 30 days

export interface ActiveWeightsResult {
  weights: RiskWeights;
  source: "learned" | "default";
  /** Learned model version when source === 'learned'. */
  version: string | null;
  /** Why the fallback fired (null when learned weights are live). */
  reason: string | null;
}

function defaultResult(reason: string): ActiveWeightsResult {
  return {
    weights: { ...DEFAULT_RISK_WEIGHTS },
    source: "default",
    version: null,
    reason,
  };
}

/**
 * Validate a learned weights payload. Returns a sanitized RiskWeights or
 * null. Unknown keys are ignored; ALL six factor keys must be present,
 * finite and non-negative, with a positive total.
 */
export function validateWeightsPayload(payload: unknown): RiskWeights | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const obj = payload as Record<string, unknown>;
  const out = {} as RiskWeights;
  let sum = 0;
  for (const key of RISK_FACTOR_KEYS) {
    const v = Number(obj[key]);
    if (!Number.isFinite(v) || v < 0) return null;
    out[key] = v;
    sum += v;
  }
  return sum > 0 ? out : null;
}

export async function getActiveWeights(
  now: Date = new Date(),
): Promise<ActiveWeightsResult> {
  const pool = getPool();
  if (!pool) return defaultResult("database unavailable");
  let rows: any[];
  try {
    const result = await pool.query(
      `SELECT version, weights, trained_at
         FROM learned_risk_weights
        WHERE active = true
        ORDER BY trained_at DESC
        LIMIT 1`,
    );
    rows = result.rows ?? [];
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) },
      "[riskWeights] learned_risk_weights query failed — using defaults");
    return defaultResult("learned_risk_weights query failed");
  }
  if (!rows.length) return defaultResult("no active learned weight row");

  const row = rows[0];
  const trainedAt = row.trained_at ? new Date(row.trained_at) : null;
  if (!trainedAt || Number.isNaN(trainedAt.getTime())) {
    return defaultResult("active row has invalid trained_at");
  }
  const ageMs = now.getTime() - trainedAt.getTime();
  if (ageMs < 0 || ageMs > FRESHNESS_WINDOW_MS) {
    return defaultResult(
      `active learned weights stale (${Math.round(ageMs / 86400000)}d old, limit 30d)`,
    );
  }
  const weights = validateWeightsPayload(row.weights);
  if (!weights) {
    return defaultResult("active row weights payload incomplete or invalid");
  }
  return {
    weights,
    source: "learned",
    version: typeof row.version === "string" ? row.version : null,
    reason: null,
  };
}
