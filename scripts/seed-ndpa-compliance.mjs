/**
 * NDPA Compliance Tables Seed Script
 * Seeds all 18 new NDPA compliance tables with realistic Nigerian demo data.
 * Uses the DATABASE_URL env var (PostgreSQL via Neon/Supabase).
 */
import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
const DB_URL = process.env.POSTGRES_URL || (process.env.DATABASE_URL || "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db");
const pool = new Pool({ connectionString: DB_URL, ssl: false });

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// Get existing org IDs
async function getOrgIds() {
  const res = await query("SELECT id FROM organizations ORDER BY id LIMIT 10");
  return res.rows.map(r => r.id);
}

async function getUserIds() {
  const res = await query("SELECT id FROM users ORDER BY id LIMIT 5");
  return res.rows.map(r => r.id);
}

// Nigerian names and data
const nigerianNames = [
  "Chukwuemeka Okonkwo", "Adaeze Nwosu", "Babatunde Adeyemi", "Ngozi Okafor",
  "Emeka Eze", "Fatima Aliyu", "Oluwaseun Adesanya", "Amaka Igwe",
  "Musa Abdullahi", "Chidinma Obi", "Tunde Bakare", "Yetunde Fashola",
  "Ikenna Nwachukwu", "Hauwa Garba", "Segun Adeleke"
];
const nigerianEmails = nigerianNames.map(n => n.toLowerCase().replace(/ /g, ".") + "@example.ng");
const nigerianPhones = ["+2348012345678", "+2348023456789", "+2348034567890", "+2348045678901", "+2348056789012"];

const purposes = [
  "Customer identity verification under CBN KYC guidelines",
  "Health insurance claims processing and medical records management",
  "Telecom subscriber registration per NCC directive",
  "Government employee payroll and pension management",
  "Credit scoring and loan eligibility assessment",
  "Anti-money laundering transaction monitoring",
  "Patient consent for clinical data sharing with research institutions",
  "Marketing communications for financial products",
  "Cross-border remittance processing",
  "Tax compliance reporting to FIRS"
];

const dataCategories = [
  ["NIN", "BVN", "passport_number"],
  ["medical_records", "health_insurance_id"],
  ["phone_number", "sim_registration_data"],
  ["salary_data", "bank_account", "pension_id"],
  ["credit_history", "financial_statements"],
  ["transaction_records", "account_balance"],
  ["biometric_data", "genetic_data"],
  ["email", "phone_number", "address"],
  ["bank_account", "swift_code"],
  ["tax_id", "income_data"]
];

const now = new Date();
const ago = (days) => new Date(now - days * 86400000);
const future = (days) => new Date(now.getTime() + days * 86400000);

async function seedConsentRecords(orgIds) {
  console.log("Seeding consent_records...");
  const lawfulBases = ["consent", "contract", "legal_obligation", "vital_interest", "public_interest", "legitimate_interest"];
  const statuses = ["active", "withdrawn", "expired"];
  for (let i = 0; i < 20; i++) {
    const orgId = orgIds[i % orgIds.length];
    const name = nigerianNames[i % nigerianNames.length];
    const email = `${name.toLowerCase().replace(/ /g, ".")}${i}@example.ng`;
    const status = statuses[i % statuses.length];
    const givenAt = ago(Math.floor(Math.random() * 365));
    await query(`
      INSERT INTO consent_records (organization_id, data_subject_name, data_subject_email,
        data_subject_nin, purpose, lawful_basis, consent_status, consent_given_at,
        consent_withdrawn_at, expires_at, data_categories, third_party_sharing, cross_border_transfer)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT DO NOTHING
    `, [
      orgId, name, email,
      `NIN${String(i).padStart(11, "0")}`,
      purposes[i % purposes.length],
      lawfulBases[i % lawfulBases.length],
      status, givenAt,
      status === "withdrawn" ? ago(Math.floor(Math.random() * 30)) : null,
      status === "expired" ? ago(10) : future(365),
      JSON.stringify(dataCategories[i % dataCategories.length]),
      i % 3 === 0, i % 5 === 0
    ]);
  }
  console.log("  ✓ 20 consent records");
}

async function seedBreachIncidents(orgIds, userIds) {
  console.log("Seeding breach_incidents...");
  const severities = ["low", "medium", "high", "critical"];
  const statuses = ["detected", "assessing", "ndpc_notified", "individuals_notified", "contained", "resolved"];
  const titles = [
    "Unauthorised access to customer BVN database",
    "Ransomware attack on patient records server",
    "Phishing campaign targeting employee credentials",
    "Accidental exposure of subscriber PII via API misconfiguration",
    "Insider threat: data exfiltration by departing employee",
    "SQL injection attack on loan application portal",
    "Lost encrypted backup tape containing financial records",
    "Third-party processor data breach affecting shared customers"
  ];
  for (let i = 0; i < 8; i++) {
    const orgId = orgIds[i % orgIds.length];
    const detectedAt = ago(Math.floor(Math.random() * 180));
    const deadline = new Date(detectedAt.getTime() + 72 * 3600000); // 72h NDPA deadline
    const sev = severities[i % severities.length];
    const status = statuses[i % statuses.length];
    await query(`
      INSERT INTO breach_incidents (organization_id, title, description, breach_incident_severity, breach_incident_status,
        detected_at, ndpc_notification_deadline, ndpc_notified_at, individuals_notified_at,
        contained_at, resolved_at, affected_individuals_count, data_types_affected,
        breach_cause, remediation_actions, reported_by, ndpc_reference_number)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT DO NOTHING
    `, [
      orgId, titles[i], `Detailed investigation report for: ${titles[i]}`,
      sev, status, detectedAt, deadline,
      ["ndpc_notified","individuals_notified","contained","resolved"].includes(status) ? new Date(detectedAt.getTime() + 48 * 3600000) : null,
      ["individuals_notified","contained","resolved"].includes(status) ? new Date(detectedAt.getTime() + 96 * 3600000) : null,
      ["contained","resolved"].includes(status) ? ago(Math.floor(Math.random() * 30)) : null,
      status === "resolved" ? ago(Math.floor(Math.random() * 14)) : null,
      Math.floor(Math.random() * 50000) + 100,
      JSON.stringify(dataCategories[i % dataCategories.length]),
      "System vulnerability exploited via unpatched software",
      "Patched vulnerability, reset credentials, notified affected users, engaged forensics team",
      userIds.length > 0 ? userIds[0] : null,
      `NDPC/BR/${2024 + (i % 2)}/${String(i + 1).padStart(4, "0")}`
    ]);
  }
  console.log("  ✓ 8 breach incidents");
}

async function seedDpoAppointments(orgIds) {
  console.log("Seeding dpo_appointments...");
  const dpoNames = [
    "Dr. Adaeze Nwosu", "Barr. Emeka Okafor", "Mrs. Fatima Bello",
    "Mr. Chukwudi Eze", "Dr. Ngozi Adeleke", "Barr. Tunde Fashola"
  ];
  const statuses = ["pending", "verified", "expired", "suspended"];
  for (let i = 0; i < Math.min(orgIds.length, 6); i++) {
    await query(`
      INSERT INTO dpo_appointments (organization_id, dpo_name, dpo_email, dpo_phone,
        appointed_at, credential_status, dpco_id, dpco_name, certification_expires_at,
        last_report_submitted_at, independence_verified, training_hours_completed, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT DO NOTHING
    `, [
      orgIds[i], dpoNames[i],
      dpoNames[i].toLowerCase().replace(/[^a-z]/g, ".").replace(/\.+/g, ".") + "@dpo.ng",
      nigerianPhones[i % nigerianPhones.length],
      ago(Math.floor(Math.random() * 730)),
      statuses[i % statuses.length],
      `DPCO-NG-${String(i + 1).padStart(4, "0")}`,
      `Data Protection Compliance Organisation ${i + 1} Ltd`,
      future(365 + Math.floor(Math.random() * 365)),
      ago(Math.floor(Math.random() * 180)),
      i % 2 === 0,
      Math.floor(Math.random() * 40) + 10,
      true
    ]);
  }
  console.log(`  ✓ ${Math.min(orgIds.length, 6)} DPO appointments`);
}

async function seedDpiaAssessments(orgIds, userIds) {
  console.log("Seeding dpia_assessments...");
  const titles = [
    "DPIA: Customer Biometric Authentication System",
    "DPIA: AI-Powered Credit Scoring Engine",
    "DPIA: Cross-Border Patient Data Sharing Platform",
    "DPIA: Employee Monitoring and Productivity Tracking",
    "DPIA: National ID Verification API Integration",
    "DPIA: Automated Fraud Detection System",
    "DPIA: Telecom Subscriber Profiling for Marketing",
    "DPIA: Health Insurance Claims Automation"
  ];
  const statuses = ["draft", "in_progress", "review", "approved", "rejected"];
  const risks = ["low", "medium", "high", "critical"];
  for (let i = 0; i < 8; i++) {
    const orgId = orgIds[i % orgIds.length];
    await query(`
      INSERT INTO dpia_assessments (organization_id, title, processing_description,
        trigger_category, dpia_status, dpia_risk_level, data_categories,
        purpose_of_processing, necessity_assessment, risk_assessment,
        mitigation_measures, ndpc_consultation_required, reviewed_by, next_review_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT DO NOTHING
    `, [
      orgId, titles[i],
      `Processing of personal data for ${titles[i].replace("DPIA: ", "")} involving systematic collection of sensitive data from Nigerian residents.`,
      ["systematic_monitoring", "large_scale_processing", "sensitive_data", "automated_decisions"][i % 4],
      statuses[i % statuses.length],
      risks[i % risks.length],
      JSON.stringify(dataCategories[i % dataCategories.length]),
      purposes[i % purposes.length],
      "Processing is necessary and proportionate to the stated purpose under NDPA Section 25.",
      `Risk level: ${risks[i % risks.length]}. Key risks include data breach, unauthorised access, and cross-border transfer violations.`,
      "Implement end-to-end encryption, access controls, regular audits, and staff training.",
      i % 3 === 0,
      userIds.length > 0 ? userIds[0] : null,
      future(365)
    ]);
  }
  console.log("  ✓ 8 DPIA assessments");
}

async function seedRopaRecords(orgIds) {
  console.log("Seeding ropa_records...");
  const activities = [
    "Customer onboarding and KYC verification",
    "Payroll processing and salary disbursement",
    "Health insurance claims management",
    "Telecom subscriber registration",
    "Anti-money laundering transaction monitoring",
    "Credit risk assessment and loan processing",
    "Employee performance management",
    "Marketing and customer communications",
    "Tax reporting and FIRS compliance",
    "Pension fund management"
  ];
  const lawfulBases = ["consent", "contract", "legal_obligation", "legitimate_interest"];
  for (let i = 0; i < 10; i++) {
    const orgId = orgIds[i % orgIds.length];
    await query(`
      INSERT INTO ropa_records (organization_id, processing_activity_name, purpose,
        ropa_lawful_basis, data_categories, data_subject_categories, recipients,
        cross_border_transfers, transfer_destinations, retention_period_days,
        security_measures, dpia_required, dpo_reviewed, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT DO NOTHING
    `, [
      orgId, activities[i], purposes[i % purposes.length],
      lawfulBases[i % lawfulBases.length],
      JSON.stringify(dataCategories[i % dataCategories.length]),
      JSON.stringify(["customers", "employees", "contractors"][i % 3] === "customers" ? ["Nigerian residents", "corporate clients"] : ["staff", "contractors"]),
      JSON.stringify(["NDPC", "CBN", "NCC", "FIRS"][i % 4] ? [["NDPC", "CBN", "NCC", "FIRS"][i % 4]] : []),
      i % 4 === 0,
      i % 4 === 0 ? JSON.stringify(["UK", "EU", "US"][i % 3] ? [["UK", "EU", "US"][i % 3]] : []) : JSON.stringify([]),
      [365, 730, 1825, 2555, 3650][i % 5],
      "AES-256 encryption at rest, TLS 1.3 in transit, role-based access control, regular penetration testing",
      i % 3 === 0, i % 2 === 0, true
    ]);
  }
  console.log("  ✓ 10 ROPA records");
}

async function seedRetentionPolicies(orgIds) {
  console.log("Seeding retention_policies...");
  const policies = [
    { name: "Customer KYC Records", dataCategory: "identity_documents", days: 3650, basis: "CBN KYC regulations require 10-year retention" },
    { name: "Transaction Records", dataCategory: "financial_transactions", days: 2555, basis: "FIRS requires 7-year financial record retention" },
    { name: "Employee HR Records", dataCategory: "employment_records", days: 1825, basis: "Labour Act Section 91 — 5-year post-employment" },
    { name: "Health Records", dataCategory: "medical_records", days: 3650, basis: "Medical and Dental Practitioners Act — 10 years" },
    { name: "Audit Logs", dataCategory: "system_logs", days: 2555, basis: "NDPA Article 26 — 7-year audit trail" },
    { name: "Marketing Consent Records", dataCategory: "consent_records", days: 1095, basis: "NDPA consent withdrawal evidence — 3 years" },
    { name: "CCTV Footage", dataCategory: "biometric_data", days: 30, basis: "NDPC guidance — 30-day CCTV retention" },
    { name: "Cookie Consent Logs", dataCategory: "web_analytics", days: 365, basis: "NDPA cookie compliance — 1-year log retention" }
  ];
  for (let i = 0; i < policies.length; i++) {
    const p = policies[i];
    const isGlobal = i < 4;
    await query(`
      INSERT INTO retention_policies (organization_id, name, data_category, retention_period_days,
        archival_action, legal_basis, is_global, is_active, next_execution_at, records_affected)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT DO NOTHING
    `, [
      isGlobal ? null : orgIds[i % orgIds.length],
      p.name, p.dataCategory, p.days,
      i % 3 === 0 ? "archive" : "delete",
      p.basis, isGlobal, true,
      future(30 + Math.floor(Math.random() * 60)),
      Math.floor(Math.random() * 100000) + 1000
    ]);
  }
  console.log("  ✓ 8 retention policies");
}

async function seedDpoReports(orgIds) {
  console.log("Seeding dpo_reports...");
  const statuses = ["draft", "submitted", "verified", "rejected"];
  for (let i = 0; i < Math.min(orgIds.length, 6); i++) {
    const periodStart = ago(180);
    const periodEnd = ago(1);
    await query(`
      INSERT INTO dpo_reports (organization_id, report_period_start, report_period_end,
        dpo_report_status, privacy_notices_review, data_processing_categories,
        lawful_bases_review, dpia_review, rights_exercise_review, complaint_handling,
        security_measures_review, submitted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT DO NOTHING
    `, [
      orgIds[i], periodStart, periodEnd, statuses[i % statuses.length],
      "All privacy notices reviewed and updated to reflect NDPA 2023 requirements. 3 notices updated.",
      "Organisation processes 12 categories of personal data including financial, health, and biometric data.",
      "Consent: 45%, Contract: 30%, Legal Obligation: 20%, Legitimate Interests: 5%",
      "2 DPIAs completed this period. 1 high-risk processing activity identified requiring NDPC consultation.",
      "47 data subject requests received: 32 access, 8 erasure, 7 portability. All resolved within 30 days.",
      "3 complaints received and resolved. 1 escalated to NDPC. No formal investigations opened.",
      "Penetration testing completed Q2. 2 critical vulnerabilities patched. ISO 27001 audit passed.",
      statuses[i % statuses.length] !== "draft" ? ago(Math.floor(Math.random() * 30)) : null
    ]);
  }
  console.log(`  ✓ ${Math.min(orgIds.length, 6)} DPO reports`);
}

async function seedComplianceAuditReturns(orgIds, userIds) {
  console.log("Seeding compliance_audit_returns...");
  const statuses = ["draft", "submitted", "under_review", "accepted", "rejected"];
  for (let i = 0; i < Math.min(orgIds.length, 6); i++) {
    const periodStart = ago(365);
    const periodEnd = ago(1);
    const score = 55 + Math.floor(Math.random() * 40);
    await query(`
      INSERT INTO compliance_audit_returns (organization_id, audit_period_start, audit_period_end,
        car_status, dpco_id, dpco_name, compliance_score, findings_summary,
        non_conformities, corrective_actions, data_protection_policies_review,
        security_measures_assessment, staff_training_assessment, submitted_at, reviewed_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT DO NOTHING
    `, [
      orgIds[i], periodStart, periodEnd, statuses[i % statuses.length],
      `DPCO-NG-${String(i + 1).padStart(4, "0")}`,
      `Data Protection Compliance Organisation ${i + 1} Ltd`,
      score,
      `Annual compliance audit for FY2024. Overall score: ${score}/100. ${score >= 75 ? "Satisfactory" : "Requires improvement"}.`,
      JSON.stringify(score < 75 ? ["Incomplete DPIA for high-risk processing", "Staff training overdue for 23% of staff"] : []),
      JSON.stringify(score < 75 ? ["Complete outstanding DPIAs by Q1 2025", "Schedule mandatory training for all staff"] : []),
      "Data protection policies reviewed and updated. Privacy by design principles embedded in 8 of 12 systems.",
      "ISO 27001 certification maintained. Annual penetration test completed. 2 medium vulnerabilities remediated.",
      `${score >= 75 ? "95" : "72"}% of staff completed mandatory data protection training.`,
      statuses[i % statuses.length] !== "draft" ? ago(Math.floor(Math.random() * 90)) : null,
      userIds.length > 0 ? userIds[0] : null
    ]);
  }
  console.log(`  ✓ ${Math.min(orgIds.length, 6)} compliance audit returns`);
}

async function seedAdequacyDeterminations() {
  console.log("Seeding adequacy_determinations...");
  const countries = [
    { code: "GB", name: "United Kingdom", status: "adequate", law: "UK GDPR / Data Protection Act 2018", authority: "Information Commissioner's Office (ICO)" },
    { code: "EU", name: "European Union", status: "adequate", law: "GDPR (Regulation 2016/679)", authority: "European Data Protection Board (EDPB)" },
    { code: "GH", name: "Ghana", status: "adequate", law: "Data Protection Act 2012 (Act 843)", authority: "Data Protection Commission" },
    { code: "KE", name: "Kenya", status: "partially_adequate", law: "Data Protection Act 2019", authority: "Office of the Data Protection Commissioner" },
    { code: "ZA", name: "South Africa", status: "adequate", law: "Protection of Personal Information Act (POPIA)", authority: "Information Regulator" },
    { code: "US", name: "United States", status: "not_adequate", law: "Sectoral (HIPAA, CCPA, etc.)", authority: "FTC / State AGs" },
    { code: "CN", name: "China", status: "not_adequate", law: "Personal Information Protection Law (PIPL)", authority: "Cyberspace Administration of China" },
    { code: "IN", name: "India", status: "under_review", law: "Digital Personal Data Protection Act 2023", authority: "Data Protection Board of India" },
    { code: "AE", name: "United Arab Emirates", status: "partially_adequate", law: "Federal Decree-Law No. 45 of 2021", authority: "UAE Data Office" },
    { code: "RW", name: "Rwanda", status: "adequate", law: "Law No. 058/2021 on Data Protection", authority: "Rwanda Utilities Regulatory Authority" }
  ];
  for (const c of countries) {
    await query(`
      INSERT INTO adequacy_determinations (country_code, country_name, adequacy_status,
        data_protection_law, supervisory_authority, assessment_date, expires_at,
        notes, requires_additional_safeguards, approved_transfer_instruments)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (country_code) DO UPDATE SET
        adequacy_status = EXCLUDED.adequacy_status, updated_at = NOW()
    `, [
      c.code, c.name, c.status, c.law, c.authority,
      ago(Math.floor(Math.random() * 365)),
      future(365 + Math.floor(Math.random() * 730)),
      `NDPC adequacy assessment for ${c.name}. ${c.status === "adequate" ? "Full adequacy granted." : c.status === "partially_adequate" ? "Partial adequacy with conditions." : "No adequacy — additional safeguards required."}`,
      c.status !== "adequate",
      JSON.stringify(c.status !== "adequate" ? ["scc", "bcr"] : ["scc"])
    ]);
  }
  console.log("  ✓ 10 adequacy determinations");
}

async function seedDataProcessingAgreements(orgIds, userIds) {
  console.log("Seeding data_processing_agreements...");
  const processors = [
    { name: "AWS Nigeria (Amazon Web Services)", country: "Nigeria" },
    { name: "Microsoft Azure West Africa", country: "Nigeria" },
    { name: "Interswitch Group Ltd", country: "Nigeria" },
    { name: "Flutterwave Technology Ltd", country: "Nigeria" },
    { name: "Paystack Payments Ltd", country: "Nigeria" },
    { name: "Salesforce Inc", country: "United States" },
    { name: "Google Cloud EMEA Ltd", country: "Ireland" },
    { name: "SAP SE", country: "Germany" }
  ];
  const statuses = ["draft", "active", "expired", "under_review"];
  for (let i = 0; i < 8; i++) {
    const orgId = orgIds[i % orgIds.length];
    const p = processors[i];
    await query(`
      INSERT INTO data_processing_agreements (organization_id, processor_name, processor_country,
        dpa_status, agreement_date, expiry_date, processing_purpose, data_categories,
        sub_processors, security_measures, breach_notification_clause, cross_border_transfer,
        audit_rights, reviewed_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT DO NOTHING
    `, [
      orgId, p.name, p.country, statuses[i % statuses.length],
      ago(Math.floor(Math.random() * 365)),
      future(365 + Math.floor(Math.random() * 365)),
      purposes[i % purposes.length],
      JSON.stringify(dataCategories[i % dataCategories.length]),
      JSON.stringify(i % 2 === 0 ? ["Sub-processor A", "Sub-processor B"] : []),
      "ISO 27001 certified. SOC 2 Type II audited. Encryption at rest and in transit.",
      true, p.country !== "Nigeria", true,
      userIds.length > 0 ? userIds[0] : null
    ]);
  }
  console.log("  ✓ 8 data processing agreements");
}

async function seedPrivacyNotices(orgIds, userIds) {
  console.log("Seeding privacy_notices...");
  const types = ["general", "employee", "cookie", "marketing", "children"];
  const statuses = ["draft", "active", "archived"];
  for (let i = 0; i < Math.min(orgIds.length * 2, 10); i++) {
    const orgId = orgIds[i % orgIds.length];
    await query(`
      INSERT INTO privacy_notices (organization_id, title, version, privacy_notice_status,
        notice_type, content, purposes_of_processing, lawful_bases, data_retention_info,
        rights_info, cross_border_info, published_at, effective_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT DO NOTHING
    `, [
      orgId,
      `Privacy Notice — ${types[i % types.length].charAt(0).toUpperCase() + types[i % types.length].slice(1)} (v${Math.floor(i / 5) + 1}.0)`,
      `${Math.floor(i / 5) + 1}.0`,
      statuses[i % statuses.length],
      types[i % types.length],
      `This Privacy Notice explains how we collect, use, and protect your personal data in accordance with the Nigeria Data Protection Act 2023 (NDPA). We are committed to protecting your privacy and ensuring transparent data processing.`,
      JSON.stringify(dataCategories[i % dataCategories.length]),
      JSON.stringify(["consent", "contract", "legal_obligation"]),
      "Personal data is retained for the period necessary to fulfil the stated purpose, subject to applicable legal retention requirements.",
      "You have the right to access, correct, delete, and port your personal data. Contact our DPO at dpo@organisation.ng.",
      i % 3 === 0 ? "Some data may be transferred to adequacy-approved countries with appropriate safeguards." : "No cross-border transfers.",
      statuses[i % statuses.length] !== "draft" ? ago(Math.floor(Math.random() * 180)) : null,
      statuses[i % statuses.length] !== "draft" ? ago(Math.floor(Math.random() * 180)) : null
    ]);
  }
  console.log("  ✓ 10 privacy notices");
}

async function seedCookieConsentRecords(orgIds) {
  console.log("Seeding cookie_consent_records...");
  const domains = ["bank.ng", "telecom.ng", "health.ng", "gov.ng", "fintech.ng"];
  for (let i = 0; i < 15; i++) {
    const orgId = orgIds[i % orgIds.length];
    await query(`
      INSERT INTO cookie_consent_records (organization_id, domain, visitor_id,
        consent_given, necessary_cookies, analytical_cookies, marketing_cookies,
        functional_cookies, consent_timestamp, ip_address)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT DO NOTHING
    `, [
      orgId, domains[i % domains.length],
      `visitor-${Math.random().toString(36).substring(2, 15)}`,
      i % 5 !== 0, // 80% consent given
      true, // necessary always true
      i % 3 !== 0, i % 4 === 0, i % 2 === 0,
      ago(Math.floor(Math.random() * 90)),
      `105.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
    ]);
  }
  console.log("  ✓ 15 cookie consent records");
}

async function seedAutomatedDecisionRecords(orgIds) {
  console.log("Seeding automated_decision_records...");
  const types = ["credit_scoring", "fraud_detection", "loan_approval", "insurance_pricing", "kyc_verification"];
  const outcomes = [
    "Loan application approved: credit score 742, risk level low",
    "Transaction flagged as suspicious: velocity anomaly detected",
    "Loan application declined: insufficient income documentation",
    "Insurance premium set at ₦45,000/year: medium risk profile",
    "KYC verification passed: identity confirmed via NIN + BVN match"
  ];
  for (let i = 0; i < 12; i++) {
    const orgId = orgIds[i % orgIds.length];
    const email = nigerianEmails[i % nigerianEmails.length];
    const humanReview = i % 4 === 0;
    await query(`
      INSERT INTO automated_decision_records (organization_id, data_subject_email,
        decision_type, decision_outcome, significant_effect, human_review_requested,
        human_review_completed_at, human_review_outcome, logic_explanation,
        input_data_summary, opt_out_requested, decided_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT DO NOTHING
    `, [
      orgId, email, types[i % types.length], outcomes[i % outcomes.length],
      i % 2 === 0, humanReview,
      humanReview ? ago(Math.floor(Math.random() * 7)) : null,
      humanReview ? "Human review confirmed automated decision. No override required." : null,
      "Decision based on machine learning model trained on historical data. Key factors: credit history (40%), income (30%), employment (20%), other (10%).",
      "NIN verified, BVN matched, 12-month transaction history analysed, employment verified with employer.",
      i % 8 === 0, ago(Math.floor(Math.random() * 30))
    ]);
  }
  console.log("  ✓ 12 automated decision records");
}

async function seedParentalConsentRecords(orgIds) {
  console.log("Seeding parental_consent_records...");
  const statuses = ["pending", "granted", "denied", "withdrawn"];
  const childNames = ["Chidi Okonkwo", "Amina Aliyu", "Temi Adeyemi", "Kelechi Eze", "Zara Bello"];
  for (let i = 0; i < 8; i++) {
    const orgId = orgIds[i % orgIds.length];
    const status = statuses[i % statuses.length];
    await query(`
      INSERT INTO parental_consent_records (organization_id, child_name, child_age,
        parent_name, parent_email, parent_id_verified, purpose, parental_consent_status,
        consent_given_at, verification_method, age_verification_method)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT DO NOTHING
    `, [
      orgId, childNames[i % childNames.length],
      Math.floor(Math.random() * 6) + 10, // age 10-15
      nigerianNames[i % nigerianNames.length],
      nigerianEmails[i % nigerianEmails.length],
      i % 2 === 0,
      "Educational platform access and learning progress tracking",
      status,
      status === "granted" ? ago(Math.floor(Math.random() * 90)) : null,
      "NIN verification + OTP to registered phone",
      "Birth certificate upload + NIN cross-reference"
    ]);
  }
  console.log("  ✓ 8 parental consent records");
}

async function seedStaffTrainingRecords(orgIds) {
  console.log("Seeding staff_training_records...");
  const trainings = [
    { title: "NDPA 2023 Fundamentals", type: "mandatory_compliance", hours: 4 },
    { title: "Data Breach Response Procedures", type: "incident_response", hours: 3 },
    { title: "Privacy by Design Workshop", type: "technical_training", hours: 8 },
    { title: "DPIA Methodology Training", type: "specialist_training", hours: 6 },
    { title: "Cybersecurity Awareness", type: "security_awareness", hours: 2 },
    { title: "Cross-Border Data Transfer Rules", type: "compliance_training", hours: 3 },
    { title: "Data Subject Rights Handling", type: "operational_training", hours: 4 },
    { title: "AI & Automated Decision-Making Ethics", type: "ethics_training", hours: 5 }
  ];
  const statuses = ["scheduled", "in_progress", "completed", "overdue"];
  for (let i = 0; i < trainings.length; i++) {
    const orgId = orgIds[i % orgIds.length];
    const t = trainings[i];
    const status = statuses[i % statuses.length];
    await query(`
      INSERT INTO staff_training_records (organization_id, training_title, training_type,
        description, training_status, scheduled_date, completed_date, participant_count,
        target_audience, trainer_name, duration_hours, pass_rate, is_recurring, recurrence_months)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT DO NOTHING
    `, [
      orgId, t.title, t.type,
      `Mandatory training on ${t.title} for all relevant staff under NDPA 2023 compliance programme.`,
      status,
      status === "scheduled" ? future(Math.floor(Math.random() * 60)) : ago(Math.floor(Math.random() * 90)),
      status === "completed" ? ago(Math.floor(Math.random() * 60)) : null,
      Math.floor(Math.random() * 150) + 20,
      ["All staff", "IT & Security team", "Legal & Compliance", "Data processing staff"][i % 4],
      `${["NDPC", "DPCO", "Internal"][i % 3]} Certified Trainer`,
      t.hours, status === "completed" ? 0.75 + Math.random() * 0.25 : null,
      i % 2 === 0, i % 2 === 0 ? 12 : null
    ]);
  }
  console.log("  ✓ 8 staff training records");
}

async function seedTransferInstruments(userIds) {
  console.log("Seeding transfer_instruments...");
  const instruments = [
    { type: "scc", name: "Standard Contractual Clauses — Controller to Processor (EU)", countries: ["EU", "DE", "FR", "NL"] },
    { type: "scc", name: "Standard Contractual Clauses — Controller to Controller (UK)", countries: ["GB"] },
    { type: "bcr", name: "Binding Corporate Rules — Intra-Group Data Transfers", countries: ["GB", "EU", "US"] },
    { type: "adequacy", name: "Adequacy Decision — South Africa (POPIA)", countries: ["ZA"] },
    { type: "adequacy", name: "Adequacy Decision — Ghana (DPA 2012)", countries: ["GH"] },
    { type: "derogation", name: "Explicit Consent Derogation for Research Data", countries: ["US", "CN"] },
    { type: "authorization", name: "NDPC Authorisation for Sensitive Data Transfer", countries: ["US"] }
  ];
  const statuses = ["draft", "active", "expired", "revoked"];
  for (let i = 0; i < instruments.length; i++) {
    const inst = instruments[i];
    await query(`
      INSERT INTO transfer_instruments (instrument_type, name, transfer_instrument_status,
        description, applicable_countries, effective_date, expiry_date,
        approved_by, ndpc_approval_ref)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT DO NOTHING
    `, [
      inst.type, inst.name, statuses[i % statuses.length],
      `Legal instrument authorising cross-border data transfers to ${inst.countries.join(", ")} under NDPA 2023 Chapter 5.`,
      JSON.stringify(inst.countries),
      ago(Math.floor(Math.random() * 365)),
      future(365 + Math.floor(Math.random() * 730)),
      userIds.length > 0 ? userIds[0] : null,
      `NDPC/TI/${2024}/${String(i + 1).padStart(4, "0")}`
    ]);
  }
  console.log("  ✓ 7 transfer instruments");
}

async function seedDataExportJobs(orgIds) {
  console.log("Seeding data_export_jobs...");
  const statuses = ["queued", "processing", "completed", "failed", "expired"];
  const formats = ["json", "csv", "xml", "pdf"];
  for (let i = 0; i < 10; i++) {
    const orgId = orgIds[i % orgIds.length];
    const status = statuses[i % statuses.length];
    await query(`
      INSERT INTO data_export_jobs (organization_id, data_subject_email, export_format,
        export_job_status, data_categories, file_size_bytes, download_url,
        download_expires_at, processed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT DO NOTHING
    `, [
      orgId, nigerianEmails[i % nigerianEmails.length],
      formats[i % formats.length], status,
      JSON.stringify(dataCategories[i % dataCategories.length]),
      status === "completed" ? Math.floor(Math.random() * 5000000) + 10000 : null,
      status === "completed" ? `https://exports.ndsep.gov.ng/secure/${Math.random().toString(36).substring(2)}` : null,
      status === "completed" ? future(7) : null,
      status === "completed" ? ago(Math.floor(Math.random() * 30)) : null
    ]);
  }
  console.log("  ✓ 10 data export jobs");
}

async function seedDcpmiThresholds() {
  console.log("Seeding dcpmi_thresholds...");
  const thresholds = [
    { sector: "banking", criterion: "Minimum Encryption Standard", desc: "AES-256 minimum for data at rest", value: 256, unit: "bits" },
    { sector: "banking", criterion: "Maximum Data Breach Notification Time", desc: "Hours to notify NDPC after breach detection", value: 72, unit: "hours" },
    { sector: "banking", criterion: "Minimum Staff Training Coverage", desc: "Percentage of staff completing annual NDPA training", value: 90, unit: "percent" },
    { sector: "telecom", criterion: "Subscriber Data Retention Limit", desc: "Maximum days to retain inactive subscriber data", value: 365, unit: "days" },
    { sector: "telecom", criterion: "Cross-Border Transfer Approval Threshold", desc: "Volume in GB requiring NDPC pre-approval", value: 1000, unit: "GB" },
    { sector: "healthcare", criterion: "Patient Data Access Response Time", desc: "Days to respond to patient data access request", value: 30, unit: "days" },
    { sector: "healthcare", criterion: "Medical Record Retention Period", desc: "Minimum years to retain patient medical records", value: 10, unit: "years" },
    { sector: null, criterion: "DPIA Mandatory Threshold — Affected Individuals", desc: "Number of individuals above which DPIA is mandatory", value: 1000, unit: "individuals" },
    { sector: null, criterion: "Maximum Consent Validity Period", desc: "Maximum years before consent must be renewed", value: 3, unit: "years" },
    { sector: null, criterion: "Automated Decision Human Review SLA", desc: "Days to complete human review of contested automated decision", value: 14, unit: "days" }
  ];
  for (const t of thresholds) {
    await query(`
      INSERT INTO dcpmi_thresholds (sector_code, criterion_name, criterion_description,
        threshold_value, threshold_unit, is_active, effective_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT DO NOTHING
    `, [
      t.sector, t.criterion, t.desc, t.value, t.unit, true, ago(180)
    ]);
  }
  console.log("  ✓ 10 DCPMI thresholds");
}

async function main() {
  console.log("=== NDPA Compliance Tables Seed Script ===\n");
  try {
    const orgIds = await getOrgIds();
    const userIds = await getUserIds();
    console.log(`Found ${orgIds.length} organisations, ${userIds.length} users\n`);

    if (orgIds.length === 0) {
      console.error("ERROR: No organisations found. Run the main seed script first.");
      process.exit(1);
    }

    await seedConsentRecords(orgIds);
    await seedBreachIncidents(orgIds, userIds);
    await seedDpoAppointments(orgIds);
    await seedDpiaAssessments(orgIds, userIds);
    await seedRopaRecords(orgIds);
    await seedRetentionPolicies(orgIds);
    await seedDpoReports(orgIds);
    await seedComplianceAuditReturns(orgIds, userIds);
    await seedAdequacyDeterminations();
    await seedDataProcessingAgreements(orgIds, userIds);
    await seedPrivacyNotices(orgIds, userIds);
    await seedCookieConsentRecords(orgIds);
    await seedAutomatedDecisionRecords(orgIds);
    await seedParentalConsentRecords(orgIds);
    await seedStaffTrainingRecords(orgIds);
    await seedTransferInstruments(userIds);
    await seedDataExportJobs(orgIds);
    await seedDcpmiThresholds();

    console.log("\n=== Seed complete! All 18 NDPA compliance tables populated. ===");
  } catch (err) {
    console.error("Seed error:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
