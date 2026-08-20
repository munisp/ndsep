export type OpaDecisionOutcome =
  | "allow"
  | "deny"
  | "unconfigured"
  | "http_error"
  | "malformed"
  | "timeout"
  | "unavailable";

const outcomes: OpaDecisionOutcome[] = [
  "allow",
  "deny",
  "unconfigured",
  "http_error",
  "malformed",
  "timeout",
  "unavailable",
];

const decisionCounts: Record<OpaDecisionOutcome, number> = {
  allow: 0,
  deny: 0,
  unconfigured: 0,
  http_error: 0,
  malformed: 0,
  timeout: 0,
  unavailable: 0,
};

let durationSecondsSum = 0;
let durationSecondsCount = 0;

/**
 * Records only bounded result labels. Subject, role, resource, request ID, and
 * source IP are deliberately excluded to prevent high-cardinality metrics and
 * sensitive-identifier disclosure.
 */
export function recordOpaDecision(outcome: OpaDecisionOutcome, durationMs: number): void {
  decisionCounts[outcome] += 1;
  durationSecondsSum += Math.max(0, durationMs) / 1_000;
  durationSecondsCount += 1;
}

export function getOpaMetrics(): {
  decisionCounts: Readonly<Record<OpaDecisionOutcome, number>>;
  durationSecondsSum: number;
  durationSecondsCount: number;
} {
  return {
    decisionCounts: { ...decisionCounts },
    durationSecondsSum,
    durationSecondsCount,
  };
}

export function renderOpaPrometheusMetrics(): string[] {
  const metrics = getOpaMetrics();
  return [
    "# HELP ndsep_opa_decisions_total Total OPA authorization decisions by bounded outcome",
    "# TYPE ndsep_opa_decisions_total counter",
    ...outcomes.map((outcome) => `ndsep_opa_decisions_total{outcome="${outcome}"} ${metrics.decisionCounts[outcome]}`),
    "# HELP ndsep_opa_decision_duration_seconds_sum Cumulative OPA decision duration in seconds",
    "# TYPE ndsep_opa_decision_duration_seconds_sum counter",
    `ndsep_opa_decision_duration_seconds_sum ${metrics.durationSecondsSum}`,
    "# HELP ndsep_opa_decision_duration_seconds_count Total observed OPA decision durations",
    "# TYPE ndsep_opa_decision_duration_seconds_count counter",
    `ndsep_opa_decision_duration_seconds_count ${metrics.durationSecondsCount}`,
  ];
}

/** Test-only reset; never invoke from production request paths. */
export function resetOpaMetricsForTest(): void {
  for (const outcome of outcomes) decisionCounts[outcome] = 0;
  durationSecondsSum = 0;
  durationSecondsCount = 0;
}
