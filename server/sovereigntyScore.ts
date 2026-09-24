/**
 * Data-sovereignty score — pure, DB-free computation.
 *
 * Regulatory driver: CBN Circular PSS/DIR/PUB/CIR/001/004 (2026-06-15) —
 * payment transaction data generated in Nigeria must be stored and managed
 * in Nigeria by 2027-01-01. The score (0..1) summarises how far a regulated
 * entity is from that target across four weighted components:
 *
 *   declared_observed_consistency  declared hosting posture vs observed
 *                                  egress destinations (0..1, 1 = fully consistent)
 *   attestation_freshness          officer attestation validity/freshness
 *                                  (expired attestation => 0 => compliance flag)
 *   violation_history              open + recently-resolved residency
 *                                  violations (0..1, 1 = clean record)
 *   foreign_egress_ratio           recent 5-min-window foreign-egress ratio,
 *                                  inverted (0..1, 1 = no foreign egress)
 *
 * Kept in a standalone module (no server imports) so tests/round8 can
 * exercise it under vitest without a database or tRPC context.
 * Mirrored conceptually by the explanation pattern in
 * server/routers/insiderThreat.ts — every score ships with a ranked,
 * human-readable explanation payload.
 */

export const CBN_LOCALISATION_DEADLINE = "2027-01-01T00:00:00.000Z" as const;

export const DEFAULT_SOVEREIGNTY_WEIGHTS = {
  declared_observed_consistency: 0.3,
  attestation_freshness: 0.2,
  violation_history: 0.25,
  foreign_egress_ratio: 0.25,
} as const;

export type SovereigntyWeights = {
  declared_observed_consistency: number;
  attestation_freshness: number;
  violation_history: number;
  foreign_egress_ratio: number;
};

export type ReadinessTier =
  | "sovereign_ready"
  | "on_track"
  | "at_risk"
  | "critical"
  | "non_compliant";

export interface SovereigntyScoreInputs {
  /** 0..1 — fraction of observed egress destinations covered by the
   *  approved hosting declaration (1 = observed matches declared). */
  declaredObservedConsistency: number;
  /** Whole days until the active attestation expires; negative when expired;
   *  null when no active attestation exists at all. */
  attestationDaysToExpiry: number | null;
  /** Open residency violations (detected/acknowledged/under_remediation). */
  openViolations: number;
  /** Violations resolved/dismissed in the trailing 180 days. */
  recentlyResolvedViolations: number;
  /** 0..1 — foreign share of egress bytes over the recent aggregation window. */
  foreignEgressRatio: number;
  /** Weights override (must be non-negative; renormalised if sum != 1). */
  weights?: Partial<SovereigntyWeights>;
  /** Reference instant; defaults to now. */
  now?: Date;
}

export interface ScoreExplanationFactor {
  factor: keyof SovereigntyWeights;
  weight: number;
  /** component value 0..1 before weighting */
  value: number;
  /** weight * value — contribution to the final score */
  contribution: number;
  detail: string;
}

export interface SovereigntyScoreResult {
  score: number;
  components: Record<keyof SovereigntyWeights, number>;
  weights: SovereigntyWeights;
  readinessTier: ReadinessTier;
  daysToDeadline: number;
  explanation: ScoreExplanationFactor[];
  summary: string;
}

/** Clamp to [0, 1] and guard against NaN/Infinity from bad telemetry. */
export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Attestation freshness:
 *   >= 90 days to expiry  -> 1.0
 *   0..90 days            -> linear ramp (expiry imminent => pressure)
 *   expired / missing     -> 0.0 (expired attestation is a compliance flag)
 */
export function attestationFreshness(daysToExpiry: number | null): number {
  if (daysToExpiry == null) return 0;
  if (daysToExpiry < 0) return 0;
  return clamp01(daysToExpiry / 90);
}

/**
 * Violation-history component: each open violation costs 0.25, each
 * recently-resolved one 0.05 (remediation counts for something, but the
 * history is not forgotten immediately).
 */
export function violationHistory(openViolations: number, recentlyResolved: number): number {
  const penalty = Math.max(0, openViolations) * 0.25 + Math.max(0, recentlyResolved) * 0.05;
  return clamp01(1 - penalty);
}

/** Readiness tier from score + days remaining to the CBN deadline. */
export function readinessTier(score: number, daysToDeadline: number): ReadinessTier {
  const s = clamp01(score);
  if (daysToDeadline <= 0 && s < 0.85) return "non_compliant";
  if (s >= 0.85) return "sovereign_ready";
  if (s >= 0.7) return "on_track";
  if (s >= 0.5) return "at_risk";
  return "critical";
}

function normaliseWeights(w: SovereigntyWeights): SovereigntyWeights {
  const sum =
    w.declared_observed_consistency +
    w.attestation_freshness +
    w.violation_history +
    w.foreign_egress_ratio;
  if (!(sum > 0) || !Number.isFinite(sum)) return { ...DEFAULT_SOVEREIGNTY_WEIGHTS };
  return {
    declared_observed_consistency: w.declared_observed_consistency / sum,
    attestation_freshness: w.attestation_freshness / sum,
    violation_history: w.violation_history / sum,
    foreign_egress_ratio: w.foreign_egress_ratio / sum,
  };
}

export function computeSovereigntyScore(input: SovereigntyScoreInputs): SovereigntyScoreResult {
  const weights = normaliseWeights({ ...DEFAULT_SOVEREIGNTY_WEIGHTS, ...(input.weights ?? {}) });
  const now = input.now ?? new Date();
  const daysToDeadline = Math.ceil(
    (Date.parse(CBN_LOCALISATION_DEADLINE) - now.getTime()) / 86_400_000,
  );

  const consistency = clamp01(input.declaredObservedConsistency);
  const freshness = attestationFreshness(input.attestationDaysToExpiry);
  const history = violationHistory(input.openViolations, input.recentlyResolvedViolations);
  const egress = clamp01(1 - clamp01(input.foreignEgressRatio));

  const components: Record<keyof SovereigntyWeights, number> = {
    declared_observed_consistency: consistency,
    attestation_freshness: freshness,
    violation_history: history,
    foreign_egress_ratio: egress,
  };

  const factors: ScoreExplanationFactor[] = [
    {
      factor: "declared_observed_consistency",
      weight: weights.declared_observed_consistency,
      value: consistency,
      contribution: weights.declared_observed_consistency * consistency,
      detail:
        consistency >= 0.95
          ? "Observed egress destinations match the approved hosting declaration."
          : consistency >= 0.7
            ? "Some observed egress destinations are outside the approved declaration; reconcile or amend it."
            : "Observed egress materially diverges from the approved hosting declaration.",
      },
    {
      factor: "attestation_freshness",
      weight: weights.attestation_freshness,
      value: freshness,
      contribution: weights.attestation_freshness * freshness,
      detail:
        input.attestationDaysToExpiry == null
          ? "No active attestation on file — officer sign-off required."
          : input.attestationDaysToExpiry < 0
            ? `Attestation EXPIRED ${Math.abs(input.attestationDaysToExpiry)} day(s) ago — compliance flag.`
            : input.attestationDaysToExpiry <= 30
              ? `Attestation expires in ${input.attestationDaysToExpiry} day(s); renewal due.`
              : `Attestation valid for ${input.attestationDaysToExpiry} more day(s).`,
    },
    {
      factor: "violation_history",
      weight: weights.violation_history,
      value: history,
      contribution: weights.violation_history * history,
      detail:
        input.openViolations === 0 && input.recentlyResolvedViolations === 0
          ? "No residency violations on record."
          : `${input.openViolations} open and ${input.recentlyResolvedViolations} recently-resolved residency violation(s).`,
    },
    {
      factor: "foreign_egress_ratio",
      weight: weights.foreign_egress_ratio,
      value: egress,
      contribution: weights.foreign_egress_ratio * egress,
      detail:
        input.foreignEgressRatio <= 0.01
          ? "Negligible foreign egress observed in the recent window."
          : `${(clamp01(input.foreignEgressRatio) * 100).toFixed(1)}% of recent egress bytes left Nigeria.`,
    },
  ];
  // weakest factors first
  const explanation = factors.sort((a, b) => a.contribution - b.contribution);

  const rawScore = explanation.reduce((acc, f) => acc + f.contribution, 0);
  const score = clamp01(Math.round(rawScore * 1000) / 1000);
  const tier = readinessTier(score, daysToDeadline);

  const weakest = explanation[0];
  const summary =
    `Sovereignty score ${score.toFixed(3)} (${tier.replace(/_/g, " ")}); ` +
    `${daysToDeadline} day(s) to the CBN localisation deadline (2027-01-01). ` +
    (weakest && weakest.contribution < weakest.weight * 0.5
      ? `Weakest factor: ${weakest.factor.replace(/_/g, " ")} — ${weakest.detail}`
      : "All factors within acceptable bands.");

  return {
    score,
    components,
    weights,
    readinessTier: tier,
    daysToDeadline,
    explanation,
    summary,
  };
}
