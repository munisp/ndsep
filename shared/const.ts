export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

// ── NDSEP Platform Constants ──────────────────────────────────────────────────
export const PLATFORM_NAME = "National Data Sovereignty Enforcement Platform";
export const PLATFORM_ACRONYM = "NDSEP";
export const PLATFORM_VERSION = "5.0.0";
export const PLATFORM_JURISDICTION = "NG";

// ── Nigerian Data Protection Commission (NDPC) ────────────────────────────────
export const NDPC_AUTHORITY_NAME = "Nigeria Data Protection Commission";
export const NDPC_AUTHORITY_ACRONYM = "NDPC";
export const NDPC_WEBSITE = "https://ndpc.gov.ng";
export const NDPC_EMAIL = "info@ndpc.gov.ng";
export const NDPC_BREACH_NOTIFICATION_HOURS = 72;
export const NDPC_ANNUAL_AUDIT_RETURN_DEADLINE_MONTH = 3; // March
export const NDPC_ANNUAL_AUDIT_RETURN_DEADLINE_DAY = 31;

// ── NITDA (National Information Technology Development Agency) ────────────────
export const NITDA_AUTHORITY_NAME = "National Information Technology Development Agency";
export const NITDA_AUTHORITY_ACRONYM = "NITDA";
export const NITDA_WEBSITE = "https://nitda.gov.ng";
export const NITDA_EMAIL = "info@nitda.gov.ng";

// ── Nigerian Data Protection Act (NDPA) 2023 ─────────────────────────────────
export const NDPA_YEAR = 2023;
export const NDPA_FULL_TITLE = "Nigeria Data Protection Act 2023";
export const NDPA_CHILD_AGE_THRESHOLD = 13;
export const NDPA_DPO_REQUIRED_EMPLOYEE_THRESHOLD = 250;
export const NDPA_MAX_PENALTY_PERCENT_REVENUE = 2;
export const NDPA_MAX_PENALTY_FIXED_NGN = 10_000_000;

// ── Penalty & Enforcement ─────────────────────────────────────────────────────
export const PENALTY_CURRENCY = "NGN";
export const PENALTY_CURRENCY_SYMBOL = "₦";
export const PENALTY_APPEAL_WINDOW_DAYS = 30;
export const ENFORCEMENT_CASE_SLA_DAYS = 90;
export const REMEDIATION_DEADLINE_DAYS = 60;

// ── Data Residency & Cross-Border ─────────────────────────────────────────────
export const NIGERIA_ISO_CODE = "NG";
export const NIGERIA_COUNTRY_NAME = "Nigeria";
export const CROSS_BORDER_TRANSFER_RESTRICTED = true;
export const ADEQUACY_DECISION_SUPPORTED = true;

// ── Compliance Scoring ────────────────────────────────────────────────────────
export const COMPLIANCE_SCORE_GREEN_THRESHOLD = 80;
export const COMPLIANCE_SCORE_YELLOW_THRESHOLD = 60;
export const COMPLIANCE_SCORE_RED_THRESHOLD = 40;
export const NDPA_INDEX_WEIGHTS = {
  breachResolution: 0.20,
  breachNotification: 0.15,
  dpoAppointment: 0.15,
  dpiaCompletion: 0.15,
  consentCompliance: 0.10,
  trainingCompletion: 0.10,
  auditReturn: 0.10,
  privacyNotice: 0.05,
} as const;

// ── BGP & Network ─────────────────────────────────────────────────────────────
export const NIGERIA_ASN_RANGES = ["AS37148", "AS29465", "AS36873", "AS37282", "AS37076"];
export const BGP_ANOMALY_ALERT_THRESHOLD = 5;
export const NETWORK_EXFILTRATION_THRESHOLD_MBPS = 100;

// ── ML / AI Governance ────────────────────────────────────────────────────────
export const ML_RISK_SCORE_HIGH_THRESHOLD = 70;
export const ML_RISK_SCORE_MEDIUM_THRESHOLD = 50;
export const AI_GOVERNANCE_FRAMEWORK = "NDPA 2023 + ISO/IEC 42001";

// ── Streaming / Kafka ─────────────────────────────────────────────────────────
export const KAFKA_TOPIC_VIOLATIONS = "ndsep.violations";
export const KAFKA_TOPIC_PENALTIES = "ndsep.penalties";
export const KAFKA_TOPIC_ENFORCEMENT = "ndsep.enforcement";
export const KAFKA_TOPIC_CITIZEN_RIGHTS = "ndsep.citizen-rights";
export const KAFKA_TOPIC_AUDIT_TRAIL = "ndsep.audit-trail";
export const KAFKA_TOPIC_NETWORK_EVENTS = "ndsep.network-events";
export const KAFKA_TOPIC_BGP_ANOMALIES = "ndsep.bgp-anomalies";
export const KAFKA_TOPIC_BREACH_INCIDENTS = "ndsep.breach-incidents";

// ── Sector Codes (Nigerian Regulatory Sectors) ────────────────────────────────
export const REGULATED_SECTORS = [
  "banking", "fintech", "telecoms", "healthcare", "insurance",
  "government", "education", "ecommerce", "media", "energy",
  "transport", "manufacturing", "ngo", "legal", "real_estate",
] as const;
export type RegulatedSector = typeof REGULATED_SECTORS[number];

// ── Certificate & Portal ──────────────────────────────────────────────────────
export const CERTIFICATE_VALIDITY_DAYS = 365;
export const PORTAL_SUBMISSION_REVIEW_SLA_DAYS = 14;
export const CERTIFICATE_ISSUER = "NDSEP Compliance Authority";

// ── API Rate Limits ───────────────────────────────────────────────────────────
export const API_RATE_LIMIT_RPM = 1000;
export const API_RATE_LIMIT_BURST = 200;

// ── Pagination Defaults ───────────────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ── DPCO Kafka Topics ─────────────────────────────────────────────────────────
export const KAFKA_TOPIC_DPCO_AUDIT_EVENTS = "ndsep.dpco.audit.events";
export const KAFKA_TOPIC_DPCO_REGISTRY_EVENTS = "ndsep.dpco.registry.events";
export const KAFKA_TOPIC_DPCO_VERIFICATION_EVENTS = "ndsep.dpco.verification.events";
export const KAFKA_TOPIC_DPCO_ANALYTICS_EVENTS = "ndsep.dpco.analytics.events";
export const KAFKA_TOPIC_DPCO_NOTIFICATIONS_SENT = "ndsep.dpco.notifications.sent";

// ── DPCO Service Ports ────────────────────────────────────────────────────────
export const DPCO_AUDIT_SERVICE_PORT = 8300;
export const DPCO_REGISTRY_SERVICE_PORT = 8310;
export const DPCO_VERIFICATION_SERVICE_PORT = 8320;
export const DPCO_ANALYTICS_SERVICE_PORT = 8330;
export const DPCO_NOTIFICATION_SERVICE_PORT = 8340;

// ── DPCO NDPA Constants ───────────────────────────────────────────────────────
export const DPCO_CAR_DEADLINE_MONTH = 3;   // March
export const DPCO_CAR_DEADLINE_DAY = 31;    // 31 March each year
export const DPCO_LICENCE_RENEWAL_WARNING_DAYS = [30, 7, 1];
export const DPCO_AUDIT_SLA_HOURS = 72;     // 72h NDPC notification window (NDPA S.40)
export const DPCO_MIN_COMPLIANCE_SCORE = 70; // Minimum score for CAR acceptance
export const DPCO_SCORE_DROP_ALERT_THRESHOLD = 10; // Alert if score drops >10pts
export const DPCO_NDPC_REPO_URL = "https://services.ndpc.gov.ng/repo/?flp=dpco";
export const DPCO_NDPC_SUBMISSION_URL = "https://services.ndpc.gov.ng/portal/";
export const DPCO_TOTAL_LICENSED = 328; // As of NDPC registry (April 2026)
