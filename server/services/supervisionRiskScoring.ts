/**
 * Supervision risk scoring — pure logic (DB-free, unit-testable).
 *
 * Composite risk score per registered controller (0..1) = renormalised
 * weighted sum of normalised factors, with an explanation payload
 * [{signal, contribution, detail}] mirroring the ml/insider fusion
 * explanation pattern. Consumed by server/routers/supervisionRisk.ts and
 * tested by tests/round8/riskScoring.test.ts.
 */

export const RISK_FACTOR_KEYS = [
  "complaint_volume",
  "complaint_surge",
  "scan_findings",
  "prior_sanctions",
  "filing_delinquency",
  "data_volume_class",
] as const;
export type RiskFactorKey = (typeof RISK_FACTOR_KEYS)[number];

export type RiskWeights = Record<RiskFactorKey, number>;

export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  complaint_volume: 0.20,
  complaint_surge: 0.10,
  scan_findings: 0.25,
  prior_sanctions: 0.20,
  filing_delinquency: 0.10,
  data_volume_class: 0.15,
};

export type DataVolumeClass = "low" | "medium" | "high" | "very_high";

export interface RawRiskInputs {
  /** Complaints received in the trailing 12 months (raw count). */
  complaintVolume: number;
  /** Complaint surge alert active for this controller. */
  complaintSurge: boolean;
  /** Severity-weighted open scan findings (critical=4, high=3, medium=2, low=1). */
  scanFindingsWeighted: number;
  /** Published sanctions register entries. */
  priorSanctions: number;
  /** Days overdue on outstanding CAR/registration filings (0 when current). */
  filingDelinquencyDays: number;
  /** Declared data-volume class. */
  dataVolumeClass: DataVolumeClass;
}

/** Saturation points for raw → [0,1] normalisation. */
export const NORMALIZATION_CAPS = {
  complaintVolume: 50,
  scanFindingsWeighted: 25,
  priorSanctions: 5,
  filingDelinquencyDays: 180,
} as const;

export const DATA_VOLUME_CLASS_SCORE: Record<DataVolumeClass, number> = {
  low: 0.1,
  medium: 0.4,
  high: 0.7,
  very_high: 1.0,
};

const clamp01 = (v: number): number => (Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v)));

/** Normalise raw inputs into [0,1] per factor. */
export function normalizeInputs(raw: RawRiskInputs): Record<RiskFactorKey, number> {
  return {
    complaint_volume: clamp01(raw.complaintVolume / NORMALIZATION_CAPS.complaintVolume),
    complaint_surge: raw.complaintSurge ? 1 : 0,
    scan_findings: clamp01(raw.scanFindingsWeighted / NORMALIZATION_CAPS.scanFindingsWeighted),
    prior_sanctions: clamp01(raw.priorSanctions / NORMALIZATION_CAPS.priorSanctions),
    filing_delinquency: clamp01(raw.filingDelinquencyDays / NORMALIZATION_CAPS.filingDelinquencyDays),
    data_volume_class: DATA_VOLUME_CLASS_SCORE[raw.dataVolumeClass] ?? DATA_VOLUME_CLASS_SCORE.medium,
  };
}

export type RiskBand = "low" | "medium" | "high" | "critical";

export function riskBand(score: number): RiskBand {
  if (score >= 0.75) return "critical";
  if (score >= 0.5) return "high";
  if (score >= 0.25) return "medium";
  return "low";
}

export interface RiskExplanationEntry {
  signal: string;
  contribution: number;
  detail: string;
}

export interface CompositeScoreResult {
  score: number;
  band: RiskBand;
  weightsUsed: RiskWeights;
  explanation: RiskExplanationEntry[]; // ranked, top 5
}

const FACTOR_DETAIL: Record<RiskFactorKey, (raw: RawRiskInputs) => string> = {
  complaint_volume: (r) => `${r.complaintVolume} complaint(s) in trailing 12 months`,
  complaint_surge: (r) => (r.complaintSurge ? "active complaint surge alert" : "no complaint surge alert"),
  scan_findings: (r) => `severity-weighted open scan findings: ${r.scanFindingsWeighted}`,
  prior_sanctions: (r) => `${r.priorSanctions} published sanction(s) on the register`,
  filing_delinquency: (r) =>
    r.filingDelinquencyDays > 0 ? `filings ${r.filingDelinquencyDays} day(s) overdue` : "filings current",
  data_volume_class: (r) => `data-volume class: ${r.dataVolumeClass}`,
};

/**
 * Composite supervision risk score: weights are renormalised over the factors
 * present so a zero/removed weight never distorts the scale. Explanation
 * entries are ranked by contribution (mirrors ml/insider fusion output).
 */
export function computeCompositeScore(
  raw: RawRiskInputs,
  weights: Partial<RiskWeights> = {},
): CompositeScoreResult {
  const merged: RiskWeights = { ...DEFAULT_RISK_WEIGHTS, ...weights };
  const normalized = normalizeInputs(raw);

  let totalWeight = 0;
  let weightedSum = 0;
  const explanation: RiskExplanationEntry[] = [];
  for (const key of RISK_FACTOR_KEYS) {
    const w = Math.max(0, Number(merged[key]) || 0);
    if (w === 0) continue;
    const contribution = w * normalized[key];
    totalWeight += w;
    weightedSum += contribution;
    explanation.push({
      signal: `factor:${key}`,
      contribution: Math.round(contribution * 10_000) / 10_000,
      detail: FACTOR_DETAIL[key](raw),
    });
  }

  const score = totalWeight > 0 ? clamp01(weightedSum / totalWeight) : 0;
  explanation.sort((a, b) => (b.contribution - a.contribution) || a.signal.localeCompare(b.signal));

  return {
    score: Math.round(score * 10_000) / 10_000,
    band: riskBand(score),
    weightsUsed: merged,
    explanation: explanation.slice(0, 5),
  };
}
