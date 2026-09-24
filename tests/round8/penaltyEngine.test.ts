/**
 * Pure-logic tests for NDPA 2023 s.48 penalty computation
 * (server/services/penaltyEngine.ts). No DB, no mocks of the unit under test.
 */
import { describe, expect, it } from "vitest";
import {
  computeSection48Penalty,
  selectBestRevenue,
  scoreFactors,
  DCPMI_FLOOR_NGN,
  NON_MAJOR_FLOOR_NGN,
  REVENUE_RATE,
  MIN_MULTIPLIER,
  type Section48Factors,
  type VerifiedRevenueRecord,
} from "../../server/services/penaltyEngine";

const NEUTRAL_FACTORS: Section48Factors = {
  natureGravityDuration: 0.5,
  categoriesOfData: 0.5,
  dataSubjectCount: 0,
  intent: "negligent",
  priorInfringements: 0,
  cooperationDegree: 0.5,
  remediation: "partial",
};

const MAX_AGGRAVATING: Section48Factors = {
  natureGravityDuration: 1,
  categoriesOfData: 1,
  dataSubjectCount: 10_000_000,
  intent: "intentional",
  priorInfringements: 3,
  cooperationDegree: 0,
  remediation: "none",
};

const MAX_MITIGATING: Section48Factors = {
  natureGravityDuration: 0,
  categoriesOfData: 0,
  dataSubjectCount: 0,
  intent: "unintentional",
  priorInfringements: 0,
  cooperationDegree: 1,
  remediation: "full",
};

describe("s.48 statutory cap: greater of floor or 2% of annual gross revenue", () => {
  const base = { verifiedRevenue: 0, revenueSource: "none" as const, factors: NEUTRAL_FACTORS };

  it("DCPMI with no/low revenue: floor of ₦10,000,000 drives the cap", () => {
    const r = computeSection48Penalty({ ...base, isDcpmi: true, verifiedRevenue: null });
    expect(r.statutoryFloor).toBe(10_000_000);
    expect(r.revenueComponent).toBe(0);
    expect(r.statutoryCap).toBe(10_000_000);
    expect(r.capDriver).toBe("floor");
  });

  it("non-major with no/low revenue: floor of ₦2,000,000 drives the cap", () => {
    const r = computeSection48Penalty({ ...base, isDcpmi: false, verifiedRevenue: 50_000_000 });
    // 2% of ₦50m = ₦1m < ₦2m floor
    expect(r.statutoryFloor).toBe(2_000_000);
    expect(r.revenueComponent).toBe(1_000_000);
    expect(r.statutoryCap).toBe(2_000_000);
    expect(r.capDriver).toBe("floor");
  });

  it("DCPMI boundary: 2% of ₦500,000,000 equals the ₦10,000,000 floor exactly", () => {
    const r = computeSection48Penalty({ ...base, isDcpmi: true, verifiedRevenue: 500_000_000, revenueSource: "firs" });
    expect(r.revenueComponent).toBe(10_000_000);
    expect(r.statutoryCap).toBe(10_000_000);
    expect(r.capDriver).toBe("floor"); // not strictly greater -> floor driver
  });

  it("DCPMI above boundary: 2% of ₦600,000,000 (₦12,000,000) exceeds the floor", () => {
    const r = computeSection48Penalty({ ...base, isDcpmi: true, verifiedRevenue: 600_000_000, revenueSource: "firs" });
    expect(r.revenueComponent).toBe(12_000_000);
    expect(r.statutoryCap).toBe(12_000_000);
    expect(r.capDriver).toBe("revenue");
  });

  it("non-major boundary: 2% of ₦100,000,000 equals the ₦2,000,000 floor exactly", () => {
    const r = computeSection48Penalty({ ...base, isDcpmi: false, verifiedRevenue: 100_000_000, revenueSource: "cac" });
    expect(r.revenueComponent).toBe(2_000_000);
    expect(r.statutoryCap).toBe(2_000_000);
  });

  it("non-major above boundary: 2% of ₦200,000,000 (₦4,000,000) exceeds the floor", () => {
    const r = computeSection48Penalty({ ...base, isDcpmi: false, verifiedRevenue: 200_000_000, revenueSource: "cac" });
    expect(r.statutoryCap).toBe(4_000_000);
    expect(r.capDriver).toBe("revenue");
  });

  it("uses the statutory constants (₦10m / ₦2m / 2%)", () => {
    expect(DCPMI_FLOOR_NGN).toBe(10_000_000);
    expect(NON_MAJOR_FLOOR_NGN).toBe(2_000_000);
    expect(REVENUE_RATE).toBe(0.02);
  });
});

describe("s.48(6) aggravating/mitigating factors and cap behaviour", () => {
  it("full aggravation yields severity 1 and multiplier 1 -> final amount equals the cap", () => {
    const { severity } = scoreFactors(MAX_AGGRAVATING);
    expect(severity).toBe(1);
    const r = computeSection48Penalty({ isDcpmi: true, verifiedRevenue: 600_000_000, revenueSource: "firs", factors: MAX_AGGRAVATING });
    expect(r.multiplier).toBe(1);
    expect(r.finalAmount).toBe(r.statutoryCap);
    expect(r.finalAmount).toBe(12_000_000);
  });

  it("full mitigation yields severity 0 and the minimum multiplier", () => {
    const { severity } = scoreFactors(MAX_MITIGATING);
    expect(severity).toBe(0);
    const r = computeSection48Penalty({ isDcpmi: true, verifiedRevenue: null, revenueSource: "none", factors: MAX_MITIGATING });
    expect(r.multiplier).toBeCloseTo(MIN_MULTIPLIER, 10);
    expect(r.finalAmount).toBeCloseTo(r.statutoryCap * MIN_MULTIPLIER, 2);
  });

  it("final amount NEVER exceeds the statutory cap for any factor mix", () => {
    const mixes = [NEUTRAL_FACTORS, MAX_AGGRAVATING, MAX_MITIGATING,
      { ...MAX_AGGRAVATING, cooperationDegree: 1, remediation: "full" as const }];
    for (const factors of mixes) {
      for (const isDcpmi of [true, false]) {
        for (const revenue of [null, 0, 100_000_000, 500_000_000, 5_000_000_000]) {
          const r = computeSection48Penalty({ isDcpmi, verifiedRevenue: revenue, revenueSource: "firs", factors });
          expect(r.finalAmount).toBeLessThanOrEqual(r.statutoryCap);
          expect(r.finalAmount).toBeGreaterThan(0);
        }
      }
    }
  });

  it("intentional infringement is penalised more heavily than negligent, all else equal", () => {
    const intentional = computeSection48Penalty({ isDcpmi: false, verifiedRevenue: null, revenueSource: "none", factors: { ...NEUTRAL_FACTORS, intent: "intentional" } });
    const negligent = computeSection48Penalty({ isDcpmi: false, verifiedRevenue: null, revenueSource: "none", factors: { ...NEUTRAL_FACTORS, intent: "negligent" } });
    expect(intentional.finalAmount).toBeGreaterThan(negligent.finalAmount);
  });

  it("prior infringements aggravate; cooperation mitigates", () => {
    const priors = computeSection48Penalty({ isDcpmi: false, verifiedRevenue: null, revenueSource: "none", factors: { ...NEUTRAL_FACTORS, priorInfringements: 3 } });
    const clean = computeSection48Penalty({ isDcpmi: false, verifiedRevenue: null, revenueSource: "none", factors: { ...NEUTRAL_FACTORS, priorInfringements: 0 } });
    expect(priors.finalAmount).toBeGreaterThan(clean.finalAmount);

    const cooperative = computeSection48Penalty({ isDcpmi: false, verifiedRevenue: null, revenueSource: "none", factors: { ...NEUTRAL_FACTORS, cooperationDegree: 1 } });
    const obstructive = computeSection48Penalty({ isDcpmi: false, verifiedRevenue: null, revenueSource: "none", factors: { ...NEUTRAL_FACTORS, cooperationDegree: 0 } });
    expect(cooperative.finalAmount).toBeLessThan(obstructive.finalAmount);
  });

  it("data-subject count saturates at 10,000,000", () => {
    const atCap = scoreFactors({ ...NEUTRAL_FACTORS, dataSubjectCount: 10_000_000 });
    const beyond = scoreFactors({ ...NEUTRAL_FACTORS, dataSubjectCount: 500_000_000 });
    expect(atCap.severity).toBe(beyond.severity);
  });

  it("records the full factor-contribution trail in the breakdown (appeal defence)", () => {
    const r = computeSection48Penalty({ isDcpmi: true, verifiedRevenue: 500_000_000, revenueSource: "firs", revenueFiscalYear: 2024, verifiedRevenueId: 42, factors: NEUTRAL_FACTORS });
    expect(r.factorContributions.length).toBe(7);
    for (const c of r.factorContributions) {
      expect(c).toHaveProperty("factor");
      expect(c).toHaveProperty("points");
      expect(c).toHaveProperty("detail");
    }
    expect(r.revenueFiscalYear).toBe(2024);
    expect(r.verifiedRevenueId).toBe(42);
    expect(r.legalBasis).toContain("s.48(7)");
  });
});

describe("revenue provenance", () => {
  const rec = (over: Partial<VerifiedRevenueRecord>): VerifiedRevenueRecord => ({
    id: 1, orgId: 7, source: "manual_filing", amount: 100_000_000, currency: "NGN",
    fiscalYear: 2024, status: "verified", verifiedAt: "2025-01-01T00:00:00Z", ...over,
  });

  it("selectBestRevenue prefers FIRS over CAC over manual filing", () => {
    const best = selectBestRevenue([
      rec({ id: 1, source: "manual_filing" }),
      rec({ id: 2, source: "cac" }),
      rec({ id: 3, source: "firs" }),
    ]);
    expect(best?.source).toBe("firs");
  });

  it("within a source, the most recent fiscal year wins", () => {
    const best = selectBestRevenue([
      rec({ id: 1, source: "firs", fiscalYear: 2022 }),
      rec({ id: 2, source: "firs", fiscalYear: 2024 }),
    ]);
    expect(best?.fiscalYear).toBe(2024);
  });

  it("unverified / pending / disputed / superseded records are never selected", () => {
    expect(selectBestRevenue([
      rec({ status: "pending" }),
      rec({ status: "disputed" }),
      rec({ status: "superseded" }),
      rec({ status: "unverified" }),
    ])).toBeNull();
  });

  it("missing verified revenue -> floor-only cap, provenance 'none', explicit warning (never a guessed figure)", () => {
    const r = computeSection48Penalty({ isDcpmi: true, verifiedRevenue: null, revenueSource: "none", factors: NEUTRAL_FACTORS });
    expect(r.revenueSource).toBe("none");
    expect(r.verifiedRevenue).toBeNull();
    expect(r.statutoryCap).toBe(DCPMI_FLOOR_NGN);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("negative or non-finite revenue is treated as unverified", () => {
    const r = computeSection48Penalty({ isDcpmi: false, verifiedRevenue: -5, revenueSource: "firs", factors: NEUTRAL_FACTORS });
    expect(r.revenueSource).toBe("none");
    expect(r.statutoryCap).toBe(NON_MAJOR_FLOOR_NGN);
  });
});
