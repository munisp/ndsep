/**
 * Pure-logic tests for the composite supervision risk score
 * (server/services/supervisionRiskScoring.ts, consumed by
 * server/routers/supervisionRisk.ts). No DB access.
 */
import { describe, expect, it } from "vitest";
import {
  computeCompositeScore,
  normalizeInputs,
  riskBand,
  DEFAULT_RISK_WEIGHTS,
  RISK_FACTOR_KEYS,
  type RawRiskInputs,
} from "../../server/services/supervisionRiskScoring";

const ZERO_INPUTS: RawRiskInputs = {
  complaintVolume: 0,
  complaintSurge: false,
  scanFindingsWeighted: 0,
  priorSanctions: 0,
  filingDelinquencyDays: 0,
  dataVolumeClass: "low",
};

const MAX_INPUTS: RawRiskInputs = {
  complaintVolume: 50,
  complaintSurge: true,
  scanFindingsWeighted: 25,
  priorSanctions: 5,
  filingDelinquencyDays: 180,
  dataVolumeClass: "very_high",
};

describe("normalizeInputs", () => {
  it("maps zero inputs to the data-volume floor only (all other factors 0)", () => {
    const n = normalizeInputs(ZERO_INPUTS);
    expect(n.complaint_volume).toBe(0);
    expect(n.complaint_surge).toBe(0);
    expect(n.scan_findings).toBe(0);
    expect(n.prior_sanctions).toBe(0);
    expect(n.filing_delinquency).toBe(0);
    expect(n.data_volume_class).toBe(0.1); // 'low' class is a small but non-zero exposure
  });

  it("saturates raw values at the caps (score stays within 0..1)", () => {
    const n = normalizeInputs({
      complaintVolume: 5000,
      complaintSurge: true,
      scanFindingsWeighted: 900,
      priorSanctions: 40,
      filingDelinquencyDays: 3650,
      dataVolumeClass: "very_high",
    });
    for (const key of RISK_FACTOR_KEYS) {
      expect(n[key]).toBeGreaterThanOrEqual(0);
      expect(n[key]).toBeLessThanOrEqual(1);
    }
    expect(n.complaint_volume).toBe(1);
    expect(n.scan_findings).toBe(1);
    expect(n.prior_sanctions).toBe(1);
    expect(n.filing_delinquency).toBe(1);
  });
});

describe("computeCompositeScore", () => {
  it("default weights sum to 1", () => {
    const total = RISK_FACTOR_KEYS.reduce((s, k) => s + DEFAULT_RISK_WEIGHTS[k], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("zero inputs yield a minimal score driven only by the low data-volume class", () => {
    const r = computeCompositeScore(ZERO_INPUTS);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThan(0.25);
    expect(r.band).toBe("low");
  });

  it("maxed inputs yield the maximum score of 1 (critical band)", () => {
    const r = computeCompositeScore(MAX_INPUTS);
    expect(r.score).toBe(1);
    expect(r.band).toBe("critical");
  });

  it("score is always clamped to 0..1 across extreme inputs and weights", () => {
    for (const raw of [ZERO_INPUTS, MAX_INPUTS]) {
      for (const weights of [{}, { scan_findings: 10 }, { complaint_volume: 0.01 }]) {
        const r = computeCompositeScore(raw, weights);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    }
  });

  it("a single saturated factor raises the score by roughly its (renormalised) weight", () => {
    const onlyScan: RawRiskInputs = { ...ZERO_INPUTS, dataVolumeClass: "low", scanFindingsWeighted: 25 };
    const r = computeCompositeScore(onlyScan);
    // expected = (0.25*1 + 0.15*0.1) / 1.0
    expect(r.score).toBeCloseTo(0.25 + 0.15 * 0.1, 4);
    expect(r.band).toBe("medium"); // 0.265 >= 0.25 threshold
  });

  it("weights are renormalised when overridden weights do not sum to 1", () => {
    const raw: RawRiskInputs = { ...ZERO_INPUTS, complaintVolume: 50, scanFindingsWeighted: 25, dataVolumeClass: "low" };
    const weights = { complaint_volume: 2, scan_findings: 2, complaint_surge: 0, prior_sanctions: 0, filing_delinquency: 0, data_volume_class: 0 };
    const r = computeCompositeScore(raw, weights);
    // both active factors saturated -> renormalised score must be 1
    expect(r.score).toBe(1);
  });

  it("explanation ranks the top contributing factors with details (insider-fusion shape)", () => {
    const raw: RawRiskInputs = { ...ZERO_INPUTS, priorSanctions: 5, scanFindingsWeighted: 10, dataVolumeClass: "high" };
    const r = computeCompositeScore(raw);
    expect(r.explanation.length).toBeGreaterThan(0);
    expect(r.explanation.length).toBeLessThanOrEqual(5);
    // ranked by contribution, descending
    for (let i = 1; i < r.explanation.length; i++) {
      expect(r.explanation[i - 1].contribution).toBeGreaterThanOrEqual(r.explanation[i].contribution);
    }
    // top contributor for this mix is prior sanctions (0.20 * 1.0)
    expect(r.explanation[0].signal).toBe("factor:prior_sanctions");
    expect(r.explanation[0].detail).toContain("sanction");
    for (const e of r.explanation) {
      expect(e.signal).toMatch(/^factor:/);
      expect(typeof e.contribution).toBe("number");
      expect(typeof e.detail).toBe("string");
    }
  });

  it("zero-weight factors are excluded from the explanation", () => {
    const r = computeCompositeScore(MAX_INPUTS, { complaint_volume: 0 });
    expect(r.explanation.find((e) => e.signal === "factor:complaint_volume")).toBeUndefined();
  });
});

describe("riskBand", () => {
  it("applies the low/medium/high/critical thresholds", () => {
    expect(riskBand(0)).toBe("low");
    expect(riskBand(0.24)).toBe("low");
    expect(riskBand(0.25)).toBe("medium");
    expect(riskBand(0.49)).toBe("medium");
    expect(riskBand(0.5)).toBe("high");
    expect(riskBand(0.74)).toBe("high");
    expect(riskBand(0.75)).toBe("critical");
    expect(riskBand(1)).toBe("critical");
  });
});
