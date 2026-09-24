/**
 * Cross-border transfer declaration validation — PURE LOGIC (NDPA 2023 ss.41-43)
 * =============================================================================
 * Decision logic for validating a transfer declaration's legal basis against
 * the adequacy / BCR / SCC registries (0030) and the destination risk
 * register (0089). Pure functions only — no DB access — so the full
 * basis/registry matrix is unit-testable. The router gathers a
 * RegistrySnapshot via defensive SQL and passes it here.
 *
 * Governing rules:
 *  - legal_basis = none_claimed  -> ALWAYS non-compliant + enforcement referral
 *  - adequacy_decision basis     -> requires an IN-FORCE adequacy decision row;
 *    missing/proposed/suspended/revoked rows are treated as NO valid safeguard
 *  - bcr basis                   -> requires an APPROVED BCR for the organisation
 *  - scc basis                   -> requires an ACTIVE SCC registration row
 *  - derogation-type bases (derogation, explicit_consent, contract_performance,
 *    vital_interest) are lawful in principle (NDPA s.43) but flagged for review
 *    when the destination lacks adequacy
 *  - "declares no transfers" attestations skip basis validation (contradiction
 *    detection against scan evidence is handled by transferAnomaly.ts)
 */

export const LEGAL_BASES = [
  "adequacy_decision",
  "bcr",
  "scc",
  "derogation",
  "explicit_consent",
  "contract_performance",
  "vital_interest",
  "none_claimed",
] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];

export const ADEQUACY_REGISTER_STATUSES = ["adequate", "partial", "none", "under_review"] as const;
export type DestinationAdequacyStatus = (typeof ADEQUACY_REGISTER_STATUSES)[number];

/** Registry facts gathered by the caller via defensive SQL. `null` = no row found. */
export interface RegistrySnapshot {
  /** Status of the best-matching adequacy_decisions row for the destination (0030). */
  adequacyDecisionStatus: "proposed" | "in_force" | "suspended" | "revoked" | null;
  adequacyDecisionId: number | null;
  /** Status of the organisation's best-matching binding_corporate_rules row (0030). */
  bcrStatus: "draft" | "submitted" | "under_review" | "approved" | "rejected" | "withdrawn" | null;
  /** TRUE only when an active SCC registry row exists; FALSE when row/table missing. */
  sccRegistrationActive: boolean;
  /** destination_risk_register row for the destination (0089). */
  destinationAdequacyStatus: DestinationAdequacyStatus | null;
}

export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingType = "none_claimed" | "no_valid_safeguard" | "manual";

export interface ValidationFinding {
  findingType: FindingType;
  severity: FindingSeverity;
  code: string;
  message: string;
  enforcementReferral: boolean;
}

export interface ValidationOutcome {
  compliant: boolean;
  complianceStatus: "compliant" | "non_compliant" | "pending_review";
  adequacyDecisionId: number | null;
  findings: ValidationFinding[];
}

const DEROGATION_BASES: ReadonlySet<LegalBasis> = new Set<LegalBasis>([
  "derogation",
  "explicit_consent",
  "contract_performance",
  "vital_interest",
]);

export function validateDeclarationBasis(input: {
  legalBasis: LegalBasis;
  destinationCountry: string;
  declaresNoTransfers: boolean;
  registry: RegistrySnapshot;
}): ValidationOutcome {
  const { legalBasis, destinationCountry, declaresNoTransfers, registry } = input;
  const findings: ValidationFinding[] = [];
  let adequacyDecisionId: number | null = null;

  // Zero-transfer attestation: no basis to validate; contradiction detection
  // against scan_findings is performed asynchronously by transferAnomaly.
  if (declaresNoTransfers) {
    return { compliant: true, complianceStatus: "pending_review", adequacyDecisionId: null, findings };
  }

  if (legalBasis === "none_claimed") {
    findings.push({
      findingType: "none_claimed",
      severity: "critical",
      code: "NONE_CLAIMED",
      message: `Declaration for transfers to "${destinationCountry}" claims no legal basis (NDPA 2023 ss.41-43). Automatic non-compliance and enforcement referral.`,
      enforcementReferral: true,
    });
    return { compliant: false, complianceStatus: "non_compliant", adequacyDecisionId: null, findings };
  }

  if (legalBasis === "adequacy_decision") {
    if (registry.adequacyDecisionStatus === "in_force" && registry.adequacyDecisionId != null) {
      adequacyDecisionId = registry.adequacyDecisionId;
    } else {
      const why =
        registry.adequacyDecisionStatus == null
          ? "no adequacy decision exists for the destination"
          : `the adequacy decision is "${registry.adequacyDecisionStatus}" (only "in_force" is a valid safeguard)`;
      findings.push({
        findingType: "no_valid_safeguard",
        severity: "critical",
        code: "ADEQUACY_NOT_IN_FORCE",
        message: `Basis "adequacy_decision" invalid for "${destinationCountry}": ${why}.`,
        enforcementReferral: true,
      });
    }
  }

  if (legalBasis === "bcr") {
    if (registry.bcrStatus !== "approved") {
      const why =
        registry.bcrStatus == null
          ? "no binding corporate rules registered for the organisation"
          : `the organisation's BCR status is "${registry.bcrStatus}" (only "approved" is a valid safeguard)`;
      findings.push({
        findingType: "no_valid_safeguard",
        severity: "critical",
        code: "BCR_NOT_APPROVED",
        message: `Basis "bcr" invalid for "${destinationCountry}": ${why}.`,
        enforcementReferral: true,
      });
    }
  }

  if (legalBasis === "scc") {
    if (!registry.sccRegistrationActive) {
      findings.push({
        findingType: "no_valid_safeguard",
        severity: "critical",
        code: "SCC_NOT_REGISTERED",
        message: `Basis "scc" invalid for "${destinationCountry}": no active standard contractual clauses registration found in the registry.`,
        enforcementReferral: true,
      });
    }
  }

  if (DEROGATION_BASES.has(legalBasis)) {
    // Lawful-in-principle derogations (NDPA s.43) — flag for officer review when
    // the destination has no adequacy standing in the risk register.
    const destStatus = registry.destinationAdequacyStatus;
    if (destStatus == null || destStatus === "none" || destStatus === "under_review") {
      findings.push({
        findingType: "manual",
        severity: "medium",
        code: "DEROGATION_REVIEW",
        message: `Derogation-type basis "${legalBasis}" relied upon for "${destinationCountry}" (register status: ${destStatus ?? "not registered"}). Requires officer review of the derogation record (NDPA s.43).`,
        enforcementReferral: false,
      });
    }
    // Derogation + in-force adequacy at destination: derogation unnecessary but lawful.
    if (registry.adequacyDecisionStatus === "in_force") {
      adequacyDecisionId = registry.adequacyDecisionId;
    }
  }

  // Cross-check: basis claims adequacy but the risk register says otherwise.
  if (
    legalBasis === "adequacy_decision" &&
    (registry.destinationAdequacyStatus === "none" || registry.destinationAdequacyStatus === "under_review") &&
    registry.adequacyDecisionStatus !== "in_force"
  ) {
    findings.push({
      findingType: "no_valid_safeguard",
      severity: "high",
      code: "DESTINATION_NO_ADEQUACY",
      message: `Destination risk register records "${destinationCountry}" as "${registry.destinationAdequacyStatus}" — no valid safeguard can be established.`,
      enforcementReferral: true,
    });
  }

  const blocking = findings.some((f) => f.findingType !== "manual");
  return {
    compliant: !blocking,
    complianceStatus: blocking ? "non_compliant" : findings.length > 0 ? "pending_review" : "compliant",
    adequacyDecisionId,
    findings,
  };
}

/** Bands used for subject counts / volumes; ordering matters for z-score trends. */
export const SUBJECT_COUNT_BANDS = [
  "band_0_100",
  "band_101_1000",
  "band_1001_10000",
  "band_10001_100000",
  "band_100000_plus",
] as const;
export const VOLUME_BANDS = ["vol_small", "vol_medium", "vol_large", "vol_very_large"] as const;

/** Numeric midpoints used to turn bands into a trend series for anomaly detection. */
export const SUBJECT_BAND_MIDPOINTS: Record<string, number> = {
  band_0_100: 50,
  band_101_1000: 550,
  band_1001_10000: 5500,
  band_10001_100000: 55000,
  band_100000_plus: 500000,
};
export const VOLUME_BAND_MIDPOINTS_GB: Record<string, number> = {
  vol_small: 1,
  vol_medium: 50,
  vol_large: 500,
  vol_very_large: 5000,
};
