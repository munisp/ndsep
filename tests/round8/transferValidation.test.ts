/**
 * Round 8 — transfer declaration validation matrix (NDPA 2023 ss.41-43)
 * Pure-logic tests: no DB. Covers every legal_basis x registry-state
 * combination plus the anomaly-detection pure functions.
 */
import { describe, it, expect } from "vitest";
import {
  validateDeclarationBasis,
  LEGAL_BASES,
  type RegistrySnapshot,
} from "../../server/services/transferValidation";
import {
  detectZScoreOutliers,
  evaluateContradiction,
  mean,
  stdDev,
} from "../../server/services/transferAnomaly";

const baseRegistry: RegistrySnapshot = {
  adequacyDecisionStatus: null,
  adequacyDecisionId: null,
  bcrStatus: null,
  sccRegistrationActive: false,
  destinationAdequacyStatus: null,
};

function snap(overrides: Partial<RegistrySnapshot>): RegistrySnapshot {
  return { ...baseRegistry, ...overrides };
}

describe("validateDeclarationBasis — none_claimed", () => {
  it("is always non-compliant with an enforcement referral, even with in-force adequacy", () => {
    const out = validateDeclarationBasis({
      legalBasis: "none_claimed",
      destinationCountry: "United Kingdom",
      declaresNoTransfers: false,
      registry: snap({ adequacyDecisionStatus: "in_force", adequacyDecisionId: 7, destinationAdequacyStatus: "adequate" }),
    });
    expect(out.compliant).toBe(false);
    expect(out.complianceStatus).toBe("non_compliant");
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].findingType).toBe("none_claimed");
    expect(out.findings[0].severity).toBe("critical");
    expect(out.findings[0].enforcementReferral).toBe(true);
  });
});

describe("validateDeclarationBasis — adequacy_decision matrix", () => {
  it("compliant only when a decision is in_force", () => {
    const out = validateDeclarationBasis({
      legalBasis: "adequacy_decision",
      destinationCountry: "Ghana",
      declaresNoTransfers: false,
      registry: snap({ adequacyDecisionStatus: "in_force", adequacyDecisionId: 3, destinationAdequacyStatus: "partial" }),
    });
    expect(out.compliant).toBe(true);
    expect(out.complianceStatus).toBe("compliant");
    expect(out.adequacyDecisionId).toBe(3);
    expect(out.findings).toHaveLength(0);
  });

  it.each(["proposed", "suspended", "revoked"] as const)(
    "non-compliant when the decision is %s (missing rows are never assumed valid)",
    (status) => {
      const out = validateDeclarationBasis({
        legalBasis: "adequacy_decision",
        destinationCountry: "Ghana",
        declaresNoTransfers: false,
        registry: snap({ adequacyDecisionStatus: status, adequacyDecisionId: 3 }),
      });
      expect(out.compliant).toBe(false);
      expect(out.findings.some((f) => f.code === "ADEQUACY_NOT_IN_FORCE" && f.enforcementReferral)).toBe(true);
    }
  );

  it("non-compliant when NO adequacy row exists for the destination", () => {
    const out = validateDeclarationBasis({
      legalBasis: "adequacy_decision",
      destinationCountry: "Nowhereland",
      declaresNoTransfers: false,
      registry: baseRegistry,
    });
    expect(out.compliant).toBe(false);
    expect(out.complianceStatus).toBe("non_compliant");
    expect(out.findings[0].code).toBe("ADEQUACY_NOT_IN_FORCE");
  });

  it("adds a destination cross-check finding when the risk register says 'none'", () => {
    const out = validateDeclarationBasis({
      legalBasis: "adequacy_decision",
      destinationCountry: "United Arab Emirates",
      declaresNoTransfers: false,
      registry: snap({ destinationAdequacyStatus: "under_review" }),
    });
    const codes = out.findings.map((f) => f.code);
    expect(codes).toContain("ADEQUACY_NOT_IN_FORCE");
    expect(codes).toContain("DESTINATION_NO_ADEQUACY");
  });
});

describe("validateDeclarationBasis — bcr matrix", () => {
  it("compliant with an approved BCR", () => {
    const out = validateDeclarationBasis({
      legalBasis: "bcr",
      destinationCountry: "United States",
      declaresNoTransfers: false,
      registry: snap({ bcrStatus: "approved", destinationAdequacyStatus: "partial" }),
    });
    expect(out.compliant).toBe(true);
  });

  it.each(["draft", "submitted", "under_review", "rejected", "withdrawn"] as const)(
    "non-compliant when the org BCR is %s",
    (status) => {
      const out = validateDeclarationBasis({
        legalBasis: "bcr",
        destinationCountry: "United States",
        declaresNoTransfers: false,
        registry: snap({ bcrStatus: status }),
      });
      expect(out.compliant).toBe(false);
      expect(out.findings.some((f) => f.code === "BCR_NOT_APPROVED" && f.enforcementReferral)).toBe(true);
    }
  );

  it("non-compliant when the org has no BCR row at all", () => {
    const out = validateDeclarationBasis({
      legalBasis: "bcr",
      destinationCountry: "Kenya",
      declaresNoTransfers: false,
      registry: baseRegistry,
    });
    expect(out.compliant).toBe(false);
    expect(out.findings[0].code).toBe("BCR_NOT_APPROVED");
  });
});

describe("validateDeclarationBasis — scc matrix", () => {
  it("compliant only with an active SCC registration", () => {
    const ok = validateDeclarationBasis({
      legalBasis: "scc",
      destinationCountry: "United States",
      declaresNoTransfers: false,
      registry: snap({ sccRegistrationActive: true }),
    });
    expect(ok.compliant).toBe(true);
  });

  it("non-compliant when the SCC registry row (or table) is missing", () => {
    const out = validateDeclarationBasis({
      legalBasis: "scc",
      destinationCountry: "United States",
      declaresNoTransfers: false,
      registry: baseRegistry, // sccRegistrationActive: false
    });
    expect(out.compliant).toBe(false);
    expect(out.findings[0].code).toBe("SCC_NOT_REGISTERED");
    expect(out.findings[0].enforcementReferral).toBe(true);
  });
});

describe("validateDeclarationBasis — derogation-type bases", () => {
  it.each(["derogation", "explicit_consent", "contract_performance", "vital_interest"] as const)(
    "%s is lawful in principle but flagged for review when destination lacks adequacy",
    (basis) => {
      const out = validateDeclarationBasis({
        legalBasis: basis,
        destinationCountry: "United Arab Emirates",
        declaresNoTransfers: false,
        registry: snap({ destinationAdequacyStatus: "under_review" }),
      });
      expect(out.compliant).toBe(true); // no blocking finding
      expect(out.complianceStatus).toBe("pending_review");
      expect(out.findings).toHaveLength(1);
      expect(out.findings[0].code).toBe("DEROGATION_REVIEW");
      expect(out.findings[0].enforcementReferral).toBe(false);
    }
  );

  it("derogation to an adequate destination is fully compliant", () => {
    const out = validateDeclarationBasis({
      legalBasis: "explicit_consent",
      destinationCountry: "United Kingdom",
      declaresNoTransfers: false,
      registry: snap({ adequacyDecisionStatus: "in_force", adequacyDecisionId: 9, destinationAdequacyStatus: "adequate" }),
    });
    expect(out.compliant).toBe(true);
    expect(out.complianceStatus).toBe("compliant");
    expect(out.adequacyDecisionId).toBe(9);
  });
});

describe("validateDeclarationBasis — zero-transfer attestations", () => {
  it("skips basis validation (contradictions handled by anomaly detector)", () => {
    const out = validateDeclarationBasis({
      legalBasis: "none_claimed",
      destinationCountry: "United States",
      declaresNoTransfers: true,
      registry: baseRegistry,
    });
    expect(out.compliant).toBe(true);
    expect(out.complianceStatus).toBe("pending_review");
    expect(out.findings).toHaveLength(0);
  });
});

describe("legal basis enum coverage", () => {
  it("all eight mission-specified bases are present", () => {
    expect([...LEGAL_BASES].sort()).toEqual(
      [
        "adequacy_decision", "bcr", "scc", "derogation",
        "explicit_consent", "contract_performance", "vital_interest", "none_claimed",
      ].sort()
    );
  });
});

describe("anomaly detection — pure functions", () => {
  it("mean/stdDev are population statistics", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stdDev([2, 4, 6])).toBeCloseTo(Math.sqrt(8 / 3), 5);
    expect(stdDev([])).toBe(0);
  });

  it("flags a clear volume outlier by z-score", () => {
    const series = [
      { period: "2019", value: 100 },
      { period: "2020", value: 110 },
      { period: "2021", value: 105 },
      { period: "2022", value: 95 },
      { period: "2023", value: 108 },
      { period: "2024", value: 5000 },
    ];
    const outliers = detectZScoreOutliers(series, 2.0);
    expect(outliers).toHaveLength(1);
    expect(outliers[0].period).toBe("2024");
    expect(outliers[0].zScore).toBeGreaterThan(2.0);
  });

  it("does not flag with too few points or a flat series (no false positives)", () => {
    expect(detectZScoreOutliers([{ period: "2024", value: 99999 }], 2.5)).toHaveLength(0);
    const flat = Array.from({ length: 6 }, (_, i) => ({ period: `y${i}`, value: 100 }));
    expect(detectZScoreOutliers(flat, 2.5)).toHaveLength(0);
  });

  it("contradiction only when zero-transfer attestation meets tracker evidence", () => {
    expect(evaluateContradiction({ declaresNoTransfers: true, foreignTrackerEvidenceCount: 3 }).contradiction).toBe(true);
    expect(evaluateContradiction({ declaresNoTransfers: true, foreignTrackerEvidenceCount: 0 }).contradiction).toBe(false);
    expect(evaluateContradiction({ declaresNoTransfers: false, foreignTrackerEvidenceCount: 9 }).contradiction).toBe(false);
  });
});
