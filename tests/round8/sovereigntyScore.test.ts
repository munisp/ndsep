/**
 * Round 8 — data-sovereignty score tests (pure logic, no DB).
 *
 * Exercises server/sovereigntyScore.ts: weighted 0..1 score, component
 * math, explanation payload, readiness tiers and the 2027-01-01 CBN
 * localisation deadline countdown.
 *
 * Run (repo root):
 *   npx vitest run --config tests/round8/vitest.config.ts
 */
import { describe, expect, it } from "vitest";
import {
  CBN_LOCALISATION_DEADLINE,
  DEFAULT_SOVEREIGNTY_WEIGHTS,
  attestationFreshness,
  clamp01,
  computeSovereigntyScore,
  readinessTier,
  violationHistory,
} from "../../server/sovereigntyScore";

const BEFORE_DEADLINE = new Date("2026-07-01T00:00:00Z"); // ~184 days out
const AFTER_DEADLINE = new Date("2027-02-01T00:00:00Z");

const cleanEntity = {
  declaredObservedConsistency: 1,
  attestationDaysToExpiry: 180,
  openViolations: 0,
  recentlyResolvedViolations: 0,
  foreignEgressRatio: 0,
  now: BEFORE_DEADLINE,
};

describe("clamp01", () => {
  it("clamps and defends against non-finite telemetry", () => {
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
  });
});

describe("attestationFreshness", () => {
  it("is 1 at >=90 days to expiry, ramps linearly below, 0 when expired/missing", () => {
    expect(attestationFreshness(180)).toBe(1);
    expect(attestationFreshness(90)).toBe(1);
    expect(attestationFreshness(45)).toBeCloseTo(0.5, 10);
    expect(attestationFreshness(0)).toBe(0);
    expect(attestationFreshness(-1)).toBe(0); // expired = compliance flag
    expect(attestationFreshness(null)).toBe(0); // no attestation at all
  });
});

describe("violationHistory", () => {
  it("penalises open violations harder than recently-resolved ones", () => {
    expect(violationHistory(0, 0)).toBe(1);
    expect(violationHistory(1, 0)).toBeCloseTo(0.75, 10);
    expect(violationHistory(0, 4)).toBeCloseTo(0.8, 10);
    expect(violationHistory(4, 0)).toBe(0); // 4 open violations => floor
    expect(violationHistory(99, 99)).toBe(0);
  });
});

describe("computeSovereigntyScore", () => {
  it("gives a clean, attested, local entity a near-perfect score", () => {
    const r = computeSovereigntyScore(cleanEntity);
    expect(r.score).toBe(1);
    expect(r.readinessTier).toBe("sovereign_ready");
    expect(r.daysToDeadline).toBeGreaterThan(0);
    expect(r.explanation).toHaveLength(4);
  });

  it("weights are the documented defaults and sum to 1", () => {
    const r = computeSovereigntyScore(cleanEntity);
    expect(r.weights).toEqual(DEFAULT_SOVEREIGNTY_WEIGHTS);
    const sum = Object.values(r.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("score equals the weighted sum of clamped components", () => {
    const r = computeSovereigntyScore({
      declaredObservedConsistency: 0.5,
      attestationDaysToExpiry: 45,
      openViolations: 1,
      recentlyResolvedViolations: 0,
      foreignEgressRatio: 0.2,
      now: BEFORE_DEADLINE,
    });
    const expected =
      0.3 * 0.5 + // consistency
      0.2 * 0.5 + // freshness (45/90)
      0.25 * 0.75 + // violation history
      0.25 * 0.8; // egress (1 - 0.2)
    // score is persisted rounded to 3 decimals
    expect(r.score).toBe(Math.round(expected * 1000) / 1000);
    expect(r.components.declared_observed_consistency).toBe(0.5);
    expect(r.components.foreign_egress_ratio).toBeCloseTo(0.8, 10);
  });

  it("expired attestation is a hard compliance flag in the explanation", () => {
    const r = computeSovereigntyScore({ ...cleanEntity, attestationDaysToExpiry: -3 });
    expect(r.components.attestation_freshness).toBe(0);
    const factor = r.explanation.find((f) => f.factor === "attestation_freshness");
    expect(factor?.detail).toMatch(/EXPIRED/);
    expect(r.score).toBeLessThan(1);
  });

  it("missing attestation is flagged explicitly", () => {
    const r = computeSovereigntyScore({ ...cleanEntity, attestationDaysToExpiry: null });
    const factor = r.explanation.find((f) => f.factor === "attestation_freshness");
    expect(factor?.detail).toMatch(/No active attestation/);
    expect(factor?.value).toBe(0);
  });

  it("explanation is ranked weakest-first and contributions sum to the score", () => {
    const r = computeSovereigntyScore({
      declaredObservedConsistency: 0.2,
      attestationDaysToExpiry: 180,
      openViolations: 2,
      recentlyResolvedViolations: 1,
      foreignEgressRatio: 0.4,
      now: BEFORE_DEADLINE,
    });
    for (let i = 1; i < r.explanation.length; i++) {
      expect(r.explanation[i].contribution).toBeGreaterThanOrEqual(
        r.explanation[i - 1].contribution,
      );
    }
    const total = r.explanation.reduce((acc, f) => acc + f.contribution, 0);
    expect(total).toBeCloseTo(r.score, 2);
    expect(r.summary).toMatch(/Weakest factor: declared observed consistency/);
  });

  it("high foreign egress pulls the score down through the egress component", () => {
    const local = computeSovereigntyScore(cleanEntity);
    const leaky = computeSovereigntyScore({ ...cleanEntity, foreignEgressRatio: 0.6 });
    expect(leaky.components.foreign_egress_ratio).toBeCloseTo(0.4, 10);
    expect(leaky.score).toBeCloseTo(local.score - 0.25 * 0.6, 3);
    const factor = leaky.explanation.find((f) => f.factor === "foreign_egress_ratio");
    expect(factor?.detail).toMatch(/60\.0% of recent egress bytes left Nigeria/);
  });

  it("renormalises custom weights instead of producing out-of-band scores", () => {
    const r = computeSovereigntyScore({
      ...cleanEntity,
      weights: {
        declared_observed_consistency: 2,
        attestation_freshness: 2,
        violation_history: 2,
        foreign_egress_ratio: 2,
      },
    });
    expect(r.weights.declared_observed_consistency).toBeCloseTo(0.25, 10);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it("falls back to default weights when given a degenerate (all-zero) set", () => {
    const r = computeSovereigntyScore({
      ...cleanEntity,
      weights: {
        declared_observed_consistency: 0,
        attestation_freshness: 0,
        violation_history: 0,
        foreign_egress_ratio: 0,
      },
    });
    expect(r.weights).toEqual(DEFAULT_SOVEREIGNTY_WEIGHTS);
  });
});

describe("readinessTier + deadline countdown", () => {
  it("maps score bands to tiers before the deadline", () => {
    expect(readinessTier(0.9, 100)).toBe("sovereign_ready");
    expect(readinessTier(0.75, 100)).toBe("on_track");
    expect(readinessTier(0.55, 100)).toBe("at_risk");
    expect(readinessTier(0.3, 100)).toBe("critical");
  });

  it("past the deadline, anything below sovereign_ready is non_compliant", () => {
    expect(readinessTier(0.9, -5)).toBe("sovereign_ready");
    expect(readinessTier(0.7, -5)).toBe("non_compliant");
    expect(readinessTier(0.3, -5)).toBe("non_compliant");
    expect(readinessTier(0.7, 0)).toBe("non_compliant");
  });

  it("deadline countdown is computed against 2027-01-01", () => {
    expect(CBN_LOCALISATION_DEADLINE).toBe("2027-01-01T00:00:00.000Z");
    const before = computeSovereigntyScore(cleanEntity);
    expect(before.daysToDeadline).toBe(184);
    const after = computeSovereigntyScore({ ...cleanEntity, now: AFTER_DEADLINE });
    expect(after.daysToDeadline).toBeLessThan(0);
  });
});
