-- ============================================================
-- NDSEP Final Comprehensive Seed Script v4
-- All enum values and column names verified against live schema
-- ============================================================

-- ─── Case Timeline ────────────────────────────────────────────────────────────
-- Columns: id, case_id, changed_by_user_id, changed_by_name, from_status, to_status, note, nitda_ref, created_at
INSERT INTO case_timeline (case_id, changed_by_name, from_status, to_status, note, nitda_ref, created_at)
VALUES
(1,'NDPC Enforcement Officer',NULL,'open','Enforcement case opened following compliance violation detection','NITDA-2026-0001',NOW()-INTERVAL '25 days'),
(1,'NDPC Enforcement Officer','open','open','Formal notice issued to First Bank of Nigeria Plc','NITDA-2026-0001',NOW()-INTERVAL '24 days'),
(1,'First Bank Compliance Team','open','open','Organisation submitted initial response to formal notice',NULL,NOW()-INTERVAL '20 days'),
(2,'NDPC Enforcement Officer',NULL,'open','Enforcement case opened for MTN Nigeria','NITDA-2026-0002',NOW()-INTERVAL '30 days'),
(2,'NDPC Enforcement Officer','open','open','Formal notice issued to MTN Nigeria','NITDA-2026-0002',NOW()-INTERVAL '29 days'),
(2,'NDPC Enforcement Officer','open','open','Case escalated due to non-response after 15 days','NITDA-2026-0002',NOW()-INTERVAL '15 days'),
(3,'NDPC Enforcement Officer',NULL,'open','Enforcement case opened for LUTH','NITDA-2026-0003',NOW()-INTERVAL '20 days'),
(3,'NDPC Enforcement Officer','open','open','Formal notice issued to Lagos University Teaching Hospital','NITDA-2026-0003',NOW()-INTERVAL '19 days'),
(3,'LUTH Compliance','open','open','Organisation submitted evidence of remediation',NULL,NOW()-INTERVAL '10 days'),
(4,'NDPC Enforcement Officer',NULL,'open','Enforcement case opened for Federal Ministry of Education','NITDA-2026-0004',NOW()-INTERVAL '60 days'),
(4,'NDPC Enforcement Officer','open','open','Formal notice issued','NITDA-2026-0004',NOW()-INTERVAL '59 days'),
(4,'FME Finance','open','closed','Penalty of N25M paid in full',NULL,NOW()-INTERVAL '20 days'),
(4,'NDPC Enforcement Officer','open','closed','Case closed following full compliance',NULL,NOW()-INTERVAL '10 days'),
(5,'NDPC Enforcement Officer',NULL,'open','Enforcement case opened for NNPC','NITDA-2026-0005',NOW()-INTERVAL '15 days'),
(5,'NDPC Enforcement Officer','open','open','Formal notice issued to NNPC','NITDA-2026-0005',NOW()-INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── Financial Ledger ─────────────────────────────────────────────────────────
-- Valid tx_types: penalty, fine, settlement, refund, escrow, transfer
INSERT INTO financial_ledger (transaction_id, organization_id, penalty_id, tx_type, amount, currency, description, status, created_at)
VALUES
('TXN-LED-001',4,4,'penalty',25000000,'NGN','Penalty payment - NDPC-ENF-2026-004','settled',NOW()-INTERVAL '20 days'),
('TXN-LED-002',1,1,'penalty',50000000,'NGN','Penalty assessed for data breach','pending',NOW()-INTERVAL '25 days'),
('TXN-LED-003',2,2,'penalty',100000000,'NGN','Penalty assessed for NDPR violations','pending',NOW()-INTERVAL '30 days'),
('TXN-LED-004',3,3,'penalty',35000000,'NGN','Penalty assessed for consent violations','pending',NOW()-INTERVAL '20 days'),
('TXN-LED-005',5,5,'penalty',15000000,'NGN','Penalty assessed for data transfer violations','pending',NOW()-INTERVAL '15 days'),
('TXN-LED-006',4,4,'fine',500000,'NGN','Late payment interest charge','settled',NOW()-INTERVAL '15 days'),
('TXN-LED-007',1,NULL,'fine',5000000,'NGN','Fine for compliance violation #1','pending',NOW()-INTERVAL '10 days'),
('TXN-LED-008',2,NULL,'fine',8000000,'NGN','Fine for compliance violation #2','pending',NOW()-INTERVAL '8 days')
ON CONFLICT DO NOTHING;

-- ─── Residency Checks ─────────────────────────────────────────────────────────
-- Valid residency_status: compliant, violation, warning, unknown
INSERT INTO residency_checks (organization_id, data_asset_name, data_classification, storage_location, storage_country, is_within_borders, residency_status, violation_reason, remediation_action, checked_at, created_at)
VALUES
(1,'First Bank Customer Database','tier2_financial','Lagos, Nigeria','Nigeria',true,'compliant',NULL,NULL,NOW()-INTERVAL '7 days',NOW()-INTERVAL '7 days'),
(2,'MTN Subscriber PII Database','tier1_pii','Dublin, Ireland','Ireland',false,'violation','Customer PII stored outside Nigeria without NDPC approval','Migrate to Nigerian data centre within 90 days',NOW()-INTERVAL '5 days',NOW()-INTERVAL '5 days'),
(3,'LUTH Patient Health Records','tier3_health','London, UK','United Kingdom',false,'violation','Patient health records stored in UK without adequate safeguards','Implement data localisation or obtain NDPC transfer approval',NOW()-INTERVAL '3 days',NOW()-INTERVAL '3 days'),
(4,'FME Student Records','tier1_pii','Lagos, Nigeria','Nigeria',true,'compliant',NULL,NULL,NOW()-INTERVAL '2 days',NOW()-INTERVAL '2 days'),
(5,'NNPC Operational Data','tier5_public','Houston, USA','United States',false,'violation','Operational data stored in US without proper transfer mechanism','Obtain standard contractual clauses or migrate to Nigeria',NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── Monitoring Snapshots ─────────────────────────────────────────────────────
-- Required non-null: snapshot_type, status, captured_at
INSERT INTO monitoring_snapshots (organization_id, snapshot_type, score, previous_score, delta, status, worker_source, details, alert_triggered, captured_at)
VALUES
(1,'compliance_score',72,87,-15,'degraded','compliance-engine','{"violation_count":8,"open_cases":2,"pending_actions":5}',true,NOW()-INTERVAL '7 days'),
(2,'compliance_score',85,84,1,'healthy','compliance-engine','{"violation_count":3,"open_cases":1,"pending_actions":2}',false,NOW()-INTERVAL '7 days'),
(3,'compliance_score',68,75,-7,'degraded','compliance-engine','{"violation_count":12,"open_cases":3,"pending_actions":8}',true,NOW()-INTERVAL '7 days'),
(4,'compliance_score',91,88,3,'healthy','compliance-engine','{"violation_count":1,"open_cases":0,"pending_actions":1}',false,NOW()-INTERVAL '7 days'),
(5,'compliance_score',78,80,-2,'healthy','compliance-engine','{"violation_count":5,"open_cases":2,"pending_actions":3}',false,NOW()-INTERVAL '7 days'),
(1,'monthly_summary',72,87,-15,'degraded','compliance-engine','{"month":"2026-04","violations_by_type":{"consent":3,"transfer":2,"breach":3}}',true,NOW()-INTERVAL '14 days'),
(2,'monthly_summary',85,84,1,'healthy','compliance-engine','{"month":"2026-04","violations_by_type":{"consent":1,"retention":2}}',false,NOW()-INTERVAL '14 days'),
(3,'monthly_summary',68,75,-7,'degraded','compliance-engine','{"month":"2026-04","violations_by_type":{"consent":5,"breach":4,"transfer":3}}',true,NOW()-INTERVAL '14 days')
ON CONFLICT DO NOTHING;

-- ─── Onboarding Phases ────────────────────────────────────────────────────────
-- Valid onboarding_phase enum: registration, asset_inventory, data_catalog, self_assessment, initial_audit, remediation, certified
-- portal_submissions inserted in v3 seed — get their IDs
INSERT INTO portal_submissions (submission_token, organization_id, org_name, org_sector, org_country, contact_name, contact_email, contact_phone, current_phase, self_assessment_score, compliance_score, notes, submitted_at, updated_at)
VALUES
('SUB-TOKEN-001',1,'First Bank of Nigeria Plc','Financial Services','Nigeria','Adewale Adeyemi','dpo@firstbank.com','+2348012345678','certified',85,72,'Annual compliance return',NOW()-INTERVAL '30 days',NOW()-INTERVAL '20 days'),
('SUB-TOKEN-002',2,'MTN Nigeria Communications','Telecommunications','Nigeria','Chukwuemeka Obi','dpo@mtn.com','+2348023456789','initial_audit',80,85,'Data breach notification',NOW()-INTERVAL '15 days',NOW()-INTERVAL '10 days'),
('SUB-TOKEN-003',3,'Lagos University Teaching Hospital','Healthcare','Nigeria','Dr. Amaka Nwosu','dpo@luth.gov.ng','+2348034567890','self_assessment',70,68,'DPIA submission',NOW()-INTERVAL '25 days',NOW()-INTERVAL '18 days'),
('SUB-TOKEN-004',4,'Federal Ministry of Education','Government','Nigeria','Ibrahim Suleiman','dpo@fme.gov.ng','+2348045678901','certified',90,91,'Privacy policy registration',NOW()-INTERVAL '20 days',NOW()-INTERVAL '15 days'),
('SUB-TOKEN-005',5,'Nigerian National Petroleum Corporation','Energy','Nigeria','Ngozi Okonkwo','dpo@nnpc.gov.ng','+2348056789012','registration',75,78,'Cross-border transfer approval',NOW()-INTERVAL '5 days',NOW()-INTERVAL '3 days'),
('SUB-TOKEN-006',6,'Jumia Technologies AG','E-Commerce','Nigeria','Bisi Okafor','legal@jumia.com','+2348067890123','self_assessment',65,NULL,'Response to consumer complaint',NOW()-INTERVAL '3 days',NOW()-INTERVAL '2 days')
ON CONFLICT (submission_token) DO NOTHING;

-- Insert onboarding phases using valid enum values
INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
SELECT s.id, 'registration', 'completed', NOW()-INTERVAL '180 days', NOW()-INTERVAL '175 days', 'Organisation registered successfully', NOW()-INTERVAL '180 days'
FROM portal_submissions s WHERE s.submission_token='SUB-TOKEN-001'
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
SELECT s.id, 'asset_inventory', 'completed', NOW()-INTERVAL '175 days', NOW()-INTERVAL '170 days', 'Asset inventory completed: 45 data assets catalogued', NOW()-INTERVAL '175 days'
FROM portal_submissions s WHERE s.submission_token='SUB-TOKEN-001'
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
SELECT s.id, 'data_catalog', 'completed', NOW()-INTERVAL '170 days', NOW()-INTERVAL '165 days', 'Data catalog completed and DPO appointed', NOW()-INTERVAL '170 days'
FROM portal_submissions s WHERE s.submission_token='SUB-TOKEN-001'
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
SELECT s.id, 'self_assessment', 'completed', NOW()-INTERVAL '165 days', NOW()-INTERVAL '150 days', 'Self-assessment completed - score 78/100', NOW()-INTERVAL '165 days'
FROM portal_submissions s WHERE s.submission_token='SUB-TOKEN-001'
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
SELECT s.id, 'initial_audit', 'completed', NOW()-INTERVAL '150 days', NOW()-INTERVAL '120 days', 'Initial audit completed - 8 findings', NOW()-INTERVAL '150 days'
FROM portal_submissions s WHERE s.submission_token='SUB-TOKEN-001'
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
SELECT s.id, 'remediation', 'completed', NOW()-INTERVAL '120 days', NOW()-INTERVAL '90 days', 'Remediation completed for 7 of 8 findings', NOW()-INTERVAL '120 days'
FROM portal_submissions s WHERE s.submission_token='SUB-TOKEN-001'
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
SELECT s.id, 'certified', 'completed', NOW()-INTERVAL '90 days', NOW()-INTERVAL '85 days', 'Certification granted', NOW()-INTERVAL '90 days'
FROM portal_submissions s WHERE s.submission_token='SUB-TOKEN-001'
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
SELECT s.id, 'registration', 'completed', NOW()-INTERVAL '200 days', NOW()-INTERVAL '195 days', 'Organisation registered successfully', NOW()-INTERVAL '200 days'
FROM portal_submissions s WHERE s.submission_token='SUB-TOKEN-002'
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
SELECT s.id, 'asset_inventory', 'completed', NOW()-INTERVAL '195 days', NOW()-INTERVAL '188 days', 'Asset inventory: 120 data assets catalogued', NOW()-INTERVAL '195 days'
FROM portal_submissions s WHERE s.submission_token='SUB-TOKEN-002'
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
SELECT s.id, 'data_catalog', 'completed', NOW()-INTERVAL '188 days', NOW()-INTERVAL '180 days', 'Data catalog and DPO appointment complete', NOW()-INTERVAL '188 days'
FROM portal_submissions s WHERE s.submission_token='SUB-TOKEN-002'
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
SELECT s.id, 'self_assessment', 'completed', NOW()-INTERVAL '180 days', NOW()-INTERVAL '165 days', 'Self-assessment score: 82/100', NOW()-INTERVAL '180 days'
FROM portal_submissions s WHERE s.submission_token='SUB-TOKEN-002'
ON CONFLICT DO NOTHING;

INSERT INTO onboarding_phases (submission_id, phase, status, started_at, completed_at, notes, created_at)
SELECT s.id, 'initial_audit', 'in_progress', NOW()-INTERVAL '15 days', NULL, 'Audit in progress', NOW()-INTERVAL '15 days'
FROM portal_submissions s WHERE s.submission_token='SUB-TOKEN-002'
ON CONFLICT DO NOTHING;

-- ─── Compliance Audit Returns ─────────────────────────────────────────────────
-- Valid status: draft, submitted, under_review, approved, rejected, amendment_required
INSERT INTO compliance_audit_returns (org_id, reporting_year, title, status, compliance_score, open_violations, breaches_reported, dsars_resolved, submitted_at, created_at)
VALUES
(1,2025,'First Bank Annual Compliance Return 2025','approved',72,8,1,45,'2026-01-31',NOW()-INTERVAL '75 days'),
(2,2025,'MTN Nigeria Annual Compliance Return 2025','approved',85,3,0,120,'2026-01-31',NOW()-INTERVAL '70 days'),
(3,2025,'LUTH Annual Compliance Return 2025','under_review',68,12,2,30,'2026-02-15',NOW()-INTERVAL '55 days'),
(4,2025,'FME Annual Compliance Return 2025','approved',91,1,0,85,'2026-01-31',NOW()-INTERVAL '65 days'),
(5,2025,'NNPC Annual Compliance Return 2025','submitted',78,5,1,200,'2026-02-28',NOW()-INTERVAL '45 days')
ON CONFLICT DO NOTHING;

-- ─── Penalty Appeals ──────────────────────────────────────────────────────────
INSERT INTO penalty_appeals (penalty_id, organization_id, submitted_by, contact_email, grounds_for_appeal, evidence_summary, evidence_urls, requested_outcome, status, created_at)
VALUES
(2,2,'Head of Legal, MTN Nigeria','legal@mtn.com','Disproportionate penalty amount given the nature of the violation and the organisation remediation efforts','Comprehensive remediation plan implemented within 30 days. All affected customers notified.','["remediation_plan.pdf","compliance_certificate.pdf"]'::jsonb,'Reduction of penalty by 50%','under_review',NOW()-INTERVAL '55 days'),
(3,3,'Director of Administration, LUTH','admin@luth.gov.ng','First-time offence with immediate remediation. Penalty amount exceeds NDPR guidelines for healthcare sector.','DPIA completed and approved. Staff training conducted. Data localisation in progress.','["dpia_report.pdf","remediation_evidence.pdf"]'::jsonb,'Waiver of penalty given public health mandate','submitted',NOW()-INTERVAL '50 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Audit Engagements ───────────────────────────────────────────────────
-- Columns: dpco_org_id, client_id, title, current_stage, compliance_score, lead_auditor, planned_start, planned_end, actual_start, actual_end, critical_findings, high_findings, medium_findings, low_findings, notes, created_at
INSERT INTO dpco_audit_engagements (dpco_org_id, client_id, title, current_stage, compliance_score, lead_auditor, planned_start, planned_end, actual_start, actual_end, critical_findings, high_findings, medium_findings, low_findings, notes, created_at)
VALUES
(1,1,'First Bank NDPR Full Compliance Audit 2025','completed',72,'Adewale Adeyemi','2025-10-01','2025-11-30','2025-10-05','2025-11-28',1,2,3,2,'Annual full compliance audit completed with 8 findings',NOW()-INTERVAL '180 days'),
(1,2,'AIICO Insurance NDPR Compliance Audit 2025','completed',85,'Tunde Balogun','2025-11-01','2025-12-31','2025-11-03','2025-12-28',0,1,2,1,'Audit completed with 4 findings, all remediated',NOW()-INTERVAL '150 days'),
(1,3,'Kuda Bank Privacy Programme Review','fieldwork',78,'Sola Oladipo','2026-02-01','2026-03-31','2026-02-05',NULL,0,2,3,1,'Fieldwork in progress',NOW()-INTERVAL '68 days'),
(2,4,'Jumia E-Commerce Privacy Audit','planning',NULL,'Bisi Okafor','2026-04-15','2026-05-31',NULL,NULL,0,0,0,0,'Audit planning underway',NOW()-INTERVAL '14 days'),
(2,5,'Flutterwave Fintech Compliance Audit','reporting',80,'Chioma Eze','2026-01-15','2026-03-15','2026-01-20','2026-03-10',0,1,2,2,'Draft report under review',NOW()-INTERVAL '25 days'),
(3,6,'Lagos State Government NDPA Readiness Assessment','completed',88,'Dr. Amaka Nwosu','2025-12-01','2026-01-31','2025-12-05','2026-01-28',0,0,2,3,'Readiness assessment completed',NOW()-INTERVAL '75 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Training Sessions ───────────────────────────────────────────────────
INSERT INTO dpco_training_sessions (dpco_org_id, client_id, title, description, training_type, status, scheduled_date, completed_date, participant_count, certificates_issued, ndpa_section, facilitator, venue, created_at)
VALUES
(1,1,'NDPR Fundamentals for First Bank Staff','Introduction to NDPR obligations, data subject rights, and breach notification procedures','in_person','completed','2025-11-15','2025-11-15',85,85,'Section 2.1','Adewale Adeyemi','First Bank Head Office, Lagos',NOW()-INTERVAL '150 days'),
(1,1,'Data Breach Response Workshop','Hands-on workshop on breach detection, containment, and regulatory notification','workshop','completed','2025-12-10','2025-12-10',30,30,'Section 4.1','Adewale Adeyemi','First Bank Training Centre',NOW()-INTERVAL '125 days'),
(1,2,'AIICO Insurance Privacy Awareness Training','Privacy awareness training for all AIICO staff covering NDPR and NDPA obligations','virtual','completed','2025-12-20','2025-12-20',200,200,'Section 2.1','Tunde Balogun','Virtual - Zoom',NOW()-INTERVAL '116 days'),
(2,4,'E-Commerce Privacy Compliance for Jumia','NDPR obligations specific to e-commerce: consent, cookies, cross-border transfers','virtual','scheduled','2026-04-20',NULL,NULL,NULL,'Section 2.4','Bisi Okafor','Virtual - Teams',NOW()-INTERVAL '10 days'),
(3,6,'NDPA Deep Dive for Lagos State Officials','Comprehensive NDPA training for senior government officials and DPOs','in_person','completed','2026-01-20','2026-01-20',45,45,'All sections','Dr. Amaka Nwosu','Lagos House, Ikeja',NOW()-INTERVAL '84 days'),
(1,3,'Kuda Bank DPO Certification Preparation','Intensive preparation course for Kuda Bank DPO certification exam','workshop','in_progress','2026-03-15',NULL,12,NULL,'Section 3.1','Adewale Adeyemi','Kuda Bank HQ, Lagos',NOW()-INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Evidence Items ──────────────────────────────────────────────────────
INSERT INTO dpco_evidence_items (dpco_org_id, engagement_id, client_id, title, description, file_url, file_key, file_name, mime_type, file_size, control_ids, status, uploaded_by, created_at)
VALUES
(1,1,1,'First Bank Privacy Policy v3.2','Current privacy policy document reviewed during audit','https://storage.ndsep.ng/evidence/fbngla-privacy-policy-v3.2.pdf','evidence/fbngla-privacy-policy-v3.2.pdf','privacy_policy_v3.2.pdf','application/pdf',245760,ARRAY['CTRL-001','CTRL-002'],'accepted','Adewale Adeyemi',NOW()-INTERVAL '160 days'),
(1,1,1,'First Bank Data Processing Register','Complete register of all data processing activities','https://storage.ndsep.ng/evidence/fbngla-dpr-2025.xlsx','evidence/fbngla-dpr-2025.xlsx','data_processing_register.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',512000,ARRAY['CTRL-003','CTRL-004'],'accepted','Adewale Adeyemi',NOW()-INTERVAL '158 days'),
(1,1,1,'Staff Training Completion Records','Evidence of NDPR training completion for all staff','https://storage.ndsep.ng/evidence/fbngla-training-records.pdf','evidence/fbngla-training-records.pdf','training_completion_records.pdf','application/pdf',189440,ARRAY['CTRL-010'],'accepted','Adewale Adeyemi',NOW()-INTERVAL '155 days'),
(1,2,2,'AIICO Insurance Privacy Notice','Updated privacy notice for policyholders','https://storage.ndsep.ng/evidence/aiico-privacy-notice.pdf','evidence/aiico-privacy-notice.pdf','privacy_notice.pdf','application/pdf',156672,ARRAY['CTRL-001'],'accepted','Tunde Balogun',NOW()-INTERVAL '130 days'),
(1,3,3,'Kuda Bank Consent Management Screenshots','Screenshots of consent management system implementation','https://storage.ndsep.ng/evidence/kuda-consent-mgmt.pdf','evidence/kuda-consent-mgmt.pdf','consent_management_screenshots.pdf','application/pdf',2097152,ARRAY['CTRL-005','CTRL-006'],'under_review','Sola Oladipo',NOW()-INTERVAL '50 days'),
(3,6,6,'Lagos State DPIA for e-Government Portal','Data Protection Impact Assessment for the state e-Government portal','https://storage.ndsep.ng/evidence/lasgov-dpia-egovt.pdf','evidence/lasgov-dpia-egovt.pdf','dpia_egovernment_portal.pdf','application/pdf',1048576,ARRAY['CTRL-007','CTRL-008'],'accepted','Dr. Amaka Nwosu',NOW()-INTERVAL '90 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Verification Statements ────────────────────────────────────────────
INSERT INTO dpco_verification_statements (dpco_org_id, client_org_id, client_name, filing_period, statement_type, statement_text, signed_by, signed_at, verification_code, status, submitted_at, created_at)
VALUES
(1,1,'First Bank of Nigeria Plc','2025-H2','annual_compliance','This is to certify that First Bank of Nigeria Plc has been audited for compliance with the Nigeria Data Protection Regulation (NDPR) and the Nigeria Data Protection Act (NDPA) 2023 for the period July 1 to December 31, 2025. The organisation demonstrates substantial compliance with a score of 72/100. Eight findings were identified, of which one critical finding requires immediate remediation.','Adewale Adeyemi, Lead Auditor','2026-01-15','VS-2026-FBN-001','submitted','2026-01-16',NOW()-INTERVAL '88 days'),
(1,2,'AIICO Insurance Plc','2025-H2','annual_compliance','This is to certify that AIICO Insurance Plc has been audited for compliance with the NDPR and NDPA 2023 for the period July 1 to December 31, 2025. The organisation demonstrates high compliance with a score of 85/100. Four findings were identified, all of which have been remediated.','Tunde Balogun, Lead Auditor','2026-01-28','VS-2026-AIICO-001','approved','2026-01-29',NOW()-INTERVAL '75 days'),
(3,6,'Lagos State Government','2025-FY','annual_compliance','This is to certify that Lagos State Government has been assessed for NDPA 2023 readiness for the fiscal year 2025. The organisation demonstrates strong compliance with a score of 88/100. Five findings were identified, all low to medium severity.','Dr. Amaka Nwosu, Lead Assessor','2026-02-05','VS-2026-LASGOV-001','approved','2026-02-06',NOW()-INTERVAL '67 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Policy Drafts ───────────────────────────────────────────────────────
INSERT INTO dpco_policy_drafts (dpco_org_id, client_org_id, client_name, title, document_type, content, version, status, approved_by, approved_at, created_at)
VALUES
(1,1,'First Bank of Nigeria Plc','First Bank Data Retention Policy v4.0','data_retention_policy','# Data Retention Policy\n\n## 1. Purpose\nThis policy establishes the retention periods for all personal data processed by First Bank of Nigeria Plc in accordance with NDPR and NDPA 2023.\n\n## 2. Retention Periods\n- Customer KYC data: 10 years after account closure\n- Transaction records: 7 years\n- Marketing consent records: 3 years\n- Employee data: 7 years after employment ends\n\n## 3. Disposal\nAll data must be securely disposed of using approved methods upon expiry of retention period.','4.0','approved','Adewale Adeyemi','2026-01-20',NOW()-INTERVAL '85 days'),
(1,3,'Kuda Bank Limited','Kuda Bank Privacy Notice v2.1','privacy_notice','# Privacy Notice\n\n## Who We Are\nKuda Bank Limited is a digital bank licensed by the CBN.\n\n## Data We Collect\nWe collect your BVN, NIN, phone number, email, transaction data, and device information.\n\n## Your Rights\nYou have the right to access, rectify, erase, and port your data under the NDPA 2023.\n\n## Contact\ndpo@kuda.com | +234 800 KUDA','2.1','draft',NULL,NULL,NOW()-INTERVAL '45 days'),
(2,4,'Jumia Technologies AG','Jumia Cookie Policy v1.0','cookie_policy','# Cookie Policy\n\n## What Are Cookies\nCookies are small text files stored on your device when you visit our website.\n\n## Types of Cookies We Use\n- Essential cookies: Required for the website to function\n- Analytics cookies: Help us understand how you use our site\n- Marketing cookies: Used to show you relevant advertisements\n\n## Contact\nlegal@jumia.com','1.0','under_review',NULL,NULL,NOW()-INTERVAL '20 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Accreditation Applications ─────────────────────────────────────────
INSERT INTO dpco_accreditation_applications (org_name, company_reg_no, address, email, phone, lead_auditors, sectors, conflict_declaration, application_type, application_fee, payment_status, status, reference_token, submitted_at, created_at)
VALUES
('DataGuard Nigeria Limited','RC-1234567','14 Broad Street, Lagos Island, Lagos','info@dataguard.ng','+2348011111111',ARRAY['Chidi Okonkwo (CIPP/E)','Amaka Eze (CIPM)'],ARRAY['Financial Services','Healthcare','Government'],true,'new',500000,'paid','approved','DGA-2025-001','2025-06-01',NOW()-INTERVAL '300 days'),
('Privacy Shield Consulting','RC-2345678','22 Adeola Odeku, Victoria Island, Lagos','hello@privacyshield.ng','+2348022222222',ARRAY['Bola Adeyemi (CIPP/E)'],ARRAY['E-Commerce','Telecommunications'],true,'new',500000,'paid','approved','DGA-2025-002','2025-07-15',NOW()-INTERVAL '270 days'),
('Compliance Nexus Africa','RC-3456789','5 Wuse Zone 5, Abuja','contact@compliancenexus.ng','+2348033333333',ARRAY['Ibrahim Musa (CIPM)','Fatima Suleiman (CIPP/E)'],ARRAY['Energy','Government','Healthcare'],true,'new',500000,'paid','under_review','DGA-2026-001','2026-02-01',NOW()-INTERVAL '72 days'),
('TechLegal Partners','RC-4567890','8 Ozumba Mbadiwe, Victoria Island, Lagos','info@techlegal.ng','+2348044444444',ARRAY['Tunde Okafor (CIPP/E)'],ARRAY['Fintech','E-Commerce'],false,'new',500000,'pending','submitted','DGA-2026-002','2026-03-15',NOW()-INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- ─── AI Governance Scores ─────────────────────────────────────────────────────
INSERT INTO ai_governance_scores (org_id, system_name, system_type, risk_category, transparency_score, fairness_score, accountability_score, human_oversight_score, overall_score, ndpa_article24_compliant, findings, recommendations, assessed_by, assessed_at, next_review_date, created_at)
VALUES
(1,'First Bank Credit Scoring Model','ml_model','high_risk',65,70,75,80,72,false,ARRAY['Lack of explainability for loan denials','No bias audit conducted in last 12 months','Limited human review for borderline cases'],ARRAY['Implement LIME/SHAP explainability','Conduct quarterly bias audits','Increase human review threshold from 5% to 20%'],'NDPC AI Governance Team','2026-03-01','2026-09-01',NOW()-INTERVAL '44 days'),
(2,'MTN Nigeria Network Optimisation AI','ml_model','medium_risk',80,85,78,90,83,true,ARRAY['Data minimisation not fully implemented','Retention period for training data unclear'],ARRAY['Implement data minimisation in training pipeline','Define and document retention periods'],'NDPC AI Governance Team','2026-02-15','2026-08-15',NOW()-INTERVAL '58 days'),
(3,'LUTH Diagnostic Imaging AI','ml_model','high_risk',55,60,70,95,70,false,ARRAY['No clinical validation study published','Demographic bias in training data','Insufficient human oversight documentation'],ARRAY['Conduct and publish clinical validation study','Diversify training dataset','Document human oversight procedures'],'NDPC AI Governance Team','2026-01-20','2026-07-20',NOW()-INTERVAL '84 days'),
(4,'FME Student Performance Predictor','ml_model','medium_risk',75,72,80,85,78,true,ARRAY['Parental consent not obtained for minors data use','Model version control documentation incomplete'],ARRAY['Obtain explicit parental consent','Implement MLOps version control'],'NDPC AI Governance Team','2026-03-10','2026-09-10',NOW()-INTERVAL '35 days'),
(5,'NNPC Predictive Maintenance AI','ml_model','low_risk',88,90,85,82,86,true,ARRAY['Third-party model vendor assessment pending'],ARRAY['Complete vendor assessment within 60 days'],'NDPC AI Governance Team','2026-03-20','2026-09-20',NOW()-INTERVAL '25 days')
ON CONFLICT DO NOTHING;

-- ─── In-App Notifications ─────────────────────────────────────────────────────
INSERT INTO in_app_notifications (title, message, severity, category, organization_id, is_read, action_url, created_at)
VALUES
('Critical: Data Breach Detected','First Bank of Nigeria Plc has reported a data breach affecting 50,000 customer records. Immediate investigation required.','critical','enforcement',1,false,'/enforcement',NOW()-INTERVAL '29 days'),
('Penalty Payment Overdue','MTN Nigeria penalty of ₦100M is now 15 days overdue. Escalation to NITDA initiated.','high','penalty',2,false,'/penalties',NOW()-INTERVAL '15 days'),
('DPIA Submission Received','Lagos University Teaching Hospital has submitted a new DPIA for review. Please assign an assessor.','medium','compliance',3,true,'/ndpa/dpia',NOW()-INTERVAL '10 days'),
('Annual Compliance Return Approved','Federal Ministry of Education annual compliance return for 2025 has been approved.','low','compliance',4,true,'/compliance',NOW()-INTERVAL '5 days'),
('New Cross-Border Transfer Request','NNPC has submitted a new cross-border data transfer approval request for review.','medium','transfer',5,false,'/ndpa/transfers',NOW()-INTERVAL '3 days'),
('Worker Health Alert','ML Prediction worker is reporting degraded performance. Compliance scoring may be affected.','high','system',NULL,false,'/workers',NOW()-INTERVAL '2 days'),
('BGP Route Anomaly Detected','Suspected route hijacking detected for MTN Nigeria prefix 105.112.0.0/14. BGP validator flagged.','critical','bgp',2,false,'/bgp',NOW()-INTERVAL '10 days'),
('New DPCO Accreditation Application','Compliance Nexus Africa has submitted a new DPCO accreditation application. Review required.','medium','dpco',NULL,false,'/dpco/accreditation',NOW()-INTERVAL '72 days'),
('Watchlist Match Found','AML screening identified a potential sanctions match for a SWIFT transaction. Case AML-2026-002 opened.','high','aml',NULL,false,'/banking/aml',NOW()-INTERVAL '28 days'),
('Compliance Score Drop Alert','First Bank compliance score dropped from 87 to 72 (-17%). Drift alert generated.','high','compliance',1,false,'/compliance',NOW()-INTERVAL '5 days')
ON CONFLICT DO NOTHING;

-- ─── Notification Settings ────────────────────────────────────────────────────
INSERT INTO notification_settings (organization_id, penalty_issued, penalty_paid, penalty_appeal_filed, penalty_appeal_decision, enforcement_case_opened, certificate_granted, portal_phase_update, citizen_request_update, sla_breach_warning, compliance_score_change, dpo_email, technical_email, legal_email, digest_frequency, created_at)
VALUES
(1,true,true,true,true,true,true,true,true,true,true,'dpo@firstbank.com','it@firstbank.com','legal@firstbank.com','daily',NOW()-INTERVAL '180 days'),
(2,true,true,true,true,true,true,true,true,true,true,'dpo@mtn.com','it@mtn.com','legal@mtn.com','daily',NOW()-INTERVAL '150 days'),
(3,true,false,true,true,true,true,true,true,false,true,'dpo@luth.gov.ng','it@luth.gov.ng','legal@luth.gov.ng','weekly',NOW()-INTERVAL '120 days'),
(4,true,true,false,true,true,true,true,false,true,false,'dpo@fme.gov.ng','it@fme.gov.ng','legal@fme.gov.ng','weekly',NOW()-INTERVAL '90 days'),
(5,true,true,true,true,true,false,true,true,true,true,'dpo@nnpc.gov.ng','it@nnpc.gov.ng','legal@nnpc.gov.ng','daily',NOW()-INTERVAL '60 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Audit Control Ratings ───────────────────────────────────────────────
INSERT INTO dpco_audit_control_ratings (engagement_id, control_id, rating, notes, rated_by, rated_at, created_at)
VALUES
(1,'CTRL-001',3,'Privacy policy exists but lacks granular consent mechanisms','Adewale Adeyemi','2025-11-15',NOW()-INTERVAL '166 days'),
(1,'CTRL-002',4,'Data subject rights procedures well documented','Adewale Adeyemi','2025-11-15',NOW()-INTERVAL '166 days'),
(1,'CTRL-003',2,'Data processing register incomplete for digital channels','Adewale Adeyemi','2025-11-16',NOW()-INTERVAL '165 days'),
(1,'CTRL-004',3,'Vendor management adequate but DPAs need updating','Adewale Adeyemi','2025-11-16',NOW()-INTERVAL '165 days'),
(1,'CTRL-005',4,'Consent management system implemented','Adewale Adeyemi','2025-11-17',NOW()-INTERVAL '164 days'),
(1,'CTRL-006',1,'Data breach response plan not tested in last 12 months','Adewale Adeyemi','2025-11-17',NOW()-INTERVAL '164 days'),
(2,'CTRL-001',4,'Privacy notice comprehensive and accessible','Tunde Balogun','2025-12-05',NOW()-INTERVAL '130 days'),
(2,'CTRL-002',5,'Excellent data subject rights management system','Tunde Balogun','2025-12-05',NOW()-INTERVAL '130 days'),
(2,'CTRL-003',4,'Processing register complete and up to date','Tunde Balogun','2025-12-06',NOW()-INTERVAL '129 days'),
(2,'CTRL-004',3,'Some vendor DPAs require renewal','Tunde Balogun','2025-12-06',NOW()-INTERVAL '129 days'),
(6,'CTRL-001',5,'Comprehensive privacy policy aligned with NDPA','Dr. Amaka Nwosu','2026-01-15',NOW()-INTERVAL '89 days'),
(6,'CTRL-002',4,'Data subject rights well managed','Dr. Amaka Nwosu','2026-01-15',NOW()-INTERVAL '89 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Clients ─────────────────────────────────────────────────────────────
INSERT INTO dpco_clients (dpco_org_id, org_name, org_sector, org_location, contact_name, contact_email, contact_phone, status, risk_level, compliance_score, onboarded_at, created_at)
VALUES
(1,'First Bank of Nigeria Plc','Financial Services','Lagos, Nigeria','Adewale Adeyemi','dpo@firstbank.com','+2348012345678','active','low',72,'2025-06-01',NOW()-INTERVAL '300 days'),
(1,'AIICO Insurance Plc','Insurance','Lagos, Nigeria','Tunde Balogun','compliance@aiico.com','+2348023456789','active','medium',85,'2025-07-15',NOW()-INTERVAL '270 days'),
(1,'Kuda Bank Limited','Fintech','Lagos, Nigeria','Sola Oladipo','dpo@kuda.com','+2348034567890','active','medium',78,'2025-08-01',NOW()-INTERVAL '255 days'),
(2,'Jumia Technologies AG','E-Commerce','Lagos, Nigeria','Bisi Okafor','legal@jumia.com','+2348045678901','active','high',65,'2025-09-01',NOW()-INTERVAL '225 days'),
(2,'Flutterwave Inc','Fintech','Lagos, Nigeria','Chioma Eze','compliance@flutterwave.com','+2348056789012','active','medium',80,'2025-10-01',NOW()-INTERVAL '195 days'),
(3,'Lagos State Government','Government','Lagos, Nigeria','Dr. Amaka Nwosu','dpo@lasgov.ng','+2348067890123','active','low',88,'2025-11-01',NOW()-INTERVAL '165 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Audit Logs ──────────────────────────────────────────────────────────
INSERT INTO dpco_audit_logs (dpco_org_id, action, actor_id, details, created_at)
VALUES
(1,'engagement_created',1,'Created audit engagement for First Bank',NOW()-INTERVAL '180 days'),
(1,'report_generated',1,'Generated final audit report for First Bank',NOW()-INTERVAL '153 days'),
(1,'verification_issued',1,'Issued verification statement for First Bank',NOW()-INTERVAL '88 days'),
(2,'engagement_created',1,'Created audit engagement for AIICO Insurance',NOW()-INTERVAL '150 days'),
(2,'report_generated',1,'Generated final audit report for AIICO Insurance',NOW()-INTERVAL '121 days'),
(3,'engagement_created',1,'Created audit engagement for Kuda',NOW()-INTERVAL '68 days'),
(3,'training_scheduled',1,'Scheduled e-commerce privacy training for Jumia',NOW()-INTERVAL '10 days'),
(1,'client_onboarded',1,'Jumia Technologies AG onboarded as DPCO client',NOW()-INTERVAL '225 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Risk Predictions ────────────────────────────────────────────────────
INSERT INTO dpco_risk_predictions (organisation_id, risk_score, risk_level, primary_risk_factors, audit_priority, recommended_audit_frequency, mitigation_actions, predicted_at)
VALUES
(1,35,'low',ARRAY['Strong governance framework','Regular staff training','Updated privacy policies'],'low','annual',ARRAY['Continue quarterly reviews','Maintain DPO engagement'],NOW()-INTERVAL '13 days'),
(2,55,'medium',ARRAY['Legacy system retention gaps','Incomplete staff training','Pending policy updates'],'medium','semi_annual',ARRAY['Prioritise legacy system remediation','Complete staff training programme'],NOW()-INTERVAL '13 days'),
(3,65,'medium',ARRAY['DPIA in progress','Cross-border transfer pending approval','New data processing activities'],'medium','quarterly',ARRAY['Complete DPIA','Obtain transfer approval','Update privacy notice'],NOW()-INTERVAL '13 days'),
(4,20,'low',ARRAY['Excellent compliance posture','Strong DPO engagement','Regular audits'],'low','annual',ARRAY['Maintain current practices','Consider advanced certification'],NOW()-INTERVAL '13 days'),
(5,75,'high',ARRAY['Multiple audit findings','Slow remediation pace','Government sector complexity'],'high','quarterly',ARRAY['Accelerate remediation','Engage NDPC proactively','Implement quick wins'],NOW()-INTERVAL '13 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO AI Gap Analyses ─────────────────────────────────────────────────────
INSERT INTO dpco_ai_gap_analyses (engagement_id, overall_score, executive_summary, ratings_json, created_at)
VALUES
(1,72,'First Bank demonstrates substantial NDPR compliance with 3 gaps identified requiring remediation.','{"gaps":[{"id":"GAP-001","domain":"consent","description":"Analytics consent not granular","severity":"high"},{"id":"GAP-002","domain":"retention","description":"Retention schedule incomplete for digital channels","severity":"medium"},{"id":"GAP-003","domain":"training","description":"Only 60% of staff completed NDPR training","severity":"medium"}]}',NOW()-INTERVAL '153 days'),
(2,88,'AIICO Insurance demonstrates high compliance with 2 gaps identified.','{"gaps":[{"id":"GAP-001","domain":"retention","description":"Legacy system retention not automated","severity":"high"},{"id":"GAP-002","domain":"vendor_management","description":"Vendor DPA not updated for 3 processors","severity":"medium"}]}',NOW()-INTERVAL '121 days')
ON CONFLICT DO NOTHING;

-- ─── API Keys ─────────────────────────────────────────────────────────────────
INSERT INTO api_keys (user_id, key_hash, key_prefix, is_active, last_used_at, created_at)
VALUES
(1,'sha256:fbngla-prod-hash-001','fbk_prod_',true,NOW()-INTERVAL '1 hour',NOW()-INTERVAL '90 days'),
(1,'sha256:mtnngla-prod-hash-001','mtn_prod_',true,NOW()-INTERVAL '30 minutes',NOW()-INTERVAL '60 days'),
(1,'sha256:luth-prod-hash-001','lth_prod_',true,NOW()-INTERVAL '2 hours',NOW()-INTERVAL '45 days'),
(1,'sha256:fme-prod-hash-001','fme_prod_',true,NOW()-INTERVAL '6 hours',NOW()-INTERVAL '30 days'),
(1,'sha256:nnpc-prod-hash-001','nnp_prod_',true,NOW()-INTERVAL '3 hours',NOW()-INTERVAL '20 days')
ON CONFLICT DO NOTHING;

SELECT 'Final seed complete' AS status;
