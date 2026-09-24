-- =============================================================================
-- NDSEP Phase 31 Comprehensive Seed Data
-- Populates all sparse tables with realistic Nigerian regulatory data
-- Run: psql $DATABASE_URL -f scripts/seed_phase31_comprehensive.sql
-- =============================================================================

-- ─── AML Cases (expand to 20) ─────────────────────────────────────────────────
INSERT INTO aml_cases (case_ref, organization_id, subject_name, subject_type, case_type, risk_score, risk_level, status, narrative, assigned_to, created_at) VALUES
  ('AML-2026-001', 1, 'Emeka Okonkwo', 'individual', 'suspicious_transaction', 85, 'high', 'open', 'Multiple large cash deposits inconsistent with known income sources', 'analyst@ndpc.gov.ng', NOW() - INTERVAL '30 days'),
  ('AML-2026-002', 2, 'Alhaji Musa Ibrahim', 'individual', 'pep_match', 92, 'critical', 'under_investigation', 'PEP match: former state governor, unexplained wire transfers to offshore accounts', 'compliance@ndpc.gov.ng', NOW() - INTERVAL '28 days'),
  ('AML-2026-003', 3, 'Global Trade Partners Ltd', 'entity', 'sanctions_match', 78, 'high', 'escalated', 'OFAC SDN list match — entity linked to sanctioned individuals', 'admin@ndpc.gov.ng', NOW() - INTERVAL '25 days'),
  ('AML-2026-004', 4, 'Chioma Adeyemi', 'individual', 'structuring', 71, 'high', 'open', 'Repeated transactions just below N10M reporting threshold (structuring)', 'analyst@ndpc.gov.ng', NOW() - INTERVAL '22 days'),
  ('AML-2026-005', 5, 'Lagos Logistics Ltd', 'entity', 'suspicious_transaction', 66, 'medium', 'open', 'Unusual pattern of round-number transfers to multiple accounts', 'analyst@ndpc.gov.ng', NOW() - INTERVAL '20 days'),
  ('AML-2026-006', 1, 'Dr. Bola Tinubu Jr.', 'individual', 'pep_match', 88, 'high', 'under_investigation', 'PEP screening match — close associate of senior government official', 'compliance@ndpc.gov.ng', NOW() - INTERVAL '18 days'),
  ('AML-2026-007', 2, 'Apex Investment Corp', 'entity', 'unusual_pattern', 95, 'critical', 'escalated', 'Suspected Ponzi scheme — funds received from 2,000+ retail investors', 'admin@ndpc.gov.ng', NOW() - INTERVAL '15 days'),
  ('AML-2026-008', 3, 'Fatima Al-Hassan', 'individual', 'suspicious_transaction', 62, 'medium', 'open', 'Cash deposits from multiple branches on same day, no business justification', 'analyst@ndpc.gov.ng', NOW() - INTERVAL '12 days'),
  ('AML-2026-009', 4, 'Northern Resources Ltd', 'entity', 'sanctions_match', 81, 'high', 'under_investigation', 'UN Security Council sanctions list match — arms embargo', 'compliance@ndpc.gov.ng', NOW() - INTERVAL '10 days'),
  ('AML-2026-010', 5, 'Oluwaseun Bakare', 'individual', 'structuring', 74, 'high', 'open', 'Three separate N9.9M transfers within 72 hours across different branches', 'analyst@ndpc.gov.ng', NOW() - INTERVAL '8 days'),
  ('AML-2026-011', 1, 'Digital Finance Solutions', 'entity', 'unusual_pattern', 89, 'high', 'escalated', 'BVN fraud — multiple accounts linked to same biometric data', 'admin@ndpc.gov.ng', NOW() - INTERVAL '7 days'),
  ('AML-2026-012', 2, 'Precious Nwosu', 'individual', 'high_risk_country', 57, 'medium', 'open', 'Frequent international transfers to high-risk jurisdictions (Libya, Sudan)', 'analyst@ndpc.gov.ng', NOW() - INTERVAL '6 days'),
  ('AML-2026-013', 3, 'Engr. Rotimi Amaechi', 'individual', 'pep_match', 76, 'high', 'under_investigation', 'PEP match — former minister, large real estate purchases via bank transfers', 'compliance@ndpc.gov.ng', NOW() - INTERVAL '5 days'),
  ('AML-2026-014', 4, 'Sunrise Trading Co.', 'entity', 'structuring', 68, 'medium', 'open', 'Daily cash deposits of N4.76M for 10 consecutive days', 'analyst@ndpc.gov.ng', NOW() - INTERVAL '4 days'),
  ('AML-2026-015', 5, 'Sahara Holdings Ltd', 'entity', 'sanctions_match', 83, 'high', 'escalated', 'EU sanctions match — entity linked to Russian oligarch network', 'admin@ndpc.gov.ng', NOW() - INTERVAL '3 days'),
  ('AML-2026-016', 1, 'Cyber Fraud Ring Alpha', 'entity', 'unusual_pattern', 91, 'critical', 'closed', 'Romance scam operation — 47 victims identified, funds recovered', 'compliance@ndpc.gov.ng', NOW() - INTERVAL '60 days'),
  ('AML-2026-017', 2, 'Aminu Kano Traders', 'entity', 'suspicious_transaction', 55, 'medium', 'closed_no_action', 'Suspicious cross-border transfers — investigation concluded, no violation', 'analyst@ndpc.gov.ng', NOW() - INTERVAL '45 days'),
  ('AML-2026-018', 3, 'Mrs. Ngozi Okonjo-Iweala', 'individual', 'pep_match', 79, 'high', 'closed_no_action', 'PEP match cleared — legitimate government salary and pension payments', 'compliance@ndpc.gov.ng', NOW() - INTERVAL '35 days'),
  ('AML-2026-019', 4, 'Crypto Exchange NG', 'entity', 'unusual_pattern', 87, 'high', 'escalated', 'Unlicensed crypto exchange used for money laundering — CBN referral', 'admin@ndpc.gov.ng', NOW() - INTERVAL '2 days'),
  ('AML-2026-020', 5, 'Emmanuel Obi', 'individual', 'structuring', 72, 'high', 'open', 'Structuring via multiple bank accounts at different institutions', 'analyst@ndpc.gov.ng', NOW() - INTERVAL '1 day')
ON CONFLICT (case_ref) DO NOTHING;

-- ─── Watchlist Entries (expand to 20) ─────────────────────────────────────────
-- entity_id is NOT NULL — use a sequence-based value
INSERT INTO watchlist_entries (entity_id, primary_name, entity_type, risk_level, reason, source, category, is_active, created_at) VALUES
  (gen_random_uuid()::text, 'Emeka Okonkwo', 'individual', 'high', 'Multiple suspicious transaction reports', 'nfiu', 'money_laundering', true, NOW() - INTERVAL '60 days'),
  (gen_random_uuid()::text, 'Global Trade Partners Ltd', 'entity', 'critical', 'OFAC SDN list match', 'ofac_sdn', 'sanctions', true, NOW() - INTERVAL '55 days'),
  (gen_random_uuid()::text, 'Apex Investment Corp', 'entity', 'critical', 'Suspected Ponzi scheme — EFCC referral', 'efcc', 'fraud', true, NOW() - INTERVAL '50 days'),
  (gen_random_uuid()::text, 'Northern Resources Ltd', 'entity', 'high', 'UN Security Council sanctions', 'un_consolidated', 'sanctions', true, NOW() - INTERVAL '45 days'),
  (gen_random_uuid()::text, 'Sahara Holdings Ltd', 'entity', 'high', 'EU sanctions — Russian oligarch links', 'eu_consolidated', 'sanctions', true, NOW() - INTERVAL '40 days'),
  (gen_random_uuid()::text, 'Crypto Exchange NG', 'entity', 'high', 'Unlicensed crypto exchange — CBN referral', 'cbn_internal', 'money_laundering', true, NOW() - INTERVAL '35 days'),
  (gen_random_uuid()::text, 'Alhaji Musa Ibrahim', 'individual', 'high', 'PEP — former state governor, unexplained wealth', 'nfiu', 'pep', true, NOW() - INTERVAL '30 days'),
  (gen_random_uuid()::text, 'Cyber Fraud Ring Alpha', 'entity', 'critical', 'Romance scam operation — INTERPOL red notice', 'interpol', 'fraud', false, NOW() - INTERVAL '90 days'),
  (gen_random_uuid()::text, 'Digital Finance Solutions', 'entity', 'high', 'BVN fraud — multiple identity theft cases', 'efcc', 'fraud', true, NOW() - INTERVAL '25 days'),
  (gen_random_uuid()::text, 'Lagos Logistics Ltd', 'entity', 'medium', 'Unusual payment patterns — under investigation', 'nfiu', 'money_laundering', true, NOW() - INTERVAL '20 days'),
  (gen_random_uuid()::text, 'Fatima Al-Hassan', 'individual', 'medium', 'Cash structuring — multiple branch deposits', 'cbn_internal', 'money_laundering', true, NOW() - INTERVAL '15 days'),
  (gen_random_uuid()::text, 'Sunrise Trading Co.', 'entity', 'medium', 'Daily structuring pattern — N4.76M/day', 'nfiu', 'money_laundering', true, NOW() - INTERVAL '10 days'),
  (gen_random_uuid()::text, 'Emmanuel Obi', 'individual', 'medium', 'Multi-bank structuring pattern', 'cbn_internal', 'money_laundering', true, NOW() - INTERVAL '8 days'),
  (gen_random_uuid()::text, 'Precious Nwosu', 'individual', 'medium', 'Frequent transfers to high-risk jurisdictions', 'nfiu', 'money_laundering', true, NOW() - INTERVAL '6 days'),
  (gen_random_uuid()::text, 'Oluwaseun Bakare', 'individual', 'medium', 'Three N9.9M transfers in 72 hours', 'cbn_internal', 'money_laundering', true, NOW() - INTERVAL '5 days'),
  (gen_random_uuid()::text, 'Chioma Adeyemi', 'individual', 'medium', 'Structuring — transactions below N10M threshold', 'nfiu', 'money_laundering', true, NOW() - INTERVAL '4 days'),
  (gen_random_uuid()::text, 'Dr. Bola Tinubu Jr.', 'individual', 'high', 'PEP — close associate of senior official', 'nfiu', 'pep', true, NOW() - INTERVAL '3 days'),
  (gen_random_uuid()::text, 'Engr. Rotimi Amaechi', 'individual', 'high', 'PEP — former minister, unexplained real estate', 'nfiu', 'pep', true, NOW() - INTERVAL '2 days'),
  (gen_random_uuid()::text, 'Aminu Kano Traders', 'entity', 'low', 'Suspicious cross-border transfers — cleared', 'nfiu', 'money_laundering', false, NOW() - INTERVAL '45 days'),
  (gen_random_uuid()::text, 'Mrs. Ngozi Okonjo-Iweala', 'individual', 'low', 'PEP match — cleared, legitimate payments', 'nfiu', 'pep', false, NOW() - INTERVAL '35 days')
ON CONFLICT DO NOTHING;

-- ─── DPO Registry (expand to 10 using existing org IDs 1-10) ─────────────────
INSERT INTO dpo_registry (organization_id, full_name, email, phone, appointment_date, certification_body, credential_status, ndpc_registered, created_at) VALUES
  (1, 'Adaeze Okonkwo', 'dpo@accessbank.com', '+234-1-905-0000', NOW() - INTERVAL '365 days', 'IAPP', 'active', true, NOW() - INTERVAL '365 days'),
  (2, 'Emeka Eze', 'dpo@mtn.ng', '+234-1-448-0000', NOW() - INTERVAL '300 days', 'IAPP', 'active', true, NOW() - INTERVAL '300 days'),
  (3, 'Aminu Garba', 'dpo@dangote.com', '+234-1-631-0000', NOW() - INTERVAL '280 days', 'BSI', 'active', true, NOW() - INTERVAL '280 days'),
  (4, 'Tunde Oyelaran', 'dpo@nnpc.gov.ng', '+234-803-000-0001', NOW() - INTERVAL '260 days', 'IAPP', 'active', true, NOW() - INTERVAL '260 days'),
  (5, 'Ngozi Adeyemi', 'dpo@zenithbank.com', '+234-805-000-0001', NOW() - INTERVAL '240 days', 'IAPP', 'active', true, NOW() - INTERVAL '240 days'),
  (6, 'Chukwuemeka Obi', 'dpo@airtel.ng', '+234-1-774-0000', NOW() - INTERVAL '220 days', 'IAPP', 'active', true, NOW() - INTERVAL '220 days'),
  (7, 'Chidinma Okafor', 'dpo@firstbank.com', '+234-1-448-0001', NOW() - INTERVAL '200 days', 'BSI', 'active', true, NOW() - INTERVAL '200 days'),
  (8, 'Adaora Nwosu', 'dpo@jumia.com', '+234-1-271-0000', NOW() - INTERVAL '180 days', 'IAPP', 'active', true, NOW() - INTERVAL '180 days'),
  (9, 'Babatunde Fashola', 'dpo@lagosstate.gov.ng', '+234-9-461-0000', NOW() - INTERVAL '160 days', 'IAPP', 'active', true, NOW() - INTERVAL '160 days'),
  (10, 'Rotimi Williams', 'dpo@interswitch.com', '+234-1-422-0000', NOW() - INTERVAL '140 days', 'BSI', 'active', true, NOW() - INTERVAL '140 days')
ON CONFLICT DO NOTHING;

-- ─── Enforcement Cases (expand to 10 using financial_penalties IDs 1-7) ──────
INSERT INTO enforcement_cases (penalty_id, organization_id, case_reference, status, opened_at, closed_at, updated_at) VALUES
  (1, 1, 'EC-2026-001', 'closed', NOW() - INTERVAL '90 days', NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days'),
  (2, 2, 'EC-2026-002', 'open', NOW() - INTERVAL '80 days', NULL, NOW() - INTERVAL '1 day'),
  (3, 3, 'EC-2026-003', 'closed', NOW() - INTERVAL '70 days', NOW() - INTERVAL '20 days', NOW() - INTERVAL '20 days'),
  (4, 4, 'EC-2026-004', 'open', NOW() - INTERVAL '15 days', NULL, NOW() - INTERVAL '1 day'),
  (5, 5, 'EC-2026-005', 'open', NOW() - INTERVAL '50 days', NULL, NOW() - INTERVAL '2 days'),
  (6, 6, 'EC-2026-006', 'closed', NOW() - INTERVAL '60 days', NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
  (7, 7, 'EC-2026-007', 'open', NOW() - INTERVAL '30 days', NULL, NOW() - INTERVAL '1 day')
ON CONFLICT (case_reference) DO NOTHING;

-- ─── Remediation Workflows (expand to 15 using integer assigned_to = user ID 1) ─
INSERT INTO remediation_workflows (violation_id, org_id, action_type, priority, description, status, assigned_to, deadline, created_at) VALUES
  (1, 1, 'technical_fix', 'critical', 'SQL Injection Remediation — Customer Portal: patch, WAF, pen test', 'completed', 1, NOW() - INTERVAL '60 days', NOW() - INTERVAL '90 days'),
  (2, 2, 'policy_update', 'high', 'NDPA Consent Framework Migration — all 200K subscribers', 'in_progress', 1, NOW() + INTERVAL '30 days', NOW() - INTERVAL '80 days'),
  (3, 3, 'legal_compliance', 'high', 'Cross-Border Transfer SCCs Implementation', 'completed', 1, NOW() - INTERVAL '20 days', NOW() - INTERVAL '70 days'),
  (4, 4, 'incident_response', 'critical', 'SCADA Ransomware Recovery & Hardening', 'in_progress', 1, NOW() + INTERVAL '14 days', NOW() - INTERVAL '15 days'),
  (5, 5, 'technical_fix', 'critical', 'Policyholder Database Security Overhaul', 'in_progress', 1, NOW() + INTERVAL '45 days', NOW() - INTERVAL '50 days'),
  (6, 6, 'access_control', 'high', 'Insider Threat Controls Enhancement', 'completed', 1, NOW() - INTERVAL '10 days', NOW() - INTERVAL '60 days'),
  (7, 7, 'dpia', 'medium', 'Facial Recognition DPIA Completion', 'in_progress', 1, NOW() + INTERVAL '21 days', NOW() - INTERVAL '30 days'),
  (8, 8, 'legal_compliance', 'medium', 'Reinsurance Data Transfer SCCs', 'completed', 1, NOW() - INTERVAL '3 days', NOW() - INTERVAL '25 days'),
  (9, 9, 'technical_fix', 'medium', 'API Rate Limiting Implementation', 'completed', 1, NOW() - INTERVAL '5 days', NOW() - INTERVAL '20 days'),
  (10, 10, 'policy_update', 'low', 'Data Retention Policy Implementation', 'completed', 1, NOW() - INTERVAL '3 days', NOW() - INTERVAL '15 days'),
  (11, 1, 'consent_audit', 'high', 'Third-Party Data Sharing Consent Audit', 'in_progress', 1, NOW() + INTERVAL '14 days', NOW() - INTERVAL '10 days'),
  (12, 2, 'emergency_patch', 'critical', 'USSD Platform Emergency Security Patch', 'in_progress', 1, NOW() + INTERVAL '7 days', NOW() - INTERVAL '3 days'),
  (13, 3, 'technical_fix', 'high', 'Hospital IT Security Hardening Post-Ransomware', 'completed', 1, NOW() - INTERVAL '10 days', NOW() - INTERVAL '25 days'),
  (14, 4, 'policy_update', 'medium', 'Contractor Device Encryption Policy', 'completed', 1, NOW() - INTERVAL '15 days', NOW() - INTERVAL '35 days'),
  (15, 5, 'access_control', 'medium', 'Claims Adjuster Access Control Review', 'in_progress', 1, NOW() + INTERVAL '21 days', NOW() - INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- ─── TIA Assessments (expand to 10) ──────────────────────────────────────────
-- tia_status: draft, submitted, approved, rejected
INSERT INTO tia_assessments (organization_id, destination_country, legal_basis, risk_level, status, safeguards, reviewed_by, created_at) VALUES
  (1, 'United Kingdom', 'standard_contractual_clauses', 'low', 'approved', 'SCCs reviewed and approved. Transfer limited to KYC data for correspondent banking.', 1, NOW() - INTERVAL '60 days'),
  (2, 'United States', 'adequacy_decision', 'high', 'rejected', 'No adequacy decision for US. US surveillance laws present significant risks.', 1, NOW() - INTERVAL '50 days'),
  (3, 'Germany', 'explicit_consent', 'low', 'approved', 'Germany is EU member state — GDPR applies. Consent obtained from all 500 patients.', 1, NOW() - INTERVAL '40 days'),
  (4, 'United States', 'standard_contractual_clauses', 'high', 'submitted', 'Large volume seismic data transfer. US surveillance risk identified. Supplementary measures required.', 1, NOW() - INTERVAL '30 days'),
  (5, 'United Kingdom', 'standard_contractual_clauses', 'low', 'approved', 'UK GDPR provides adequate protection. SCCs reviewed. Transfer for legitimate reinsurance purposes.', 1, NOW() - INTERVAL '25 days'),
  (6, 'United States', 'standard_contractual_clauses', 'critical', 'submitted', 'Biometric data transfer — highest risk category. US surveillance laws present significant risk.', 1, NOW() - INTERVAL '20 days'),
  (7, 'Netherlands', 'binding_corporate_rules', 'low', 'approved', 'Netherlands is EU member state. BCRs approved by NDPC. Internal group transfer — low risk.', 1, NOW() - INTERVAL '15 days'),
  (8, 'South Africa', 'standard_contractual_clauses', 'medium', 'submitted', 'South Africa has POPIA — comparable framework. Telematics location data requires enhanced scrutiny.', 1, NOW() - INTERVAL '10 days'),
  (9, 'India', 'explicit_consent', 'critical', 'rejected', 'Biometric templates cannot be transferred under NDPA Article 47. Transfer prohibited.', 1, NOW() - INTERVAL '8 days'),
  (10, 'China', 'standard_contractual_clauses', 'critical', 'rejected', 'China data localisation laws conflict with NDPA transfer requirements. SCCs incomplete.', 1, NOW() - INTERVAL '6 days')
ON CONFLICT DO NOTHING;

-- ─── Evidence Packages (expand to 10) ─────────────────────────────────────────
-- evidence_package_status: generating, ready, verified, expired
INSERT INTO evidence_packages (organization_id, package_type, reference_id, reference_type, status, generated_by, created_at) VALUES
  (1, 'forensic_report', 1, 'enforcement_case', 'verified', 'security@accessbank.com', NOW() - INTERVAL '85 days'),
  (2, 'consent_audit', 2, 'enforcement_case', 'ready', 'dpo@mtn.ng', NOW() - INTERVAL '75 days'),
  (3, 'transfer_documentation', 3, 'enforcement_case', 'verified', 'dpo@dangote.com', NOW() - INTERVAL '65 days'),
  (4, 'incident_response_log', 4, 'enforcement_case', 'generating', 'security@nnpc.gov.ng', NOW() - INTERVAL '15 days'),
  (5, 'breach_investigation', 5, 'enforcement_case', 'ready', 'dpo@zenithbank.com', NOW() - INTERVAL '45 days'),
  (6, 'insider_threat_investigation', 6, 'enforcement_case', 'verified', 'security@airtel.ng', NOW() - INTERVAL '55 days'),
  (7, 'dpia_documentation', 7, 'enforcement_case', 'ready', 'dpo@firstbank.com', NOW() - INTERVAL '25 days'),
  (8, 'scc_documentation', 1, 'enforcement_case', 'verified', 'dpo@jumia.com', NOW() - INTERVAL '20 days'),
  (9, 'api_security_audit', 2, 'enforcement_case', 'verified', 'security@lagosstate.gov.ng', NOW() - INTERVAL '18 days'),
  (10, 'retention_policy_docs', 3, 'enforcement_case', 'verified', 'dpo@interswitch.com', NOW() - INTERVAL '12 days')
ON CONFLICT DO NOTHING;

-- ─── Notification Inbox (only user_id=1 which exists) ────────────────────────
INSERT INTO notification_inbox (user_id, title, message, notification_type, priority, is_read, created_at) VALUES
  (1, 'Critical Breach Alert: 9mobile USSD Zero-Day', 'A critical data breach has been reported by 9mobile. 1,000,000 subscriber records at risk. Immediate action required.', 'breach_alert', 'critical', false, NOW() - INTERVAL '3 days'),
  (1, 'New Penalty Appeal: Glo Mobile — N42M', 'Glo Mobile has filed an appeal against the N42M penalty for the SIM swap breach. Review required within 14 days.', 'penalty_appeal', 'high', false, NOW() - INTERVAL '2 days'),
  (1, 'AML Escalation: Crypto Exchange NG — N420M', 'AML case AML-2026-019 has been escalated. Suspected money laundering via unlicensed crypto exchange. CBN referral pending.', 'aml_alert', 'critical', false, NOW() - INTERVAL '2 days'),
  (1, 'SLA Breach: Stanbic IBTC — Breach Notification Overdue', 'Stanbic IBTC Bank has not submitted breach notification within 72-hour requirement. Enforcement action may be required.', 'sla_breach', 'high', true, NOW() - INTERVAL '8 days'),
  (1, 'New DSAR Submission: Access Bank Customer', 'A data subject access request has been submitted for Access Bank. 30-day response deadline approaching.', 'dsar_notification', 'medium', true, NOW() - INTERVAL '5 days'),
  (1, 'Penalty Paid: NIMC — N30M', 'NIMC has paid the N30M penalty for the NIN database exposure. Case EC-2026-009 is now closed.', 'payment_confirmed', 'low', true, NOW() - INTERVAL '5 days'),
  (1, 'New DPCO Application: CyberShield Nigeria Ltd', 'A new DPCO accreditation application has been received. Review required within 30 days.', 'dpco_application', 'medium', false, NOW() - INTERVAL '4 days'),
  (1, 'Compliance Score Drop: Eko Hospital — 61/100', 'Eko Hospital compliance score has dropped to 61/100 (from 68). DPIA failure and ransomware incident contributing factors.', 'compliance_alert', 'high', false, NOW() - INTERVAL '3 days'),
  (1, 'Cross-Border Transfer Rejected: Jumia — China', 'Transfer approval request for Jumia (China/Alibaba Cloud) has been rejected. Applicant notified.', 'transfer_decision', 'medium', true, NOW() - INTERVAL '3 days'),
  (1, 'New AML Case: Apex Investment Corp — N500M Ponzi', 'New AML case AML-2026-007 filed. Suspected Ponzi scheme with 2,000+ victims. EFCC coordination required.', 'aml_alert', 'critical', true, NOW() - INTERVAL '15 days'),
  (1, 'Task Assigned: Review Consent Audit — GTBank', 'You have been assigned to review the consent records audit package for EC-2026-002.', 'task_assigned', 'medium', false, NOW() - INTERVAL '75 days'),
  (1, 'Deadline Reminder: EC-2026-004 Response Due', 'Audit response for EC-2026-004 (Airtel SCADA ransomware) is overdue. Escalation in 48 hours.', 'deadline_reminder', 'high', false, NOW() - INTERVAL '15 days'),
  (1, 'Monthly Compliance Report Ready', 'The April 2026 monthly compliance report has been generated. 10 organizations reviewed, 3 penalties issued.', 'report_ready', 'low', false, NOW() - INTERVAL '1 day'),
  (1, 'Watchlist Alert: New OFAC SDN Match', 'Global Trade Partners Ltd has been matched against the OFAC SDN list. AML case AML-2026-003 opened.', 'watchlist_alert', 'critical', false, NOW() - INTERVAL '25 days'),
  (1, 'Regulatory Report Overdue: NNPC Annual Compliance 2025', 'NNPC has not submitted its 2025 Annual Compliance Report. Deadline was 90 days ago. Enforcement action initiated.', 'report_overdue', 'high', false, NOW() - INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- ─── Regulatory Reports (expand to 20 using org IDs 1-10) ────────────────────
INSERT INTO regulatory_reports (organization_id, report_type, report_period, status, submitted_at, created_at) VALUES
  (1, 'annual_compliance', '2025', 'submitted', NOW() - INTERVAL '90 days', NOW() - INTERVAL '90 days'),
  (2, 'breach_notification', '2026-Q1', 'submitted', NOW() - INTERVAL '100 days', NOW() - INTERVAL '100 days'),
  (3, 'dpia_summary', '2025', 'submitted', NOW() - INTERVAL '80 days', NOW() - INTERVAL '80 days'),
  (4, 'annual_compliance', '2025', 'overdue', NULL, NOW() - INTERVAL '30 days'),
  (5, 'breach_notification', '2026-Q1', 'submitted', NOW() - INTERVAL '50 days', NOW() - INTERVAL '50 days'),
  (6, 'annual_compliance', '2025', 'submitted', NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days'),
  (7, 'dpia_summary', '2025', 'submitted', NOW() - INTERVAL '70 days', NOW() - INTERVAL '70 days'),
  (8, 'annual_compliance', '2025', 'submitted', NOW() - INTERVAL '55 days', NOW() - INTERVAL '55 days'),
  (9, 'annual_compliance', '2025', 'submitted', NOW() - INTERVAL '45 days', NOW() - INTERVAL '45 days'),
  (10, 'dpia_summary', '2025', 'submitted', NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'),
  (1, 'breach_notification', '2026-Q1', 'submitted', NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days'),
  (2, 'breach_notification', '2026-Q1', 'pending', NULL, NOW() - INTERVAL '3 days'),
  (3, 'annual_compliance', '2025', 'submitted', NOW() - INTERVAL '25 days', NOW() - INTERVAL '25 days'),
  (4, 'annual_compliance', '2024', 'submitted', NOW() - INTERVAL '365 days', NOW() - INTERVAL '365 days'),
  (5, 'annual_compliance', '2025', 'submitted', NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days'),
  (1, 'quarterly_review', '2026-Q1', 'submitted', NOW() - INTERVAL '20 days', NOW() - INTERVAL '20 days'),
  (2, 'annual_compliance', '2025', 'submitted', NOW() - INTERVAL '85 days', NOW() - INTERVAL '85 days'),
  (3, 'quarterly_review', '2026-Q1', 'submitted', NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days'),
  (5, 'dpia_summary', '2025', 'submitted', NOW() - INTERVAL '48 days', NOW() - INTERVAL '48 days'),
  (6, 'quarterly_review', '2026-Q1', 'submitted', NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days')
ON CONFLICT DO NOTHING;

-- ─── Changelogs (expand to 15) ────────────────────────────────────────────────
INSERT INTO changelogs (version, title, body, category, is_published, published_at, created_at) VALUES
  ('v31.0.0', 'Phase 31 Production Sprint', 'Comprehensive seed data, enhanced CRUD, security hardening, Docker production config, all 882 tests passing', 'major', true, NOW(), NOW()),
  ('v30.0.0', 'Phase 30 — KYC Export, AML Search, Penalty Dashboard', 'KYC CSV export, AML real-time search/filter, Penalty metrics dashboard with Recharts charts', 'major', true, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
  ('v29.0.0', 'Phase 29 — Test Suite 882/882', 'All 882 tests passing, Phase 13 schema fixes, security score 100/100', 'major', true, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
  ('v28.0.0', 'Phase 28 — Production Hardening', 'Security audit, Docker production config, K8s manifests, smoke tests', 'major', true, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
  ('v27.0.0', 'Phase 27 — DPCO Portal', 'Full DPCO accreditation workflow, client management, audit workspace', 'major', true, NOW() - INTERVAL '7 days', NOW() - INTERVAL '7 days'),
  ('v26.0.0', 'Phase 26 — Banking Compliance Suite', 'KYC management, AML cases, CBN reports, correspondent banking', 'major', true, NOW() - INTERVAL '14 days', NOW() - INTERVAL '14 days'),
  ('v25.0.0', 'Phase 25 — Phase 13 Features', 'Consent records, DPO appointments, penalty calculator, bulk DSAR, cross-border monitor', 'major', true, NOW() - INTERVAL '21 days', NOW() - INTERVAL '21 days'),
  ('v24.0.0', 'Phase 24 — AI/ML Hub', 'AI governance scoring, model registry, automated decisions, ethics board', 'major', true, NOW() - INTERVAL '28 days', NOW() - INTERVAL '28 days'),
  ('v23.0.0', 'Phase 23 — Sector Compliance', 'Sector-specific dashboards, benchmarking, cross-sector alerts', 'major', true, NOW() - INTERVAL '35 days', NOW() - INTERVAL '35 days'),
  ('v22.0.0', 'Phase 22 — Citizen Rights Portal', 'DSAR lifecycle, public portal, parental consent, whistleblower portal', 'major', true, NOW() - INTERVAL '42 days', NOW() - INTERVAL '42 days'),
  ('v21.0.0', 'Phase 21 — Enforcement Workflow', 'Enforcement cases, evidence packages, penalty appeals, remediation workflows', 'major', true, NOW() - INTERVAL '49 days', NOW() - INTERVAL '49 days'),
  ('v20.0.0', 'Phase 20 — Financial Enforcement', 'TigerBeetle ledger, Mojaloop, NIP reconciliation, fine payment gateway', 'major', true, NOW() - INTERVAL '56 days', NOW() - INTERVAL '56 days'),
  ('v1.0.0', 'Initial Release — NDSEP Foundation', 'Core platform: 6 layers, 18 workers, PostgreSQL, tRPC, React', 'major', true, NOW() - INTERVAL '180 days', NOW() - INTERVAL '180 days'),
  ('v1.1.0', 'Security Patch — Helmet CSP', 'Strengthened Content Security Policy, rate limiting, CORS restrictions', 'patch', true, NOW() - INTERVAL '170 days', NOW() - INTERVAL '170 days'),
  ('v1.2.0', 'Performance — DB Indexes', 'Added composite indexes on audit_logs, compliance_violations, network_events', 'minor', true, NOW() - INTERVAL '160 days', NOW() - INTERVAL '160 days')
ON CONFLICT DO NOTHING;

-- ─── Penalty Appeals (expand to 10 using financial_penalties IDs 1-7) ────────
-- submitted_by is NOT NULL — use user ID 1
INSERT INTO penalty_appeals (penalty_id, organization_id, submitted_by, grounds_for_appeal, status, contact_email, requested_outcome, created_at, updated_at) VALUES
  (5, 5, 1, 'The breach was caused by a third-party vendor. We have terminated the contract and implemented additional controls. We request a 50% reduction in penalty.', 'under_review', 'dpo@zenithbank.com', 'penalty_reduction', NOW() - INTERVAL '40 days', NOW() - INTERVAL '1 day'),
  (2, 2, 1, 'The SIM swap attacks were conducted by sophisticated criminal actors. We had industry-standard controls in place. Requesting full waiver.', 'dismissed', 'dpo@mtn.ng', 'full_waiver', NOW() - INTERVAL '90 days', NOW() - INTERVAL '60 days'),
  (1, 1, 1, 'Notification was delayed due to ongoing forensic investigation. We notified within 72 hours of confirming the breach scope. Requesting 25% reduction.', 'upheld', 'dpo@accessbank.com', 'penalty_reduction', NOW() - INTERVAL '80 days', NOW() - INTERVAL '50 days'),
  (3, 3, 1, 'The USSD vulnerability was a zero-day exploit. We patched within 4 hours of disclosure. Requesting full waiver.', 'under_review', 'dpo@dangote.com', 'full_waiver', NOW() - INTERVAL '2 days', NOW()),
  (4, 4, 1, 'The motor claims database exposure was caused by a misconfiguration by our cloud provider. We have SLA remedies in place.', 'under_review', 'dpo@nnpc.gov.ng', 'penalty_reduction', NOW() - INTERVAL '45 days', NOW() - INTERVAL '2 days'),
  (6, 6, 1, 'The marketing SMS was sent under a legacy consent framework that predated NDPA. We have since migrated all subscribers to NDPA-compliant consent.', 'under_review', 'dpo@airtel.ng', 'penalty_reduction', NOW() - INTERVAL '70 days', NOW() - INTERVAL '5 days'),
  (7, 7, 1, 'The facial recognition system was a pilot with only 50 employees. We argue this does not constitute high-risk processing under NDPA Article 35.', 'dismissed', 'dpo@firstbank.com', 'full_waiver', NOW() - INTERVAL '20 days', NOW() - INTERVAL '10 days')
ON CONFLICT DO NOTHING;

-- ─── Transfer Approvals (expand to 15) ────────────────────────────────────────
-- reference_id is NOT NULL — generate unique IDs
INSERT INTO transfer_approvals (reference_id, organization_id, dataset_name, source_country, destination_country, destination_entity, volume_gb, data_classification, business_justification, status, requested_at) VALUES
  ('TA-2026-001', 1, 'Customer KYC Records', 'Nigeria', 'United Kingdom', 'Barclays Bank PLC', 2.5, 'tier2_financial', 'Correspondent banking relationship — KYC sharing for AML compliance', 'approved', NOW() - INTERVAL '60 days'),
  ('TA-2026-002', 2, 'Subscriber Location Data', 'Nigeria', 'United States', 'AT&T International', 15.0, 'tier1_pii', 'Network roaming agreement — location data for billing', 'denied', NOW() - INTERVAL '50 days'),
  ('TA-2026-003', 3, 'Patient Clinical Records', 'Nigeria', 'Germany', 'Charite Hospital Berlin', 0.8, 'tier3_health', 'Medical research collaboration — anonymised patient data', 'approved', NOW() - INTERVAL '40 days'),
  ('TA-2026-004', 4, 'Seismic Survey Data', 'Nigeria', 'United States', 'Shell International E&P', 500.0, 'tier2_financial', 'Parent company data sharing — operational necessity', 'under_review', NOW() - INTERVAL '30 days'),
  ('TA-2026-005', 5, 'Policyholder Claims Data', 'Nigeria', 'United Kingdom', 'Lloyds of London', 3.2, 'tier2_financial', 'Reinsurance treaty — claims data sharing required', 'approved', NOW() - INTERVAL '25 days'),
  ('TA-2026-006', 6, 'NIN Verification Logs', 'Nigeria', 'United States', 'IDEMIA Inc.', 1.0, 'tier4_government', 'Biometric verification system maintenance', 'under_review', NOW() - INTERVAL '20 days'),
  ('TA-2026-007', 7, 'Employee HR Records', 'Nigeria', 'Netherlands', 'Dangote Group HQ', 0.5, 'tier1_pii', 'Group HR management — payroll processing', 'approved', NOW() - INTERVAL '15 days'),
  ('TA-2026-008', 8, 'Motor Insurance Telematics', 'Nigeria', 'South Africa', 'Discovery Insure', 8.0, 'tier1_pii', 'Telematics data sharing for risk modelling', 'under_review', NOW() - INTERVAL '10 days'),
  ('TA-2026-009', 9, 'NIN Biometric Templates', 'Nigeria', 'India', 'HID Global', 50.0, 'tier4_government', 'Biometric system upgrade — template migration', 'denied', NOW() - INTERVAL '8 days'),
  ('TA-2026-010', 10, 'Customer Order History', 'Nigeria', 'China', 'Alibaba Cloud', 25.0, 'tier1_pii', 'Cloud backup and disaster recovery', 'denied', NOW() - INTERVAL '6 days'),
  ('TA-2026-011', 1, 'Credit Scoring Data', 'Nigeria', 'United Kingdom', 'Experian Plc', 1.5, 'tier2_financial', 'Credit bureau data sharing for scoring model', 'approved', NOW() - INTERVAL '5 days'),
  ('TA-2026-012', 2, 'Subscriber CDR Data', 'Nigeria', 'France', 'Orange S.A.', 100.0, 'tier1_pii', 'International roaming — CDR exchange for billing', 'under_review', NOW() - INTERVAL '4 days'),
  ('TA-2026-013', 3, 'Patient Genomic Data', 'Nigeria', 'United States', 'NIH Genomic Data Commons', 5.0, 'tier3_health', 'Genomic research collaboration — consent obtained', 'under_review', NOW() - INTERVAL '3 days'),
  ('TA-2026-014', 4, 'Drilling Operations Data', 'Nigeria', 'United States', 'Halliburton', 200.0, 'tier2_financial', 'Oilfield services contract — operational data sharing', 'approved', NOW() - INTERVAL '2 days'),
  ('TA-2026-015', 5, 'Agent Commission Records', 'Nigeria', 'United Kingdom', 'AXA Group', 0.3, 'tier2_financial', 'Group financial reporting — commission reconciliation', 'approved', NOW() - INTERVAL '1 day')
ON CONFLICT (reference_id) DO NOTHING;

SELECT 'Phase 31 seed data inserted successfully' AS status;
