/**
 * NDSEP Universal Jurisdiction Configuration
 * ============================================
 * Makes all 18 compliance features country-agnostic.
 * Each jurisdiction defines its own:
 *   - Data protection law name and authority
 *   - Breach notification deadline (hours)
 *   - DPO appointment requirements
 *   - DPIA thresholds
 *   - Retention policy defaults
 *   - Cross-border transfer rules
 *   - Children's data age threshold
 *   - Consent requirements
 *
 * To add a new jurisdiction, add an entry to JURISDICTIONS below.
 * The active jurisdiction is set via JURISDICTION_CODE env var (default: "NG").
 */

export interface JurisdictionConfig {
  code: string;
  name: string;
  dataProtectionLaw: string;
  dataProtectionAuthority: string;
  authorityAcronym: string;
  breachNotificationHours: number;
  dpoRequired: boolean;
  dpoCertificationRequired: boolean;
  dpiaRequiredForHighRisk: boolean;
  ropaRequired: boolean;
  childrenDataAgeThreshold: number;
  consentWithdrawalDays: number;
  dataPortabilityDays: number;
  retentionPolicyRequired: boolean;
  crossBorderTransferRestricted: boolean;
  adequacyDecisionSupported: boolean;
  cookieConsentRequired: boolean;
  automatedDecisionTransparency: boolean;
  semiAnnualDpoReport: boolean;
  annualAuditReturn: boolean;
  penaltyCurrency: string;
  maxPenaltyPercentRevenue: number;
  maxPenaltyFixedAmount: number;
  locale: string;
  timezone: string;
}

export const JURISDICTIONS: Record<string, JurisdictionConfig> = {
  NG: {
    code: "NG",
    name: "Nigeria",
    dataProtectionLaw: "Nigeria Data Protection Act 2023 (NDPA)",
    dataProtectionAuthority: "Nigeria Data Protection Commission",
    authorityAcronym: "NDPC",
    breachNotificationHours: 72,
    dpoRequired: true,
    dpoCertificationRequired: true,
    dpiaRequiredForHighRisk: true,
    ropaRequired: true,
    childrenDataAgeThreshold: 18,
    consentWithdrawalDays: 30,
    dataPortabilityDays: 30,
    retentionPolicyRequired: true,
    crossBorderTransferRestricted: true,
    adequacyDecisionSupported: true,
    cookieConsentRequired: true,
    automatedDecisionTransparency: true,
    semiAnnualDpoReport: true,
    annualAuditReturn: true,
    penaltyCurrency: "NGN",
    maxPenaltyPercentRevenue: 2,
    maxPenaltyFixedAmount: 10_000_000,
    locale: "en-NG",
    timezone: "Africa/Lagos",
  },
  KE: {
    code: "KE",
    name: "Kenya",
    dataProtectionLaw: "Data Protection Act 2019",
    dataProtectionAuthority: "Office of the Data Protection Commissioner",
    authorityAcronym: "ODPC",
    breachNotificationHours: 72,
    dpoRequired: true,
    dpoCertificationRequired: false,
    dpiaRequiredForHighRisk: true,
    ropaRequired: true,
    childrenDataAgeThreshold: 18,
    consentWithdrawalDays: 30,
    dataPortabilityDays: 30,
    retentionPolicyRequired: true,
    crossBorderTransferRestricted: true,
    adequacyDecisionSupported: true,
    cookieConsentRequired: true,
    automatedDecisionTransparency: true,
    semiAnnualDpoReport: false,
    annualAuditReturn: true,
    penaltyCurrency: "KES",
    maxPenaltyPercentRevenue: 1,
    maxPenaltyFixedAmount: 5_000_000,
    locale: "en-KE",
    timezone: "Africa/Nairobi",
  },
  ZA: {
    code: "ZA",
    name: "South Africa",
    dataProtectionLaw: "Protection of Personal Information Act (POPIA)",
    dataProtectionAuthority: "Information Regulator",
    authorityAcronym: "IR",
    breachNotificationHours: 72,
    dpoRequired: true,
    dpoCertificationRequired: false,
    dpiaRequiredForHighRisk: true,
    ropaRequired: true,
    childrenDataAgeThreshold: 18,
    consentWithdrawalDays: 30,
    dataPortabilityDays: 30,
    retentionPolicyRequired: true,
    crossBorderTransferRestricted: true,
    adequacyDecisionSupported: true,
    cookieConsentRequired: true,
    automatedDecisionTransparency: true,
    semiAnnualDpoReport: false,
    annualAuditReturn: false,
    penaltyCurrency: "ZAR",
    maxPenaltyPercentRevenue: 0,
    maxPenaltyFixedAmount: 10_000_000,
    locale: "en-ZA",
    timezone: "Africa/Johannesburg",
  },
  GH: {
    code: "GH",
    name: "Ghana",
    dataProtectionLaw: "Data Protection Act 2012 (Act 843)",
    dataProtectionAuthority: "Data Protection Commission",
    authorityAcronym: "DPC",
    breachNotificationHours: 72,
    dpoRequired: true,
    dpoCertificationRequired: false,
    dpiaRequiredForHighRisk: true,
    ropaRequired: true,
    childrenDataAgeThreshold: 18,
    consentWithdrawalDays: 30,
    dataPortabilityDays: 30,
    retentionPolicyRequired: true,
    crossBorderTransferRestricted: true,
    adequacyDecisionSupported: false,
    cookieConsentRequired: true,
    automatedDecisionTransparency: false,
    semiAnnualDpoReport: false,
    annualAuditReturn: true,
    penaltyCurrency: "GHS",
    maxPenaltyPercentRevenue: 0,
    maxPenaltyFixedAmount: 36_000,
    locale: "en-GH",
    timezone: "Africa/Accra",
  },
  RW: {
    code: "RW",
    name: "Rwanda",
    dataProtectionLaw: "Law Relating to the Protection of Personal Data (2021)",
    dataProtectionAuthority: "National Cyber Security Authority",
    authorityAcronym: "NCSA",
    breachNotificationHours: 48,
    dpoRequired: true,
    dpoCertificationRequired: false,
    dpiaRequiredForHighRisk: true,
    ropaRequired: true,
    childrenDataAgeThreshold: 16,
    consentWithdrawalDays: 30,
    dataPortabilityDays: 30,
    retentionPolicyRequired: true,
    crossBorderTransferRestricted: true,
    adequacyDecisionSupported: true,
    cookieConsentRequired: true,
    automatedDecisionTransparency: true,
    semiAnnualDpoReport: false,
    annualAuditReturn: false,
    penaltyCurrency: "RWF",
    maxPenaltyPercentRevenue: 5,
    maxPenaltyFixedAmount: 5_000_000,
    locale: "en-RW",
    timezone: "Africa/Kigali",
  },
  EU: {
    code: "EU",
    name: "European Union",
    dataProtectionLaw: "General Data Protection Regulation (GDPR)",
    dataProtectionAuthority: "European Data Protection Board",
    authorityAcronym: "EDPB",
    breachNotificationHours: 72,
    dpoRequired: true,
    dpoCertificationRequired: false,
    dpiaRequiredForHighRisk: true,
    ropaRequired: true,
    childrenDataAgeThreshold: 16,
    consentWithdrawalDays: 30,
    dataPortabilityDays: 30,
    retentionPolicyRequired: true,
    crossBorderTransferRestricted: true,
    adequacyDecisionSupported: true,
    cookieConsentRequired: true,
    automatedDecisionTransparency: true,
    semiAnnualDpoReport: false,
    annualAuditReturn: false,
    penaltyCurrency: "EUR",
    maxPenaltyPercentRevenue: 4,
    maxPenaltyFixedAmount: 20_000_000,
    locale: "en-EU",
    timezone: "Europe/Brussels",
  },
  BR: {
    code: "BR",
    name: "Brazil",
    dataProtectionLaw: "Lei Geral de Protecao de Dados (LGPD)",
    dataProtectionAuthority: "Autoridade Nacional de Protecao de Dados",
    authorityAcronym: "ANPD",
    breachNotificationHours: 48,
    dpoRequired: true,
    dpoCertificationRequired: false,
    dpiaRequiredForHighRisk: true,
    ropaRequired: true,
    childrenDataAgeThreshold: 12,
    consentWithdrawalDays: 15,
    dataPortabilityDays: 15,
    retentionPolicyRequired: true,
    crossBorderTransferRestricted: true,
    adequacyDecisionSupported: true,
    cookieConsentRequired: true,
    automatedDecisionTransparency: true,
    semiAnnualDpoReport: false,
    annualAuditReturn: false,
    penaltyCurrency: "BRL",
    maxPenaltyPercentRevenue: 2,
    maxPenaltyFixedAmount: 50_000_000,
    locale: "pt-BR",
    timezone: "America/Sao_Paulo",
  },
};

const ACTIVE_JURISDICTION = process.env.JURISDICTION_CODE ?? "NG";

export function getJurisdiction(code?: string): JurisdictionConfig {
  const c = code ?? ACTIVE_JURISDICTION;
  return JURISDICTIONS[c] ?? JURISDICTIONS["NG"];
}

export function getActiveJurisdiction(): JurisdictionConfig {
  return getJurisdiction(ACTIVE_JURISDICTION);
}

export function listJurisdictions(): JurisdictionConfig[] {
  return Object.values(JURISDICTIONS);
}

export function isJurisdictionSupported(code: string): boolean {
  return code in JURISDICTIONS;
}
