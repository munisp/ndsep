-- ============================================================
-- NDSEP Patch Seed Script — Fix remaining enum/type errors
-- ============================================================

-- ─── Residency Checks (storage_country max 8 chars) ──────────────────────────
-- Use ISO country codes (2-char) instead of full country names
INSERT INTO residency_checks (organization_id, data_asset_name, data_classification, storage_location, storage_country, is_within_borders, residency_status, violation_reason, remediation_action, checked_at, created_at)
VALUES
(1,'First Bank Customer Database','tier2_financial','Lagos, Nigeria','NG',true,'compliant',NULL,NULL,NOW()-INTERVAL '7 days',NOW()-INTERVAL '7 days'),
(2,'MTN Subscriber PII Database','tier1_pii','Dublin, Ireland','IE',false,'violation','Customer PII stored outside Nigeria without NDPC approval','Migrate to Nigerian data centre within 90 days',NOW()-INTERVAL '5 days',NOW()-INTERVAL '5 days'),
(3,'LUTH Patient Health Records','tier3_health','London, UK','GB',false,'violation','Patient health records stored in UK without adequate safeguards','Implement data localisation or obtain NDPC transfer approval',NOW()-INTERVAL '3 days',NOW()-INTERVAL '3 days'),
(4,'FME Student Records','tier1_pii','Lagos, Nigeria','NG',true,'compliant',NULL,NULL,NOW()-INTERVAL '2 days',NOW()-INTERVAL '2 days'),
(5,'NNPC Operational Data','tier5_public','Houston, USA','US',false,'violation','Operational data stored in US without proper transfer mechanism','Obtain standard contractual clauses or migrate to Nigeria',NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day')
ON CONFLICT DO NOTHING;

-- ─── DPCO Audit Engagements (valid stages: initiated, data_mapping, gap_assessment, fieldwork, findings_review, management_response, report_issued, car_filed) ──
INSERT INTO dpco_audit_engagements (dpco_org_id, client_id, title, current_stage, compliance_score, lead_auditor, planned_start, planned_end, actual_start, actual_end, critical_findings, high_findings, medium_findings, low_findings, notes, created_at)
VALUES
(1,1,'First Bank NDPR Full Compliance Audit 2025','car_filed',72,'Adewale Adeyemi','2025-10-01','2025-11-30','2025-10-05','2025-11-28',1,2,3,2,'Annual full compliance audit completed with 8 findings',NOW()-INTERVAL '180 days'),
(1,2,'AIICO Insurance NDPR Compliance Audit 2025','car_filed',85,'Tunde Balogun','2025-11-01','2025-12-31','2025-11-03','2025-12-28',0,1,2,1,'Audit completed with 4 findings, all remediated',NOW()-INTERVAL '150 days'),
(1,3,'Kuda Bank Privacy Programme Review','fieldwork',78,'Sola Oladipo','2026-02-01','2026-03-31','2026-02-05',NULL,0,2,3,1,'Fieldwork in progress',NOW()-INTERVAL '68 days'),
(2,4,'Jumia E-Commerce Privacy Audit','initiated',NULL,'Bisi Okafor','2026-04-15','2026-05-31',NULL,NULL,0,0,0,0,'Audit planning underway',NOW()-INTERVAL '14 days'),
(2,5,'Flutterwave Fintech Compliance Audit','report_issued',80,'Chioma Eze','2026-01-15','2026-03-15','2026-01-20','2026-03-10',0,1,2,2,'Draft report under review',NOW()-INTERVAL '25 days'),
(3,6,'Lagos State Government NDPA Readiness Assessment','car_filed',88,'Dr. Amaka Nwosu','2025-12-01','2026-01-31','2025-12-05','2026-01-28',0,0,2,3,'Readiness assessment completed',NOW()-INTERVAL '75 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Evidence Items (valid status: active, expired, superseded) ──────────
INSERT INTO dpco_evidence_items (dpco_org_id, engagement_id, client_id, title, description, file_url, file_key, file_name, mime_type, file_size, control_ids, status, uploaded_by, created_at)
VALUES
(1,1,1,'First Bank Privacy Policy v3.2','Current privacy policy document reviewed during audit','https://storage.ndsep.ng/evidence/fbngla-privacy-policy-v3.2.pdf','evidence/fbngla-privacy-policy-v3.2.pdf','privacy_policy_v3.2.pdf','application/pdf',245760,ARRAY['CTRL-001','CTRL-002'],'active','Adewale Adeyemi',NOW()-INTERVAL '160 days'),
(1,1,1,'First Bank Data Processing Register','Complete register of all data processing activities','https://storage.ndsep.ng/evidence/fbngla-dpr-2025.xlsx','evidence/fbngla-dpr-2025.xlsx','data_processing_register.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',512000,ARRAY['CTRL-003','CTRL-004'],'active','Adewale Adeyemi',NOW()-INTERVAL '158 days'),
(1,1,1,'Staff Training Completion Records','Evidence of NDPR training completion for all staff','https://storage.ndsep.ng/evidence/fbngla-training-records.pdf','evidence/fbngla-training-records.pdf','training_completion_records.pdf','application/pdf',189440,ARRAY['CTRL-010'],'active','Adewale Adeyemi',NOW()-INTERVAL '155 days'),
(1,2,2,'AIICO Insurance Privacy Notice','Updated privacy notice for policyholders','https://storage.ndsep.ng/evidence/aiico-privacy-notice.pdf','evidence/aiico-privacy-notice.pdf','privacy_notice.pdf','application/pdf',156672,ARRAY['CTRL-001'],'active','Tunde Balogun',NOW()-INTERVAL '130 days'),
(1,3,3,'Kuda Bank Consent Management Screenshots','Screenshots of consent management system implementation','https://storage.ndsep.ng/evidence/kuda-consent-mgmt.pdf','evidence/kuda-consent-mgmt.pdf','consent_management_screenshots.pdf','application/pdf',2097152,ARRAY['CTRL-005','CTRL-006'],'active','Sola Oladipo',NOW()-INTERVAL '50 days'),
(3,6,6,'Lagos State DPIA for e-Government Portal','Data Protection Impact Assessment for the state e-Government portal','https://storage.ndsep.ng/evidence/lasgov-dpia-egovt.pdf','evidence/lasgov-dpia-egovt.pdf','dpia_egovernment_portal.pdf','application/pdf',1048576,ARRAY['CTRL-007','CTRL-008'],'active','Dr. Amaka Nwosu',NOW()-INTERVAL '90 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Accreditation Applications (use rc_number not company_reg_no) ───────
INSERT INTO dpco_accreditation_applications (org_name, rc_number, address, email, phone, lead_auditors, sectors, conflict_declaration, application_type, application_fee, payment_status, status, reference_token, submitted_at, created_at)
VALUES
('DataGuard Nigeria Limited','RC-1234567','14 Broad Street, Lagos Island, Lagos','info@dataguard.ng','+2348011111111',ARRAY['Chidi Okonkwo (CIPP/E)','Amaka Eze (CIPM)'],ARRAY['Financial Services','Healthcare','Government'],true,'new',500000,'paid','approved','DGA-2025-001','2025-06-01',NOW()-INTERVAL '300 days'),
('Privacy Shield Consulting','RC-2345678','22 Adeola Odeku, Victoria Island, Lagos','hello@privacyshield.ng','+2348022222222',ARRAY['Bola Adeyemi (CIPP/E)'],ARRAY['E-Commerce','Telecommunications'],true,'new',500000,'paid','approved','DGA-2025-002','2025-07-15',NOW()-INTERVAL '270 days'),
('Compliance Nexus Africa','RC-3456789','5 Wuse Zone 5, Abuja','contact@compliancenexus.ng','+2348033333333',ARRAY['Ibrahim Musa (CIPM)','Fatima Suleiman (CIPP/E)'],ARRAY['Energy','Government','Healthcare'],true,'new',500000,'paid','under_review','DGA-2026-001','2026-02-01',NOW()-INTERVAL '72 days'),
('TechLegal Partners','RC-4567890','8 Ozumba Mbadiwe, Victoria Island, Lagos','info@techlegal.ng','+2348044444444',ARRAY['Tunde Okafor (CIPP/E)'],ARRAY['Fintech','E-Commerce'],false,'new',500000,'pending','submitted','DGA-2026-002','2026-03-15',NOW()-INTERVAL '30 days')
ON CONFLICT DO NOTHING;

-- ─── AI Governance Scores (findings/recommendations as JSONB) ─────────────────
INSERT INTO ai_governance_scores (org_id, system_name, system_type, risk_category, transparency_score, fairness_score, accountability_score, human_oversight_score, overall_score, ndpa_article24_compliant, findings, recommendations, assessed_by, assessed_at, next_review_date, created_at)
VALUES
(1,'First Bank Credit Scoring Model','ml_model','high_risk',65,70,75,80,72,false,
 '["Lack of explainability for loan denials","No bias audit conducted in last 12 months","Limited human review for borderline cases"]'::jsonb,
 '["Implement LIME/SHAP explainability","Conduct quarterly bias audits","Increase human review threshold from 5% to 20%"]'::jsonb,
 'NDPC AI Governance Team','2026-03-01','2026-09-01',NOW()-INTERVAL '44 days'),
(2,'MTN Nigeria Network Optimisation AI','ml_model','medium_risk',80,85,78,90,83,true,
 '["Data minimisation not fully implemented","Retention period for training data unclear"]'::jsonb,
 '["Implement data minimisation in training pipeline","Define and document retention periods"]'::jsonb,
 'NDPC AI Governance Team','2026-02-15','2026-08-15',NOW()-INTERVAL '58 days'),
(3,'LUTH Diagnostic Imaging AI','ml_model','high_risk',55,60,70,95,70,false,
 '["No clinical validation study published","Demographic bias in training data","Insufficient human oversight documentation"]'::jsonb,
 '["Conduct and publish clinical validation study","Diversify training dataset","Document human oversight procedures"]'::jsonb,
 'NDPC AI Governance Team','2026-01-20','2026-07-20',NOW()-INTERVAL '84 days'),
(4,'FME Student Performance Predictor','ml_model','medium_risk',75,72,80,85,78,true,
 '["Parental consent not obtained for minors data use","Model version control documentation incomplete"]'::jsonb,
 '["Obtain explicit parental consent","Implement MLOps version control"]'::jsonb,
 'NDPC AI Governance Team','2026-03-10','2026-09-10',NOW()-INTERVAL '35 days'),
(5,'NNPC Predictive Maintenance AI','ml_model','low_risk',88,90,85,82,86,true,
 '["Third-party model vendor assessment pending"]'::jsonb,
 '["Complete vendor assessment within 60 days"]'::jsonb,
 'NDPC AI Governance Team','2026-03-20','2026-09-20',NOW()-INTERVAL '25 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO Audit Control Ratings (control_rating enum: compliant, partial, non_compliant, not_applicable) ──
INSERT INTO dpco_audit_control_ratings (engagement_id, control_id, rating, notes, rated_by, rated_at, created_at)
VALUES
(1,'CTRL-001','partial','Privacy policy exists but lacks granular consent mechanisms','Adewale Adeyemi','2025-11-15',NOW()-INTERVAL '166 days'),
(1,'CTRL-002','compliant','Data subject rights procedures well documented','Adewale Adeyemi','2025-11-15',NOW()-INTERVAL '166 days'),
(1,'CTRL-003','non_compliant','Data processing register incomplete for digital channels','Adewale Adeyemi','2025-11-16',NOW()-INTERVAL '165 days'),
(1,'CTRL-004','partial','Vendor management adequate but DPAs need updating','Adewale Adeyemi','2025-11-16',NOW()-INTERVAL '165 days'),
(1,'CTRL-005','compliant','Consent management system implemented','Adewale Adeyemi','2025-11-17',NOW()-INTERVAL '164 days'),
(1,'CTRL-006','non_compliant','Data breach response plan not tested in last 12 months','Adewale Adeyemi','2025-11-17',NOW()-INTERVAL '164 days'),
(2,'CTRL-001','compliant','Privacy notice comprehensive and accessible','Tunde Balogun','2025-12-05',NOW()-INTERVAL '130 days'),
(2,'CTRL-002','compliant','Excellent data subject rights management system','Tunde Balogun','2025-12-05',NOW()-INTERVAL '130 days'),
(2,'CTRL-003','compliant','Processing register complete and up to date','Tunde Balogun','2025-12-06',NOW()-INTERVAL '129 days'),
(2,'CTRL-004','partial','Some vendor DPAs require renewal','Tunde Balogun','2025-12-06',NOW()-INTERVAL '129 days'),
(6,'CTRL-001','compliant','Comprehensive privacy policy aligned with NDPA','Dr. Amaka Nwosu','2026-01-15',NOW()-INTERVAL '89 days'),
(6,'CTRL-002','compliant','Data subject rights well managed','Dr. Amaka Nwosu','2026-01-15',NOW()-INTERVAL '89 days')
ON CONFLICT DO NOTHING;

-- ─── DPCO AI Gap Analyses (ratings_json is TEXT not JSONB) ───────────────────
INSERT INTO dpco_ai_gap_analyses (engagement_id, overall_score, executive_summary, ratings_json, created_at)
VALUES
(1,72,'First Bank demonstrates substantial NDPR compliance with 3 gaps identified requiring remediation.',
 '{"gaps":[{"id":"GAP-001","domain":"consent","description":"Analytics consent not granular","severity":"high"},{"id":"GAP-002","domain":"retention","description":"Retention schedule incomplete for digital channels","severity":"medium"},{"id":"GAP-003","domain":"training","description":"Only 60% of staff completed NDPR training","severity":"medium"}]}',
 NOW()-INTERVAL '153 days'),
(2,88,'AIICO Insurance demonstrates high compliance with 2 gaps identified.',
 '{"gaps":[{"id":"GAP-001","domain":"retention","description":"Legacy system retention not automated","severity":"high"},{"id":"GAP-002","domain":"vendor_management","description":"Vendor DPA not updated for 3 processors","severity":"medium"}]}',
 NOW()-INTERVAL '121 days')
ON CONFLICT DO NOTHING;

SELECT 'Patch seed complete' AS status;
