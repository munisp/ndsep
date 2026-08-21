/**
 * Comprehensive Seed Data for NDSEP Platform
 * =============================================
 * Seeds ALL domain tables with realistic Nigerian regulatory data.
 * Covers: organizations, compliance, enforcement, sectors (telecom, banking,
 * insurance, energy, healthcare, fintech), DPCO, consent, breach incidents,
 * monitoring, data governance, and more.
 *
 * Usage: Called from GET /api/demo-reset after basic user seed.
 */

import type { Pool } from "pg";
import { logger } from "./logger";

export async function seedComprehensiveData(pool: Pool): Promise<{ seeded: Record<string, number> }> {
  const client = await pool.connect();
  const counts: Record<string, number> = {};
  const warnings: string[] = [];

  function track(table: string, n: number) { counts[table] = (counts[table] ?? 0) + n; }

  async function safeSection(name: string, fn: () => Promise<void>) {
    try {
      await client.query(`SAVEPOINT ${name.replace(/[^a-z0-9_]/gi, "_")}`);
      await fn();
    } catch (err: any) {
      await client.query(`ROLLBACK TO SAVEPOINT ${name.replace(/[^a-z0-9_]/gi, "_")}`);
      warnings.push(`${name}: ${err.message}`);
      logger.warn({ err, section: name }, `[ComprehensiveSeed] Section ${name} failed, skipping`);
    }
  }

  try {
    await client.query("BEGIN");

    await safeSection("sec_1_Organizations_10_Nigerian_orgs_across_se", async () => {
      // ── 1. Organizations (10 Nigerian orgs across sectors) ──────────────────
      const orgInsert = `
        INSERT INTO organizations (id, name, registration_number, sector, country, city, latitude, longitude,
          compliance_score, compliance_status, agent_installed, agent_version, declared_asset_count,
          discovered_asset_count, risk_score, contact_email, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()`;
      const orgs = [
        [1, "Zenith Bank Plc", "RC-84937", "Financial Services", "Nigeria", "Lagos", 6.4541, 3.4215, 87.5, "compliant", true, "3.2.1", 450, 520, 22, "compliance@zenithbank.com"],
        [2, "MTN Nigeria Communications", "RC-395010", "Telecommunications", "Nigeria", "Lagos", 6.4281, 3.4219, 72.3, "under_review", true, "3.1.0", 1200, 1350, 45, "dpo@mtn.ng"],
        [3, "Dangote Industries Ltd", "RC-71242", "Manufacturing", "Nigeria", "Lagos", 6.4698, 3.5852, 65.0, "non_compliant", false, null, 280, 310, 68, "privacy@dangote.com"],
        [4, "NNPC Ltd", "RC-27023", "Energy & Utilities", "Nigeria", "Abuja", 9.0579, 7.4951, 78.2, "compliant", true, "3.2.1", 890, 950, 35, "dataprotection@nnpc.gov.ng"],
        [5, "Access Bank Plc", "RC-125384", "Financial Services", "Nigeria", "Lagos", 6.4312, 3.4289, 91.0, "compliant", true, "3.2.1", 600, 650, 18, "dpo@accessbank.com"],
        [6, "Flutterwave Inc", "RC-1504055", "Fintech", "Nigeria", "Lagos", 6.4355, 3.4160, 68.5, "under_review", true, "3.0.5", 180, 210, 52, "compliance@flutterwave.com"],
        [7, "Lagos University Teaching Hospital", "FG-LUTH-001", "Healthcare", "Nigeria", "Lagos", 6.5175, 3.3923, 55.0, "non_compliant", false, null, 150, 180, 72, "data@luth.gov.ng"],
        [8, "Nigerian Insurance Association", "RC-2345", "Insurance", "Nigeria", "Lagos", 6.4478, 3.4095, 74.0, "under_review", true, "3.1.0", 320, 340, 40, "privacy@nia.org.ng"],
        [9, "Glo Mobile Nigeria", "RC-339825", "Telecommunications", "Nigeria", "Lagos", 6.4350, 3.4170, 60.5, "remediation", true, "2.9.8", 800, 920, 58, "dpo@gloworld.com"],
        [10, "Interswitch Group", "RC-486907", "Fintech", "Nigeria", "Lagos", 6.4400, 3.4250, 82.0, "compliant", true, "3.2.0", 250, 270, 28, "privacy@interswitch.com"],
      ];
      for (const o of orgs) { await client.query(orgInsert, o); track("organizations", 1); }

    });

    await safeSection("sec_2_Sectors", async () => {
      // ── 2. Sectors ──────────────────────────────────────────────────────────
      const sectorInsert = `
        INSERT INTO sectors (id, name, code, description, regulatory_framework, org_count, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW())
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`;
      const sectorData = [
        [1, "Financial Services", "FIN", "Banking, microfinance, and financial institutions regulated by the Central Bank of Nigeria", "CBN", 45],
        [2, "Telecommunications", "TEL", "Mobile network operators, ISPs, and VAS providers regulated by NCC", "NCC", 28],
        [3, "Healthcare", "HLT", "Hospitals, HMOs, and health data processors under NHIA oversight", "NHIA", 120],
        [4, "Insurance", "INS", "Insurance companies and brokers regulated by NAICOM", "NAICOM", 62],
        [5, "Energy & Utilities", "ENR", "Power generation, distribution, and oil & gas companies", "NERC", 35],
        [6, "Fintech", "FNT", "Payment processors, lending platforms, and digital banks", "CBN/SEC", 85],
        [7, "Education", "EDU", "Universities, schools, and EdTech platforms", "NUC/UBEC", 200],
        [8, "E-Commerce", "ECM", "Online marketplaces and digital commerce platforms", "FCCPC", 150],
      ];
      for (const s of sectorData) { await client.query(sectorInsert, s); track("sectors", 1); }

    });

    await safeSection("sec_3_Assets", async () => {
      // ── 3. Assets ──────────────────────────────────────────────────────────
      const assetInsert = `
        INSERT INTO assets (id, organization_id, name, asset_type, status, ip_address, hostname, location,
          data_classification, is_within_borders, vulnerability_count, created_at, discovered_at, last_seen)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`;
      const assetData = [
        [1, 1, "Core Banking Database", "database", "active", "10.0.1.10", "cbs-db-01.zenith.local", "Lagos DC1", "tier2_financial", true, 2],
        [2, 1, "Mobile Banking API Gateway", "software", "active", "10.0.1.20", "mbank-gw.zenith.local", "Lagos DC1", "tier2_financial", true, 0],
        [3, 2, "Subscriber Data Platform", "database", "active", "172.16.0.5", "sdp-master.mtn.local", "Lagos DC2", "tier1_pii", true, 5],
        [4, 2, "CDR Processing Cluster", "cloud", "active", "172.16.0.10", "cdr-proc.mtn.local", "Lagos DC2", "tier1_pii", true, 1],
        [5, 3, "ERP System", "software", "active", "192.168.1.100", "erp.dangote.local", "Lagos HQ", "tier5_public", true, 8],
        [6, 4, "SCADA Network", "network", "active", "10.10.0.1", "scada-gw.nnpc.local", "Abuja DC", "tier4_government", true, 12],
        [7, 5, "Customer Data Warehouse", "database", "active", "10.0.2.15", "cdw.access.local", "Lagos DC1", "tier1_pii", true, 1],
        [8, 6, "Payment Processing Engine", "software", "active", "10.5.0.20", "payments.flutter.local", "Lagos DC3", "tier2_financial", true, 3],
        [9, 7, "Patient Records System", "database", "active", "192.168.10.5", "emr.luth.local", "Idi-Araba", "tier3_health", true, 15],
        [10, 8, "Claims Processing DB", "database", "active", "10.8.0.10", "claims-db.nia.local", "Lagos DC1", "tier2_financial", true, 4],
      ];
      for (const a of assetData) { await client.query(assetInsert, a); track("assets", 1); }

    });

    await safeSection("sec_4_Compliance_Policies_NDPAaligned", async () => {
      // ── 4. Compliance Policies (NDPA-aligned) ───────────────────────────────
      const policyInsert = `
        INSERT INTO compliance_policies (id, name, description, category, severity, is_active, weight, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()`;
      const policies = [
        [1, "NDPA s24 – Lawful Basis", "All personal data processing must have a valid lawful basis under NDPA Section 24", "Data Processing", "critical", true, 2.0],
        [2, "NDPA s25 – Consent Requirements", "Consent must be freely given, specific, informed, and unambiguous", "Consent", "critical", 2.0],
        [3, "NDPA s26 – Data Minimisation", "Personal data collected must be adequate, relevant, and limited to processing purpose", "Data Quality", "high", 1.5],
        [4, "NDPA s30 – Data Subject Rights", "Organizations must facilitate DSAR within 30 days", "Rights Management", "critical", 2.0],
        [5, "NDPA s34 – Cross-Border Transfer", "International transfers require adequacy determination or appropriate safeguards", "Cross-Border", "critical", 2.5],
        [6, "NDPA s39 – Breach Notification", "Data breaches must be notified to NDPC within 72 hours", "Incident Response", "critical", 2.5],
        [7, "NDPA s40 – DPO Appointment", "Controllers processing sensitive data must appoint a qualified DPO", "Governance", "high", 1.5],
        [8, "NDPA s42 – DPIA Requirement", "High-risk processing activities require a Data Protection Impact Assessment", "Risk Assessment", "high", 1.5],
        [9, "NDPA s44 – Record of Processing", "Maintain comprehensive records of all processing activities (ROPA)", "Documentation", "medium", 1.0],
        [10, "NDPA s47 – Security Measures", "Implement appropriate technical and organisational security measures", "Security", "critical", 2.0],
      ];
      for (const p of policies) { await client.query(policyInsert, p); track("compliance_policies", 1); }

    });

    await safeSection("sec_5_Compliance_Violations", async () => {
      // ── 5. Compliance Violations ────────────────────────────────────────────
      const violInsert = `
        INSERT INTO compliance_violations (id, organization_id, policy_id, asset_id, title, description,
          severity, status, enforcement_status, detected_at, penalty_amount, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()-($10||' days')::interval,$11,NOW())
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title`;
      const violations = [
        [1, 3, 5, 5, "Unauthorised cross-border data transfer to China", "ERP system replicates employee PII to Alibaba Cloud Singapore without adequacy assessment", "critical", "non_compliant", "penalty_imposed", "45", 25000000],
        [2, 2, 1, 3, "Processing subscriber CDRs without lawful basis review", "CDR retention policy not updated since 2023; no lawful basis documented for analytics use", "high", "non_compliant", "notice_sent", "30", 10000000],
        [3, 9, 6, null, "72-hour breach notification exceeded", "SIM swap fraud incident reported 5 days after detection", "critical", "non_compliant", "audit_scheduled", "20", 50000000],
        [4, 7, 10, 9, "Inadequate security measures for health records", "Patient EMR accessible via unencrypted HTTP; no MFA on admin access", "critical", "remediation", "notice_sent", "15", 15000000],
        [5, 6, 2, 8, "Invalid consent for payment data sharing", "Third-party data sharing without explicit opt-in consent mechanism", "high", "under_review", "pending", "10", 5000000],
      ];
      for (const v of violations) { await client.query(violInsert, v); track("compliance_violations", 1); }

    });

    await safeSection("sec_6_Enforcement_Actions", async () => {
      // ── 6. Enforcement Actions ──────────────────────────────────────────────
      const enfInsert = `
        INSERT INTO enforcement_actions (id, violation_id, organization_id, action_type, status,
          notice_issued_at, penalty_amount, notes, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,NOW()-($6||' days')::interval,$7,$8,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`;
      const actions = [
        [1, 1, 3, "penalty", "penalty_imposed", "40", 25000000, "Final penalty for NDPA s34 violation. Cross-border transfer to non-adequate jurisdiction without safeguards."],
        [2, 2, 2, "notice", "notice_sent", "25", null, "Formal notice issued under NDPA s24. 30-day remediation window granted."],
        [3, 3, 9, "audit", "audit_scheduled", "15", 50000000, "Mandatory compliance audit scheduled. Breach notification SLA violated by 3 days."],
        [4, 4, 7, "notice", "notice_sent", "10", 15000000, "Security deficiency notice. Immediate remediation of EMR access controls required."],
      ];
      for (const a of actions) { await client.query(enfInsert, a); track("enforcement_actions", 1); }

    });

    await safeSection("sec_7_Financial_Penalties", async () => {
      // ── 7. Financial Penalties ──────────────────────────────────────────────
      const penInsert = `
        INSERT INTO financial_penalties (id, organization_id, violation_id, enforcement_action_id,
          amount, currency, payment_status, due_date, description, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()+($8||' days')::interval,$9,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET payment_status=EXCLUDED.payment_status, updated_at=NOW()`;
      const penalties = [
        [1, 3, 1, 1, 25000000, "NGN", "overdue", "-15", "NDPA s34 penalty – unauthorised cross-border transfer"],
        [2, 2, 2, 2, 10000000, "NGN", "pending", "30", "NDPA s24 penalty – processing without lawful basis"],
        [3, 9, 3, 3, 50000000, "NGN", "pending", "45", "NDPA s39 penalty – breach notification delay"],
        [4, 7, 4, 4, 15000000, "NGN", "processing", "20", "NDPA s47 penalty – inadequate security measures"],
      ];
      for (const p of penalties) { await client.query(penInsert, p); track("financial_penalties", 1); }

    });

    await safeSection("sec_8_Enforcement_Cases", async () => {
      // ── 8. Enforcement Cases ────────────────────────────────────────────────
      const caseInsert = `
        INSERT INTO enforcement_cases (id, case_ref, organization_id, title, description,
          case_type, priority, status, assigned_to, opened_at, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()-($10||' days')::interval,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, updated_at=NOW()`;
      const cases = [
        [1, "NDPC-ENF-2026-001", 3, "Dangote Cross-Border Data Transfer Investigation", "Investigation into unauthorised PII transfer to Alibaba Cloud Singapore", "investigation", "critical", "active", "Adaeze Okonkwo", "50"],
        [2, "NDPC-ENF-2026-002", 9, "Glo Breach Notification Delay", "SIM swap fraud notification exceeded 72-hour SLA by 3 days", "breach_response", "high", "active", "Emeka Nwosu", "25"],
        [3, "NDPC-ENF-2026-003", 7, "LUTH Patient Data Security Audit", "Mandatory security audit triggered by unencrypted EMR access", "compliance_audit", "high", "in_progress", "Fatima Abdullahi", "18"],
      ];
      for (const c of cases) { await client.query(caseInsert, c); track("enforcement_cases", 1); }

    });

    await safeSection("sec_9_Security_Alerts", async () => {
      // ── 9. Security Alerts ──────────────────────────────────────────────────
      const alertInsert = `
        INSERT INTO security_alerts (id, organization_id, source, alert_type, title,
          severity, description, status, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()-($9||' hours')::interval)
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title`;
      const alerts = [
        [1, 2, "waf", "intrusion_attempt", "SQL injection attempt on subscriber portal", "high", "WAF blocked parameterised SQL injection targeting /api/subscriber/lookup", "resolved", "6"],
        [2, 1, "siem", "anomalous_access", "Unusual bulk data export from CBS", "critical", "5.2GB exported from core banking at 02:00 WAT by service account", "investigating", "2"],
        [3, 6, "ids", "data_exfiltration", "DNS tunnelling detected from payment engine", "critical", "Potential data exfiltration via DNS TXT queries to external domain", "open", "1"],
        [4, 4, "endpoint", "malware", "Ransomware indicators on SCADA workstation", "critical", "Behavioural analysis detected file encryption patterns", "contained", "4"],
        [5, 7, "compliance", "policy_violation", "Unencrypted PII transmission detected", "high", "Patient records transmitted over HTTP to external lab system", "open", "3"],
      ];
      for (const a of alerts) { await client.query(alertInsert, a); track("security_alerts", 1); }

    });

    await safeSection("sec_10_Breach_Incidents", async () => {
      // ── 10. Breach Incidents ────────────────────────────────────────────────
      const breachInsert = `
        INSERT INTO breach_incidents (id, organization_id, title, description, severity,
          status, records_affected, breach_type, discovery_date, notification_date,
          root_cause, remediation_steps, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()-($9||' days')::interval,
          CASE WHEN $10::text='null' THEN NULL ELSE NOW()-($10||' days')::interval END,
          $11,$12,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, updated_at=NOW()`;
      const breaches = [
        [1, 9, "SIM Swap Fraud Data Breach", "Coordinated SIM swap attack compromised 2,340 customer accounts", "critical", "investigation", 2340, "unauthorized_access", "25", "20", "Social engineering of customer care agents", '["Agent re-training","MFA enforcement","Biometric verification for SIM swaps"]'],
        [2, 7, "Patient Records Exposure", "Misconfigured web server exposed 890 patient files via directory listing", "high", "remediation", 890, "accidental_exposure", "12", "11", "Apache directory listing enabled on EMR web interface", '["Disabled directory listing","Deployed WAF rules","Access audit initiated"]'],
        [3, 6, "Payment Card Data Leak", "Debug logging captured full card numbers in production logs", "critical", "contained", 15600, "system_vulnerability", "8", "7", "PCI-DSS masking not applied to debug log level", '["Purged affected logs","Applied PAN masking at all log levels","PCI-DSS re-certification"]'],
      ];
      for (const b of breaches) { await client.query(breachInsert, b); track("breach_incidents", 1); }

    });

    await safeSection("sec_11_Consent_Records", async () => {
      // ── 11. Consent Records ─────────────────────────────────────────────────
      const consentInsert = `
        INSERT INTO consent_records (id, organization_id, data_subject_id, purpose,
          lawful_basis, status, consent_method, ip_address, granted_at, expires_at,
          created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()-($9||' days')::interval,NOW()+($10||' days')::interval,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()`;
      const consents = [
        [1, 1, "CUS-ZEN-001", "Account opening and KYC processing", "contract", "active", "digital_form", "102.89.23.45", "180", "365"],
        [2, 1, "CUS-ZEN-002", "Marketing communications", "consent", "active", "checkbox", "105.112.45.67", "90", "180"],
        [3, 2, "SUB-MTN-001", "Network analytics and QoS improvement", "legitimate_interest", "active", "terms_acceptance", "197.210.12.34", "365", "730"],
        [4, 6, "USR-FLW-001", "Payment processing and fraud detection", "contract", "active", "api_consent", "41.58.120.89", "60", "365"],
        [5, 7, "PAT-LUTH-001", "Medical treatment and clinical research", "vital_interest", "active", "paper_form", "196.46.10.15", "30", "1825"],
      ];
      for (const c of consents) { await client.query(consentInsert, c); track("consent_records", 1); }

    });

    await safeSection("sec_12_DPIA_Assessments", async () => {
      // ── 12. DPIA Assessments ────────────────────────────────────────────────
      const dpiaInsert = `
        INSERT INTO dpia_assessments (id, organization_id, title, description, status,
          risk_level, processing_activity, data_categories, data_subjects, assessor,
          created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, updated_at=NOW()`;
      const dpias = [
        [1, 1, "Core Banking AI Credit Scoring", "Automated credit scoring using ML models on customer financial history", "completed", "high", "Automated decision-making for loan approvals", '["financial_data","employment_history","credit_bureau"]', '["loan_applicants","existing_customers"]', "Dr. Chioma Eze"],
        [2, 2, "Subscriber Location Analytics", "Processing cell tower data for network optimisation and coverage planning", "in_progress", "high", "Location tracking for network QoS", '["location_data","device_identifiers","usage_patterns"]', '["mobile_subscribers"]', "Bayo Adeyemi"],
        [3, 6, "Open Banking Data Sharing", "PSD2-style data sharing with third-party fintech providers", "draft", "critical", "Sharing financial data with licensed third parties", '["transaction_history","account_balances","payment_data"]', '["bank_customers","fintech_users"]', "Amara Okafor"],
      ];
      for (const d of dpias) { await client.query(dpiaInsert, d); track("dpia_assessments", 1); }

    });

    await safeSection("sec_13_DPO_Appointments", async () => {
      // ── 13. DPO Appointments ────────────────────────────────────────────────
      const dpoInsert = `
        INSERT INTO dpo_appointments (id, organization_id, dpo_name, dpo_email, dpo_phone,
          qualification, appointment_date, status, ndpc_registration_number, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW()-($7||' days')::interval,$8,$9,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET dpo_name=EXCLUDED.dpo_name, updated_at=NOW()`;
      const dpos = [
        [1, 1, "Dr. Chioma Eze", "chioma.eze@zenithbank.com", "+234-802-345-6789", "CIPM, CIPP/E, CDPO", "365", "active", "NDPC-DPO-2025-001"],
        [2, 2, "Bayo Adeyemi", "bayo.adeyemi@mtn.ng", "+234-803-456-7890", "CIPP/A, ISO 27001 LA", "200", "active", "NDPC-DPO-2025-002"],
        [3, 5, "Funke Adeniyi", "funke.adeniyi@accessbank.com", "+234-804-567-8901", "CIPM, DPO Certified", "300", "active", "NDPC-DPO-2025-003"],
        [4, 10, "Olumide Bakare", "olumide.bakare@interswitch.com", "+234-805-678-9012", "CIPP/E, CISSP", "150", "active", "NDPC-DPO-2025-004"],
      ];
      for (const d of dpos) { await client.query(dpoInsert, d); track("dpo_appointments", 1); }

    });

    await safeSection("sec_14_ROPA_Records", async () => {
      // ── 14. ROPA Records ────────────────────────────────────────────────────
      const ropaInsert = `
        INSERT INTO ropa_records (id, organization_id, processing_activity, purpose,
          lawful_basis, data_categories, data_subjects, recipients, retention_period,
          security_measures, cross_border_transfer, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET processing_activity=EXCLUDED.processing_activity, updated_at=NOW()`;
      const ropas = [
        [1, 1, "Customer onboarding and KYC", "Identity verification and regulatory compliance", "legal_obligation", '["full_name","bvn","nin","address","photo_id"]', '["bank_customers"]', '["CBN","NIBSS","Credit Bureaus"]', "7 years post-account closure", "AES-256 encryption, role-based access, audit logging", false, "active"],
        [2, 2, "Call detail record processing", "Network billing and quality monitoring", "contract", '["phone_numbers","call_duration","location","imei"]', '["mobile_subscribers"]', '["NCC for regulatory reporting"]', "2 years", "Encrypted storage, access controls, anonymisation for analytics", false, "active"],
        [3, 6, "Payment transaction processing", "Facilitating merchant-to-consumer payments", "contract", '["card_numbers","bank_accounts","transaction_amounts"]', '["merchants","consumers"]', '["Partner banks","Card networks"]', "5 years per CBN directive", "PCI-DSS Level 1, tokenisation, HSM key management", true, "active"],
      ];
      for (const r of ropas) { await client.query(ropaInsert, r); track("ropa_records", 1); }

    });

    await safeSection("sec_15_Retention_Policies", async () => {
      // ── 15. Retention Policies ──────────────────────────────────────────────
      const retInsert = `
        INSERT INTO retention_policies (id, organization_id, data_category, retention_period_days,
          legal_basis, review_frequency, auto_delete, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET data_category=EXCLUDED.data_category, updated_at=NOW()`;
      const retentions = [
        [1, 1, "Customer KYC documents", 2555, "CBN AML/CFT Regulations", "annual", true, "active"],
        [2, 1, "Transaction records", 2555, "CBN Prudential Guidelines", "annual", false, "active"],
        [3, 2, "Call detail records", 730, "NCC Licence Conditions", "quarterly", true, "active"],
        [4, 6, "Payment logs", 1825, "CBN Payment System Guidelines", "semi-annual", true, "active"],
        [5, 7, "Patient medical records", 7300, "National Health Act 2014", "biennial", false, "active"],
      ];
      for (const r of retentions) { await client.query(retInsert, r); track("retention_policies", 1); }

    });

    await safeSection("sec_16_Privacy_Notices", async () => {
      // ── 16. Privacy Notices ─────────────────────────────────────────────────
      const privInsert = `
        INSERT INTO privacy_notices (id, organization_id, title, version, status,
          content, language, effective_date, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()-($8||' days')::interval,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, updated_at=NOW()`;
      const privacyNotices = [
        [1, 1, "Zenith Bank Privacy Notice", "3.0", "active", "This notice explains how Zenith Bank collects, uses, and protects your personal data in accordance with the Nigeria Data Protection Act 2023.", "en", "90"],
        [2, 2, "MTN Nigeria Privacy Policy", "2.5", "active", "MTN Nigeria is committed to protecting the privacy of its subscribers. This policy outlines our data processing practices.", "en", "60"],
        [3, 6, "Flutterwave Privacy Statement", "2.0", "active", "Flutterwave processes payment data to facilitate transactions. This statement describes our privacy practices.", "en", "120"],
      ];
      for (const p of privacyNotices) { await client.query(privInsert, p); track("privacy_notices", 1); }

    });

    await safeSection("sec_17_Staff_Training_Records", async () => {
      // ── 17. Staff Training Records ──────────────────────────────────────────
      const trainInsert = `
        INSERT INTO staff_training_records (id, organization_id, training_name, training_type,
          completion_rate, total_staff, completed_staff, status, training_date, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()-($9||' days')::interval,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET training_name=EXCLUDED.training_name, updated_at=NOW()`;
      const trainings = [
        [1, 1, "NDPA Awareness Training Q1 2026", "mandatory", 95, 4200, 3990, "completed", "90"],
        [2, 1, "Data Breach Response Drill", "simulation", 88, 120, 106, "completed", "45"],
        [3, 2, "Subscriber Data Handling", "mandatory", 72, 8500, 6120, "in_progress", "30"],
        [4, 5, "PCI-DSS Compliance Training", "certification", 100, 350, 350, "completed", "60"],
        [5, 7, "Patient Data Privacy (HIPAA/NDPA)", "mandatory", 45, 2200, 990, "in_progress", "15"],
      ];
      for (const t of trainings) { await client.query(trainInsert, t); track("staff_training_records", 1); }

    });

    await safeSection("sec_18_Telecom_Operators_NCCregulated", async () => {
      // ── 18. Telecom Operators (NCC-regulated) ───────────────────────────────
      const telOpInsert = `
        INSERT INTO telecom_operators (id, operator_name, operator_code, operator_type, licence_type,
          licence_status, subscriber_base, market_share, hq_state, contact_email, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET operator_name=EXCLUDED.operator_name, updated_at=NOW()`;
      const telOps = [
        [1, "MTN Nigeria Communications Plc", "MTN", "mno", "unified_access", "active", 76000000, 38.5, "Lagos", "regulatory@mtn.ng"],
        [2, "Globacom Limited", "GLO", "mno", "unified_access", "active", 56000000, 28.3, "Lagos", "compliance@gloworld.com"],
        [3, "Airtel Networks Limited", "ART", "mno", "unified_access", "active", 52000000, 26.3, "Lagos", "regulatory@airtel.ng"],
        [4, "9mobile (Emerging Markets)", "9MB", "mno", "unified_access", "active", 13000000, 6.6, "Abuja", "regulatory@9mobile.com.ng"],
        [5, "Spectranet Limited", "SPC", "isp", "isp", "active", 800000, 0.4, "Lagos", "compliance@spectranet.com.ng"],
      ];
      for (const t of telOps) { await client.query(telOpInsert, t); track("telecom_operators", 1); }

    });

    await safeSection("sec_19_Spectrum_Licences", async () => {
      // ── 19. Spectrum Licences ───────────────────────────────────────────────
      const specInsert = `
        INSERT INTO spectrum_licences (id, operator_id, band, bandwidth_mhz, region,
          licence_fee_ngn, valid_from, valid_until, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW()-($7||' days')::interval,NOW()+($8||' days')::interval,$9,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET band=EXCLUDED.band, updated_at=NOW()`;
      const spectra = [
        [1, 1, "3500mhz", 100, "Nationwide", 273000000000, "730", "3285", "active"],
        [2, 1, "2600mhz", 40, "Nationwide", 65000000000, "1095", "2555", "active"],
        [3, 2, "700mhz", 20, "Nationwide", 85000000000, "365", "3650", "active"],
        [4, 3, "2100mhz", 30, "Nationwide", 42000000000, "1460", "1825", "pending_renewal"],
        [5, 4, "900mhz", 10, "North Central", 8500000000, "2190", "730", "active"],
      ];
      for (const s of spectra) { await client.query(specInsert, s); track("spectrum_licences", 1); }

    });

    await safeSection("sec_20_QoS_Violations", async () => {
      // ── 20. QoS Violations ──────────────────────────────────────────────────
      const qosInsert = `
        INSERT INTO qos_violations (id, operator_id, violation_type, metric_name,
          threshold_value, actual_value, region, severity, status, detected_at, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()-($10||' days')::interval,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET violation_type=EXCLUDED.violation_type, updated_at=NOW()`;
      const qosViols = [
        [1, 1, "call_drop", "Call Drop Rate", 2.0, 3.8, "North East", "high", "open", "5"],
        [2, 2, "data_speed", "4G Download Speed", 25.0, 12.5, "South West", "medium", "open", "3"],
        [3, 3, "call_setup", "Call Setup Success Rate", 98.0, 94.2, "South South", "high", "investigating", "7"],
        [4, 4, "coverage", "Coverage Obligation", 80.0, 65.0, "North West", "critical", "escalated", "14"],
      ];
      for (const q of qosViols) { await client.query(qosInsert, q); track("qos_violations", 1); }

    });

    await safeSection("sec_21_Banking_Institutions", async () => {
      // ── 21. Banking Institutions ────────────────────────────────────────────
      const bankInsert = `
        INSERT INTO banking_institutions (id, bank_name, bank_code, swift_bic, licence_type,
          cbn_licence_number, tier, total_assets_ngn, branch_count, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET bank_name=EXCLUDED.bank_name, updated_at=NOW()`;
      const banks = [
        [1, "Zenith Bank Plc", "057", "ZEABORLAG", "commercial", "CBN-CB-057", "tier1", 12500000000000, 500, "active"],
        [2, "Access Bank Plc", "044", "ABORLAG", "commercial", "CBN-CB-044", "tier1", 18000000000000, 700, "active"],
        [3, "GTBank Plc", "058", "GTBILAG", "commercial", "CBN-CB-058", "tier1", 6800000000000, 230, "active"],
        [4, "First Bank of Nigeria", "011", "FABORLAG", "commercial", "CBN-CB-011", "tier1", 9200000000000, 850, "active"],
        [5, "UBA Plc", "033", "UBUANOLA", "commercial", "CBN-CB-033", "tier1", 8100000000000, 1000, "active"],
      ];
      for (const b of banks) { await client.query(bankInsert, b); track("banking_institutions", 1); }

    });

    await safeSection("sec_22_Insurance_Companies", async () => {
      // ── 22. Insurance Companies ─────────────────────────────────────────────
      const insInsert = `
        INSERT INTO insurance_companies (id, company_name, naicom_licence, company_type,
          total_premium_ngn, claims_ratio, solvency_ratio, policyholder_count, status,
          ceo_name, hq_state, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET company_name=EXCLUDED.company_name, updated_at=NOW()`;
      const insurers = [
        [1, "Leadway Assurance Company Ltd", "NAICOM-LI-001", "life_and_general", 85000000000, 62, 185, 450000, "active", "Oye Hassan-Odukale", "Lagos"],
        [2, "AXA Mansard Insurance Plc", "NAICOM-GI-002", "general", 45000000000, 55, 210, 280000, "active", "Kunle Ahmed", "Lagos"],
        [3, "AIICO Insurance Plc", "NAICOM-LI-003", "life_and_general", 38000000000, 68, 165, 320000, "active", "Babatunde Fajemirokun", "Lagos"],
        [4, "Cornerstone Insurance Plc", "NAICOM-GI-004", "general", 22000000000, 48, 195, 180000, "active", "Ganiyu Musa", "Lagos"],
      ];
      for (const i of insurers) { await client.query(insInsert, i); track("insurance_companies", 1); }

    });

    await safeSection("sec_23_Insurance_Policies", async () => {
      // ── 23. Insurance Policies ──────────────────────────────────────────────
      const insPolicyInsert = `
        INSERT INTO insurance_policies (id, company_id, policy_number, policy_type,
          holder_name, premium_ngn, sum_insured_ngn, status, effective_date, expiry_date,
          created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()-($9||' days')::interval,NOW()+($10||' days')::interval,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET policy_number=EXCLUDED.policy_number, updated_at=NOW()`;
      const insPolicies = [
        [1, 1, "LW-LIF-2025-00001", "life", "Adebayo Johnson", 250000, 50000000, "active", "180", "185"],
        [2, 1, "LW-GRP-2025-00002", "group_life", "Dangote Industries Ltd", 8500000, 2000000000, "active", "90", "275"],
        [3, 2, "AXA-MOT-2025-00001", "motor", "Chinedu Okeke", 85000, 15000000, "active", "120", "245"],
        [4, 3, "AII-MAR-2025-00001", "marine", "NNPC Shipping", 12000000, 500000000, "active", "60", "305"],
      ];
      for (const p of insPolicies) { await client.query(insPolicyInsert, p); track("insurance_policies", 1); }

    });

    await safeSection("sec_24_Insurance_Claims", async () => {
      // ── 24. Insurance Claims ────────────────────────────────────────────────
      const claimInsert = `
        INSERT INTO insurance_claims (id, policy_id, company_id, claim_number, claim_type,
          amount_claimed_ngn, amount_approved_ngn, status, incident_date, filed_date,
          claimant_name, description, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()-($9||' days')::interval,NOW()-($10||' days')::interval,$11,$12,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET claim_number=EXCLUDED.claim_number, updated_at=NOW()`;
      const claims = [
        [1, 1, 1, "LW-CLM-2026-001", "death", 50000000, 50000000, "approved", "30", "25", "Estate of Adebayo Johnson", "Life insurance claim following insured's passing"],
        [2, 3, 2, "AXA-CLM-2026-001", "motor_accident", 3500000, 2800000, "under_investigation", "15", "12", "Chinedu Okeke", "Vehicle collision on Lagos-Ibadan expressway"],
        [3, 4, 3, "AII-CLM-2026-001", "cargo_damage", 85000000, null, "filed", "8", "5", "NNPC Shipping Ltd", "Cargo damage during maritime transit from Bonny to Rotterdam"],
      ];
      for (const c of claims) { await client.query(claimInsert, c); track("insurance_claims", 1); }

    });

    await safeSection("sec_25_Energy_Companies", async () => {
      // ── 25. Energy Companies ────────────────────────────────────────────────
      const energyInsert = `
        INSERT INTO energy_companies (id, company_name, nerc_licence, company_type,
          installed_capacity_mw, customer_count, region, status, ceo_name,
          compliance_score, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET company_name=EXCLUDED.company_name, updated_at=NOW()`;
      const energyCos = [
        [1, "Eko Electricity Distribution Company", "NERC-DISCO-EKO", "disco", 0, 1200000, "Lagos", "active", "Adeoye Fadeyibi", 72],
        [2, "Egbin Power Plc", "NERC-GENCO-EGB", "genco", 1320, 0, "Lagos", "active", "Mohan Vaswani", 85],
        [3, "Azura-Edo Power Plant", "NERC-IPP-AZR", "ipp", 461, 0, "Edo", "active", "David Gillespie", 90],
        [4, "Ikeja Electric Plc", "NERC-DISCO-IKE", "disco", 0, 950000, "Lagos", "active", "Olufemi Somefun", 68],
      ];
      for (const e of energyCos) { await client.query(energyInsert, e); track("energy_companies", 1); }

    });

    await safeSection("sec_26_Energy_Licences", async () => {
      // ── 26. Energy Licences ─────────────────────────────────────────────────
      const eLicInsert = `
        INSERT INTO energy_licences (id, company_id, licence_type, licence_number,
          valid_from, valid_until, capacity_mw, region, status, fee_ngn,
          created_at, updated_at)
        VALUES ($1,$2,$3,$4,NOW()-($5||' days')::interval,NOW()+($6||' days')::interval,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET licence_type=EXCLUDED.licence_type, updated_at=NOW()`;
      const eLicences = [
        [1, 1, "distribution", "NERC/DL/EKO/2024/001", "730", "1095", null, "Lagos Zone 1", "active", 500000000],
        [2, 2, "generation", "NERC/GL/EGB/2024/001", "365", "3285", 1320, "Lagos", "active", 2000000000],
        [3, 3, "generation", "NERC/GL/AZR/2024/001", "180", "3465", 461, "Edo", "active", 800000000],
      ];
      for (const l of eLicences) { await client.query(eLicInsert, l); track("energy_licences", 1); }

    });

    await safeSection("sec_27_Healthcare_Facilities", async () => {
      // ── 27. Healthcare Facilities ───────────────────────────────────────────
      const healthInsert = `
        INSERT INTO health_facilities (id, facility_name, facility_type, nhia_code,
          state, lga, bed_count, patient_count, ehr_system, data_localisation_compliant,
          status, compliance_score, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET facility_name=EXCLUDED.facility_name, updated_at=NOW()`;
      const healthFacs = [
        [1, "Lagos University Teaching Hospital", "teaching_hospital", "NHIA-TH-LAG-001", "Lagos", "Mushin", 761, 450000, "Custom EMR v2.1", false, "active", 55],
        [2, "National Hospital Abuja", "teaching_hospital", "NHIA-TH-ABJ-001", "FCT", "Garki", 500, 320000, "SAP Health", true, "active", 78],
        [3, "Reddington Hospital", "private_hospital", "NHIA-PH-LAG-001", "Lagos", "Ikeja", 120, 85000, "Meditech", true, "active", 82],
        [4, "University of Benin Teaching Hospital", "teaching_hospital", "NHIA-TH-EDO-001", "Edo", "Egor", 650, 280000, "Legacy System", false, "active", 45],
      ];
      for (const h of healthFacs) { await client.query(healthInsert, h); track("health_facilities", 1); }

    });

    await safeSection("sec_28_Fintech_Companies", async () => {
      // ── 28. Fintech Companies ───────────────────────────────────────────────
      const fintechInsert = `
        INSERT INTO fintech_companies (id, company_name, cbn_licence_type, cbn_licence_number,
          service_category, tpv_ngn, user_count, api_partners, data_localisation_compliant,
          status, compliance_score, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET company_name=EXCLUDED.company_name, updated_at=NOW()`;
      const fintechCos = [
        [1, "Flutterwave Inc", "ptsp", "CBN/PTSP/FLW/2020", "payments", 2500000000000, 1200000, 450, true, "active", 68],
        [2, "Paystack (Stripe)", "ptsp", "CBN/PTSP/PSK/2019", "payments", 1800000000000, 800000, 380, true, "active", 75],
        [3, "OPay Digital Services", "mfb", "CBN/MFB/OPY/2021", "mobile_money", 950000000000, 35000000, 120, true, "active", 62],
        [4, "Kuda Technologies", "mfb", "CBN/MFB/KDA/2020", "digital_banking", 450000000000, 8000000, 85, true, "active", 70],
        [5, "Interswitch Group", "switching", "CBN/SW/ISW/2002", "switching_processing", 4200000000000, 500000, 600, true, "active", 82],
      ];
      for (const f of fintechCos) { await client.query(fintechInsert, f); track("fintech_companies", 1); }

    });

    await safeSection("sec_29_Transfer_Approvals", async () => {
      // ── 29. Transfer Approvals ──────────────────────────────────────────────
      const xferInsert = `
        INSERT INTO transfer_approvals (id, reference_id, organization_id, dataset_name,
          source_country, destination_country, destination_entity, volume_gb,
          data_classification, business_justification, transfer_method, encryption_method,
          status, risk_score, requested_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET reference_id=EXCLUDED.reference_id, updated_at=NOW()`;
      const transfers = [
        [1, "XFER-2026-001", 1, "Customer Analytics Dataset", "Nigeria", "South Africa", "Standard Bank Group", 2.5, "tier2_financial", "Regional banking analytics for cross-border operations", "VPN", "AES-256-GCM", "approved", 35],
        [2, "XFER-2026-002", 3, "Employee PII for Cloud ERP", "Nigeria", "Singapore", "Alibaba Cloud", 0.8, "tier1_pii", "Cloud ERP hosting for manufacturing operations", "API", "TLS 1.3", "denied", 85],
        [3, "XFER-2026-003", 6, "Payment Transaction Logs", "Nigeria", "United States", "Stripe Inc", 5.2, "tier2_financial", "Payment processing settlement reconciliation", "API", "mTLS", "approved", 42],
      ];
      for (const t of transfers) { await client.query(xferInsert, t); track("transfer_approvals", 1); }

    });

    await safeSection("sec_30_Transfer_Instruments", async () => {
      // ── 30. Transfer Instruments ────────────────────────────────────────────
      const tiInsert = `
        INSERT INTO transfer_instruments (id, organization_id, instrument_type, name,
          description, status, valid_from, valid_until, destination_country,
          created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW()-($7||' days')::interval,NOW()+($8||' days')::interval,$9,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()`;
      const instruments = [
        [1, 1, "standard_contractual_clauses", "SCC with Standard Bank", "EU-model SCCs adapted for Nigeria-South Africa data transfers", "active", "180", "545", "South Africa"],
        [2, 5, "binding_corporate_rules", "Access Bank BCR", "Intra-group BCR for pan-African operations", "active", "365", "1460", "Multiple"],
        [3, 6, "adequacy_decision", "US Data Framework", "NDPC adequacy determination for US payment processors", "active", "90", "635", "United States"],
      ];
      for (const t of instruments) { await client.query(tiInsert, t); track("transfer_instruments", 1); }

    });

    await safeSection("sec_31_Adequacy_Determinations", async () => {
      // ── 31. Adequacy Determinations ─────────────────────────────────────────
      const adqInsert = `
        INSERT INTO adequacy_determinations (id, country_code, country_name, adequacy_status,
          data_protection_law, supervisory_authority, assessment_date, expires_at,
          notes, requires_additional_safeguards, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW()-($7||' days')::interval,NOW()+($8||' days')::interval,$9,$10,NOW(),NOW())
        ON CONFLICT (country_code) DO UPDATE SET country_name=EXCLUDED.country_name, updated_at=NOW()`;
      const adequacies = [
        [1, "ZA", "South Africa", "adequate", "POPIA (2013)", "Information Regulator", "365", "1095", "Strong alignment with NDPA principles", false],
        [2, "KE", "Kenya", "adequate", "Data Protection Act (2019)", "ODPC", "270", "1095", "Reciprocal adequacy agreement in place", false],
        [3, "GH", "Ghana", "adequate", "Data Protection Act (2012)", "Data Protection Commission", "180", "1095", "ECOWAS data protection framework member", false],
        [4, "US", "United States", "partially_adequate", "Sectoral (CCPA, HIPAA, GLBA)", "FTC/State AGs", "90", "365", "Adequate for financial sector only, additional safeguards for PII", true],
        [5, "CN", "China", "not_adequate", "PIPL (2021)", "CAC", "60", "0", "No mutual recognition. Cross-border transfers require NDPC approval + SCCs", true],
        [6, "GB", "United Kingdom", "adequate", "UK GDPR + DPA 2018", "ICO", "270", "1095", "Post-Brexit UK adequacy recognised by NDPC", false],
      ];
      for (const a of adequacies) { await client.query(adqInsert, a); track("adequacy_determinations", 1); }

    });

    await safeSection("sec_32_Policy_Templates", async () => {
      // ── 32. Policy Templates ────────────────────────────────────────────────
      const ptInsert = `
        INSERT INTO policy_templates (id, name, framework, version, description, status,
          content, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()`;
      const policyTemps = [
        [1, "NDPA Data Protection Policy", "NDPR", "2.0", "Comprehensive data protection policy template aligned with NDPA 2023", "active", "1. Purpose\n2. Scope\n3. Definitions\n4. Lawful Basis for Processing\n5. Data Subject Rights\n6. Data Breach Procedures\n7. Cross-Border Transfers\n8. Retention & Deletion"],
        [2, "NDPA Privacy Notice Template", "NDPR", "1.5", "Standard privacy notice for controllers processing Nigerian data subjects' personal data", "active", "Identity of Controller\nPurpose of Processing\nLawful Basis\nRecipients\nCross-Border Transfers\nRetention Period\nData Subject Rights\nComplaint Procedures"],
        [3, "GDPR-NDPA Cross-Border Policy", "GDPR", "1.0", "Dual-compliance policy for organisations subject to both GDPR and NDPA", "active", "1. Dual Jurisdiction\n2. Lawful Basis Mapping\n3. SCCs & Adequacy\n4. DPO Requirements\n5. Breach Notification (72h)"],
      ];
      for (const p of policyTemps) { await client.query(ptInsert, p); track("policy_templates", 1); }

    });

    await safeSection("sec_33_Evidence_Packages", async () => {
      // ── 33. Evidence Packages ────────────────────────────────────────────────
      const evInsert = `
        INSERT INTO evidence_packages (id, organization_id, name, description, status,
          evidence_type, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()`;
      const evidences = [
        [1, 1, "Q1 2026 Compliance Evidence Pack", "Quarterly evidence package for NDPC regulatory review", "submitted", "quarterly_review"],
        [2, 5, "PCI-DSS Certification Evidence", "Card payment security compliance documentation", "approved", "certification"],
        [3, 2, "NCC QoS Compliance Report", "Network quality of service metrics and compliance report", "draft", "regulatory_report"],
      ];
      for (const e of evidences) { await client.query(evInsert, e); track("evidence_packages", 1); }

    });

    await safeSection("sec_34_Citizen_Requests_DSAR", async () => {
      // ── 34. Citizen Requests (DSAR) ─────────────────────────────────────────
      const citInsert = `
        INSERT INTO citizen_requests (id, organization_id, request_type, subject_name,
          subject_email, description, status, priority, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET request_type=EXCLUDED.request_type, updated_at=NOW()`;
      const citizenReqs = [
        [1, 1, "access", "Adaeze Obiageli", "adaeze.o@gmail.com", "Request to access all personal data held by Zenith Bank", "in_progress", "medium"],
        [2, 2, "erasure", "Babajide Sanusi", "b.sanusi@outlook.com", "Request to delete all personal data from MTN systems", "pending", "high"],
        [3, 6, "portability", "Chidinma Nwachukwu", "chidinma.n@yahoo.com", "Request to export all payment history in machine-readable format", "completed", "low"],
        [4, 7, "rectification", "Emeka Obi", "emeka.obi@proton.me", "Request to correct erroneous medical records", "in_progress", "high"],
      ];
      for (const c of citizenReqs) { await client.query(citInsert, c); track("citizen_requests", 1); }

    });

    await safeSection("sec_35_TIA_Assessments", async () => {
      // ── 35. TIA Assessments ─────────────────────────────────────────────────
      const tiaInsert = `
        INSERT INTO tia_assessments (id, organization_id, title, destination_country,
          transfer_purpose, data_categories, risk_level, safeguards, status,
          created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, updated_at=NOW()`;
      const tias = [
        [1, 1, "TIA: Customer data to Standard Bank SA", "South Africa", "Cross-border banking analytics", '["financial_data","customer_profiles"]', "medium", '["SCCs","encryption","access_controls"]', "approved"],
        [2, 3, "TIA: Employee data to Alibaba Cloud", "China", "Cloud ERP hosting", '["employee_pii","payroll_data"]', "critical", '["SCCs","data_localisation_partial"]', "rejected"],
        [3, 6, "TIA: Payment data to Stripe US", "United States", "Payment settlement", '["transaction_data","merchant_data"]', "low", '["adequacy_decision","mTLS","tokenisation"]', "approved"],
      ];
      for (const t of tias) { await client.query(tiaInsert, t); track("tia_assessments", 1); }

    });

    await safeSection("sec_36_Remediation_Workflows", async () => {
      // ── 36. Remediation Workflows ───────────────────────────────────────────
      const remInsert = `
        INSERT INTO remediation_workflows (id, organization_id, title, description,
          priority, status, assigned_to, due_date, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()+($8||' days')::interval,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, updated_at=NOW()`;
      const remediations = [
        [1, 3, "Implement data localisation for ERP", "Migrate Alibaba Cloud workloads to local data centre", "critical", "in_progress", "IT Infrastructure Team", "30"],
        [2, 7, "Deploy HTTPS for EMR system", "Replace HTTP with TLS 1.3 for all EMR endpoints", "high", "in_progress", "Hospital IT", "14"],
        [3, 9, "Implement breach notification automation", "Deploy automated breach detection and 72-hour notification system", "high", "planned", "Security Team", "45"],
        [4, 2, "Update CDR lawful basis documentation", "Document legitimate interest assessment for CDR analytics", "medium", "in_progress", "Legal & Compliance", "21"],
      ];
      for (const r of remediations) { await client.query(remInsert, r); track("remediation_workflows", 1); }

    });

    await safeSection("sec_37_Monitoring_Snapshots", async () => {
      // ── 37. Monitoring Snapshots ────────────────────────────────────────────
      const monInsert = `
        INSERT INTO monitoring_snapshots (id, organization_id, snapshot_type, score,
          previous_score, delta, status, details, captured_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()-($9||' hours')::interval)
        ON CONFLICT (id) DO UPDATE SET score=EXCLUDED.score`;
      const snapshots = [
        [1, 1, "compliance_score", 87.5, 85.0, 2.5, "ok", '{"policies_met":9,"policies_total":10}', "1"],
        [2, 2, "compliance_score", 72.3, 74.0, -1.7, "warning", '{"policies_met":7,"policies_total":10}', "1"],
        [3, 3, "compliance_score", 65.0, 68.0, -3.0, "breach", '{"policies_met":6,"policies_total":10}', "1"],
        [4, 1, "sla_check", 99.2, 99.5, -0.3, "ok", '{"response_time_ms":45,"uptime":99.97}', "2"],
        [5, 4, "drift_check", null, null, null, "ok", '{"config_changes":0,"schema_changes":0}', "3"],
      ];
      for (const s of snapshots) { await client.query(monInsert, s); track("monitoring_snapshots", 1); }

    });

    await safeSection("sec_38_SLA_Breaches", async () => {
      // ── 38. SLA Breaches ────────────────────────────────────────────────────
      const slaInsert = `
        INSERT INTO sla_breaches (id, organization_id, sla_type, threshold, actual,
          severity, status, notes, detected_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()-($9||' days')::interval)
        ON CONFLICT (id) DO UPDATE SET sla_type=EXCLUDED.sla_type`;
      const slabs = [
        [1, 9, "response_time", 72, 120, "critical", "open", "Breach notification SLA exceeded by 48 hours", "20"],
        [2, 7, "reporting_deadline", 30, 45, "high", "acknowledged", "Quarterly DPO report submitted 15 days late", "10"],
        [3, 3, "audit_frequency", 365, 500, "medium", "open", "Annual compliance audit overdue by 135 days", "5"],
      ];
      for (const s of slabs) { await client.query(slaInsert, s); track("sla_breaches", 1); }

    });

    await safeSection("sec_39_Drift_Alerts", async () => {
      // ── 39. Drift Alerts ────────────────────────────────────────────────────
      const driftInsert = `
        INSERT INTO drift_alerts (id, organization_id, drift_type, resource_name,
          severity, status, detected_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW()-($7||' days')::interval)
        ON CONFLICT (id) DO UPDATE SET drift_type=EXCLUDED.drift_type`;
      const drifts = [
        [1, 2, "config_drift", "Firewall rules for subscriber portal", "high", "open", "3"],
        [2, 6, "schema_drift", "Payment transactions table", "medium", "resolved", "7"],
        [3, 4, "policy_drift", "SCADA access control policy", "critical", "open", "1"],
      ];
      for (const d of drifts) { await client.query(driftInsert, d); track("drift_alerts", 1); }

    });

    await safeSection("sec_40_Data_Catalog_Entries", async () => {
      // ── 40. Data Catalog Entries ────────────────────────────────────────────
      const catInsert = `
        INSERT INTO data_catalog_entries (id, organization_id, name, description,
          data_classification, owner, location, format, record_count,
          pii_fields, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()`;
      const catalog = [
        [1, 1, "Customer Master Database", "Core customer identity and account data", "tier1_pii", "Data Governance Team", "Lagos DC1 - PostgreSQL Cluster", "structured", 4500000, '["full_name","bvn","nin","email","phone","address"]'],
        [2, 2, "CDR Analytics Lake", "Processed call detail records for network analytics", "tier1_pii", "Network Analytics", "Lagos DC2 - Hadoop Cluster", "parquet", 85000000000, '["msisdn","imei","cell_id","call_duration"]'],
        [3, 7, "Patient Records System", "Electronic medical records database", "tier3_health", "Health Informatics", "Idi-Araba Server Room", "structured", 890000, '["patient_name","diagnosis","treatment","blood_type"]'],
      ];
      for (const c of catalog) { await client.query(catInsert, c); track("data_catalog_entries", 1); }

    });

    await safeSection("sec_41_Onboarding_Phases", async () => {
      // ── 41. Onboarding Phases ───────────────────────────────────────────────
      const obInsert = `
        INSERT INTO onboarding_phases (id, organization_id, phase_name, status,
          progress, notes, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET phase_name=EXCLUDED.phase_name, updated_at=NOW()`;
      const onboarding = [
        [1, 1, "Registration & KYC", "completed", 100, "All registration documents verified"],
        [2, 1, "Agent Installation", "completed", 100, "NDSEP agent v3.2.1 deployed"],
        [3, 1, "Initial Assessment", "completed", 100, "Baseline compliance score: 87.5"],
        [4, 1, "Ongoing Monitoring", "in_progress", 75, "Continuous monitoring active"],
        [5, 2, "Registration & KYC", "completed", 100, "Registration approved"],
        [6, 2, "Agent Installation", "completed", 100, "Agent v3.1.0 deployed"],
        [7, 2, "Initial Assessment", "in_progress", 60, "Assessment underway"],
      ];
      for (const o of onboarding) { await client.query(obInsert, o); track("onboarding_phases", 1); }

    });

    await safeSection("sec_42_Network_Events", async () => {
      // ── 42. Network Events ──────────────────────────────────────────────────
      const netInsert = `
        INSERT INTO network_events (id, organization_id, event_type, source_ip,
          destination_ip, source_country, destination_country, data_volume_mb,
          protocol, severity, is_blocked, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()-($12||' hours')::interval)
        ON CONFLICT (id) DO UPDATE SET event_type=EXCLUDED.event_type`;
      const netEvents = [
        [1, 3, "cross_border_transfer", "10.0.1.100", "47.88.12.5", "Nigeria", "Singapore", 820, "HTTPS", "critical", false, "6"],
        [2, 1, "normal", "10.0.1.10", "41.58.120.5", "Nigeria", "South Africa", 250, "SFTP", "info", false, "2"],
        [3, 6, "anomaly", "10.5.0.20", "185.220.101.1", "Nigeria", "Germany", 45, "DNS", "high", true, "1"],
        [4, 2, "policy_violation", "172.16.0.5", "52.14.89.200", "Nigeria", "United States", 1200, "HTTPS", "medium", false, "4"],
      ];
      for (const n of netEvents) { await client.query(netInsert, n); track("network_events", 1); }

    });

    await safeSection("sec_43_BGP_Routes", async () => {
      // ── 43. BGP Routes ──────────────────────────────────────────────────────
      const bgpInsert = `
        INSERT INTO bgp_routes (id, prefix, origin_asn, origin_name, path,
          is_nigerian, is_hijacked, last_seen, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET prefix=EXCLUDED.prefix`;
      const bgps = [
        [1, "41.58.0.0/16", 29465, "MTN Nigeria", '["29465","6939","3356"]', true, false],
        [2, "197.210.0.0/16", 37148, "Globacom", '["37148","6453","174"]', true, false],
        [3, "105.112.0.0/16", 36873, "Airtel Nigeria", '["36873","5511","3257"]', true, false],
        [4, "196.46.0.0/16", 37705, "MainOne", '["37705","2914"]', true, false],
        [5, "41.58.128.0/17", 29465, "MTN Nigeria", '["29465","suspicious_AS","174"]', true, true],
      ];
      for (const b of bgps) { await client.query(bgpInsert, b); track("bgp_routes", 1); }

    });

    await safeSection("sec_44_Automated_Decision_Records", async () => {
      // ── 44. Automated Decision Records ──────────────────────────────────────
      const adInsert = `
        INSERT INTO automated_decision_records (id, organization_id, decision_type,
          algorithm_name, input_data_categories, output_description, human_review_available,
          legal_basis, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET decision_type=EXCLUDED.decision_type, updated_at=NOW()`;
      const autoDecisions = [
        [1, 1, "credit_scoring", "ZenScore ML v3", '["income","employment","credit_history","bvn"]', "Credit limit and interest rate determination", true, "contract", "active"],
        [2, 6, "fraud_detection", "FlutterGuard AI", '["transaction_amount","merchant_category","device_fingerprint"]', "Real-time transaction approval/block", false, "legitimate_interest", "active"],
        [3, 8, "claims_assessment", "ClaimsBot v2", '["claim_type","amount","policy_history","medical_records"]', "Preliminary claims approval/denial", true, "contract", "active"],
      ];
      for (const a of autoDecisions) { await client.query(adInsert, a); track("automated_decision_records", 1); }

    });

    await safeSection("sec_45_DPO_Reports", async () => {
      // ── 45. DPO Reports ─────────────────────────────────────────────────────
      const dpoRepInsert = `
        INSERT INTO dpo_reports (id, organization_id, reporting_period, report_year,
          dpo_report_status, recommendations, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET reporting_period=EXCLUDED.reporting_period, updated_at=NOW()`;
      const dpoReps = [
        [1, 1, "Q1 2026", 2026, "submitted", "1. Enhance encryption for data at rest\n2. Increase DSAR response team capacity"],
        [2, 5, "Q1 2026", 2026, "draft", "1. Implement automated consent tracking\n2. Review third-party data sharing agreements"],
        [3, 2, "Q4 2025", 2025, "submitted", "1. Address CDR retention policy gaps\n2. Deploy subscriber data anonymisation"],
      ];
      for (const d of dpoReps) { await client.query(dpoRepInsert, d); track("dpo_reports", 1); }

    });

    await safeSection("sec_46_Compliance_Audit_Returns", async () => {
      // ── 46. Compliance Audit Returns ────────────────────────────────────────
      const carInsert = `
        INSERT INTO compliance_audit_returns (id, organization_id, audit_period_start,
          audit_period_end, car_status, compliance_score, findings_summary,
          created_at, updated_at)
        VALUES ($1,$2,NOW()-($3||' days')::interval,NOW()-($4||' days')::interval,$5,$6,$7,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET car_status=EXCLUDED.car_status, updated_at=NOW()`;
      const cars = [
        [1, 1, "365", "1", "accepted", 87.5, "Strong compliance posture. Minor gaps in cross-border transfer documentation."],
        [2, 2, "365", "1", "under_review", 72.3, "CDR retention policy needs update. Subscriber consent mechanisms require enhancement."],
        [3, 3, "365", "1", "rejected", 65.0, "Critical: Unauthorised cross-border transfer. Mandatory remediation within 30 days."],
      ];
      for (const c of cars) { await client.query(carInsert, c); track("compliance_audit_returns", 1); }

    });

    await safeSection("sec_47_Cookie_Consent_Records", async () => {
      // ── 47. Cookie Consent Records ──────────────────────────────────────────
      const cookieInsert = `
        INSERT INTO cookie_consent_records (id, organization_id, domain, consent_type,
          analytics_accepted, marketing_accepted, functional_accepted, ip_address,
          user_agent, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET domain=EXCLUDED.domain, updated_at=NOW()`;
      const cookies = [
        [1, 1, "zenithbank.com", "banner", true, false, true, "102.89.23.45", "Mozilla/5.0 (Windows NT 10.0)"],
        [2, 6, "flutterwave.com", "banner", true, true, true, "41.58.120.89", "Mozilla/5.0 (iPhone; CPU iPhone OS 17)"],
        [3, 2, "mtn.ng", "preference_center", false, false, true, "197.210.12.34", "Mozilla/5.0 (Linux; Android 14)"],
      ];
      for (const c of cookies) { await client.query(cookieInsert, c); track("cookie_consent_records", 1); }

    });

    await safeSection("sec_48_Parental_Consent_Records", async () => {
      // ── 48. Parental Consent Records ────────────────────────────────────────
      const parentInsert = `
        INSERT INTO parental_consent_records (id, organization_id, child_name,
          parent_name, parent_email, purpose, verification_method, status,
          created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET child_name=EXCLUDED.child_name, updated_at=NOW()`;
      const parentals = [
        [1, 7, "Chiamaka Obi (Minor)", "Emeka Obi", "emeka.obi@proton.me", "Paediatric medical records processing", "video_verification", "verified"],
        [2, 2, "Tunde Adeyemi (Minor)", "Bayo Adeyemi Sr.", "bayo.sr@gmail.com", "Subscriber account for minor", "document_upload", "pending"],
      ];
      for (const p of parentals) { await client.query(parentInsert, p); track("parental_consent_records", 1); }

    });

    await safeSection("sec_49_Data_Processing_Agreements", async () => {
      // ── 49. Data Processing Agreements ──────────────────────────────────────
      const dpaInsert = `
        INSERT INTO data_processing_agreements (id, organization_id, processor_name,
          processor_country, dpa_status, processing_purpose, data_categories,
          security_measures, breach_notification_clause, cross_border_transfer,
          created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET processor_name=EXCLUDED.processor_name, updated_at=NOW()`;
      const dpas = [
        [1, 1, "Microsoft Azure (Cloud)", "Ireland", "active", "Cloud infrastructure hosting", '["customer_data","transaction_logs"]', "ISO 27001, SOC 2 Type II", true, true],
        [2, 6, "Amazon Web Services", "United States", "active", "Payment processing infrastructure", '["payment_data","merchant_data"]', "PCI-DSS Level 1, SOC 2", true, true],
        [3, 2, "Huawei Technologies", "China", "under_review", "Network equipment and managed services", '["network_config","subscriber_metadata"]', "ISO 27001", false, true],
      ];
      for (const d of dpas) { await client.query(dpaInsert, d); track("data_processing_agreements", 1); }

    });

    await safeSection("sec_50_Data_Export_Jobs", async () => {
      // ── 50. Data Export Jobs ────────────────────────────────────────────────
      const expInsert = `
        INSERT INTO data_export_jobs (id, organization_id, export_type, format,
          status, record_count, file_size_mb, requested_by, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET export_type=EXCLUDED.export_type, updated_at=NOW()`;
      const exports = [
        [1, 1, "dsar_response", "json", "completed", 2450, 12, "DPO Office"],
        [2, 2, "regulatory_report", "csv", "in_progress", 85000000, 4500, "Compliance Team"],
        [3, 6, "audit_evidence", "pdf", "completed", 340, 28, "External Auditor"],
      ];
      for (const e of exports) { await client.query(expInsert, e); track("data_export_jobs", 1); }

    });

    await safeSection("sec_51_AI_Systems_Registry", async () => {
      // ── 51. AI Systems Registry ─────────────────────────────────────────────
      const aiInsert = `
        INSERT INTO ai_systems (id, organization_id, name, description, risk_level,
          purpose, data_sources, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, updated_at=NOW()`;
      const aiSystems = [
        [1, 1, "ZenScore Credit AI", "ML-based credit scoring using customer financial profiles", "high", "Automated credit decisions", '["credit_bureau","transaction_history","employment"]', "active"],
        [2, 6, "FlutterGuard Fraud Detection", "Real-time fraud detection for payment transactions", "high", "Transaction risk scoring", '["transaction_patterns","device_data","geolocation"]', "active"],
        [3, 2, "Network Anomaly Detector", "Deep learning for network anomaly detection", "medium", "Network security monitoring", '["traffic_flows","connection_logs","dns_queries"]', "active"],
      ];
      for (const a of aiSystems) { await client.query(aiInsert, a); track("ai_systems", 1); }

    });

    await safeSection("sec_52_Vendor_Risk_Profiles", async () => {
      // ── 52. Vendor Risk Profiles ────────────────────────────────────────────
      const vrInsert = `
        INSERT INTO vendor_risk_profiles (id, organization_id, vendor_name, vendor_country,
          service_type, risk_level, data_access_level, contract_expiry,
          last_assessment_date, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()+($8||' days')::interval,NOW()-($9||' days')::interval,$10,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET vendor_name=EXCLUDED.vendor_name, updated_at=NOW()`;
      const vendors = [
        [1, 1, "Microsoft Corporation", "United States", "Cloud Infrastructure", "medium", "high", "365", "30", "active"],
        [2, 6, "Amazon Web Services", "United States", "Cloud & Payment Processing", "medium", "critical", "180", "60", "active"],
        [3, 2, "Huawei Technologies", "China", "Network Equipment", "high", "high", "90", "15", "under_review"],
        [4, 7, "SAP SE", "Germany", "Hospital Management System", "low", "high", "730", "90", "active"],
      ];
      for (const v of vendors) { await client.query(vrInsert, v); track("vendor_risk_profiles", 1); }

    });

    await safeSection("sec_53_Whistleblower_Reports", async () => {
      // ── 53. Whistleblower Reports ───────────────────────────────────────────
      const wbInsert = `
        INSERT INTO whistleblower_reports (id, organization_id, report_ref,
          category, description, severity, status, anonymous,
          created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET report_ref=EXCLUDED.report_ref, updated_at=NOW()`;
      const whistles = [
        [1, 3, "WB-2026-001", "data_misuse", "Employee alleges customer data being sold to third-party marketing firms without consent", "critical", "investigating", true],
        [2, 2, "WB-2026-002", "privacy_violation", "Subscriber location data accessed by unauthorised department for employee monitoring", "high", "open", true],
      ];
      for (const w of whistles) { await client.query(wbInsert, w); track("whistleblower_reports", 1); }

    });

    await safeSection("sec_54_Sector_Compliance_Events", async () => {
      // ── 54. Sector Compliance Events ────────────────────────────────────────
      const sceInsert = `
        INSERT INTO sector_compliance_events (id, sector_id, organization_id, event_type,
          title, description, severity, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, updated_at=NOW()`;
      const sceData = [
        [1, 1, 1, "compliance_check", "Zenith Bank Q1 Compliance Review", "Quarterly NDPA compliance assessment completed", "info", "resolved"],
        [2, 2, 2, "violation", "MTN Subscriber Data Retention Breach", "CDR retention exceeds documented policy period", "high", "open"],
        [3, 6, 6, "audit", "Flutterwave PCI-DSS Annual Audit", "Annual payment card data security audit", "medium", "in_progress"],
      ];
      for (const s of sceData) { await client.query(sceInsert, s); track("sector_compliance_events", 1); }

    });

    await safeSection("sec_55_Config_Snapshots", async () => {
      // ── 55. Config Snapshots ────────────────────────────────────────────────
      const cfgInsert = `
        INSERT INTO config_snapshots (id, organization_id, snapshot_type, config_data,
          created_by, created_at)
        VALUES ($1,$2,$3,$4,$5,NOW())
        ON CONFLICT (id) DO UPDATE SET snapshot_type=EXCLUDED.snapshot_type`;
      const configs = [
        [1, 1, "firewall_rules", '{"rules_count":245,"last_change":"2026-05-15"}', "Network Admin"],
        [2, 2, "access_controls", '{"users":8500,"roles":12,"policies":45}', "Security Team"],
      ];
      for (const c of configs) { await client.query(cfgInsert, c); track("config_snapshots", 1); }

    });

    await safeSection("sec_56_Platform_Notifications", async () => {
      // ── 56. Platform Notifications ──────────────────────────────────────────
      const notifInsert = `
        INSERT INTO platform_notifications (id, user_id, title, message, type,
          is_read, link, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()-($8||' hours')::interval)
        ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title`;
      const notifs = [
        [1, 1, "New Enforcement Case", "Case NDPC-ENF-2026-001 opened against Dangote Industries", "enforcement", false, "/enforcement-cases", "2"],
        [2, 1, "Breach Alert", "SIM swap fraud data breach reported by Glo Mobile", "breach", false, "/breach-incidents", "4"],
        [3, 1, "Compliance Score Drop", "MTN Nigeria compliance score dropped 1.7 points", "compliance", true, "/organizations", "8"],
      ];
      for (const n of notifs) { await client.query(notifInsert, n); track("platform_notifications", 1); }

    });

    await safeSection("sec_57_DCPMI_Thresholds", async () => {
      // ── 57. DCPMI Thresholds ────────────────────────────────────────────────
      const dcpmiInsert = `
        INSERT INTO dcpmi_thresholds (id, organization_id, metric_name, threshold_value,
          current_value, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET metric_name=EXCLUDED.metric_name, updated_at=NOW()`;
      const dcpmis = [
        [1, 1, "Breach Response Time (hours)", 72, 24, "compliant"],
        [2, 1, "DSAR Completion Rate (%)", 95, 98, "compliant"],
        [3, 2, "Data Localisation Compliance (%)", 100, 85, "non_compliant"],
        [4, 3, "Cross-Border Transfer Compliance (%)", 100, 40, "critical"],
      ];
      for (const d of dcpmis) { await client.query(dcpmiInsert, d); track("dcpmi_thresholds", 1); }

    });

    await safeSection("sec_58_Penalty_Appeals", async () => {
      // ── 58. Penalty Appeals ─────────────────────────────────────────────────
      const appealInsert = `
        INSERT INTO penalty_appeals (id, penalty_id, organization_id, submitted_by,
          contact_email, grounds_for_appeal, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET grounds_for_appeal=EXCLUDED.grounds_for_appeal, updated_at=NOW()`;
      const appeals = [
        [1, 1, 3, "Dangote Legal Team", "legal@dangote.com", "We contend that the data transfer was covered by an existing SCC agreement with Alibaba Cloud. We request a review of the penalty amount.", "under_review"],
        [2, 3, 9, "Glo Compliance", "compliance@gloworld.com", "The breach was detected by our systems within 48 hours. The delay was due to internal escalation procedures which have since been improved.", "submitted"],
      ];
      for (const a of appeals) { await client.query(appealInsert, a); track("penalty_appeals", 1); }

    });

    await safeSection("sec_59_Portal_Submissions", async () => {
      // ── 59. Portal Submissions ──────────────────────────────────────────────
      const portalInsert = `
        INSERT INTO portal_submissions (id, organization_id, submission_type, status,
          data, submitted_by, submission_token, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET submission_type=EXCLUDED.submission_type, updated_at=NOW()`;
      const portals = [
        [1, 1, "annual_return", "approved", '{"year":2025,"score":87.5}', "Dr. Chioma Eze", "NDSEP-SUB-ZEN2025"],
        [2, 2, "registration", "under_review", '{"sector":"telecom","employees":8500}', "Bayo Adeyemi", "NDSEP-SUB-MTN2026"],
        [3, 6, "certification", "pending", '{"type":"pci_dss","level":"1"}', "Amara Okafor", "NDSEP-SUB-FLW2026"],
      ];
      for (const p of portals) { await client.query(portalInsert, p); track("portal_submissions", 1); }

    });

    await safeSection("sec_60_Audit_Logs", async () => {
      // ── 60. Audit Logs ──────────────────────────────────────────────────────
      const auditInsert = `
        INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id,
          details, ip_address, user_agent, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()-($9||' hours')::interval)
        ON CONFLICT (id) DO UPDATE SET action=EXCLUDED.action`;
      const auditLogs = [
        [1, 1, "login", "user", "1", '{"method":"sso","provider":"keycloak"}', "102.89.23.45", "Mozilla/5.0", "1"],
        [2, 1, "view_dashboard", "dashboard", "main", '{"page":"compliance_overview"}', "102.89.23.45", "Mozilla/5.0", "1"],
        [3, 1, "create_enforcement_case", "enforcement_case", "1", '{"org":"Dangote","type":"investigation"}', "102.89.23.45", "Mozilla/5.0", "2"],
        [4, 1, "export_report", "report", "compliance_q1", '{"format":"pdf","pages":45}', "102.89.23.45", "Mozilla/5.0", "3"],
      ];
      for (const a of auditLogs) { await client.query(auditInsert, a); track("audit_logs", 1); }

    });

    await safeSection("sec_61_Threat_Intelligence", async () => {
      // ── 61. Threat Intelligence ─────────────────────────────────────────────
      const tiInsert2 = `
        INSERT INTO threat_intelligence (id, source, indicator_type, indicator_value,
          threat_type, severity, confidence, status, first_seen, last_seen, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()-($9||' days')::interval,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET indicator_value=EXCLUDED.indicator_value`;
      const threats = [
        [1, "CERT-NG", "ip", "185.220.101.1", "c2_server", "critical", 95, "active", "30"],
        [2, "OpenThreatExchange", "domain", "malware-cdn.evil.ng", "malware_distribution", "high", 88, "active", "14"],
        [3, "NDPC-ISAC", "hash", "a1b2c3d4e5f6789012345678abcdef01", "ransomware", "critical", 99, "active", "7"],
      ];
      for (const t of threats) { await client.query(tiInsert2, t); track("threat_intelligence", 1); }

    });

    await safeSection("sec_62_ML_Risk_Predictions", async () => {
      // ── 62. ML Risk Predictions ─────────────────────────────────────────────
      const mlInsert = `
        INSERT INTO ml_risk_predictions (id, organization_id, model_name, risk_score,
          risk_category, features, confidence, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
        ON CONFLICT (id) DO UPDATE SET risk_score=EXCLUDED.risk_score`;
      const mlPreds = [
        [1, 3, "breach_probability_v3", 82, "high", '{"cross_border_violations":2,"security_score":45,"sector_avg":65}', 0.91],
        [2, 9, "penalty_risk_v3", 75, "high", '{"past_violations":1,"breach_notification_delay":true}', 0.87],
        [3, 1, "compliance_trajectory_v3", 15, "low", '{"trend":"improving","score":87.5,"yoy_delta":3.2}', 0.94],
      ];
      for (const m of mlPreds) { await client.query(mlInsert, m); track("ml_risk_predictions", 1); }

    });

    await safeSection("sec_63_Streaming_Events", async () => {
      // ── 63. Streaming Events ────────────────────────────────────────────────
      const seInsert = `
        INSERT INTO streaming_events (id, event_type, source, payload, created_at)
        VALUES ($1,$2,$3,$4,NOW()-($5||' minutes')::interval)
        ON CONFLICT (id) DO UPDATE SET event_type=EXCLUDED.event_type`;
      const streamEvents = [
        [1, "compliance_score_change", "monitoring_worker", '{"org_id":2,"old_score":74.0,"new_score":72.3}', "30"],
        [2, "breach_detected", "siem_integration", '{"org_id":9,"type":"sim_swap_fraud","records":2340}', "120"],
        [3, "enforcement_case_opened", "enforcement_service", '{"case_ref":"NDPC-ENF-2026-001","org":"Dangote"}', "180"],
      ];
      for (const s of streamEvents) { await client.query(seInsert, s); track("streaming_events", 1); }

    });

    await safeSection("sec_64_Organization_Users", async () => {
      // ── 64. Organization Users ──────────────────────────────────────────────
      const ouInsert = `
        INSERT INTO organization_users (id, organization_id, user_id, role, created_at, updated_at)
        VALUES ($1,$2,$3,$4,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role, updated_at=NOW()`;
      const orgUsers = [
        [1, 1, 1, "admin"],
        [2, 2, 1, "viewer"],
      ];
      for (const o of orgUsers) { await client.query(ouInsert, o); track("organization_users", 1); }

    });

    await client.query("COMMIT");
    if (warnings.length > 0) {
      logger.warn({ warnings, counts }, `[ComprehensiveSeed] Completed with ${warnings.length} section warnings`);
    } else {
      logger.info({ counts }, "[ComprehensiveSeed] Seeded all domain tables");
    }
    return { seeded: counts };
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "[ComprehensiveSeed] Seed failed, rolling back");
    throw err;
  } finally {
    client.release();
  }
}
