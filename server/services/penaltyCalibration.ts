/**
 * Penalty Calibration Service (round 12, wave 8 — roadmap P2)
 * ============================================================
 * Advisory calibration badge for the NDPA 2023 s.48 penalty preview:
 * P(upheld on appeal | penalty_band, violation_type, org_size,
 * legal_basis_section), learned from the Commission's adjudicated appeal
 * history by ml/models/penalty_calibration.py and served from the exported
 * JSON artifact (pure TS — see ./hgbArtifact).
 *
 * HARD RULE: calibration NEVER alters a computed penalty. The s.48
 * computation in ./penaltyEngine is authoritative; this service returns an
 * advisory badge ({upholdProbability, similarMedian}) and appends an
 * audit row (penalty_calibration_audit, migration 0138) recording the badge
 * next to the VERBATIM computed amount for later comparison.
 *
 * Feedback loop (roadmap §4.1 keystone): every badge mints a
 * decision_feedback prediction (surface='penalty_calibration') via
 * decisionFeedback.mintPrediction; the UI records accept / reject through
 * client/src/lib/feedback.ts.
 *
 * similarMedian: median penalty-band midpoint over similar DECIDED
 * enforcement precedents retrieved via casePrecedents.searchCases
 * (ndsep_cases collection). Fail-closed: worker unreachable → null +
 * degraded, never a fabricated figure.
 *
 * PRIVACY: org references in the audit row are pseudonymized
 * (keyed HMAC, complaintLogic.hmacSha256Hex); the minted suggestion payload
 * carries only categorical features (decisionFeedback enforces the
 * raw-identifier denylist anyway).
 */
import { getPool } from "../db";
import { logger } from "../logger";
import { mintPrediction } from "../routers/decisionFeedback";
import { redactQueryText, searchCases } from "../routers/casePrecedents";
import { hmacSha256Hex } from "./complaintLogic";
import { loadArtifact, predictProba, type HgbArtifact } from "./hgbArtifact";

export const PENALTY_CALIBRATION_SURFACE = "penalty_calibration";
export const CALIBRATION_ARTIFACT = "penalty_calibration.json";

/** Band midpoints (NGN) for the similarMedian statistic. */
export const BAND_MIDPOINTS: Record<string, number> = {
  under_floor: 1_000_000,
  "2m_10m": 6_000_000,
  "10m_100m": 55_000_000,
  over_100m: 100_000_000,
};

/** Same banding as ml/models/penalty_calibration.penalty_band. */
export function penaltyBandFor(amount: number | null | undefined): string {
  const a = Number(amount);
  if (!Number.isFinite(a)) return "unknown";
  if (a < 2_000_000) return "under_floor";
  if (a < 10_000_000) return "2m_10m";
  if (a < 100_000_000) return "10m_100m";
  return "over_100m";
}

export interface CalibrationInput {
  /** Authoritative s.48 computed amount (NGN). NEVER modified here. */
  penaltyAmount: number;
  violationType?: string;
  orgSize?: string;
  legalBasisSection?: string;
  orgId?: number;
  actorId: string | number;
  /** Free text for precedent retrieval (PII-scrubbed server-side). */
  queryText?: string;
}

export interface CalibrationBadge {
  predictionId: string;
  penaltyBand: string;
  upholdProbability: number | null;
  similarMedian: number | null;
  similarCount: number;
  modelVersion: string | null;
  degraded: boolean;
  reason: string | null;
  /** Echoed verbatim: the authoritative amount this badge does NOT change. */
  computedAmount: number;
}

function featureValues(
  artifact: HgbArtifact,
  band: string,
  violationType: string,
  orgSize: string,
  legalBasisSection: string,
): Record<string, number> {
  const levels = artifact.categorical_levels ?? {};
  const resolve = (col: string, raw: string): string => {
    const lv = levels[col] ?? [];
    const v = (raw || "unknown").trim().toLowerCase();
    return lv.includes(v) ? v : "unknown";
  };
  const vals: Record<string, number> = {};
  const cols: Array<[string, string]> = [
    ["penalty_band", band],
    ["violation_type", violationType],
    ["org_size", orgSize],
    ["legal_basis_section", legalBasisSection],
  ];
  for (const [col, raw] of cols) {
    const level = resolve(col, raw);
    for (const lv of levels[col] ?? []) {
      vals[`${col}=${lv}`] = lv === level ? 1 : 0;
    }
  }
  return vals;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median band midpoint of similar DECIDED enforcement precedents. */
export async function similarEnforcementMedian(queryText: string): Promise<{
  similarMedian: number | null;
  similarCount: number;
  degraded: boolean;
}> {
  const hits = await searchCases(redactQueryText(queryText), 15);
  if (hits === null) return { similarMedian: null, similarCount: 0, degraded: true };
  const mids = hits
    .map((h) => (h.payload ?? {}) as Record<string, unknown>)
    .filter((p) => p.case_type === "enforcement")
    .map((p) => BAND_MIDPOINTS[String(p.penalty_band ?? "")])
    .filter((v): v is number => typeof v === "number");
  return { similarMedian: median(mids), similarCount: mids.length, degraded: false };
}

function orgHashFor(orgId: number | undefined): string | null {
  if (orgId == null) return null;
  const salt = process.env.ANONYMIZATION_SALT;
  if (!salt) return null; // no salt configured -> omit the reference entirely
  return hmacSha256Hex(salt, `org:${orgId}`);
}

async function auditCalibration(badge: CalibrationBadge, input: CalibrationInput): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO penalty_calibration_audit
         (prediction_id, model_version, penalty_band, violation_type,
          org_size, legal_basis_section, org_hash, uphold_probability,
          similar_median_ngn, computed_amount_ngn, degraded)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        badge.predictionId,
        badge.modelVersion,
        badge.penaltyBand,
        (input.violationType ?? "unknown").toLowerCase(),
        (input.orgSize ?? "unknown").toLowerCase(),
        (input.legalBasisSection ?? "unknown").toLowerCase(),
        orgHashFor(input.orgId),
        badge.upholdProbability,
        badge.similarMedian,
        badge.computedAmount,
        badge.degraded,
      ],
    );
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) },
      "[penaltyCalibration] audit insert skipped");
  }
}

/**
 * Compute the advisory calibration badge for a s.48 penalty preview.
 * Never throws: any subsystem failure degrades the badge, not the preview.
 */
export async function calibratePenalty(input: CalibrationInput): Promise<CalibrationBadge> {
  const band = penaltyBandFor(input.penaltyAmount);
  const violationType = (input.violationType ?? "unknown").toLowerCase();
  const orgSize = (input.orgSize ?? "unknown").toLowerCase();
  const legalBasisSection = (input.legalBasisSection ?? "unknown").toLowerCase();

  const artifact = loadArtifact(CALIBRATION_ARTIFACT);
  let upholdProbability: number | null = null;
  let degraded = false;
  const reasons: string[] = [];
  if (artifact) {
    upholdProbability = Math.round(
      predictProba(artifact, featureValues(artifact, band, violationType, orgSize, legalBasisSection)) * 10_000,
    ) / 10_000;
    if (artifact.usable === false) {
      reasons.push(artifact.warning ?? "model provisional (small training set)");
    }
  } else {
    degraded = true;
    reasons.push("calibration model artifact unavailable — run ml.models.penalty_calibration");
  }

  const queryText =
    input.queryText ??
    `NDPA s.48 administrative penalty, band ${band}, violation ${violationType}, ` +
    `org size ${orgSize}, legal basis ${legalBasisSection}`;
  const sim = await similarEnforcementMedian(queryText);
  if (sim.degraded) {
    degraded = true;
    reasons.push("precedent retrieval unavailable (vector worker unreachable)");
  }

  const predictionId = await mintPrediction({
    surface: PENALTY_CALIBRATION_SURFACE,
    suggestion: {
      penalty_band: band,
      violation_type: violationType,
      org_size: orgSize,
      legal_basis_section: legalBasisSection,
      uphold_probability: upholdProbability,
      similar_median_ngn: sim.similarMedian,
      similar_count: sim.similarCount,
      degraded,
    },
    actorId: input.actorId,
    modelVersion: artifact?.version ?? null,
  });

  const badge: CalibrationBadge = {
    predictionId,
    penaltyBand: band,
    upholdProbability,
    similarMedian: sim.similarMedian,
    similarCount: sim.similarCount,
    modelVersion: artifact?.version ?? null,
    degraded,
    reason: reasons.length ? reasons.join("; ") : null,
    computedAmount: input.penaltyAmount,
  };
  await auditCalibration(badge, input);
  return badge;
}
