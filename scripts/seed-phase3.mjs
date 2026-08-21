import pg from "pg";
const { Pool } = pg;
const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || "postgresql://ndsep_user:ndsep_secure_2026@localhost:5432/ndsep_db"),
});

async function seed() {
  const client = await pool.connect();
  try {
    console.log("🌱 Seeding Phase 3 tables: policy_templates, ai_systems, sectors, citizen_requests, evidence_packages, config_snapshots, remediation_workflows...");

    // Get org IDs for FK references
    const orgs = await client.query("SELECT id, name FROM organizations ORDER BY id LIMIT 8");
    const orgIds = orgs.rows.map(r => r.id);
    if (orgIds.length === 0) {
      console.error("❌ No organizations found. Run seed.mjs first.");
      process.exit(1);
    }
    console.log(`✅ Found ${orgIds.length} organizations`);

    // ── Sectors ──────────────────────────────────────────────────────────────
    await client.query("DELETE FROM sectors");
    await client.query(`
      INSERT INTO sectors (name, code, parent_id, description, regulatory_framework, org_count) VALUES
        ('Financial Services', 'FIN', NULL, 'Banks, insurance companies, investment firms, and payment processors subject to financial data sovereignty rules.', 'NDPR · CBN Guidelines · FATF', 3),
        ('Telecommunications', 'TEL', NULL, 'Mobile network operators, ISPs, and satellite communication providers.', 'NDPR · NCC Regulations · ITU', 2),
        ('Healthcare', 'HLT', NULL, 'Hospitals, clinics, pharmaceutical companies, and health data processors.', 'NDPR · NHIA Act · WHO Guidelines', 1),
        ('Government', 'GOV', NULL, 'Federal and state ministries, agencies, and government-owned enterprises.', 'NDPR · Official Secrets Act · FOIA', 1),
        ('Energy', 'ENE', NULL, 'Oil and gas companies, electricity generation and distribution, and renewable energy operators.', 'NDPR · NUPRC · NERC', 1),
        ('E-Commerce', 'ECO', NULL, 'Online retail platforms, digital marketplaces, and payment gateways.', 'NDPR · FCCPC · CBN', 1),
        ('Insurance', 'INS', NULL, 'Life insurance, general insurance, and reinsurance companies.', 'NDPR · NAICOM · IRA', 1),
        ('Education', 'EDU', NULL, 'Universities, polytechnics, primary and secondary schools, and EdTech platforms.', 'NDPR · FME · UNESCO', 1),
        ('Retail Banking', 'RBK', 1, 'Commercial banks and microfinance institutions serving retail customers.', 'NDPR · CBN · AMCON', 2),
        ('Investment Banking', 'IBK', 1, 'Investment banks, asset managers, and capital market operators.', 'NDPR · SEC · FMDQ', 1)
      ON CONFLICT (code) DO UPDATE SET
        description = EXCLUDED.description,
        org_count = EXCLUDED.org_count,
        regulatory_framework = EXCLUDED.regulatory_framework
    `);
    const sectorCount = await client.query("SELECT COUNT(*) FROM sectors");
    console.log(`✅ Sectors: ${sectorCount.rows[0].count} rows`);

    // ── Policy Templates ─────────────────────────────────────────────────────
    await client.query("DELETE FROM policy_templates");
    const policyDefs = [
      {
        name: "NDPR Data Sovereignty Baseline",
        framework: "NDPR",
        version: "2.0",
        description: "Nigeria Data Protection Regulation baseline policy template. Enforces data localization, consent management, and cross-border transfer restrictions for all organizations processing Nigerian citizens' data.",
        status: "active",
        policy_definition: {
          rules: [
            { id: "NDPR-001", title: "Data Localization", description: "All personal data of Nigerian citizens must be stored on servers physically located within Nigeria.", severity: "critical", check: "data_residency == 'NG'" },
            { id: "NDPR-002", title: "Consent Management", description: "Explicit consent must be obtained before processing personal data.", severity: "high", check: "consent_obtained == true" },
            { id: "NDPR-003", title: "Cross-Border Transfer Approval", description: "Any transfer of personal data outside Nigeria requires NITDA approval.", severity: "critical", check: "transfer_approved == true || transfer_destination == 'NG'" },
            { id: "NDPR-004", title: "Data Breach Notification", description: "Data breaches must be reported to NITDA within 72 hours.", severity: "high", check: "breach_notification_hours <= 72" },
            { id: "NDPR-005", title: "Data Protection Officer", description: "Organizations processing personal data must appoint a DPO.", severity: "medium", check: "dpo_appointed == true" }
          ],
          thresholds: { critical_violations_max: 0, high_violations_max: 2, compliance_score_min: 75 }
        }
      },
      {
        name: "GDPR Cross-Border Transfer Policy",
        framework: "GDPR",
        version: "1.3",
        description: "EU General Data Protection Regulation policy for organizations transferring data to/from EU member states. Covers adequacy decisions, SCCs, and BCRs.",
        status: "active",
        policy_definition: {
          rules: [
            { id: "GDPR-001", title: "Adequacy Decision", description: "Transfers to third countries must be covered by an EU adequacy decision.", severity: "critical", check: "adequacy_decision == true || sccs_signed == true" },
            { id: "GDPR-002", title: "Data Minimization", description: "Only collect and process data that is strictly necessary for the stated purpose.", severity: "high", check: "data_minimization_score >= 80" },
            { id: "GDPR-003", title: "Right to Erasure", description: "Organizations must be able to fulfill data erasure requests within 30 days.", severity: "high", check: "erasure_capability == true" },
            { id: "GDPR-004", title: "Privacy by Design", description: "Data protection must be built into systems from the design phase.", severity: "medium", check: "privacy_by_design_certified == true" }
          ],
          thresholds: { critical_violations_max: 0, high_violations_max: 1, compliance_score_min: 85 }
        }
      },
      {
        name: "PIPL China Data Localization",
        framework: "PIPL",
        version: "1.1",
        description: "China Personal Information Protection Law policy template. Enforces strict data localization for critical information infrastructure operators and large-scale personal data processors.",
        status: "active",
        policy_definition: {
          rules: [
            { id: "PIPL-001", title: "Critical Infrastructure Localization", description: "CII operators must store personal information within China.", severity: "critical", check: "storage_location == 'CN'" },
            { id: "PIPL-002", title: "Security Assessment", description: "Cross-border transfers must pass a CAC security assessment.", severity: "critical", check: "cac_assessment_passed == true" },
            { id: "PIPL-003", title: "Separate Consent", description: "Separate consent required for each purpose of processing.", severity: "high", check: "granular_consent == true" }
          ],
          thresholds: { critical_violations_max: 0, high_violations_max: 0, compliance_score_min: 90 }
        }
      },
      {
        name: "India DPDP Act Compliance",
        framework: "DPDP",
        version: "1.0",
        description: "India Digital Personal Data Protection Act 2023 policy template. Covers consent frameworks, data fiduciary obligations, and cross-border transfer restrictions.",
        status: "active",
        policy_definition: {
          rules: [
            { id: "DPDP-001", title: "Data Fiduciary Registration", description: "Significant data fiduciaries must register with the Data Protection Board.", severity: "critical", check: "dpb_registered == true" },
            { id: "DPDP-002", title: "Consent Manager", description: "Organizations must use a registered consent manager for processing.", severity: "high", check: "consent_manager_registered == true" },
            { id: "DPDP-003", title: "Data Localization for Sensitive Data", description: "Sensitive personal data must be stored within India.", severity: "critical", check: "sensitive_data_location == 'IN'" }
          ],
          thresholds: { critical_violations_max: 0, high_violations_max: 1, compliance_score_min: 80 }
        }
      },
      {
        name: "DOJ EO 14117 Data Security",
        framework: "DOJ_EO_14117",
        version: "1.0",
        description: "US Department of Justice Executive Order 14117 policy template. Restricts bulk transfers of US sensitive personal data and government-related data to countries of concern.",
        status: "active",
        policy_definition: {
          rules: [
            { id: "DOJ-001", title: "Bulk Data Transfer Restriction", description: "Bulk transfers of US persons' sensitive data to countries of concern are prohibited.", severity: "critical", check: "destination_country_of_concern == false" },
            { id: "DOJ-002", title: "Data Brokerage Prohibition", description: "Data brokerage transactions involving US sensitive data to covered persons are prohibited.", severity: "critical", check: "data_broker_transaction == false" },
            { id: "DOJ-003", title: "Security Requirements", description: "Organizations must implement CISA-approved security requirements.", severity: "high", check: "cisa_security_requirements == true" }
          ],
          thresholds: { critical_violations_max: 0, high_violations_max: 0, compliance_score_min: 95 }
        }
      },
      {
        name: "HIPAA Healthcare Data Protection",
        framework: "HIPAA",
        version: "2.1",
        description: "US Health Insurance Portability and Accountability Act policy template for healthcare organizations processing Protected Health Information (PHI).",
        status: "active",
        policy_definition: {
          rules: [
            { id: "HIPAA-001", title: "PHI Encryption", description: "All PHI must be encrypted at rest and in transit using FIPS 140-2 approved algorithms.", severity: "critical", check: "phi_encrypted == true" },
            { id: "HIPAA-002", title: "Business Associate Agreements", description: "BAAs must be in place with all third-party vendors handling PHI.", severity: "high", check: "baa_signed == true" },
            { id: "HIPAA-003", title: "Audit Controls", description: "Hardware, software, and procedural mechanisms must record and examine PHI access.", severity: "high", check: "audit_controls_enabled == true" },
            { id: "HIPAA-004", title: "Minimum Necessary Standard", description: "Only the minimum necessary PHI should be used, disclosed, or requested.", severity: "medium", check: "minimum_necessary_policy == true" }
          ],
          thresholds: { critical_violations_max: 0, high_violations_max: 1, compliance_score_min: 85 }
        }
      },
      {
        name: "ISO 27001 Information Security",
        framework: "ISO27001",
        version: "2022",
        description: "ISO/IEC 27001:2022 information security management system policy template. Covers risk assessment, security controls, and continuous improvement.",
        status: "active",
        policy_definition: {
          rules: [
            { id: "ISO-001", title: "Risk Assessment", description: "Annual information security risk assessment must be conducted.", severity: "high", check: "risk_assessment_date_within_12_months == true" },
            { id: "ISO-002", title: "Access Control", description: "Role-based access control must be implemented for all information systems.", severity: "high", check: "rbac_implemented == true" },
            { id: "ISO-003", title: "Incident Management", description: "Information security incidents must be reported and managed within defined SLAs.", severity: "medium", check: "incident_response_plan == true" },
            { id: "ISO-004", title: "Business Continuity", description: "Business continuity plans must be tested annually.", severity: "medium", check: "bcp_tested_within_12_months == true" }
          ],
          thresholds: { critical_violations_max: 0, high_violations_max: 2, compliance_score_min: 70 }
        }
      },
      {
        name: "SOC 2 Type II Cloud Security",
        framework: "SOC2",
        version: "1.0",
        description: "SOC 2 Type II policy template for cloud service providers. Covers the Trust Services Criteria: Security, Availability, Processing Integrity, Confidentiality, and Privacy.",
        status: "active",
        policy_definition: {
          rules: [
            { id: "SOC2-001", title: "Logical Access Controls", description: "Logical access to systems must be restricted to authorized users.", severity: "critical", check: "mfa_enabled == true && access_reviews_current == true" },
            { id: "SOC2-002", title: "System Availability", description: "System availability must meet committed SLAs (99.9% uptime).", severity: "high", check: "uptime_percentage >= 99.9" },
            { id: "SOC2-003", title: "Change Management", description: "All system changes must go through an approved change management process.", severity: "high", check: "change_management_process == true" },
            { id: "SOC2-004", title: "Vendor Management", description: "Third-party vendor security assessments must be conducted annually.", severity: "medium", check: "vendor_assessments_current == true" }
          ],
          thresholds: { critical_violations_max: 0, high_violations_max: 1, compliance_score_min: 80 }
        }
      }
    ];

    for (const p of policyDefs) {
      await client.query(`
        INSERT INTO policy_templates (name, framework, version, description, policy_definition, status, instantiated_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [p.name, p.framework, p.version, p.description, JSON.stringify(p.policy_definition), p.status, Math.floor(Math.random() * 15)]);
    }
    const ptCount = await client.query("SELECT COUNT(*) FROM policy_templates");
    console.log(`✅ Policy Templates: ${ptCount.rows[0].count} rows`);

    // ── AI Systems ───────────────────────────────────────────────────────────
    await client.query("DELETE FROM ai_systems");
    const aiSystems = [
      { org: orgIds[0], name: "FraudShield AI", vendor: "FinTech AI Labs", version: "3.2.1", purpose: "Real-time fraud detection and transaction risk scoring for banking transactions. Processes 2M+ transactions daily.", risk_level: "high", status: "approved", personal_data: true, cross_border: false },
      { org: orgIds[1], name: "NetOptimizer ML", vendor: "TeleCom Analytics", version: "1.8.0", purpose: "Network traffic optimization and predictive maintenance using subscriber usage patterns.", risk_level: "limited", status: "approved", personal_data: true, cross_border: true },
      { org: orgIds[2], name: "DiagnosticAI Pro", vendor: "MedTech Solutions", version: "2.0.3", purpose: "Medical image analysis and diagnostic assistance for radiology departments. Processes patient CT scans and MRIs.", risk_level: "high", status: "under_review", personal_data: true, cross_border: false },
      { org: orgIds[3], name: "EduAssist Bot", vendor: "EduTech Corp", version: "1.2.0", purpose: "Personalized learning recommendations and student performance prediction for national curriculum delivery.", risk_level: "minimal", status: "approved", personal_data: true, cross_border: false },
      { org: orgIds[4], name: "GridPredict", vendor: "Energy Analytics Inc", version: "4.1.0", purpose: "Power grid demand forecasting and fault prediction using IoT sensor data from national grid infrastructure.", risk_level: "limited", status: "approved", personal_data: false, cross_border: false },
      { org: orgIds[5], name: "RecoEngine", vendor: "Commerce AI", version: "2.5.0", purpose: "Product recommendation engine and dynamic pricing model using customer purchase history and behavioral data.", risk_level: "limited", status: "approved", personal_data: true, cross_border: true },
      { org: orgIds[0], name: "CreditScore AI", vendor: "FinScore Ltd", version: "1.9.2", purpose: "Automated credit scoring and loan eligibility assessment using alternative data sources.", risk_level: "high", status: "suspended", personal_data: true, cross_border: false },
      { org: orgIds[2], name: "DrugInteraction ML", vendor: "PharmaTech AI", version: "1.0.1", purpose: "Drug interaction prediction and dosage optimization for hospital pharmacy systems.", risk_level: "unacceptable", status: "under_review", personal_data: true, cross_border: false }
    ];

    for (const ai of aiSystems) {
      const lastAudit = new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000);
      const nextAudit = new Date(lastAudit.getTime() + 365 * 24 * 60 * 60 * 1000);
      await client.query(`
        INSERT INTO ai_systems (name, organization_id, vendor, version, purpose, risk_level, status, personal_data_processed, cross_border_transfer, last_audit_at, next_audit_due, training_data_description)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [ai.name, ai.org, ai.vendor, ai.version, ai.purpose, ai.risk_level, ai.status, ai.personal_data, ai.cross_border, lastAudit, nextAudit,
          `Training dataset: ${Math.floor(Math.random() * 5 + 1)}M records from ${new Date(2020, 0, 1).toISOString().split('T')[0]} to ${new Date(2024, 11, 31).toISOString().split('T')[0]}. Data sourced from internal systems and anonymized third-party datasets.`]);
    }
    const aiCount = await client.query("SELECT COUNT(*) FROM ai_systems");
    console.log(`✅ AI Systems: ${aiCount.rows[0].count} rows`);

    // ── Citizen Requests ─────────────────────────────────────────────────────
    await client.query("DELETE FROM citizen_requests");
    const requestTypes = ['access', 'erasure', 'portability', 'rectification', 'restriction', 'objection'];
    const requestStatuses = ['submitted', 'acknowledged', 'in_progress', 'completed', 'rejected', 'escalated'];
    const citizenRequests = [
      { org: orgIds[0], citizen: "Amara Okonkwo", email: "amara.o@email.com", type: "access", status: "completed", description: "Request to access all personal data held by the bank including transaction history and credit score data." },
      { org: orgIds[1], citizen: "Chidi Eze", email: "chidi.e@email.com", type: "erasure", status: "in_progress", description: "Request to delete all personal data including call records and location data after account termination." },
      { org: orgIds[2], citizen: "Fatima Al-Hassan", email: "fatima.h@email.com", type: "portability", status: "completed", description: "Request to export medical records in machine-readable format for transfer to a new healthcare provider." },
      { org: orgIds[3], citizen: "Emeka Nwosu", email: "emeka.n@email.com", type: "rectification", status: "acknowledged", description: "Request to correct inaccurate date of birth and address information in the education records system." },
      { org: orgIds[0], citizen: "Ngozi Adeyemi", email: "ngozi.a@email.com", type: "restriction", status: "submitted", description: "Request to restrict processing of personal data while disputing the accuracy of credit score calculation." },
      { org: orgIds[5], citizen: "Tunde Bakare", email: "tunde.b@email.com", type: "objection", status: "escalated", description: "Objection to automated profiling and targeted advertising based on purchase history without explicit consent." },
      { org: orgIds[1], citizen: "Aisha Mohammed", email: "aisha.m@email.com", type: "access", status: "completed", description: "Request for a copy of all personal data including subscriber information, usage records, and location data." },
      { org: orgIds[4], citizen: "Biodun Olatunji", email: "biodun.o@email.com", type: "erasure", status: "rejected", description: "Request to delete smart meter data. Rejected because retention is required by NERC regulatory mandate." }
    ];

    for (const req of citizenRequests) {
      const submittedAt = new Date(Date.now() - Math.random() * 60 * 24 * 60 * 60 * 1000);
      const dueAt = new Date(submittedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      await client.query(`
        INSERT INTO citizen_requests (organization_id, citizen_name, citizen_email, request_type, status, description, submitted_at, due_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [req.org, req.citizen, req.email, req.type, req.status, req.description, submittedAt, dueAt]);
    }
    const crCount = await client.query("SELECT COUNT(*) FROM citizen_requests");
    console.log(`✅ Citizen Requests: ${crCount.rows[0].count} rows`);

    // ── Evidence Packages ────────────────────────────────────────────────────
    await client.query("DELETE FROM evidence_packages");
    const evidencePackages = [
      { org: orgIds[0], title: "Q4 2025 NDPR Compliance Evidence", description: "Quarterly compliance evidence package for NITDA submission covering Q4 2025 operations.", framework: "NDPR", status: "signed" },
      { org: orgIds[1], title: "Annual Telecom Data Audit 2025", description: "Annual audit evidence package covering subscriber data handling, cross-border transfers, and NCC compliance.", framework: "NDPR", status: "signed" },
      { org: orgIds[2], title: "HIPAA PHI Handling Evidence 2025", description: "Evidence package demonstrating HIPAA-compliant handling of Protected Health Information.", framework: "HIPAA", status: "pending" },
      { org: orgIds[3], title: "Government Data Sovereignty Report", description: "Evidence package for government ministry data sovereignty compliance review.", framework: "NDPR", status: "signed" },
      { org: orgIds[0], title: "GDPR Cross-Border Transfer Evidence", description: "Evidence package for EU data transfer compliance covering Standard Contractual Clauses.", framework: "GDPR", status: "pending" },
      { org: orgIds[5], title: "E-Commerce Consumer Data Report", description: "Evidence package for FCCPC consumer data protection compliance.", framework: "NDPR", status: "draft" }
    ];

    for (const ep of evidencePackages) {
      const createdAt = new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000);
      const hash = Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const epStatus = ep.status === 'signed' ? 'verified' : ep.status === 'pending' ? 'generating' : 'generating';
      await client.query(`
        INSERT INTO evidence_packages (organization_id, package_type, status, content_hash, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [ep.org, ep.framework, epStatus, epStatus === 'verified' ? hash : null, createdAt]);
    }
    const epCount = await client.query("SELECT COUNT(*) FROM evidence_packages");
    console.log(`✅ Evidence Packages: ${epCount.rows[0].count} rows`);

    // ── Config Snapshots ─────────────────────────────────────────────────────
    await client.query("DELETE FROM config_snapshots");
    const configSnapshots = [
      { org: orgIds[0], ref: "main@a1b2c3d", status: "applied", summary: "Updated data retention policy from 5 years to 7 years per NDPR amendment. Added new consent management module.", drift_detected: false },
      { org: orgIds[1], ref: "main@e4f5g6h", status: "applied", summary: "Deployed network traffic monitoring configuration. Enabled cross-border transfer logging.", drift_detected: false },
      { org: orgIds[2], ref: "main@i7j8k9l", status: "drift_detected", summary: "Healthcare data classification rules updated. PHI tagging policy revised.", drift_detected: true },
      { org: orgIds[3], ref: "main@m1n2o3p", status: "applied", summary: "Government data localization rules enforced. All citizen data storage restricted to national data centers.", drift_detected: false },
      { org: orgIds[0], ref: "feature/gdpr@q4r5s6t", status: "pending", summary: "GDPR Standard Contractual Clauses configuration for EU data transfers. Awaiting legal review.", drift_detected: false },
      { org: orgIds[4], ref: "main@u7v8w9x", status: "failed", summary: "Energy sector IoT data classification update. Failed due to schema validation error.", drift_detected: false }
    ];

    for (const cs of configSnapshots) {
      const createdAt = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
      const csStatus = cs.status === 'applied' ? 'synced' : cs.status === 'drift_detected' ? 'drifted' : cs.status === 'pending' ? 'pending' : 'failed';
      const driftSummary = cs.drift_detected ? JSON.stringify({ fields_changed: ['data_retention_policy', 'transfer_rules'], severity: 'medium' }) : null;
      await client.query(`
        INSERT INTO config_snapshots (snapshot_name, source, config_data, status, drift_summary, commit_hash, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        cs.summary.substring(0, 100),
        'gitops',
        JSON.stringify({ org_id: cs.org, ref: cs.ref, summary: cs.summary }),
        csStatus,
        driftSummary,
        cs.ref.split('@')[1] || null,
        createdAt
      ]);
    }
    const csCount = await client.query("SELECT COUNT(*) FROM config_snapshots");
    console.log(`✅ Config Snapshots: ${csCount.rows[0].count} rows`);

    // ── Remediation Workflows ────────────────────────────────────────────────
    await client.query("DELETE FROM remediation_workflows");
    const remediationWorkflows = [
      { org: orgIds[1], title: "Localize Cross-Border Data Transfer", action: "localize", status: "in_progress", priority: "critical", description: "TeleCom National is transferring subscriber location data to servers in the EU without NITDA approval. Immediate localization required." },
      { org: orgIds[4], title: "Block Unauthorized API Data Export", action: "block", status: "completed", priority: "high", description: "Energy Corp National's API was exporting grid sensor data to an unauthorized third-party analytics platform." },
      { org: orgIds[2], title: "Tokenize Patient PII in Analytics", action: "tokenize", status: "in_progress", priority: "high", description: "HealthCare Central's analytics pipeline is processing raw patient PII. Replace with tokenized identifiers." },
      { org: orgIds[5], title: "Delete Expired Customer Profiles", action: "delete", status: "pending", priority: "medium", description: "Digital Commerce Ltd has 45,000 customer profiles exceeding the 5-year retention limit per NDPR Article 2.5." },
      { org: orgIds[0], title: "Encrypt Legacy Database Columns", action: "encrypt", status: "completed", priority: "high", description: "National Bank of Finance has 3 legacy database tables storing account numbers and BVN in plaintext." },
      { org: orgIds[3], title: "Restrict Access to Classified Data", action: "restrict", status: "pending", priority: "critical", description: "Ministry of Education's student records system has overly permissive access controls allowing contractor access to classified data." }
    ];

    for (const rw of remediationWorkflows) {
      const createdAt = new Date(Date.now() - Math.random() * 45 * 24 * 60 * 60 * 1000);
      const deadline = new Date(createdAt.getTime() + (rw.priority === 'critical' ? 7 : rw.priority === 'high' ? 14 : 30) * 24 * 60 * 60 * 1000);
      const rwStatus = rw.status === 'completed' ? 'completed' : rw.status === 'in_progress' ? 'in_progress' : 'pending';
      await client.query(`
        INSERT INTO remediation_workflows (org_id, action_type, description, status, priority, deadline, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [rw.org, rw.action, rw.description, rwStatus, rw.priority, deadline, createdAt]);
    }
    const rwCount = await client.query("SELECT COUNT(*) FROM remediation_workflows");
    console.log(`✅ Remediation Workflows: ${rwCount.rows[0].count} rows`);

    // ── TIA Assessments ──────────────────────────────────────────────────────
    await client.query("DELETE FROM tia_assessments");
    const transfers = await client.query("SELECT id, organization_id FROM transfer_approvals LIMIT 6");
    const tiaRiskLevels = ['low', 'medium', 'high', 'critical'];
    const tiaStatuses = ['draft', 'under_review', 'approved', 'rejected'];
    if (transfers.rows.length > 0) {
      for (const t of transfers.rows) {
        const riskLevel = tiaRiskLevels[Math.floor(Math.random() * tiaRiskLevels.length)];
        const status = tiaStatuses[Math.floor(Math.random() * tiaStatuses.length)];
        await client.query(`
          INSERT INTO tia_assessments (organization_id, transfer_approval_id, risk_level, status, legal_basis, safeguards, tia_document, destination_country)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          t.organization_id || orgIds[0],
          t.id,
          riskLevel,
          status,
          "Standard Contractual Clauses (SCCs) under GDPR Article 46(2)(c) and NDPR Section 2.11",
          "End-to-end encryption (AES-256), data minimization, access controls, audit logging, and contractual obligations on the recipient.",
          `Transfer Impact Assessment\n\nData Categories: Personal identifiers, financial data\nDestination: EU/US\nLegal Basis: SCCs\nRisk Level: ${riskLevel}\nSafeguards: Encryption, access controls\nRecommendation: ${status === 'approved' ? 'Approve with conditions' : 'Reject pending remediation'}`,
          ['US', 'GB', 'DE', 'FR', 'CN', 'IN'][Math.floor(Math.random() * 6)]
        ]);
      }
    }
    const tiaNewCount = await client.query("SELECT COUNT(*) FROM tia_assessments");
    console.log(`✅ TIA Assessments: ${tiaNewCount.rows[0].count} rows`);

    console.log("\n📊 Phase 3 Seed Summary:");
    const tables = ['sectors', 'policy_templates', 'ai_systems', 'citizen_requests', 'evidence_packages', 'config_snapshots', 'remediation_workflows', 'tia_assessments'];
    for (const t of tables) {
      const r = await client.query(`SELECT COUNT(*) FROM ${t}`);
      console.log(`  ${t}: ${r.rows[0].count} rows`);
    }
    console.log("\n✅ Phase 3 seeding complete!");

  } catch (err) {
    console.error("❌ Seed error:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(console.error);
